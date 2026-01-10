/**
 * OpenAI Responses API 转换器
 * 处理 OpenAI Responses API 格式与其他协议之间的转换
 */

import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';
import {
    extractAndProcessSystemMessages as extractSystemMessages,
    extractTextFromMessageContent as extractText,
    CLAUDE_DEFAULT_MAX_TOKENS,
    GEMINI_DEFAULT_INPUT_TOKEN_LIMIT,
    GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT
} from '../utils.js';

/**
 * OpenAI Responses API 转换器类
 * 支持 OpenAI Responses 格式与 OpenAI、Claude、Gemini 之间的转换
 */
export class OpenAIResponsesConverter extends BaseConverter {
    constructor() {
        super(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);
    }

    // =============================================================================
    // 请求转换
    // =============================================================================

    /**
     * 转换请求到目标协议
     */
    convertRequest(data, toProtocol) {
        switch (toProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIRequest(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeRequest(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${toProtocol}`);
        }
    }

    /**
     * 转换响应到目标协议
     */
    convertResponse(data, toProtocol, model) {
        switch (toProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            default:
                throw new Error(`Unsupported target protocol: ${toProtocol}`);
        }
    }

    /**
     * 转换流式响应块到目标协议
     */
    convertStreamChunk(chunk, toProtocol, model) {
        switch (toProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model);
            default:
                throw new Error(`Unsupported target protocol: ${toProtocol}`);
        }
    }

    /**
     * 转换模型列表到目标协议
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeModelList(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiModelList(data);
            default:
                return data;
        }
    }

    // =============================================================================
    // 转换到 OpenAI 格式
    // =============================================================================

    /**
     * 将 OpenAI Responses 请求转换为标准 OpenAI 请求
     */
    toOpenAIRequest(responsesRequest) {
        const openaiRequest = {
            model: responsesRequest.model,
            messages: [],
            stream: responsesRequest.stream || false
        };

        // OpenAI Responses API 使用 instructions 和 input 字段
        // 需要转换为标准的 messages 格式
        if (responsesRequest.instructions) {
            // instructions 作为系统消息
            openaiRequest.messages.push({
                role: 'system',
                content: responsesRequest.instructions
            });
        }

        // input 包含用户消息和历史对话
        if (responsesRequest.input && Array.isArray(responsesRequest.input)) {
            responsesRequest.input.forEach(item => {
                if (item.type === 'message') {
                    // 提取消息内容
                    const content = item.content
                        .filter(c => c.type === 'input_text')
                        .map(c => c.text)
                        .join('\n');
                    
                    if (content) {
                        openaiRequest.messages.push({
                            role: item.role,
                            content: content
                        });
                    }
                }
            });
        }

        // 如果有标准的 messages 字段，也支持
        if (responsesRequest.messages && Array.isArray(responsesRequest.messages)) {
            responsesRequest.messages.forEach(msg => {
                openaiRequest.messages.push({
                    role: msg.role,
                    content: msg.content
                });
            });
        }

        // 复制其他参数
        if (responsesRequest.temperature !== undefined) {
            openaiRequest.temperature = responsesRequest.temperature;
        }
        if (responsesRequest.max_tokens !== undefined) {
            openaiRequest.max_tokens = responsesRequest.max_tokens;
        }
        if (responsesRequest.top_p !== undefined) {
            openaiRequest.top_p = responsesRequest.top_p;
        }

        return openaiRequest;
    }

    /**
     * 将 OpenAI Responses 响应转换为标准 OpenAI 响应
     */
    toOpenAIResponse(responsesResponse, model) {
        // OpenAI Responses 格式已经很接近标准 OpenAI 格式
        return {
            id: responsesResponse.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: responsesResponse.created || Math.floor(Date.now() / 1000),
            model: model || responsesResponse.model,
            choices: responsesResponse.choices || [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: responsesResponse.content || ''
                },
                finish_reason: responsesResponse.finish_reason || 'stop'
            }],
            usage: responsesResponse.usage ? {
                prompt_tokens: responsesResponse.usage.input_tokens || 0,
                completion_tokens: responsesResponse.usage.output_tokens || 0,
                total_tokens: responsesResponse.usage.total_tokens || 0,
                prompt_tokens_details: {
                    cached_tokens: responsesResponse.usage.input_tokens_details?.cached_tokens || 0
                },
                completion_tokens_details: {
                    reasoning_tokens: responsesResponse.usage.output_tokens_details?.reasoning_tokens || 0
                }
            } : {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                prompt_tokens_details: {
                    cached_tokens: 0
                },
                completion_tokens_details: {
                    reasoning_tokens: 0
                }
            }
        };
    }

    /**
     * 将 OpenAI Responses 流式块转换为标准 OpenAI 流式块
     */
    toOpenAIStreamChunk(responsesChunk, model) {
        return {
            id: responsesChunk.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: responsesChunk.created || Math.floor(Date.now() / 1000),
            model: model || responsesChunk.model,
            choices: responsesChunk.choices || [{
                index: 0,
                delta: {
                    content: responsesChunk.delta?.content || ''
                },
                finish_reason: responsesChunk.finish_reason || null
            }]
        };
    }

    // =============================================================================
    // 转换到 Claude 格式
    // =============================================================================

    /**
     * 将 OpenAI Responses 请求转换为 Claude 请求
     */
    toClaudeRequest(responsesRequest) {
        const claudeRequest = {
            model: responsesRequest.model,
            messages: [],
            max_tokens: responsesRequest.max_tokens || CLAUDE_DEFAULT_MAX_TOKENS,
            stream: responsesRequest.stream || false
        };

        // 处理 instructions 作为系统消息
        if (responsesRequest.instructions) {
            claudeRequest.system = responsesRequest.instructions;
        }

        // 处理 input 数组中的消息
        if (responsesRequest.input && Array.isArray(responsesRequest.input)) {
            responsesRequest.input.forEach(item => {
                if (item.type === 'message') {
                    const content = item.content
                        .filter(c => c.type === 'input_text')
                        .map(c => c.text)
                        .join('\n');
                    
                    if (content) {
                        claudeRequest.messages.push({
                            role: item.role === 'assistant' ? 'assistant' : 'user',
                            content: content
                        });
                    }
                }
            });
        }

        // 如果有标准的 messages 字段，也支持
        if (responsesRequest.messages && Array.isArray(responsesRequest.messages)) {
            const { systemMessages, otherMessages } = extractSystemMessages(
                responsesRequest.messages
            );
            
            if (!claudeRequest.system && systemMessages.length > 0) {
                const systemTexts = systemMessages.map(msg => extractText(msg.content));
                claudeRequest.system = systemTexts.join('\n');
            }

            otherMessages.forEach(msg => {
                claudeRequest.messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: typeof msg.content === 'string' ? msg.content : extractText(msg.content)
                });
            });
        }

        // 复制其他参数
        if (responsesRequest.temperature !== undefined) {
            claudeRequest.temperature = responsesRequest.temperature;
        }
        if (responsesRequest.top_p !== undefined) {
            claudeRequest.top_p = responsesRequest.top_p;
        }

        return claudeRequest;
    }

    /**
     * 将 OpenAI Responses 响应转换为 Claude 响应
     */
    toClaudeResponse(responsesResponse, model) {
        const content = responsesResponse.choices?.[0]?.message?.content || 
                       responsesResponse.content || '';

        return {
            id: responsesResponse.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{
                type: 'text',
                text: content
            }],
            model: model || responsesResponse.model,
            stop_reason: responsesResponse.choices?.[0]?.finish_reason || 'end_turn',
            usage: {
                input_tokens: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: responsesResponse.usage?.input_tokens_details?.cached_tokens || 0,
                output_tokens: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0,
                prompt_tokens: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0,
                completion_tokens: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0,
                total_tokens: responsesResponse.usage?.total_tokens ||
                    ((responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0) +
                     (responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0)),
                cached_tokens: responsesResponse.usage?.input_tokens_details?.cached_tokens || 0
            }
        };
    }

    /**
     * 将 OpenAI Responses 流式块转换为 Claude 流式块
     */
    toClaudeStreamChunk(responsesChunk, model) {
        const delta = responsesChunk.choices?.[0]?.delta || responsesChunk.delta || {};
        const finishReason = responsesChunk.choices?.[0]?.finish_reason || 
                           responsesChunk.finish_reason;

        if (finishReason) {
            return {
                type: 'message_stop'
            };
        }

        if (delta.content) {
            return {
                type: 'content_block_delta',
                index: 0,
                delta: {
                    type: 'text_delta',
                    text: delta.content
                }
            };
        }

        return {
            type: 'message_start',
            message: {
                id: responsesChunk.id || `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model: model || responsesChunk.model
            }
        };
    }

    // =============================================================================
    // 转换到 Gemini 格式
    // =============================================================================

    /**
     * 将 OpenAI Responses 请求转换为 Gemini 请求
     */
    toGeminiRequest(responsesRequest) {
        const geminiRequest = {
            contents: [],
            generationConfig: {}
        };

        // 处理 instructions 作为系统指令
        if (responsesRequest.instructions) {
            geminiRequest.systemInstruction = {
                parts: [{
                    text: responsesRequest.instructions
                }]
            };
        }

        // 处理 input 数组中的消息
        if (responsesRequest.input && Array.isArray(responsesRequest.input)) {
            responsesRequest.input.forEach(item => {
                // 如果 item 没有 type 属性，默认为 message
                // 或者 item.type 明确为 message
                if (!item.type || item.type === 'message') {
                    let content = '';
                    if (Array.isArray(item.content)) {
                        content = item.content
                            .filter(c => c.type === 'input_text')
                            .map(c => c.text)
                            .join('\n');
                    } else if (typeof item.content === 'string') {
                        content = item.content;
                    }
                    
                    if (content) {
                        geminiRequest.contents.push({
                            role: item.role === 'assistant' ? 'model' : 'user',
                            parts: [{
                                text: content
                            }]
                        });
                    }
                }
            });
        }

        // 如果有标准的 messages 字段，也支持
        if (responsesRequest.messages && Array.isArray(responsesRequest.messages)) {
            const { systemMessages, otherMessages } = extractSystemMessages(
                responsesRequest.messages
            );

            if (!geminiRequest.systemInstruction && systemMessages.length > 0) {
                const systemTexts = systemMessages.map(msg => extractText(msg.content));
                geminiRequest.systemInstruction = {
                    parts: [{
                        text: systemTexts.join('\n')
                    }]
                };
            }

            otherMessages.forEach(msg => {
                geminiRequest.contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{
                        text: typeof msg.content === 'string' ? msg.content : extractText(msg.content)
                    }]
                });
            });
        }

        // 设置生成配置
        if (responsesRequest.temperature !== undefined) {
            geminiRequest.generationConfig.temperature = responsesRequest.temperature;
        }
        if (responsesRequest.max_tokens !== undefined) {
            geminiRequest.generationConfig.maxOutputTokens = responsesRequest.max_tokens;
        }
        if (responsesRequest.top_p !== undefined) {
            geminiRequest.generationConfig.topP = responsesRequest.top_p;
        }

        return geminiRequest;
    }

    /**
     * 将 OpenAI Responses 响应转换为 Gemini 响应
     */
    toGeminiResponse(responsesResponse, model) {
        const content = responsesResponse.choices?.[0]?.message?.content || 
                       responsesResponse.content || '';

        return {
            candidates: [{
                content: {
                    parts: [{
                        text: content
                    }],
                    role: 'model'
                },
                finishReason: this.mapFinishReason(
                    responsesResponse.choices?.[0]?.finish_reason || 'STOP'
                ),
                index: 0
            }],
            usageMetadata: {
                promptTokenCount: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0,
                candidatesTokenCount: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0,
                totalTokenCount: responsesResponse.usage?.total_tokens ||
                    ((responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0) +
                     (responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0)),
                cachedContentTokenCount: responsesResponse.usage?.input_tokens_details?.cached_tokens || 0,
                promptTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: responsesResponse.usage?.input_tokens || responsesResponse.usage?.prompt_tokens || 0
                }],
                candidatesTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: responsesResponse.usage?.output_tokens || responsesResponse.usage?.completion_tokens || 0
                }],
                thoughtsTokenCount: responsesResponse.usage?.output_tokens_details?.reasoning_tokens || 0
            }
        };
    }

    /**
     * 将 OpenAI Responses 流式块转换为 Gemini 流式块
     */
    toGeminiStreamChunk(responsesChunk, model) {
        const delta = responsesChunk.choices?.[0]?.delta || responsesChunk.delta || {};
        const finishReason = responsesChunk.choices?.[0]?.finish_reason || 
                           responsesChunk.finish_reason;

        return {
            candidates: [{
                content: {
                    parts: delta.content ? [{
                        text: delta.content
                    }] : [],
                    role: 'model'
                },
                finishReason: finishReason ? this.mapFinishReason(finishReason) : null,
                index: 0
            }]
        };
    }

    // =============================================================================
    // 辅助方法
    // =============================================================================

    /**
     * 映射完成原因
     */
    mapFinishReason(reason) {
        const reasonMap = {
            'stop': 'STOP',
            'length': 'MAX_TOKENS',
            'content_filter': 'SAFETY',
            'end_turn': 'STOP'
        };
        return reasonMap[reason] || 'STOP';
    }

    /**
     * 将 OpenAI Responses 模型列表转换为标准 OpenAI 模型列表
     */
    toOpenAIModelList(responsesModels) {
        // OpenAI Responses 格式的模型列表已经是标准 OpenAI 格式
        // 如果输入已经是标准格式,直接返回
        if (responsesModels.object === 'list' && responsesModels.data) {
            return responsesModels;
        }

        // 如果是其他格式,转换为标准格式
        return {
            object: "list",
            data: (responsesModels.models || responsesModels.data || []).map(m => ({
                id: m.id || m.name,
                object: "model",
                created: m.created || Math.floor(Date.now() / 1000),
                owned_by: m.owned_by || "openai",
            })),
        };
    }

    /**
     * 将 OpenAI Responses 模型列表转换为 Claude 模型列表
     */
    toClaudeModelList(responsesModels) {
        const models = responsesModels.data || responsesModels.models || [];
        return {
            models: models.map(m => ({
                name: m.id || m.name,
                description: m.description || "",
            })),
        };
    }

    /**
     * 将 OpenAI Responses 模型列表转换为 Gemini 模型列表
     */
    toGeminiModelList(responsesModels) {
        const models = responsesModels.data || responsesModels.models || [];
        return {
            models: models.map(m => ({
                name: `models/${m.id || m.name}`,
                version: m.version || "1.0.0",
                displayName: m.displayName || m.id || m.name,
                description: m.description || `A generative model for text and chat generation. ID: ${m.id || m.name}`,
                inputTokenLimit: m.inputTokenLimit || GEMINI_DEFAULT_INPUT_TOKEN_LIMIT,
                outputTokenLimit: m.outputTokenLimit || GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT,
                supportedGenerationMethods: m.supportedGenerationMethods || ["generateContent", "streamGenerateContent"]
            }))
        };
    }

}

