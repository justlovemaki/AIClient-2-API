import axios from 'axios';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { refreshTokensWithRetry } from '../../auth/codex-oauth.js';

/**
 * Codex API 服务类
 * 处理与 Codex API 的通信
 */
export class CodexApiService {
    constructor(config) {
        this.config = config;
        this.baseUrl = config.CODEX_BASE_URL || 'https://chatgpt.com/backend-api/codex';
        this.accessToken = null;
        this.refreshToken = null;
        this.accountId = null;
        this.email = null;
        this.expiresAt = null;
        this.isInitialized = false;

        // 会话缓存管理
        this.conversationCache = new Map(); // key: model-userId, value: {id, expire}
        this.startCacheCleanup();
    }

    /**
     * 初始化服务（加载凭据）
     */
    async initialize() {
        const email = this.config.CODEX_EMAIL || 'default';

        try {
            let creds;

            // 如果指定了具体路径，直接读取
            if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
                const credsPath = this.config.CODEX_OAUTH_CREDS_FILE_PATH;
                const exists = await this.fileExists(credsPath);
                if (!exists) {
                    throw new Error('Codex credentials not found. Please authenticate first using OAuth.');
                }
                creds = JSON.parse(await fs.readFile(credsPath, 'utf8'));
            } else {
                // 从 configs/codex 目录扫描加载
                const projectDir = process.cwd();
                const targetDir = path.join(projectDir, 'configs', 'codex');
                const files = await fs.readdir(targetDir);
                const matchingFile = files
                    .filter(f => f.includes(`codex-${email}`) && f.endsWith('.json'))
                    .sort()
                    .pop(); // 获取最新的文件

                if (!matchingFile) {
                    throw new Error('Codex credentials not found. Please authenticate first using OAuth.');
                }

                const credsPath = path.join(targetDir, matchingFile);
                creds = JSON.parse(await fs.readFile(credsPath, 'utf8'));
            }

            this.accessToken = creds.access_token;
            this.refreshToken = creds.refresh_token;
            this.accountId = creds.account_id;
            this.email = creds.email;
            this.expiresAt = new Date(creds.expired); // 注意：字段名是 expired

            // 检查 token 是否需要刷新
            if (this.isExpiryDateNear()) {
                console.log('[Codex] Token expiring soon, refreshing...');
                await this.refreshAccessToken();
            }

            this.isInitialized = true;
            console.log(`[Codex] Initialized with account: ${this.email}`);
        } catch (error) {
            console.error('[Codex] Initialization failed:', error.message);
            throw error;
        }
    }

    /**
     * 生成内容（非流式）
     */
    async generateContent(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const url = `${this.baseUrl}/responses`;
        const body = this.prepareRequestBody(model, requestBody, false);
        const headers = this.buildHeaders(body.prompt_cache_key);

        try {
            const response = await axios.post(url, body, {
                headers,
                timeout: 120000 // 2 分钟超时
            });

            return this.parseNonStreamResponse(response.data);
        } catch (error) {
            if (error.response?.status === 401) {
                // Token 过期，尝试刷新
                console.log('[Codex] 401 error, refreshing token...');
                await this.refreshAccessToken();
                // 重试请求
                const retryBody = this.prepareRequestBody(model, requestBody, false);
                const retryHeaders = this.buildHeaders(retryBody.prompt_cache_key);
                const retryResponse = await axios.post(url, retryBody, {
                    headers: retryHeaders,
                    timeout: 120000
                });
                return this.parseNonStreamResponse(retryResponse.data);
            }
            throw error;
        }
    }

    /**
     * 流式生成内容
     */
    async *generateContentStream(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const url = `${this.baseUrl}/responses`;
        const body = this.prepareRequestBody(model, requestBody, true);
        const headers = this.buildHeaders(body.prompt_cache_key);

        // 调试日志
        console.log('[Codex Debug] Request URL:', url);
        console.log('[Codex Debug] Request Body:', JSON.stringify(body, null, 2));
        console.log('[Codex Debug] Request Headers:', JSON.stringify(headers, null, 2));

        try {
            const response = await axios.post(url, body, {
                headers,
                responseType: 'stream',
                timeout: 120000
            });

            yield* this.parseSSEStream(response.data);
        } catch (error) {
            // 打印详细错误信息
            if (error.response) {
                console.error('[Codex Error] Status:', error.response.status);
                console.error('[Codex Error] Headers:', error.response.headers);
                if (error.response.data) {
                    const errorData = await new Promise((resolve) => {
                        let data = '';
                        error.response.data.on('data', chunk => data += chunk);
                        error.response.data.on('end', () => resolve(data));
                    });
                    console.error('[Codex Error] Response:', errorData);
                }
            }

            if (error.response?.status === 401) {
                // Token 过期，尝试刷新
                console.log('[Codex] 401 error, refreshing token...');
                await this.refreshAccessToken();
                // 重试请求
                const retryBody = this.prepareRequestBody(model, requestBody, true);
                const retryHeaders = this.buildHeaders(retryBody.prompt_cache_key);
                const retryResponse = await axios.post(url, retryBody, {
                    headers: retryHeaders,
                    responseType: 'stream',
                    timeout: 120000
                });
                yield* this.parseSSEStream(retryResponse.data);
            } else {
                throw error;
            }
        }
    }

    /**
     * 构建请求头
     */
    buildHeaders(cacheId) {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`,
            'Openai-Beta': 'responses=experimental',
            'Version': '0.21.0',
            'User-Agent': 'codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464',
            'Originator': 'codex_cli_rs',
            'Chatgpt-Account-Id': this.accountId,
            'Accept': 'text/event-stream',
            'Connection': 'Keep-Alive',
            'Conversation_id': cacheId,
            'Session_id': cacheId
        };
    }

    /**
     * 准备请求体
     */
    prepareRequestBody(model, requestBody, stream) {
        // 添加会话缓存 ID
        const cacheKey = `${model}-${requestBody.metadata?.user_id || 'default'}`;
        let cache = this.conversationCache.get(cacheKey);

        if (!cache || cache.expire < Date.now()) {
            cache = {
                id: crypto.randomUUID(),
                expire: Date.now() + 3600000 // 1 小时
            };
            this.conversationCache.set(cacheKey, cache);
        }

        // 注意：requestBody 已经是转换后的 Codex 格式
        // 只需要添加 cache key 和 stream 参数
        return {
            ...requestBody,
            stream,
            prompt_cache_key: cache.id
        };
    }

    /**
     * 刷新访问令牌
     */
    async refreshAccessToken() {
        try {
            const newTokens = await refreshTokensWithRetry(this.refreshToken, this.config);

            this.accessToken = newTokens.access_token;
            this.refreshToken = newTokens.refresh_token;
            this.accountId = newTokens.account_id;
            this.email = newTokens.email;
            this.expiresAt = new Date(newTokens.expire);

            // 保存更新的凭据
            await this.saveCredentials();

            console.log('[Codex] Token refreshed successfully');
        } catch (error) {
            console.error('[Codex] Failed to refresh token:', error.message);
            throw new Error('Failed to refresh Codex token. Please re-authenticate.');
        }
    }

    /**
     * 检查 token 是否即将过期
     */
    isExpiryDateNear() {
        if (!this.expiresAt) return true;
        const now = Date.now();
        const expiry = this.expiresAt.getTime();
        const bufferMs = 5 * 60 * 1000; // 5 分钟缓冲
        return expiry <= now + bufferMs;
    }

    /**
     * 获取凭据文件路径
     */
    getCredentialsPath() {
        const email = this.config.CODEX_EMAIL || this.email || 'default';

        // 优先使用配置中指定的路径，否则使用项目目录
        if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
            return this.config.CODEX_OAUTH_CREDS_FILE_PATH;
        }

        // 保存到项目目录的 .codex 文件夹
        const projectDir = process.cwd();
        return path.join(projectDir, '.codex', `codex-${email}.json`);
    }

    /**
     * 保存凭据
     */
    async saveCredentials() {
        const credsPath = this.getCredentialsPath();
        const credsDir = path.dirname(credsPath);

        await fs.mkdir(credsDir, { recursive: true });
        await fs.writeFile(credsPath, JSON.stringify({
            id_token: this.idToken || '',
            access_token: this.accessToken,
            refresh_token: this.refreshToken,
            account_id: this.accountId,
            last_refresh: new Date().toISOString(),
            email: this.email,
            type: 'codex',
            expired: this.expiresAt.toISOString()
        }, null, 2), { mode: 0o600 });
    }

    /**
     * 检查文件是否存在
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 解析 SSE 流
     */
    async *parseSSEStream(stream) {
        let buffer = '';

        for await (const chunk of stream) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留不完整的行

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data && data !== '[DONE]') {
                        try {
                            const parsed = JSON.parse(data);
                            yield parsed;
                        } catch (e) {
                            console.error('[Codex] Failed to parse SSE data:', e.message);
                        }
                    }
                }
            }
        }

        // 处理剩余的 buffer
        if (buffer.trim()) {
            if (buffer.startsWith('data: ')) {
                const data = buffer.slice(6).trim();
                if (data && data !== '[DONE]') {
                    try {
                        const parsed = JSON.parse(data);
                        yield parsed;
                    } catch (e) {
                        console.error('[Codex] Failed to parse final SSE data:', e.message);
                    }
                }
            }
        }
    }

    /**
     * 解析非流式响应
     */
    parseNonStreamResponse(data) {
        // 从 SSE 流中提取 response.completed 事件
        const lines = data.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonData = line.slice(6).trim();
                try {
                    const parsed = JSON.parse(jsonData);
                    if (parsed.type === 'response.completed') {
                        return parsed;
                    }
                } catch (e) {
                    // 继续解析
                }
            }
        }
        throw new Error('No completed response found in Codex response');
    }

    /**
     * 列出可用模型
     */
    async listModels() {
        return {
            object: 'list',
            data: [
                { id: 'gpt-5', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5-codex', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5-codex-mini', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5.1', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5.1-codex', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5.1-codex-mini', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5.1-codex-max', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5.2', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' },
                { id: 'gpt-5.2-codex', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' }
            ]
        };
    }

    /**
     * 启动缓存清理
     */
    startCacheCleanup() {
        // 每 15 分钟清理过期缓存
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, cache] of this.conversationCache.entries()) {
                if (cache.expire < now) {
                    this.conversationCache.delete(key);
                }
            }
        }, 15 * 60 * 1000);
    }

    /**
     * 停止缓存清理
     */
    stopCacheCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}
