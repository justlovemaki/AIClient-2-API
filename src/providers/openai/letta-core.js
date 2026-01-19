import axios from 'axios';
import * as http from 'http';
import * as https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { configureAxiosProxy } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError } from '../../utils/common.js';

/**
 * Letta API Service
 * Letta uses a streaming protocol that needs to be mapped to OpenAI compatible format
 * inside the core logic as per requirements.
 */
export class LettaApiService {
    constructor(config) {
        // if (!config.LETTA_API_KEY) {
        //     throw new Error("Letta API Key is required for LettaApiService.");
        // }
        this.config = config;
        this.apiKey = config.LETTA_API_KEY;
        this.baseUrl = config.LETTA_BASE_URL || 'https://api.letta.com';
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_LETTA ?? false;
        
        // Letta specific config
        this.agentId = config.LETTA_AGENT_ID;
        this.refreshToken = config.refreshToken;
        this.expiresAt = config.expiresAt;

        console.log(`[Letta] Initialized with baseUrl: ${this.baseUrl}, agentId: ${this.agentId || 'default'}`);

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
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'X-Letta-Source': 'letta-code'
            },
        };
        
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        configureAxiosProxy(axiosConfig, config, 'openai-letta');
        
        this.axiosInstance = axios.create(axiosConfig);
    }

    async initialize() {
        if (this.isInitialized) return;
        
        // 兼容不同的配置键名，确保能取到凭据文件路径
        let tokenFilePath = this.config.LETTA_TOKEN_FILE_PATH || this.config.letta_token_file_path;
        console.log(`[Letta] Configured token file path: ${tokenFilePath}`);
        // 如果没有配置路径，尝试默认路径 ~/.letta/settings.json
        if (!tokenFilePath) {
            tokenFilePath = path.join(os.homedir(), '.letta', 'settings.json');
            console.log(`[Letta] No token file path configured, trying default path: ${tokenFilePath}`);
        }

        if (tokenFilePath && fs.existsSync(tokenFilePath)) {
            try {
                const fileContent = JSON.parse(fs.readFileSync(tokenFilePath, 'utf8'));
                console.log(`[Letta] Loaded credentials from file: ${tokenFilePath}`);
                
                // 根据提供的 JSON 数据结构解析
                // 优先级：文件中的 env.LETTA_API_KEY > 文件顶层的 LETTA_API_KEY > 现有 this.apiKey
                this.apiKey = fileContent.env?.LETTA_API_KEY || fileContent.LETTA_API_KEY || this.apiKey;
                this.refreshToken = fileContent.refreshToken || this.refreshToken;
                this.expiresAt = fileContent.tokenExpiresAt || fileContent.expiresAt || this.expiresAt;
                
                // 代理 Agent ID: 优先级 lastAgent > LETTA_AGENT_ID > 现有 this.agentId
                this.agentId = fileContent.lastAgent || fileContent.LETTA_AGENT_ID || this.agentId;
                
                // 更新 axios 实例
                this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.apiKey}`;
            } catch (error) {
                console.error(`[Letta] Failed to load credentials from file: ${error.message}`);
            }
        } else {
            console.warn(`[Letta] No valid token file path found or file does not exist: ${tokenFilePath}`);
        }
        
        this.isInitialized = true;
        console.log(`[Letta] Service initialized. AgentId: ${this.agentId || 'default'}`);
    }

    /**
     * 刷新 Token 逻辑，参考 Kiro 实现
     */
    async refreshAuthToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available for Letta.');
        }

        try {
            const { refreshLettaToken } = await import('../../auth/index.js');
            const newData = await refreshLettaToken(this.refreshToken);
            
            this.apiKey = newData.accessToken;
            this.refreshToken = newData.refreshToken;
            this.expiresAt = newData.expiresAt;
            if (newData.agentId) {
                this.agentId = newData.agentId;
            }

            // 更新当前实例的 axios header
            this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.apiKey}`;

            // 获取令牌文件路径
            let tokenFilePath = this.config.LETTA_TOKEN_FILE_PATH || this.config.letta_token_file_path;
            if (!tokenFilePath) {
                tokenFilePath = path.join(os.homedir(), '.letta', 'settings.json');
            }

            // 持久化到本地
            await this.saveCredentialsToFile(tokenFilePath, {
                LETTA_API_KEY: this.apiKey,
                refreshToken: this.refreshToken,
                expiresAt: this.expiresAt,
                LETTA_AGENT_ID: this.agentId
            });

            console.info('[Letta] Token refreshed and saved successfully');
            
            return newData;
        } catch (error) {
            console.error('[Letta] Token refresh failed:', error.message);
            throw error;
        }
    }

    /**
     * 判断日期是否接近过期
     * @returns {boolean}
     */
    isExpiryDateNear() {
        if (this.expiresAt) {
            const expiry = new Date(this.expiresAt).getTime();
            // 24小时内过期视为接近过期
            return (expiry - Date.now()) < 24 * 60 * 60 * 1000;
        }
        return false;
    }

    /**
     * 保存凭据到文件，参考 Kiro 实现
     * 保持对原始结构的兼容性，但也更新 env 字段以匹配 Letta 默认格式
     */
    async saveCredentialsToFile(filePath, newData) {
        try {
            let existingData = {};
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                try {
                    existingData = JSON.parse(fileContent);
                } catch (e) {
                    existingData = {};
                }
            }
            
            // 构造符合 Letta 结构的更新对象
            const updateObject = {
                ...newData,
                lastAgent: newData.LETTA_AGENT_ID || existingData.lastAgent,
                tokenExpiresAt: newData.expiresAt || existingData.tokenExpiresAt,
                env: {
                    ...(existingData.env || {}),
                    LETTA_API_KEY: newData.LETTA_API_KEY || (existingData.env && existingData.env.LETTA_API_KEY)
                }
            };

            const mergedData = { ...existingData, ...updateObject };
            
            // 确保目录存在
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
            console.info(`[Letta] Updated token file: ${filePath}`);
        } catch (error) {
            console.error(`[Letta] Failed to save credentials: ${error.message}`);
        }
    }

    async callApi(endpoint, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        try {
            const response = await this.axiosInstance.post(endpoint, body);
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const errorCode = error.code;
            
            if (status === 401 || status === 403) {
                console.error(`[Letta API] Received ${status}. API Key might be invalid or expired.`);
                throw error;
            }

            if ((status === 429 || (status >= 500 && status < 600) || isRetryableNetworkError(error)) && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Letta API] Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, isRetry, retryCount + 1);
            }

            throw error;
        }
    }

    async *streamApi(endpoint, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        try {
            const response = await this.axiosInstance.post(endpoint, { ...body, streaming: true }, {
                responseType: 'stream'
            });

            const stream = response.data;
            let buffer = '';

            for await (const chunk of stream) {
                buffer += chunk.toString();
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex).trim();
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.startsWith('data: ')) {
                        const jsonData = line.substring(6).trim();
                        try {
                            const parsedChunk = JSON.parse(jsonData);
                            // Transform Letta chunk to OpenAI compatible format
                            const transformedChunk = this.transformLettaToOpenAI(parsedChunk, body.model);
                            if (transformedChunk) {
                                yield transformedChunk;
                            }
                        } catch (e) {
                            console.warn("[LettaApiService] Failed to parse stream chunk:", e.message);
                        }
                    }
                }
            }
        } catch (error) {
            const status = error.response?.status;
            if ((status === 429 || (status >= 500 && status < 600) || isRetryableNetworkError(error)) && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, isRetry, retryCount + 1);
                return;
            }
            throw error;
        }
    }

    /**
     * Transforms Letta streaming response chunks to OpenAI chat completion chunks
     * Based on reference code in tt/accumulator.ts
     */
    transformLettaToOpenAI(lettaChunk, model) {
        const timestamp = Math.floor(Date.now() / 1000);
        const baseResponse = {
            id: lettaChunk.id || `letta-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: timestamp,
            model: model,
            choices: [{
                index: 0,
                delta: {},
                finish_reason: null
            }]
        };

        switch (lettaChunk.message_type) {
            case 'reasoning_message':
                // Map reasoning to content or a specialized reasoning field if supported
                baseResponse.choices[0].delta = { content: lettaChunk.reasoning || '' };
                return baseResponse;
            case 'assistant_message':
                let content = '';
                if (typeof lettaChunk.content === 'string') {
                    content = lettaChunk.content;
                } else if (Array.isArray(lettaChunk.content)) {
                    content = lettaChunk.content.map(p => p.text || p.delta || '').join('');
                }
                baseResponse.choices[0].delta = { content };
                return baseResponse;
            case 'tool_call_message':
                const toolCall = lettaChunk.tool_call || (Array.isArray(lettaChunk.tool_calls) ? lettaChunk.tool_calls[0] : null);
                if (toolCall) {
                    baseResponse.choices[0].delta = {
                        tool_calls: [{
                            index: 0,
                            id: toolCall.tool_call_id,
                            type: 'function',
                            function: {
                                name: toolCall.name,
                                arguments: toolCall.arguments
                            }
                        }]
                    };
                    return baseResponse;
                }
                break;
            case 'usage_statistics':
                // OpenAI stream usage is usually in the last chunk
                return {
                    ...baseResponse,
                    choices: [],
                    usage: {
                        prompt_tokens: lettaChunk.prompt_tokens || 0,
                        completion_tokens: lettaChunk.completion_tokens || 0,
                        total_tokens: lettaChunk.total_tokens || 0
                    }
                };
            case 'stop_reason':
                baseResponse.choices[0].delta = {};
                baseResponse.choices[0].finish_reason = lettaChunk.stop_reason === 'end_turn' ? 'stop' : lettaChunk.stop_reason;
                return baseResponse;
        }
        return null;
    }

    async generateContent(model, requestBody) {
        const agentId = this.agentId || 'default';
        const endpoint = `/v1/agents/${agentId}/messages`;
        
        // Convert OpenAI body to Letta body if needed
        const lettaBody = {
            messages: requestBody.messages,
            stream_tokens: false,
            // Add other Letta specific params if needed
        };

        const response = await this.callApi(endpoint, lettaBody);
        
        // Transform Letta response to OpenAI compatible format
        return this.transformFullResponse(response, model);
    }

    async *generateContentStream(model, requestBody) {
        const agentId = this.agentId || 'default';
        const endpoint = `/v1/agents/${agentId}/messages/stream`;
        
        const lettaBody = {
            messages: requestBody.messages,
            stream_tokens: true,
        };

        yield* this.streamApi(endpoint, lettaBody);
    }

    transformFullResponse(lettaResponse, model) {
        // Implementation for unary response transformation if needed
        // For now, minimal implementation
        const timestamp = Math.floor(Date.now() / 1000);
        return {
            id: `letta-${Date.now()}`,
            object: 'chat.completion',
            created: timestamp,
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: lettaResponse.messages?.filter(m => m.message_type === 'assistant_message').map(m => m.content).join('\n') || ''
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        };
    }

    async listModels() {
        return {
            object: 'list',
            data: [
                { id: 'letta-agent', object: 'model', created: Date.now(), owned_by: 'letta' }
            ]
        };
    }
}
