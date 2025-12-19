import { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import * as https from 'https';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import open from 'open';
import { formatExpiryTime } from '../common.js';
import { getProviderModels } from '../provider-models.js';
import { handleGeminiAntigravityOAuth } from '../oauth-handlers.js';

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
const AUTH_REDIRECT_PORT = 8086;
const CREDENTIALS_DIR = '.antigravity';
const CREDENTIALS_FILE = 'oauth_creds.json';
const DEFAULT_ANTIGRAVITY_BASE_URL_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const DEFAULT_ANTIGRAVITY_BASE_URL_AUTOPUSH = 'https://autopush-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_API_VERSION = 'v1internal';
const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const DEFAULT_USER_AGENT = 'antigravity/1.11.5 windows/amd64';
const REFRESH_SKEW = 3000; // 3000秒（50分钟）提前刷新Token

// 获取 Antigravity 模型列表
const ANTIGRAVITY_MODELS = getProviderModels('gemini-antigravity');

// 模型别名映射
const MODEL_ALIAS_MAP = {
    'gemini-2.5-computer-use-preview-10-2025': 'rev19-uic3-1p',
    'gemini-3-pro-image-preview': 'gemini-3-pro-image',
    'gemini-3-pro-preview': 'gemini-3-pro-high',
    'gemini-3-flash-preview': 'gemini-3-flash',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-claude-sonnet-4-5': 'claude-sonnet-4-5',
    'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
    'gemini-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking'
};

const MODEL_NAME_MAP = {
    'rev19-uic3-1p': 'gemini-2.5-computer-use-preview-10-2025',
    'gemini-3-pro-image': 'gemini-3-pro-image-preview',
    'gemini-3-pro-high': 'gemini-3-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'claude-sonnet-4-5': 'gemini-claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking': 'gemini-claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking': 'gemini-claude-opus-4-5-thinking'
};

/**
 * 将别名转换为真实模型名
 */
function alias2ModelName(modelName) {
    return MODEL_ALIAS_MAP[modelName];
}

/**
 * 将真实模型名转换为别名
 */
function modelName2Alias(modelName) {
    return MODEL_NAME_MAP[modelName];
}

/**
 * 生成随机请求ID
 */
function generateRequestID() {
    return 'agent-' + uuidv4();
}

/**
 * 生成随机会话ID
 */
function generateSessionID() {
    const n = Math.floor(Math.random() * 9000000000000000000);
    return '-' + n.toString();
}

/**
 * 生成随机项目ID
 */
function generateProjectID() {
    const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
    const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomPart = uuidv4().toLowerCase().substring(0, 5);
    return `${adj}-${noun}-${randomPart}`;
}

/**
 * 将 Gemini 格式请求转换为 Antigravity 格式
 */
function geminiToAntigravity(modelName, payload, projectId) {
    // 深拷贝请求体,避免修改原始对象
    let template = JSON.parse(JSON.stringify(payload));

    // 设置基本字段
    template.model = modelName;
    template.userAgent = 'antigravity';
    template.project = projectId || generateProjectID();
    template.requestId = generateRequestID();

    // 确保 request 对象存在
    if (!template.request) {
        template.request = {};
    }

    // 设置会话ID
    template.request.sessionId = generateSessionID();

    // 删除安全设置
    if (template.request.safetySettings) {
        delete template.request.safetySettings;
    }

    // 设置工具配置
    if (template.request.toolConfig) {
        if (!template.request.toolConfig.functionCallingConfig) {
            template.request.toolConfig.functionCallingConfig = {};
        }
        template.request.toolConfig.functionCallingConfig.mode = 'VALIDATED';
    }

    // 删除 maxOutputTokens
    if (template.request.generationConfig && template.request.generationConfig.maxOutputTokens) {
        delete template.request.generationConfig.maxOutputTokens;
    }

    // 处理 Thinking 配置
    if (!modelName.startsWith('gemini-3-')) {
        if (template.request.generationConfig &&
            template.request.generationConfig.thinkingConfig &&
            template.request.generationConfig.thinkingConfig.thinkingLevel) {
            delete template.request.generationConfig.thinkingConfig.thinkingLevel;
            template.request.generationConfig.thinkingConfig.thinkingBudget = -1;
        }
    }

    // 处理 Claude 模型的工具声明 (包括 sonnet 和 opus)
    if (modelName.startsWith('claude-sonnet-') || modelName.startsWith('claude-opus-')) {
        if (template.request.tools && Array.isArray(template.request.tools)) {
            template.request.tools.forEach(tool => {
                if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
                    tool.functionDeclarations.forEach(funcDecl => {
                        if (funcDecl.parametersJsonSchema) {
                            funcDecl.parameters = funcDecl.parametersJsonSchema;
                            delete funcDecl.parameters.$schema;
                            delete funcDecl.parametersJsonSchema;
                        }
                    });
                }
            });
        }
    }

    return template;
}

/**
 * 将 Antigravity 响应转换为 Gemini 格式
 */
function toGeminiApiResponse(antigravityResponse) {
    if (!antigravityResponse) return null;

    const compliantResponse = {
        candidates: antigravityResponse.candidates
    };

    if (antigravityResponse.usageMetadata) {
        compliantResponse.usageMetadata = antigravityResponse.usageMetadata;
    }

    if (antigravityResponse.promptFeedback) {
        compliantResponse.promptFeedback = antigravityResponse.promptFeedback;
    }

    if (antigravityResponse.automaticFunctionCallingHistory) {
        compliantResponse.automaticFunctionCallingHistory = antigravityResponse.automaticFunctionCallingHistory;
    }

    return compliantResponse;
}

/**
 * 确保请求体中的内容部分都有角色属性
 */
function ensureRolesInContents(requestBody) {
    delete requestBody.model;

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
    }

    return requestBody;
}

export class AntigravityApiService {
    constructor(config) {
        // 配置 OAuth2Client 使用自定义的 HTTP agent
        this.authClient = new OAuth2Client({
            clientId: OAUTH_CLIENT_ID,
            clientSecret: OAUTH_CLIENT_SECRET,
            transporterOptions: {
                agent: httpsAgent,
            },
        });
        this.availableModels = [];
        this.isInitialized = false;

        this.config = config;
        this.host = config.HOST;
        this.oauthCredsFilePath = config.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH;
        this.baseURL = DEFAULT_ANTIGRAVITY_BASE_URL_DAILY; // 使用通用 GEMINI_BASE_URL 配置
        this.userAgent = DEFAULT_USER_AGENT; // 支持通用 USER_AGENT 配置
        this.projectId = config.PROJECT_ID;

        // Initialize instance-specific endpoints
        this.baseUrlDaily = config.ANTIGRAVITY_BASE_URL_DAILY || DEFAULT_ANTIGRAVITY_BASE_URL_DAILY;
        this.baseUrlAutopush = config.ANTIGRAVITY_BASE_URL_AUTOPUSH || DEFAULT_ANTIGRAVITY_BASE_URL_AUTOPUSH;

        // 多环境降级顺序
        this.baseURLs = this.baseURL ? [this.baseURL] : [
            this.baseUrlDaily,
            this.baseUrlAutopush
            // ANTIGRAVITY_BASE_URL_PROD // 生产环境已注释
        ];
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[Antigravity] Initializing Antigravity API Service...');
        await this.initializeAuth();

        if (!this.projectId) {
            this.projectId = await this.discoverProjectAndModels();
        } else {
            console.log(`[Antigravity] Using provided Project ID: ${this.projectId}`);
            // 获取可用模型
            await this.fetchAvailableModels();
        }

        this.isInitialized = true;
        console.log(`[Antigravity] Initialization complete. Project ID: ${this.projectId}`);
    }

    async initializeAuth(forceRefresh = false) {
        // 检查是否需要刷新 Token
        const needsRefresh = forceRefresh || this.isTokenExpiringSoon();

        if (this.authClient.credentials.access_token && !needsRefresh) {
            // Token 有效且不需要刷新
            return;
        }

        // Antigravity 不支持 base64 配置，直接使用文件路径

        const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);
        try {
            const data = await fs.readFile(credPath, "utf8");
            const credentials = JSON.parse(data);
            this.authClient.setCredentials(credentials);
            console.log('[Antigravity Auth] Authentication configured successfully from file.');

            if (needsRefresh) {
                console.log('[Antigravity Auth] Token expiring soon or force refresh requested. Refreshing token...');
                const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
                this.authClient.setCredentials(newCredentials);
                // 保存刷新后的凭证到文件
                await fs.writeFile(credPath, JSON.stringify(newCredentials, null, 2));
                console.log(`[Antigravity Auth] Token refreshed and saved to ${credPath} successfully.`);
            }
        } catch (error) {
            console.error('[Antigravity Auth] Error initializing authentication:', error.code);
            if (error.code === 'ENOENT' || error.code === 400) {
                console.log(`[Antigravity Auth] Credentials file '${credPath}' not found. Starting new authentication flow...`);
                const newTokens = await this.getNewToken(credPath);
                this.authClient.setCredentials(newTokens);
                console.log('[Antigravity Auth] New token obtained and loaded into memory.');
            } else {
                console.error('[Antigravity Auth] Failed to initialize authentication from file:', error);
                throw new Error(`Failed to load OAuth credentials.`);
            }
        }
    }

    async getNewToken(credPath) {
        // 使用统一的 OAuth 处理方法
        const { authUrl, authInfo } = await handleGeminiAntigravityOAuth(this.config);
        
        console.log('\n[Antigravity Auth] 正在自动打开浏览器进行授权...');
        console.log('[Antigravity Auth] 授权链接:', authUrl, '\n');

        // 自动打开浏览器
        const showFallbackMessage = () => {
            console.log('[Antigravity Auth] 无法自动打开浏览器，请手动复制上面的链接到浏览器中打开');
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
                        console.log('[Antigravity Auth] New token obtained successfully.');
                        resolve(credentials);
                    }
                } catch (error) {
                    // 文件尚未创建或无效，继续等待
                }
            }, 1000);

            // 设置超时（5分钟）
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('[Antigravity Auth] OAuth 授权超时'));
            }, 5 * 60 * 1000);
        });
    }

    isTokenExpiringSoon() {
        if (!this.authClient.credentials.expiry_date) {
            return false;
        }
        const currentTime = Date.now();
        const expiryTime = this.authClient.credentials.expiry_date;
        const refreshSkewMs = REFRESH_SKEW * 1000;
        return expiryTime <= (currentTime + refreshSkewMs);
    }

    async discoverProjectAndModels() {
        if (this.projectId) {
            console.log(`[Antigravity] Using pre-configured Project ID: ${this.projectId}`);
            return this.projectId;
        }

        console.log('[Antigravity] Discovering Project ID...');
        try {
            const initialProjectId = "";
            // Prepare client metadata
            const clientMetadata = {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: initialProjectId,
            };

            // Call loadCodeAssist to discover the actual project ID
            const loadRequest = {
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            };

            const loadResponse = await this.callApi('loadCodeAssist', loadRequest);

            // Check if we already have a project ID from the response
            if (loadResponse.cloudaicompanionProject) {
                console.log(`[Antigravity] Discovered existing Project ID: ${loadResponse.cloudaicompanionProject}`);
                // 获取可用模型
                await this.fetchAvailableModels();
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
            console.log(`[Antigravity] Onboarded and discovered Project ID: ${discoveredProjectId}`);
            // 获取可用模型
            await this.fetchAvailableModels();
            return discoveredProjectId;
        } catch (error) {
            console.error('[Antigravity] Failed to discover Project ID:', error.response?.data || error.message);
            console.log('[Antigravity] Falling back to generated Project ID as last resort...');
            const fallbackProjectId = generateProjectID();
            console.log(`[Antigravity] Generated fallback Project ID: ${fallbackProjectId}`);
            // 获取可用模型
            await this.fetchAvailableModels();
            return fallbackProjectId;
        }
    }

    async fetchAvailableModels() {
        console.log('[Antigravity] Fetching available models...');

        for (const baseURL of this.baseURLs) {
            try {
                const modelsURL = `${baseURL}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;
                const requestOptions = {
                    url: modelsURL,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': this.userAgent
                    },
                    responseType: 'json',
                    body: JSON.stringify({})
                };

                const res = await this.authClient.request(requestOptions);
                console.log(`[Antigravity] Raw response from ${baseURL}:`, Object.keys(res.data.models));
                if (res.data && res.data.models) {
                    const models = Object.keys(res.data.models);
                    this.availableModels = models
                        .map(modelName2Alias)
                        .filter(alias => alias !== undefined && alias !== '' && alias !== null);

                    console.log(`[Antigravity] Available models: [${this.availableModels.join(', ')}]`);
                    return;
                }
            } catch (error) {
                console.error(`[Antigravity] Failed to fetch models from ${baseURL}:`, error.message);
            }
        }

        console.warn('[Antigravity] Failed to fetch models from all endpoints. Using default models.');
        this.availableModels = ANTIGRAVITY_MODELS;
    }

    async listModels() {
        if (!this.isInitialized) await this.initialize();

        const now = Math.floor(Date.now() / 1000);
        const formattedModels = this.availableModels.map(modelId => {
            const displayName = modelId.split('-').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');

            const modelInfo = {
                name: `models/${modelId}`,
                version: '1.0.0',
                displayName: displayName,
                description: `Antigravity model: ${modelId}`,
                inputTokenLimit: 1024000,
                outputTokenLimit: 65535,
                supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
                object: 'model',
                created: now,
                ownedBy: 'antigravity',
                type: 'antigravity'
            };

            if (modelId.endsWith('-thinking') || modelId.includes('-thinking-')) {
                modelInfo.thinking = {
                    min: 1024,
                    max: 100000,
                    zeroAllowed: false,
                    dynamicAllowed: true
                };
            }

            return modelInfo;
        });

        return { models: formattedModels };
    }

    async callApi(method, body, isRetry = false, retryCount = 0, baseURLIndex = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        if (baseURLIndex >= this.baseURLs.length) {
            throw new Error('All Antigravity base URLs failed');
        }

        const baseURL = this.baseURLs[baseURLIndex];

        try {
            const requestOptions = {
                url: `${baseURL}/${ANTIGRAVITY_API_VERSION}:${method}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': this.userAgent
                },
                responseType: 'json',
                body: JSON.stringify(body)
            };

            const res = await this.authClient.request(requestOptions);
            return res.data;
        } catch (error) {
            console.error(`[Antigravity API] Error calling ${method} on ${baseURL}:`, error.response?.status, error.message);

            if ((error.response?.status === 400 || error.response?.status === 401) && !isRetry) {
                console.log('[Antigravity API] Received 401/400. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                return this.callApi(method, body, true, retryCount, baseURLIndex);
            }

            if (error.response?.status === 429) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    console.log(`[Antigravity API] Rate limited on ${baseURL}. Trying next base URL...`);
                    return this.callApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[Antigravity API] Rate limited. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.callApi(method, body, isRetry, retryCount + 1, 0);
                }
            }

            if (!error.response && baseURLIndex + 1 < this.baseURLs.length) {
                console.log(`[Antigravity API] Network error on ${baseURL}. Trying next base URL...`);
                return this.callApi(method, body, isRetry, retryCount, baseURLIndex + 1);
            }

            if (error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Antigravity API] Server error ${error.response.status}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1, baseURLIndex);
            }

            throw error;
        }
    }

    async * streamApi(method, body, isRetry = false, retryCount = 0, baseURLIndex = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        if (baseURLIndex >= this.baseURLs.length) {
            throw new Error('All Antigravity base URLs failed');
        }

        const baseURL = this.baseURLs[baseURLIndex];

        try {
            const requestOptions = {
                url: `${baseURL}/${ANTIGRAVITY_API_VERSION}:${method}`,
                method: 'POST',
                params: { alt: 'sse' },
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'User-Agent': this.userAgent
                },
                responseType: 'stream',
                body: JSON.stringify(body)
            };

            const res = await this.authClient.request(requestOptions);

            if (res.status !== 200) {
                let errorBody = '';
                for await (const chunk of res.data) {
                    errorBody += chunk.toString();
                }
                throw new Error(`Upstream API Error (Status ${res.status}): ${errorBody}`);
            }

            yield* this.parseSSEStream(res.data);
        } catch (error) {
            console.error(`[Antigravity API] Error during stream ${method} on ${baseURL}:`, error.response?.status, error.message);

            if ((error.response?.status === 400 || error.response?.status === 401) && !isRetry) {
                console.log('[Antigravity API] Received 401/400 during stream. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                yield* this.streamApi(method, body, true, retryCount, baseURLIndex);
                return;
            }

            if (error.response?.status === 429) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    console.log(`[Antigravity API] Rate limited on ${baseURL}. Trying next base URL...`);
                    yield* this.streamApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                    return;
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[Antigravity API] Rate limited during stream. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    yield* this.streamApi(method, body, isRetry, retryCount + 1, 0);
                    return;
                }
            }

            if (!error.response && baseURLIndex + 1 < this.baseURLs.length) {
                console.log(`[Antigravity API] Network error on ${baseURL}. Trying next base URL...`);
                yield* this.streamApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                return;
            }

            if (error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Antigravity API] Server error ${error.response.status} during stream. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1, baseURLIndex);
                return;
            }

            throw error;
        }
    }

    async * parseSSEStream(stream) {
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        });

        let buffer = [];
        for await (const line of rl) {
            if (line.startsWith('data: ')) {
                buffer.push(line.slice(6));
            } else if (line === '' && buffer.length > 0) {
                try {
                    yield JSON.parse(buffer.join('\n'));
                } catch (e) {
                    console.error('[Antigravity Stream] Failed to parse JSON chunk:', buffer.join('\n'));
                }
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            try {
                yield JSON.parse(buffer.join('\n'));
            } catch (e) {
                console.error('[Antigravity Stream] Failed to parse final JSON chunk:', buffer.join('\n'));
            }
        }
    }

    async generateContent(model, requestBody) {
        console.log(`[Antigravity Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);

        let selectedModel = model;
        if (!this.availableModels.includes(model)) {
            console.warn(`[Antigravity] Model '${model}' not found. Using default model: '${this.availableModels[0]}'`);
            selectedModel = this.availableModels[0];
        }

        // 深拷贝请求体
        const processedRequestBody = ensureRolesInContents(JSON.parse(JSON.stringify(requestBody)));
        const actualModelName = alias2ModelName(selectedModel);

        // 将处理后的请求体转换为 Antigravity 格式
        const payload = geminiToAntigravity(actualModelName, { request: processedRequestBody }, this.projectId);

        // 设置模型名称为实际模型名
        payload.model = actualModelName;

        const response = await this.callApi('generateContent', payload);
        return toGeminiApiResponse(response.response);
    }

    async * generateContentStream(model, requestBody) {
        console.log(`[Antigravity Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);

        let selectedModel = model;
        if (!this.availableModels.includes(model)) {
            console.warn(`[Antigravity] Model '${model}' not found. Using default model: '${this.availableModels[0]}'`);
            selectedModel = this.availableModels[0];
        }

        // 深拷贝请求体
        const processedRequestBody = ensureRolesInContents(JSON.parse(JSON.stringify(requestBody)));
        const actualModelName = alias2ModelName(selectedModel);

        // 将处理后的请求体转换为 Antigravity 格式
        const payload = geminiToAntigravity(actualModelName, { request: processedRequestBody }, this.projectId);

        // 设置模型名称为实际模型名
        payload.model = actualModelName;

        const stream = this.streamApi('streamGenerateContent', payload);
        for await (const chunk of stream) {
            yield toGeminiApiResponse(chunk.response);
        }
    }

    isExpiryDateNear() {
        try {
            const currentTime = Date.now();
            const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
            console.log(`[Antigravity] Expiry date: ${this.authClient.credentials.expiry_date}, Current time: ${currentTime}, ${this.config.CRON_NEAR_MINUTES || 10} minutes from now: ${currentTime + cronNearMinutesInMillis}`);
            return this.authClient.credentials.expiry_date <= (currentTime + cronNearMinutesInMillis);
        } catch (error) {
            console.error(`[Antigravity] Error checking expiry date: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取模型配额信息
     * @returns {Promise<Object>} 模型配额信息
     */
    async getUsageLimits() {
        if (!this.isInitialized) await this.initialize();
        
        // 检查 token 是否即将过期，如果是则先刷新
        if (this.isExpiryDateNear()) {
            console.log('[Antigravity] Token is near expiry, refreshing before getUsageLimits request...');
            await this.initializeAuth(true);
        }

        try {
            const modelsWithQuotas = await this.getModelsWithQuotas();
            return modelsWithQuotas;
        } catch (error) {
            console.error('[Antigravity] Failed to get usage limits:', error.message);
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

            // 调用 fetchAvailableModels 接口获取模型和配额信息
            for (const baseURL of this.baseURLs) {
                try {
                    const modelsURL = `${baseURL}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;
                    const requestOptions = {
                        url: modelsURL,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': this.userAgent
                        },
                        responseType: 'json',
                        body: JSON.stringify({})
                    };

                    const res = await this.authClient.request(requestOptions);
                    console.log(`[Antigravity] fetchAvailableModels success`);
                    if (res.data && res.data.models) {
                        const modelsData = res.data.models;
                        
                        // 遍历模型数据，提取配额信息
                        for (const [modelId, modelData] of Object.entries(modelsData)) {
                            const aliasName = modelName2Alias(modelId);
                            if (aliasName == null ||aliasName === '') continue; // 跳过不支持的模型
                            
                            const modelInfo = {
                                remaining: 0,
                                resetTime: null,
                                resetTimeRaw: null
                            };
                            
                            // 从 quotaInfo 中提取配额信息
                            if (modelData.quotaInfo) {
                                modelInfo.remaining = modelData.quotaInfo.remainingFraction || modelData.quotaInfo.remaining || 0;
                                modelInfo.resetTime = modelData.quotaInfo.resetTime || null;
                                modelInfo.resetTimeRaw = modelData.quotaInfo.resetTime;
                            }
                            
                            result.models[aliasName] = modelInfo;
                        }

                        // 对模型按名称排序
                        const sortedModels = {};
                        Object.keys(result.models).sort().forEach(key => {
                            sortedModels[key] = result.models[key];
                        });
                        result.models = sortedModels;
                        // console.log(`[Antigravity] Sorted Models:`, sortedModels);
                        console.log(`[Antigravity] Successfully fetched quotas for ${Object.keys(result.models).length} models`);
                        break; // 成功获取后退出循环
                    }
                } catch (error) {
                    console.error(`[Antigravity] Failed to fetch models with quotas from ${baseURL}:`, error.message);
                }
            }

            return result;
        } catch (error) {
            console.error('[Antigravity] Failed to get models with quotas:', error.message);
            throw error;
        }
    }

}