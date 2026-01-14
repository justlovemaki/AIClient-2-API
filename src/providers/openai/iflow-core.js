/**
 * iFlow API Service
 *
 * iFlow 是一个 AI 服务平台，提供 OpenAI 兼容的 API 接口。
 * 使用 Token 文件方式认证 - 从文件读取 API Key
 *
 * 支持的模型：
 * - Qwen 系列: qwen3-max, qwen3-coder-plus, qwen3-vl-plus, qwen3-235b 等
 * - Kimi 系列: kimi-k2, kimi-k2-0905
 * - DeepSeek 系列: deepseek-v3, deepseek-v3.2, deepseek-r1
 * - GLM 系列: glm-4.6
 *
 * 支持的特殊模型配置：
 * - GLM-4.x: 使用 chat_template_kwargs.enable_thinking
 * - Qwen thinking 模型: 内置推理能力
 * - DeepSeek R1: 内置推理能力
 */

import axios from 'axios';
import * as http from 'http';
import * as https from 'https';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { configureAxiosProxy } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError } from '../../utils/common.js';
import { acquireFileLock } from '../../utils/file-lock.js';

// iFlow API 端点
const IFLOW_API_BASE_URL = 'https://apis.iflow.cn/v1';
const IFLOW_USER_AGENT = 'iFlow-Cli';
const IFLOW_OAUTH_TOKEN_ENDPOINT = 'https://iflow.cn/oauth/token';
const IFLOW_USER_INFO_ENDPOINT = 'https://iflow.cn/api/oauth/getUserInfo';
const IFLOW_OAUTH_CLIENT_ID = '10009311001';
const IFLOW_OAUTH_CLIENT_SECRET = '4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW';

// 默认模型列表
const IFLOW_MODELS = [
    // iFlow 特有模型
    'iflow-rome-30ba3b',
    // Qwen 模型
    'qwen3-coder-plus',
    'qwen3-max',
    'qwen3-vl-plus',
    'qwen3-max-preview',
    'qwen3-32b',
    'qwen3-235b-a22b-thinking-2507',
    'qwen3-235b-a22b-instruct',
    'qwen3-235b',
    // Kimi 模型
    'kimi-k2-0905',
    'kimi-k2',
    // GLM 模型
    'glm-4.6',
    'glm-4.7',
    // DeepSeek 模型
    'deepseek-v3.2',
    'deepseek-r1',
    'deepseek-v3'
];

// 支持 thinking 的模型前缀
const THINKING_MODEL_PREFIXES = ['glm-4', 'qwen3-235b-a22b-thinking', 'deepseek-r1'];

// ==================== Token 管理 ====================

/**
 * iFlow Token 存储类
 */
class IFlowTokenStorage {
    constructor(data = {}) {
        this.accessToken = data.accessToken || data.access_token || '';
        this.refreshToken = data.refreshToken || data.refresh_token || '';
        this.expiryDate = data.expiryDate || data.expiry_date || '';
        this.apiKey = data.apiKey || data.api_key || '';
        this.tokenType = data.tokenType || data.token_type || '';
        this.scope = data.scope || '';
    }

    /**
     * 转换为 JSON 对象
     */
    toJSON() {
        return {
            access_token: this.accessToken,
            refresh_token: this.refreshToken,
            expiry_date: this.expiryDate,
            token_type: this.tokenType,
            scope: this.scope,
            apiKey: this.apiKey
        };
    }

    /**
     * 从 JSON 对象创建实例
     */
    static fromJSON(json) {
        return new IFlowTokenStorage(json);
    }
}

/**
 * 从文件加载 Token
 * @param {string} filePath - Token 文件路径
 * @returns {Promise<IFlowTokenStorage|null>}
 */
async function loadTokenFromFile(filePath) {
    try {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);
        
        const data = await fs.readFile(absolutePath, 'utf-8');
        const json = JSON.parse(data);
        
        // 记录加载的 token 信息
        const refreshToken = json.refreshToken || json.refresh_token || '';
        console.log(`[iFlow] Token loaded from: ${filePath} (refresh_token: ${refreshToken ? refreshToken.substring(0, 8) + '...' : 'EMPTY'})`);
        
        return IFlowTokenStorage.fromJSON(json);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[iFlow] Token file not found: ${filePath}`);
            return null;
        }
        throw new Error(`[iFlow] Failed to load token from file: ${error.message}`);
    }
}

/**
 * 保存 Token 到文件
 * @param {string} filePath - Token 文件路径
 * @param {IFlowTokenStorage} tokenStorage - Token 存储对象
 */
async function saveTokenToFile(filePath, tokenStorage) {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);
    
    // 获取文件锁，防止并发写入
    const releaseLock = await acquireFileLock(absolutePath);
    try {
        // 确保目录存在
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        
        // 写入文件
        const json = tokenStorage.toJSON();
        
        // 验证关键字段是否存在
        if (!json.refresh_token || json.refresh_token.trim() === '') {
            console.error('[iFlow] WARNING: Attempting to save token file with empty refresh_token!');
        }
        if (!json.apiKey || json.apiKey.trim() === '') {
            console.error('[iFlow] WARNING: Attempting to save token file with empty apiKey!');
        }
        
        await fs.writeFile(absolutePath, JSON.stringify(json, null, 2), 'utf-8');
        
        console.log(`[iFlow] Token saved to: ${filePath} (refresh_token: ${json.refresh_token ? json.refresh_token.substring(0, 8) + '...' : 'EMPTY'})`);
    } catch (error) {
        throw new Error(`[iFlow] Failed to save token to file: ${error.message}`);
    } finally {
        // 确保锁被释放
        releaseLock();
    }
}

// ==================== Token 刷新逻辑 ====================

/**
 * 使用 refresh_token 刷新 OAuth Token
 * @param {string} refreshToken - 刷新令牌
 * @param {Object} axiosInstance - axios 实例（可选，用于代理配置）
 * @returns {Promise<Object>} - 新的 Token 数据
 */
async function refreshOAuthTokens(refreshToken, axiosInstance = null) {
    if (!refreshToken || refreshToken.trim() === '') {
        throw new Error('[iFlow] refresh_token is empty');
    }
    
    console.log('[iFlow] Refreshing OAuth tokens...');
    
    // 构建请求参数
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    params.append('client_id', IFLOW_OAUTH_CLIENT_ID);
    params.append('client_secret', IFLOW_OAUTH_CLIENT_SECRET);
    
    // 构建 Basic Auth header
    const basicAuth = Buffer.from(`${IFLOW_OAUTH_CLIENT_ID}:${IFLOW_OAUTH_CLIENT_SECRET}`).toString('base64');
    
    const requestConfig = {
        method: 'POST',
        url: IFLOW_OAUTH_TOKEN_ENDPOINT,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Authorization': `Basic ${basicAuth}`
        },
        data: params.toString(),
        timeout: 30000
    };
    
    try {
        const response = axiosInstance
            ? await axiosInstance.request(requestConfig)
            : await axios.request(requestConfig);
        
        const tokenResp = response.data;
        
        // console.log('[iFlow] Token response:', JSON.stringify(tokenResp));
        if (!tokenResp.access_token) {
            console.error('[iFlow] Token response:', JSON.stringify(tokenResp));
            throw new Error('[iFlow] Missing access_token in response');
        }
        
        // 计算过期时间（毫秒级时间戳）
        const expiresIn = tokenResp.expires_in || 3600;
        const expireTimestamp = Date.now() + expiresIn * 1000;
        
        const tokenData = {
            accessToken: tokenResp.access_token,
            refreshToken: tokenResp.refresh_token || refreshToken,
            tokenType: tokenResp.token_type || 'Bearer',
            scope: tokenResp.scope || '',
            expiryDate: expireTimestamp // 毫秒级时间戳
        };
        
        console.log('[iFlow] OAuth tokens refreshed successfully');
        
        // 获取用户信息以获取 API Key
        const userInfo = await fetchUserInfo(tokenData.accessToken, axiosInstance);
        if (userInfo && userInfo.apiKey) {
            tokenData.apiKey = userInfo.apiKey;
            tokenData.email = userInfo.email || userInfo.phone || '';
        }
        
        return tokenData;
    } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error(`[iFlow] OAuth token refresh failed (Status: ${status}):`, data || error.message);
        throw error;
    }
}

/**
 * 获取用户信息（包含 API Key）
 * @param {string} accessToken - 访问令牌
 * @param {Object} axiosInstance - axios 实例（可选）
 * @returns {Promise<Object>} - 用户信息
 */
async function fetchUserInfo(accessToken, axiosInstance = null) {
    if (!accessToken || accessToken.trim() === '') {
        throw new Error('[iFlow] access_token is empty');
    }
    
    const url = `${IFLOW_USER_INFO_ENDPOINT}?accessToken=${encodeURIComponent(accessToken)}`;
    
    const requestConfig = {
        method: 'GET',
        url,
        headers: {
            'Accept': 'application/json'
        },
        timeout: 30000
    };
    
    try {
        const response = axiosInstance
            ? await axiosInstance.request(requestConfig)
            : await axios.request(requestConfig);
        
        const result = response.data;
        // console.log('[iFlow] User info response:', JSON.stringify(result));
        if (!result.success) {
            throw new Error('[iFlow] User info request not successful');
        }
        
        if (!result.data || !result.data.apiKey) {
            throw new Error('[iFlow] Missing apiKey in user info response');
        }
        
        return {
            apiKey: result.data.apiKey,
            email: result.data.email || '',
            phone: result.data.phone || ''
        };
    } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error(`[iFlow] Fetch user info failed (Status: ${status}):`, data || error.message);
        throw error;
    }
}

// ==================== 请求处理工具函数 ====================

/**
 * 检查模型是否支持 thinking 配置
 * @param {string} model - 模型名称
 * @returns {boolean}
 */
function isThinkingModel(model) {
    if (!model) return false;
    const lowerModel = model.toLowerCase();
    return THINKING_MODEL_PREFIXES.some(prefix => lowerModel.startsWith(prefix));
}

/**
 * 应用 iFlow 特定的 thinking 配置
 * 将 reasoning_effort 转换为模型特定的配置
 *
 * @param {Object} body - 请求体
 * @param {string} model - 模型名称
 * @returns {Object} - 处理后的请求体
 */
function applyIFlowThinkingConfig(body, model) {
    if (!body || !model) return body;
    
    const lowerModel = model.toLowerCase();
    const reasoningEffort = body.reasoning_effort;
    
    // 如果没有 reasoning_effort，直接返回
    if (reasoningEffort === undefined) return body;
    
    const enableThinking = reasoningEffort !== 'none' && reasoningEffort !== '';
    
    // 创建新对象，移除 reasoning_effort 和 thinking
    const newBody = { ...body };
    delete newBody.reasoning_effort;
    delete newBody.thinking;
    
    // GLM-4.x: 使用 chat_template_kwargs
    if (lowerModel.startsWith('glm-4')) {
        newBody.chat_template_kwargs = {
            ...(newBody.chat_template_kwargs || {}),
            enable_thinking: enableThinking
        };
        if (enableThinking) {
            newBody.chat_template_kwargs.clear_thinking = false;
        }
        return newBody;
    }
    
    // Qwen thinking 模型: 保持 thinking 配置
    if (lowerModel.includes('thinking')) {
        // Qwen thinking 模型默认启用 thinking，不需要额外配置
        return newBody;
    }
    
    // DeepSeek R1: 推理模型，不需要额外配置
    if (lowerModel.startsWith('deepseek-r1')) {
        return newBody;
    }
    
    return newBody;
}

/**
 * 保留消息历史中的 reasoning_content
 * 对于支持 thinking 的模型，保留 assistant 消息中的 reasoning_content
 *
 * @param {Object} body - 请求体
 * @param {string} model - 模型名称
 * @returns {Object} - 处理后的请求体
 */
function preserveReasoningContentInMessages(body, model) {
    if (!body || !model) return body;
    
    const lowerModel = model.toLowerCase();
    
    // 只对支持 thinking 的模型应用
    const needsPreservation = lowerModel.startsWith('glm-4') ||
                              lowerModel.includes('thinking') ||
                              lowerModel.startsWith('deepseek-r1');
    if (!needsPreservation) return body;
    
    const messages = body.messages;
    if (!Array.isArray(messages)) return body;
    
    // 检查是否有 assistant 消息包含 reasoning_content
    const hasReasoningContent = messages.some(msg =>
        msg.role === 'assistant' && msg.reasoning_content && msg.reasoning_content !== ''
    );
    
    if (hasReasoningContent) {
        console.log(`[iFlow] reasoning_content found in message history for ${model}`);
    }
    
    return body;
}

/**
 * 确保 tools 数组存在（避免某些模型的问题）
 * 如果 tools 是空数组，添加一个占位工具
 * 
 * @param {Object} body - 请求体
 * @returns {Object} - 处理后的请求体
 */
function ensureToolsArray(body) {
    if (!body || !body.tools) return body;
    
    if (Array.isArray(body.tools) && body.tools.length === 0) {
        return {
            ...body,
            tools: [{
                type: 'function',
                function: {
                    name: 'noop',
                    description: 'Placeholder tool to stabilise streaming',
                    parameters: { type: 'object' }
                }
            }]
        };
    }
    
    return body;
}

/**
 * 预处理请求体
 * @param {Object} body - 原始请求体
 * @param {string} model - 模型名称
 * @returns {Object} - 处理后的请求体
 */
function preprocessRequestBody(body, model) {
    let processedBody = { ...body };
    
    // 确保模型名称正确
    processedBody.model = model;
    
    // 应用 iFlow thinking 配置
    processedBody = applyIFlowThinkingConfig(processedBody, model);
    
    // 保留 reasoning_content
    processedBody = preserveReasoningContentInMessages(processedBody, model);
    
    // 确保 tools 数组
    processedBody = ensureToolsArray(processedBody);
    
    return processedBody;
}

// ==================== API 服务 ====================

/**
 * iFlow API 服务类
 */
// 默认 Token 文件路径
const DEFAULT_TOKEN_FILE_PATH = path.join(os.homedir(), '.iflow', 'oauth_creds.json');

export class IFlowApiService {
    constructor(config) {
        this.config = config;
        this.apiKey = null;
        this.baseUrl = config.IFLOW_BASE_URL || IFLOW_API_BASE_URL;
        this.tokenFilePath = config.IFLOW_TOKEN_FILE_PATH || DEFAULT_TOKEN_FILE_PATH;
        this.isInitialized = false;
        this.tokenStorage = null;
        
        // 配置 HTTP/HTTPS agent
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
                'User-Agent': IFLOW_USER_AGENT,
            },
        };
        
        // 配置自定义代理
        configureAxiosProxy(axiosConfig, config, 'openai-iflow');
        
        this.axiosInstance = axios.create(axiosConfig);
    }

    /**
     * 初始化服务
     */
    async initialize() {
        if (this.isInitialized) return;
        
        console.log('[iFlow] Initializing iFlow API Service...');
        await this.initializeAuth();
        
        this.isInitialized = true;
        console.log('[iFlow] Initialization complete.');
    }

    /**
     * 初始化认证
     * @param {boolean} forceRefresh - 是否强制刷新 Token
     */
    async initializeAuth(forceRefresh = false) {
        // 如果已有 API Key 且不强制刷新，直接返回
        if (this.apiKey && !forceRefresh) return;
        
        // 从 Token 文件加载 API Key
        if (!this.tokenFilePath) {
            throw new Error('[iFlow] IFLOW_TOKEN_FILE_PATH is required.');
        }
        
        try {
            this.tokenStorage = await loadTokenFromFile(this.tokenFilePath);
            if (this.tokenStorage && this.tokenStorage.apiKey) {
                this.apiKey = this.tokenStorage.apiKey;
                console.log('[iFlow Auth] Authentication configured successfully from file.');
                
                if (forceRefresh) {
                    console.log('[iFlow Auth] Forcing token refresh...');
                    await this._refreshOAuthTokens();
                    console.log('[iFlow Auth] Token refreshed and saved successfully.');
                }
            } else {
                throw new Error('[iFlow] Token file does not contain a valid API key.');
            }
        } catch (error) {
            console.error('[iFlow Auth] Error initializing authentication:', error.code || error.message);
            if (error.code === 'ENOENT') {
                console.log(`[iFlow Auth] Credentials file '${this.tokenFilePath}' not found.`);
                throw new Error(`[iFlow Auth] Credentials file not found. Please run OAuth flow first.`);
            } else {
                console.error('[iFlow Auth] Failed to initialize authentication from file:', error.message);
                throw new Error(`[iFlow Auth] Failed to load OAuth credentials.`);
            }
        }
        
        // 更新 axios 实例的 Authorization header
        this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    /**
     * 检查是否需要刷新 Token 并执行刷新
     * @returns {Promise<boolean>} - 是否执行了刷新
     */
    async _checkAndRefreshTokenIfNeeded() {
        if (!this.tokenStorage) {
            return false;
        }
        
        // 检查是否有 refresh_token
        if (!this.tokenStorage.refreshToken || this.tokenStorage.refreshToken.trim() === '') {
            console.log('[iFlow] No refresh_token available, skipping token refresh check');
            return false;
        }
        
        // 使用 isExpiryDateNear 检查过期时间
        if (!this.isExpiryDateNear()) {
            console.log('[iFlow] Token is valid, no refresh needed');
            return false;
        }
        
        console.log('[iFlow] Token is expiring soon, attempting refresh...');
        
        try {
            await this._refreshOAuthTokens();
            return true;
        } catch (error) {
            console.error('[iFlow] Token refresh failed:', error.message);
            // 刷新失败不抛出异常，继续使用现有 Token
            return false;
        }
    }

    /**
     * 使用 refresh_token 刷新 OAuth Token
     * @returns {Promise<void>}
     */
    async _refreshOAuthTokens() {
        if (!this.tokenStorage || !this.tokenStorage.refreshToken) {
            throw new Error('[iFlow] No refresh_token available');
        }
        
        const oldAccessToken = this.tokenStorage.accessToken;
        if (oldAccessToken) {
            console.log(`[iFlow] Refreshing access token, old: ${this._maskToken(oldAccessToken)}`);
        }
        
        // 调用刷新函数
        const oldRefreshToken = this.tokenStorage.refreshToken;
        const tokenData = await refreshOAuthTokens(oldRefreshToken, this.axiosInstance);
        
        // 更新 tokenStorage - 必须更新 refreshToken，因为 OAuth 服务器可能返回新的 refresh_token
        this.tokenStorage.accessToken = tokenData.accessToken;
        // 始终更新 refreshToken，即使服务器没有返回新的（tokenData.refreshToken 会回退到旧值）
        this.tokenStorage.refreshToken = tokenData.refreshToken;
        
        // 记录 refresh_token 是否发生变化
        if (tokenData.refreshToken !== oldRefreshToken) {
            console.log(`[iFlow] refresh_token has been rotated (old: ${this._maskToken(oldRefreshToken)}, new: ${this._maskToken(tokenData.refreshToken)})`);
        }
        if (tokenData.apiKey) {
            this.tokenStorage.apiKey = tokenData.apiKey;
            this.apiKey = tokenData.apiKey;
        }
        this.tokenStorage.expiryDate = tokenData.expiryDate;
        this.tokenStorage.tokenType = tokenData.tokenType || 'Bearer';
        this.tokenStorage.scope = tokenData.scope || '';
        if (tokenData.email) {
            this.tokenStorage.email = tokenData.email;
        }
        
        // 更新 axios 实例的 Authorization header
        this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.apiKey}`;
        
        // 保存到文件
        await saveTokenToFile(this.tokenFilePath, this.tokenStorage);
        
        console.log(`[iFlow] Token refresh successful, new: ${this._maskToken(tokenData.accessToken)}`);
    }

    /**
     * 掩码 Token（只显示前后几个字符）
     * @param {string} token - Token 字符串
     * @returns {string} - 掩码后的 Token
     */
    _maskToken(token) {
        if (!token || token.length < 10) {
            return '***';
        }
        return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
    }

    /**
     * 手动刷新 Token（供外部调用）
     * @returns {Promise<boolean>} - 是否刷新成功
     */
    async refreshToken() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            await this._refreshOAuthTokens();
            return true;
        } catch (error) {
            console.error('[iFlow] Manual token refresh failed:', error.message);
            return false;
        }
    }

    /**
     * Checks if the given expiry date is within the threshold from now or already expired.
     * @returns {boolean} True if the expiry date is within the threshold or already expired, false otherwise.
     */
    isExpiryDateNear() {
        try {
            if (!this.tokenStorage || !this.tokenStorage.expiryDate) {
                return false;
            }
            
            const currentTime = Date.now();
            // 授权文件时效48小时，判断是否过期或接近过期 （45小时）
            const cronNearMinutes = 60 * 45;
            const cronNearMinutesInMillis = cronNearMinutes * 60 * 1000;
            
            // 解析过期时间
            let expireTime;
            const expireValue = this.tokenStorage.expiryDate;
            
            // 检查是否为数字（毫秒时间戳）
            if (typeof expireValue === 'number') {
                expireTime = expireValue;
            } else if (typeof expireValue === 'string') {
                // 检查是否为纯数字字符串（毫秒时间戳）
                if (/^\d+$/.test(expireValue)) {
                    expireTime = parseInt(expireValue, 10);
                } else if (expireValue.includes('T')) {
                    // ISO 8601 格式
                    expireTime = new Date(expireValue).getTime();
                } else {
                    // 格式：2006-01-02 15:04
                    expireTime = new Date(expireValue.replace(' ', 'T') + ':00').getTime();
                }
            } else {
                console.error(`[iFlow] Invalid expiry date type: ${typeof expireValue}`);
                return false;
            }
            
            if (isNaN(expireTime)) {
                console.error(`[iFlow] Error parsing expiry date: ${expireValue}`);
                return false;
            }
            
            // 计算剩余时间
            const timeRemaining = expireTime - currentTime;
            
            // 判断是否已过期或接近过期
            // 已过期：timeRemaining <= 0
            // 接近过期：timeRemaining > 0 && timeRemaining <= cronNearMinutesInMillis
            const isExpired = timeRemaining <= 0;
            const isNear = timeRemaining > 0 && timeRemaining <= cronNearMinutesInMillis;
            const needsRefresh = isExpired || isNear;
            
            const expireDateStr = new Date(expireTime).toISOString();
            const timeRemainingMinutes = Math.floor(timeRemaining / 60000);
            const timeRemainingHours = (timeRemaining / 3600000).toFixed(2);
            
            console.log(`[iFlow] Token expiry check: Expiry=${expireDateStr}, Remaining=${timeRemainingHours}h (${timeRemainingMinutes}min), Threshold=${cronNearMinutes}min, Expired=${isExpired}, Near=${isNear}, NeedsRefresh=${needsRefresh}`);
            
            return needsRefresh;
        } catch (error) {
            console.error(`[iFlow] Error checking expiry date: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取请求头
     * @param {boolean} stream - 是否为流式请求
     * @returns {Object} - 请求头
     */
    _getHeaders(stream = false) {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'User-Agent': IFLOW_USER_AGENT,
        };
        
        if (stream) {
            headers['Accept'] = 'text/event-stream';
        } else {
            headers['Accept'] = 'application/json';
        }
        
        return headers;
    }

    /**
     * 调用 API
     */
    async callApi(endpoint, body, model, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        // 预处理请求体
        const processedBody = preprocessRequestBody(body, model);

        try {
            const response = await this.axiosInstance.post(endpoint, processedBody, {
                headers: this._getHeaders(false)
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            // Handle 401/400 - refresh auth and retry once
            if ((status === 400 || status === 401) && !isRetry) {
                console.log(`[iFlow] Received ${status}. Refreshing auth and retrying...`);
                try {
                    await this.initializeAuth(true);
                    return this.callApi(endpoint, body, model, true, retryCount);
                } catch (authError) {
                    console.error('[iFlow] Failed to refresh auth during retry:', authError.message);
                    throw error; // throw original error if refresh fails
                }
            }

            if (status === 401 || status === 403) {
                console.error(`[iFlow] Received ${status}. API Key might be invalid or expired.`);
                throw error;
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[iFlow] Received 429 (Too Many Requests). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, model, isRetry, retryCount + 1);
            }

            // Handle other retryable errors (5xx server errors)
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[iFlow] Received ${status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, model, isRetry, retryCount + 1);
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                console.log(`[iFlow] Network error (${errorIdentifier}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, model, isRetry, retryCount + 1);
            }

            console.error(`[iFlow] Error calling API (Status: ${status}, Code: ${errorCode}):`, data || error.message);
            throw error;
        }
    }

    /**
     * 流式调用 API
     *
     * - 使用大缓冲区处理长行
     * - 逐行处理 SSE 数据
     * - 正确处理 data: 前缀和 [DONE] 标记
     */
    async *streamApi(endpoint, body, model, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        // 预处理请求体并设置 stream: true
        const processedBody = preprocessRequestBody({ ...body, stream: true }, model);

        try {
            const response = await this.axiosInstance.post(endpoint, processedBody, {
                responseType: 'stream',
                headers: this._getHeaders(true)
            });

            const stream = response.data;
            let buffer = '';

            for await (const chunk of stream) {
                // 将 chunk 转换为字符串并追加到缓冲区
                buffer += chunk.toString();
                
                // 逐行处理
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    // 提取一行（不包含换行符）
                    const line = buffer.substring(0, newlineIndex);
                    buffer = buffer.substring(newlineIndex + 1);
                    
                    // 去除行首尾空白（处理 \r\n 情况）
                    const trimmedLine = line.trim();
                    
                    // 跳过空行（SSE 格式中的分隔符）
                    if (trimmedLine === '') {
                        continue;
                    }

                    // 处理 SSE data: 前缀
                    if (trimmedLine.startsWith('data:')) {
                        // 提取 data: 后的内容（注意：data: 后可能有空格也可能没有）
                        let jsonData = trimmedLine.substring(5);
                        // 去除前导空格
                        if (jsonData.startsWith(' ')) {
                            jsonData = jsonData.substring(1);
                        }
                        jsonData = jsonData.trim();
                        
                        // 检查流结束标记
                        if (jsonData === '[DONE]') {
                            return; // 流结束
                        }
                        
                        // 跳过空数据
                        if (jsonData === '') {
                            continue;
                        }
                        
                        try {
                            const parsedChunk = JSON.parse(jsonData);
                            yield parsedChunk;
                        } catch (e) {
                            // JSON 解析失败，记录警告但继续处理
                            console.warn("[iFlow] Failed to parse stream chunk JSON:", e.message, "Data:", jsonData.substring(0, 200));
                        }
                    }
                    // 忽略其他 SSE 字段（如 event:, id:, retry: 等）
                }
            }
            
            // 处理缓冲区中剩余的数据（如果有的话）
            if (buffer.trim() !== '') {
                const trimmedLine = buffer.trim();
                if (trimmedLine.startsWith('data:')) {
                    let jsonData = trimmedLine.substring(5);
                    if (jsonData.startsWith(' ')) {
                        jsonData = jsonData.substring(1);
                    }
                    jsonData = jsonData.trim();
                    
                    if (jsonData !== '[DONE]' && jsonData !== '') {
                        try {
                            const parsedChunk = JSON.parse(jsonData);
                            yield parsedChunk;
                        } catch (e) {
                            console.warn("[iFlow] Failed to parse final stream chunk JSON:", e.message);
                        }
                    }
                }
            }
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            // Handle 401/400 during stream - refresh auth and retry once
            if ((status === 400 || status === 401) && !isRetry) {
                console.log(`[iFlow] Received ${status} during stream. Refreshing auth and retrying...`);
                try {
                    await this.initializeAuth(true);
                    yield* this.streamApi(endpoint, body, model, true, retryCount);
                    return;
                } catch (authError) {
                    console.error('[iFlow] Failed to refresh auth during stream retry:', authError.message);
                    throw error;
                }
            }

            if (status === 401 || status === 403) {
                console.error(`[iFlow] Received ${status} during stream. API Key might be invalid or expired.`);
                throw error;
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[iFlow] Received 429 (Too Many Requests) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, model, isRetry, retryCount + 1);
                return;
            }

            // Handle other retryable errors (5xx server errors)
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[iFlow] Received ${status} server error during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, model, isRetry, retryCount + 1);
                return;
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                console.log(`[iFlow] Network error (${errorIdentifier}) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, model, isRetry, retryCount + 1);
                return;
            }

            console.error(`[iFlow] Error calling streaming API (Status: ${status}, Code: ${errorCode}):`, data || error.message);
            throw error;
        }
    }

    /**
     * 生成内容
     */
    async generateContent(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        // 在 API 调用前检查是否需要刷新 Token
        await this._checkAndRefreshTokenIfNeeded();
        
        return this.callApi('/chat/completions', requestBody, model);
    }

    /**
     * 流式生成内容
     */
    async *generateContentStream(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        // 在 API 调用前检查是否需要刷新 Token
        await this._checkAndRefreshTokenIfNeeded();
        
        yield* this.streamApi('/chat/completions', requestBody, model);
    }

    /**
     * 列出可用模型
     */
    async listModels() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            const response = await this.axiosInstance.get('/models', {
                headers: this._getHeaders(false)
            });
            
            // 检查返回数据中是否包含 glm-4.7，如果没有则添加
            const modelsData = response.data;
            if (modelsData && modelsData.data && Array.isArray(modelsData.data)) {
                const hasGlm47 = modelsData.data.some(model => model.id === 'glm-4.7');
                if (!hasGlm47) {
                    // 添加 glm-4.7 模型到返回列表
                    modelsData.data.push({
                        id: 'glm-4.7',
                        object: 'model',
                        created: Math.floor(Date.now() / 1000),
                        owned_by: 'iflow'
                    });
                    console.log('[iFlow] Added glm-4.7 to models list');
                }
            }
            
            return modelsData;
        } catch (error) {
            console.warn('[iFlow] Failed to fetch models from API, using default list:', error.message);
            // 返回默认模型列表，确保包含 glm-4.7
            const defaultModels = [...IFLOW_MODELS];
            if (!defaultModels.includes('glm-4.7')) {
                defaultModels.push('glm-4.7');
            }
            return {
                object: 'list',
                data: defaultModels.map(id => ({
                    id,
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'iflow'
                }))
            };
        }
    }

}

export {
    IFLOW_MODELS,
    IFLOW_USER_AGENT,
    IFlowTokenStorage,
    loadTokenFromFile,
    saveTokenToFile,
    refreshOAuthTokens,
    fetchUserInfo,
    isThinkingModel,
    applyIFlowThinkingConfig,
    preserveReasoningContentInMessages,
    ensureToolsArray,
    preprocessRequestBody,
};