import axios from 'axios';
import crypto from 'crypto';
import path from 'node:path';
import { promises as fs, unlinkSync } from 'node:fs';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import open from 'open';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import { getProviderModels } from '../provider-models.js';
import { handleQwenOAuth } from '../../auth/oauth-handlers.js';
import { configureAxiosProxy } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError } from '../../utils/common.js';
import { acquireFileLock } from '../../utils/file-lock.js';

// --- Constants ---
const QWEN_DIR = '.qwen';
const QWEN_CREDENTIAL_FILENAME = 'oauth_creds.json';
// 从 provider-models.js 获取支持的模型列表
const QWEN_MODELS = getProviderModels('openai-qwen-oauth');
const QWEN_MODEL_LIST = QWEN_MODELS.map(id => ({
    id: id,
    name: id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}));

const TOKEN_REFRESH_BUFFER_MS = 30 * 1000;
const LOCK_TIMEOUT_MS = 10000;
const CACHE_CHECK_INTERVAL_MS = 1000;

const DEFAULT_LOCK_CONFIG = {
  maxAttempts: 50,
  attemptInterval: 200,
};

const DEFAULT_QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const DEFAULT_QWEN_BASE_URL = 'https://portal.qwen.ai/v1';
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export const QwenOAuth2Event = {
    AuthUri: 'auth-uri',
    AuthProgress: 'auth-progress',
    AuthCancel: 'auth-cancel',
};
export const qwenOAuth2Events = new EventEmitter();


// --- Helper Functions ---

// 封装公共的 await fetch 方法
async function commonFetch(url, options = {}, useSystemProxy = false) {
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
    };

    // 合并默认选项和传入的选项
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers,
        },
    };

    // 如果不使用系统代理,设置空的代理配置
    // 注意: Node.js 的 fetch 实现会自动使用环境变量中的代理设置
    // 这里通过设置 agent 为 null 来尝试禁用代理
    if (!useSystemProxy && typeof mergedOptions.agent === 'undefined') {
        // 对于 Node.js fetch,我们可以通过设置 dispatcher 来控制代理
        // 但这需要 undici 支持,这里我们先记录日志
        console.debug('[Qwen] System proxy disabled for fetch request');
    }

    const response = await fetch(url, mergedOptions);

    // 检查响应是否成功
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
    }

    // 返回 JSON 响应
    return await response.json();
}

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(codeVerifier) {
    const hash = crypto.createHash('sha256');
    hash.update(codeVerifier);
    return hash.digest('base64url');
}

function generatePKCEPair() {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    return { code_verifier: codeVerifier, code_challenge: codeChallenge };
}

function objectToUrlEncoded(data) {
    return Object.keys(data)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
        .join('&');
}

function isDeviceAuthorizationSuccess(response) {
    return 'device_code' in response;
}

function isDeviceTokenSuccess(response) {
    return (
        'access_token' in response &&
        response.access_token !== null &&
        response.access_token !== undefined &&
        typeof response.access_token === 'string' &&
        response.access_token.length > 0
    );
}

function isDeviceTokenPending(response) {
    return 'status' in response && response.status === 'pending';
}

function isErrorResponse(response) {
    return 'error' in response;
}


// --- Error Classes ---

export const TokenError = {
    REFRESH_FAILED: 'REFRESH_FAILED',
    NO_REFRESH_TOKEN: 'NO_REFRESH_TOKEN',
    LOCK_TIMEOUT: 'LOCK_TIMEOUT',
    FILE_ACCESS_ERROR: 'FILE_ACCESS_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
};

export class TokenManagerError extends Error {
    constructor(type, message, originalError) {
        super(message);
        this.type = type;
        this.originalError = originalError;
        this.name = 'TokenManagerError';
    }
}

/**
 * 自定义错误类,用于指示需要清除凭证
 * 当令牌刷新时发生 400 错误时抛出,表示刷新令牌已过期或无效
 */
export class CredentialsClearRequiredError extends Error {
    constructor(message, originalError) {
        super(message);
        this.name = 'CredentialsClearRequiredError';
        this.originalError = originalError;
    }
}


// --- Core Service Class ---

export class QwenApiService {
    constructor(config) {
        this.config = config;
        this.isInitialized = false;
        this.sharedManager = SharedTokenManager.getInstance();
        this.currentAxiosInstance = null;
        this.tokenManagerOptions = { credentialFilePath: this._getQwenCachedCredentialPath() };
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_QWEN ?? false;
        
        // Initialize instance-specific endpoints
        this.baseUrl = config.QWEN_BASE_URL || DEFAULT_QWEN_BASE_URL;
        const oauthBaseUrl = config.QWEN_OAUTH_BASE_URL || DEFAULT_QWEN_OAUTH_BASE_URL;
        this.oauthDeviceCodeEndpoint = `${oauthBaseUrl}/api/v1/oauth2/device/code`;
        this.oauthTokenEndpoint = `${oauthBaseUrl}/api/v1/oauth2/token`;

        console.log(`[Qwen] System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);
        this.qwenClient = new QwenOAuth2Client(config, this.useSystemProxy);
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[Qwen] Initializing Qwen API Service...');
        await this._initializeAuth();
        
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
                'Content-Type': 'application/json',
                'Authorization': `Bearer `,
            },
        };
        
        // 禁用系统代理
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        // 配置自定义代理
        configureAxiosProxy(axiosConfig, this.config, 'openai-qwen-oauth');
        
        this.currentAxiosInstance = axios.create(axiosConfig);

        this.isInitialized = true;
        console.log('[Qwen] Initialization complete.');
    }

    async _initializeAuth(forceRefresh = false) {
        try {
            const credentials = await this.sharedManager.getValidCredentials(
                this.qwenClient,
                forceRefresh,
                this.tokenManagerOptions,
            );
            // console.log('credentials', credentials);
            this.qwenClient.setCredentials(credentials);
        } catch (error) {
            console.debug('Shared token manager failed, attempting device flow:', error);

            if (error instanceof TokenManagerError) {
                switch (error.type) {
                    case TokenError.NO_REFRESH_TOKEN:
                        console.debug('No refresh token available, proceeding with device flow');
                        break;
                    case TokenError.REFRESH_FAILED:
                        console.debug('Token refresh failed, proceeding with device flow');
                        break;
                    case TokenError.NETWORK_ERROR:
                        console.warn('Network error during token refresh, trying device flow');
                        break;
                    default:
                        console.warn('Token manager error:', error.message);
                }
            }

            // If cached credentials are present and still valid, use them directly.
            if (await this._loadCachedQwenCredentials(this.qwenClient)) {
                console.log('[Qwen] Using cached OAuth credentials.');
                return;
            }

            // Otherwise, run device authorization flow to obtain fresh credentials.
            const result = await this._authWithQwenDeviceFlow(this.qwenClient, this.config);
            if (!result.success) {
                if (result.reason === 'timeout') {
                    qwenOAuth2Events.emit(
                        QwenOAuth2Event.AuthProgress,
                        'timeout',
                        'Authentication timed out. Please try again or select a different authentication method.',
                    );
                }
                switch (result.reason) {
                    case 'timeout':
                        throw new Error('Qwen OAuth authentication timed out');
                    case 'cancelled':
                        throw new Error('Qwen OAuth authentication was cancelled by user');
                    case 'rate_limit':
                        throw new Error('Too many request for Qwen OAuth authentication, please try again later.');
                    case 'error':
                    default:
                        throw new Error('Qwen OAuth authentication failed');
                }
            }
        }
    }
    
    async _authWithQwenDeviceFlow(client, config) {
        try {
            // 使用统一的 OAuth 处理方法
            const { authUrl, authInfo } = await handleQwenOAuth(config);
            
            // 发送授权 URI 事件
            qwenOAuth2Events.emit(QwenOAuth2Event.AuthUri, {
                verification_uri_complete: authUrl,
                user_code: authInfo.userCode,
                verification_uri: authInfo.verificationUri,
                device_code: authInfo.deviceCode,
                expires_in: authInfo.expiresIn,
                interval: authInfo.interval
            });

            const showFallbackMessage = () => {
                console.log('\n=== Qwen OAuth Device Authorization ===');
                console.log('Please visit the following URL in your browser to authorize:');
                console.log(`\n${authUrl}\n`);
                console.log('Waiting for authorization to complete...\n');
            };

            if (config) {
                try {
                    const childProcess = await open(authUrl);
                    if (childProcess) {
                        childProcess.on('error', () => showFallbackMessage());
                    }
                } catch (_err) {
                    showFallbackMessage();
                }
            } else {
                showFallbackMessage();
            }

            qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'polling', 'Waiting for authorization...');
            console.debug('Waiting for authorization...\n');

            // 等待 OAuth 回调完成并读取保存的凭据
            const credPath = this._getQwenCachedCredentialPath();
            const credentials = await new Promise((resolve, reject) => {
                const checkInterval = setInterval(async () => {
                    try {
                        const data = await fs.readFile(credPath, 'utf8');
                        const creds = JSON.parse(data);
                        if (creds.access_token) {
                            clearInterval(checkInterval);
                            console.log('[Qwen Auth] New token obtained successfully.');
                            resolve(creds);
                        }
                    } catch (error) {
                        // 文件尚未创建或无效，继续等待
                    }
                }, 1000);

                // 设置超时（5分钟）
                setTimeout(() => {
                    clearInterval(checkInterval);
                    reject(new Error('[Qwen Auth] OAuth 授权超时'));
                }, 5 * 60 * 1000);
            });

            client.setCredentials(credentials);
            qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'success', 'Authentication successful! Access token obtained.');
            return { success: true };
        } catch (error) {
            console.error('Device authorization flow failed:', error.message);
            qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'error', error.message);
            return { success: false, reason: 'error' };
        }
    }

    _getQwenCachedCredentialPath() {
        if (this.config && this.config.QWEN_OAUTH_CREDS_FILE_PATH) {
            return path.resolve(this.config.QWEN_OAUTH_CREDS_FILE_PATH);
        }
        return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
    }

    async _loadCachedQwenCredentials(client) {
        try {
            const keyFile = this._getQwenCachedCredentialPath();
            const creds = await fs.readFile(keyFile, 'utf-8');
            const credentials = JSON.parse(creds);
            client.setCredentials(credentials);
            // Consider credentials usable only if access_token exists and not near expiry
            const hasToken = !!credentials?.access_token;
            const notExpired = !!credentials?.expiry_date && (Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS);
            return hasToken && notExpired;
        } catch (_) {
            return false;
        }
    }

    async _cacheQwenCredentials(credentials) {
        const filePath = this._getQwenCachedCredentialPath();
        // 获取文件锁，防止并发写入
        const releaseLock = await acquireFileLock(filePath);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            const credString = JSON.stringify(credentials, null, 2);
            await fs.writeFile(filePath, credString);
            console.log(`[Qwen Auth] Credentials cached to ${filePath}`);
        } catch (error) {
            console.error(`[Qwen Auth] Failed to cache credentials to ${filePath}: ${error.message}`);
        } finally {
            releaseLock();
        }
    }
    
    getCurrentEndpoint(resourceUrl) {
        const baseEndpoint = resourceUrl || this.baseUrl;
        const suffix = '/v1';

        const normalizedUrl = baseEndpoint.startsWith('http') ?
            baseEndpoint :
            `https://${baseEndpoint}`;

        return normalizedUrl.endsWith(suffix) ?
            normalizedUrl :
            `${normalizedUrl}${suffix}`;
    }

    isAuthError(error) {
        if (!error) return false;
        const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
        const errorCode = error?.status || error?.code || error.response?.status;

        const code = String(errorCode);
        return (
            code.startsWith('401') || code.startsWith('403') ||
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('forbidden') ||
            errorMessage.includes('invalid api key') ||
            errorMessage.includes('invalid access token') ||
            errorMessage.includes('token expired') ||
            errorMessage.includes('authentication') ||
            errorMessage.includes('access denied')
        );
    }

    async getValidToken() {
        try {
            const credentials = await this.sharedManager.getValidCredentials(
                this.qwenClient,
                false,
                this.tokenManagerOptions,
            );
            if (!credentials.access_token) throw new Error('No access token available');
            return {
                token: credentials.access_token,
                endpoint: this.getCurrentEndpoint(credentials.resource_url),
            };
        } catch (error) {
            if (this.isAuthError(error)) throw error;
            console.warn('Failed to get token from shared manager:', error);
            throw new Error('Failed to obtain valid Qwen access token. Please re-authenticate.');
        }
    }

    /**
     * Processes message content in the request body.
     * If content is an array, it joins the elements with newlines.
     * @param {Object} requestBody - The request body to process
     * @returns {Object} The processed request body
     */
    processMessageContent(requestBody) {
        if (!requestBody || !requestBody.messages || !Array.isArray(requestBody.messages)) {
            return requestBody;
        }
        
        const processedMessages = requestBody.messages.map(message => {
            if (message.content && Array.isArray(message.content)) {
                // Convert each item to JSON string before joining
                const stringifiedContent = message.content.map(item =>
                    typeof item === 'string' ? item : item.text
                );
                return {
                    ...message,
                    content: stringifiedContent.join('\n')
                };
            }
            return message;
        });
        
        return {
            ...requestBody,
            messages: processedMessages
        };
    }

    async callApiWithAuthAndRetry(endpoint, body, isStream = false, retryCount = 0) {
        const maxRetries = (this.config && this.config.REQUEST_MAX_RETRIES) || 3;
        const baseDelay = (this.config && this.config.REQUEST_BASE_DELAY) || 1000;

        const version = "0.2.1";
        const userAgent = `QwenCode/${version} (${process.platform}; ${process.arch})`;
        console.log(`[QwenApiService] User-Agent: ${userAgent}`);

        try {
            const { token, endpoint: qwenBaseUrl } = await this.getValidToken();

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
                baseURL: qwenBaseUrl,
                httpAgent,
                httpsAgent,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-DashScope-CacheControl': 'enable',
                    'X-DashScope-UserAgent': userAgent,
                    'X-DashScope-AuthType': 'qwen-oauth',
                },
            };
            
            // 禁用系统代理
            if (!this.useSystemProxy) {
                axiosConfig.proxy = false;
            }
            
            // 配置自定义代理
            configureAxiosProxy(axiosConfig, this.config, 'openai-qwen-oauth');
            
            this.currentAxiosInstance = axios.create(axiosConfig);

            // Process message content before sending the request
            const processedBody = body;//this.processMessageContent(body);

            // Check if model in body is in QWEN_MODEL_LIST, if not, use the first model's id
            if (processedBody.model && !QWEN_MODEL_LIST.some(model => model.id === processedBody.model)) {
                console.warn(`[QwenApiService] Model '${processedBody.model}' not found. Using default model: '${QWEN_MODEL_LIST[0].id}'`);
                processedBody.model = QWEN_MODEL_LIST[0].id;
            }

            const defaultTools = [
                {
                    "type": "function",
                    "function": {
                    "name": "ext"
                    }
                }
            ];
            
            // Merge tools if requestBody already has tools defined
            const mergedTools = processedBody.tools ? [...defaultTools, ...processedBody.tools] : defaultTools;
            
            const requestBody = isStream ? { ...processedBody, stream: true, tools: mergedTools } : { ...processedBody, tools: mergedTools };
            const options = isStream ? { responseType: 'stream' } : {};
            const response = await this.currentAxiosInstance.post(endpoint, requestBody, options);
            return response.data;

        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data || error.message;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);

            if (this.isAuthError(error) && retryCount === 0) {
                console.warn(`[QwenApiService] Auth error (${status}). Refreshing token...`);
                try {
                    await this.sharedManager.getValidCredentials(
                        this.qwenClient,
                        true,
                        this.tokenManagerOptions,
                    );
                    return this.callApiWithAuthAndRetry(endpoint, body, isStream, retryCount + 1);
                } catch (refreshError) {
                    console.error(`[QwenApiService] Token refresh failed:`, refreshError);
                    throw new Error(`Token refresh failed. Please re-authenticate. ${refreshError.message}`);
                }
            }

            if ((status === 429 || (status >= 500 && status < 600)) && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[QwenApiService] Status ${status}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApiWithAuthAndRetry(endpoint, body, isStream, retryCount + 1);
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                console.log(`[QwenApiService] Network error (${errorIdentifier}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApiWithAuthAndRetry(endpoint, body, isStream, retryCount + 1);
            }

            console.error(`[QwenApiService] Error calling API (Status: ${status}, Code: ${errorCode}):`, data);
            throw error;
        }
    }

    async generateContent(model, requestBody) {
        return this.callApiWithAuthAndRetry('/chat/completions', requestBody, false);
    }

    async *generateContentStream(model, requestBody) {
        const stream = await this.callApiWithAuthAndRetry('/chat/completions', requestBody, true);
        let buffer = '';
        for await (const chunk of stream) {
            buffer += chunk.toString();
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex).trim();
                buffer = buffer.substring(newlineIndex + 1);

                if (line.startsWith('data: ')) {
                    const jsonData = line.substring(6).trim();
                    if (jsonData === '[DONE]') return;
                    try {
                        yield JSON.parse(jsonData);
                    } catch (e) {
                        console.warn("[QwenApiService] Failed to parse stream chunk:", jsonData);
                    }
                }
            }
        }
    }

    async listModels() {
        // Return the predefined models for Qwen
        return {
            data: QWEN_MODEL_LIST
        };
    }

    isExpiryDateNear() {
        try {
            const credentials = this.qwenClient.getCredentials();
            if (!credentials || !credentials.expiry_date) {
                return false;
            }
            const currentTime = Date.now();
            const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
            console.log(`[Qwen] Expiry date: ${credentials.expiry_date}, Current time: ${currentTime}, ${this.config.CRON_NEAR_MINUTES || 10} minutes from now: ${currentTime + cronNearMinutesInMillis}`);
            return credentials.expiry_date <= (currentTime + cronNearMinutesInMillis);
        } catch (error) {
            console.error(`[Qwen] Error checking expiry date: ${error.message}`);
            return false;
        }
    }
}


// --- SharedTokenManager Class (Singleton) ---

class SharedTokenManager {
    static instance = null;

    constructor() {
        this.contexts = new Map();
        this.lockPaths = new Set();
        this.cleanupHandlersRegistered = false;
        this.cleanupFunction = null;
        this.sigintHandler = null;
        this.registerCleanupHandlers();
    }

    static getInstance() {
        if (!SharedTokenManager.instance) {
            SharedTokenManager.instance = new SharedTokenManager();
        }
        return SharedTokenManager.instance;
    }

    getContext(options = {}) {
        const credentialFilePath = this.resolveCredentialFilePath(options.credentialFilePath);
        const lockFilePath = this.resolveLockFilePath(credentialFilePath, options.lockFilePath);
        let context = this.contexts.get(credentialFilePath);
        if (!context) {
            context = {
                credentialFilePath,
                lockFilePath,
                lockConfig: options.lockConfig || DEFAULT_LOCK_CONFIG,
                memoryCache: { credentials: null, fileModTime: 0, lastCheck: 0 },
                refreshPromise: null,
            };
            this.contexts.set(credentialFilePath, context);
            this.lockPaths.add(lockFilePath);
        } else if (options.lockConfig) {
            context.lockConfig = options.lockConfig;
        }
        return context;
    }

    resolveCredentialFilePath(customPath) {
        if (customPath) {
            return path.resolve(customPath);
        }
        return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
    }

    resolveLockFilePath(credentialFilePath, customLockPath) {
        if (customLockPath) {
            return path.resolve(customLockPath);
        }
        return `${credentialFilePath}.lock`;
    }

    registerCleanupHandlers() {
        if (this.cleanupHandlersRegistered) return;
        this.cleanupFunction = () => {
            for (const lockPath of this.lockPaths) {
                try { unlinkSync(lockPath); } catch (_error) { /* ignore */ }
            }
        };
        this.sigintHandler = () => {
            this.cleanupFunction();
            process.exit(0);
        };
        process.on('exit', this.cleanupFunction);
        process.on('SIGINT', this.sigintHandler);
        this.cleanupHandlersRegistered = true;
    }

    async getValidCredentials(qwenClient, forceRefresh = false, options = {}) {
        const context = this.getContext(options);
        try {
            await this.checkAndReloadIfNeeded(context);
            if (!forceRefresh && context.memoryCache.credentials && this.isTokenValid(context.memoryCache.credentials)) {
                return context.memoryCache.credentials;
            }
            if (context.refreshPromise) {
                return context.refreshPromise;
            }

            qwenClient.setCredentials(context.memoryCache.credentials);
            context.refreshPromise = this.performTokenRefresh(context, qwenClient, forceRefresh);
            const credentials = await context.refreshPromise;
            context.refreshPromise = null;
            return credentials;
        } catch (error) {
            context.refreshPromise = null;
            if (error instanceof TokenManagerError) throw error;
            throw new TokenManagerError(
                TokenError.REFRESH_FAILED,
                `Failed to get valid credentials: ${error.message}`,
                error,
            );
        }
    }

    async checkAndReloadIfNeeded(context) {
        const now = Date.now();
        if (now - context.memoryCache.lastCheck < CACHE_CHECK_INTERVAL_MS) return;
        context.memoryCache.lastCheck = now;

        try {
            const stats = await fs.stat(context.credentialFilePath);
            if (stats.mtimeMs > context.memoryCache.fileModTime) {
                await this.reloadCredentialsFromFile(context);
                context.memoryCache.fileModTime = stats.mtimeMs;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                context.memoryCache.credentials = null;
                context.memoryCache.fileModTime = 0;
                throw new TokenManagerError(
                    TokenError.FILE_ACCESS_ERROR,
                    `Failed to access credentials file: ${error.message}`,
                    error,
                );
            }
            context.memoryCache.credentials = null;
            context.memoryCache.fileModTime = 0;
        }
    }

    async reloadCredentialsFromFile(context) {
        try {
            const content = await fs.readFile(context.credentialFilePath, 'utf-8');
            context.memoryCache.credentials = JSON.parse(content);
        } catch (_error) {
            context.memoryCache.credentials = null;
        }
    }

    async performTokenRefresh(context, qwenClient, forceRefresh = false) {
        try {
            const currentCredentials = qwenClient.getCredentials() || context.memoryCache.credentials;
            if (!currentCredentials || !currentCredentials.refresh_token) {
                throw new TokenManagerError(TokenError.NO_REFRESH_TOKEN, 'No refresh token available');
            }

            await this.acquireLock(context);
            await this.checkAndReloadIfNeeded(context);

            if (!forceRefresh && context.memoryCache.credentials && this.isTokenValid(context.memoryCache.credentials)) {
                qwenClient.setCredentials(context.memoryCache.credentials);
                return context.memoryCache.credentials;
            }

            const response = await qwenClient.refreshAccessToken();
            if (!response || isErrorResponse(response)) {
                throw new TokenManagerError(TokenError.REFRESH_FAILED, `Token refresh failed: ${response?.error}`);
            }
            if (!response.access_token) {
                throw new TokenManagerError(TokenError.REFRESH_FAILED, 'No access token in refresh response');
            }
            const credentials = {
                access_token: response.access_token,
                token_type: response.token_type,
                refresh_token: response.refresh_token || currentCredentials.refresh_token,
                resource_url: response.resource_url,
                expiry_date: Date.now() + response.expires_in * 1000,
            };

            context.memoryCache.credentials = credentials;
            qwenClient.setCredentials(credentials);
            await this.saveCredentialsToFile(context, credentials);
            console.log('[Qwen Auth] Token refresh response: ok');
            return credentials;

        } catch (error) {
            if (error instanceof TokenManagerError) throw error;
            
            // 处理 CredentialsClearRequiredError - 清除凭证文件
            if (error instanceof CredentialsClearRequiredError) {
                try {
                    await fs.unlink(context.credentialFilePath);
                    console.log('[Qwen Auth] Credentials cleared due to refresh token expiry');
                } catch (_) { /* ignore */ }
                throw error; // 重新抛出以便上层处理
            }
            
            // 如果刷新令牌无效/过期,删除此上下文对应的凭证文件
            if (error && (error.status === 400 || /expired|invalid/i.test(error.message || ''))) {
                try { await fs.unlink(context.credentialFilePath); } catch (_) { /* ignore */ }
            }
            throw new TokenManagerError(
                TokenError.REFRESH_FAILED,
                `Unexpected error during token refresh: ${error.message}`,
                error,
            );
        } finally {
            await this.releaseLock(context);
        }
    }
    
    async saveCredentialsToFile(context, credentials) {
        // 获取文件锁，防止并发写入
        const releaseLock = await acquireFileLock(context.credentialFilePath);
        try {
            await fs.mkdir(path.dirname(context.credentialFilePath), { recursive: true, mode: 0o700 });
            await fs.writeFile(context.credentialFilePath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
            const stats = await fs.stat(context.credentialFilePath);
            context.memoryCache.fileModTime = stats.mtimeMs;
        } finally {
            // 确保锁被释放
            releaseLock();
        }
    }

    isTokenValid(credentials) {
        return credentials?.expiry_date && Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS;
    }

    async acquireLock(context) {
        const { maxAttempts, attemptInterval } = context.lockConfig || DEFAULT_LOCK_CONFIG;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                await fs.writeFile(context.lockFilePath, randomUUID(), { flag: 'wx' });
                return;
            } catch (error) {
                if (error.code === 'EEXIST') {
                    try {
                        const stats = await fs.stat(context.lockFilePath);
                        if (Date.now() - stats.mtimeMs > LOCK_TIMEOUT_MS) {
                            await fs.unlink(context.lockFilePath);
                            continue;
                        }
                    } catch (_statError) { /* ignore */ }
                    await new Promise(resolve => setTimeout(resolve, attemptInterval));
                } else {
                    throw new TokenManagerError(
                        TokenError.FILE_ACCESS_ERROR,
                        `Failed to create lock file: ${error.message}`,
                        error,
                    );
                }
            }
        }
        throw new TokenManagerError(TokenError.LOCK_TIMEOUT, 'Lock acquisition timeout');
    }

    async releaseLock(context) {
        try {
            await fs.unlink(context.lockFilePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn(`Failed to release lock: ${error.message}`);
            }
        }
    }
}


// --- QwenOAuth2Client Class ---

class QwenOAuth2Client {
    credentials = {};

    constructor(config, useSystemProxy = false) {
        this.config = config;
        this.useSystemProxy = useSystemProxy;

        // Initialize OAuth endpoints
        const oauthBaseUrl = config.QWEN_OAUTH_BASE_URL || DEFAULT_QWEN_OAUTH_BASE_URL;
        this.oauthDeviceCodeEndpoint = `${oauthBaseUrl}/api/v1/oauth2/device/code`;
        this.oauthTokenEndpoint = `${oauthBaseUrl}/api/v1/oauth2/token`;
    }

    setCredentials(credentials) { this.credentials = credentials; }
    getCredentials() { return this.credentials; }

    async refreshAccessToken() {
        if (!this.credentials.refresh_token) throw new Error('No refresh token');
        const bodyData = {
            grant_type: 'refresh_token',
            refresh_token: this.credentials.refresh_token,
            client_id: QWEN_OAUTH_CLIENT_ID,
        };
        try {
            const endpoint = this.oauthTokenEndpoint;
            const response = await commonFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: objectToUrlEncoded(bodyData),
            }, this.useSystemProxy);
            return response;
        } catch (error) {
            const errorData = error.data || {};
            // 处理 400 错误,可能表示刷新令牌已过期
            if (error.status === 400) {
                // 清除凭证将由 SharedTokenManager 处理
                throw new CredentialsClearRequiredError(
                    "刷新令牌已过期或无效。请使用 '/auth' 重新认证。",
                    { status: error.status, response: errorData }
                );
            }
            throw new Error(
                `Token refresh failed: ${error.status || 'Unknown'} - ${errorData.error_description || error.message || 'No details'}`
            );
        }
    }

    async requestDeviceAuthorization(options) {
        const bodyData = {
            client_id: QWEN_OAUTH_CLIENT_ID,
            scope: options.scope,
            code_challenge: options.code_challenge,
            code_challenge_method: options.code_challenge_method,
        };
        try {
            const endpoint = this.oauthDeviceCodeEndpoint;
            const response = await commonFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: objectToUrlEncoded(bodyData),
            }, this.useSystemProxy);
            return response;
        } catch (error) {
            throw new Error(`Device authorization failed: ${error.status || error.message}`);
        }
    }

    async pollDeviceToken(options) {
        const bodyData = {
            grant_type: QWEN_OAUTH_GRANT_TYPE,
            client_id: QWEN_OAUTH_CLIENT_ID,
            device_code: options.device_code,
            code_verifier: options.code_verifier,
        };
        try {
            const endpoint = this.oauthTokenEndpoint;
            const response = await commonFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: objectToUrlEncoded(bodyData),
            }, this.useSystemProxy);
            return response;
        } catch (error) {
            // 根据 OAuth RFC 8628,处理标准轮询响应
            // 尝试解析错误响应为 JSON
            const errorData = error.data || {};
            const status = error.status;

            // 用户尚未批准授权请求,继续轮询
            if (status === 400 && errorData.error === 'authorization_pending') {
                return { status: 'pending' };
            }

            // 客户端轮询过于频繁,返回 pending 并设置 slowDown 标志
            if (status === 429 && errorData.error === 'slow_down') {
                return { status: 'pending', slowDown: true };
            }

            // 处理其他 400 错误(access_denied, expired_token 等)作为真正的错误
            // 对于其他错误,抛出适当的错误信息
            const err = new Error(
                `Device token poll failed: ${errorData.error || 'Unknown error'} - ${errorData.error_description || 'No details provided'}`
            );
            err.status = status;
            throw err;
        }
    }
}
