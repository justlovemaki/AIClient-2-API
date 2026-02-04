/**
 * Gemini转换器
 * 处理Gemini（Google）协议与其他协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConverter } from '../BaseConverter.js';
import {
    checkAndAssignOrDefault,
    OPENAI_DEFAULT_MAX_TOKENS,
    OPENAI_DEFAULT_TEMPERATURE,
    OPENAI_DEFAULT_TOP_P,
    CLAUDE_DEFAULT_MAX_TOKENS,
    CLAUDE_DEFAULT_TEMPERATURE,
    CLAUDE_DEFAULT_TOP_P
} from '../utils.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';
import {
    generateResponseCreated,
    generateResponseInProgress,
    generateOutputItemAdded,
    generateContentPartAdded,
    generateOutputTextDone,
    generateContentPartDone,
    generateOutputItemDone,
    generateResponseCompleted
} from '../../providers/openai/openai-responses-core.mjs';

/**
 * 修复 Gemini 返回的工具参数名称问题
 * Gemini 有时会使用不同的参数名称，需要映射到 Claude Code 期望的格式
 */
function remapFunctionCallArgs(toolName, args) {
    if (!args || typeof args !== 'object') return args;
    
    const remappedArgs = { ...args };
    const toolNameLower = toolName.toLowerCase();
    
    // [IMPORTANT] Claude Code CLI 的 EnterPlanMode 工具禁止携带任何参数
    if (toolName === 'EnterPlanMode') {
        return {};
    }
    
    switch (toolNameLower) {
        case 'grep':
        case 'search':
        case 'search_code_definitions':
        case 'search_code_snippets':
            // [FIX] Gemini hallucination: maps parameter description to "description" field
            if (remappedArgs.description && !remappedArgs.pattern) {
                remappedArgs.pattern = remappedArgs.description;
                delete remappedArgs.description;
            }
            
            // Gemini uses "query", Claude Code expects "pattern"
            if (remappedArgs.query && !remappedArgs.pattern) {
                remappedArgs.pattern = remappedArgs.query;
                delete remappedArgs.query;
            }
            
            // [CRITICAL FIX] Claude Code uses "path" (string), NOT "paths" (array)!
            if (!remappedArgs.path) {
                if (remappedArgs.paths) {
                    if (Array.isArray(remappedArgs.paths)) {
                        remappedArgs.path = remappedArgs.paths[0] || '.';
                    } else if (typeof remappedArgs.paths === 'string') {
                        remappedArgs.path = remappedArgs.paths;
                    } else {
                        remappedArgs.path = '.';
                    }
                    delete remappedArgs.paths;
                } else {
                    // Default to current directory if missing
                    remappedArgs.path = '.';
                }
            }
            // Note: We keep "-n" and "output_mode" if present as they are valid in Grep schema
            break;
            
        case 'glob':
            // [FIX] Gemini hallucination: maps parameter description to "description" field
            if (remappedArgs.description && !remappedArgs.pattern) {
                remappedArgs.pattern = remappedArgs.description;
                delete remappedArgs.description;
            }
            
            // Gemini uses "query", Claude Code expects "pattern"
            if (remappedArgs.query && !remappedArgs.pattern) {
                remappedArgs.pattern = remappedArgs.query;
                delete remappedArgs.query;
            }
            
            // [CRITICAL FIX] Claude Code uses "path" (string), NOT "paths" (array)!
            // [NOTE] 与 grep 不同，glob 不添加默认 path（参考 Rust 代码）
            if (!remappedArgs.path) {
                if (remappedArgs.paths) {
                    if (Array.isArray(remappedArgs.paths)) {
                        remappedArgs.path = remappedArgs.paths[0] || '.';
                    } else if (typeof remappedArgs.paths === 'string') {
                        remappedArgs.path = remappedArgs.paths;
                    } else {
                        remappedArgs.path = '.';
                    }
                    delete remappedArgs.paths;
                }
                // [FIX] glob 不添加默认 path，与 Rust 代码保持一致
            }
            break;
            
        case 'read':
            // Gemini might use "path" vs "file_path"
            if (remappedArgs.path && !remappedArgs.file_path) {
                remappedArgs.file_path = remappedArgs.path;
                delete remappedArgs.path;
            }
            break;
            
        case 'ls':
            // LS tool: ensure "path" parameter exists
            if (!remappedArgs.path) {
                remappedArgs.path = '.';
            }
            break;
            
        default:
            // [NEW] [Issue #785] Generic Property Mapping for all tools
            // If a tool has "paths" (array of 1) but no "path", convert it.
            // [FIX] 与 Rust 代码保持一致：只在 paths.length === 1 时转换，不删除原始 paths
            if (!remappedArgs.path && remappedArgs.paths) {
                if (Array.isArray(remappedArgs.paths) && remappedArgs.paths.length === 1) {
                    const pathValue = remappedArgs.paths[0];
                    if (typeof pathValue === 'string') {
                        remappedArgs.path = pathValue;
                        // [FIX] Rust 代码中不删除 paths，这里也不删除
                    }
                }
            }
            break;
    }
    
    return remappedArgs;
}

/**
 * [FIX] 规范化工具名称
 * Gemini 有时会返回 "search" 而不是 "Grep"
 */
function normalizeToolName(name) {
    if (!name) return name;
    
    const nameLower = name.toLowerCase();
    if (nameLower === 'search') {
        return 'Grep';
    }
    return name;
}

/**
 * Gemini转换器类
 * 实现Gemini协议到其他协议的转换
 */
export class GeminiConverter extends BaseConverter {
    constructor() {
        super('gemini');
    }

    /**
     * 转换请求
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIRequest(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeRequest(data);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesRequest(data);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换响应
     */
    convertResponse(data, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexResponse(data, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexStreamChunk(chunk, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换模型列表
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeModelList(data);
            default:
                return data;
        }
    }

    // =========================================================================
    // Gemini -> OpenAI 转换
    // =========================================================================

    /**
     * Gemini请求 -> OpenAI请求
     */
    toOpenAIRequest(geminiRequest) {
        const openaiRequest = {
            messages: [],
            model: geminiRequest.model,
            max_tokens: checkAndAssignOrDefault(geminiRequest.max_tokens, OPENAI_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(geminiRequest.temperature, OPENAI_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(geminiRequest.top_p, OPENAI_DEFAULT_TOP_P),
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && Array.isArray(geminiRequest.systemInstruction.parts)) {
            const systemContent = this.processGeminiPartsToOpenAIContent(geminiRequest.systemInstruction.parts);
            if (systemContent) {
                openaiRequest.messages.push({
                    role: 'system',
                    content: systemContent
                });
            }
        }

        // 处理内容
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            geminiRequest.contents.forEach(content => {
                if (content && Array.isArray(content.parts)) {
                    const openaiContent = this.processGeminiPartsToOpenAIContent(content.parts);
                    if (openaiContent && openaiContent.length > 0) {
                        const openaiRole = content.role === 'model' ? 'assistant' : content.role;
                        openaiRequest.messages.push({
                            role: openaiRole,
                            content: openaiContent
                        });
                    }
                }
            });
        }

        return openaiRequest;
    }

    /**
     * Gemini响应 -> OpenAI响应
     */
    toOpenAIResponse(geminiResponse, model) {
        const content = this.processGeminiResponseContent(geminiResponse);
        
        // 提取 tool_calls
        const toolCalls = [];
        let finishReason = "stop";
        
        if (geminiResponse && geminiResponse.candidates) {
            for (const candidate of geminiResponse.candidates) {
                if (candidate.content && candidate.content.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.functionCall) {
                            toolCalls.push({
                                id: part.functionCall.id || `call_${uuidv4()}`,
                                type: 'function',
                                function: {
                                    name: part.functionCall.name,
                                    arguments: typeof part.functionCall.args === 'string' 
                                        ? part.functionCall.args 
                                        : JSON.stringify(part.functionCall.args)
                                }
                            });
                        }
                    }
                }
            }
        }
        
        // 如果有工具调用，设置 finish_reason 为 tool_calls
        if (toolCalls.length > 0) {
            finishReason = "tool_calls";
        }
        
        const message = {
            role: "assistant",
            content: content
        };
        
        // 只有在有 tool_calls 时才添加该字段
        if (toolCalls.length > 0) {
            message.tool_calls = toolCalls;
        }
        
        return {
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: message,
                finish_reason: finishReason,
            }],
            usage: geminiResponse.usageMetadata ? {
                prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
                completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
                total_tokens: geminiResponse.usageMetadata.totalTokenCount || 0,
                cached_tokens: geminiResponse.usageMetadata.cachedContentTokenCount || 0,
                prompt_tokens_details: {
                    cached_tokens: geminiResponse.usageMetadata.cachedContentTokenCount || 0
                },
                completion_tokens_details: {
                    reasoning_tokens: geminiResponse.usageMetadata.thoughtsTokenCount || 0
                }
            } : {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                cached_tokens: 0,
                prompt_tokens_details: {
                    cached_tokens: 0
                },
                completion_tokens_details: {
                    reasoning_tokens: 0
        }
            },
        };
    }

    /**
     * Gemini流式响应 -> OpenAI流式响应
     */
    toOpenAIStreamChunk(geminiChunk, model) {
        if (!geminiChunk) return null;

        const candidate = geminiChunk.candidates?.[0];
        if (!candidate) return null;

        let content = '';
        const toolCalls = [];
        
        // 从parts中提取文本和tool calls
        const parts = candidate.content?.parts;
        if (parts && Array.isArray(parts)) {
            for (const part of parts) {
                if (part.text) {
                    content += part.text;
                }
                if (part.functionCall) {
                    toolCalls.push({
                        index: toolCalls.length,
                        id: part.functionCall.id || `call_${uuidv4()}`,
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: typeof part.functionCall.args === 'string' 
                                ? part.functionCall.args 
                                : JSON.stringify(part.functionCall.args)
                        }
                    });
                }
                // thoughtSignature is ignored (internal Gemini data)
            }
        }

        // 处理finishReason
        let finishReason = null;
        if (candidate.finishReason) {
            const finishReasonMap = {
                'FINISH_REASON_UNSPECIFIED': 'stop',
                'STOP': 'stop',
                'MAX_TOKENS': 'length',
                'SAFETY': 'content_filter',
                'RECITATION': 'content_filter',
                'OTHER': 'stop',
                'BLOCKLIST': 'content_filter',
                'PROHIBITED_CONTENT': 'content_filter',
                'SPII': 'content_filter',
                'MALFORMED_FUNCTION_CALL': 'stop',
                'MODEL_ARMOR': 'content_filter',
            };
            finishReason = finishReasonMap[candidate.finishReason] || 'stop';
        }

        // [FIX] 适配 Gemini 流式：Gemini 的最后一条流式消息通常不带 functionCall
        // 如果当前 chunk 包含工具调用，直接将其标记为 tool_calls
        if (toolCalls.length > 0) {
            finishReason = 'tool_calls';
        }

        // 构建delta对象
        const delta = {};
        if (content) delta.content = content;
        if (toolCalls.length > 0) delta.tool_calls = toolCalls;

        // Don't return empty delta chunks
        if (Object.keys(delta).length === 0 && !finishReason) {
            return null;
        }

        const chunk = {
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                delta: delta,
                finish_reason: finishReason,
            }],
        };

        if(geminiChunk.usageMetadata){
            chunk.usage = {
                prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
                cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0,
                prompt_tokens_details: {
                    cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0
                },
                completion_tokens_details: {
                    reasoning_tokens: geminiChunk.usageMetadata.thoughtsTokenCount || 0
                }
            };
        }

        return chunk;
    }

    /**
     * Gemini模型列表 -> OpenAI模型列表
     */
    toOpenAIModelList(geminiModels) {
        return {
            object: "list",
            data: geminiModels.models.map(m => {
                const modelId = m.name.startsWith('models/') ? m.name.substring(7) : m.name;
                return {
                    id: modelId,
                    object: "model",
                    created: Math.floor(Date.now() / 1000),
                    owned_by: "google",
                    display_name: m.displayName || modelId,
                };
            }),
        };
    }

    /**
     * 处理Gemini parts到OpenAI内容
     */
    processGeminiPartsToOpenAIContent(parts) {
        if (!parts || !Array.isArray(parts)) return '';
        
        const contentArray = [];
        
        parts.forEach(part => {
            if (!part) return;
            
            if (typeof part.text === 'string') {
                contentArray.push({
                    type: 'text',
                    text: part.text
                });
            }
            
            if (part.inlineData) {
                const { mimeType, data } = part.inlineData;
                if (mimeType && data) {
                    contentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${data}`
                        }
                    });
                }
            }
            
            if (part.fileData) {
                const { mimeType, fileUri } = part.fileData;
                if (mimeType && fileUri) {
                    if (mimeType.startsWith('image/')) {
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: fileUri
                            }
                        });
                    } else if (mimeType.startsWith('audio/')) {
                        contentArray.push({
                            type: 'text',
                            text: `[Audio file: ${fileUri}]`
                        });
                    }
                }
            }
        });
        
        return contentArray.length === 1 && contentArray[0].type === 'text'
            ? contentArray[0].text
            : contentArray;
    }

    /**
     * 处理Gemini响应内容
     */
    processGeminiResponseContent(geminiResponse) {
        if (!geminiResponse || !geminiResponse.candidates) return '';
        
        const contents = [];
        
        geminiResponse.candidates.forEach(candidate => {
            if (candidate.content && candidate.content.parts) {
                candidate.content.parts.forEach(part => {
                    if (part.text) {
                        contents.push(part.text);
                    }
                });
            }
        });
        
        return contents.join('\n');
    }

    // =========================================================================
    // Gemini -> Claude 转换
    // =========================================================================

    /**
     * Gemini请求 -> Claude请求
     */
    toClaudeRequest(geminiRequest) {
        const claudeRequest = {
            model: geminiRequest.model || 'claude-3-opus',
            messages: [],
            max_tokens: checkAndAssignOrDefault(geminiRequest.generationConfig?.maxOutputTokens, CLAUDE_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(geminiRequest.generationConfig?.temperature, CLAUDE_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(geminiRequest.generationConfig?.topP, CLAUDE_DEFAULT_TOP_P),
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && geminiRequest.systemInstruction.parts) {
            const systemText = geminiRequest.systemInstruction.parts
                .filter(p => p.text)
                .map(p => p.text)
                .join('\n');
            if (systemText) {
                claudeRequest.system = systemText;
            }
        }

        // 处理内容
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            geminiRequest.contents.forEach(content => {
                if (!content || !content.parts) return;

                const role = content.role === 'model' ? 'assistant' : 'user';
                const claudeContent = this.processGeminiPartsToClaudeContent(content.parts);

                if (claudeContent.length > 0) {
                    claudeRequest.messages.push({
                        role: role,
                        content: claudeContent
                    });
                }
            });
        }

        // 处理工具
        if (geminiRequest.tools && geminiRequest.tools[0]?.functionDeclarations) {
            claudeRequest.tools = geminiRequest.tools[0].functionDeclarations.map(func => ({
                name: func.name,
                description: func.description || '',
                input_schema: func.parameters || { type: 'object', properties: {} }
            }));
        }

        return claudeRequest;
    }

    /**
     * Gemini响应 -> Claude响应
     */
    toClaudeResponse(geminiResponse, model) {
        if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
            return {
                id: `msg_${uuidv4()}`,
                type: "message",
                role: "assistant",
                content: [],
                model: model,
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: {
                    input_tokens: geminiResponse?.usageMetadata?.promptTokenCount || 0,
                    output_tokens: geminiResponse?.usageMetadata?.candidatesTokenCount || 0
                }
            };
        }

        const candidate = geminiResponse.candidates[0];
        const { content, hasToolUse } = this.processGeminiResponseToClaudeContent(geminiResponse);
        const finishReason = candidate.finishReason;
        let stopReason = "end_turn";

        // - 如果有工具调用，stop_reason 应该是 "tool_use"
        if (hasToolUse) {
            stopReason = 'tool_use';
        } else if (finishReason) {
            switch (finishReason) {
                case 'STOP':
                    stopReason = 'end_turn';
                    break;
                case 'MAX_TOKENS':
                    stopReason = 'max_tokens';
                    break;
                case 'SAFETY':
                    stopReason = 'safety';
                    break;
                case 'RECITATION':
                    stopReason = 'recitation';
                    break;
                case 'OTHER':
                    stopReason = 'other';
                    break;
                default:
                    stopReason = 'end_turn';
            }
        }

        return {
            id: `msg_${uuidv4()}`,
            type: "message",
            role: "assistant",
            content: content,
            model: model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: geminiResponse.usageMetadata?.cachedContentTokenCount || 0,
                output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0
            }
        };
    }

    /**
     * Gemini流式响应 -> Claude流式响应
     */
    toClaudeStreamChunk(geminiChunk, model) {
        if (!geminiChunk) return null;

        // 处理完整的Gemini chunk对象
        if (typeof geminiChunk === 'object' && !Array.isArray(geminiChunk)) {
            const candidate = geminiChunk.candidates?.[0];
            
            if (candidate) {
                const parts = candidate.content?.parts;
                
                // thinking 和 text 块
                if (parts && Array.isArray(parts)) {
                    const results = [];
                    let hasToolUse = false;
                    
                    for (const part of parts) {
                        if (!part) continue;
                        
                        if (typeof part.text === 'string') {
                            if (part.thought === true) {
                                // [FIX] 这是一个 thinking 块
                                const thinkingResult = {
                                    type: "content_block_delta",
                                    index: 0,
                                    delta: {
                                        type: "thinking_delta",
                                        thinking: part.text
                                    }
                                };
                                results.push(thinkingResult);
                                
                                // 如果有签名，发送 signature_delta
                                // [FIX] 同时检查 thoughtSignature 和 thought_signature
                                const rawSignature = part.thoughtSignature || part.thought_signature;
                                if (rawSignature) {
                                    let signature = rawSignature;
                                    try {
                                        const decoded = Buffer.from(signature, 'base64').toString('utf-8');
                                        if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                                            signature = decoded;
                                        }
                                    } catch (e) {
                                        // 解码失败，保持原样
                                    }
                                    results.push({
                                        type: "content_block_delta",
                                        index: 0,
                                        delta: {
                                            type: "signature_delta",
                                            signature: signature
                                        }
                                    });
                                }
                            } else {
                                // 普通文本
                                results.push({
                                    type: "content_block_delta",
                                    index: 0,
                                    delta: {
                                        type: "text_delta",
                                        text: part.text
                                    }
                                });
                            }
                        }
                        
                        // [FIX] 处理 functionCall
                        if (part.functionCall) {
                            hasToolUse = true;
                            // [FIX] 规范化工具名称和参数映射
                            const toolName = normalizeToolName(part.functionCall.name);
                            const remappedArgs = remapFunctionCallArgs(toolName, part.functionCall.args || {});
                            
                            // 发送 tool_use 开始
                            const toolId = part.functionCall.id || `${toolName}-${uuidv4().split('-')[0]}`;
                            results.push({
                                type: "content_block_start",
                                index: 0,
                                content_block: {
                                    type: "tool_use",
                                    id: toolId,
                                    name: toolName,
                                    input: {}
                                }
                            });
                            // 发送参数
                            results.push({
                                type: "content_block_delta",
                                index: 0,
                                delta: {
                                    type: "input_json_delta",
                                    partial_json: JSON.stringify(remappedArgs)
                                }
                            });
                        }
                    }
                    
                    // [FIX] 如果有工具调用，添加 message_delta 事件设置 stop_reason 为 tool_use
                    if (hasToolUse && candidate.finishReason) {
                        const messageDelta = {
                            type: "message_delta",
                            delta: {
                                stop_reason: 'tool_use'
                            }
                        };
                        if (geminiChunk.usageMetadata) {
                            messageDelta.usage = {
                                input_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                                cache_creation_input_tokens: 0,
                                cache_read_input_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0,
                                output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0
                            };
                        }
                        results.push(messageDelta);
                    }
                    
                    // 如果有多个结果，返回数组；否则返回单个或 null
                    if (results.length > 1) {
                        return results;
                    } else if (results.length === 1) {
                        return results[0];
                    }
                }
                
                // 处理finishReason
                if (candidate.finishReason) {
                    const result = {
                        type: "message_delta",
                        delta: {
                            stop_reason: candidate.finishReason === 'STOP' ? 'end_turn' :
                                       candidate.finishReason === 'MAX_TOKENS' ? 'max_tokens' :
                                       candidate.finishReason.toLowerCase()
                        }
                    };
                    
                    // 添加 usage 信息
                    if (geminiChunk.usageMetadata) {
                        result.usage = {
                            input_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0,
                            output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                            prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                            completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                            total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
                            cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0
                        };
                    }
                    
                    return result;
                }
            }
        }

        // 向后兼容：处理字符串格式
        if (typeof geminiChunk === 'string') {
            return {
                type: "content_block_delta",
                index: 0,
                delta: {
                    type: "text_delta",
                    text: geminiChunk
                }
            };
        }

        return null;
    }

    /**
     * Gemini模型列表 -> Claude模型列表
     */
    toClaudeModelList(geminiModels) {
        return {
            models: geminiModels.models.map(m => ({
                name: m.name.startsWith('models/') ? m.name.substring(7) : m.name,
                description: "",
            })),
        };
    }

    /**
     * 处理Gemini parts到Claude内容
     */
    processGeminiPartsToClaudeContent(parts) {
        if (!parts || !Array.isArray(parts)) return [];

        const content = [];

        parts.forEach(part => {
            if (!part) return;

            // 处理 thinking 块
            // Gemini 使用 thought: true 和 thoughtSignature 表示思考内容
            // [FIX] 同时支持 thoughtSignature 和 thought_signature（Gemini CLI 可能使用下划线格式）
            if (part.text) {
                if (part.thought === true) {
                    // 这是一个 thinking 块
                    const thinkingBlock = {
                        type: 'thinking',
                        thinking: part.text
                    };
                    // 处理签名 - 可能是 Base64 编码的
                    // [FIX] 同时检查 thoughtSignature 和 thought_signature
                    const rawSignature = part.thoughtSignature || part.thought_signature;
                    if (rawSignature) {
                        let signature = rawSignature;
                        // 尝试 Base64 解码
                        try {
                            const decoded = Buffer.from(signature, 'base64').toString('utf-8');
                            // 检查解码后是否是有效的 UTF-8 字符串
                            if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                                signature = decoded;
                            }
                        } catch (e) {
                            // 解码失败，保持原样
                        }
                        thinkingBlock.signature = signature;
                    }
                    content.push(thinkingBlock);
                } else {
                    // 普通文本
                    content.push({
                        type: 'text',
                        text: part.text
                    });
                }
            }

            if (part.inlineData) {
                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: part.inlineData.mimeType,
                        data: part.inlineData.data
                    }
                });
            }

            if (part.functionCall) {
                // [FIX] 规范化工具名称和参数映射
                const toolName = normalizeToolName(part.functionCall.name);
                const remappedArgs = remapFunctionCallArgs(toolName, part.functionCall.args || {});
                
                // [FIX] 使用 Gemini 提供的 id，如果没有则生成
                const toolUseBlock = {
                    type: 'tool_use',
                    id: part.functionCall.id || `${toolName}-${uuidv4().split('-')[0]}`,
                    name: toolName,
                    input: remappedArgs
                };
                // [FIX] 如果有签名，添加到 tool_use 块
                // [FIX] 同时检查 thoughtSignature 和 thought_signature
                const rawSignature = part.thoughtSignature || part.thought_signature;
                if (rawSignature) {
                    let signature = rawSignature;
                    try {
                        const decoded = Buffer.from(signature, 'base64').toString('utf-8');
                        if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                            signature = decoded;
                        }
                    } catch (e) {
                        // 解码失败，保持原样
                    }
                    toolUseBlock.signature = signature;
                }
                content.push(toolUseBlock);
            }

            if (part.functionResponse) {
                // [FIX] 正确处理 functionResponse
                let responseContent = part.functionResponse.response;
                // 如果 response 是对象且有 result 字段，提取它
                if (responseContent && typeof responseContent === 'object' && responseContent.result !== undefined) {
                    responseContent = responseContent.result;
                }
                content.push({
                    type: 'tool_result',
                    tool_use_id: part.functionResponse.name,
                    content: typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)
                });
            }
        });

        return content;
    }

    /**
     * 处理Gemini响应到Claude内容
     * @returns {{ content: Array, hasToolUse: boolean }}
     */
    processGeminiResponseToClaudeContent(geminiResponse) {
        if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
            return { content: [], hasToolUse: false };
        }

        const content = [];
        let hasToolUse = false;

        for (const candidate of geminiResponse.candidates) {
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                if (candidate.finishMessage) {
                    content.push({
                        type: 'text',
                        text: `Error: ${candidate.finishMessage}`
                    });
                }
                continue;
            }

            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    // 处理 thinking 块
                    if (part.text) {
                        if (part.thought === true) {
                            // 这是一个 thinking 块
                            const thinkingBlock = {
                                type: 'thinking',
                                thinking: part.text
                            };
                            // 处理签名
                            // [FIX] 同时检查 thoughtSignature 和 thought_signature
                            const rawSignature = part.thoughtSignature || part.thought_signature;
                            if (rawSignature) {
                                let signature = rawSignature;
                                try {
                                    const decoded = Buffer.from(signature, 'base64').toString('utf-8');
                                    if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                                        signature = decoded;
                                    }
                                } catch (e) {
                                    // 解码失败，保持原样
                                }
                                thinkingBlock.signature = signature;
                            }
                            content.push(thinkingBlock);
                        } else {
                            // 普通文本
                            content.push({
                                type: 'text',
                                text: part.text
                            });
                        }
                    } else if (part.inlineData) {
                        content.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: part.inlineData.mimeType,
                                data: part.inlineData.data
                            }
                        });
                    } else if (part.functionCall) {
                        hasToolUse = true;
                        // [FIX] 规范化工具名称和参数映射
                        const toolName = normalizeToolName(part.functionCall.name);
                        const remappedArgs = remapFunctionCallArgs(toolName, part.functionCall.args || {});
                        
                        // [FIX] 使用 Gemini 提供的 id
                        const toolUseBlock = {
                            type: 'tool_use',
                            id: part.functionCall.id || `${toolName}-${uuidv4().split('-')[0]}`,
                            name: toolName,
                            input: remappedArgs
                        };
                        // 添加签名（如果存在）
                        // [FIX] 同时检查 thoughtSignature 和 thought_signature
                        const rawSignature = part.thoughtSignature || part.thought_signature;
                        if (rawSignature) {
                            let signature = rawSignature;
                            try {
                                const decoded = Buffer.from(signature, 'base64').toString('utf-8');
                                if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                                    signature = decoded;
                                }
                            } catch (e) {
                                // 解码失败，保持原样
                            }
                            toolUseBlock.signature = signature;
                        }
                        content.push(toolUseBlock);
                    }
                }
            }
        }

        return { content, hasToolUse };
    }

    // =========================================================================
    // Gemini -> OpenAI Responses 转换
    // =========================================================================

    /**
     * Gemini请求 -> OpenAI Responses请求
     */
    toOpenAIResponsesRequest(geminiRequest) {
        const responsesRequest = {
            model: geminiRequest.model,
            instructions: '',
            input: [],
            stream: geminiRequest.stream || false,
            max_output_tokens: geminiRequest.generationConfig?.maxOutputTokens,
            temperature: geminiRequest.generationConfig?.temperature,
            top_p: geminiRequest.generationConfig?.topP
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && geminiRequest.systemInstruction.parts) {
            responsesRequest.instructions = geminiRequest.systemInstruction.parts
                .filter(p => p.text)
                .map(p => p.text)
                .join('\n');
        }

        // 处理内容
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            geminiRequest.contents.forEach(content => {
                const role = content.role === 'model' ? 'assistant' : 'user';
                const parts = content.parts || [];
                
                parts.forEach(part => {
                    if (part.text) {
                        responsesRequest.input.push({
                            type: 'message',
                            role: role,
                            content: [{
                                type: role === 'assistant' ? 'output_text' : 'input_text',
                                text: part.text
                            }]
                        });
                    }
                    
                    if (part.functionCall) {
                        responsesRequest.input.push({
                            type: 'function_call',
                            call_id: part.functionCall.id || `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
                            name: part.functionCall.name,
                            arguments: typeof part.functionCall.args === 'string' 
                                ? part.functionCall.args 
                                : JSON.stringify(part.functionCall.args)
                        });
                    }
                    
                    if (part.functionResponse) {
                        responsesRequest.input.push({
                            type: 'function_call_output',
                            call_id: part.functionResponse.name, // Gemini 通常使用 name 作为关联
                            output: typeof part.functionResponse.response?.result === 'string'
                                ? part.functionResponse.response.result
                                : JSON.stringify(part.functionResponse.response || {})
                        });
                    }

                    if (part.inlineData) {
                        responsesRequest.input.push({
                            type: 'message',
                            role: role,
                            content: [{
                                type: 'input_image',
                                image_url: {
                                    url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                                }
                            }]
                        });
                    }
                });
            });
        }

        // 处理工具
        if (geminiRequest.tools && geminiRequest.tools[0]?.functionDeclarations) {
            responsesRequest.tools = geminiRequest.tools[0].functionDeclarations.map(fn => ({
                type: 'function',
                name: fn.name,
                description: fn.description,
                parameters: fn.parameters || fn.parametersJsonSchema || { type: 'object', properties: {} }
            }));
        }

        return responsesRequest;
    }

    /**
     * Gemini响应 -> OpenAI Responses响应
     */
    toOpenAIResponsesResponse(geminiResponse, model) {
        const content = this.processGeminiResponseContent(geminiResponse);
        const textContent = typeof content === 'string' ? content : JSON.stringify(content);

        let output = [];
        output.push({
            id: `msg_${uuidv4().replace(/-/g, '')}`,
            summary: [],
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{
                annotations: [],
                logprobs: [],
                text: textContent,
                type: "output_text"
            }]
        });

        return {
            background: false,
            created_at: Math.floor(Date.now() / 1000),
            error: null,
            id: `resp_${uuidv4().replace(/-/g, '')}`,
            incomplete_details: null,
            max_output_tokens: null,
            max_tool_calls: null,
            metadata: {},
            model: model,
            object: "response",
            output: output,
            parallel_tool_calls: true,
            previous_response_id: null,
            prompt_cache_key: null,
            reasoning: {},
            safety_identifier: "user-" + uuidv4().replace(/-/g, ''),
            service_tier: "default",
            status: "completed",
            store: false,
            temperature: 1,
            text: {
                format: { type: "text" },
            },
            tool_choice: "auto",
            tools: [],
            top_logprobs: 0,
            top_p: 1,
            truncation: "disabled",
            usage: {
                input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
                input_tokens_details: {
                    cached_tokens: geminiResponse.usageMetadata?.cachedContentTokenCount || 0
                },
                output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
                output_tokens_details: {
                    reasoning_tokens: geminiResponse.usageMetadata?.thoughtsTokenCount || 0
                },
                total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0
            },
            user: null
        };
    }

    /**
     * Gemini流式响应 -> OpenAI Responses流式响应
     */
    toOpenAIResponsesStreamChunk(geminiChunk, model, requestId = null) {
        if (!geminiChunk) return [];

        const responseId = requestId || `resp_${uuidv4().replace(/-/g, '')}`;
        const events = [];

        // 处理完整的Gemini chunk对象
        if (typeof geminiChunk === 'object' && !Array.isArray(geminiChunk)) {
            const candidate = geminiChunk.candidates?.[0];
            
            if (candidate) {
                const parts = candidate.content?.parts;
                
                // 第一个chunk - 检测是否是开始（有role）
                if (candidate.content?.role === 'model' && parts && parts.length > 0) {
                    // 只在第一次有内容时发送开始事件
                    const hasContent = parts.some(part => part && typeof part.text === 'string' && part.text.length > 0);
                    if (hasContent) {
                        events.push(
                            generateResponseCreated(responseId, model || 'unknown'),
                            generateResponseInProgress(responseId),
                            generateOutputItemAdded(responseId),
                            generateContentPartAdded(responseId)
                        );
                    }
                }
                
                // 提取文本内容
                if (parts && Array.isArray(parts)) {
                    const textParts = parts.filter(part => part && typeof part.text === 'string');
                    if (textParts.length > 0) {
                        const text = textParts.map(part => part.text).join('');
                        events.push({
                            delta: text,
                            item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                            output_index: 0,
                            sequence_number: 3,
                            type: "response.output_text.delta"
                        });
                    }
                }
                
                // 处理finishReason
                if (candidate.finishReason) {
                    events.push(
                        generateOutputTextDone(responseId),
                        generateContentPartDone(responseId),
                        generateOutputItemDone(responseId),
                        generateResponseCompleted(responseId)
                    );
                    
                    // 如果有 usage 信息，更新最后一个事件
                    if (geminiChunk.usageMetadata && events.length > 0) {
                        const lastEvent = events[events.length - 1];
                        if (lastEvent.response) {
                            lastEvent.response.usage = {
                                input_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                                input_tokens_details: {
                                    cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0
                                },
                                output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                                output_tokens_details: {
                                    reasoning_tokens: geminiChunk.usageMetadata.thoughtsTokenCount || 0
                                },
                                total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0
                            };
                        }
                    }
                }
            }
        }

        // 向后兼容：处理字符串格式
        if (typeof geminiChunk === 'string') {
            events.push({
                delta: geminiChunk,
                item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                output_index: 0,
                sequence_number: 3,
                type: "response.output_text.delta"
            });
        }

        return events;
    }

    // =========================================================================
    // Gemini -> Codex 转换
    // =========================================================================

    /**
     * Gemini请求 -> Codex请求
     */
    toCodexRequest(geminiRequest) {
        // 使用 CodexConverter 进行转换，因为 CodexConverter.js 中已经实现了 OpenAI -> Codex 的逻辑
        // 我们需要先将 Gemini 转为 OpenAI 格式，再转为 Codex 格式
        const openaiRequest = this.toOpenAIRequest(geminiRequest);
        
        // 注意：这里我们直接在 GeminiConverter 中实现逻辑，避免循环依赖
        const codexRequest = {
            model: openaiRequest.model,
            instructions: '',
            input: [],
            stream: geminiRequest.stream || false,
            store: false,
            reasoning: {
                effort: 'medium',
                summary: 'auto'
            },
            parallel_tool_calls: true,
            include: ['reasoning.encrypted_content']
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && geminiRequest.systemInstruction.parts) {
            codexRequest.instructions = geminiRequest.systemInstruction.parts
                .filter(p => p.text)
                .map(p => p.text)
                .join('\n');
        }

        // 处理内容
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            const pendingCallIDs = [];
            
            geminiRequest.contents.forEach(content => {
                const role = content.role === 'model' ? 'assistant' : 'user';
                const parts = content.parts || [];
                
                parts.forEach(part => {
                    if (part.text) {
                        codexRequest.input.push({
                            type: 'message',
                            role: role,
                            content: [{
                                type: role === 'assistant' ? 'output_text' : 'input_text',
                                text: part.text
                            }]
                        });
                    }
                    
                    if (part.functionCall) {
                        const callId = `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
                        pendingCallIDs.push(callId);
                        codexRequest.input.push({
                            type: 'function_call',
                            call_id: callId,
                            name: part.functionCall.name,
                            arguments: typeof part.functionCall.args === 'string' 
                                ? part.functionCall.args 
                                : JSON.stringify(part.functionCall.args)
                        });
                    }
                    
                    if (part.functionResponse) {
                        const callId = pendingCallIDs.shift() || `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
                        codexRequest.input.push({
                            type: 'function_call_output',
                            call_id: callId,
                            output: typeof part.functionResponse.response?.result === 'string'
                                ? part.functionResponse.response.result
                                : JSON.stringify(part.functionResponse.response || {})
                        });
                    }
                });
            });
        }

        // 处理工具
        if (geminiRequest.tools && geminiRequest.tools[0]?.functionDeclarations) {
            codexRequest.tools = geminiRequest.tools[0].functionDeclarations.map(fn => ({
                type: 'function',
                name: fn.name,
                description: fn.description,
                parameters: fn.parameters || { type: 'object', properties: {} }
            }));
        }

        return codexRequest;
    }

    /**
     * Gemini响应 -> Codex响应 (实际上是 Codex 转 Gemini)
     */
    toCodexResponse(geminiResponse, model) {
        // 这里实际上是实现 Codex -> Gemini 的非流式转换
        // 为了保持接口一致，我们按照其他 Converter 的命名习惯
        const parts = [];
        if (geminiResponse.response?.output) {
            geminiResponse.response.output.forEach(item => {
                if (item.type === 'message' && item.content) {
                    const textPart = item.content.find(c => c.type === 'output_text');
                    if (textPart) parts.push({ text: textPart.text });
                } else if (item.type === 'reasoning' && item.summary) {
                    const textPart = item.summary.find(c => c.type === 'summary_text');
                    if (textPart) parts.push({ text: textPart.text, thought: true });
                } else if (item.type === 'function_call') {
                    parts.push({
                        functionCall: {
                            name: item.name,
                            args: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
                        }
                    });
                }
            });
        }

        return {
            candidates: [{
                content: {
                    role: 'model',
                    parts: parts
                },
                finishReason: 'STOP'
            }],
            usageMetadata: {
                promptTokenCount: geminiResponse.response?.usage?.input_tokens || 0,
                candidatesTokenCount: geminiResponse.response?.usage?.output_tokens || 0,
                totalTokenCount: geminiResponse.response?.usage?.total_tokens || 0
            },
            modelVersion: model,
            responseId: geminiResponse.response?.id
        };
    }

    /**
     * Gemini流式响应 -> Codex流式响应 (实际上是 Codex 转 Gemini)
     */
    toCodexStreamChunk(codexChunk, model) {
        const type = codexChunk.type;
        const resId = codexChunk.response?.id || 'default';
        
        const template = {
            candidates: [{
                content: {
                    role: "model",
                    parts: []
                }
            }],
            modelVersion: model,
            responseId: resId
        };

        if (type === 'response.reasoning_summary_text.delta') {
            template.candidates[0].content.parts.push({ text: codexChunk.delta, thought: true });
            return template;
        }

        if (type === 'response.output_text.delta') {
            template.candidates[0].content.parts.push({ text: codexChunk.delta });
            return template;
        }

        if (type === 'response.output_item.done' && codexChunk.item?.type === 'function_call') {
            template.candidates[0].content.parts.push({
                functionCall: {
                    name: codexChunk.item.name,
                    args: typeof codexChunk.item.arguments === 'string' ? JSON.parse(codexChunk.item.arguments) : codexChunk.item.arguments
                }
            });
            return template;
        }

        if (type === 'response.completed') {
            template.candidates[0].finishReason = "STOP";
            template.usageMetadata = {
                promptTokenCount: codexChunk.response.usage?.input_tokens || 0,
                candidatesTokenCount: codexChunk.response.usage?.output_tokens || 0,
                totalTokenCount: codexChunk.response.usage?.total_tokens || 0
            };
            return template;
        }

        return null;
    }
}

export default GeminiConverter;