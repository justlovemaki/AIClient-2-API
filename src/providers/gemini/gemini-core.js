import { OAuth2Client } from 'google-auth-library';
import logger from '../../utils/logger.js';
import * as http from 'http';
import * as https from 'https';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import open from 'open';
import { API_ACTIONS, formatExpiryTime, isRetryableNetworkError, formatExpiryLog } from '../../utils/common.js';
import { getProviderModels } from '../provider-models.js';
import { handleGeminiCliOAuth } from '../../auth/oauth-handlers.js';
import { getProxyConfigForProvider, getGoogleAuthProxyConfig } from '../../utils/proxy-utils.js';
import { getProviderPoolManager } from '../../services/service-manager.js';
import { MODEL_PROVIDER } from '../../utils/common.js';

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

// --- Constants ---
const AUTH_REDIRECT_PORT = 8085;
const CREDENTIALS_DIR = '.gemini';
const CREDENTIALS_FILE = 'oauth_creds.json';
const DEFAULT_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const DEFAULT_CODE_ASSIST_API_VERSION = 'v1internal';
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const GEMINI_MODELS = getProviderModels(MODEL_PROVIDER.GEMINI_CLI);
const ANTI_TRUNCATION_MODELS = GEMINI_MODELS.map(model => `anti-${model}`);

function is_anti_truncation_model(model) {
    return ANTI_TRUNCATION_MODELS.some(antiModel => model.includes(antiModel));
}

// 从防截断模型名中提取实际模型名
function extract_model_from_anti_model(model) {
    if (model.startsWith('anti-')) {
        const originalModel = model.substring(5); // 移除 'anti-' 前缀
        if (GEMINI_MODELS.includes(originalModel)) {
            return originalModel;
        }
    }
    return model; // 如果不是anti-前缀或不在原模型列表中，则返回原模型名
}

function toGeminiApiResponse(codeAssistResponse) {
    if (!codeAssistResponse) return null;
    const compliantResponse = { candidates: codeAssistResponse.candidates };
    if (codeAssistResponse.usageMetadata) compliantResponse.usageMetadata = codeAssistResponse.usageMetadata;
    if (codeAssistResponse.promptFeedback) compliantResponse.promptFeedback = codeAssistResponse.promptFeedback;
    if (codeAssistResponse.automaticFunctionCallingHistory) compliantResponse.automaticFunctionCallingHistory = codeAssistResponse.automaticFunctionCallingHistory;
    return compliantResponse;
}

/**
 * Ensures that all content parts in a request body have a 'role' property.
 * If 'systemInstruction' is present and lacks a role, it defaults to 'user'.
 * If any 'contents' entry lacks a role, it defaults to 'user'.
 * @param {Object} requestBody - The request body object.
 * @returns {Object} The modified request body with roles ensured.
 */
function ensureRolesInContents(requestBody) {
    delete requestBody.model;
    // delete requestBody.system_instruction;
    // delete requestBody.systemInstruction;
    if (requestBody.system_instruction) {
        requestBody.systemInstruction = requestBody.system_instruction;
        delete requestBody.system_instruction;
    }

    if (requestBody.systemInstruction && !requestBody.systemInstruction.role) {
        requestBody.systemInstruction.role = 'user';
    }

    if (requestBody.contents && Array.isArray(requestBody.contents)) {
        requestBody.contents.forEach(content => {
            if (!content.role) {
                content.role = 'user';
            }
        });

        // 如果存在 systemInstruction，将其放在 contents 索引 0 的位置
        // if (requestBody.systemInstruction) {
        //     // 检查 contents[0] 是否与 systemInstruction 内容相同
        //     const firstContent = requestBody.contents[0];
        //     let isSame = false;

        //     if (firstContent && firstContent.parts && requestBody.systemInstruction.parts) {
        //         // 比较 parts 数组的内容
        //         const firstContentText = firstContent.parts
        //             .filter(p => p?.text)
        //             .map(p => p.text)
        //             .join('\n');
        //         const systemInstructionText = requestBody.systemInstruction.parts
        //             .filter(p => p?.text)
        //             .map(p => p.text)
        //             .join('\n');
                
        //         isSame = firstContentText === systemInstructionText;
        //     }

        //     // 如果内容不同，则将 systemInstruction 插入到索引 0 的位置
        //     if (!isSame) {
        //         requestBody.contents.unshift({
        //             role: requestBody.systemInstruction.role || 'user',
        //             parts: requestBody.systemInstruction.parts
        //         });
        //     }
        //     delete requestBody.systemInstruction;
        // }
    }
    return requestBody;
}

async function* apply_anti_truncation_to_stream(service, model, requestBody) {
    let currentRequest = { ...requestBody };
    let allGeneratedText = '';

    while (true) {
        // 发送请求并处理流式响应
        const apiRequest = {
            model: model,
            project: service.projectId,
            request: currentRequest
        };
        const stream = service.streamApi(API_ACTIONS.STREAM_GENERATE_CONTENT, apiRequest);

        let lastChunk = null;
        let hasContent = false;

        for await (const chunk of stream) {
            const response = toGeminiApiResponse(chunk.response);
            if (response && response.candidates && response.candidates[0]) {
                yield response;
                lastChunk = response;
                hasContent = true;
            }
        }

        // 检查是否因为达到token限制而截断
        if (lastChunk &&
            lastChunk.candidates &&
            lastChunk.candidates[0] &&
            lastChunk.candidates[0].finishReason === 'MAX_TOKENS') {

            // 提取已生成的文本内容
            if (lastChunk.candidates[0].content && lastChunk.candidates[0].content.parts) {
                const generatedParts = lastChunk.candidates[0].content.parts
                    .filter(part => part.text)
                    .map(part => part.text);

                if (generatedParts.length > 0) {
                    const currentGeneratedText = generatedParts.join('');
                    allGeneratedText += currentGeneratedText;

                    // 构建新的请求，包含之前的对话历史和继续指令
                    const newContents = [...requestBody.contents];

                    // 添加之前生成的内容作为模型响应
                    newContents.push({
                        role: 'model',
                        parts: [{ text: currentGeneratedText }]
                    });

                    // 添加继续生成的指令
                    newContents.push({
                        role: 'user',
                        parts: [{ text: 'Please continue from where you left off.' }]
                    });

                    currentRequest = {
                        ...requestBody,
                        contents: newContents
                    };

                    // 继续下一轮请求
                    continue;
                }
            }
        }

        // 如果没有截断或无法继续，则退出循环
        break;
    }
}

export class GeminiApiService {
    constructor(config) {
        // 检查是否需要使用代理
        const proxyConfig = getGoogleAuthProxyConfig(config, 'gemini-cli-oauth');
        
        // 配置 OAuth2Client 使用自定义的 HTTP agent
        const oauth2Options = {
            clientId: OAUTH_CLIENT_ID,
            clientSecret: OAUTH_CLIENT_SECRET,
        };
        
        if (proxyConfig) {
            oauth2Options.transporterOptions = proxyConfig;
            logger.info('[Gemini] Using proxy for OAuth2Client');
        } else {
            oauth2Options.transporterOptions = {
                agent: httpsAgent,
            };
        }
        
        this.authClient = new OAuth2Client(oauth2Options);
        this.availableModels = [];
        this.isInitialized = false;

        this.config = config;
        this.host = config.HOST;
        this.oauthCredsBase64 = config.GEMINI_OAUTH_CREDS_BASE64;
        this.oauthCredsFilePath = config.GEMINI_OAUTH_CREDS_FILE_PATH;
        this.projectId = config.PROJECT_ID;

        this.codeAssistEndpoint = config.GEMINI_BASE_URL || DEFAULT_CODE_ASSIST_ENDPOINT;
        this.apiVersion = DEFAULT_CODE_ASSIST_API_VERSION;
        
        // 保存代理配置供后续使用
        this.proxyConfig = getProxyConfigForProvider(config, 'gemini-cli-oauth');
    }

    async initialize() {
        if (this.isInitialized) return;
        logger.info('[Gemini] Initializing Gemini API Service...');
        // 注意：V2 读写分离架构下，初始化不再执行同步认证/刷新逻辑
        // 仅执行基础的凭证加载
        await this.loadCredentials();

        if (!this.projectId) {
            this.projectId = await this.discoverProjectAndModels();
        } else {
            logger.info(`[Gemini] Using provided Project ID: ${this.projectId}`);
            this.availableModels = GEMINI_MODELS;
            logger.info(`[Gemini] Using fixed models: [${this.availableModels.join(', ')}]`);
        }
        if (this.projectId === 'default') {
            throw new Error("Error: 'default' is not a valid project ID. Please provide a valid Google Cloud Project ID using the --project-id argument.");
        }
        this.isInitialized = true;
        logger.info(`[Gemini] Initialization complete. Project ID: ${this.projectId}`);
    }

    /**
     * 加载凭证信息（不执行刷新）
     */
    async loadCredentials() {
        if (this.oauthCredsBase64) {
            try {
                const decoded = Buffer.from(this.oauthCredsBase64, 'base64').toString('utf8');
                const credentials = JSON.parse(decoded);
                this.authClient.setCredentials(credentials);
                logger.info('[Gemini Auth] Credentials loaded successfully from base64 string.');
                return;
            } catch (error) {
                logger.error('[Gemini Auth] Failed to parse base64 OAuth credentials:', error);
            }
        }

        const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);
        try {
            const data = await fs.readFile(credPath, "utf8");
            const credentials = JSON.parse(data);
            this.authClient.setCredentials(credentials);
            logger.info('[Gemini Auth] Credentials loaded successfully from file.');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug(`[Gemini Auth] Credentials file not found: ${credPath}`);
            } else {
                logger.warn(`[Gemini Auth] Failed to load credentials from file: ${error.message}`);
            }
        }
    }

    async initializeAuth(forceRefresh = false) {
        // 检查是否需要刷新 Token
        const needsRefresh = forceRefresh

        if (this.authClient.credentials.access_token && !needsRefresh) {
            // Token 有效且不需要刷新
            return;
        }

        // 首先执行基础凭证加载
        await this.loadCredentials();

        // 只有在明确要求刷新，或者 AccessToken 确实缺失时，才执行刷新/认证
        // 注意：在 V2 架构下，此方法主要由 PoolManager 的后台队列调用
        if (needsRefresh || !this.authClient.credentials.access_token) {
            const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);
            try {
                if (this.authClient.credentials.refresh_token) {
                    logger.info('[Gemini Auth] Token expiring soon or force refresh requested. Refreshing token...');
                    const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
                    this.authClient.setCredentials(newCredentials);
                    
                    // 如果不是从 base64 加载的，则保存到文件
                    if (!this.oauthCredsBase64) {
                        await this._saveCredentialsToFile(credPath, newCredentials);
                        logger.info('[Gemini Auth] Token refreshed and saved successfully.');
                    } else {
                        logger.info('[Gemini Auth] Token refreshed successfully (Base64 source).');
                    }

                    // 刷新成功，重置 PoolManager 中的刷新状态并标记为健康
                    const poolManager = getProviderPoolManager();
                    if (poolManager && this.uuid) {
                        poolManager.resetProviderRefreshStatus(MODEL_PROVIDER.GEMINI_CLI, this.uuid);
                    }
                } else {
                    logger.info(`[Gemini Auth] No access token or refresh token. Starting new authentication flow...`);
                    const newTokens = await this.getNewToken(credPath);
                    this.authClient.setCredentials(newTokens);
                    logger.info('[Gemini Auth] New token obtained and loaded into memory.');
                    
                    // 认证成功，重置状态
                    const poolManager = getProviderPoolManager();
                    if (poolManager && this.uuid) {
                        poolManager.resetProviderRefreshStatus(MODEL_PROVIDER.GEMINI_CLI, this.uuid);
                    }
                }
            } catch (error) {
                logger.error('[Gemini Auth] Failed to initialize authentication:', error);
                throw new Error(`Failed to load OAuth credentials.`);
            }
        }
    }

    async getNewToken(credPath) {
        // 使用统一的 OAuth 处理方法
        const { authUrl, authInfo } = await handleGeminiCliOAuth(this.config);
        
        logger.info('\n[Gemini Auth] 正在自动打开浏览器进行授权...');
        logger.info('[Gemini Auth] 授权链接:', authUrl, '\n');

        // 自动打开浏览器
        const showFallbackMessage = () => {
            logger.info('[Gemini Auth] 无法自动打开浏览器，请手动复制上面的链接到浏览器中打开');
        };

        if (this.config) {
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

        // 等待 OAuth 回调完成并读取保存的凭据
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(async () => {
                try {
                    const data = await fs.readFile(credPath, 'utf8');
                    const credentials = JSON.parse(data);
                    if (credentials.access_token) {
                        clearInterval(checkInterval);
                        logger.info('[Gemini Auth] New token obtained successfully.');
                        resolve(credentials);
                    }
                } catch (error) {
                    // 文件尚未创建或无效，继续等待
                }
            }, 1000);

            // 设置超时（5分钟）
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('[Gemini Auth] OAuth 授权超时'));
            }, 5 * 60 * 1000);
        });
    }

    async discoverProjectAndModels() {
        if (this.projectId) {
            logger.info(`[Gemini] Using pre-configured Project ID: ${this.projectId}`);
            return this.projectId;
        }

        logger.info('[Gemini] Discovering Project ID...');
        this.availableModels = GEMINI_MODELS;
        logger.info(`[Gemini] Using fixed models: [${this.availableModels.join(', ')}]`);
        try {
            const initialProjectId = ""
            // Prepare client metadata
            const clientMetadata = {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: initialProjectId,
            }

            // Call loadCodeAssist to discover the actual project ID
            const loadRequest = {
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            }

            const loadResponse = await this.callApi('loadCodeAssist', loadRequest);

            // Check if we already have a project ID from the response
            if (loadResponse.cloudaicompanionProject) {
                return loadResponse.cloudaicompanionProject;
            }

            // If no existing project, we need to onboard
            const defaultTier = loadResponse.allowedTiers?.find(tier => tier.isDefault);
            const tierId = defaultTier?.id || 'free-tier';

            const onboardRequest = {
                tierId: tierId,
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            };

            let lroResponse = await this.callApi('onboardUser', onboardRequest);

            // Poll until operation is complete with timeout protection
            const MAX_RETRIES = 30; // Maximum number of retries (60 seconds total)
            let retryCount = 0;

            while (!lroResponse.done && retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                lroResponse = await this.callApi('onboardUser', onboardRequest);
                retryCount++;
            }

            if (!lroResponse.done) {
                throw new Error('Onboarding timeout: Operation did not complete within expected time.');
            }

            const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id || initialProjectId;
            return discoveredProjectId;
        } catch (error) {
            logger.error('[Gemini] Failed to discover Project ID:', error.response?.data || error.message);
            throw new Error('Could not discover a valid Google Cloud Project ID.');
        }
    }

    async listModels() {
        if (!this.isInitialized) await this.initialize();
        const formattedModels = this.availableModels.map(modelId => {
            const displayName = modelId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            return {
                name: `models/${modelId}`, version: "1.0.0", displayName: displayName,
                description: `A generative model for text and chat generation. ID: ${modelId}`,
                inputTokenLimit: 1024000, outputTokenLimit: 65535,
                supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
            };
        });
        return { models: formattedModels };
    }

    async callApi(method, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        try {
            const requestOptions = {
                url: `${this.codeAssistEndpoint}/${this.apiVersion}:${method}`,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                responseType: "json",
                body: JSON.stringify(body),
            };
            const res = await this.authClient.request(requestOptions);
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            logger.error(`[Gemini API] Error calling (Status: ${status}, Code: ${errorCode}):`, errorMessage);

            // Handle 401 (Unauthorized) - refresh auth and retry once
            if ((status === 400 || status === 401) && !isRetry) {
                logger.info('[Gemini API] Received 401/400. Triggering background refresh via PoolManager...');
                
                // 标记当前凭证为不健康（会自动进入刷新队列）
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    logger.info(`[Gemini] Marking credential ${this.uuid} as needs refresh. Reason: 401/400 Unauthorized`);
                    poolManager.markProviderNeedRefresh(MODEL_PROVIDER.GEMINI_CLI, {
                        uuid: this.uuid
                    });
                    error.credentialMarkedUnhealthy = true;
                }

                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Gemini API] Received 429 (Too Many Requests). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1);
            }

            // Handle other retryable errors (5xx server errors)
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Gemini API] Received ${status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1);
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                logger.info(`[Gemini API] Network error (${errorIdentifier}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1);
            }

            throw error;
        }
    }

    async * streamApi(method, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        try {
            const requestOptions = {
                url: `${this.codeAssistEndpoint}/${this.apiVersion}:${method}`,
                method: "POST",
                params: { alt: "sse" },
                headers: { "Content-Type": "application/json" },
                responseType: "stream",
                body: JSON.stringify(body),
            };
            const res = await this.authClient.request(requestOptions);
            if (res.status !== 200) {
                let errorBody = '';
                for await (const chunk of res.data) errorBody += chunk.toString();
                throw new Error(`Upstream API Error (Status ${res.status}): ${errorBody}`);
            }
            yield* this.parseSSEStream(res.data);
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            logger.error(`[Gemini API] Error during stream (Status: ${status}, Code: ${errorCode}):`, errorMessage);

            // Handle 401 (Unauthorized) - refresh auth and retry once
            if ((status === 400 || status === 401) && !isRetry) {
                logger.info('[Gemini API] Received 401/400 during stream. Triggering background refresh via PoolManager...');
                
                // 标记当前凭证为不健康（会自动进入刷新队列）
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    logger.info(`[Gemini] Marking credential ${this.uuid} as needs refresh. Reason: 401/400 Unauthorized in stream`);
                    poolManager.markProviderNeedRefresh(MODEL_PROVIDER.GEMINI_CLI, {
                        uuid: this.uuid
                    });
                    error.credentialMarkedUnhealthy = true;
                }

                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Gemini API] Received 429 (Too Many Requests) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1);
                return;
            }

            // Handle other retryable errors (5xx server errors)
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Gemini API] Received ${status} server error during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1);
                return;
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                logger.info(`[Gemini API] Network error (${errorIdentifier}) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1);
                return;
            }

            throw error;
        }
    }

    async * parseSSEStream(stream) {
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let buffer = [];
        for await (const line of rl) {
            if (line.startsWith("data: ")) buffer.push(line.slice(6));
            else if (line === "" && buffer.length > 0) {
                try { yield JSON.parse(buffer.join('\n')); } catch (e) { logger.error("[Stream] Failed to parse JSON chunk:", buffer.join('\n')); }
                buffer = [];
            }
        }
        if (buffer.length > 0) {
            try { yield JSON.parse(buffer.join('\n')); } catch (e) { logger.error("[Stream] Failed to parse final JSON chunk:", buffer.join('\n')); }
        }
    }

    async generateContent(model, requestBody) {
        logger.info(`[Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);
        
        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        
        // 检查 token 是否即将过期，如果是则推送到刷新队列
        if (this.isExpiryDateNear()) {
            const poolManager = getProviderPoolManager();
            if (poolManager && this.uuid) {
                logger.info(`[Gemini] Token is near expiry, marking credential ${this.uuid} for refresh`);
                poolManager.markProviderNeedRefresh(MODEL_PROVIDER.GEMINI_CLI, {
                    uuid: this.uuid
                });
            }
        }
        
        let selectedModel = model;
        if (!GEMINI_MODELS.includes(model)) {
            logger.warn(`[Gemini] Model '${model}' not found. Using default model: '${GEMINI_MODELS[0]}'`);
            selectedModel = GEMINI_MODELS[0];
        }
        const processedRequestBody = ensureRolesInContents(requestBody);
        const apiRequest = { model: selectedModel, project: this.projectId, request: processedRequestBody };
        const response = await this.callApi(API_ACTIONS.GENERATE_CONTENT, apiRequest);
        return toGeminiApiResponse(response.response);
    }

    async * generateContentStream(model, requestBody) {
        logger.info(`[Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);

        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }

        // 检查 token 是否即将过期，如果是则推送到刷新队列
        if (this.isExpiryDateNear()) {
            const poolManager = getProviderPoolManager();
            if (poolManager && this.uuid) {
                logger.info(`[Gemini] Token is near expiry, marking credential ${this.uuid} for refresh`);
                poolManager.markProviderNeedRefresh(MODEL_PROVIDER.GEMINI_CLI, {
                    uuid: this.uuid
                });
            }
        }

        // 检查是否为防截断模型
        if (is_anti_truncation_model(model)) {
            // 从防截断模型名中提取实际模型名
            const actualModel = extract_model_from_anti_model(model);
            // 使用防截断流处理
            const processedRequestBody = ensureRolesInContents(requestBody);
            yield* apply_anti_truncation_to_stream(this, actualModel, processedRequestBody);
        } else {
            // 正常流处理
            let selectedModel = model;
            if (!GEMINI_MODELS.includes(model)) {
                logger.warn(`[Gemini] Model '${model}' not found. Using default model: '${GEMINI_MODELS[0]}'`);
                selectedModel = GEMINI_MODELS[0];
            }
            const processedRequestBody = ensureRolesInContents(requestBody);
            const apiRequest = { model: selectedModel, project: this.projectId, request: processedRequestBody };
            const stream = this.streamApi(API_ACTIONS.STREAM_GENERATE_CONTENT, apiRequest);
            for await (const chunk of stream) {
                yield toGeminiApiResponse(chunk.response);
            }
        }
    }

     /**
     * Checks if the given expiry date is within the next 10 minutes from now.
     * @returns {boolean} True if the expiry date is within the next 10 minutes, false otherwise.
     */
    isExpiryDateNear() {
        try {
            const nearMinutes = 20;
            const { message, isNearExpiry } = formatExpiryLog('Gemini', this.authClient.credentials.expiry_date, nearMinutes);
            logger.info(message);
            return isNearExpiry;
        } catch (error) {
            logger.error(`[Gemini] Error checking expiry date: ${error.message}`);
            return false;
        }
    }

    /**
     * 保存凭证到文件
     * @param {string} filePath - 凭证文件路径
     * @param {Object} credentials - 凭证数据
     */
    async _saveCredentialsToFile(filePath, credentials) {
        try {
            await fs.writeFile(filePath, JSON.stringify(credentials, null, 2));
            logger.info(`[Gemini Auth] Credentials saved to ${filePath}`);
        } catch (error) {
            logger.error(`[Gemini Auth] Failed to save credentials to ${filePath}: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取模型配额信息
     * @returns {Promise<Object>} 模型配额信息
     */
    async getUsageLimits() {
        if (!this.isInitialized) await this.initialize();
        
        // 注意：V2 架构下不再在 getUsageLimits 中同步刷新 token
        // 如果 token 过期，PoolManager 后台会自动处理
        // if (this.isExpiryDateNear()) {
        //     logger.info('[Gemini] Token is near expiry, refreshing before getUsageLimits request...');
        //     await this.initializeAuth(true);
        // }

        try {
            const modelsWithQuotas = await this.getModelsWithQuotas();
            return modelsWithQuotas;
        } catch (error) {
            logger.error('[Gemini] Failed to get usage limits:', error.message);
            throw error;
        }
    }

    /**
     * 获取带配额信息的模型列表
     * @returns {Promise<Object>} 模型配额信息
     */
    async getModelsWithQuotas() {
        try {
            // 解析模型配额信息
            const result = {
                lastUpdated: Date.now(),
                models: {}
            };

            // 调用 retrieveUserQuota 接口获取用户配额信息
            try {
                const quotaURL = `${this.codeAssistEndpoint}/${this.apiVersion}:retrieveUserQuota`;
                const requestBody = {
                    project: `${this.projectId}`
                };
                const requestOptions = {
                    url: quotaURL,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    responseType: 'json',
                    body: JSON.stringify(requestBody)
                };

                const res = await this.authClient.request(requestOptions);
                // logger.info(`[Gemini] retrieveUserQuota success`, JSON.stringify(res.data));
                if (res.data && res.data.buckets) {
                    const buckets = res.data.buckets;
                    
                    // 遍历 buckets 数组，提取配额信息
                    for (const bucket of buckets) {
                        const modelId = bucket.modelId;
                        
                        // 检查模型是否在支持的模型列表中
                        if (!GEMINI_MODELS.includes(modelId)) continue;
                        
                        const modelInfo = {
                            remaining: bucket.remainingFraction || 0,
                            resetTime: bucket.resetTime || null,
                            resetTimeRaw: bucket.resetTime
                        };
                        
                        result.models[modelId] = modelInfo;
                    }

                    // 对模型按名称排序
                    const sortedModels = {};
                    Object.keys(result.models).sort().forEach(key => {
                        sortedModels[key] = result.models[key];
                    });
                    result.models = sortedModels;
                    // logger.info(`[Gemini] Sorted Models:`, sortedModels);
                    logger.info(`[Gemini] Successfully fetched quotas for ${Object.keys(result.models).length} models`);
                }
            } catch (fetchError) {
                logger.error(`[Gemini] Failed to fetch user quota:`, fetchError.message);
                
                // 如果 retrieveUserQuota 失败，回退到使用固定模型列表
                for (const modelId of GEMINI_MODELS) {
                    result.models[modelId] = {
                        remaining: 0,
                        resetTime: null,
                        resetTimeRaw: null
                    };
                }
            }

            return result;
        } catch (error) {
            logger.error('[Gemini] Failed to get models with quotas:', error.message);
            throw error;
        }
    }
}

