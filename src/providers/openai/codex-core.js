import axios from 'axios';
import logger from '../../utils/logger.js';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { refreshCodexTokensWithRetry } from '../../auth/oauth-handlers.js';
import { getProviderPoolManager } from '../../services/service-manager.js';
import { MODEL_PROVIDER, formatExpiryLog } from '../../utils/common.js';
import { getProxyConfigForProvider } from '../../utils/proxy-utils.js';
import { getProviderModels } from '../provider-models.js';

const baseModels = getProviderModels(MODEL_PROVIDER.CODEX_API);
const fastModels = baseModels.map(m => `${m}-fast`);
const CODEX_MODELS = [...new Set([...baseModels, ...fastModels])];
const CODEX_VERSION = '0.111.0';

/**
 * Codex API 服务类
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
        this.idToken = null;
        this.last_refresh = null;
        this.credsPath = null; // 记录本次加载/使用的凭据文件路径，确保刷新后写回同一文件
        this.uuid = config.uuid; // 保存 uuid 用于号池管理
        this.isInitialized = false;

        // 会话缓存管理
        this.conversationCache = new Map(); // key: model-userId, value: {id, expire}
        this.startCacheCleanup();
    }

    /**
     * 初始化服务（加载凭据）
     */
    async initialize() {
        if (this.isInitialized) return;
        logger.info('[Codex] Initializing Codex API Service...');
        // 注意：V2 读写分离架构下，初始化不再执行同步认证/刷新逻辑
        // 仅执行基础的凭证加载
        await this.loadCredentials();

        this.isInitialized = true;
        logger.info(`[Codex] Initialization complete. Account: ${this.email || 'unknown'}`);
    }

    /**
     * 加载凭证信息（不执行刷新）
     */
    async loadCredentials() {
        const email = this.config.CODEX_EMAIL || 'default';

        try {
            let creds;
            let credsPath;

            // 如果指定了具体路径，直接读取
            if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
                credsPath = this.config.CODEX_OAUTH_CREDS_FILE_PATH;
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

                credsPath = path.join(targetDir, matchingFile);
                creds = JSON.parse(await fs.readFile(credsPath, 'utf8'));
            }

            // 记录凭据路径，确保 refresh 时写回同一文件。
            this.credsPath = credsPath;

            this.idToken = creds.id_token || this.idToken;
            this.accessToken = creds.access_token;
            this.refreshToken = creds.refresh_token;
            this.accountId = creds.account_id;
            this.email = creds.email;
            this.last_refresh = creds.last_refresh || this.last_refresh;
            this.expiresAt = new Date(creds.expired); // 注意：字段名是 expired

            // 检查 token 是否需要刷新（异步触发，不阻塞加载）
            if (this.isExpiryDateNear()) {
                this.triggerBackgroundRefresh();
            }

            this.isInitialized = true;
            logger.info(`[Codex] Initialized with account: ${this.email}`);
        } catch (error) {
            logger.warn(`[Codex Auth] Failed to load credentials: ${error.message}`);
        }
    }

    /**
     * 初始化认证并执行必要刷新
     */
    async initializeAuth(forceRefresh = false) {
        // 检查 token 是否需要刷新
        const needsRefresh = forceRefresh;

        if (this.accessToken && !needsRefresh) {
            return;
        }

        // 首先执行基础凭证加载
        await this.loadCredentials();

        // 只有在明确要求刷新，或者 AccessToken 缺失时，才执行刷新
        // 注意：在 V2 架构下，此方法主要由 PoolManager 的后台队列调用
        if (needsRefresh || !this.accessToken) {
            if (!this.refreshToken) {
                throw new Error('Codex credentials not found. Please authenticate first using OAuth.');
            }
            logger.info('[Codex] Token expiring soon or refresh requested, refreshing...');
            await this.refreshAccessToken();
        }
    }

    /**
     * 后台异步刷新 token（不阻塞当前请求）
     */
    triggerBackgroundRefresh() {
        const poolManager = getProviderPoolManager();
        if (poolManager && this.uuid) {
            logger.info(`[Codex] Token is near expiry, marking credential ${this.uuid} for background refresh`);
            poolManager.markProviderNeedRefresh(MODEL_PROVIDER.CODEX_API, {
                uuid: this.uuid
            });
        }
    }

    /**
     * 生成内容（非流式）
     */
    async generateContent(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        let selectedModel = model;
        if (!CODEX_MODELS.includes(model)) {
            const defaultModel = CODEX_MODELS[0] || 'gpt-5';
            logger.warn(`[Codex] Model '${model}' not found in supported list. Falling back to default: '${defaultModel}'`);
            selectedModel = defaultModel;
        }

        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        if (requestBody._requestBaseUrl) {
            delete requestBody._requestBaseUrl;
        }

        // 检查 token 是否即将过期，如果是则触发后台异步刷新
        if (this.isExpiryDateNear()) {
            this.triggerBackgroundRefresh();
        }

        const url = `${this.baseUrl}/responses`;
        const body = await this.prepareRequestBody(selectedModel, requestBody, true);
        const headers = this.buildHeaders(body.prompt_cache_key, true);

        try {
            const config = {
                headers,
                responseType: 'text', // 确保以文本形式接收 SSE 流
                timeout: 120000 // 2 分钟超时
            };

            // 配置代理
            const proxyConfig = getProxyConfigForProvider(this.config, 'openai-codex-oauth');
            if (proxyConfig) {
                config.httpAgent = proxyConfig.httpAgent;
                config.httpsAgent = proxyConfig.httpsAgent;
            }

            const response = await axios.post(url, body, config);

            return this.parseNonStreamResponse(response.data);
        } catch (error) {
            if (error.response?.status === 401) {
                logger.info('[Codex] Received 401. Triggering background refresh...');

                // 触发后台异步刷新
                this.triggerBackgroundRefresh();
                error.credentialMarkedUnhealthy = true;

                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            } else {
                logger.error(`[Codex] Error calling non-stream API (Status: ${error.response?.status}, Code: ${error.code || 'N/A'}):`, error.message);
                throw error;
            }
        }
    }

    /**
     * 流式生成内容
     */
    async *generateContentStream(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        let selectedModel = model;
        if (!CODEX_MODELS.includes(model)) {
            const defaultModel = CODEX_MODELS[0] || 'gpt-5';
            logger.warn(`[Codex] Model '${model}' not found in supported list. Falling back to default: '${defaultModel}'`);
            selectedModel = defaultModel;
        }

        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        if (requestBody._requestBaseUrl) {
            delete requestBody._requestBaseUrl;
        }

        // 检查 token 是否即将过期，如果是则触发后台异步刷新
        if (this.isExpiryDateNear()) {
            this.triggerBackgroundRefresh();
        }

        const url = `${this.baseUrl}/responses`;
        const body = await this.prepareRequestBody(selectedModel, requestBody, true);
        const headers = this.buildHeaders(body.prompt_cache_key, true);

        try {
            const config = {
                headers,
                responseType: 'stream',
                timeout: 120000
            };

            // 配置代理
            const proxyConfig = getProxyConfigForProvider(this.config, 'openai-codex-oauth');
            if (proxyConfig) {
                config.httpAgent = proxyConfig.httpAgent;
                config.httpsAgent = proxyConfig.httpsAgent;
            }

            const response = await axios.post(url, body, config);

            yield* this.parseSSEStream(response.data);
        } catch (error) {
            if (error.response?.status === 401) {
                logger.info('[Codex] Received 401 during stream. Triggering background refresh...');

                // 触发后台异步刷新
                this.triggerBackgroundRefresh();
                error.credentialMarkedUnhealthy = true;

                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            } else {
                logger.error(`[Codex] Error calling streaming API (Status: ${error.response?.status}, Code: ${error.code || 'N/A'}):`, error.message);
                throw error;
            }
        }
    }

    /**
     * 构建请求头
     */
    buildHeaders(cacheId, stream = true) {
        const headers = {
            'version': CODEX_VERSION,
            'x-codex-beta-features': 'powershell_utf8',
            'x-oai-web-search-eligible': 'true',
            'authorization': `Bearer ${this.accessToken}`,
            'chatgpt-account-id': this.accountId,
            'content-type': 'application/json',
            'user-agent': `codex_cli_rs/${CODEX_VERSION} (Windows 10.0.26100; x86_64) WindowsTerminal`,
            'originator': 'codex_cli_rs',
            'host': 'chatgpt.com',
            'Connection': 'Keep-Alive'
        };

        // 设置 Conversation_id 和 Session_id
        if (cacheId) {
            headers['Conversation_id'] = cacheId;
            headers['Session_id'] = cacheId;
        }

        // 根据是否流式设置 Accept 头
        if (stream) {
            headers['accept'] = 'text/event-stream';
        } else {
            headers['accept'] = 'application/json';
        }

        return headers;
    }

    /**
     * 准备请求体
     */
    async prepareRequestBody(model, requestBody, stream) {
        // 提取 metadata 并从请求体中移除，避免透传到上游
        const metadata = requestBody.metadata || {};
        
        // 明确会话维度：优先使用 session_id 或 conversation_id，其次 user_id
        const sessionId = metadata.session_id || metadata.conversation_id || metadata.user_id || 'default';
        
        // 判断是否为 fast 模型并确定默认值
        const normalizedModel = String(model || '').trim();
        const isFastModel = /-fast$/i.test(normalizedModel);
        const upstreamModel = isFastModel ? normalizedModel.replace(/-fast$/i, '') : normalizedModel;
        const defaultServiceTier = isFastModel ? 'priority' : 'default';
        const defaultReasoningEffort = isFastModel ? 'xhigh' : 'medium';

        const cleanedBody = { ...requestBody };
        delete cleanedBody.metadata;

        // 【关键修复】确保传给上游的模型名称不带 -fast 后缀
        // 即使 originalRequestBody 中已经带了 model，这里也必须覆盖
        cleanedBody.model = upstreamModel;

        if (isFastModel) {
            logger.info(`[Codex] Detected -fast model: ${normalizedModel} -> ${upstreamModel}, service_tier: ${cleanedBody.service_tier || defaultServiceTier}`);
        }

        // 生成会话缓存键
        // 弱化 model 依赖，以提升同会话跨模型的缓存命中率
        // 仅当 sessionId 为 'default' 时加上 model 前缀，提供基础隔离
        let cacheKey = sessionId;
        if (sessionId === 'default') {
            cacheKey = `${model}-default`;
        }
        
        let cache = this.conversationCache.get(cacheKey);

        if (!cache || cache.expire < Date.now()) {
            cache = {
                id: crypto.randomUUID(),
                expire: Date.now() + 3600000 // 1 小时
            };
            this.conversationCache.set(cacheKey, cache);
        }

        // 注意：requestBody 已经去除了 metadata
        const result = {
            ...cleanedBody,
            service_tier: cleanedBody.service_tier || defaultServiceTier,
            reasoning: {
                ...cleanedBody.reasoning,
                effort: isFastModel ? defaultReasoningEffort : cleanedBody.reasoning?.effort
            },
            stream,
            prompt_cache_key: cache.id
        };

        if (result.service_tier !== 'priority') {
            delete result.service_tier;
        }

        // 监控钩子：内部请求转换
        if (this.config?._monitorRequestId) {
            try {
                const { getPluginManager } = await import('../../core/plugin-manager.js');
                const pluginManager = getPluginManager();
                if (pluginManager) {
                    await pluginManager.executeHook('onInternalRequestConverted', {
                        requestId: this.config._monitorRequestId,
                        internalRequest: result,
                        converterName: 'prepareRequestBody'
                    });
                }
            } catch (e) {
                logger.error('[Codex] Error calling onInternalRequestConverted hook:', e.message);
            }
        }

        return result;
    }

    /**
     * 刷新访问令牌
     */
    async refreshAccessToken() {
        try {
            const newTokens = await refreshCodexTokensWithRetry(this.refreshToken, this.config);

            this.idToken = newTokens.id_token || this.idToken;
            this.accessToken = newTokens.access_token;
            this.refreshToken = newTokens.refresh_token;
            this.accountId = newTokens.account_id;
            this.email = newTokens.email;
            this.last_refresh = new Date().toISOString();

            // 关键修复：refreshCodexTokensWithRetry 返回字段名是 `expired`（ISO string），不是 `expire`
            const expiredValue = newTokens.expired || newTokens.expire || newTokens.expires_at || newTokens.expiresAt;
            const parsedExpiry = expiredValue ? new Date(expiredValue) : null;
            if (!parsedExpiry || Number.isNaN(parsedExpiry.getTime())) {
                // 如果上游没返回可解析的过期时间，保守处理：按 1h 有效期估算（避免 expiresAt 变成 NaN 导致永不刷新）
                this.expiresAt = new Date(Date.now() + 3600 * 1000);
                logger.warn('[Codex] Token refresh did not include a valid expiry time; falling back to 1h from now');
            } else {
                this.expiresAt = parsedExpiry;
            }

            // 保存更新的凭据
            await this.saveCredentials();

            // 刷新成功，重置 PoolManager 中的刷新状态并标记为健康
            const poolManager = getProviderPoolManager();
            if (poolManager && this.uuid) {
                poolManager.resetProviderRefreshStatus(MODEL_PROVIDER.CODEX_API, this.uuid);
            }
            logger.info('[Codex] Token refreshed successfully');
        } catch (error) {
            logger.error('[Codex] Failed to refresh token:', error.message);
            throw new Error('Failed to refresh Codex token. Please re-authenticate.');
        }
    }

    /**
     * 检查 token 是否即将过期
     */
    isExpiryDateNear() {
        if (!this.expiresAt) return true;
        const expiry = this.expiresAt.getTime();
        // 如果 expiresAt 是 Invalid Date（NaN），必须视为“接近过期/已过期”，否则刷新永远不会触发
        if (Number.isNaN(expiry)) {
            logger.warn('[Codex] expiresAt is invalid (NaN). Treating as near expiry to force refresh');
            return true;
        }
        const nearMinutes = 20;
        const { message, isNearExpiry } = formatExpiryLog('Codex', expiry, nearMinutes);
        logger.info(message);
        return isNearExpiry;
    }

    /**
     * 获取凭据文件路径
     */
    getCredentialsPath() {
        const email = this.config.CODEX_EMAIL || this.email || 'default';

        // 1) 优先使用配置中指定的路径（号池模式/显式配置）
        if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
            return this.config.CODEX_OAUTH_CREDS_FILE_PATH;
        }

        // 2) 如果本次是从 configs/codex 扫描加载的，务必写回同一文件
        if (this.credsPath) {
            return this.credsPath;
        }

        // 3) 兜底：写入 configs/codex（与 OAuth 保存默认目录保持一致，避免“读取 configs/codex、写入 .codex”导致永远读到旧 token）
        const projectDir = process.cwd();
        return path.join(projectDir, 'configs', 'codex', `${Date.now()}_codex-${email}.json`);
    }

    /**
     * 保存凭据
     */
    async saveCredentials() {
        const credsPath = this.getCredentialsPath();
        const credsDir = path.dirname(credsPath);

        if (!this.expiresAt || Number.isNaN(this.expiresAt.getTime())) {
            throw new Error('Invalid expiresAt when saving Codex credentials');
        }

        await fs.mkdir(credsDir, { recursive: true });
        await fs.writeFile(
            credsPath,
            JSON.stringify(
                {
                    id_token: this.idToken || '',
                    access_token: this.accessToken,
                    refresh_token: this.refreshToken,
                    account_id: this.accountId,
                    last_refresh: this.last_refresh || new Date().toISOString(),
                    email: this.email,
                    type: 'codex',
                    expired: this.expiresAt.toISOString()
                },
                null,
                2
            ),
            { mode: 0o600 }
        );

        // 更新缓存路径（例如首次无 credsPath 兜底生成了新文件）
        this.credsPath = credsPath;
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
                            logger.error('[Codex] Failed to parse SSE data:', e.message);
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
                        logger.error('[Codex] Failed to parse final SSE data:', e.message);
                    }
                }
            }
        }
    }

    /**
     * 解析非流式响应
     */
    parseNonStreamResponse(data) {
        // 确保 data 是字符串
        const responseText = typeof data === 'string' ? data : String(data);
        
        // 从 SSE 流中提取 response.completed 事件
        const lines = responseText.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonData = line.slice(6).trim();
                if (!jsonData || jsonData === '[DONE]') {
                    continue;
                }
                try {
                    const parsed = JSON.parse(jsonData);
                    if (parsed.type === 'response.completed') {
                        return parsed;
                    }
                } catch (e) {
                    // 继续解析下一行
                    logger.debug('[Codex] Failed to parse SSE line:', e.message);
                }
            }
        }
        
        // 如果没有找到 response.completed，抛出错误
        logger.error('[Codex] No completed response found in Codex response');
        throw new Error('stream error: stream disconnected before completion: stream closed before response.completed');
    }

    /**
     * 列出可用模型
     */
    async listModels() {
        return {
            object: 'list',
            data: CODEX_MODELS.map(id => ({
                id,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'openai'
            }))
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

    /**
     * 获取使用限制信息
     * @returns {Promise<Object>} 使用限制信息（通用格式）
     */
    async getUsageLimits() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const url = 'https://chatgpt.com/backend-api/wham/usage';
            const headers = {
                'user-agent': `codex_cli_rs/${CODEX_VERSION} (Windows 10.0.26100; x86_64) WindowsTerminal`,
                'authorization': `Bearer ${this.accessToken}`,
                'chatgpt-account-id': this.accountId,
                'accept': '*/*',
                'host': 'chatgpt.com',
                'Connection': 'close'
            };

            const config = {
                headers,
                timeout: 30000 // 30 秒超时
            };

            // 配置代理
            const proxyConfig = getProxyConfigForProvider(this.config, 'openai-codex-oauth');
            if (proxyConfig) {
                config.httpAgent = proxyConfig.httpAgent;
                config.httpsAgent = proxyConfig.httpsAgent;
            }

            const response = await axios.get(url, config);
            
            // 解析响应数据并转换为通用格式
            const data = response.data;
            
            // 通用格式：{ lastUpdated, models: { "model-id": { remaining, resetTime, resetTimeRaw } } }
            const result = {
                lastUpdated: Date.now(),
                models: {}
            };

            // 从 rate_limit 提取配额信息
            // Codex 使用百分比表示使用量，我们需要转换为剩余量
            if (data.rate_limit) {
                const primaryWindow = data.rate_limit.primary_window;
                const secondaryWindow = data.rate_limit.secondary_window;
                
                // 使用主窗口的数据作为主要配额信息
                if (primaryWindow) {
                    // remaining = 1 - (used_percent / 100)
                    const remaining = 1 - (primaryWindow.used_percent || 0) / 100;
                    const resetTime = primaryWindow.reset_at ? new Date(primaryWindow.reset_at * 1000).toISOString() : null;
                    
                    // 为所有 Codex 模型设置相同的配额信息
                    const codexModels = ['default'];
                    for (const modelId of codexModels) {
                        result.models[modelId] = {
                            remaining: Math.max(0, Math.min(1, remaining)), // 确保在 0-1 之间
                            resetTime: resetTime,
                            resetTimeRaw: primaryWindow.reset_at
                        };
                    }
                }
            }

            // 保存原始响应数据供需要时使用
            result.raw = {
                planType: data.plan_type || 'unknown',
                rateLimit: data.rate_limit,
                codeReviewRateLimit: data.code_review_rate_limit,
                credits: data.credits
            };

            logger.info(`[Codex] Successfully fetched usage limits for plan: ${result.raw.planType}`);
            return result;
        } catch (error) {
            if (error.response?.status === 401) {
                logger.info('[Codex] Received 401 during getUsageLimits. Triggering background refresh...');

                // 触发后台异步刷新
                this.triggerBackgroundRefresh();
                error.credentialMarkedUnhealthy = true;

                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
            }
            
            logger.error('[Codex] Failed to get usage limits:', error.message);
            throw error;
        }
    }
}

