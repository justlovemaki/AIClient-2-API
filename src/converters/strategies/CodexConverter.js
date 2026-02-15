/**
 * Codex 转换器
 * 处理 OpenAI 协议与 Codex 协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConverter } from '../BaseConverter.js';
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

export class CodexConverter extends BaseConverter {
    constructor() {
        super('codex');
        this.toolNameMap = new Map(); // 工具名称缩短映射: original -> short
        this.reverseToolNameMap = new Map(); // 反向映射: short -> original
        this.streamParams = new Map(); // 用于存储流式状态，key 为响应 ID 或临时标识
    }

    /**
     * 转换请求
     */
    convertRequest(data, targetProtocol) {
        throw new Error(`Unsupported target protocol: ${targetProtocol}`);
    }

    /**
     * 转换响应
     */
    convertResponse(data, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return data; // Codex to Codex
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
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return chunk; // Codex to Codex
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换模型列表
     */
    convertModelList(data, targetProtocol) {
        return data;
    }

    /**
     * OpenAI Responses → Codex 请求转换
     */
    toOpenAIResponsesToCodexRequest(responsesRequest) {
        let codexRequest = { ...responsesRequest };
    
        // 处理 input 字段，如果它是字符串，则转换为消息数组
        if (codexRequest.input && typeof codexRequest.input === 'string') {
            const inputText = codexRequest.input;
            codexRequest.input = [{
                type: "message",
                role: "user",
                content: [{
                    type: "input_text",
                    text: inputText
                }]
            }];
        }
    
        // 设置Codex特定的字段
        codexRequest.stream = true;
        codexRequest.store = false;
        codexRequest.parallel_tool_calls = true;
        codexRequest.include = ['reasoning.encrypted_content'];
    
        // 删除Codex不支持的字段
        delete codexRequest.max_output_tokens;
        delete codexRequest.max_completion_tokens;
        delete codexRequest.temperature;
        delete codexRequest.top_p;
        delete codexRequest.service_tier;
        delete codexRequest.user;
        delete codexRequest.reasoning;
        
        // 添加 reasoning 配置
        codexRequest.reasoning = {
          "effort": "medium",
          "summary": "auto"
        };
        
    
        // 确保 input 数组中的每个项都有 type: "message"，并将系统角色转换为开发者角色
        if (codexRequest.input && Array.isArray(codexRequest.input)) {
            codexRequest.input = codexRequest.input.map(item => {
                // 如果没有 type 或者 type 不是 message，则添加 type: "message"
                if (!item.type || item.type !== 'message') {
                    item = { type: "message", ...item };
                }
                
                // 将系统角色转换为开发者角色
                if (item.role === 'system') {
                    item = { ...item, role: 'developer' };
                }
                
                return item;
            });
        }
    
        return codexRequest;
    }

    /**
     * OpenAI → Codex 请求转换
     */
    toOpenAIRequestToCodexRequest(data) {
        // 构建工具名称映射
        this.buildToolNameMap(data.tools || []);

        const codexRequest = {
            model: data.model,
            instructions: this.buildInstructions(data),
            input: this.convertMessages(data.messages || []),
            stream: true,
            store: false,
            metadata: data.metadata || {},
            reasoning: {
                effort: data.reasoning_effort || 'medium',
                summary: 'auto'
            },
            parallel_tool_calls: true,
            include: ['reasoning.encrypted_content']
        };

        // 处理 OpenAI Responses 特有的 instructions 和 input 字段（如果存在）
        if (data.instructions && !codexRequest.instructions) {
            codexRequest.instructions = data.instructions;
        }

        if (data.input && Array.isArray(data.input) && codexRequest.input.length === 0) {
             // 如果是 OpenAI Responses 格式的 input
             for (const item of data.input) {
                if (item.type === 'message') {
                    codexRequest.input.push({
                        type: 'message',
                        role: item.role === 'system' ? 'developer' : item.role,
                        content: Array.isArray(item.content) ? item.content.map(c => ({
                            type: item.role === 'assistant' ? 'output_text' : 'input_text',
                            text: c.text
                        })) : [{
                            type: item.role === 'assistant' ? 'output_text' : 'input_text',
                            text: item.content
                        }]
                    });
                }
            }
        }

        if (data.tools && data.tools.length > 0) {
            codexRequest.tools = this.convertTools(data.tools);
        }

        if (data.tool_choice) {
            codexRequest.tool_choice = this.convertToolChoice(data.tool_choice);
        }

        if (data.response_format || data.text?.verbosity) {
            const textObj = {};
            if (data.response_format) {
                textObj.format = this.convertResponseFormat(data.response_format);
            }
            if (data.text?.verbosity) {
                textObj.verbosity = data.text.verbosity;
            }
            codexRequest.text = textObj;
        }

        // 在 input 开头注入特殊指令（如果配置允许）
        // 这里我们默认开启，因为这是为了确保 Codex 遵循指令
        if (codexRequest.input.length > 0 && codexRequest.instructions) {
             const firstMsg = codexRequest.input[0];
             const specialInstruction = "EXECUTE ACCORDING TO THE FOLLOWING INSTRUCTIONS!!!";
             const firstText = firstMsg.content?.[0]?.text;
             
             if (firstMsg.role === 'user' && firstText !== specialInstruction) {
                 codexRequest.input.unshift({
                     type: "message",
                     role: "user",
                     content: [{
                         type: "input_text",
                         text: specialInstruction
                     }]
                 });
             }
        }

        return codexRequest;
    }

    /**
     * 构建指令
     */
    buildInstructions(data) {
        // 首先检查显式的 instructions 字段 (OpenAI Responses)
        if (data.instructions) return data.instructions;

        const systemMessages = (data.messages || []).filter(m => m.role === 'system');
        if (systemMessages.length > 0) {
            return systemMessages.map(m => {
                if (typeof m.content === 'string') {
                    return m.content;
                } else if (Array.isArray(m.content)) {
                    const textPart = m.content.find(part => part.type === 'text');
                    return textPart ? textPart.text : '';
                }
                return '';
            }).join('\n').trim();
        }
        return '';
    }

    /**
     * 转换消息
     */
    convertMessages(messages) {
        const input = [];

        for (const msg of messages) {
            const role = msg.role;

            if (role === 'tool' || role === 'tool_result') {
                input.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id || msg.tool_use_id,
                    output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                });
            } else {
                const codexMsg = {
                    type: 'message',
                    role: role === 'system' ? 'developer' : (role === 'model' ? 'assistant' : role),
                    content: this.convertMessageContent(msg.content, role)
                };
                
                if (codexMsg.content.length > 0) {
                    input.push(codexMsg);
                }

                if ((role === 'assistant' || role === 'model') && msg.tool_calls) {
                    for (const toolCall of msg.tool_calls) {
                        if (toolCall.type === 'function' || toolCall.function) {
                            const func = toolCall.function || toolCall;
                            const originalName = func.name;
                            const shortName = this.toolNameMap.get(originalName) || this.shortenToolName(originalName);
                            input.push({
                                type: 'function_call',
                                call_id: toolCall.id,
                                name: shortName,
                                arguments: typeof func.arguments === 'string' ? func.arguments : JSON.stringify(func.arguments)
                            });
                        }
                    }
                }
                
                // 处理 Claude 格式的 tool_use
                if (role === 'assistant' && Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.type === 'tool_use') {
                            const originalName = part.name;
                            const shortName = this.toolNameMap.get(originalName) || this.shortenToolName(originalName);
                            input.push({
                                type: 'function_call',
                                call_id: part.id,
                                name: shortName,
                                arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input)
                            });
                        }
                    }
                }
            }
        }

        return input;
    }

    /**
     * 转换消息内容
     */
    convertMessageContent(content, role) {
        if (!content) return [];

        const isAssistant = role === 'assistant' || role === 'model';

        if (typeof content === 'string') {
            return [{
                type: isAssistant ? 'output_text' : 'input_text',
                text: content
            }];
        }

        if (Array.isArray(content)) {
            return content.map(part => {
                if (typeof part === 'string') {
                    return {
                        type: isAssistant ? 'output_text' : 'input_text',
                        text: part
                    };
                }
                if (part.type === 'text') {
                    return {
                        type: isAssistant ? 'output_text' : 'input_text',
                        text: part.text
                    };
                } else if ((part.type === 'image_url' || part.type === 'image') && !isAssistant) {
                    let url = '';
                    if (part.image_url) {
                        url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
                    } else if (part.source && part.source.type === 'base64') {
                        url = `data:${part.source.media_type};base64,${part.source.data}`;
                    }
                    return url ? {
                        type: 'input_image',
                        image_url: url
                    } : null;
                }
                return null;
            }).filter(Boolean);
        }

        return [];
    }

    /**
     * 构建工具名称映射
     */
    buildToolNameMap(tools) {
        this.toolNameMap.clear();
        this.reverseToolNameMap.clear();

        const names = [];
        for (const t of tools) {
            if (t.type === 'function' && t.function?.name) {
                names.push(t.function.name);
            } else if (t.name) {
                names.push(t.name);
            }
        }

        if (names.length === 0) return;

        const limit = 64;
        const used = new Set();

        const baseCandidate = (n) => {
            if (n.length <= limit) return n;
            if (n.startsWith('mcp__')) {
                const idx = n.lastIndexOf('__');
                if (idx > 0) {
                    let cand = 'mcp__' + n.slice(idx + 2);
                    return cand.length > limit ? cand.slice(0, limit) : cand;
                }
            }
            return n.slice(0, limit);
        };

        for (const n of names) {
            let cand = baseCandidate(n);
            let uniq = cand;
            if (used.has(uniq)) {
                for (let i = 1; ; i++) {
                    const suffix = '_' + i;
                    const allowed = limit - suffix.length;
                    const base = cand.slice(0, Math.max(0, allowed));
                    const tmp = base + suffix;
                    if (!used.has(tmp)) {
                        uniq = tmp;
                        break;
                    }
                }
            }
            used.add(uniq);
            this.toolNameMap.set(n, uniq);
            this.reverseToolNameMap.set(uniq, n);
        }
    }

    /**
     * 转换工具
     */
    convertTools(tools) {
        return tools.map(tool => {
            // 处理 Claude 的 web_search
            if (tool.type === "web_search_20250305") {
                return { type: "web_search" };
            }

            if (tool.type !== 'function' && !tool.name) {
                return tool;
            }

            const func = tool.function || tool;
            const originalName = func.name;
            const shortName = this.toolNameMap.get(originalName) || this.shortenToolName(originalName);

            const result = {
                type: 'function',
                name: shortName,
                description: func.description,
                parameters: func.parameters || func.input_schema || { type: 'object', properties: {} },
                strict: func.strict !== undefined ? func.strict : false
            };
            
            // 清理参数
            if (result.parameters && result.parameters.$schema) {
                delete result.parameters.$schema;
            }

            return result;
        });
    }

    /**
     * 转换 tool_choice
     */
    convertToolChoice(toolChoice) {
        if (typeof toolChoice === 'string') {
            return toolChoice;
        }

        if (toolChoice.type === 'function') {
            const name = toolChoice.function?.name;
            const shortName = name ? (this.toolNameMap.get(name) || this.shortenToolName(name)) : '';
            return {
                type: 'function',
                name: shortName
            };
        }

        return toolChoice;
    }

    /**
     * 缩短工具名称
     */
    shortenToolName(name) {
        const limit = 64;
        if (name.length <= limit) return name;
        if (name.startsWith('mcp__')) {
            const idx = name.lastIndexOf('__');
            if (idx > 0) {
                let cand = 'mcp__' + name.slice(idx + 2);
                return cand.length > limit ? cand.slice(0, limit) : cand;
            }
        }
        return name.slice(0, limit);
    }

    /**
     * 获取原始工具名称
     */
    getOriginalToolName(shortName) {
        return this.reverseToolNameMap.get(shortName) || shortName;
    }

    /**
     * 转换响应格式
     */
    convertResponseFormat(responseFormat) {
        if (responseFormat.type === 'json_schema') {
            return {
                type: 'json_schema',
                name: responseFormat.json_schema?.name || 'response',
                schema: responseFormat.json_schema?.schema || {}
            };
        } else if (responseFormat.type === 'json_object') {
            return {
                type: 'json_object'
            };
        }
        return responseFormat;
    }

    /**
     * Codex → OpenAI 响应转换（非流式）
     */
    toOpenAIResponse(rawJSON, model) {
        const root = typeof rawJSON === 'string' ? JSON.parse(rawJSON) : rawJSON;
        if (root.type !== 'response.completed') {
            return null;
        }

        const response = root.response;
        const unixTimestamp = response.created_at || Math.floor(Date.now() / 1000);

        const openaiResponse = {
            id: response.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: unixTimestamp,
            model: response.model || model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: null,
                    reasoning_content: null,
                    tool_calls: null
                },
                finish_reason: null,
                native_finish_reason: null
            }],
            usage: {
                prompt_tokens: response.usage?.input_tokens || 0,
                completion_tokens: response.usage?.output_tokens || 0,
                total_tokens: response.usage?.total_tokens || 0
            }
        };

        if (response.usage?.output_tokens_details?.reasoning_tokens) {
            openaiResponse.usage.completion_tokens_details = {
                reasoning_tokens: response.usage.output_tokens_details.reasoning_tokens
            };
        }

        const output = response.output || [];
        let contentText = '';
        let reasoningText = '';
        const toolCalls = [];

        for (const item of output) {
            switch (item.type) {
                case 'reasoning':
                    if (Array.isArray(item.summary)) {
                        const summaryItem = item.summary.find(s => s.type === 'summary_text');
                        if (summaryItem) reasoningText = summaryItem.text;
                    }
                    break;
                case 'message':
                    if (Array.isArray(item.content)) {
                        const contentItem = item.content.find(c => c.type === 'output_text');
                        if (contentItem) contentText = contentItem.text;
                    }
                    break;
                case 'function_call':
                    toolCalls.push({
                        id: item.call_id || `call_${Date.now()}_${toolCalls.length}`,
                        type: 'function',
                        function: {
                            name: this.getOriginalToolName(item.name),
                            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments)
                        }
                    });
                    break;
            }
        }

        if (contentText) openaiResponse.choices[0].message.content = contentText;
        if (reasoningText) openaiResponse.choices[0].message.reasoning_content = reasoningText;
        if (toolCalls.length > 0) openaiResponse.choices[0].message.tool_calls = toolCalls;

        if (response.status === 'completed') {
            openaiResponse.choices[0].finish_reason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
            openaiResponse.choices[0].native_finish_reason = 'stop';
        }

        return openaiResponse;
    }

    /**
     * Codex → OpenAI Responses 响应转换
     */
    toOpenAIResponsesResponse(rawJSON, model) {
        const root = typeof rawJSON === 'string' ? JSON.parse(rawJSON) : rawJSON;
        if (root.type !== 'response.completed') {
            return null;
        }

        const response = root.response;
        const unixTimestamp = response.created_at || Math.floor(Date.now() / 1000);

        const output = [];

        if (response.output && Array.isArray(response.output)) {
            for (const item of response.output) {
                if (item.type === 'reasoning') {
                    let reasoningText = '';
                    if (Array.isArray(item.summary)) {
                        const summaryItem = item.summary.find(s => s.type === 'summary_text');
                        if (summaryItem) reasoningText = summaryItem.text;
                    }
                    if (reasoningText) {
                        output.push({
                            id: `msg_${uuidv4().replace(/-/g, '')}`,
                            type: "message",
                            role: "assistant",
                            status: "completed",
                            content: [{
                                type: "reasoning",
                                text: reasoningText
                            }]
                        });
                    }
                } else if (item.type === 'message') {
                    let contentText = '';
                    if (Array.isArray(item.content)) {
                        const contentItem = item.content.find(c => c.type === 'output_text');
                        if (contentItem) contentText = contentItem.text;
                    }
                    if (contentText) {
                        output.push({
                            id: `msg_${uuidv4().replace(/-/g, '')}`,
                            type: "message",
                            role: "assistant",
                            status: "completed",
                            content: [{
                                type: "output_text",
                                text: contentText,
                                annotations: []
                            }]
                        });
                    }
                } else if (item.type === 'function_call') {
                    output.push({
                        id: item.call_id || `call_${uuidv4().replace(/-/g, '')}`,
                        type: "function_call",
                        name: this.getOriginalToolName(item.name),
                        arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments),
                        status: "completed"
                    });
                }
            }
        }

        return {
            id: response.id || `resp_${uuidv4().replace(/-/g, '')}`,
            object: "response",
            created_at: unixTimestamp,
            model: response.model || model,
            status: "completed",
            output: output,
            incomplete_details: response.incomplete_details || null,
            usage: {
                input_tokens: response.usage?.input_tokens || 0,
                output_tokens: response.usage?.output_tokens || 0,
                total_tokens: response.usage?.total_tokens || 0,
                output_tokens_details: {
                    reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens || 0
                }
            }
        };
    }

    /**
     * Codex → Gemini 响应转换
     */
    toGeminiResponse(rawJSON, model) {
        const root = typeof rawJSON === 'string' ? JSON.parse(rawJSON) : rawJSON;
        if (root.type !== 'response.completed') {
            return null;
        }

        const response = root.response;
        const parts = [];

        if (response.output && Array.isArray(response.output)) {
            for (const item of response.output) {
                if (item.type === 'reasoning') {
                    let reasoningText = '';
                    if (Array.isArray(item.summary)) {
                        const summaryItem = item.summary.find(s => s.type === 'summary_text');
                        if (summaryItem) reasoningText = summaryItem.text;
                    }
                    if (reasoningText) {
                        parts.push({ text: reasoningText, thought: true });
                    }
                } else if (item.type === 'message') {
                    let contentText = '';
                    if (Array.isArray(item.content)) {
                        const contentItem = item.content.find(c => c.type === 'output_text');
                        if (contentItem) contentText = contentItem.text;
                    }
                    if (contentText) {
                        parts.push({ text: contentText });
                    }
                } else if (item.type === 'function_call') {
                    parts.push({
                        functionCall: {
                            name: this.getOriginalToolName(item.name),
                            args: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
                        }
                    });
                }
            }
        }

        return {
            candidates: [{
                content: {
                    role: "model",
                    parts: parts
                },
                finishReason: "STOP"
            }],
            usageMetadata: {
                promptTokenCount: response.usage?.input_tokens || 0,
                candidatesTokenCount: response.usage?.output_tokens || 0,
                totalTokenCount: response.usage?.total_tokens || 0
            },
            modelVersion: response.model || model,
            responseId: response.id
        };
    }

    /**
     * Codex → Claude 响应转换
     */
    toClaudeResponse(rawJSON, model) {
        const root = typeof rawJSON === 'string' ? JSON.parse(rawJSON) : rawJSON;
        if (root.type !== 'response.completed') {
            return null;
        }

        const response = root.response;
        const content = [];
        let stopReason = "end_turn";

        if (response.output && Array.isArray(response.output)) {
            for (const item of response.output) {
                if (item.type === 'reasoning') {
                    let reasoningText = '';
                    if (Array.isArray(item.summary)) {
                        const summaryItem = item.summary.find(s => s.type === 'summary_text');
                        if (summaryItem) reasoningText = summaryItem.text;
                    }
                    if (reasoningText) {
                        content.push({ type: "thinking", thinking: reasoningText });
                    }
                } else if (item.type === 'message') {
                    let contentText = '';
                    if (Array.isArray(item.content)) {
                        const contentItem = item.content.find(c => c.type === 'output_text');
                        if (contentItem) contentText = contentItem.text;
                    }
                    if (contentText) {
                        content.push({ type: "text", text: contentText });
                    }
                } else if (item.type === 'function_call') {
                    stopReason = "tool_use";
                    content.push({
                        type: "tool_use",
                        id: item.call_id || `call_${uuidv4().replace(/-/g, '')}`,
                        name: this.getOriginalToolName(item.name),
                        input: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
                    });
                }
            }
        }

        return {
            id: response.id || `msg_${uuidv4().replace(/-/g, '')}`,
            type: "message",
            role: "assistant",
            model: response.model || model,
            content: content,
            stop_reason: stopReason,
            usage: {
                input_tokens: response.usage?.input_tokens || 0,
                output_tokens: response.usage?.output_tokens || 0
            }
        };
    }

    /**
     * Codex → OpenAI 流式响应块转换
     */
    toOpenAIStreamChunk(chunk, model) {
        const type = chunk.type;
        // 使用固定的 key 来存储当前流的状态
        const stateKey = 'openai_stream_current';
        
        if (!this.streamParams.has(stateKey)) {
            this.streamParams.set(stateKey, {
                model: model,
                createdAt: Math.floor(Date.now() / 1000),
                responseID: chunk.response?.id || `chatcmpl-${Date.now()}`,
                functionCallIndex: 0,  // 初始值为 0，第一个 function_call 的 index 为 0
                isFirstChunk: true  // 标记是否是第一个内容 chunk
            });
        }
        const state = this.streamParams.get(stateKey);

        // 构建模板时使用当前状态中的值
        const buildTemplate = () => ({
            id: state.responseID,
            object: 'chat.completion.chunk',
            created: state.createdAt,
            model: state.model,
            choices: [{
                index: 0,
                delta: {
                    role: 'assistant',
                    content: null,
                    reasoning_content: null,
                    tool_calls: null
                },
                finish_reason: null,
                native_finish_reason: null
            }]
        });

        if (type === 'response.created') {
            // 更新状态中的 responseID
            state.responseID = chunk.response.id;
            state.createdAt = chunk.response.created_at || state.createdAt;
            state.model = chunk.response.model || state.model;
            // 重置 functionCallIndex，确保每个新请求从 0 开始
            state.functionCallIndex = 0;
            state.isFirstChunk = true;
            // response.created 不发送 chunk，等待第一个内容 chunk
            return null;
        }

        if (type === 'response.reasoning_summary_text.delta') {
            const results = [];
            // 如果是第一个内容 chunk，先发送带 role 的 chunk
            if (state.isFirstChunk) {
                const firstTemplate = buildTemplate();
                firstTemplate.choices[0].delta = {
                    role: 'assistant',
                    content: null,
                    reasoning_content: chunk.delta,
                    tool_calls: null
                };
                results.push(firstTemplate);
                state.isFirstChunk = false;
            } else {
                const template = buildTemplate();
                template.choices[0].delta = {
                    role: 'assistant',
                    content: null,
                    reasoning_content: chunk.delta,
                    tool_calls: null
                };
                results.push(template);
            }
            return results.length === 1 ? results[0] : results;
        }

        if (type === 'response.reasoning_summary_text.done') {
            const template = buildTemplate();
            template.choices[0].delta = {
                role: 'assistant',
                content: null,
                reasoning_content: '\n\n',
                tool_calls: null
            };
            return template;
        }

        if (type === 'response.output_text.delta') {
            const results = [];
            // 如果是第一个内容 chunk，先发送带 role 的 chunk
            if (state.isFirstChunk) {
                const firstTemplate = buildTemplate();
                firstTemplate.choices[0].delta = {
                    role: 'assistant',
                    content: chunk.delta,
                    reasoning_content: null,
                    tool_calls: null
                };
                results.push(firstTemplate);
                state.isFirstChunk = false;
            } else {
                const template = buildTemplate();
                template.choices[0].delta = {
                    role: 'assistant',
                    content: chunk.delta,
                    reasoning_content: null,
                    tool_calls: null
                };
                results.push(template);
            }
            return results.length === 1 ? results[0] : results;
        }

        if (type === 'response.output_item.done' && chunk.item?.type === 'function_call') {
            const currentIndex = state.functionCallIndex;
            state.functionCallIndex++;  // 递增，为下一个 function_call 准备
            const template = buildTemplate();
            template.choices[0].delta = {
                role: 'assistant',
                content: null,
                reasoning_content: null,
                tool_calls: [{
                    index: currentIndex,
                    id: chunk.item.call_id,
                    type: 'function',
                    function: {
                        name: this.getOriginalToolName(chunk.item.name),
                        arguments: typeof chunk.item.arguments === 'string' ? chunk.item.arguments : JSON.stringify(chunk.item.arguments)
                    }
                }]
            };
            return template;
        }

        if (type === 'response.completed') {
            const template = buildTemplate();
            const finishReason = state.functionCallIndex > 0 ? 'tool_calls' : 'stop';
            template.choices[0].delta = {
                role: null,
                content: null,
                reasoning_content: null,
                tool_calls: null
            };
            template.choices[0].finish_reason = finishReason;
            template.choices[0].native_finish_reason = finishReason;
            template.usage = {
                prompt_tokens: chunk.response.usage?.input_tokens || 0,
                completion_tokens: chunk.response.usage?.output_tokens || 0,
                total_tokens: chunk.response.usage?.total_tokens || 0
            };
            if (chunk.response.usage?.output_tokens_details?.reasoning_tokens) {
                template.usage.completion_tokens_details = {
                    reasoning_tokens: chunk.response.usage.output_tokens_details.reasoning_tokens
                };
            }
            // 完成后清理状态
            this.streamParams.delete(stateKey);
            return template;
        }

        return null;
    }

    /**
     * Codex → OpenAI Responses 流式响应转换
     */
    toOpenAIResponsesStreamChunk(chunk, model) {
        if(true){
            return chunk;
        }

        const type = chunk.type;
        const resId = chunk.response?.id || 'default';
        
        if (!this.streamParams.has(resId)) {
            this.streamParams.set(resId, {
                model: model,
                createdAt: Math.floor(Date.now() / 1000),
                responseID: resId,
                functionCallIndex: -1,
                eventsSent: new Set()
            });
        }
        const state = this.streamParams.get(resId);
        const events = [];

        if (type === 'response.created') {
            state.responseID = chunk.response.id;
            state.model = chunk.response.model || state.model;
            events.push(
                generateResponseCreated(state.responseID, state.model),
                generateResponseInProgress(state.responseID)
            );
            return events;
        }

        if (type === 'response.reasoning_summary_text.delta') {
            events.push({
                type: "response.reasoning_summary_text.delta",
                response_id: state.responseID,
                delta: chunk.delta
            });
            return events;
        }

        if (type === 'response.output_text.delta') {
            if (!state.eventsSent.has('output_item_added')) {
                events.push(generateOutputItemAdded(state.responseID));
                state.eventsSent.add('output_item_added');
            }
            if (!state.eventsSent.has('content_part_added')) {
                events.push(generateContentPartAdded(state.responseID));
                state.eventsSent.add('content_part_added');
            }
            events.push({
                type: "response.output_text.delta",
                response_id: state.responseID,
                delta: chunk.delta
            });
            return events;
        }

        if (type === 'response.output_item.done' && chunk.item?.type === 'function_call') {
            events.push({
                type: "response.output_item.added",
                response_id: state.responseID,
                item: {
                    id: chunk.item.call_id,
                    type: "function_call",
                    name: this.getOriginalToolName(chunk.item.name),
                    arguments: typeof chunk.item.arguments === 'string' ? chunk.item.arguments : JSON.stringify(chunk.item.arguments),
                    status: "completed"
                }
            });
            events.push({
                type: "response.output_item.done",
                response_id: state.responseID,
                item_id: chunk.item.call_id
            });
            return events;
        }

        if (type === 'response.completed') {
            events.push(
                generateOutputTextDone(state.responseID),
                generateContentPartDone(state.responseID),
                generateOutputItemDone(state.responseID)
            );
            const completedEvent = generateResponseCompleted(state.responseID);
            completedEvent.response.usage = {
                input_tokens: chunk.response.usage?.input_tokens || 0,
                output_tokens: chunk.response.usage?.output_tokens || 0,
                total_tokens: chunk.response.usage?.total_tokens || 0
            };
            events.push(completedEvent);
            this.streamParams.delete(resId);
            return events;
        }

        return null;
    }

    /**
     * Codex → Gemini 流式响应转换
     */
    toGeminiStreamChunk(chunk, model) {
        const type = chunk.type;
        const resId = chunk.response?.id || 'default';
        
        if (!this.streamParams.has(resId)) {
            this.streamParams.set(resId, {
                model: model,
                createdAt: Math.floor(Date.now() / 1000),
                responseID: resId
            });
        }
        const state = this.streamParams.get(resId);

        const template = {
            candidates: [{
                content: {
                    role: "model",
                    parts: []
                }
            }],
            modelVersion: state.model,
            responseId: state.responseID
        };

        if (type === 'response.reasoning_summary_text.delta') {
            template.candidates[0].content.parts.push({ text: chunk.delta, thought: true });
            return template;
        }

        if (type === 'response.output_text.delta') {
            template.candidates[0].content.parts.push({ text: chunk.delta });
            return template;
        }

        if (type === 'response.output_item.done' && chunk.item?.type === 'function_call') {
            template.candidates[0].content.parts.push({
                functionCall: {
                    name: this.getOriginalToolName(chunk.item.name),
                    args: typeof chunk.item.arguments === 'string' ? JSON.parse(chunk.item.arguments) : chunk.item.arguments
                }
            });
            return template;
        }

        if (type === 'response.completed') {
            template.candidates[0].finishReason = "STOP";
            template.usageMetadata = {
                promptTokenCount: chunk.response.usage?.input_tokens || 0,
                candidatesTokenCount: chunk.response.usage?.output_tokens || 0,
                totalTokenCount: chunk.response.usage?.total_tokens || 0
            };
            this.streamParams.delete(resId);
            return template;
        }

        return null;
    }

    /**
     * Codex → Claude 流式响应转换
     */
    toClaudeStreamChunk(chunk, model) {
        const type = chunk.type;
        const resId = chunk.response?.id || 'default';
        
        if (!this.streamParams.has(resId)) {
            this.streamParams.set(resId, {
                model: model,
                createdAt: Math.floor(Date.now() / 1000),
                responseID: resId,
                blockIndex: 0
            });
        }
        const state = this.streamParams.get(resId);

        if (type === 'response.created') {
            state.responseID = chunk.response.id;
            return {
                type: "message_start",
                message: {
                    id: state.responseID,
                    type: "message",
                    role: "assistant",
                    model: state.model,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            };
        }

        if (type === 'response.reasoning_summary_text.delta') {
            return {
                type: "content_block_delta",
                index: state.blockIndex,
                delta: { type: "thinking_delta", thinking: chunk.delta }
            };
        }

        if (type === 'response.output_text.delta') {
            return {
                type: "content_block_delta",
                index: state.blockIndex,
                delta: { type: "text_delta", text: chunk.delta }
            };
        }

        if (type === 'response.output_item.done' && chunk.item?.type === 'function_call') {
            const events = [
                {
                    type: "content_block_start",
                    index: state.blockIndex,
                    content_block: {
                        type: "tool_use",
                        id: chunk.item.call_id,
                        name: this.getOriginalToolName(chunk.item.name),
                        input: {}
                    }
                },
                {
                    type: "content_block_delta",
                    index: state.blockIndex,
                    delta: {
                        type: "input_json_delta",
                        partial_json: typeof chunk.item.arguments === 'string' ? chunk.item.arguments : JSON.stringify(chunk.item.arguments)
                    }
                },
                {
                    type: "content_block_stop",
                    index: state.blockIndex
                }
            ];
            state.blockIndex++;
            return events;
        }

        if (type === 'response.completed') {
            const events = [
                {
                    type: "message_delta",
                    delta: { stop_reason: "end_turn" },
                    usage: {
                        input_tokens: chunk.response.usage?.input_tokens || 0,
                        output_tokens: chunk.response.usage?.output_tokens || 0
                    }
                },
                { type: "message_stop" }
            ];
            this.streamParams.delete(resId);
            return events;
        }

        return null;
    }

}
