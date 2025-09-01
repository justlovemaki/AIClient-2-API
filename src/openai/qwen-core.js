import axios from 'axios';
import crypto from 'crypto';
import path from 'node:path';
import { promises as fs, unlinkSync } from 'node:fs';
import * as os from 'os';
import open from 'open';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';

// --- Constants ---
const QWEN_DIR = '.qwen';
const QWEN_CREDENTIAL_FILENAME = 'oauth_creds.json';
const QWEN_LOCK_FILENAME = 'oauth_creds.lock';

const TOKEN_REFRESH_BUFFER_MS = 30 * 1000;
const LOCK_TIMEOUT_MS = 10000;
const CACHE_CHECK_INTERVAL_MS = 1000;

const DEFAULT_LOCK_CONFIG = {
  maxAttempts: 50,
  attemptInterval: 200,
};

const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export const QwenOAuth2Event = {
    AuthUri: 'auth-uri',
    AuthProgress: 'auth-progress',
    AuthCancel: 'auth-cancel',
};
export const qwenOAuth2Events = new EventEmitter();


// --- Helper Functions ---

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


// --- Core Service Class ---

export class QwenApiService {
    constructor(config) {
        this.config = config;
        this.isInitialized = false;
        this.qwenClient = new QwenOAuth2Client();
        this.sharedManager = SharedTokenManager.getInstance();
        this.currentAxiosInstance = null;
    }

    static async create(config) {
        const instance = new QwenApiService(config);
        await instance.initialize();
        return instance;
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[Qwen] Initializing Qwen API Service...');
        await this._initializeAuth();
        
        this.currentAxiosInstance = axios.create({
            baseURL: DEFAULT_QWEN_BASE_URL,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer `,
            },
        });

        this.isInitialized = true;
        console.log('[Qwen] Initialization complete.');
    }

    async _initializeAuth(forceRefresh = false) {
        try {
            const credentials = await this.sharedManager.getValidCredentials(this.qwenClient, forceRefresh);
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

            if (await this._loadCachedQwenCredentials(this.qwenClient)) {
                const result = await this._authWithQwenDeviceFlow(this.qwenClient, this.config);
                if (!result.success) {
                    throw new Error('Qwen OAuth authentication failed');
                }
                return;
            }

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
        let isCancelled = false;
        const cancelHandler = () => { isCancelled = true; };
        qwenOAuth2Events.once(QwenOAuth2Event.AuthCancel, cancelHandler);

        try {
            const { code_verifier, code_challenge } = generatePKCEPair();
            const deviceAuth = await client.requestDeviceAuthorization({
                scope: QWEN_OAUTH_SCOPE,
                code_challenge,
                code_challenge_method: 'S256',
            });

            if (!isDeviceAuthorizationSuccess(deviceAuth)) {
                throw new Error(`Device authorization failed: ${deviceAuth?.error || 'Unknown error'} - ${deviceAuth?.error_description || 'No details'}`);
            }

            qwenOAuth2Events.emit(QwenOAuth2Event.AuthUri, deviceAuth);

            const showFallbackMessage = () => {
                console.log('\n=== Qwen OAuth Device Authorization ===');
                console.log('Please visit the following URL in your browser to authorize:');
                console.log(`\n${deviceAuth.verification_uri_complete}\n`);
                console.log('Waiting for authorization to complete...\n');
            };

            if (config) {
                try {
                    const childProcess = await open(deviceAuth.verification_uri_complete);
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

            let pollInterval = 2000;
            const maxAttempts = Math.ceil(deviceAuth.expires_in / (pollInterval / 1000));

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (isCancelled) {
                    qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'error', 'Authentication cancelled by user.');
                    return { success: false, reason: 'cancelled' };
                }

                try {
                    const tokenResponse = await client.pollDeviceToken({ device_code: deviceAuth.device_code, code_verifier });
                    if (isDeviceTokenSuccess(tokenResponse)) {
                        const credentials = {
                            access_token: tokenResponse.access_token,
                            refresh_token: tokenResponse.refresh_token || undefined,
                            token_type: tokenResponse.token_type,
                            resource_url: tokenResponse.resource_url,
                            expiry_date: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : undefined,
                        };
                        client.setCredentials(credentials);
                        await this._cacheQwenCredentials(credentials);
                        qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'success', 'Authentication successful! Access token obtained.');
                        return { success: true };
                    }

                    if (isDeviceTokenPending(tokenResponse)) {
                        if (tokenResponse.slowDown) {
                            pollInterval = Math.min(pollInterval * 1.5, 10000);
                        } else {
                            pollInterval = 2000;
                        }
                        // Fall through to wait and continue
                    } else if (isErrorResponse(tokenResponse)) {
                        console.warn(`Token polling failed with error: ${tokenResponse?.error || 'Unknown error'}`);
                        // Fall through to wait and continue
                    }
                } catch (error) {
                    console.warn(`Token polling threw an exception: ${error.message}`);
                    // Fall through to wait for the next attempt
                }
                
                // Wait for the polling interval before the next attempt
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
            return { success: false, reason: 'timeout' };
        } catch (error) {
            console.error('Device authorization flow failed:', error.message);
            return { success: false, reason: 'error' };
        } finally {
            qwenOAuth2Events.off(QwenOAuth2Event.AuthCancel, cancelHandler);
        }
    }

    _getQwenCachedCredentialPath() {
        if (this.config && this.config.QWEN_OAUTH_CREDS_FILE_PATH) {
            return this.config.QWEN_OAUTH_CREDS_FILE_PATH;
        }
        return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
    }

    async _loadCachedQwenCredentials(client) {
        try {
            const keyFile = this._getQwenCachedCredentialPath();
            const creds = await fs.readFile(keyFile, 'utf-8');
            const credentials = JSON.parse(creds);
            client.setCredentials(credentials);
            const { token } = await client.getAccessToken();
            return !!token;
        } catch (_) {
            return false;
        }
    }

    async _cacheQwenCredentials(credentials) {
        const filePath = this._getQwenCachedCredentialPath();
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const credString = JSON.stringify(credentials, null, 2);
        await fs.writeFile(filePath, credString);
    }
    
    getCurrentEndpoint(resourceUrl) {
        const baseEndpoint = resourceUrl || DEFAULT_QWEN_BASE_URL;
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
            const credentials = await this.sharedManager.getValidCredentials(this.qwenClient);
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

    async callApiWithAuthAndRetry(endpoint, body, isStream = false, retryCount = 0) {
        const maxRetries = (this.config && this.config.REQUEST_MAX_RETRIES) || 3;
        const baseDelay = (this.config && this.config.REQUEST_BASE_DELAY) || 1000;

        try {
            const { token, endpoint: qwenBaseUrl } = await this.getValidToken();

            this.currentAxiosInstance = axios.create({
                baseURL: qwenBaseUrl,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });

            const requestBody = isStream ? { ...body, stream: true } : body;
            const options = isStream ? { responseType: 'stream' } : {};
            const response = await this.currentAxiosInstance.post(endpoint, requestBody, options);
            return response.data;

        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data || error.message;

            if (this.isAuthError(error) && retryCount === 0) {
                console.warn(`[QwenApiService] Auth error (${status}). Refreshing token...`);
                try {
                    await this.sharedManager.getValidCredentials(this.qwenClient, true);
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

            console.error(`Error calling Qwen API (Status: ${status}):`, data);
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
            data: [
                { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
                { id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash' }
            ],
            default_model: 'qwen3-coder-flash'
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
    memoryCache = { credentials: null, fileModTime: 0, lastCheck: 0 };
    refreshPromise = null;
    cleanupHandlersRegistered = false;
    cleanupFunction = null;
    lockConfig = DEFAULT_LOCK_CONFIG;

    constructor() {
        this.registerCleanupHandlers();
    }

    static getInstance() {
        if (!SharedTokenManager.instance) {
            SharedTokenManager.instance = new SharedTokenManager();
        }
        return SharedTokenManager.instance;
    }

    registerCleanupHandlers() {
        if (this.cleanupHandlersRegistered) return;
        this.cleanupFunction = () => {
            try { unlinkSync(this.getLockFilePath()); } catch (_error) { /* Ignore */ }
        };
        process.on('exit', this.cleanupFunction);
        process.on('SIGINT', this.cleanupFunction);
        this.cleanupHandlersRegistered = true;
    }

    async getValidCredentials(qwenClient, forceRefresh = false) {
        try {
            await this.checkAndReloadIfNeeded();
            if (!forceRefresh && this.memoryCache.credentials && this.isTokenValid(this.memoryCache.credentials)) {
                return this.memoryCache.credentials;
            }
            if (this.refreshPromise) return this.refreshPromise;
            
            this.refreshPromise = this.performTokenRefresh(qwenClient, forceRefresh);
            const credentials = await this.refreshPromise;
            this.refreshPromise = null;
            return credentials;
        } catch (error) {
            this.refreshPromise = null;
            if (error instanceof TokenManagerError) throw error;
            throw new TokenManagerError(TokenError.REFRESH_FAILED,`Failed to get valid credentials: ${error.message}`, error);
        }
    }

    async checkAndReloadIfNeeded() {
        const now = Date.now();
        if (now - this.memoryCache.lastCheck < CACHE_CHECK_INTERVAL_MS) return;
        this.memoryCache.lastCheck = now;

        try {
            const stats = await fs.stat(this.getCredentialFilePath());
            if (stats.mtimeMs > this.memoryCache.fileModTime) {
                await this.reloadCredentialsFromFile();
                this.memoryCache.fileModTime = stats.mtimeMs;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.memoryCache.credentials = null;
                this.memoryCache.fileModTime = 0;
                throw new TokenManagerError(TokenError.FILE_ACCESS_ERROR, `Failed to access credentials file: ${error.message}`, error);
            }
            this.memoryCache.fileModTime = 0;
        }
    }

    async reloadCredentialsFromFile() {
        try {
            const content = await fs.readFile(this.getCredentialFilePath(), 'utf-8');
            this.memoryCache.credentials = JSON.parse(content);
        } catch (error) {
            this.memoryCache.credentials = null;
        }
    }

    async performTokenRefresh(qwenClient, forceRefresh = false) {
        const lockPath = this.getLockFilePath();
        try {
            const currentCredentials = qwenClient.getCredentials();
            if (!currentCredentials.refresh_token) {
                throw new TokenManagerError(TokenError.NO_REFRESH_TOKEN, 'No refresh token available');
            }

            await this.acquireLock(lockPath);
            await this.checkAndReloadIfNeeded();

            if (!forceRefresh && this.memoryCache.credentials && this.isTokenValid(this.memoryCache.credentials)) {
                qwenClient.setCredentials(this.memoryCache.credentials);
                return this.memoryCache.credentials;
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

            this.memoryCache.credentials = credentials;
            qwenClient.setCredentials(credentials);
            await this.saveCredentialsToFile(credentials);
            console.log('[Qwen Auth] Token refresh response: ok');
            return credentials;

        } catch (error) {
            if (error instanceof TokenManagerError) throw error;
            throw new TokenManagerError(TokenError.REFRESH_FAILED, `Unexpected error during token refresh: ${error.message}`, error);
        } finally {
            await this.releaseLock(lockPath);
        }
    }
    
    async saveCredentialsToFile(credentials) {
        const filePath = this.getCredentialFilePath();
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
        await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
        const stats = await fs.stat(filePath);
        this.memoryCache.fileModTime = stats.mtimeMs;
    }

    isTokenValid(credentials) {
        return credentials?.expiry_date && Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS;
    }

    getCredentialFilePath() {
        return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
    }

    getLockFilePath() {
        return path.join(os.homedir(), QWEN_DIR, QWEN_LOCK_FILENAME);
    }
    
    async acquireLock(lockPath) {
        const { maxAttempts, attemptInterval } = this.lockConfig;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                await fs.writeFile(lockPath, randomUUID(), { flag: 'wx' });
                return;
            } catch (error) {
                if (error.code === 'EEXIST') {
                    try {
                        const stats = await fs.stat(lockPath);
                        if (Date.now() - stats.mtimeMs > LOCK_TIMEOUT_MS) {
                            await fs.unlink(lockPath);
                            continue;
                        }
                    } catch (statError) { /* ignore */ }
                    await new Promise(resolve => setTimeout(resolve, attemptInterval));
                } else {
                    throw new TokenManagerError(TokenError.FILE_ACCESS_ERROR,`Failed to create lock file: ${error.message}`,error);
                }
            }
        }
        throw new TokenManagerError(TokenError.LOCK_TIMEOUT, 'Lock acquisition timeout');
    }

    async releaseLock(lockPath) {
        try { await fs.unlink(lockPath); } 
        catch (error) { if (error.code !== 'ENOENT') console.warn(`Failed to release lock: ${error.message}`);}
    }
}


// --- QwenOAuth2Client Class ---

class QwenOAuth2Client {
    credentials = {};

    setCredentials(credentials) { this.credentials = credentials; }
    getCredentials() { return this.credentials; }

    async refreshAccessToken() {
        if (!this.credentials.refresh_token) throw new Error('No refresh token');
        const bodyData = {
            grant_type: 'refresh_token',
            refresh_token: this.credentials.refresh_token,
            client_id: QWEN_OAUTH_CLIENT_ID,
        };
        const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: objectToUrlEncoded(bodyData),
        });
        if (!response.ok) {
            if (response.status === 400) {
                await fs.unlink(path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME)).catch(() => {});
                throw new Error("Refresh token expired or invalid.");
            }
            throw new Error(`Token refresh failed: ${response.status}`);
        }
        return await response.json();
    }

    async requestDeviceAuthorization(options) {
        const bodyData = {
            client_id: QWEN_OAUTH_CLIENT_ID,
            scope: options.scope,
            code_challenge: options.code_challenge,
            code_challenge_method: options.code_challenge_method,
        };
        const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: objectToUrlEncoded(bodyData),
        });
        if (!response.ok) throw new Error(`Device authorization failed: ${response.status}`);
        return await response.json();
    }

    async pollDeviceToken(options) {
        const bodyData = {
            grant_type: QWEN_OAUTH_GRANT_TYPE,
            client_id: QWEN_OAUTH_CLIENT_ID,
            device_code: options.device_code,
            code_verifier: options.code_verifier,
        };
        const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: objectToUrlEncoded(bodyData),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 400 && errorData.error === 'authorization_pending') {
                return { status: 'pending' };
            }
            if (response.status === 429 && errorData.error === 'slow_down') {
                return { status: 'pending', slowDown: true };
            }
            const error = new Error(`Device token poll failed: ${errorData.error || response.status}`);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    }
}