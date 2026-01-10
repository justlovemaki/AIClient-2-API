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
    cleanJsonSchemaProperties as cleanJsonSchema,
    CLAUDE_DEFAULT_MAX_TOKENS,
    CLAUDE_DEFAULT_TEMPERATURE,
    CLAUDE_DEFAULT_TOP_P,
    GEMINI_DEFAULT_MAX_TOKENS,
    GEMINI_DEFAULT_TEMPERATURE,
    GEMINI_DEFAULT_TOP_P,
    OPENAI_DEFAULT_INPUT_TOKEN_LIMIT,
    OPENAI_DEFAULT_OUTPUT_TOKEN_LIMIT
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
                return this.ensureDisplayName(data);
        }
    }

    /**
     * Ensure display_name field exists in OpenAI model list
     */
    ensureDisplayName(openaiModels) {
        if (!openaiModels || !openaiModels.data) {
            return openaiModels;
        }

        return {
            ...openaiModels,
            data: openaiModels.data.map(model => ({
                ...model,
                display_name: model.display_name || model.id,
            })),
        };
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
            max_tokens: checkAndAssignOrDefault(openaiRequest.max_tokens, CLAUDE_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(openaiRequest.temperature, CLAUDE_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(openaiRequest.top_p, CLAUDE_DEFAULT_TOP_P),
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
            if (!choice) {
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
                inputTokenLimit: m.inputTokenLimit || OPENAI_DEFAULT_INPUT_TOKEN_LIMIT,
                outputTokenLimit: m.outputTokenLimit || OPENAI_DEFAULT_OUTPUT_TOKEN_LIMIT,
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

    // Gemini Openai thought signature constant
    static GEMINI_OPENAI_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
    /**
     * OpenAI请求 -> Gemini请求
     */
    toGeminiRequest(openaiRequest) {
        const messages = openaiRequest.messages || [];
        const model = openaiRequest.model || '';
        
        // 构建 tool_call_id -> function_name 映射
        const tcID2Name = {};
        for (const message of messages) {
            if (message.role === 'assistant' && message.tool_calls) {
                for (const tc of message.tool_calls) {
                    if (tc.type === 'function' && tc.id && tc.function?.name) {
                        tcID2Name[tc.id] = tc.function.name;
                    }
                }
            }
        }

        // 构建 tool_call_id -> response 映射
        const toolResponses = {};
        for (const message of messages) {
            if (message.role === 'tool' && message.tool_call_id) {
                toolResponses[message.tool_call_id] = message.content;
            }
        }

        const processedMessages = [];
        let systemInstruction = null;

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            const role = message.role;
            const content = message.content;

            if (role === 'system') {
                // system -> system_instruction
                if (messages.length > 1) {
                    if (typeof content === 'string') {
                        systemInstruction = {
                            role: 'user',
                            parts: [{ text: content }]
                        };
                    } else if (Array.isArray(content)) {
                        const parts = content
                            .filter(item => item.type === 'text' && item.text)
                            .map(item => ({ text: item.text }));
                        if (parts.length > 0) {
                            systemInstruction = {
                                role: 'user',
                                parts: parts
                            };
                        }
                    } else if (typeof content === 'object' && content.type === 'text') {
                        systemInstruction = {
                            role: 'user',
                            parts: [{ text: content.text }]
                        };
                    }
                } else {
                    // 只有一条 system 消息时，作为 user 消息处理
                    const node = { role: 'user', parts: [] };
                    if (typeof content === 'string') {
                        node.parts.push({ text: content });
                    } else if (Array.isArray(content)) {
                        for (const item of content) {
                            if (item.type === 'text' && item.text) {
                                node.parts.push({ text: item.text });
                            }
                        }
                    }
                    if (node.parts.length > 0) {
                        processedMessages.push(node);
                    }
                }
            } else if (role === 'user') {
                // user -> user content
                const node = { role: 'user', parts: [] };
                if (typeof content === 'string') {
                    node.parts.push({ text: content });
                } else if (Array.isArray(content)) {
                    for (const item of content) {
                        if (!item) continue;
                        switch (item.type) {
                            case 'text':
                                if (item.text) {
                                    node.parts.push({ text: item.text });
                                }
                                break;
                            case 'image_url':
                                if (item.image_url) {
                                    const imageUrl = typeof item.image_url === 'string'
                                        ? item.image_url
                                        : item.image_url.url;
                                    if (imageUrl && imageUrl.startsWith('data:')) {
                                        const commaIndex = imageUrl.indexOf(',');
                                        if (commaIndex > 5) {
                                            const header = imageUrl.substring(5, commaIndex);
                                            const semicolonIndex = header.indexOf(';');
                                            if (semicolonIndex > 0) {
                                                const mimeType = header.substring(0, semicolonIndex);
                                                const data = imageUrl.substring(commaIndex + 1);
                                                node.parts.push({
                                                    inlineData: {
                                                        mimeType: mimeType,
                                                        data: data
                                                    },
                                                    thoughtSignature: OpenAIConverter.GEMINI_OPENAI_THOUGHT_SIGNATURE
                                                });
                                            }
                                        }
                                    } else if (imageUrl) {
                                        node.parts.push({
                                            fileData: {
                                                mimeType: 'image/jpeg',
                                                fileUri: imageUrl
                                            }
                                        });
                                    }
                                }
                                break;
                            case 'file':
                                if (item.file) {
                                    const filename = item.file.filename || '';
                                    const fileData = item.file.file_data || '';
                                    const ext = filename.includes('.')
                                        ? filename.split('.').pop().toLowerCase()
                                        : '';
                                    const mimeTypes = {
                                        'pdf': 'application/pdf',
                                        'txt': 'text/plain',
                                        'html': 'text/html',
                                        'css': 'text/css',
                                        'js': 'application/javascript',
                                        'json': 'application/json',
                                        'xml': 'application/xml',
                                        'csv': 'text/csv',
                                        'md': 'text/markdown',
                                        'py': 'text/x-python',
                                        'java': 'text/x-java',
                                        'c': 'text/x-c',
                                        'cpp': 'text/x-c++',
                                        'h': 'text/x-c',
                                        'hpp': 'text/x-c++',
                                        'go': 'text/x-go',
                                        'rs': 'text/x-rust',
                                        'ts': 'text/typescript',
                                        'tsx': 'text/typescript',
                                        'jsx': 'text/javascript',
                                        'png': 'image/png',
                                        'jpg': 'image/jpeg',
                                        'jpeg': 'image/jpeg',
                                        'gif': 'image/gif',
                                        'webp': 'image/webp',
                                        'svg': 'image/svg+xml',
                                        'mp3': 'audio/mpeg',
                                        'wav': 'audio/wav',
                                        'mp4': 'video/mp4',
                                        'webm': 'video/webm'
                                    };
                                    const mimeType = mimeTypes[ext];
                                    if (mimeType && fileData) {
                                        node.parts.push({
                                            inlineData: {
                                                mimeType: mimeType,
                                                data: fileData
                                            }
                                        });
                                    }
                                }
                                break;
                        }
                    }
                }
                if (node.parts.length > 0) {
                    processedMessages.push(node);
                }
            } else if (role === 'assistant') {
                // assistant -> model content
                const node = { role: 'model', parts: [] };
                
                // 处理文本内容
                if (typeof content === 'string' && content) {
                    node.parts.push({ text: content });
                } else if (Array.isArray(content)) {
                    for (const item of content) {
                        if (!item) continue;
                        if (item.type === 'text' && item.text) {
                            node.parts.push({ text: item.text });
                        } else if (item.type === 'image_url' && item.image_url) {
                            const imageUrl = typeof item.image_url === 'string'
                                ? item.image_url
                                : item.image_url.url;
                            if (imageUrl && imageUrl.startsWith('data:')) {
                                const commaIndex = imageUrl.indexOf(',');
                                if (commaIndex > 5) {
                                    const header = imageUrl.substring(5, commaIndex);
                                    const semicolonIndex = header.indexOf(';');
                                    if (semicolonIndex > 0) {
                                        const mimeType = header.substring(0, semicolonIndex);
                                        const data = imageUrl.substring(commaIndex + 1);
                                        node.parts.push({
                                            inlineData: {
                                                mimeType: mimeType,
                                                data: data
                                            },
                                            thoughtSignature: OpenAIConverter.GEMINI_OPENAI_THOUGHT_SIGNATURE
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                // 处理 tool_calls -> functionCall
                if (message.tool_calls && Array.isArray(message.tool_calls)) {
                    const functionCallIds = [];
                    for (const tc of message.tool_calls) {
                        if (tc.type !== 'function') continue;
                        const fid = tc.id || '';
                        const fname = tc.function?.name || '';
                        const fargs = tc.function?.arguments || '{}';
                        
                        let argsObj;
                        try {
                            argsObj = typeof fargs === 'string' ? JSON.parse(fargs) : fargs;
                        } catch (e) {
                            argsObj = {};
                        }
                        
                        node.parts.push({
                            functionCall: {
                                name: fname,
                                args: argsObj
                            },
                            thoughtSignature: OpenAIConverter.GEMINI_OPENAI_THOUGHT_SIGNATURE
                        });
                        
                        if (fid) {
                            functionCallIds.push(fid);
                        }
                    }
                    
                    // 添加 model 消息
                    if (node.parts.length > 0) {
                        processedMessages.push(node);
                    }
                    
                    // 添加对应的 functionResponse（作为 user 消息）
                    if (functionCallIds.length > 0) {
                        const toolNode = { role: 'user', parts: [] };
                        for (const fid of functionCallIds) {
                            const name = tcID2Name[fid];
                            if (name) {
                                let resp = toolResponses[fid] || '{}';
                                // 确保 resp 是字符串
                                if (typeof resp !== 'string') {
                                    resp = JSON.stringify(resp);
                                }
                                toolNode.parts.push({
                                    functionResponse: {
                                        name: name,
                                        response: {
                                            result: resp
                                        }
                                    }
                                });
                            }
                        }
                        if (toolNode.parts.length > 0) {
                            processedMessages.push(toolNode);
                        }
                    }
                } else {
                    // 没有 tool_calls，直接添加
                    if (node.parts.length > 0) {
                        processedMessages.push(node);
                    }
                }
            }
            // tool 消息已经在 assistant 的 tool_calls 处理中合并了，这里跳过
        }

        // 构建 Gemini 请求
        const geminiRequest = {
            contents: processedMessages.filter(item => item.parts && item.parts.length > 0)
        };

        // 添加 model
        if (model) {
            geminiRequest.model = model;
        }

        // 添加 system_instruction
        if (systemInstruction) {
            geminiRequest.system_instruction = systemInstruction;
        }

        // 处理 reasoning_effort -> thinkingConfig
        if (openaiRequest.reasoning_effort) {
            const effort = String(openaiRequest.reasoning_effort).toLowerCase().trim();
            if (this.modelSupportsThinking(model)) {
                if (this.isGemini3Model(model)) {
                    // Gemini 3 模型使用 thinkingLevel
                    if (effort === 'none') {
                        // 不添加 thinkingConfig
                    } else if (effort === 'auto') {
                        geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                        geminiRequest.generationConfig.thinkingConfig = {
                            includeThoughts: true
                        };
                    } else {
                        const level = this.validateGemini3ThinkingLevel(model, effort);
                        if (level) {
                            geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                            geminiRequest.generationConfig.thinkingConfig = {
                                thinkingLevel: level
                            };
                        }
                    }
                } else if (!this.modelUsesThinkingLevels(model)) {
                    // 使用 thinkingBudget 的模型
                    geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                    geminiRequest.generationConfig.thinkingConfig = this.applyReasoningEffortToGemini(effort);
                }
            }
        }

        // 处理 extra_body.google.thinking_config（Cherry Studio 扩展）
        if (!openaiRequest.reasoning_effort && openaiRequest.extra_body?.google?.thinking_config) {
            const tc = openaiRequest.extra_body.google.thinking_config;
            if (this.modelSupportsThinking(model) && !this.modelUsesThinkingLevels(model)) {
                geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                geminiRequest.generationConfig.thinkingConfig = geminiRequest.generationConfig.thinkingConfig || {};
                
                let setBudget = false;
                let budget = 0;
                
                if (tc.thinkingBudget !== undefined) {
                    budget = parseInt(tc.thinkingBudget, 10);
                    geminiRequest.generationConfig.thinkingConfig.thinkingBudget = budget;
                    setBudget = true;
                } else if (tc.thinking_budget !== undefined) {
                    budget = parseInt(tc.thinking_budget, 10);
                    geminiRequest.generationConfig.thinkingConfig.thinkingBudget = budget;
                    setBudget = true;
                }
                
                if (tc.includeThoughts !== undefined) {
                    geminiRequest.generationConfig.thinkingConfig.includeThoughts = tc.includeThoughts;
                } else if (tc.include_thoughts !== undefined) {
                    geminiRequest.generationConfig.thinkingConfig.includeThoughts = tc.include_thoughts;
                } else if (setBudget && budget !== 0) {
                    geminiRequest.generationConfig.thinkingConfig.includeThoughts = true;
                }
            }
        }

        // 处理 modalities -> responseModalities
        if (openaiRequest.modalities && Array.isArray(openaiRequest.modalities)) {
            const responseMods = [];
            for (const m of openaiRequest.modalities) {
                const mod = String(m).toLowerCase();
                if (mod === 'text') {
                    responseMods.push('TEXT');
                } else if (mod === 'image') {
                    responseMods.push('IMAGE');
                }
            }
            if (responseMods.length > 0) {
                geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                geminiRequest.generationConfig.responseModalities = responseMods;
            }
        }

        // 处理 image_config（OpenRouter 风格）
        if (openaiRequest.image_config) {
            const imgCfg = openaiRequest.image_config;
            if (imgCfg.aspect_ratio) {
                geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                geminiRequest.generationConfig.imageConfig = geminiRequest.generationConfig.imageConfig || {};
                geminiRequest.generationConfig.imageConfig.aspectRatio = imgCfg.aspect_ratio;
            }
            if (imgCfg.image_size) {
                geminiRequest.generationConfig = geminiRequest.generationConfig || {};
                geminiRequest.generationConfig.imageConfig = geminiRequest.generationConfig.imageConfig || {};
                geminiRequest.generationConfig.imageConfig.imageSize = imgCfg.image_size;
            }
        }

        // 处理 tools -> functionDeclarations
        if (openaiRequest.tools?.length) {
            const functionDeclarations = [];
            let hasGoogleSearch = false;
            
            for (const t of openaiRequest.tools) {
                if (!t || typeof t !== 'object') continue;
                
                if (t.type === 'function' && t.function) {
                    const func = t.function;
                    let fnDecl = {
                        name: String(func.name || ''),
                        description: String(func.description || '')
                    };
                    
                    // 处理 parameters -> parametersJsonSchema
                    if (func.parameters) {
                        fnDecl.parametersJsonSchema = cleanJsonSchema(func.parameters);
                    } else {
                        fnDecl.parametersJsonSchema = {
                            type: 'object',
                            properties: {}
                        };
                    }
                    
                    functionDeclarations.push(fnDecl);
                }
                
                // 处理 google_search 工具
                if (t.google_search) {
                    hasGoogleSearch = true;
                }
            }
            
            if (functionDeclarations.length > 0 || hasGoogleSearch) {
                geminiRequest.tools = [{}];
                if (functionDeclarations.length > 0) {
                    geminiRequest.tools[0].functionDeclarations = functionDeclarations;
                }
                if (hasGoogleSearch) {
                    const googleSearchTool = openaiRequest.tools.find(t => t.google_search);
                    geminiRequest.tools[0].googleSearch = googleSearchTool.google_search;
                }
            }
        }

        // 处理 tool_choice
        if (openaiRequest.tool_choice) {
            geminiRequest.toolConfig = this.buildGeminiToolConfig(openaiRequest.tool_choice);
        }

        // 构建 generationConfig
        const config = this.buildGeminiGenerationConfig(openaiRequest, model);
        if (Object.keys(config).length) {
            geminiRequest.generationConfig = {
                ...config,
                ...(geminiRequest.generationConfig || {})
            };
        }

        // 添加默认安全设置
        geminiRequest.safetySettings = this.getDefaultSafetySettings();

        return geminiRequest;
    }

    /**
     * 检查模型是否支持 thinking
     */
    modelSupportsThinking(model) {
        if (!model) return false;
        const m = model.toLowerCase();
        return m.includes('2.5') || m.includes('thinking') || m.includes('2.0-flash-thinking');
    }

    /**
     * 检查是否是 Gemini 3 模型
     */
    isGemini3Model(model) {
        if (!model) return false;
        const m = model.toLowerCase();
        return m.includes('gemini-3') || m.includes('gemini3');
    }

    /**
     * 检查模型是否使用 thinking levels（而不是 budget）
     */
    modelUsesThinkingLevels(model) {
        if (!model) return false;
        // Gemini 3 模型使用 levels，其他使用 budget
        return this.isGemini3Model(model);
    }

    /**
     * 验证 Gemini 3 thinking level
     */
    validateGemini3ThinkingLevel(model, effort) {
        const validLevels = ['low', 'medium', 'high'];
        if (validLevels.includes(effort)) {
            return effort.toUpperCase();
        }
        return null;
    }

    /**
     * 将 reasoning_effort 转换为 Gemini thinkingConfig
     */
    applyReasoningEffortToGemini(effort) {
        const effortToBudget = {
            'low': 1024,
            'medium': 8192,
            'high': 24576
        };
        const budget = effortToBudget[effort] || effortToBudget['medium'];
        return {
            thinkingBudget: budget,
            includeThoughts: true
        };
    }

    /**
     * 获取默认安全设置
     */
    getDefaultSafetySettings() {
        return [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" }
        ];
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
    buildGeminiGenerationConfig({ temperature, max_tokens, top_p, stop, tools, response_format }, model) {
        const config = {};
        config.temperature = checkAndAssignOrDefault(temperature, GEMINI_DEFAULT_TEMPERATURE);
        config.maxOutputTokens = checkAndAssignOrDefault(max_tokens, GEMINI_DEFAULT_MAX_TOKENS);
        config.topP = checkAndAssignOrDefault(top_p, GEMINI_DEFAULT_TOP_P);
        if (stop !== undefined) config.stopSequences = Array.isArray(stop) ? stop : [stop];

        // Handle response_format
        if (response_format) {
            if (response_format.type === 'json_object') {
                config.responseMimeType = 'application/json';
            } else if (response_format.type === 'json_schema' && response_format.json_schema) {
                config.responseMimeType = 'application/json';
                if (response_format.json_schema.schema) {
                    config.responseSchema = response_format.json_schema.schema;
                }
            }
        }

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