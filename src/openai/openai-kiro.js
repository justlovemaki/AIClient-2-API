import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * Kiro API Service - Node.js implementation based on the Python ki2api
 * Provides OpenAI-compatible API for Claude Sonnet 4 via Kiro/CodeWhisperer
 * 暂不可用，接口403
 */
export class KiroApiService {
    constructor(config = {}) {
        this.accessToken = config.KIRO_ACCESS_TOKEN || process.env.KIRO_ACCESS_TOKEN;
        this.refreshToken = config.KIRO_REFRESH_TOKEN || process.env.KIRO_REFRESH_TOKEN;

        this.refreshUrl = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';
        this.baseUrl = 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse';
        this.profileArn = 'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK';
        this.modelName = 'claude-sonnet-4-20250514';
        this.codewhispererModel = 'CLAUDE_SONNET_4_20250514_V1_0';
        
        this.axiosInstance = axios.create({
            timeout: 120000, // 2 minutes timeout
        });
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshTokens() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            console.log('[Kiro] Refreshing tokens...',this.refreshUrl,this.refreshToken);
            const response = await this.axiosInstance.post(this.refreshUrl, {
                refreshToken: this.refreshToken
            });

            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                console.log('[Kiro] Access token refreshed successfully');
                return this.accessToken;
            } else {
                throw new Error('Invalid refresh response');
            }
        } catch (error) {
            console.error('[Kiro] Token refresh failed:', error.message);
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }

    /**
     * Get current access token, refresh if needed
     */
    async getValidToken() {
        if (!this.accessToken) {
            throw new Error('No access token available');
        }
        return this.accessToken;
    }

    /**
     * Extract text content from OpenAI message format
     */
    getContentText(message) {
        if (typeof message.content === 'string') {
            return message.content;
        } else if (Array.isArray(message.content)) {
            return message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text)
                .join('');
        }
        return String(message.content || '');
    }

    /**
     * Build CodeWhisperer request from OpenAI messages
     */
    buildCodewhispererRequest(messages) {
        const conversationId = uuidv4();
        
        // Extract system prompt and user messages
        let systemPrompt = '';
        const userMessages = [];
        
        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt = this.getContentText(msg);
            } else {
                userMessages.push(msg);
            }
        }

        if (userMessages.length === 0) {
            throw new Error('No user messages found');
        }

        // Build history (pairs of user/assistant messages)
        const history = [];
        for (let i = 0; i < userMessages.length - 1; i += 2) {
            if (i + 1 < userMessages.length) {
                history.push({
                    userInputMessage: {
                        content: this.getContentText(userMessages[i]),
                        modelId: this.codewhispererModel,
                        origin: 'AI_EDITOR'
                    }
                });
                history.push({
                    assistantResponseMessage: {
                        content: this.getContentText(userMessages[i + 1]),
                        toolUses: []
                    }
                });
            }
        }

        // Build current message
        const currentMessage = userMessages[userMessages.length - 1];
        let content = this.getContentText(currentMessage);
        if (systemPrompt) {
            content = `${systemPrompt}\n\n${content}`;
        }

        return {
            profileArn: this.profileArn,
            conversationState: {
                chatTriggerType: 'MANUAL',
                conversationId: conversationId,
                currentMessage: {
                    userInputMessage: {
                        content: content,
                        modelId: this.codewhispererModel,
                        origin: 'AI_EDITOR',
                        userInputMessageContext: {}
                    }
                },
                history: history
            }
        };
    }

    /**
     * Parse AWS event stream format to extract content
     */
    parseEventStreamToJson(rawData) {
        try {
            let rawStr;
            if (Buffer.isBuffer(rawData)) {
                rawStr = rawData.toString('utf8');
            } else {
                rawStr = String(rawData);
            }

            // Look for JSON content in the response
            const jsonPattern = /\{[^{}]*"content"[^{}]*\}/g;
            const matches = rawStr.match(jsonPattern);
            
            if (matches) {
                const contentParts = [];
                for (const match of matches) {
                    try {
                        const data = JSON.parse(match);
                        if (data.content) {
                            contentParts.push(data.content);
                        }
                    } catch (e) {
                        continue;
                    }
                }
                if (contentParts.length > 0) {
                    return { content: contentParts.join('') };
                }
            }

            // Try to extract from AWS event stream format
            const contentTypePattern = /:content-type[^:]*:[^:]*:[^:]*:(\{.*\})/g;
            const contentMatches = rawStr.match(contentTypePattern);
            if (contentMatches) {
                for (const match of contentMatches) {
                    try {
                        const jsonStr = match.replace(/:content-type[^:]*:[^:]*:[^:]*:/, '');
                        const data = JSON.parse(jsonStr.trim());
                        if (data && data.content) {
                            return { content: data.content };
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            // Try to extract any JSON objects
            const jsonObjects = rawStr.match(/\{[^{}]*\}/g);
            if (jsonObjects) {
                for (const obj of jsonObjects) {
                    try {
                        const data = JSON.parse(obj);
                        if (data && data.content) {
                            return { content: data.content };
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            // Final fallback: extract readable text
            const readableText = rawStr.replace(/[^\x20-\x7E\n\r\t\u4e00-\u9fff]/g, '');
            const cleanText = readableText.replace(/:event-type[^:]*:[^:]*:[^:]*:/g, '');

            // Look for Chinese characters or meaningful content
            const chineseMatches = rawStr.match(/[\u4e00-\u9fff]+/g);
            if (chineseMatches) {
                return { content: chineseMatches.join('') };
            }

            return { content: cleanText.trim() || 'No content found in response' };

        } catch (error) {
            return { content: `Error parsing response: ${error.message}` };
        }
    }

    /**
     * Make API call to Kiro/CodeWhisperer
     */
    async callKiroApi(messages, stream = false) {
        const token = await this.getValidToken();
        const requestData = this.buildCodewhispererRequest(messages);

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': stream ? 'text/event-stream' : 'application/json'
        };

        console.log('[Kiro] Request headers:', JSON.stringify(headers));
        console.log('[Kiro] Request data:',  JSON.stringify(requestData));

        try {
            const response = await this.axiosInstance.post(this.baseUrl, requestData, {
                headers,
            });

            return response;
        } catch (error) {
            if (error.response?.status === 403) {
                // Try to refresh token and retry
                console.log('[Kiro] Received 403, attempting token refresh...');
                try {
                    await this.refreshTokens();
                    headers['Authorization'] = `Bearer ${this.accessToken}`;
                    
                    const retryResponse = await this.axiosInstance.post(this.baseUrl, requestData, {
                        headers,
                        responseType: stream ? 'stream' : 'json'
                    });
                    
                    return retryResponse;
                } catch (refreshError) {
                    console.error('[Kiro] Token refresh and retry failed:', refreshError.message);
                    throw refreshError;
                }
            }
            
            console.error('[Kiro] API call failed:', error.message);
            throw error;
        }
    }

    /**
     * Generate content (non-streaming)
     */
    async generateContent(model, requestBody) {
        console.log(`[Kiro] Non-streaming request for model: ${model}`);
        
        const response = await this.callKiroApi(requestBody.messages, false);
        
        try {
            console.log(`[Kiro] Response status: ${response.status}`);
            console.log(`[Kiro] Response headers:`, response.headers);
            
            let responseText = '';
            
            // Try to parse as JSON first
            if (response.data && typeof response.data === 'object') {
                console.log('[Kiro] Successfully parsed JSON response');
                if (response.data.content) {
                    responseText = response.data.content;
                } else {
                    responseText = JSON.stringify(response.data);
                }
            } else {
                // Handle event stream format
                const rawData = response.data;
                const parsed = this.parseEventStreamToJson(rawData);
                responseText = parsed.content;
                console.log(`[Kiro] Parsed content length: ${responseText.length}`);
            }

            console.log(`[Kiro] Final response text: ${responseText.substring(0, 200)}...`);

            // Return OpenAI-compatible response
            return {
                id: `chatcmpl-${uuidv4()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: this.modelName,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: responseText
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };

        } catch (error) {
            console.error('[Kiro] Error in generateContent:', error);
            throw new Error(`Error processing response: ${error.message}`);
        }
    }

    /**
     * Generate content stream (streaming)
     */
    async *generateContentStream(model, requestBody) {
        console.log(`[Kiro] Streaming request for model: ${model}`);
        
        const response = await this.callKiroApi(requestBody.messages, true);
        
        console.log(`[Kiro] Starting streaming response, status: ${response.status}`);
        
        // Send initial chunk
        const initialChunk = {
            id: `chatcmpl-${uuidv4()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [{
                index: 0,
                delta: { role: 'assistant' },
                finish_reason: null
            }]
        };
        
        console.log('[Kiro] Sending initial chunk');
        yield initialChunk;

        let content = '';
        let chunkCount = 0;

        try {
            // Read the entire response first
            const chunks = [];
            for await (const chunk of response.data) {
                chunks.push(chunk);
            }
            
            const responseBytes = Buffer.concat(chunks);
            console.log(`[Kiro] Streaming response bytes length: ${responseBytes.length}`);

            // Parse the AWS event stream
            const responseStr = responseBytes.toString('utf8');
            
            // Method 1: Look for JSON objects with content
            const jsonPattern = /\{[^{}]*"content"[^{}]*\}/g;
            const jsonMatches = responseStr.match(jsonPattern);
            
            if (jsonMatches) {
                for (const match of jsonMatches) {
                    try {
                        const data = JSON.parse(match);
                        if (data.content) {
                            const chunkText = data.content;
                            content += chunkText;
                            chunkCount++;
                            
                            const chunk = {
                                id: `chatcmpl-${uuidv4()}`,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: this.modelName,
                                choices: [{
                                    index: 0,
                                    delta: { content: chunkText },
                                    finish_reason: null
                                }]
                            };
                            
                            console.log(`[Kiro] Streaming JSON chunk ${chunkCount}: ${chunkText.substring(0, 50)}...`);
                            yield chunk;
                            
                            // Small delay to simulate streaming
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }
                    } catch (e) {
                        console.error(`[Kiro] Error streaming JSON chunk: ${e.message}`);
                        continue;
                    }
                }
            } else {
                // Method 2: Try to extract readable text
                const readableText = responseStr.replace(/[^\x20-\x7E\n\r\t\u4e00-\u9fff]/g, '');
                
                // Look for Chinese text specifically
                const chineseMatches = responseStr.match(/[\u4e00-\u9fff][\u4e00-\u9fff\s\.,!?]*[\u4e00-\u9fff]/g);
                
                if (chineseMatches) {
                    const combinedText = chineseMatches.join('');
                    // Split into chunks for streaming
                    const chunkSize = Math.max(1, Math.floor(combinedText.length / 10));
                    for (let i = 0; i < combinedText.length; i += chunkSize) {
                        const chunkText = combinedText.substring(i, i + chunkSize);
                        content += chunkText;
                        chunkCount++;
                        
                        const chunk = {
                            id: `chatcmpl-${uuidv4()}`,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: this.modelName,
                            choices: [{
                                index: 0,
                                delta: { content: chunkText },
                                finish_reason: null
                            }]
                        };
                        
                        console.log(`[Kiro] Streaming Chinese text chunk ${chunkCount}: ${chunkText.substring(0, 50)}...`);
                        yield chunk;
                        
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                } else {
                    // Method 3: Use the entire readable text
                    if (readableText.trim()) {
                        const chunk = {
                            id: `chatcmpl-${uuidv4()}`,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: this.modelName,
                            choices: [{
                                index: 0,
                                delta: { content: readableText.trim() },
                                finish_reason: null
                            }]
                        };
                        
                        console.log(`[Kiro] Streaming fallback text: ${readableText.substring(0, 100)}...`);
                        yield chunk;
                        content = readableText.trim();
                    }
                }
            }

        } catch (error) {
            console.error('[Kiro] Error in streaming generation:', error);
            
            // Send error as content
            const errorChunk = {
                id: `chatcmpl-${uuidv4()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: this.modelName,
                choices: [{
                    index: 0,
                    delta: { content: `Error: ${error.message}` },
                    finish_reason: null
                }]
            };
            yield errorChunk;
        }

        console.log(`[Kiro] Streaming complete, total chunks: ${chunkCount}, content length: ${content.length}`);

        // Send final chunk
        const finalChunk = {
            id: `chatcmpl-${uuidv4()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop'
            }]
        };
        
        yield finalChunk;
    }

    /**
     * List available models
     */
    async listModels() {
        console.log('[Kiro] Listing models');
        
        return {
            object: 'list',
            data: [{
                id: this.modelName,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'kiro-api'
            }]
        };
    }
}