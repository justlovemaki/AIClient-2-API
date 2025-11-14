/**
 * @file Warp API Core Service
 * @description Main service class for interacting with Warp API using protobuf protocol.
 * Handles request building, authentication, streaming responses, and OpenAI format conversion.
 * Uses centralized WarpAuthManager for token management and HTTP/2 for efficient streaming.
 */

import { v4 as uuidv4 } from 'uuid';
import warpConfig from './warp-config.js';
import warpAuthManager from './warp-auth.js';
import { buildWarpPacket } from './warp-packet-builder.js';
import { reorderMessagesForAnthropic } from './warp-reorder.js';
import { extractOpenAIContentFromResponse, extractOpenAISSEDeltasFromResponse } from './warp-response.js';
import warpProtobufUtils from './warp-protobuf-utils.js';

/**
 * Warp API Service Class
 */
class WarpApiService {
    constructor(config) {
        this.config = config;
        
        // Update warpConfig from the provided config
        warpConfig.updateFromConfig(config);
        
        this.warpUrl = warpConfig.WARP_URL;
        this.conversationId = null;
        this.taskId = null;
        this.toolMessageId = uuidv4();
        this.toolCallId = uuidv4();
        
        // Use centralized auth manager
        this.authManager = warpAuthManager;
        
        console.log('[Warp] Service initialized');
    }

    /**
     * Parse SSE payload bytes from hex or base64
     */
    parsePayloadBytes(dataStr) {
        const s = (dataStr || '').replace(/\s+/g, '');
        if (!s) return null;
        
        // Try hex first
        if (/^[0-9a-fA-F]+$/.test(s)) {
            try {
                return Buffer.from(s, 'hex');
            } catch (e) {
                // Fall through
            }
        }
        
        // Try base64url then base64
        const pad = '='.repeat((4 - (s.length % 4)) % 4);
        try {
            return Buffer.from(s + pad, 'base64url');
        } catch (e) {
            try {
                return Buffer.from(s + pad, 'base64');
            } catch (e2) {
                return null;
            }
        }
    }

    /**
     * Generate content (non-streaming)
     */
    async generateContent(model, requestBody) {
        try {
            // Validate model parameter
            if (!model || typeof model !== 'string') {
                throw new Error('Invalid model parameter: must be a non-empty string');
            }
            
            // Extract system prompt from messages or requestBody.system
            let systemPrompt = null;
            let messages = requestBody.messages || [];
            
            // Validate messages array
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Invalid messages: must be a non-empty array');
            }
            
            // First check if system prompt is in requestBody.system
            if (requestBody.system) {
                systemPrompt = requestBody.system;
            }
            
            // Then check for system messages in the messages array and extract them
            const systemMessages = messages.filter(m => m.role === 'system');
            if (systemMessages.length > 0 && !systemPrompt) {
                // Combine all system messages
                systemPrompt = systemMessages.map(m => m.content).join('\n');
            }
            
            // Remove system messages from the messages array (Warp doesn't accept them in history)
            messages = messages.filter(m => m.role !== 'system');
            
            // Reorder messages for Anthropic-style conversation (handles merging and reordering)
            const history = reorderMessagesForAnthropic(messages);

            // Build Warp packet
            const taskId = this.taskId || uuidv4();
            const packet = buildWarpPacket(
                history,
                taskId,
                this.toolMessageId,
                this.toolCallId,
                { base: model || 'claude-4.1-opus' },
                systemPrompt,
                requestBody.tools || null
            );

            // Add conversation_id if exists
            if (this.conversationId) {
                packet.metadata = packet.metadata || {};
                packet.metadata.conversation_id = this.conversationId;
            }

            // Get valid JWT token from auth manager
            const jwt = await this.authManager.getValidJWT();
            
            // Convert packet to protobuf bytes
            const protobufBytes = await warpProtobufUtils.dictToProtobufBytes(packet, 'warp.multi_agent.v1.Request');
            console.log(`[Warp Debug] Protobuf bytes: ${protobufBytes.length} bytes`);

            // Use HTTP/2 for request (matching Python implementation)
            const http2 = await import('http2');
            const { URL } = await import('url');
            
            const parsedUrl = new URL(this.warpUrl);
            const client = http2.connect(`${parsedUrl.protocol}//${parsedUrl.host}`);
            
            const http2Headers = {
                ':method': 'POST',
                ':path': parsedUrl.pathname,
                'accept': 'text/event-stream',
                'content-type': 'application/x-protobuf',
                'authorization': `Bearer ${jwt}`,
                'content-length': String(protobufBytes.length),
                'x-warp-client-version': warpConfig.CLIENT_VERSION,
                'x-warp-os-category': warpConfig.OS_CATEGORY,
                'x-warp-os-name': warpConfig.OS_NAME,
                'x-warp-os-version': warpConfig.OS_VERSION
            };
            
            const req = client.request(http2Headers);
            req.write(protobufBytes);
            req.end();

            // Track response status
            let responseStatus = null;
            let errorMessage = '';
            
            req.on('response', (responseHeaders) => {
                responseStatus = responseHeaders[':status'];
                console.log(`[Warp] Response: HTTP ${responseStatus}`);
                
                if (responseStatus >= 400) {
                    console.error(`[Warp Error] HTTP ${responseStatus} error`);
                }
            });

            // Process SSE stream
            let currentData = '';
            let lineBuffer = '';
            const completeResponse = [];
            let toolCalls = [];

            for await (const chunk of req) {
                // Collect error message if status is error
                if (responseStatus >= 400) {
                    errorMessage += chunk.toString();
                    continue;
                }
                lineBuffer += chunk.toString();
                const lines = lineBuffer.split('\n');
                
                // Keep the last incomplete line in buffer
                lineBuffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const payload = line.substring(5).trim();
                        if (!payload || payload === '[DONE]') continue;
                        currentData += payload;
                        continue;
                    }
                    
                    if (line.trim() === '' && currentData) {
                        const rawBytes = this.parsePayloadBytes(currentData);
                        currentData = '';
                        
                        if (!rawBytes) continue;
                        
                        try {
                            // Extract content and tool calls directly from raw bytes
                            const extracted = await extractOpenAIContentFromResponse(rawBytes);
                            if (extracted.content) {
                                completeResponse.push(extracted.content);
                            }
                            if (extracted.tool_calls && extracted.tool_calls.length > 0) {
                                toolCalls = extracted.tool_calls;
                            }
                            
                            // Decode for metadata extraction
                            const eventData = await warpProtobufUtils.protobufToDict(rawBytes, 'warp.multi_agent.v1.ResponseEvent');
                            if (eventData.init) {
                                this.conversationId = eventData.init.conversation_id || this.conversationId;
                                this.taskId = eventData.init.task_id || this.taskId;
                            }
                        } catch (e) {
                            // Ignore parse errors for incomplete/corrupted protobuf messages
                            console.log('[Warp SSE] Parse error:', e.message);
                        }
                    }
                }
            }
            
            // Close HTTP/2 connection
            client.close();
            
            // Handle HTTP errors
            if (responseStatus >= 400) {
                const errorMsg = errorMessage.trim() || `HTTP ${responseStatus} error`;
                console.error(`[Warp Error] ${errorMsg}`);
                
                if (responseStatus === 429) {
                    throw new Error('Warp API rate limit exceeded. Please try again later.');
                }
                
                throw new Error(`Warp API error: ${errorMsg}`);
            }

            // Build OpenAI-compatible response
            const fullResponse = completeResponse.join('');
            
            if (toolCalls.length > 0) {
                return {
                    id: uuidv4(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'warp-default',
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: '',
                            tool_calls: toolCalls
                        },
                        finish_reason: 'tool_calls'
                    }]
                };
            }

            return {
                id: uuidv4(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model || 'warp-default',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: fullResponse || 'No response from Warp API'
                    },
                    finish_reason: 'stop'
                }]
            };

        } catch (error) {
            console.error('[Warp] Generate content error:', error.message);
            throw error;
        }
    }

    /**
     * Generate content stream (streaming)
     */
    async *generateContentStream(model, requestBody) {
        try {
            // Validate model parameter
            if (!model || typeof model !== 'string') {
                throw new Error('Invalid model parameter: must be a non-empty string');
            }
            
            // Extract system prompt from messages or requestBody.system
            let systemPrompt = null;
            let messages = requestBody.messages || [];
            
            // Validate messages array
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Invalid messages: must be a non-empty array');
            }
            
            // First check if system prompt is in requestBody.system
            if (requestBody.system) {
                systemPrompt = requestBody.system;
            }
            
            // Then check for system messages in the messages array and extract them
            const systemMessages = messages.filter(m => m.role === 'system');
            if (systemMessages.length > 0 && !systemPrompt) {
                // Combine all system messages
                systemPrompt = systemMessages.map(m => m.content).join('\n');
            }
            
            // Remove system messages from the messages array (Warp doesn't accept them in history)
            messages = messages.filter(m => m.role !== 'system');
            
            // Reorder messages for Anthropic-style conversation (handles merging and reordering)
            const history = reorderMessagesForAnthropic(messages);

            // Build Warp packet
            const taskId = this.taskId || uuidv4();
            const packet = buildWarpPacket(
                history,
                taskId,
                this.toolMessageId,
                this.toolCallId,
                { base: model || 'claude-4.1-opus' },
                systemPrompt,
                requestBody.tools || null
            );

            if (this.conversationId) {
                packet.metadata = packet.metadata || {};
                packet.metadata.conversation_id = this.conversationId;
            }

            // Get valid JWT token from auth manager
            let jwt = await this.authManager.getValidJWT();
            
            // Convert packet to protobuf bytes
            const protobufBytes = await warpProtobufUtils.dictToProtobufBytes(packet, 'warp.multi_agent.v1.Request');

            console.log('[Warp] Sending request, protobuf size:', protobufBytes.length, 'bytes');

            const completionId = uuidv4();
            const createdTs = Math.floor(Date.now() / 1000);
            const modelId = model || 'warp-default';

            // Send first chunk with role
            yield {
                id: completionId,
                object: 'chat.completion.chunk',
                created: createdTs,
                model: modelId,
                choices: [{ index: 0, delta: { role: 'assistant' } }]
            };

            // Use HTTP/2 for streaming (matching Python implementation)
            const http2 = await import('http2');
            const { URL } = await import('url');
            
            const parsedUrl = new URL(this.warpUrl);
            const client = http2.connect(`${parsedUrl.protocol}//${parsedUrl.host}`);
            
            // Build headers matching Python api_client.py format
            const http2Headers = {
                ':method': 'POST',
                ':path': parsedUrl.pathname,
                'accept': 'text/event-stream',
                'content-type': 'application/x-protobuf',
                'authorization': `Bearer ${jwt}`,
                'content-length': String(protobufBytes.length),
                'x-warp-client-version': warpConfig.CLIENT_VERSION,
                'x-warp-os-category': warpConfig.OS_CATEGORY,
                'x-warp-os-name': warpConfig.OS_NAME,
                'x-warp-os-version': warpConfig.OS_VERSION
            };
            
            const req = client.request(http2Headers);

            req.write(protobufBytes);
            req.end();
            
            // Handle 401/403 errors with token refresh
            let retryAttempted = false;

            let currentData = '';
            let toolCallsEmitted = false;
            let chunkCount = 0;

            let responseStatus = null;
            let errorMessage = '';
            
            req.on('response', (responseHeaders) => {
                responseStatus = responseHeaders[':status'];
                const contentLength = responseHeaders['content-length'];
                console.log(`[Warp] Response: HTTP ${responseStatus}, content-length: ${contentLength}`);
                
                // Check for authentication errors
                if ((responseStatus === 401 || responseStatus === 403) && !retryAttempted) {
                    console.warn('[Warp] Authentication error detected, will retry after token refresh...');
                    retryAttempted = true;
                }
                
                // Check for rate limit
                if (responseStatus === 429) {
                    console.error('[Warp Error] Rate limit exceeded (HTTP 429)');
                    errorMessage = 'Rate limit exceeded. Please try again later.';
                }
                
                // Check for other errors
                if (responseStatus >= 400 && responseStatus !== 429) {
                    console.error(`[Warp Error] HTTP ${responseStatus} error`);
                }
                
                if (contentLength === '0') {
                    console.error('[Warp Error] Server returned empty response (content-length: 0)');
                    console.error('[Warp Error] This usually means the request format is incorrect');
                }
            });

            let lineBuffer = '';
            let hasContent = false;
            
            for await (const chunk of req) {
                chunkCount++;
                const chunkStr = chunk.toString();
                
                // Collect error message if status is error
                if (responseStatus >= 400) {
                    errorMessage += chunkStr;
                    continue;
                }
                
                lineBuffer += chunkStr;
                const lines = lineBuffer.split('\n');
                
                // Keep the last incomplete line in buffer
                lineBuffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const payload = line.substring(5).trim();
                        if (!payload) continue;
                        if (payload === '[DONE]') break;
                        currentData += payload;
                        continue;
                    }
                    
                    if (line.trim() === '' && currentData) {
                        const rawBytes = this.parsePayloadBytes(currentData);
                        currentData = '';
                        
                        if (!rawBytes) continue;
                        
                        try {
                            // Extract SSE deltas directly from raw bytes
                            const deltas = await extractOpenAISSEDeltasFromResponse(rawBytes);
                            
                            for (const delta of deltas) {
                                hasContent = true;
                                
                                // Delta already has the correct OpenAI format
                                yield {
                                    id: completionId,
                                    object: 'chat.completion.chunk',
                                    created: createdTs,
                                    model: modelId,
                                    ...delta
                                };
                                
                                // Track if tool calls were emitted
                                if (delta.choices && delta.choices[0] && delta.choices[0].delta && delta.choices[0].delta.tool_calls) {
                                    toolCallsEmitted = true;
                                }
                            }
                            
                            // Decode for state management
                            const eventData = await warpProtobufUtils.protobufToDict(rawBytes, 'warp.multi_agent.v1.ResponseEvent');
                            
                            // Update state
                            if (eventData.init) {
                                this.conversationId = eventData.init.conversation_id || this.conversationId;
                                this.taskId = eventData.init.task_id || this.taskId;
                            }
                            
                            // Check for finished
                            if ('finished' in eventData) {
                                yield {
                                    id: completionId,
                                    object: 'chat.completion.chunk',
                                    created: createdTs,
                                    model: modelId,
                                    choices: [{
                                        index: 0,
                                        delta: {},
                                        finish_reason: toolCallsEmitted ? 'tool_calls' : 'stop'
                                    }]
                                };
                            }
                        } catch (e) {
                            console.error('[Warp SSE] Parse error:', e.message);
                        }
                    }
                }
            }

            // Close HTTP/2 connection
            client.close();
            
            // Handle HTTP errors
            if (responseStatus >= 400) {
                const errorMsg = errorMessage.trim() || `HTTP ${responseStatus} error`;
                console.error(`[Warp Error] ${errorMsg}`);
                
                // Handle authentication errors with retry
                if ((responseStatus === 401 || responseStatus === 403) && retryAttempted) {
                    console.log('[Warp] Retrying request with refreshed token...');
                    await this.authManager.getValidJWT(true);
                    yield* this.generateContentStream(model, requestBody);
                    return;
                }
                
                // For rate limit, throw specific error
                if (responseStatus === 429) {
                    throw new Error('Warp API rate limit exceeded. Please try again later.');
                }
                
                // For other errors, throw with error message
                throw new Error(`Warp API error: ${errorMsg}`);
            }
            
            // If no content was yielded, send error chunk
            if (!hasContent) {
                console.warn('[Warp] No content received from API');
                yield {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: createdTs,
                    model: modelId,
                    choices: [{
                        index: 0,
                        delta: { content: 'Error: No response from Warp API' },
                        finish_reason: 'stop'
                    }]
                };
            }

        } catch (error) {
            console.error('[Warp] Stream error:', error.message);
            throw error;
        }
    }

    /**
     * List available models
     */
    async listModels() {
        const { getAllUniqueModels } = await import('./warp-models.js');
        return {
            object: 'list',
            data: getAllUniqueModels()
        };
    }

    /**
     * Refresh JWT token (delegates to auth manager)
     */
    async refreshToken() {
        try {
            await this.authManager.getValidJWT(true);
            console.log('[Warp] Token refreshed successfully');
        } catch (error) {
            console.error('[Warp] Token refresh failed:', error.message);
            throw error;
        }
    }
}

export { WarpApiService };
