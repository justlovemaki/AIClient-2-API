import axios from 'axios';
import * as http from 'http';
import * as https from 'https';
import { configureAxiosProxy } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError } from '../../utils/common.js';

/**
 * Claude API Core Service Class.
 * Encapsulates the interaction logic with the Anthropic Claude API.
 */
export class ClaudeApiService {
    /**
     * Constructor
     * @param {string} apiKey - Anthropic Claude API Key.
     * @param {string} baseUrl - Anthropic Claude API Base URL.
     */
    constructor(config) {
        if (!config.CLAUDE_API_KEY) {
            throw new Error("Claude API Key is required for ClaudeApiService.");
        }
        this.config = config;
        this.apiKey = config.CLAUDE_API_KEY;
        this.baseUrl = config.CLAUDE_BASE_URL;
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_CLAUDE ?? false;
        console.log(`[Claude] System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);
        this.client = this.createClient();
    }

    /**
     * Creates an Axios instance for communication with the Claude API.
     * @returns {object} Axios instance.
     */
    createClient() {
        // 配置 HTTP/HTTPS agent 限制连接池大小，避免资源泄漏
        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 120000,
        });
        const httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 120000,
        });

        const axiosConfig = {
            baseURL: this.baseUrl,
            httpAgent,
            httpsAgent,
            headers: {
                'x-api-key': this.apiKey,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01', // Claude API 版本
            },
        };
        
        // 禁用系统代理以避免HTTPS代理错误
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        // 配置自定义代理
        configureAxiosProxy(axiosConfig, this.config, 'claude-custom');
        
        return axios.create(axiosConfig);
    }

    /**
     * Generic method to call the Claude API, with retry mechanism.
     * @param {string} endpoint - API endpoint, e.g., '/messages'.
     * @param {object} body - Request body.
     * @param {boolean} isRetry - Whether it's a retry call.
     * @param {number} retryCount - Current retry count.
     * @returns {Promise<object>} API response data.
     */
    async callApi(endpoint, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        try {
            const response = await this.client.post(endpoint, body);
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            // 对于 Claude API，401 通常意味着 API Key 无效，不进行重试
            if (status === 401 || status === 403) {
                console.error(`[Claude API] Received ${status}. API Key might be invalid or expired.`);
                throw error;
            }

            // 处理 429 (Too Many Requests) 与指数退避
            if (status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Claude API] Received 429 (Too Many Requests). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, isRetry, retryCount + 1);
            }

            // 处理其他可重试错误 (5xx 服务器错误)
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Claude API] Received ${status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, isRetry, retryCount + 1);
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                console.log(`[Claude API] Network error (${errorIdentifier}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, isRetry, retryCount + 1);
            }

            console.error(`[Claude API] Error calling API (Status: ${status}, Code: ${errorCode}):`, error.response ? error.response.data : error.message);
            throw error;
        }
    }

    /**
     * Generic method to stream from the Claude API, with retry mechanism.
     * @param {string} endpoint - API endpoint, e.g., '/messages'.
     * @param {object} body - Request body.
     * @param {boolean} isRetry - Whether it's a retry call.
     * @param {number} retryCount - Current retry count.
     * @returns {AsyncIterable<object>} API response stream.
     */
    async *streamApi(endpoint, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        try {
            const response = await this.client.post(endpoint, { ...body, stream: true }, { responseType: 'stream' });
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
                            yield parsedChunk;
                            if (parsedChunk.type === 'message_stop') {
                                return;
                            }
                        } catch (e) {
                            console.warn("[ClaudeApiService] Failed to parse stream chunk JSON:", e.message, "Data:", data);
                        }
                    }
                }
            }
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            // 对于 Claude API，401 通常意味着 API Key 无效，不进行重试
            if (status === 401 || status === 403) {
                console.error(`[Claude API] Received ${status} during stream. API Key might be invalid or expired.`);
                throw error;
            }

            // 处理 429 (Too Many Requests) 与指数退避
            if (status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Claude API] Received 429 (Too Many Requests) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, isRetry, retryCount + 1);
                return;
            }

            // 处理其他可重试错误 (5xx 服务器错误)
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Claude API] Received ${status} server error during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, isRetry, retryCount + 1);
                return;
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                console.log(`[Claude API] Network error (${errorIdentifier}) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, isRetry, retryCount + 1);
                return;
            }

            console.error(`[Claude API] Error generating content stream (Status: ${status}, Code: ${errorCode}):`, error.response ? error.response.data : error.message);
            throw error;
        }
    }

    /**
     * Generates content (non-streaming).
     * @param {string} model - Model name.
     * @param {object} requestBody - Request body (Claude format).
     * @returns {Promise<object>} Claude API response (Claude compatible format).
     */
    async generateContent(model, requestBody) {
        const response = await this.callApi('/messages', requestBody);
        return response;
    }

    /**
     * Streams content generation.
     * @param {string} model - Model name.
     * @param {object} requestBody - Request body (Claude format).
     * @returns {AsyncIterable<object>} Claude API response stream (Claude compatible format).
     */
    async *generateContentStream(model, requestBody) {
        const stream = this.streamApi('/messages', requestBody);
        for await (const chunk of stream) {
            yield chunk;
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
            { id: "claude-4-sonnet", name: "claude-4-sonnet" },
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
