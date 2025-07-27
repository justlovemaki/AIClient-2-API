import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    BASE_URL: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
    AMAZON_Q_URL: 'https://codewhisperer.{{region}}.amazonaws.com/SendMessageStreaming',
    DEFAULT_MODEL_NAME: 'kiro-claude-sonnet-4-20250514',
    AXIOS_TIMEOUT: 120000, // 2 minutes timeout
    USER_AGENT: 'KiroIDE',
    CONTENT_TYPE_JSON: 'application/json',
    ACCEPT_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    CHAT_TRIGGER_TYPE_MANUAL: 'MANUAL',
    ORIGIN_AI_EDITOR: 'AI_EDITOR',
    OPENAI_OBJECT_CHAT_COMPLETION_CHUNK: 'chat.completion.chunk',
    OPENAI_OBJECT_CHAT_COMPLETION: 'chat.completion',
    OPENAI_OWNED_BY_KIRO_API: 'kiro-api',
};

const MODEL_MAPPING = {
    "kiro-claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
    "kiro-claude-3-7-sonnet-20250219": "CLAUDE_3_7_SONNET_20250219_V1_0",
    "kiro-amazonq-claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
    "kiro-amazonq-claude-3-7-sonnet-20250219": "CLAUDE_3_7_SONNET_20250219_V1_0"
};

const KIRO_AUTH_TOKEN_FILE = "kiro-auth-token.json";

/**
 * Kiro API Service - Node.js implementation based on the Python ki2api
 * Provides OpenAI-compatible API for Claude Sonnet 4 via Kiro/CodeWhisperer
 */

async function getMacAddressSha256() {
    const networkInterfaces = os.networkInterfaces();
    let macAddress = '';

    for (const interfaceName in networkInterfaces) {
        const networkInterface = networkInterfaces[interfaceName];
        for (const iface of networkInterface) {
            if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                macAddress = iface.mac;
                break;
            }
        }
        if (macAddress) break;
    }

    if (!macAddress) {
        console.warn("无法获取MAC地址，将使用默认值。");
        macAddress = '00:00:00:00:00:00'; // Fallback if no MAC address is found
    }

    const sha256Hash = crypto.createHash('sha256').update(macAddress).digest('hex');
    return sha256Hash;
}

export class KiroApiService {
    constructor(config = {}) {
        this.isInitialized = false;
        this.config = config;
        this.credPath = config.KIRO_OAUTH_CREDS_DIR_PATH || path.join(os.homedir(), ".aws", "sso", "cache");
        this.credsBase64 = config.KIRO_OAUTH_CREDS_BASE64;
        this.accessToken = config.KIRO_ACCESS_TOKEN;
        this.refreshToken = config.KIRO_REFRESH_TOKEN;
        this.clientId = config.KIRO_CLIENT_ID;
        this.clientSecret = config.KIRO_CLIENT_SECRET;
        this.authMethod = KIRO_CONSTANTS.AUTH_METHOD_SOCIAL;
        this.refreshUrl = KIRO_CONSTANTS.REFRESH_URL;
        this.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL;
        this.baseUrl = KIRO_CONSTANTS.BASE_URL;
        this.amazonQUrl = KIRO_CONSTANTS.AMAZON_Q_URL;

        // Add kiro-oauth-creds-base64 and kiro-oauth-creds-file to config
        if (config.KIRO_OAUTH_CREDS_BASE64) {
            try {
                const decodedCreds = Buffer.from(config.KIRO_OAUTH_CREDS_BASE64, 'base64').toString('utf8');
                const parsedCreds = JSON.parse(decodedCreds);
                // Store parsedCreds to be merged in initializeAuth
                this.base64Creds = parsedCreds;
                console.info('[Kiro] Successfully decoded Base64 credentials in constructor.');
            } catch (error) {
                console.error(`[Kiro] Failed to parse Base64 credentials in constructor: ${error.message}`);
            }
        } else if (config.KIRO_OAUTH_CREDS_FILE_PATH) {
            this.credsFilePath = config.KIRO_OAUTH_CREDS_FILE_PATH;
        }

        this.modelName = KIRO_CONSTANTS.DEFAULT_MODEL_NAME;
        this.axiosInstance = null; // Initialize later in async method
    }
 
    async initialize() {
        if (this.isInitialized) return;
        console.log('[Kiro] Initializing Gemini API Service...');
        await this.initializeAuth();
        const macSha256 = await getMacAddressSha256();
        this.axiosInstance = axios.create({
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
             headers: {
                'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
                'x-amz-user-agent': `aws-sdk-js/1.0.7 KiroIDE-0.1.25-${macSha256}`,
                'user-agent': `aws-sdk-js/1.0.7 ua/2.1 os/win32#10.0.26100 lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.7 m/E KiroIDE-0.1.25-${macSha256}`,
                'amz-sdk-request': 'attempt=1; max=1',
                'x-amzn-kiro-agent-mode': 'vibe',
                'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
                'Accept': KIRO_CONSTANTS.ACCEPT_JSON,
            }
        });
        this.isInitialized = true;
    }

async initializeAuth(forceRefresh = false) {
    if (this.accessToken && !forceRefresh) {
        console.debug('[Kiro Auth] Access token already available and not forced refresh.');
        return;
    }

    // Helper to load credentials from a file
    const loadCredentialsFromFile = async (filePath) => {
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            return JSON.parse(fileContent);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.debug(`[Kiro Auth] Credential file not found: ${filePath}`);
            } else if (error instanceof SyntaxError) {
                console.warn(`[Kiro Auth] Failed to parse JSON from ${filePath}: ${error.message}`);
            } else {
                console.warn(`[Kiro Auth] Failed to read credential file ${filePath}: ${error.message}`);
            }
            return null;
        }
    };

    // Helper to save credentials to a file
    const saveCredentialsToFile = async (filePath, newData) => {
        try {
            let existingData = {};
            try {
                const fileContent = await fs.readFile(filePath, 'utf8');
                existingData = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    console.debug(`[Kiro Auth] Token file not found, creating new one: ${filePath}`);
                } else {
                    console.warn(`[Kiro Auth] Could not read existing token file ${filePath}: ${readError.message}`);
                }
            }
            const mergedData = { ...existingData, ...newData };
            await fs.writeFile(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
            console.info(`[Kiro Auth] Updated token file: ${filePath}`);
        } catch (error) {
            console.error(`[Kiro Auth] Failed to write token to file ${filePath}: ${error.message}`);
        }
    };

    try {
        let mergedCredentials = {};

        // Priority 1: Load from Base64 credentials if available
        if (this.base64Creds) {
            Object.assign(mergedCredentials, this.base64Creds);
            console.info('[Kiro Auth] Successfully loaded credentials from Base64 (constructor).');
            // Clear base64Creds after use to prevent re-processing
            this.base64Creds = null;
        }

        // Priority 2: Load from a specific file path if provided and not already loaded from token file
        const credPath = this.credsFilePath || path.join(this.credPath, KIRO_AUTH_TOKEN_FILE);
        if (credPath) {
            console.debug(`[Kiro Auth] Attempting to load credentials from specified file: ${credPath}`);
            const credentialsFromFile = await loadCredentialsFromFile(credPath);
            if (credentialsFromFile) {
                Object.assign(mergedCredentials, credentialsFromFile);
                console.info(`[Kiro Auth] Successfully loaded credentials from ${credPath}.`);
            } else {
                console.warn(`[Kiro Auth] Could not load credentials from specified file path: ${credPath}`);
            }
        }

        // Priority 3: Load from default directory if no specific file path and no token file credentials
        if (Object.keys(mergedCredentials).length === 0) {
            const dirPath = this.credPath;
            console.debug(`[Kiro Auth] Attempting to load credentials from directory: ${dirPath}`);
            const files = await fs.readdir(dirPath);

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(dirPath, file);
                    const credentials = await loadCredentialsFromFile(filePath);
                    if (credentials) {
                        Object.assign(mergedCredentials, credentials);
                        console.debug(`[Kiro Auth] Loaded credentials from ${file}`);
                    }
                }
            }
        }

        // Apply loaded credentials, prioritizing existing values if they are not null/undefined
        this.accessToken = this.accessToken || mergedCredentials.accessToken;
        this.refreshToken = this.refreshToken || mergedCredentials.refreshToken;
        this.clientId = this.clientId || mergedCredentials.clientId;
        this.clientSecret = this.clientSecret || mergedCredentials.clientSecret;
        this.authMethod = this.authMethod || mergedCredentials.authMethod;
        this.expiresAt = this.expiresAt || mergedCredentials.expiresAt;
        this.profileArn = this.profileArn || mergedCredentials.profileArn;
        this.region = this.region || mergedCredentials.region;

        // Ensure region is set before using it in URLs
        if (!this.region) {
            console.warn('[Kiro Auth] Region not found in credentials. Using default region for URLs.');
            // You might want to set a default region here if it's critical
            // For example: this.region = 'us-east-1';
        }

        this.refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace("{{region}}", this.region || 'us-east-1'); // Fallback to a default region
        this.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL.replace("{{region}}", this.region || 'us-east-1');
        this.baseUrl = KIRO_CONSTANTS.BASE_URL.replace("{{region}}", this.region || 'us-east-1');
        this.amazonQUrl = KIRO_CONSTANTS.AMAZON_Q_URL.replace("{{region}}", this.region || 'us-east-1');
    } catch (error) {
        console.warn(`[Kiro Auth] Could not read credential directory ${this.credPath}: ${error.message}`);
    }

    // Refresh token if forced or if access token is missing but refresh token is available
    if (forceRefresh || (!this.accessToken && this.refreshToken)) {
        if (!this.refreshToken) {
            throw new Error('No refresh token available to refresh access token.');
        }
        try {
            const requestBody = {
                refreshToken: this.refreshToken,
            };

            let refreshUrl = this.refreshUrl;
            if (this.authMethod !== KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
                refreshUrl = this.refreshIDCUrl;
                requestBody.clientId = this.clientId;
                requestBody.clientSecret = this.clientSecret;
                requestBody.grantType = 'refresh_token';
            }
            const response = await this.axiosInstance.post(refreshUrl, requestBody);
            console.log('[Kiro Auth] Token refresh response:', response.data);

            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                this.refreshToken = response.data.refreshToken;
                this.profileArn = response.data.profileArn;
                const expiresIn = response.data.expiresIn;
                const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
                this.expiresAt = expiresAt;
                console.info('[Kiro Auth] Access token refreshed successfully');

                // Update the token file
                const tokenFilePath = path.join(this.credPath, KIRO_AUTH_TOKEN_FILE);
                const updatedTokenData = {
                    accessToken: this.accessToken,
                    refreshToken: this.refreshToken,
                    expiresAt: expiresAt,
                };
                if(this.profileArn){
                    updatedTokenData.profileArn = this.profileArn;
                }
                await saveCredentialsToFile(tokenFilePath, updatedTokenData);
            } else {
                throw new Error('Invalid refresh response: Missing accessToken');
            }
        } catch (error) {
            console.error('[Kiro Auth] Token refresh failed:', error.message);
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }

    if (!this.accessToken) {
        throw new Error('No access token available after initialization and refresh attempts.');
    }
}

    /**
     * Extract text content from OpenAI message format
     */
    getContentText(message) {
        if (typeof message.content === 'string') {
            return message.content;
        } else if (Array.isArray(message.content)) {
            return message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text)
                .join('');
        }
        return String(message.content || '');
    }

    /**
     * Build CodeWhisperer request from OpenAI messages
     */
    buildCodewhispererRequest(messages, model) {
        const conversationId = uuidv4();
        
        // Extract system prompt and separate messages by role
        let systemPrompt = '';
        const processedMessages = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt = this.getContentText(msg);
            } else {
                processedMessages.push(msg);
            }
        }

        if (processedMessages.length === 0) {
            throw new Error('No user messages found');
        }

        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[this.modelName];

        // Build history with fixed first two elements if system prompt exists
        const history = [];
        if (systemPrompt) {
            history.push({
                userInputMessage: {
                    content: systemPrompt,
                    modelId: codewhispererModel,
                    origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    userInputMessageContext: {}
                }
            });
            history.push({
                assistantResponseMessage: {
                    content: "I will follow these instructions",
                    toolUses: []
                }
            });
        }

        // Add remaining user/assistant messages to history
        for (let i = 0; i < processedMessages.length - 1; i += 2) {
            if (i + 1 < processedMessages.length) {
                history.push({
                    userInputMessage: {
                        content: this.getContentText(processedMessages[i]),
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                        userInputMessageContext: {}
                    }
                });
                history.push({
                    assistantResponseMessage: {
                        content: this.getContentText(processedMessages[i + 1]),
                        toolUses: []
                    }
                });
            }
        }

        // Build current message
        const currentMessage = processedMessages[processedMessages.length - 1];
        let content = this.getContentText(currentMessage);

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId: conversationId,
                currentMessage: {
                    userInputMessage: {
                        content: content,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                        userInputMessageContext: {}
                    }
                },
                history: history
            }
        };

        if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            request.profileArn = this.profileArn;
        }

        return request;
    }

    /**
     * Parse AWS event stream format to extract content.
     * This method is designed to process a single chunk of data from the stream.
     */
    parseEventStreamChunk(rawData) {
        let rawStr;
        if (Buffer.isBuffer(rawData)) {
            rawStr = rawData.toString('utf8');
        } else {
            rawStr = String(rawData);
        }

        let match;
        let fullContent = '';
        const eventMessageRegex = /event(\{.*?\})/g;
        while ((match = eventMessageRegex.exec(rawStr)) !== null) {
            try {
                const jsonString = match[1];
                const eventData = JSON.parse(jsonString);

                // 如果 JSON 对象包含 'followupPrompt' 字段，则跳过
                if (eventData.followupPrompt) {
                    continue;
                }

                // 如果 JSON 对象包含 'content' 字段，则提取其内容
                if (eventData.content) {
                    let decodedContent = eventData.content.replace(/\\n/g, '\n');
                    // Decode HTML entities
                    decodedContent = decodedContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                    fullContent += decodedContent;
                }
            } catch (e) {
                // 捕获 JSON 解析错误，可能是非标准格式的 JSON 或其他数据
                // console.warn('[Kiro Auth] Failed to parse JSON from event stream chunk:', e.message, match[1]);
            }
        }
        return { content: fullContent || '' };
    }

    async callApi(method, model, body, isRetry = false, retryCount = 0) {
        if (!this.isInitialized) await this.initialize();
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        const requestData = this.buildCodewhispererRequest(body.messages, model);

        try {
            const token = this.accessToken; // Use the already initialized token
            const headers = {
                'Authorization': `Bearer ${token}`,
                'amz-sdk-invocation-id': `${uuidv4()}`,
            };

            // 当 model 以 kiro-amazonq 开头时，使用 amazonQUrl，否则使用 baseUrl
            const requestUrl = model.startsWith('kiro-amazonq') ? this.amazonQUrl : this.baseUrl;
            const response = await this.axiosInstance.post(requestUrl, requestData, { headers });
            return response;
        } catch (error) {
            if (error.response?.status === 403 && !isRetry) {
                console.log('[Kiro] Received 403. Attempting token refresh and retrying...');
                try {
                    await this.initializeAuth(true); // Force refresh token
                    return this.callApi(method, model, body, true, retryCount);
                } catch (refreshError) {
                    console.error('[Kiro] Token refresh failed during 403 retry:', refreshError.message);
                    throw refreshError;
                }
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (error.response?.status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Kiro] Received 429 (Too Many Requests). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, model, body, isRetry, retryCount + 1);
            }

            // Handle other retryable errors (5xx server errors)
            if (error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Kiro] Received ${error.response.status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, model, body, isRetry, retryCount + 1);
            }

            console.error('[Kiro] API call failed:', error.message);
            throw error;
        }
    }

    //kiro提供的接口没有流式返回
    async * streamApi(method, model, body, isRetry = false, retryCount = 0) {
        let response;
        try {
            response = await this.callApi(method, model, body, isRetry, retryCount);
        } catch (error) {
            console.error('[Kiro] Error calling API for stream:', error);
            throw error;
        }

        const rawData = response.data; // This is the raw data, not necessarily a ReadableStream

        // Use parseEventStreamChunk to extract content from the raw data
        const parsedContent = this.parseEventStreamChunk(rawData).content;

        // Split the content by lines and yield each line
        const lines = parsedContent.split('\n');
        for (const line of lines) {
            yield line;
        }
    }

    async generateContent(model, requestBody) {
        if (!this.isInitialized) await this.initialize();
        const finalModel = MODEL_MAPPING[model] ? model : this.modelName;
        const response = await this.callApi('generateAssistantResponse', finalModel, requestBody); // requestBody already contains model

        try {
            let responseText = '';

            if (response.data && typeof response.data === 'object') {
                if (response.data.content) {
                    responseText = response.data.content;
                } else {
                    responseText = JSON.stringify(response.data);
                }
            } else {
                const rawData = response.data;
                const parsed = this.parseEventStreamChunk(rawData);
                responseText = parsed.content;
            }
            return this.buildOpenaiResponse(responseText, false, 'assistant', model);
        } catch (error) {
            console.error('[Kiro] Error in generateContent:', error);
            throw new Error(`Error processing response: ${error.message}`);
        }
    }

    async * generateContentStream(model, requestBody) {
        if (!this.isInitialized) await this.initialize();
        const finalModel = MODEL_MAPPING[model] ? model : this.modelName;
        const stream = this.streamApi('generateAssistantResponse', finalModel, requestBody);

        try {            
            for await (const line of stream) { 
                const chunkText = '\n' + line;

                if (chunkText) {
                    const chunk = this.buildOpenaiResponse(chunkText, true, 'assistant', model);
                    yield chunk;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        } catch (error) {
            console.error('[Kiro] Error in streaming generation:', error);
            const errorChunk = this.buildOpenaiResponse(`Error: ${error.message}`, true, 'assistant', model);
            yield errorChunk;
        }

        // const finalChunk = this.buildOpenaiResponse('', true, 'assistant', model);
        // finalChunk.choices[0].delta = {};
        // finalChunk.choices[0].finish_reason = 'stop';
        // yield finalChunk;
    }

    /**
     * Build OpenAI compatible response object
     */
    buildOpenaiResponse(content, isStream = false, role = 'assistant', model) {
        const baseResponse = {
            id: `chatcmpl-${uuidv4()}`,
            object: isStream ? KIRO_CONSTANTS.OPENAI_OBJECT_CHAT_COMPLETION_CHUNK : KIRO_CONSTANTS.OPENAI_OBJECT_CHAT_COMPLETION,
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                finish_reason: isStream ? null : 'stop'
            }]
        };

        if (isStream) {
            baseResponse.choices[0].delta = { role: role, content: content };
        } else {
            baseResponse.choices[0].message = {
                role: role,
                content: content
            };
            baseResponse.usage = {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            };
        }
        return baseResponse;
    }

    /**
     * List available models
     */
    async listModels() {
        const models = Object.keys(MODEL_MAPPING).map(id => ({
            id: id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: KIRO_CONSTANTS.OPENAI_OWNED_BY_KIRO_API
        }));
        
        return {
            object: 'list',
            data: models
        };
    }
}
