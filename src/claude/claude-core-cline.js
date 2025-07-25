import axios from 'axios';

/**
 * Claude API Core Service Class.
 * Encapsulates the interaction logic with the Anthropic Claude API.
 * Currently unavailable.
 */
export class ClaudeApiService {
    /**
     * Constructor
     * @param {string} apiKey - Anthropic Claude API Key.
     * @param {string} baseUrl - Anthropic Claude API Base URL.
     */
    constructor(apiKey, baseUrl) {
        if (!apiKey) {
            throw new Error("Claude API Key is required for ClaudeApiService.");
        }
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.client = this.createClient();
    }

    /**
     * Creates an Axios instance for communication with the Claude API.
     * @returns {object} Axios instance.
     */
    createClient() {
        // 使用 node-fetch 或类似的库来发送 HTTP 请求
        // 假设我们使用原生的 fetch API 或一个兼容的 polyfill
        return axios.create({
            baseURL: this.baseUrl,
            headers: {
                'x-api-key': this.apiKey,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01', // Claude API 版本
            },
        });
    }


    /**
     * Generates content (non-streaming).
     * @param {string} model - Model name.
     * @param {object} requestBody - Request body (Claude format).
     * @returns {Promise<object>} Claude API response (Claude compatible format).
     */
    async generateContent(model, requestBody) {
        // Claude API 的模型名称通常以 "claude-v1.3", "claude-2", "claude-3-opus-20240229" 等形式
        // 需要确保传入的模型名称符合 Claude 的命名规范
        try {
            const response = await this.client.post('/messages', requestBody);
            return response.data;
        } catch (error) {
            console.error("[ClaudeApiService] Error generating content:", error.response ? error.response.data : error.message);
            throw error;
        }
    }

    /**
     * Streams content generation.
     * @param {string} model - Model name.
     * @param {object} requestBody - Request body (Claude format).
     * @returns {AsyncIterable<object>} Claude API response stream (Claude compatible format).
     */
    async *generateContentStream(model, requestBody) {
        try {
            const response = await this.client.post('/messages', { ...requestBody, stream: true }, { responseType: 'stream' });
            const reader = response.data;
            let buffer = '';

            for await (const chunk of reader) {
                buffer += chunk.toString('utf-8');
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                    const eventBlock = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2);

                    const lines = eventBlock.split('\n');
                    let data = '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            data = line.substring(6).trim();
                        }
                    }

                    if (data) {
                        try {
                            const parsedChunk = JSON.parse(data);

                            switch (parsedChunk?.type) {
                                case "message_start":
                                    const usage = parsedChunk.message.usage;
                                    yield {
                                        type: "usage",
                                        inputTokens: usage.input_tokens || 0,
                                        outputTokens: usage.output_tokens || 0,
                                        cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
                                        cacheReadTokens: usage.cache_read_input_tokens || undefined,
                                    };
                                    break;
                                case "message_delta":
                                    yield {
                                        type: "usage",
                                        inputTokens: 0,
                                        outputTokens: parsedChunk.usage.output_tokens || 0,
                                    };
                                    break;
                                case "message_stop":
                                    // No usage data, just an indicator that the message is done
                                    // The return statement below handles stopping the stream
                                    return;
                                case "content_block_start":
                                    switch (parsedChunk.content_block.type) {
                                        case "thinking":
                                            yield {
                                                type: "reasoning",
                                                reasoning: parsedChunk.content_block.thinking || "",
                                            };
                                            break;
                                        case "redacted_thinking":
                                            yield {
                                                type: "reasoning",
                                                reasoning: "[Redacted thinking block]",
                                            };
                                            break;
                                        case "text":
                                            // we may receive multiple text blocks, in which case just insert a line break between them
                                            if (parsedChunk.index > 0) {
                                                yield {
                                                    type: "text",
                                                    text: "\n",
                                                };
                                            }
                                            yield {
                                                type: "text",
                                                text: parsedChunk.content_block.text,
                                            };
                                            break;
                                    }
                                    break;
                                case "content_block_delta":
                                    switch (parsedChunk.delta.type) {
                                        case "thinking_delta":
                                            yield {
                                                type: "reasoning",
                                                reasoning: parsedChunk.delta.thinking,
                                            };
                                            break;
                                        case "text_delta":
                                            yield {
                                                type: "text",
                                                text: parsedChunk.delta.text,
                                            };
                                            break;
                                        case "signature_delta":
                                            // We don't need to do anything with the signature in the client
                                            // It's used when sending the thinking block back to the API
                                            break;
                                    }
                                    break;
                                case "content_block_stop":
                                    break;
                            }
                        } catch (e) {
                            console.warn("[ClaudeApiService] Failed to parse stream chunk JSON:", e.message, "Data:", data);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("[ClaudeApiService] Error generating content stream:", error.response ? error.response.data : error.message);
            throw error;
        }
    }

    /**
     * Lists available models.
     * The Claude API does not have a direct '/models' endpoint; typically, supported models need to be hardcoded.
     * @returns {Promise<object>} List of models.
     */
    async listModels() {
        console.log('[ClaudeApiService] Listing available models.');
        // Claude API 没有直接的 /models 端点来列出所有模型。
        // 通常，你需要根据 Anthropic 的文档硬编码你希望支持的模型。
        // 这里我们返回一些常见的 Claude 模型作为示例。
        const models = [
            { id: "claude-sonnet-4-20250514", name: "claude-sonnet-4-20250514" },
            { id: "claude-opus-4-20250514", name: "claude-opus-4-20250514" },
            { id: "claude-3-7-sonnet-20250219", name: "claude-3-7-sonnet-20250219" },
            { id: "claude-3-5-sonnet-20241022", name: "claude-3-5-sonnet-20241022" },
            { id: "claude-3-5-haiku-20241022", name: "claude-3-5-haiku-20241022" },
            { id: "claude-3-opus-20240229", name: "claude-3-opus-20240229" },
            { id: "claude-3-haiku-20240307", name: "claude-3-haiku-20240307" },
        ];

        return { models: models.map(m => ({ name: m.name })) };
    }
}
