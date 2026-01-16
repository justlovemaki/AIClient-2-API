/**
 * Codex 转换器
 * 处理 OpenAI 协议与 Codex 协议之间的转换
 */

import crypto from 'crypto';
import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';

export class CodexConverter extends BaseConverter {
    constructor() {
        super('codex');
        this.toolNameMap = new Map(); // 工具名称缩短/恢复映射
        this.reverseToolNameMap = new Map(); // 反向映射
    }

    /**
     * 转换请求
     */
    convertRequest(data, targetProtocol) {
        if (targetProtocol === 'codex') {
            return this.toCodexRequest(data);
        } else if (targetProtocol === MODEL_PROTOCOL_PREFIX.OPENAI) {
            // Codex → OpenAI (通常不需要，因为 Codex 响应会直接转换)
            return data;
        }
        throw new Error(`Unsupported target protocol: ${targetProtocol}`);
    }

    /**
     * 转换响应
     */
    convertResponse(data, targetProtocol, model) {
        if (targetProtocol === MODEL_PROTOCOL_PREFIX.OPENAI) {
            return this.toOpenAIResponse(data, model);
        }
        throw new Error(`Unsupported target protocol: ${targetProtocol}`);
    }

    /**
     * 转换流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        if (targetProtocol === MODEL_PROTOCOL_PREFIX.OPENAI) {
            return this.toOpenAIStreamChunk(chunk, model);
        }
        throw new Error(`Unsupported target protocol: ${targetProtocol}`);
    }

    /**
     * OpenAI → Codex 请求转换
     */
    toCodexRequest(data) {
        const codexRequest = {
            model: data.model,
            instructions: this.buildInstructions(data),
            input: this.convertMessages(data.messages || []),
            stream: data.stream || false,
            store: false,
            reasoning: {
                effort: 'medium',
                summary: 'auto'
            },
            parallel_tool_calls: data.parallel_tool_calls !== false,
            include: ['reasoning.encrypted_content']
        };

        // 添加工具
        if (data.tools && data.tools.length > 0) {
            codexRequest.tools = this.convertTools(data.tools);
            codexRequest.tool_choice = data.tool_choice || 'auto';
        }

        // 添加响应格式
        if (data.response_format) {
            codexRequest.text = {
                format: this.convertResponseFormat(data.response_format)
            };
        }

        // 添加推理强度（如果指定）
        if (data.reasoning_effort) {
            codexRequest.reasoning.effort = data.reasoning_effort;
        }

        // 添加温度和其他参数
        if (data.temperature !== undefined) {
            codexRequest.temperature = data.temperature;
        }
        if (data.max_tokens !== undefined) {
            codexRequest.max_output_tokens = data.max_tokens;
        }
        if (data.top_p !== undefined) {
            codexRequest.top_p = data.top_p;
        }

        return codexRequest;
    }

    /**
     * 构建指令
     */
    buildInstructions(data) {
        // 提取系统消息
        const systemMessages = (data.messages || []).filter(m => m.role === 'system');
        if (systemMessages.length > 0) {
            return systemMessages.map(m => {
                if (typeof m.content === 'string') {
                    return m.content;
                } else if (Array.isArray(m.content)) {
                    return m.content
                        .filter(part => part.type === 'text')
                        .map(part => part.text)
                        .join('\n');
                }
                return '';
            }).join('\n');
        }
        return 'You are a helpful assistant.';
    }

    /**
     * 转换消息
     */
    convertMessages(messages) {
        const input = [];
        const nonSystemMessages = messages.filter(m => m.role !== 'system');

        for (const msg of nonSystemMessages) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                input.push({
                    type: 'message',
                    role: msg.role,
                    content: this.convertMessageContent(msg.content, msg.role)
                });

                // 处理助手消息中的工具调用
                if (msg.role === 'assistant' && msg.tool_calls) {
                    for (const toolCall of msg.tool_calls) {
                        const shortName = this.getShortToolName(toolCall.function.name);
                        input.push({
                            type: 'function_call',
                            call_id: toolCall.id,
                            name: shortName,
                            arguments: JSON.parse(toolCall.function.arguments)
                        });
                    }
                }
            } else if (msg.role === 'tool') {
                input.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id,
                    output: msg.content
                });
            }
        }

        return input;
    }

    /**
     * 转换消息内容
     */
    convertMessageContent(content, role) {
        if (typeof content === 'string') {
            return [{
                type: role === 'user' ? 'input_text' : 'output_text',
                text: content
            }];
        }

        if (Array.isArray(content)) {
            return content.map(part => {
                if (part.type === 'text') {
                    return {
                        type: role === 'user' ? 'input_text' : 'output_text',
                        text: part.text
                    };
                } else if (part.type === 'image_url') {
                    return {
                        type: 'input_image',
                        image_url: part.image_url.url
                    };
                }
                return part;
            });
        }

        return [];
    }

    /**
     * 转换工具
     */
    convertTools(tools) {
        this.toolNameMap.clear();
        this.reverseToolNameMap.clear();

        return tools.map(tool => {
            const originalName = tool.function.name;
            const shortName = this.shortenToolName(originalName);

            this.toolNameMap.set(originalName, shortName);
            this.reverseToolNameMap.set(shortName, originalName);

            return {
                type: 'function',
                name: shortName,
                description: tool.function.description,
                parameters: tool.function.parameters
            };
        });
    }

    /**
     * 缩短工具名称（最多 64 字符）
     */
    shortenToolName(name) {
        if (name.length <= 64) {
            return name;
        }

        // 保留 mcp__ 前缀和最后一段
        if (name.startsWith('mcp__')) {
            const parts = name.split('__');
            if (parts.length > 2) {
                const prefix = 'mcp__';
                const lastPart = parts[parts.length - 1];
                const maxLastPartLength = 64 - prefix.length - 1; // -1 for underscore

                if (lastPart.length <= maxLastPartLength) {
                    return prefix + lastPart;
                } else {
                    return prefix + lastPart.slice(0, maxLastPartLength);
                }
            }
        }

        // 使用哈希创建唯一的短名称
        const hash = crypto.createHash('md5').update(name).digest('hex').slice(0, 8);
        return name.slice(0, 55) + '_' + hash;
    }

    /**
     * 获取短工具名称
     */
    getShortToolName(originalName) {
        return this.toolNameMap.get(originalName) || originalName;
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
    toOpenAIResponse(data, model) {
        const response = data.response || data;

        const message = {
            role: 'assistant',
            content: ''
        };

        // 提取文本内容和工具调用
        const textParts = [];
        const toolCalls = [];

        if (response.output) {
            for (const item of response.output) {
                if (item.type === 'message') {
                    for (const content of item.content || []) {
                        if (content.type === 'output_text') {
                            textParts.push(content.text);
                        }
                    }
                } else if (item.type === 'function_call') {
                    const originalName = this.getOriginalToolName(item.name);
                    toolCalls.push({
                        id: item.call_id,
                        type: 'function',
                        function: {
                            name: originalName,
                            arguments: JSON.stringify(item.arguments)
                        }
                    });
                }
            }
        }

        message.content = textParts.join('');
        if (toolCalls.length > 0) {
            message.tool_calls = toolCalls;
        }

        // 提取推理内容
        let reasoningContent = '';
        if (response.output) {
            for (const item of response.output) {
                if (item.summary) {
                    reasoningContent = item.summary;
                    break;
                }
            }
        }

        return {
            id: response.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: message,
                finish_reason: this.mapFinishReason(response.status),
                ...(reasoningContent && { reasoning_content: reasoningContent })
            }],
            usage: {
                prompt_tokens: response.usage?.input_tokens || 0,
                completion_tokens: response.usage?.output_tokens || 0,
                total_tokens: response.usage?.total_tokens || 0,
                ...(response.usage?.input_tokens_details?.cached_tokens && {
                    prompt_tokens_details: {
                        cached_tokens: response.usage.input_tokens_details.cached_tokens
                    }
                }),
                ...(response.usage?.output_tokens_details?.reasoning_tokens && {
                    completion_tokens_details: {
                        reasoning_tokens: response.usage.output_tokens_details.reasoning_tokens
                    }
                })
            }
        };
    }

    /**
     * Codex → OpenAI 流式响应块转换
     */
    toOpenAIStreamChunk(chunk, model) {
        const type = chunk.type;

        // response.created - 存储元数据
        if (type === 'response.created') {
            return {
                id: chunk.response.id,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    delta: { role: 'assistant' },
                    finish_reason: null
                }]
            };
        }

        // response.output_text.delta - 文本内容
        if (type === 'response.output_text.delta') {
            return {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    delta: { content: chunk.delta },
                    finish_reason: null
                }]
            };
        }

        // response.reasoning_summary_text.delta - 推理内容
        if (type === 'response.reasoning_summary_text.delta') {
            return {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    delta: { reasoning_content: chunk.delta },
                    finish_reason: null
                }]
            };
        }

        // response.output_item.done - 工具调用完成
        if (type === 'response.output_item.done' && chunk.item?.type === 'function_call') {
            const originalName = this.getOriginalToolName(chunk.item.name);
            return {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    delta: {
                        tool_calls: [{
                            index: 0,
                            id: chunk.item.call_id,
                            type: 'function',
                            function: {
                                name: originalName,
                                arguments: JSON.stringify(chunk.item.arguments)
                            }
                        }]
                    },
                    finish_reason: null
                }]
            };
        }

        // response.completed - 完成
        if (type === 'response.completed') {
            return {
                id: chunk.response.id,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: this.mapFinishReason(chunk.response.status)
                }],
                usage: {
                    prompt_tokens: chunk.response.usage?.input_tokens || 0,
                    completion_tokens: chunk.response.usage?.output_tokens || 0,
                    total_tokens: chunk.response.usage?.total_tokens || 0,
                    ...(chunk.response.usage?.input_tokens_details?.cached_tokens && {
                        prompt_tokens_details: {
                            cached_tokens: chunk.response.usage.input_tokens_details.cached_tokens
                        }
                    }),
                    ...(chunk.response.usage?.output_tokens_details?.reasoning_tokens && {
                        completion_tokens_details: {
                            reasoning_tokens: chunk.response.usage.output_tokens_details.reasoning_tokens
                        }
                    })
                }
            };
        }

        // 其他事件类型暂时忽略
        return null;
    }

    /**
     * 映射完成原因
     */
    mapFinishReason(status) {
        const mapping = {
            'completed': 'stop',
            'incomplete': 'length',
            'failed': 'error',
            'cancelled': 'stop'
        };
        return mapping[status] || 'stop';
    }

    /**
     * 转换模型列表
     */
    convertModelList(data, targetProtocol) {
        // Codex 使用 OpenAI 格式的模型列表，无需转换
        return data;
    }
}
