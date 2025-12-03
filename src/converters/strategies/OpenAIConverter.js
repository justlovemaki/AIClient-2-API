/**
 * OpenAI转换器
 * 处理OpenAI协议与其他协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConverter } from '../BaseConverter.js';
import {
    extractAndProcessSystemMessages as extractSystemMessages,
    extractTextFromMessageContent as extractText,
    safeParseJSON,
    checkAndAssignOrDefault,
    extractThinkingFromOpenAIText,
    mapFinishReason,
    cleanJsonSchemaProperties as cleanJsonSchema
} from '../utils.js';
import { MODEL_PROTOCOL_PREFIX } from '../../common.js';
import {
    generateResponseCreated,
    generateResponseInProgress,
    generateOutputItemAdded,
    generateContentPartAdded,
    generateOutputTextDone,
    generateContentPartDone,
    generateOutputItemDone,
    generateResponseCompleted
} from '../../openai/openai-responses-core.mjs';

/**
 * OpenAI转换器类
 * 实现OpenAI协议到其他协议的转换
 */
export class OpenAIConverter extends BaseConverter {
    constructor() {
        super('openai');
    }

    /**
     * 转换请求
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeRequest(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiRequest(data);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换响应
     */
    convertResponse(data, targetProtocol, model) {
        // OpenAI作为源格式时，通常不需要转换响应
        // 因为其他协议会转换到OpenAI格式
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换模型列表
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeModelList(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiModelList(data);
            default:
                return data;
        }
    }

    // =========================================================================
    // OpenAI -> Claude 转换
    // =========================================================================

    /**
     * OpenAI请求 -> Claude请求
     */
    toClaudeRequest(openaiRequest) {
        const messages = openaiRequest.messages || [];
        const { systemInstruction, nonSystemMessages } = extractSystemMessages(messages);

        const claudeMessages = [];

        for (const message of nonSystemMessages) {
            const role = message.role === 'assistant' ? 'assistant' : 'user';
            let content = [];

            if (message.role === 'tool') {
                // 工具结果消息
                content.push({
                    type: 'tool_result',
                    tool_use_id: message.tool_call_id,
                    content: safeParseJSON(message.content)
                });
                claudeMessages.push({ role: 'user', content: content });
            } else if (message.role === 'assistant' && (message.tool_calls?.length || message.function_calls?.length)) {
                // 助手工具调用消息 - 支持tool_calls和function_calls
                const calls = message.tool_calls || message.function_calls || [];
                const toolUseBlocks = calls.map(tc => ({
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.function.name,
                    input: safeParseJSON(tc.function.arguments)
                }));
                claudeMessages.push({ role: 'assistant', content: toolUseBlocks });
            } else {
                // 普通消息
                if (typeof message.content === 'string') {
                    if (message.content) {
                        content.push({ type: 'text', text: message.content.trim() });
                    }
                } else if (Array.isArray(message.content)) {
                    message.content.forEach(item => {
                        if (!item) return;
                        switch (item.type) {
                            case 'text':
                                if (item.text) {
                                    content.push({ type: 'text', text: item.text.trim() });
                                }
                                break;
                            case 'image_url':
                                if (item.image_url) {
                                    const imageUrl = typeof item.image_url === 'string'
                                        ? item.image_url
                                        : item.image_url.url;
                                    if (imageUrl.startsWith('data:')) {
                                        const [header, data] = imageUrl.split(',');
                                        const mediaType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                                        content.push({
                                            type: 'image',
                                            source: {
                                                type: 'base64',
                                                media_type: mediaType,
                                                data: data
                                            }
                                        });
                                    } else {
                                        content.push({ type: 'text', text: `[Image: ${imageUrl}]` });
                                    }
                                }
                                break;
                            case 'audio':
                                if (item.audio_url) {
                                    const audioUrl = typeof item.audio_url === 'string'
                                        ? item.audio_url
                                        : item.audio_url.url;
                                    content.push({ type: 'text', text: `[Audio: ${audioUrl}]` });
                                }
                                break;
                        }
                    });
                }
                if (content.length > 0) {
                    claudeMessages.push({ role: role, content: content });
                }
            }
        }
        // 合并相邻相同 role 的消息
        const mergedClaudeMessages = [];
        for (let i = 0; i < claudeMessages.length; i++) {
            const currentMessage = claudeMessages[i];
            
            if (mergedClaudeMessages.length === 0) {
                mergedClaudeMessages.push(currentMessage);
            } else {
                const lastMessage = mergedClaudeMessages[mergedClaudeMessages.length - 1];
                
                // 如果当前消息的 role 与上一条消息的 role 相同，则合并 content 数组
                if (lastMessage.role === currentMessage.role) {
                    lastMessage.content = lastMessage.content.concat(currentMessage.content);
                } else {
                    mergedClaudeMessages.push(currentMessage);
                }
            }
        }

        // 清理最后一条 assistant 消息的尾部空白
        if (mergedClaudeMessages.length > 0) {
            const lastMessage = mergedClaudeMessages[mergedClaudeMessages.length - 1];
            if (lastMessage.role === 'assistant' && Array.isArray(lastMessage.content)) {
                // 从后往前找到最后一个 text 类型的内容块
                for (let i = lastMessage.content.length - 1; i >= 0; i--) {
                    const contentBlock = lastMessage.content[i];
                    if (contentBlock.type === 'text' && contentBlock.text) {
                        // 移除尾部空白字符
                        contentBlock.text = contentBlock.text.trimEnd();
                        break;
                    }
                }
            }
        }


        const claudeRequest = {
            model: openaiRequest.model,
            messages: mergedClaudeMessages,
            max_tokens: checkAndAssignOrDefault(openaiRequest.max_tokens, 8192),
            temperature: checkAndAssignOrDefault(openaiRequest.temperature, 1),
            top_p: checkAndAssignOrDefault(openaiRequest.top_p, 0.95),
        };

        if (systemInstruction) {
            claudeRequest.system = extractText(systemInstruction.parts[0].text);
        }

        if (openaiRequest.tools?.length) {
            claudeRequest.tools = openaiRequest.tools.map(t => ({
                name: t.function.name,
                description: t.function.description || '',
                input_schema: t.function.parameters || { type: 'object', properties: {} }
            }));
            claudeRequest.tool_choice = this.buildClaudeToolChoice(openaiRequest.tool_choice);
        }

        return claudeRequest;
    }

    /**
     * OpenAI响应 -> Claude响应
     */
    toClaudeResponse(openaiResponse, model) {
        if (!openaiResponse || !openaiResponse.choices || openaiResponse.choices.length === 0) {
            return {
                id: `msg_${uuidv4()}`,
                type: "message",
                role: "assistant",
                content: [],
                model: model,
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: {
                    input_tokens: openaiResponse?.usage?.prompt_tokens || 0,
                    output_tokens: openaiResponse?.usage?.completion_tokens || 0
                }
            };
        }

        const choice = openaiResponse.choices[0];
        const contentList = [];

        // 处理工具调用 - 支持tool_calls和function_calls
        const toolCalls = choice.message?.tool_calls || choice.message?.function_calls || [];
        for (const toolCall of toolCalls.filter(tc => tc && typeof tc === 'object')) {
            if (toolCall.function) {
                const func = toolCall.function;
                const argStr = func.arguments || "{}";
                let argObj;
                try {
                    argObj = typeof argStr === 'string' ? JSON.parse(argStr) : argStr;
                } catch (e) {
                    argObj = {};
                }
                contentList.push({
                    type: "tool_use",
                    id: toolCall.id || "",
                    name: func.name || "",
                    input: argObj,
                });
            }
        }

        // 处理reasoning_content（推理内容）
        const reasoningContent = choice.message?.reasoning_content || "";
        if (reasoningContent) {
            contentList.push({
                type: "thinking",
                thinking: reasoningContent
            });
        }

        // 处理文本内容
        const contentText = choice.message?.content || "";
        if (contentText) {
            const extractedContent = extractThinkingFromOpenAIText(contentText);
            if (Array.isArray(extractedContent)) {
                contentList.push(...extractedContent);
            } else {
                contentList.push({ type: "text", text: extractedContent });
            }
        }

        // 映射结束原因
        const stopReason = mapFinishReason(
            choice.finish_reason || "stop",
            "openai",
            "anthropic"
        );

        return {
            id: `msg_${uuidv4()}`,
            type: "message",
            role: "assistant",
            content: contentList,
            model: model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: openaiResponse.usage?.prompt_tokens || 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: openaiResponse.usage?.prompt_tokens_details?.cached_tokens || 0,
                output_tokens: openaiResponse.usage?.completion_tokens || 0
            }
        };
    }

    /**
     * OpenAI流式响应 -> Claude流式响应
     *
     * 这个方法实现了与 ClaudeConverter.toOpenAIStreamChunk 相反的转换逻辑
     * 将 OpenAI 的流式 chunk 转换为 Claude 的流式事件
     */
    toClaudeStreamChunk(openaiChunk, model) {
        if (!openaiChunk) return null;

        // 处理 OpenAI chunk 对象
        if (typeof openaiChunk === 'object' && !Array.isArray(openaiChunk)) {
            const choice = openaiChunk.choices?.[0];
            if (!choice){
                return null;
            }

            const delta = choice.delta;
            const finishReason = choice.finish_reason;
            const events = [];

            // 注释部分是为了兼容claude code，但是不兼容cherry studio
            // 1. 处理 role (对应 message_start) 
            // if (delta?.role === "assistant") {
            //     events.push({
            //         type: "message_start",
            //         message: {
            //             id: openaiChunk.id || `msg_${uuidv4()}`,
            //             type: "message",
            //             role: "assistant",
            //             content: [],
            //             model: model || openaiChunk.model || "unknown",
            //             stop_reason: null,
            //             stop_sequence: null,
            //             usage: {
            //                 input_tokens: openaiChunk.usage?.prompt_tokens || 0,
            //                 output_tokens: 0
            //             }
            //         }
            //     });
            //     events.push({
            //         type: "content_block_start",
            //         index: 0,
            //         content_block: {
            //             type: "text",
            //             text: ""
            //         }
            //     });
            // }

            // 2. 处理 tool_calls (对应 content_block_start 和 content_block_delta)
            // if (delta?.tool_calls) {
            //     const toolCalls = delta.tool_calls;
            //     for (const toolCall of toolCalls) {
            //         // 如果有 function.name，说明是工具调用开始
            //         if (toolCall.function?.name) {
            //             events.push({
            //                 type: "content_block_start",
            //                 index: toolCall.index || 0,
            //                 content_block: {
            //                     type: "tool_use",
            //                     id: toolCall.id || `tool_${uuidv4()}`,
            //                     name: toolCall.function.name,
            //                     input: {}
            //                 }
            //             });
            //         }
                    
            //         // 如果有 function.arguments，说明是参数增量
            //         if (toolCall.function?.arguments) {
            //             events.push({
            //                 type: "content_block_delta",
            //                 index: toolCall.index || 0,
            //                 delta: {
            //                     type: "input_json_delta",
            //                     partial_json: toolCall.function.arguments
            //                 }
            //             });
            //         }
            //     }
            // }

            // 3. 处理 reasoning_content (对应 thinking 类型的 content_block)
            if (delta?.reasoning_content) {
                // 注意：这里可能需要先发送 content_block_start，但由于状态管理复杂，
                // 我们假设调用方会处理这个逻辑
                events.push({
                    type: "content_block_delta",
                    index: 0,
                    delta: {
                        type: "thinking_delta",
                        thinking: delta.reasoning_content
                    }
                });
            }

            // 4. 处理普通文本 content (对应 text 类型的 content_block)
            if (delta?.content) {
                events.push({
                    type: "content_block_delta",
                    index: 0,
                    delta: {
                        type: "text_delta",
                        text: delta.content
                    }
                });
            }

            // 5. 处理 finish_reason (对应 message_delta 和 message_stop)
            if (finishReason) {
                // 映射 finish_reason
                const stopReason = finishReason === "stop" ? "end_turn" :
                                 finishReason === "length" ? "max_tokens" :
                                 "end_turn";

                events.push({
                    type: "content_block_stop",
                    index: 0
                });
                // 发送 message_delta
                events.push({
                    type: "message_delta",
                    delta: {
                        stop_reason: stopReason,
                        stop_sequence: null
                    },
                    usage: {
                        input_tokens: openaiChunk.usage?.prompt_tokens || 0,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: openaiChunk.usage?.prompt_tokens_details?.cached_tokens || 0,
                        output_tokens: openaiChunk.usage?.completion_tokens || 0
                    }
                });

                // 发送 message_stop
                events.push({
                    type: "message_stop"
                });
            }

            return events.length > 0 ? events : null;
        }

        // 向后兼容：处理字符串格式
        if (typeof openaiChunk === 'string') {
            return {
                type: "content_block_delta",
                index: 0,
                delta: {
                    type: "text_delta",
                    text: openaiChunk
                }
            };
        }

        return null;
    }

    /**
     * OpenAI模型列表 -> Claude模型列表
     */
    toClaudeModelList(openaiModels) {
        return {
            models: openaiModels.data.map(m => ({
                name: m.id,
                description: "",
            })),
        };
    }

    /**
     * 将 OpenAI 模型列表转换为 Gemini 模型列表
     */
    toGeminiModelList(openaiModels) {
        const models = openaiModels.data || [];
        return {
            models: models.map(m => ({
                name: `models/${m.id}`,
                version: m.version || "1.0.0",
                displayName: m.displayName || m.id,
                description: m.description || `A generative model for text and chat generation. ID: ${m.id}`,
                inputTokenLimit: m.inputTokenLimit || 32768,
                outputTokenLimit: m.outputTokenLimit || 8192,
                supportedGenerationMethods: m.supportedGenerationMethods || ["generateContent", "streamGenerateContent"]
            }))
        };
    }

    /**
     * 构建Claude工具选择
     */
    buildClaudeToolChoice(toolChoice) {
        if (typeof toolChoice === 'string') {
            const mapping = { auto: 'auto', none: 'none', required: 'any' };
            return { type: mapping[toolChoice] };
        }
        if (typeof toolChoice === 'object' && toolChoice.function) {
            return { type: 'tool', name: toolChoice.function.name };
        }
        return undefined;
    }

    // =========================================================================
    // OpenAI -> Gemini 转换
    // =========================================================================

    /**
     * OpenAI请求 -> Gemini请求
     */
    toGeminiRequest(openaiRequest) {
        const messages = openaiRequest.messages || [];
        const { systemInstruction, nonSystemMessages } = extractSystemMessages(messages);
        
        const processedMessages = [];
        let lastMessage = null;
        
        for (const message of nonSystemMessages) {
            const geminiRole = message.role === 'assistant' ? 'model' : message.role;
            
            if (geminiRole === 'tool') {
                // Save previous model response with functionCall
                if (lastMessage) {
                    processedMessages.push(lastMessage);
                    lastMessage = null;
                }
                
                // Get function name from message.name or via tool_call_id
                let functionName = message.name;
                if (!functionName && message.tool_call_id) {
                    const currentIndex = nonSystemMessages.indexOf(message);
                    for (let i = currentIndex - 1; i >= 0; i--) {
                        const prevMsg = nonSystemMessages[i];
                        if (prevMsg.role === 'assistant' && prevMsg.tool_calls) {
                            const toolCall = prevMsg.tool_calls.find(tc => tc.id === message.tool_call_id);
                            if (toolCall?.function?.name) {
                                functionName = toolCall.function.name;
                                break;
                            }
                        }
                    }
                }
                
                // Build functionResponse according to Gemini API spec
                const parsedContent = safeParseJSON(message.content);
                const contentStr = typeof parsedContent === 'string' ? parsedContent : JSON.stringify(parsedContent);
                
                processedMessages.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: functionName || 'unknown',
                            response: {
                                name: functionName || 'unknown',
                                content: contentStr
                            }
                        }
                    }]
                });
                lastMessage = null;
                continue;
            }
            
            let processedContent = this.processOpenAIContentToGeminiParts(message.content);
            
            // Add tool_calls as functionCall to parts
            if (message.tool_calls && Array.isArray(message.tool_calls)) {
                for (const toolCall of message.tool_calls) {
                    if (toolCall.function) {
                        processedContent.push({
                            functionCall: {
                                name: toolCall.function.name,
                                args: safeParseJSON(toolCall.function.arguments)
                            }
                        });
                    }
                }
            }
            
            if (lastMessage && lastMessage.role === geminiRole && !message.tool_calls &&
                Array.isArray(processedContent) && processedContent.every(p => p.text) &&
                Array.isArray(lastMessage.parts) && lastMessage.parts.every(p => p.text)) {
                lastMessage.parts.push(...processedContent);
                continue;
            }
            
            if (lastMessage) processedMessages.push(lastMessage);
            lastMessage = { role: geminiRole, parts: processedContent };
        }
        if (lastMessage) processedMessages.push(lastMessage);
        
        const geminiRequest = {
            contents: processedMessages.filter(item => item.parts && item.parts.length > 0)
        };
        
        if (systemInstruction) geminiRequest.systemInstruction = systemInstruction;
        
        if (openaiRequest.tools?.length) {
            geminiRequest.tools = [{
                functionDeclarations: openaiRequest.tools.map(t => {
                    if (!t || typeof t !== 'object' || !t.function) return null;
                    const func = t.function;
                    const parameters = cleanJsonSchema(func.parameters || {});
                    return {
                        name: String(func.name || ''),
                        description: String(func.description || ''),
                        parameters: parameters
                    };
                }).filter(Boolean)
            }];
            if (geminiRequest.tools[0].functionDeclarations.length === 0) {
                delete geminiRequest.tools;
            }
        }
        
        if (openaiRequest.tool_choice) {
            geminiRequest.toolConfig = this.buildGeminiToolConfig(openaiRequest.tool_choice);
        }
        
        const config = this.buildGeminiGenerationConfig(openaiRequest, openaiRequest.model);
        if (Object.keys(config).length) geminiRequest.generationConfig = config;
        
        return geminiRequest;
    }

    /**
     * 处理OpenAI内容到Gemini parts
     */
    processOpenAIContentToGeminiParts(content) {
        if (!content) return [];
        if (typeof content === 'string') return [{ text: content }];
        
        if (Array.isArray(content)) {
            const parts = [];
            
            for (const item of content) {
                if (!item) continue;
                
                if (item.type === 'text' && item.text) {
                    parts.push({ text: item.text });
                } else if (item.type === 'image_url' && item.image_url) {
                    const imageUrl = typeof item.image_url === 'string'
                        ? item.image_url
                        : item.image_url.url;
                        
                    if (imageUrl.startsWith('data:')) {
                        const [header, data] = imageUrl.split(',');
                        const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                        parts.push({ inlineData: { mimeType, data } });
                    } else {
                        parts.push({
                            fileData: { mimeType: 'image/jpeg', fileUri: imageUrl }
                        });
                    }
                }
            }
            
            return parts;
        }
        
        return [];
    }

    /**
     * 构建Gemini工具配置
     */
    buildGeminiToolConfig(toolChoice) {
        if (typeof toolChoice === 'string' && ['none', 'auto'].includes(toolChoice)) {
            return { functionCallingConfig: { mode: toolChoice.toUpperCase() } };
        }
        if (typeof toolChoice === 'object' && toolChoice.function) {
            return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.function.name] } };
        }
        return null;
    }

    /**
     * 构建Gemini生成配置
     */
    buildGeminiGenerationConfig({ temperature, max_tokens, top_p, stop, tools }, model) {
        const config = {};
        config.temperature = checkAndAssignOrDefault(temperature, 1);
        config.maxOutputTokens = checkAndAssignOrDefault(max_tokens, 65535);
        config.topP = checkAndAssignOrDefault(top_p, 0.95);
        if (stop !== undefined) config.stopSequences = Array.isArray(stop) ? stop : [stop];
        
        // Gemini 2.5 and thinking models require responseModalities: ["TEXT"]
        // But this parameter cannot be added when using tools (causes 400 error)
        const hasTools = tools && Array.isArray(tools) && tools.length > 0;
        if (!hasTools && model && (model.includes('2.5') || model.includes('thinking') || model.includes('2.0-flash-thinking'))) {
            console.log(`[OpenAI->Gemini] Adding responseModalities: ["TEXT"] for model: ${model}`);
            config.responseModalities = ["TEXT"];
        } else if (hasTools && model && (model.includes('2.5') || model.includes('thinking') || model.includes('2.0-flash-thinking'))) {
            console.log(`[OpenAI->Gemini] Skipping responseModalities for model ${model} because tools are present`);
        }
        
        return config;
    }
    /**
     * 将OpenAI响应转换为Gemini响应格式
     */
    toGeminiResponse(openaiResponse, model) {
        if (!openaiResponse || !openaiResponse.choices || !openaiResponse.choices[0]) {
            return { candidates: [], usageMetadata: {} };
        }

        const choice = openaiResponse.choices[0];
        const message = choice.message || {};
        const parts = [];

        // 处理文本内容
        if (message.content) {
            parts.push({ text: message.content });
        }

        // 处理工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
                if (toolCall.type === 'function') {
                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args: typeof toolCall.function.arguments === 'string'
                                ? JSON.parse(toolCall.function.arguments)
                                : toolCall.function.arguments
                        }
                    });
                }
            }
        }

        // 映射finish_reason
        const finishReasonMap = {
            'stop': 'STOP',
            'length': 'MAX_TOKENS',
            'tool_calls': 'STOP',
            'content_filter': 'SAFETY'
        };

        return {
            candidates: [{
                content: {
                    role: 'model',
                    parts: parts
                },
                finishReason: finishReasonMap[choice.finish_reason] || 'STOP'
            }],
            usageMetadata: openaiResponse.usage ? {
                promptTokenCount: openaiResponse.usage.prompt_tokens || 0,
                candidatesTokenCount: openaiResponse.usage.completion_tokens || 0,
                totalTokenCount: openaiResponse.usage.total_tokens || 0,
                cachedContentTokenCount: openaiResponse.usage.prompt_tokens_details?.cached_tokens || 0,
                promptTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: openaiResponse.usage.prompt_tokens || 0
                }],
                candidatesTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: openaiResponse.usage.completion_tokens || 0
                }],
                thoughtsTokenCount: openaiResponse.usage.completion_tokens_details?.reasoning_tokens || 0
            } : {}
        };
    }

    /**
     * 将OpenAI流式响应块转换为Gemini流式响应格式
     */
    toGeminiStreamChunk(openaiChunk, model) {
        if (!openaiChunk || !openaiChunk.choices || !openaiChunk.choices[0]) {
            return null;
        }

        const choice = openaiChunk.choices[0];
        const delta = choice.delta || {};
        const parts = [];

        // 处理文本内容
        if (delta.content) {
            parts.push({ text: delta.content });
        }

        // 处理工具调用
        if (delta.tool_calls && delta.tool_calls.length > 0) {
            for (const toolCall of delta.tool_calls) {
                if (toolCall.function) {
                    const functionCall = {
                        name: toolCall.function.name || '',
                        args: {}
                    };
                    
                    if (toolCall.function.arguments) {
                        try {
                            functionCall.args = typeof toolCall.function.arguments === 'string'
                                ? JSON.parse(toolCall.function.arguments)
                                : toolCall.function.arguments;
                        } catch (e) {
                            // 部分参数，保持为字符串
                            functionCall.args = { partial: toolCall.function.arguments };
                        }
                    }
                    
                    parts.push({ functionCall });
                }
            }
        }

        const result = {
            candidates: [{
                content: {
                    role: 'model',
                    parts: parts
                }
            }]
        };

        // 添加finish_reason（如果存在）
        if (choice.finish_reason) {
            const finishReasonMap = {
                'stop': 'STOP',
                'length': 'MAX_TOKENS',
                'tool_calls': 'STOP',
                'content_filter': 'SAFETY'
            };
            result.candidates[0].finishReason = finishReasonMap[choice.finish_reason] || 'STOP';
        }

        // 添加usage信息（如果存在）
        if (openaiChunk.usage) {
            result.usageMetadata = {
                promptTokenCount: openaiChunk.usage.prompt_tokens || 0,
                candidatesTokenCount: openaiChunk.usage.completion_tokens || 0,
                totalTokenCount: openaiChunk.usage.total_tokens || 0,
                cachedContentTokenCount: openaiChunk.usage.prompt_tokens_details?.cached_tokens || 0,
                promptTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: openaiChunk.usage.prompt_tokens || 0
                }],
                candidatesTokensDetails: [{
                    modality: "TEXT",
                    tokenCount: openaiChunk.usage.completion_tokens || 0
                }],
                thoughtsTokenCount: openaiChunk.usage.completion_tokens_details?.reasoning_tokens || 0
            };
        }

        return result;
    }

    /**
     * 将OpenAI请求转换为OpenAI Responses格式
     */
    toOpenAIResponsesRequest(openaiRequest) {
        const responsesRequest = {
            model: openaiRequest.model,
            messages: []
        };

        // 转换messages
        if (openaiRequest.messages && openaiRequest.messages.length > 0) {
            responsesRequest.messages = openaiRequest.messages.map(msg => ({
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? [{ type: 'input_text', text: msg.content }]
                    : msg.content
            }));
        }

        // 转换其他参数
        if (openaiRequest.temperature !== undefined) {
            responsesRequest.temperature = openaiRequest.temperature;
        }
        if (openaiRequest.max_tokens !== undefined) {
            responsesRequest.max_output_tokens = openaiRequest.max_tokens;
        }
        if (openaiRequest.top_p !== undefined) {
            responsesRequest.top_p = openaiRequest.top_p;
        }
        if (openaiRequest.tools) {
            responsesRequest.tools = openaiRequest.tools;
        }
        if (openaiRequest.tool_choice) {
            responsesRequest.tool_choice = openaiRequest.tool_choice;
        }

        return responsesRequest;
    }

    /**
     * 将OpenAI响应转换为OpenAI Responses格式
     */
    toOpenAIResponsesResponse(openaiResponse, model) {
        if (!openaiResponse || !openaiResponse.choices || !openaiResponse.choices[0]) {
            return {
                id: `resp_${Date.now()}`,
                object: 'response',
                created_at: Math.floor(Date.now() / 1000),
                status: 'completed',
                model: model || 'unknown',
                output: [],
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0
                }
            };
        }

        const choice = openaiResponse.choices[0];
        const message = choice.message || {};
        const output = [];

        // 构建message输出
        const messageContent = [];
        if (message.content) {
            messageContent.push({
                type: 'output_text',
                text: message.content
            });
        }

        output.push({
            type: 'message',
            id: `msg_${Date.now()}`,
            status: 'completed',
            role: 'assistant',
            content: messageContent
        });

        return {
            id: openaiResponse.id || `resp_${Date.now()}`,
            object: 'response',
            created_at: openaiResponse.created || Math.floor(Date.now() / 1000),
            status: choice.finish_reason === 'stop' ? 'completed' : 'in_progress',
            model: model || openaiResponse.model || 'unknown',
            output: output,
            usage: openaiResponse.usage ? {
                input_tokens: openaiResponse.usage.prompt_tokens || 0,
                input_tokens_details: {
                    cached_tokens: openaiResponse.usage.prompt_tokens_details?.cached_tokens || 0
                },
                output_tokens: openaiResponse.usage.completion_tokens || 0,
                output_tokens_details: {
                    reasoning_tokens: openaiResponse.usage.completion_tokens_details?.reasoning_tokens || 0
                },
                total_tokens: openaiResponse.usage.total_tokens || 0
            } : {
                input_tokens: 0,
                input_tokens_details: {
                    cached_tokens: 0
                },
                output_tokens: 0,
                output_tokens_details: {
                    reasoning_tokens: 0
                },
                total_tokens: 0
            }
        };
    }

    /**
     * 将OpenAI流式响应转换为OpenAI Responses流式格式
     * 参考 ClaudeConverter.toOpenAIResponsesStreamChunk 的实现逻辑
     */
    toOpenAIResponsesStreamChunk(openaiChunk, model, requestId = null) {
        if (!openaiChunk || !openaiChunk.choices || !openaiChunk.choices[0]) {
            return [];
        }

        const responseId = requestId || `resp_${uuidv4().replace(/-/g, '')}`;
        const choice = openaiChunk.choices[0];
        const delta = choice.delta || {};
        const events = [];

        // 第一个chunk - role为assistant时调用 getOpenAIResponsesStreamChunkBegin
        if (delta.role === 'assistant') {
            events.push(
                generateResponseCreated(responseId, model || openaiChunk.model || 'unknown'),
                generateResponseInProgress(responseId),
                generateOutputItemAdded(responseId),
                generateContentPartAdded(responseId)
            );
        }

        // 处理 reasoning_content（推理内容）
        if (delta.reasoning_content) {
            events.push({
                delta: delta.reasoning_content,
                item_id: `thinking_${uuidv4().replace(/-/g, '')}`,
                output_index: 0,
                sequence_number: 3,
                type: "response.reasoning_summary_text.delta"
            });
        }

        // 处理 tool_calls（工具调用）
        if (delta.tool_calls && delta.tool_calls.length > 0) {
            for (const toolCall of delta.tool_calls) {
                const outputIndex = toolCall.index || 0;
                
                // 如果有 function.name，说明是工具调用开始
                if (toolCall.function && toolCall.function.name) {
                    events.push({
                        item: {
                            id: toolCall.id || `call_${uuidv4().replace(/-/g, '')}`,
                            type: "function_call",
                            name: toolCall.function.name,
                            arguments: "",
                            status: "in_progress"
                        },
                        output_index: outputIndex,
                        sequence_number: 2,
                        type: "response.output_item.added"
                    });
                }
                
                // 如果有 function.arguments，说明是参数增量
                if (toolCall.function && toolCall.function.arguments) {
                    events.push({
                        delta: toolCall.function.arguments,
                        item_id: toolCall.id || `call_${uuidv4().replace(/-/g, '')}`,
                        output_index: outputIndex,
                        sequence_number: 3,
                        type: "response.custom_tool_call_input.delta"
                    });
                }
            }
        }

        // 处理普通文本内容
        if (delta.content) {
            events.push({
                delta: delta.content,
                item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                output_index: 0,
                sequence_number: 3,
                type: "response.output_text.delta"
            });
        }

        // 处理完成状态 - 调用 getOpenAIResponsesStreamChunkEnd
        if (choice.finish_reason) {
            events.push(
                generateOutputTextDone(responseId),
                generateContentPartDone(responseId),
                generateOutputItemDone(responseId),
                generateResponseCompleted(responseId)
            );
            
            // 如果有 usage 信息，更新最后一个事件
            if (openaiChunk.usage && events.length > 0) {
                const lastEvent = events[events.length - 1];
                if (lastEvent.response) {
                    lastEvent.response.usage = {
                        input_tokens: openaiChunk.usage.prompt_tokens || 0,
                        input_tokens_details: {
                            cached_tokens: openaiChunk.usage.prompt_tokens_details?.cached_tokens || 0
                        },
                        output_tokens: openaiChunk.usage.completion_tokens || 0,
                        output_tokens_details: {
                            reasoning_tokens: openaiChunk.usage.completion_tokens_details?.reasoning_tokens || 0
                        },
                        total_tokens: openaiChunk.usage.total_tokens || 0
                    };
                }
            }
        }

        return events;
    }

}

export default OpenAIConverter;