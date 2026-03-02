/**
 * Grok转换器
 * 处理Grok协议与其他协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger.js';
import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';

/**
 * Grok转换器类
 * 实现Grok协议到其他协议的转换
 */
export class GrokConverter extends BaseConverter {
    // 静态属性，确保所有实例共享最新的基础 URL 和 UUID 配置
    static sharedRequestBaseUrl = "";
    static sharedUuid = null;

    constructor() {
        super('grok');
        // 用于跟踪每个请求的状态
        this.requestStates = new Map();
    }

    /**
     * 设置请求的基础 URL
     */
    setRequestBaseUrl(baseUrl) {
        if (baseUrl) {
            GrokConverter.sharedRequestBaseUrl = baseUrl;
        }
    }

    /**
     * 设置账号的 UUID
     */
    setUuid(uuid) {
        if (uuid) {
            GrokConverter.sharedUuid = uuid;
        }
    }

    /**
     * 为 assets.grok.com 域名的资源 URL 添加 uuid 参数，并转换为本地代理 URL
     */
    _appendSsoToken(url, state = null) {
        const requestBaseUrl = state?.requestBaseUrl || GrokConverter.sharedRequestBaseUrl;
        const uuid = state?.uuid || GrokConverter.sharedUuid;

        if (!url || !uuid) return url;
        
        // 检查是否为 assets.grok.com 域名或相对路径
        const isGrokAsset = url.includes('assets.grok.com') || (!url.startsWith('http') && !url.startsWith('data:'));
        
        if (!isGrokAsset) return url;

        // 构造完整的原始 URL
        let originalUrl = url;
        if (!url.startsWith('http')) {
            originalUrl = `https://assets.grok.com${url.startsWith('/') ? '' : '/'}${url}`;
        }

        // 返回本地代理接口 URL
        // 使用 uuid 以提高安全性，防止 token 泄露在链接中
        const authParam = `uuid=${encodeURIComponent(uuid)}`;

        const proxyPath = `/api/grok/assets?url=${encodeURIComponent(originalUrl)}&${authParam}`;
        if (requestBaseUrl) {
            return `${requestBaseUrl}${proxyPath}`;
        }
        return proxyPath;
    }

    /**
     * 在文本中查找并替换所有 assets.grok.com 的资源链接为绝对代理链接
     */
    _processGrokAssetsInText(text, state = null) {
        const uuid = state?.uuid || GrokConverter.sharedUuid;
        if (!text || !uuid) return text;
        
        // 更宽松的正则匹配 assets.grok.com 的 URL
        const grokUrlRegex = /https?:\/\/assets\.grok\.com\/[^\s\)\"\'\>]+/g;
        
        return text.replace(grokUrlRegex, (url) => {
            return this._appendSsoToken(url, state);
        });
    }

    /**
     * 获取或初始化请求状态
     */
    _getState(requestId) {
        if (!this.requestStates.has(requestId)) {
            this.requestStates.set(requestId, {
                think_opened: false,
                image_think_active: false,
                video_think_active: false,
                role_sent: false,
                tool_buffer: "",
                last_is_thinking: false,
                fingerprint: "",
                content_buffer: "", // 用于缓存内容以解析工具调用
                has_tool_call: false,
                rollout_id: "",
                in_tool_call: false, // 是否处于 <tool_call> 块内
                requestBaseUrl: "",
                uuid: null,
                pending_text_buffer: "" // 用于处理流式输出中被截断的 URL
            });
        }
        return this.requestStates.get(requestId);
    }

    /**
     * 构建工具系统提示词 (build_tool_prompt)
     */
    buildToolPrompt(tools, toolChoice = "auto", parallelToolCalls = true) {
        if (!tools || tools.length === 0 || toolChoice === "none") {
            return "";
        }

        const lines = [
            "# Available Tools",
            "",
            "You have access to the following tools. To call a tool, output a <tool_call> block with a JSON object containing \"name\" and \"arguments\".",
            "",
            "Format:",
            "<tool_call>",
            '{"name": "function_name", "arguments": {"param": "value"}}',
            "</tool_call>",
            "",
        ];

        if (parallelToolCalls) {
            lines.push("You may make multiple tool calls in a single response by using multiple <tool_call> blocks.");
            lines.push("");
        }

        lines.push("## Tool Definitions");
        lines.push("");
        for (const tool of tools) {
            if (tool.type !== "function") continue;
            const func = tool.function || {};
            lines.push(`### ${func.name}`);
            if (func.description) lines.push(func.description);
            if (func.parameters) lines.push(`Parameters: ${JSON.stringify(func.parameters)}`);
            lines.push("");
        }

        if (toolChoice === "required") {
            lines.push("IMPORTANT: You MUST call at least one tool in your response. Do not respond with only text.");
        } else if (typeof toolChoice === 'object' && toolChoice.function?.name) {
            lines.push(`IMPORTANT: You MUST call the tool "${toolChoice.function.name}" in your response.`);
        } else {
            lines.push("Decide whether to call a tool based on the user's request. If you don't need a tool, respond normally with text only.");
        }

        lines.push("");
        lines.push("When you call a tool, you may include text before or after the <tool_call> blocks, but the tool call blocks must be valid JSON.");

        return lines.join("\n");
    }

    /**
     * 格式化工具历史 (format_tool_history)
     */
    formatToolHistory(messages) {
        const result = [];
        for (const msg of messages) {
            const role = msg.role;
            const content = msg.content;
            const toolCalls = msg.tool_calls;

            if (role === "assistant" && toolCalls && toolCalls.length > 0) {
                const parts = [];
                if (content) parts.push(typeof content === 'string' ? content : JSON.stringify(content));
                for (const tc of toolCalls) {
                    const func = tc.function || {};
                    parts.push(`<tool_call>{"name":"${func.name}","arguments":${func.arguments || "{}"}}</tool_call>`);
                }
                result.push({ role: "assistant", content: parts.join("\n") });
            } else if (role === "tool") {
                const toolName = msg.name || "unknown";
                const callId = msg.tool_call_id || "";
                const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                result.push({
                    role: "user",
                    content: `tool (${toolName}, ${callId}): ${contentStr}`
                });
            } else {
                result.push(msg);
            }
        }
        return result;
    }

    /**
     * 解析工具调用 (parse_tool_calls)
     */
    parseToolCalls(content) {
        if (!content) return { text: content, toolCalls: null };

        const toolCallRegex = /<tool_call>\s*(.*?)\s*<\/tool_call>/gs;
        const matches = [...content.matchAll(toolCallRegex)];
        
        if (matches.length === 0) return { text: content, toolCalls: null };

        const toolCalls = [];
        for (const match of matches) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (parsed.name) {
                    let args = parsed.arguments || {};
                    const argumentsStr = typeof args === 'string' ? args : JSON.stringify(args);
                    
                    toolCalls.push({
                        id: `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
                        type: "function",
                        function: {
                            name: parsed.name,
                            arguments: argumentsStr
                        }
                    });
                }
            } catch (e) {
                // 忽略解析失败的块
            }
        }

        if (toolCalls.length === 0) return { text: content, toolCalls: null };

        // 提取文本内容
        let text = content;
        for (const match of matches) {
            text = text.replace(match[0], "");
        }
        text = text.trim() || null;

        return { text, toolCalls };
    }

    /**
     * 转换请求
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            default:
                return data;
        }
    }

    /**
     * 转换响应
     */
    convertResponse(data, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexResponse(data, model);
            default:
                return data;
        }
    }

    /**
     * 转换流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexStreamChunk(chunk, model);
            default:
                return chunk;
        }
    }

    /**
     * 转换模型列表
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiModelList(data);
            default:
                return data;
        }
    }

    /**
     * 构建工具覆盖配置 (build_tool_overrides)
     */
    buildToolOverrides(tools) {
        if (!tools || !Array.isArray(tools)) {
            return {};
        }

        const toolOverrides = {};
        for (const tool of tools) {
            if (tool.type !== "function") continue;
            const func = tool.function || {};
            const name = func.name;
            if (!name) continue;
            
            toolOverrides[name] = {
                "enabled": true,
                "description": func.description || "",
                "parameters": func.parameters || {}
            };
        }

        return toolOverrides;
    }

    /**
     * 递归收集响应中的图片 URL
     */
    _collectImages(obj) {
        const urls = [];
        const seen = new Set();

        const add = (url) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            urls.push(url);
        };

        const walk = (value) => {
            if (value && typeof value === 'object') {
                if (Array.isArray(value)) {
                    value.forEach(walk);
                } else {
                    for (const [key, item] of Object.entries(value)) {
                        if (key === "generatedImageUrls" || key === "imageUrls" || key === "imageURLs") {
                            if (Array.isArray(item)) {
                                item.forEach(url => typeof url === 'string' && add(url));
                            } else if (typeof item === 'string') {
                                add(item);
                            }
                            continue;
                        }
                        walk(item);
                    }
                }
            }
        };

        walk(obj);
        return urls;
    }

    /**
     * 渲染图片为 Markdown
     */
    _renderImage(url, imageId = "image", state = null) {
        let finalUrl = url;
        if (!url.startsWith('http')) {
            finalUrl = `https://assets.grok.com${url.startsWith('/') ? '' : '/'}${url}`;
        }
        finalUrl = this._appendSsoToken(finalUrl, state);
        return `![${imageId}](${finalUrl})`;
    }

    /**
     * 渲染视频为 Markdown/HTML (render_video)
     */
    _renderVideo(videoUrl, thumbnailImageUrl = "", state = null) {
        let finalVideoUrl = videoUrl;
        if (!videoUrl.startsWith('http')) {
            finalVideoUrl = `https://assets.grok.com${videoUrl.startsWith('/') ? '' : '/'}${videoUrl}`;
        }
        
        let finalThumbUrl = thumbnailImageUrl;
        if (thumbnailImageUrl && !thumbnailImageUrl.startsWith('http')) {
            finalThumbUrl = `https://assets.grok.com${thumbnailImageUrl.startsWith('/') ? '' : '/'}${thumbnailImageUrl}`;
        }

        const defaultThumb = 'https://assets.grok.com/favicon.ico';
        return `\n[![video](${finalThumbUrl || defaultThumb})](${finalVideoUrl})\n[Play Video](${finalVideoUrl})\n`;
    }

    /**
     * 提取工具卡片文本 (extract_tool_text)
     */
    _extractToolText(raw, rolloutId = "") {
        if (!raw) return "";
        
        const nameMatch = raw.match(/<xai:tool_name>(.*?)<\/xai:tool_name>/s);
        const argsMatch = raw.match(/<xai:tool_args>(.*?)<\/xai:tool_args>/s);

        let name = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() : "";
        let args = argsMatch ? argsMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() : "";

        let payload = null;
        if (args) {
            try {
                payload = JSON.parse(args);
            } catch (e) {
                payload = null;
            }
        }

        let label = name;
        let text = args;
        const prefix = rolloutId ? `[${rolloutId}]` : "";

        if (name === "web_search") {
            label = `${prefix}[WebSearch]`;
            if (payload && typeof payload === 'object') {
                text = payload.query || payload.q || "";
            }
        } else if (name === "search_images") {
            label = `${prefix}[SearchImage]`;
            if (payload && typeof payload === 'object') {
                text = payload.image_description || payload.description || payload.query || "";
            }
        } else if (name === "chatroom_send") {
            label = `${prefix}[AgentThink]`;
            if (payload && typeof payload === 'object') {
                text = payload.message || "";
            }
        }

        if (label && text) return `${label} ${text}`.trim();
        if (label) return label;
        if (text) return text;
        return raw.replace(/<[^>]+>/g, "").trim();
    }

    /**
     * 过滤特殊标签
     */
    _filterToken(token, requestId = "") {
        if (!token) return token;
        
        let filtered = token;

        // 移除 xai:tool_usage_card 及其内容，不显示工具调用的过程输出
        filtered = filtered.replace(/<xai:tool_usage_card[^>]*>.*?<\/xai:tool_usage_card>/gs, "");
        filtered = filtered.replace(/<xai:tool_usage_card[^>]*\/>/gs, "");
        
        // 移除其他内部标签
        const tagsToFilter = ["rolloutId", "responseId", "isThinking"];
        for (const tag of tagsToFilter) {
            const pattern = new RegExp(`<${tag}[^>]*>.*?<\\/${tag}>|<${tag}[^>]*\\/>`, 'gs');
            filtered = filtered.replace(pattern, "");
        }

        return filtered;
    }

    /**
     * Grok响应 -> OpenAI响应
     */
    toOpenAIResponse(grokResponse, model) {
        if (!grokResponse) return null;

        const responseId = grokResponse.responseId || `chatcmpl-${uuidv4()}`;
        let content = grokResponse.message || "";
        const modelHash = grokResponse.llmInfo?.modelHash || "";
        
        const state = this._getState(this._formatResponseId(responseId));
        if (grokResponse._requestBaseUrl) {
            state.requestBaseUrl = grokResponse._requestBaseUrl;
        }
        if (grokResponse._uuid) {
            state.uuid = grokResponse._uuid;
        }

        // 过滤内容并处理其中的 Grok 资源链接
        content = this._filterToken(content, responseId);
        content = this._processGrokAssetsInText(content, state);

        // 收集图片并追加
        const imageUrls = this._collectImages(grokResponse);
        if (imageUrls.length > 0) {
            content += "\n";
            for (const url of imageUrls) {
                content += this._renderImage(url, "image", state) + "\n";
            }
        }

        // 处理视频 (非流式模式)
        if (grokResponse.finalVideoUrl) {
            content += this._renderVideo(grokResponse.finalVideoUrl, grokResponse.finalThumbnailUrl, state);
        }

        // 解析工具调用
        const { text, toolCalls } = this.parseToolCalls(content);

        const result = {
            id: responseId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            system_fingerprint: modelHash,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: text,
                },
                finish_reason: toolCalls ? "tool_calls" : "stop",
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            },
        };

        if (toolCalls) {
            result.choices[0].message.tool_calls = toolCalls;
        }

        return result;
    }

    _formatResponseId(id) {
        if (!id) return `chatcmpl-${uuidv4()}`;
        if (id.startsWith('chatcmpl-')) return id;
        return `chatcmpl-${id}`;
    }

    /**
     * Grok流式响应块 -> OpenAI流式响应块
     */
    toOpenAIStreamChunk(grokChunk, model) {
        if (!grokChunk || !grokChunk.result || !grokChunk.result.response) {
            return null;
        }

        const resp = grokChunk.result.response;
        const rawResponseId = resp.responseId || "";
        const responseId = this._formatResponseId(rawResponseId);
        const state = this._getState(responseId);
        
        // 从响应块中同步 uuid 和基础 URL
        if (resp._requestBaseUrl) {
            state.requestBaseUrl = resp._requestBaseUrl;
        }
        if (resp._uuid) {
            state.uuid = resp._uuid;
        }

        if (resp.llmInfo?.modelHash && !state.fingerprint) {
            state.fingerprint = resp.llmInfo.modelHash;
        }
        if (resp.rolloutId) {
            state.rollout_id = String(resp.rolloutId);
        }

        const chunks = [];

        // 0. 发送角色信息（仅第一次）
        if (!state.role_sent) {
            chunks.push({
                id: responseId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                system_fingerprint: state.fingerprint,
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "" },
                    finish_reason: null
                }]
            });
            state.role_sent = true;
        }

        // 处理结束标志
        if (resp.isDone) {
            let finalContent = "";
            // 处理剩余的缓冲区
            if (state.pending_text_buffer) {
                finalContent += this._processGrokAssetsInText(state.pending_text_buffer, state);
                state.pending_text_buffer = "";
            }

            // 处理 buffer 中的工具调用
            const { text, toolCalls } = this.parseToolCalls(state.content_buffer);
            
            if (toolCalls) {
                chunks.push({
                    id: responseId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    system_fingerprint: state.fingerprint,
                    choices: [{
                        index: 0,
                        delta: { 
                            content: (finalContent + (text || "")).trim() || null,
                            tool_calls: toolCalls 
                        },
                        finish_reason: "tool_calls"
                    }]
                });
            } else {
                chunks.push({
                    id: responseId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    system_fingerprint: state.fingerprint,
                    choices: [{
                        index: 0,
                        delta: { content: finalContent || null },
                        finish_reason: "stop"
                    }]
                });
            }

            // 清理状态
            this.requestStates.delete(responseId);
            return chunks;
        }

        let deltaContent = "";
        let deltaReasoning = "";

        // 1. 处理图片生成进度
        if (resp.streamingImageGenerationResponse) {
            const img = resp.streamingImageGenerationResponse;
            state.image_think_active = true;
            /* 
            if (!state.think_opened) {
                deltaReasoning += "<think>\n";
                state.think_opened = true;
            }
            */
            const idx = (img.imageIndex || 0) + 1;
            const progress = img.progress || 0;
            deltaReasoning += `正在生成第${idx}张图片中，当前进度${progress}%\n`;
        }

        // 2. 处理视频生成进度 (VideoStreamProcessor)
        if (resp.streamingVideoGenerationResponse) {
            const vid = resp.streamingVideoGenerationResponse;
            state.video_think_active = true;
            /*
            if (!state.think_opened) {
                deltaReasoning += "<think>\n";
                state.think_opened = true;
            }
            */
            const progress = vid.progress || 0;
            deltaReasoning += `正在生成视频中，当前进度${progress}%\n`;

            if (progress === 100 && vid.videoUrl) {
                /*
                if (state.think_opened) {
                    deltaContent += "\n</think>\n";
                    state.think_opened = false;
                }
                */
                state.video_think_active = false;
                deltaContent += this._renderVideo(vid.videoUrl, vid.thumbnailImageUrl, state);
            }
        }

        // 3. 处理模型响应（通常包含完整消息或图片）
        if (resp.modelResponse) {
            const mr = resp.modelResponse;
            /*
            if ((state.image_think_active || state.video_think_active) && state.think_opened) {
                deltaContent += "\n</think>\n";
                state.think_opened = false;
            }
            */
            state.image_think_active = false;
            state.video_think_active = false;

            const imageUrls = this._collectImages(mr);
            for (const url of imageUrls) {
                deltaContent += this._renderImage(url, "image", state) + "\n";
            }

            if (mr.metadata?.llm_info?.modelHash) {
                state.fingerprint = mr.metadata.llm_info.modelHash;
            }
        }

        // 4. 处理卡片附件
        if (resp.cardAttachment) {
            const card = resp.cardAttachment;
            if (card.jsonData) {
                try {
                    const cardData = JSON.parse(card.jsonData);
                    let original = cardData.image?.original;
                    const title = cardData.image?.title || "image";
                    if (original) {
                        // 确保是绝对路径
                        if (!original.startsWith('http')) {
                            original = `https://assets.grok.com${original.startsWith('/') ? '' : '/'}${original}`;
                        }
                        original = this._appendSsoToken(original, state);
                        deltaContent += `![${title}](${original})\n`;
                    }
                } catch (e) {
                    // 忽略 JSON 解析错误
                }
            }
        }

        // 5. 处理普通 Token 和 思考状态
        if (resp.token !== undefined && resp.token !== null) {
            const token = resp.token;
            const filtered = this._filterToken(token, responseId);
            const isThinking = !!resp.isThinking;
            const inThink = isThinking || state.image_think_active || state.video_think_active;

            if (inThink) {
                deltaReasoning += filtered;
            } else {
                // 将新 token 加入待处理缓冲区，解决 URL 被截断的问题
                state.pending_text_buffer += filtered;
                
                let outputFromBuffer = "";
                
                // 启发式逻辑：检查缓冲区是否包含完整的 URL
                if (state.pending_text_buffer.includes("https://assets.grok.com")) {
                    const lastUrlIndex = state.pending_text_buffer.lastIndexOf("https://assets.grok.com");
                    const textAfterUrl = state.pending_text_buffer.slice(lastUrlIndex);
                    
                    // 检查 URL 是否结束（空格、右括号、引号、换行、大于号等）
                    const terminatorMatch = textAfterUrl.match(/[\s\)\"\'\>\n]/);
                    if (terminatorMatch) {
                        // URL 已结束，可以安全地处理并输出缓冲区
                        outputFromBuffer = this._processGrokAssetsInText(state.pending_text_buffer, state);
                        state.pending_text_buffer = "";
                    } else if (state.pending_text_buffer.length > 1000) {
                        // 缓冲区过长，强制处理输出，避免过度延迟
                        outputFromBuffer = this._processGrokAssetsInText(state.pending_text_buffer, state);
                        state.pending_text_buffer = "";
                    }
                } else {
                    // 不包含 Grok URL，直接输出
                    outputFromBuffer = state.pending_text_buffer;
                    state.pending_text_buffer = "";
                }

                if (outputFromBuffer) {
                    // 工具调用抑制逻辑：不向客户端输出 <tool_call> 块及其内容
                    let outputToken = outputFromBuffer;
                    
                    // 简单的状态切换检测
                    if (outputToken.includes('<tool_call>')) {
                        state.in_tool_call = true;
                        state.has_tool_call = true;
                        // 移除标签之后的部分（如果有）
                        outputToken = outputToken.split('<tool_call>')[0];
                    } else if (state.in_tool_call && outputToken.includes('</tool_call>')) {
                        state.in_tool_call = false;
                        // 只保留标签之后的部分
                        outputToken = outputToken.split('</tool_call>')[1] || "";
                    } else if (state.in_tool_call) {
                        // 处于块内，完全抑制
                        outputToken = "";
                    }

                    deltaContent += outputToken;
                }
                
                // 将内容加入 buffer 用于最终解析工具调用
                state.content_buffer += filtered;
            }
            state.last_is_thinking = isThinking;
        }

        if (deltaContent || deltaReasoning) {
            const delta = {};
            if (deltaContent) delta.content = deltaContent;
            if (deltaReasoning) delta.reasoning_content = deltaReasoning;

            chunks.push({
                id: responseId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                system_fingerprint: state.fingerprint,
                choices: [{
                    index: 0,
                    delta: delta,
                    finish_reason: null
                }]
            });
        }

        return chunks.length > 0 ? chunks : null;
    }

    /**
     * Grok响应 -> Gemini响应
     */
    toGeminiResponse(grokResponse, model) {
        const openaiRes = this.toOpenAIResponse(grokResponse, model);
        if (!openaiRes) return null;

        const choice = openaiRes.choices[0];
        const message = choice.message;
        const parts = [];

        if (message.reasoning_content) {
            parts.push({ text: message.reasoning_content, thought: true });
        }

        if (message.content) {
            parts.push({ text: message.content });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                parts.push({
                    functionCall: {
                        name: tc.function.name,
                        args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
                    }
                });
            }
        }

        return {
            candidates: [{
                content: {
                    role: 'model',
                    parts: parts
                },
                finishReason: choice.finish_reason === 'tool_calls' ? 'STOP' : (choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP')
            }],
            usageMetadata: {
                promptTokenCount: openaiRes.usage.prompt_tokens,
                candidatesTokenCount: openaiRes.usage.completion_tokens,
                totalTokenCount: openaiRes.usage.total_tokens
            }
        };
    }

    /**
     * Grok流式响应块 -> Gemini流式响应块
     */
    toGeminiStreamChunk(grokChunk, model) {
        const openaiChunks = this.toOpenAIStreamChunk(grokChunk, model);
        if (!openaiChunks) return null;

        const geminiChunks = [];
        for (const oachunk of openaiChunks) {
            const choice = oachunk.choices[0];
            const delta = choice.delta;
            const parts = [];

            if (delta.reasoning_content) {
                parts.push({ text: delta.reasoning_content, thought: true });
            }
            if (delta.content) {
                parts.push({ text: delta.content });
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: tc.function.name,
                            args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
                        }
                    });
                }
            }

            if (parts.length > 0 || choice.finish_reason) {
                const gchunk = {
                    candidates: [{
                        content: {
                            role: 'model',
                            parts: parts
                        }
                    }]
                };
                if (choice.finish_reason) {
                    gchunk.candidates[0].finishReason = choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP';
                }
                geminiChunks.push(gchunk);
            }
        }

        return geminiChunks.length > 0 ? geminiChunks : null;
    }

    /**
     * Grok响应 -> OpenAI Responses响应
     */
    toOpenAIResponsesResponse(grokResponse, model) {
        const openaiRes = this.toOpenAIResponse(grokResponse, model);
        if (!openaiRes) return null;

        const choice = openaiRes.choices[0];
        const message = choice.message;
        const output = [];

        const content = [];
        if (message.content) {
            content.push({
                type: "output_text",
                text: message.content
            });
        }

        output.push({
            id: `msg_${uuidv4().replace(/-/g, '')}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: content
        });

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                output.push({
                    id: tc.id,
                    type: "function_call",
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                    status: "completed"
                });
            }
        }

        return {
            id: `resp_${uuidv4().replace(/-/g, '')}`,
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            status: "completed",
            model: model,
            output: output,
            usage: {
                input_tokens: openaiRes.usage.prompt_tokens,
                output_tokens: openaiRes.usage.completion_tokens,
                total_tokens: openaiRes.usage.total_tokens
            }
        };
    }

    /**
     * Grok流式响应块 -> OpenAI Responses流式响应块
     */
    toOpenAIResponsesStreamChunk(grokChunk, model) {
        const openaiChunks = this.toOpenAIStreamChunk(grokChunk, model);
        if (!openaiChunks) return null;

        const events = [];
        for (const oachunk of openaiChunks) {
            const choice = oachunk.choices[0];
            const delta = choice.delta;

            if (delta.role === 'assistant') {
                events.push({ type: "response.created", response: { id: oachunk.id, model: model } });
            }

            if (delta.reasoning_content) {
                events.push({
                    type: "response.reasoning_summary_text.delta",
                    delta: delta.reasoning_content,
                    response_id: oachunk.id
                });
            }

            if (delta.content) {
                events.push({
                    type: "response.output_text.delta",
                    delta: delta.content,
                    response_id: oachunk.id
                });
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.function?.name) {
                        events.push({
                            type: "response.output_item.added",
                            item: { id: tc.id, type: "function_call", name: tc.function.name, arguments: "" },
                            response_id: oachunk.id
                        });
                    }
                    if (tc.function?.arguments) {
                        events.push({
                            type: "response.custom_tool_call_input.delta",
                            delta: tc.function.arguments,
                            item_id: tc.id,
                            response_id: oachunk.id
                        });
                    }
                }
            }

            if (choice.finish_reason) {
                events.push({ type: "response.completed", response: { id: oachunk.id, status: "completed" } });
            }
        }

        return events;
    }

    /**
     * Grok响应 -> Codex响应
     */
    toCodexResponse(grokResponse, model) {
        const openaiRes = this.toOpenAIResponse(grokResponse, model);
        if (!openaiRes) return null;

        const choice = openaiRes.choices[0];
        const message = choice.message;
        const output = [];

        if (message.content) {
            output.push({
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: message.content }]
            });
        }

        if (message.reasoning_content) {
            output.push({
                type: "reasoning",
                summary: [{ type: "summary_text", text: message.reasoning_content }]
            });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                output.push({
                    type: "function_call",
                    call_id: tc.id,
                    name: tc.function.name,
                    arguments: tc.function.arguments
                });
            }
        }

        return {
            response: {
                id: openaiRes.id,
                output: output,
                usage: {
                    input_tokens: openaiRes.usage.prompt_tokens,
                    output_tokens: openaiRes.usage.completion_tokens,
                    total_tokens: openaiRes.usage.total_tokens
                }
            }
        };
    }

    /**
     * Grok流式响应块 -> Codex流式响应块
     */
    toCodexStreamChunk(grokChunk, model) {
        const openaiChunks = this.toOpenAIStreamChunk(grokChunk, model);
        if (!openaiChunks) return null;

        const codexChunks = [];
        for (const oachunk of openaiChunks) {
            const choice = oachunk.choices[0];
            const delta = choice.delta;

            if (delta.role === 'assistant') {
                codexChunks.push({ type: "response.created", response: { id: oachunk.id } });
            }

            if (delta.reasoning_content) {
                codexChunks.push({
                    type: "response.reasoning_summary_text.delta",
                    delta: delta.reasoning_content,
                    response: { id: oachunk.id }
                });
            }

            if (delta.content) {
                codexChunks.push({
                    type: "response.output_text.delta",
                    delta: delta.content,
                    response: { id: oachunk.id }
                });
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.function?.arguments) {
                        codexChunks.push({
                            type: "response.custom_tool_call_input.delta",
                            delta: tc.function.arguments,
                            item_id: tc.id,
                            response: { id: oachunk.id }
                        });
                    }
                }
            }

            if (choice.finish_reason) {
                codexChunks.push({ type: "response.completed", response: { id: oachunk.id, usage: oachunk.usage } });
            }
        }

        return codexChunks.length > 0 ? codexChunks : null;
    }

    /**
     * Grok模型列表 -> OpenAI模型列表
     */
    toOpenAIModelList(grokModels) {
        const models = Array.isArray(grokModels) ? grokModels : (grokModels?.models || grokModels?.data || []);
        return {
            object: "list",
            data: models.map(m => ({
                id: m.id || m.name || (typeof m === 'string' ? m : ''),
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: "xai",
                display_name: m.display_name || m.name || m.id || (typeof m === 'string' ? m : ''),
            })),
        };
    }

    /**
     * Grok模型列表 -> Gemini模型列表
     */
    toGeminiModelList(grokModels) {
        const models = Array.isArray(grokModels) ? grokModels : (grokModels?.models || grokModels?.data || []);
        return {
            models: models.map(m => ({
                name: `models/${m.id || m.name || (typeof m === 'string' ? m : '')}`,
                version: "1.0",
                displayName: m.display_name || m.name || m.id || (typeof m === 'string' ? m : ''),
                description: m.description || `Grok model: ${m.name || m.id || (typeof m === 'string' ? m : '')}`,
                inputTokenLimit: 131072,
                outputTokenLimit: 8192,
                supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
            }))
        };
    }
}
