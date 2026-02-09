import axios from 'axios';
import logger from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { getProviderModels } from '../provider-models.js';
import { countTokens } from '@anthropic-ai/tokenizer';
import { configureAxiosProxy } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError, MODEL_PROVIDER, formatExpiryLog } from '../../utils/common.js';
import { getProviderPoolManager } from '../../services/service-manager.js';

const KIRO_THINKING = {
    MAX_BUDGET_TOKENS: 24576,
    DEFAULT_BUDGET_TOKENS: 20000,
    START_TAG: '<thinking>',
    END_TAG: '</thinking>',
    MODE_TAG: '<thinking_mode>',
    MAX_LEN_TAG: '<max_thinking_length>',
};

const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    BASE_URL: 'https://q.{{region}}.amazonaws.com/generateAssistantResponse',
    DEFAULT_MODEL_NAME: 'claude-sonnet-4-5',
    AXIOS_TIMEOUT: 120000, // 2 minutes timeout for normal requests
    TOKEN_REFRESH_TIMEOUT: 15000, // 15 seconds timeout for token refresh (shorter to avoid blocking)
    USER_AGENT: 'KiroIDE',
    KIRO_VERSION: '0.8.140',
    CONTENT_TYPE_JSON: 'application/json',
    ACCEPT_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    CHAT_TRIGGER_TYPE_MANUAL: 'MANUAL',
    ORIGIN_AI_EDITOR: 'AI_EDITOR',
    TOTAL_CONTEXT_TOKENS: 172500, // 总上下文 173k tokens
};

// 从 provider-models.js 获取支持的模型列表
const KIRO_MODELS = getProviderModels('claude-kiro-oauth');

// 完整的模型映射表
const FULL_MODEL_MAPPING = {
    "claude-haiku-4-5":"claude-haiku-4.5",
    "claude-opus-4-6":"claude-opus-4.6",
    "claude-opus-4-5":"claude-opus-4.5",
    "claude-opus-4-5-20251101":"claude-opus-4.5",
    "claude-sonnet-4-5": "CLAUDE_SONNET_4_5_20250929_V1_0",
    "claude-sonnet-4-5-20250929": "CLAUDE_SONNET_4_5_20250929_V1_0"
};

// 只保留 KIRO_MODELS 中存在的模型映射
const MODEL_MAPPING = Object.fromEntries(
    Object.entries(FULL_MODEL_MAPPING).filter(([key]) => KIRO_MODELS.includes(key))
);

const KIRO_AUTH_TOKEN_FILE = "kiro-auth-token.json";

/**
 * Kiro API Service - Node.js implementation based on the Python ki2api
 * Provides OpenAI-compatible API for Claude Sonnet 4 via Kiro/CodeWhisperer
 */

/**
 * 根据当前配置生成唯一的机器码（Machine ID）
 * 确保每个配置对应一个唯一且不变的 ID
 * @param {Object} credentials - 当前凭证信息
 * @returns {string} SHA256 格式的机器码
 */
function generateMachineIdFromConfig(credentials) {
    // 优先级：节点UUID > profileArn > clientId > fallback
    const uniqueKey = credentials.uuid || credentials.profileArn || credentials.clientId || "KIRO_DEFAULT_MACHINE";
    return crypto.createHash('sha256').update(uniqueKey).digest('hex');
}

/**
 * 实时获取系统配置信息，用于生成 User-Agent
 * @returns {Object} 包含 osName, nodeVersion 等信息
 */
function getSystemRuntimeInfo() {
    const osPlatform = os.platform();
    const osRelease = os.release();
    const nodeVersion = process.version.replace('v', '');
    
    let osName = osPlatform;
    if (osPlatform === 'win32') osName = `windows#${osRelease}`;
    else if (osPlatform === 'darwin') osName = `macos#${osRelease}`;
    else osName = `${osPlatform}#${osRelease}`;

    return {
        osName,
        nodeVersion
    };
}

// Helper functions for tool calls and JSON parsing

function isQuoteCharAt(text, index) {
    if (index < 0 || index >= text.length) return false;
    const ch = text[index];
    return ch === '"' || ch === "'" || ch === '`';
}

function findRealTag(text, tag, startIndex = 0) {
    let searchStart = Math.max(0, startIndex);
    while (true) {
        const pos = text.indexOf(tag, searchStart);
        if (pos === -1) return -1;
        
        const hasQuoteBefore = isQuoteCharAt(text, pos - 1);
        const hasQuoteAfter = isQuoteCharAt(text, pos + tag.length);
        if (!hasQuoteBefore && !hasQuoteAfter) {
            return pos;
        }
        
        searchStart = pos + 1;
    }
}

/**
 * 通用的括号匹配函数 - 支持多种括号类型
 * @param {string} text - 要搜索的文本
 * @param {number} startPos - 起始位置
 * @param {string} openChar - 开括号字符 (默认 '[')
 * @param {string} closeChar - 闭括号字符 (默认 ']')
 * @returns {number} 匹配的闭括号位置，未找到返回 -1
 */
function findMatchingBracket(text, startPos, openChar = '[', closeChar = ']') {
    if (!text || startPos >= text.length || text[startPos] !== openChar) {
        return -1;
    }

    let bracketCount = 1;
    let inString = false;
    let escapeNext = false;

    for (let i = startPos + 1; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === '\\' && inString) {
            escapeNext = true;
            continue;
        }

        if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === openChar) {
                bracketCount++;
            } else if (char === closeChar) {
                bracketCount--;
                if (bracketCount === 0) {
                    return i;
                }
            }
        }
    }
    return -1;
}


/**
 * 尝试修复常见的 JSON 格式问题
 * @param {string} jsonStr - 可能有问题的 JSON 字符串
 * @returns {string} 修复后的 JSON 字符串
 */
function repairJson(jsonStr) {
    let repaired = jsonStr;
    // 移除尾部逗号
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    // 为未引用的键添加引号
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
    // 确保字符串值被正确引用
    repaired = repaired.replace(/:\s*([a-zA-Z0-9_]+)(?=[,\}\]])/g, ':"$1"');
    return repaired;
}

/**
 * 从损坏的 JSON 中提取关键凭证字段
 * 当标准 JSON 解析和 repairJson 都失败时使用
 * @param {string} content - 文件内容
 * @returns {Object|null} 提取的凭证对象或 null
 */
function extractCredentialsFromCorruptedJson(content) {
    const extracted = {};

    // 定义需要提取的关键字段及其正则模式
    const fieldPatterns = {
        refreshToken: /"refreshToken"\s*:\s*"([^"]+)"/,
        accessToken: /"accessToken"\s*:\s*"([^"]+)"/,
        clientId: /"clientId"\s*:\s*"([^"]+)"/,
        clientSecret: /"clientSecret"\s*:\s*"([^"]+)"/,
        profileArn: /"profileArn"\s*:\s*"([^"]+)"/,
        region: /"region"\s*:\s*"([^"]+)"/,
        authMethod: /"authMethod"\s*:\s*"([^"]+)"/,
        expiresAt: /"expiresAt"\s*:\s*"([^"]+)"/,
        startUrl: /"startUrl"\s*:\s*"([^"]+)"/,
    };

    for (const [field, pattern] of Object.entries(fieldPatterns)) {
        const match = content.match(pattern);
        if (match && match[1]) {
            extracted[field] = match[1];
        }
    }

    // 至少需要 refreshToken 或 accessToken 才算有效
    if (extracted.refreshToken || extracted.accessToken) {
        logger.info(`[Kiro Auth] Extracted ${Object.keys(extracted).length} fields from corrupted JSON: ${Object.keys(extracted).join(', ')}`);
        return extracted;
    }

    return null;
}

/**
 * 解析单个工具调用文本
 * @param {string} toolCallText - 工具调用文本
 * @returns {Object|null} 解析后的工具调用对象或 null
 */
function parseSingleToolCall(toolCallText) {
    const namePattern = /\[Called\s+(\w+)\s+with\s+args:/i;
    const nameMatch = toolCallText.match(namePattern);

    if (!nameMatch) {
        return null;
    }

    const functionName = nameMatch[1].trim();
    const argsStartMarker = "with args:";
    const argsStartPos = toolCallText.toLowerCase().indexOf(argsStartMarker.toLowerCase());

    if (argsStartPos === -1) {
        return null;
    }

    const argsStart = argsStartPos + argsStartMarker.length;
    const argsEnd = toolCallText.lastIndexOf(']');

    if (argsEnd <= argsStart) {
        return null;
    }

    const jsonCandidate = toolCallText.substring(argsStart, argsEnd).trim();

    try {
        const repairedJson = repairJson(jsonCandidate);
        const argumentsObj = JSON.parse(repairedJson);

        if (typeof argumentsObj !== 'object' || argumentsObj === null) {
            return null;
        }

        const toolCallId = `call_${uuidv4().replace(/-/g, '').substring(0, 8)}`;
        return {
            id: toolCallId,
            type: "function",
            function: {
                name: functionName,
                arguments: JSON.stringify(argumentsObj)
            }
        };
    } catch (e) {
        logger.error(`Failed to parse tool call arguments: ${e.message}`, jsonCandidate);
        return null;
    }
}

function parseBracketToolCalls(responseText) {
    if (!responseText || !responseText.includes("[Called")) {
        return null;
    }

    const toolCalls = [];
    const callPositions = [];
    let start = 0;
    while (true) {
        const pos = responseText.indexOf("[Called", start);
        if (pos === -1) {
            break;
        }
        callPositions.push(pos);
        start = pos + 1;
    }

    for (let i = 0; i < callPositions.length; i++) {
        const startPos = callPositions[i];
        let endSearchLimit;
        if (i + 1 < callPositions.length) {
            endSearchLimit = callPositions[i + 1];
        } else {
            endSearchLimit = responseText.length;
        }

        const segment = responseText.substring(startPos, endSearchLimit);
        const bracketEnd = findMatchingBracket(segment, 0);

        let toolCallText;
        if (bracketEnd !== -1) {
            toolCallText = segment.substring(0, bracketEnd + 1);
        } else {
            // Fallback: if no matching bracket, try to find the last ']' in the segment
            const lastBracket = segment.lastIndexOf(']');
            if (lastBracket !== -1) {
                toolCallText = segment.substring(0, lastBracket + 1);
            } else {
                continue; // Skip this one if no closing bracket found
            }
        }
        
        const parsedCall = parseSingleToolCall(toolCallText);
        if (parsedCall) {
            toolCalls.push(parsedCall);
        }
    }
    return toolCalls.length > 0 ? toolCalls : null;
}

function deduplicateToolCalls(toolCalls) {
    const seen = new Set();
    const uniqueToolCalls = [];

    for (const tc of toolCalls) {
        const key = `${tc.function.name}-${tc.function.arguments}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueToolCalls.push(tc);
        } else {
            logger.info(`Skipping duplicate tool call: ${tc.function.name}`);
        }
    }
    return uniqueToolCalls;
}

export class KiroApiService {
    constructor(config = {}) {
        this.isInitialized = false;
        this.config = config;
        this.credPath = config.KIRO_OAUTH_CREDS_DIR_PATH || path.join(os.homedir(), ".aws", "sso", "cache");
        this.credsBase64 = config.KIRO_OAUTH_CREDS_BASE64;
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_KIRO ?? false;
        this.uuid = config?.uuid; // 获取多节点配置的 uuid
        logger.info(`[Kiro] System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);
        // this.accessToken = config.KIRO_ACCESS_TOKEN;
        // this.refreshToken = config.KIRO_REFRESH_TOKEN;
        // this.clientId = config.KIRO_CLIENT_ID;
        // this.clientSecret = config.KIRO_CLIENT_SECRET;
        // this.authMethod = KIRO_CONSTANTS.AUTH_METHOD_SOCIAL;
        // this.refreshUrl = KIRO_CONSTANTS.REFRESH_URL;
        // this.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL;
        // this.baseUrl = KIRO_CONSTANTS.BASE_URL;

        // Add kiro-oauth-creds-base64 and kiro-oauth-creds-file to config
        if (config.KIRO_OAUTH_CREDS_BASE64) {
            try {
                const decodedCreds = Buffer.from(config.KIRO_OAUTH_CREDS_BASE64, 'base64').toString('utf8');
                const parsedCreds = JSON.parse(decodedCreds);
                // Store parsedCreds to be merged in initializeAuth
                this.base64Creds = parsedCreds;
                logger.info('[Kiro] Successfully decoded Base64 credentials in constructor.');
            } catch (error) {
                logger.error(`[Kiro] Failed to parse Base64 credentials in constructor: ${error.message}`);
            }
        } else if (config.KIRO_OAUTH_CREDS_FILE_PATH) {
            this.credsFilePath = config.KIRO_OAUTH_CREDS_FILE_PATH;
        }

        this.modelName = KIRO_CONSTANTS.DEFAULT_MODEL_NAME;
        this.axiosInstance = null; // Initialize later in async method
        this.axiosSocialRefreshInstance = null;
    }
 
    async initialize() {
        if (this.isInitialized) return;
        logger.info('[Kiro] Initializing Kiro API Service...');
        // 注意：V2 读写分离架构下，初始化不再执行同步认证/刷新逻辑
        // 仅执行基础的凭证加载
        await this.loadCredentials();
        
        // 根据当前加载的凭证生成唯一的 Machine ID
        const machineId = generateMachineIdFromConfig({
            uuid: this.uuid,
            profileArn: this.profileArn,
            clientId: this.clientId
        });
        const kiroVersion = KIRO_CONSTANTS.KIRO_VERSION;
        const { osName, nodeVersion } = getSystemRuntimeInfo();

        // 配置 HTTP/HTTPS agent 限制连接池大小，避免资源泄漏
        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 100,        // 每个主机最多 100 个连接
            maxFreeSockets: 5,     // 最多保留 5 个空闲连接
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        });
        const httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        });
        
        const axiosConfig = {
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
            httpAgent,
            httpsAgent,
            headers: {
                'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
                'Accept': KIRO_CONSTANTS.ACCEPT_JSON,
                'amz-sdk-request': 'attempt=1; max=1',
                'x-amzn-kiro-agent-mode': 'vibe',
                'x-amz-user-agent': `aws-sdk-js/1.0.0 KiroIDE-${kiroVersion}-${machineId}`,
                'user-agent': `aws-sdk-js/1.0.0 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererruntime#1.0.0 m/E KiroIDE-${kiroVersion}-${machineId}`,
                'Connection': 'close'
            },
        };
        
        // 根据 useSystemProxy 配置代理设置
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        // 配置自定义代理
        configureAxiosProxy(axiosConfig, this.config, 'claude-kiro-oauth');
        
        this.axiosInstance = axios.create(axiosConfig);

        axiosConfig.headers = new Headers();
        axiosConfig.headers.set('Content-Type', KIRO_CONSTANTS.CONTENT_TYPE_JSON);
        this.axiosSocialRefreshInstance = axios.create(axiosConfig);
        this.isInitialized = true;
    }

/**
 * 加载凭证信息（不执行刷新）
 */
async loadCredentials() {
    // 获取凭证文件路径
    const tokenFilePath = this.credsFilePath || path.join(this.credPath, KIRO_AUTH_TOKEN_FILE);

    // Helper to load credentials from a file
    const loadCredentialsFromFile = async (filePath) => {
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            try {
                return JSON.parse(fileContent);
            } catch (parseError) {
                logger.warn('[Kiro Auth] JSON parse failed, attempting repair...');
                try {
                    const repaired = repairJson(fileContent);
                    const result = JSON.parse(repaired);
                    logger.info('[Kiro Auth] JSON repair successful');
                    return result;
                } catch (repairError) {
                    logger.warn('[Kiro Auth] JSON repair failed, attempting field extraction...');
                    // 尝试从损坏的 JSON 中提取关键字段
                    const extracted = extractCredentialsFromCorruptedJson(fileContent);
                    if (extracted) {
                        logger.info('[Kiro Auth] Field extraction successful, credentials recovered');
                        return extracted;
                    }
                    logger.error('[Kiro Auth] All recovery methods failed:', repairError.message);
                    return null;
                }
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug(`[Kiro Auth] Credential file not found: ${filePath}`);
            } else {
                logger.warn(`[Kiro Auth] Failed to read credential file ${filePath}: ${error.message}`);
            }
            return null;
        }
    };

    try {
        let mergedCredentials = {};

        // Priority 1: Load from Base64 credentials if available
        if (this.base64Creds) {
            Object.assign(mergedCredentials, this.base64Creds);
            logger.info('[Kiro Auth] Successfully loaded credentials from Base64 (constructor).');
            this.base64Creds = null;
        }

        // 从文件加载
        const targetFilePath = this.credsFilePath || path.join(this.credPath, KIRO_AUTH_TOKEN_FILE);
        const dirPath = path.dirname(targetFilePath);
        const targetFileName = path.basename(targetFilePath);

        logger.debug(`[Kiro Auth] Loading credentials from directory: ${dirPath}`);

        try {
            const targetCredentials = await loadCredentialsFromFile(targetFilePath);
            if (targetCredentials) {
                Object.assign(mergedCredentials, targetCredentials);
                logger.info(`[Kiro Auth] Successfully loaded OAuth credentials from ${targetFilePath}`);
            }

            const files = await fs.readdir(dirPath);
            for (const file of files) {
                if (file.endsWith('.json') && file !== targetFileName) {
                    const filePath = path.join(dirPath, file);
                    const credentials = await loadCredentialsFromFile(filePath);
                    if (credentials) {
                        credentials.expiresAt = mergedCredentials.expiresAt;
                        Object.assign(mergedCredentials, credentials);
                        logger.debug(`[Kiro Auth] Loaded Client credentials from ${file}`);
                    }
                }
            }
        } catch (error) {
            logger.warn(`[Kiro Auth] Error loading credentials from directory ${dirPath}: ${error.message}`);
        }

        // Apply loaded credentials
        this.accessToken = this.accessToken || mergedCredentials.accessToken;
        this.refreshToken = this.refreshToken || mergedCredentials.refreshToken;
        this.clientId = this.clientId || mergedCredentials.clientId;
        this.clientSecret = this.clientSecret || mergedCredentials.clientSecret;
        this.authMethod = this.authMethod || mergedCredentials.authMethod;
        this.expiresAt = this.expiresAt || mergedCredentials.expiresAt;
        this.profileArn = this.profileArn || mergedCredentials.profileArn;
        this.region = this.region || mergedCredentials.region;
        this.idcRegion = this.idcRegion || mergedCredentials.idcRegion;

        if (!this.region) {
            logger.warn('[Kiro Auth] Region not found in credentials. Using default region us-east-1 for URLs.');
            this.region = 'us-east-1';
        }

        // idcRegion 用于 REFRESH_IDC_URL，如果未设置则使用 region
        if (!this.idcRegion) {
            this.idcRegion = this.region;
        }

        this.refreshUrl = (this.config.KIRO_REFRESH_URL || KIRO_CONSTANTS.REFRESH_URL).replace("{{region}}", this.region);
        this.refreshIDCUrl = (this.config.KIRO_REFRESH_IDC_URL || KIRO_CONSTANTS.REFRESH_IDC_URL).replace("{{region}}", this.idcRegion);
        this.baseUrl = (this.config.KIRO_BASE_URL || KIRO_CONSTANTS.BASE_URL).replace("{{region}}", this.region);
    } catch (error) {
        logger.warn(`[Kiro Auth] Error during credential loading: ${error.message}`);
    }
}

async initializeAuth(forceRefresh = false) {
    if (this.accessToken && !forceRefresh) {
        logger.debug('[Kiro Auth] Access token already available and not forced refresh.');
        return;
    }

    // 首先执行基础凭证加载
    await this.loadCredentials();

    // 只有在明确要求强制刷新，或者 AccessToken 确实缺失时，才执行刷新
    // 注意：在 V2 架构下，此方法主要由 PoolManager 的后台队列调用
    if (forceRefresh || (!this.accessToken && this.refreshToken)) {
        if (!this.refreshToken) {
            throw new Error('No refresh token available to refresh access token.');
        }

        const tokenFilePath = this.credsFilePath || path.join(this.credPath, KIRO_AUTH_TOKEN_FILE);
        await this._doTokenRefresh(this.saveCredentialsToFile.bind(this), tokenFilePath);
    }

    if (!this.accessToken) {
        throw new Error('No access token available after initialization and refresh attempts.');
    }
}

/**
 * Helper to save credentials
 */
async saveCredentialsToFile(filePath, newData) {
    let existingData = {};
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        try {
            existingData = JSON.parse(fileContent);
        } catch (parseError) {
            logger.warn('[Kiro Auth] JSON parse failed, attempting repair...');
            try {
                const repaired = repairJson(fileContent);
                existingData = JSON.parse(repaired);
                logger.info('[Kiro Auth] JSON repair successful');
            } catch (repairError) {
                logger.warn('[Kiro Auth] JSON repair failed, attempting field extraction...');
                const extracted = extractCredentialsFromCorruptedJson(fileContent);
                if (extracted) {
                    existingData = extracted;
                    logger.info('[Kiro Auth] Field extraction successful');
                } else {
                    logger.error('[Kiro Auth] All recovery methods failed:', repairError.message);
                    existingData = {};
                }
            }
        }
    } catch (readError) {
        if (readError.code === 'ENOENT') {
            logger.debug(`[Kiro Auth] Token file not found, creating new one: ${filePath}`);
        } else {
            logger.warn(`[Kiro Auth] Could not read existing token file ${filePath}: ${readError.message}`);
        }
    }
    const mergedData = { ...existingData, ...newData };
    await fs.writeFile(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
    logger.info(`[Kiro Auth] Updated token file: ${filePath}`);
};

    /**
     * 执行实际的 token 刷新操作（内部方法）
     * @param {Function} saveCredentialsToFile - 保存凭证的函数
     * @param {string} tokenFilePath - 凭证文件路径
     */
    async _doTokenRefresh(saveCredentialsToFile, tokenFilePath) {
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

            let response = null;
            // 使用更短的超时时间进行 token 刷新，避免阻塞其他请求
            const refreshConfig = { timeout: KIRO_CONSTANTS.TOKEN_REFRESH_TIMEOUT };
            if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
                response = await this.axiosSocialRefreshInstance.post(refreshUrl, requestBody, refreshConfig);
                logger.info('[Kiro Auth] Token refresh social response: ok');
            } else {
                response = await this.axiosInstance.post(refreshUrl, requestBody, refreshConfig);
                logger.info('[Kiro Auth] Token refresh idc response: ok');
            }

            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                this.refreshToken = response.data.refreshToken;
                this.profileArn = response.data.profileArn;
                const expiresIn = response.data.expiresIn;
                const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
                this.expiresAt = expiresAt;
                logger.info('[Kiro Auth] Access token refreshed successfully');

                const updatedTokenData = {
                    accessToken: this.accessToken,
                    refreshToken: this.refreshToken,
                    expiresAt: expiresAt,
                };
                if (this.profileArn) {
                    updatedTokenData.profileArn = this.profileArn;
                }
                await saveCredentialsToFile(tokenFilePath, updatedTokenData);

                // 刷新成功，重置 PoolManager 中的刷新状态并标记为健康
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    poolManager.resetProviderRefreshStatus(MODEL_PROVIDER.KIRO_API, this.uuid);
                }
            } else {
                throw new Error('Invalid refresh response: Missing accessToken');
            }
        } catch (error) {
            logger.error('[Kiro Auth] Token refresh failed:', error.message);
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }


    /**
     * Extract text content from OpenAI message format
     */
    getContentText(message) {
        if(message==null){
            return "";
        }
        if (Array.isArray(message)) {
            return message.map(part => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    if (part.type === 'text' && part.text) return part.text;
                    if (part.text) return part.text;
                }
                return '';
            }).join('');
        } else if (typeof message.content === 'string') {
            return message.content;
        } else if (Array.isArray(message.content)) {
            return message.content.map(part => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    if (part.type === 'text' && part.text) return part.text;
                    if (part.text) return part.text;
                }
                return '';
            }).join('');
        }
        return String(message.content || message);
    }

    /**
     * 统一处理内容，将不同格式的内容转换为文本
     * @param {any} content - 内容对象或数组
     * @returns {string} 处理后的文本
     */
    processContent(content) {
        if (!content) return "";
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content.map(part => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    if (part.type === 'text') return part.text || "";
                    if (part.type === 'thinking') return part.thinking || part.text || "";
                    if (part.type === 'tool_result') return this.processContent(part.content);
                    if (part.type === 'tool_use' && part.input) return JSON.stringify(part.input);
                    if (part.text) return part.text;
                }
                return "";
            }).join("");
        }
        return this.getContentText(content);
    }

    _normalizeThinkingBudgetTokens(budgetTokens) {
        let value = Number(budgetTokens);
        if (!Number.isFinite(value) || value <= 0) {
            value = KIRO_THINKING.DEFAULT_BUDGET_TOKENS;
        }
        value = Math.floor(value);
        return Math.min(value, KIRO_THINKING.MAX_BUDGET_TOKENS);
    }

    _generateThinkingPrefix(thinking) {
        if (!thinking || thinking.type !== 'enabled') return null;
        const budget = this._normalizeThinkingBudgetTokens(thinking.budget_tokens);
        return `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>`;
    }

    _hasThinkingPrefix(text) {
        if (!text) return false;
        return text.includes(KIRO_THINKING.MODE_TAG) || text.includes(KIRO_THINKING.MAX_LEN_TAG);
    }

    _toClaudeContentBlocksFromKiroText(content) {
        const raw = content ?? '';
        if (!raw) return [];
        
        const startPos = findRealTag(raw, KIRO_THINKING.START_TAG);
        if (startPos === -1) {
            return [{ type: "text", text: raw }];
        }
        
        const before = raw.slice(0, startPos);
        let rest = raw.slice(startPos + KIRO_THINKING.START_TAG.length);
        
        const endPosInRest = findRealTag(rest, KIRO_THINKING.END_TAG);
        let thinking = '';
        let after = '';
        if (endPosInRest === -1) {
            thinking = rest;
        } else {
            thinking = rest.slice(0, endPosInRest);
            after = rest.slice(endPosInRest + KIRO_THINKING.END_TAG.length);
        }
        
        if (after.startsWith('\n\n')) after = after.slice(2);
        
        const blocks = [];
        if (before) blocks.push({ type: "text", text: before });
        blocks.push({ type: "thinking", thinking });
        if (after) blocks.push({ type: "text", text: after });
        return blocks;
    }

    /**
     * Build CodeWhisperer request from OpenAI messages
     */
    async buildCodewhispererRequest(messages, model, tools = null, inSystemPrompt = null, thinking = null) {
        const conversationId = uuidv4();
        
        let systemPrompt = this.getContentText(inSystemPrompt);
        const processedMessages = messages;

        if (processedMessages.length === 0) {
            throw new Error('No user messages found');
        }

        const thinkingPrefix = this._generateThinkingPrefix(thinking);
        if (thinkingPrefix) {
            if (!systemPrompt) {
                systemPrompt = thinkingPrefix;
            } else if (!this._hasThinkingPrefix(systemPrompt)) {
                systemPrompt = `${thinkingPrefix}\n${systemPrompt}`;
            }
        }

        // 判断最后一条消息是否为 assistant,如果是则移除
        const lastMessage = processedMessages[processedMessages.length - 1];
        if (processedMessages.length > 0 && lastMessage.role === 'assistant') {
            if (lastMessage.content[0].type === "text" && lastMessage.content[0].text === "{") {
                logger.info('[Kiro] Removing last assistant with "{" message from processedMessages');
                processedMessages.pop();
            }
        }

        // 合并相邻相同 role 的消息
        const mergedMessages = [];
        for (let i = 0; i < processedMessages.length; i++) {
            const currentMsg = processedMessages[i];
            
            if (mergedMessages.length === 0) {
                mergedMessages.push(currentMsg);
            } else {
                const lastMsg = mergedMessages[mergedMessages.length - 1];
                
                // 判断当前消息和上一条消息是否为相同 role
                if (currentMsg.role === lastMsg.role) {
                    // 合并消息内容
                    if (Array.isArray(lastMsg.content) && Array.isArray(currentMsg.content)) {
                        // 如果都是数组,合并数组内容
                        lastMsg.content.push(...currentMsg.content);
                    } else if (typeof lastMsg.content === 'string' && typeof currentMsg.content === 'string') {
                        // 如果都是字符串,用换行符连接
                        lastMsg.content += '\n' + currentMsg.content;
                    } else if (Array.isArray(lastMsg.content) && typeof currentMsg.content === 'string') {
                        // 上一条是数组,当前是字符串,添加为 text 类型
                        lastMsg.content.push({ type: 'text', text: currentMsg.content });
                    } else if (typeof lastMsg.content === 'string' && Array.isArray(currentMsg.content)) {
                        // 上一条是字符串,当前是数组,转换为数组格式
                        lastMsg.content = [{ type: 'text', text: lastMsg.content }, ...currentMsg.content];
                    }
                    // logger.info(`[Kiro] Merged adjacent ${currentMsg.role} messages`);
                } else {
                    mergedMessages.push(currentMsg);
                }
            }
        }
        
        // 用合并后的消息替换原消息数组
        processedMessages.length = 0;
        processedMessages.push(...mergedMessages);

        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[this.modelName];
        
        // 动态压缩 tools（保留全部工具，但过滤掉 web_search/websearch）
        let toolsContext = {};
        if (tools && Array.isArray(tools) && tools.length > 0) {
            // 过滤掉 web_search 或 websearch 工具（忽略大小写）
            const filteredTools = tools.filter(tool => {
                const name = (tool.name || '').toLowerCase();
                const shouldIgnore = name === 'web_search' || name === 'websearch';
                if (shouldIgnore) {
                    logger.info(`[Kiro] Ignoring tool: ${tool.name}`);
                }
                return !shouldIgnore;
            });
            
            if (filteredTools.length === 0) {
                // 所有工具都被过滤掉了，添加一个占位工具
                logger.info('[Kiro] All tools were filtered out, adding placeholder tool');
                const placeholderTool = {
                    toolSpecification: {
                        name: "no_tool_available",
                        description: "This is a placeholder tool when no other tools are available. It does nothing.",
                        inputSchema: {
                            json: {
                                type: "object",
                                properties: {}
                            }
                        }
                    }
                };
                toolsContext = { tools: [placeholderTool] };
            } else {
                const MAX_DESCRIPTION_LENGTH = 9216;

                let truncatedCount = 0;
                const kiroTools = filteredTools
                    .filter(tool => {
                        // 过滤掉描述为空的工具
                        if (!tool.description || tool.description.trim() === '') {
                            logger.info(`[Kiro] Ignoring tool with empty description: ${tool.name}`);
                            return false;
                        }
                        return true;
                    })
                    .map(tool => {
                        let desc = tool.description || "";
                        const originalLength = desc.length;
                        
                        if (desc.length > MAX_DESCRIPTION_LENGTH) {
                            desc = desc.substring(0, MAX_DESCRIPTION_LENGTH) + "...";
                            truncatedCount++;
                            logger.info(`[Kiro] Truncated tool '${tool.name}' description: ${originalLength} -> ${desc.length} chars`);
                        }
                        
                        return {
                            toolSpecification: {
                                name: tool.name,
                                description: desc,
                                inputSchema: {
                                    json: tool.input_schema || {}
                                }
                            }
                        };
                    });
                
                if (truncatedCount > 0) {
                    logger.info(`[Kiro] Truncated ${truncatedCount} tool description(s) to max ${MAX_DESCRIPTION_LENGTH} chars`);
                }

                // 检查过滤后是否还有有效工具
                if (kiroTools.length === 0) {
                    logger.info('[Kiro] All tools were filtered out (empty descriptions), adding placeholder tool');
                    const placeholderTool = {
                        toolSpecification: {
                            name: "no_tool_available",
                            description: "This is a placeholder tool when no other tools are available. It does nothing.",
                            inputSchema: {
                                json: {
                                    type: "object",
                                    properties: {}
                                }
                            }
                        }
                    };
                    toolsContext = { tools: [placeholderTool] };
                } else {
                    toolsContext = { tools: kiroTools };
                }
            }
        } else {
            // tools 为空或长度为 0 时，自动添加一个占位工具
            logger.info('[Kiro] No tools provided, adding placeholder tool');
            const placeholderTool = {
                toolSpecification: {
                    name: "no_tool_available",
                    description: "This is a placeholder tool when no other tools are available. It does nothing.",
                    inputSchema: {
                        json: {
                            type: "object",
                            properties: {}
                        }
                    }
                }
            };
            toolsContext = { tools: [placeholderTool] };
        }

        const history = [];
        let startIndex = 0;

        // Handle system prompt
        if (systemPrompt) {
            // If the first message is a user message, prepend system prompt to it
            if (processedMessages[0].role === 'user') {
                let firstUserContent = this.getContentText(processedMessages[0]);
                history.push({
                    userInputMessage: {
                        content: `${systemPrompt}\n\n${firstUserContent}`,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    }
                });
                startIndex = 1; // Start processing from the second message
            } else {
                // If the first message is not a user message, or if there's no initial user message,
                // add system prompt as a standalone user message.
                history.push({
                    userInputMessage: {
                        content: systemPrompt,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    }
                });
            }
        }

        // 保留最近 5 条历史消息中的图片
        const keepImageThreshold = 5;        
        for (let i = startIndex; i < processedMessages.length - 1; i++) {
            const message = processedMessages[i];
            // 计算当前消息距离最后一条消息的位置（从后往前数）
            const distanceFromEnd = (processedMessages.length - 1) - i;
            // 如果距离末尾不超过 5 条，则保留图片
            const shouldKeepImages = distanceFromEnd <= keepImageThreshold;
            
            if (message.role === 'user') {
                let userInputMessage = {
                    content: '',
                    modelId: codewhispererModel,
                    origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
                };
                let imageCount = 0;
                let toolResults = [];
                let images = [];
                
                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part.type === 'text') {
                            userInputMessage.content += part.text;
                        } else if (part.type === 'tool_result') {
                            toolResults.push({
                                content: [{ text: this.getContentText(part.content) }],
                                status: 'success',
                                toolUseId: part.tool_use_id
                            });
                        } else if (part.type === 'image') {
                            if (shouldKeepImages) {
                                // 最近 5 条消息内的图片保留原始数据
                                images.push({
                                    format: part.source.media_type.split('/')[1],
                                    source: {
                                        bytes: part.source.data
                                    }
                                });
                            } else {
                                // 超过 5 条历史记录的图片只记录数量
                                imageCount++;
                            }
                        }
                    }
                } else {
                    userInputMessage.content = this.getContentText(message);
                }
                
                // 如果有保留的图片，添加到消息中
                if (images.length > 0) {
                    userInputMessage.images = images;
                    logger.info(`[Kiro] Kept ${images.length} image(s) in recent history message (distance from end: ${distanceFromEnd})`);
                }
                
                // 如果有被替换的图片，添加占位符说明
                if (imageCount > 0) {
                    const imagePlaceholder = `[此消息包含 ${imageCount} 张图片，已在历史记录中省略]`;
                    userInputMessage.content = userInputMessage.content
                        ? `${userInputMessage.content}\n${imagePlaceholder}`
                        : imagePlaceholder;
                    logger.info(`[Kiro] Replaced ${imageCount} image(s) with placeholder in old history message (distance from end: ${distanceFromEnd})`);
                }
                
                if (toolResults.length > 0) {
                    // 去重 toolResults - Kiro API 不接受重复的 toolUseId
                    const uniqueToolResults = [];
                    const seenIds = new Set();
                    for (const tr of toolResults) {
                        if (!seenIds.has(tr.toolUseId)) {
                            seenIds.add(tr.toolUseId);
                            uniqueToolResults.push(tr);
                        }
                    }
                    userInputMessage.userInputMessageContext = { toolResults: uniqueToolResults };
                }
                
                history.push({ userInputMessage });
            } else if (message.role === 'assistant') {
                let assistantResponseMessage = {
                    content: ''
                };
                let toolUses = [];
                let thinkingText = '';
                
                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part.type === 'text') {
                            assistantResponseMessage.content += part.text;
                        } else if (part.type === 'thinking') {
                            thinkingText += (part.thinking ?? part.text ?? '');
                        } else if (part.type === 'tool_use') {
                            toolUses.push({
                                input: part.input,
                                name: part.name,
                                toolUseId: part.id
                            });
                        }
                    }
                } else {
                    assistantResponseMessage.content = this.getContentText(message);
                }
                
                if (thinkingText) {
                    assistantResponseMessage.content = assistantResponseMessage.content
                        ? `${KIRO_THINKING.START_TAG}${thinkingText}${KIRO_THINKING.END_TAG}\n\n${assistantResponseMessage.content}`
                        : `${KIRO_THINKING.START_TAG}${thinkingText}${KIRO_THINKING.END_TAG}`;
                }

                // 只添加非空字段
                if (toolUses.length > 0) {
                    assistantResponseMessage.toolUses = toolUses;
                }
                
                history.push({ assistantResponseMessage });
            }
        }

        // Build current message
        let currentMessage = processedMessages[processedMessages.length - 1];
        let currentContent = '';
        let currentToolResults = [];
        let currentToolUses = [];
        let currentImages = [];

        // 如果最后一条消息是 assistant，需要将其加入 history，然后创建一个 user 类型的 currentMessage
        // 因为 CodeWhisperer API 的 currentMessage 必须是 userInputMessage 类型
        if (currentMessage.role === 'assistant') {
            logger.info('[Kiro] Last message is assistant, moving it to history and creating user currentMessage');
            
            // 构建 assistant 消息并加入 history
            let assistantResponseMessage = {
                content: '',
                toolUses: []
            };
            let thinkingText = '';
            if (Array.isArray(currentMessage.content)) {
                for (const part of currentMessage.content) {
                    if (part.type === 'text') {
                        assistantResponseMessage.content += part.text;
                    } else if (part.type === 'thinking') {
                        thinkingText += (part.thinking ?? part.text ?? '');
                    } else if (part.type === 'tool_use') {
                        assistantResponseMessage.toolUses.push({
                            input: part.input,
                            name: part.name,
                            toolUseId: part.id
                        });
                    }
                }
            } else {
                assistantResponseMessage.content = this.getContentText(currentMessage);
            }
            if (thinkingText) {
                assistantResponseMessage.content = assistantResponseMessage.content
                    ? `${KIRO_THINKING.START_TAG}${thinkingText}${KIRO_THINKING.END_TAG}\n\n${assistantResponseMessage.content}`
                    : `${KIRO_THINKING.START_TAG}${thinkingText}${KIRO_THINKING.END_TAG}`;
            }
            if (assistantResponseMessage.toolUses.length === 0) {
                delete assistantResponseMessage.toolUses;
            }
            history.push({ assistantResponseMessage });
            
            // 设置 currentContent 为 "Continue"，因为我们需要一个 user 消息来触发 AI 继续
            currentContent = 'Continue';
        } else {
            // 最后一条消息是 user，需要确保 history 最后一个元素是 assistantResponseMessage
            // Kiro API 要求 history 必须以 assistantResponseMessage 结尾
            if (history.length > 0) {
                const lastHistoryItem = history[history.length - 1];
                if (!lastHistoryItem.assistantResponseMessage) {
                    // 最后一个不是 assistantResponseMessage，需要补全一个空的
                    logger.info('[Kiro] History does not end with assistantResponseMessage, adding empty one');
                    history.push({
                        assistantResponseMessage: {
                            content: 'Continue'
                        }
                    });
                }
            }
            
            // 处理 user 消息
            if (Array.isArray(currentMessage.content)) {
                for (const part of currentMessage.content) {
                    if (part.type === 'text') {
                        currentContent += part.text;
                    } else if (part.type === 'tool_result') {
                        currentToolResults.push({
                            content: [{ text: this.getContentText(part.content) }],
                            status: 'success',
                            toolUseId: part.tool_use_id
                        });
                    } else if (part.type === 'tool_use') {
                        currentToolUses.push({
                            input: part.input,
                            name: part.name,
                            toolUseId: part.id
                        });
                    } else if (part.type === 'image') {
                        currentImages.push({
                            format: part.source.media_type.split('/')[1],
                            source: {
                                bytes: part.source.data
                            }
                        });
                    }
                }
            } else {
                currentContent = this.getContentText(currentMessage);
            }

            // Kiro API 要求 content 不能为空，即使有 toolResults
            if (!currentContent) {
                currentContent = currentToolResults.length > 0 ? 'Tool results provided.' : 'Continue';
            }
        }

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId: conversationId,
                currentMessage: {} // Will be populated as userInputMessage
            }
        };
        
        // 只有当 history 非空时才添加（API 可能不接受空数组）
        if (history.length > 0) {
            request.conversationState.history = history;
        }

        // currentMessage 始终是 userInputMessage 类型
        // 注意：API 不接受 null 值，空字段应该完全不包含
        const userInputMessage = {
            content: currentContent,
            modelId: codewhispererModel,
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
        };

        // 只有当 images 非空时才添加
        if (currentImages && currentImages.length > 0) {
            userInputMessage.images = currentImages;
        }

        // 构建 userInputMessageContext，只包含非空字段
        const userInputMessageContext = {};
        if (currentToolResults.length > 0) {
            // 去重 toolResults - Kiro API 不接受重复的 toolUseId
            const uniqueToolResults = [];
            const seenToolUseIds = new Set();
            for (const tr of currentToolResults) {
                if (!seenToolUseIds.has(tr.toolUseId)) {
                    seenToolUseIds.add(tr.toolUseId);
                    uniqueToolResults.push(tr);
                }
            }
            userInputMessageContext.toolResults = uniqueToolResults;
        }
        if (Object.keys(toolsContext).length > 0 && toolsContext.tools) {
            userInputMessageContext.tools = toolsContext.tools;
        }

        // 只有当 userInputMessageContext 有内容时才添加
        if (Object.keys(userInputMessageContext).length > 0) {
            userInputMessage.userInputMessageContext = userInputMessageContext;
        }

        request.conversationState.currentMessage.userInputMessage = userInputMessage;

        if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            request.profileArn = this.profileArn;
        }

        // 监控钩子：内部请求转换
        if (this.config?._monitorRequestId) {
            try {
                const { getPluginManager } = await import('../../core/plugin-manager.js');
                const pluginManager = getPluginManager();
                if (pluginManager) {
                    await pluginManager.executeHook('onInternalRequestConverted', {
                        requestId: this.config._monitorRequestId,
                        internalRequest: request,
                        converterName: 'buildCodewhispererRequest'
                    });
                }
            } catch (e) {
                logger.error('[Kiro] Error calling onInternalRequestConverted hook:', e.message);
            }
        }

        // fs.writeFile('claude-kiro-request'+Date.now()+'.json', JSON.stringify(request));
        return request;
    }

    parseEventStreamChunk(rawData) {
        const rawStr = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData);
        let fullContent = '';
        const toolCalls = [];
        let currentToolCallDict = null;
        // logger.info(`rawStr=${rawStr}`);

        // 改进的 SSE 事件解析：匹配 :message-typeevent 后面的 JSON 数据
        // 使用更精确的正则来匹配 SSE 格式的事件
        const sseEventRegex = /:message-typeevent(\{[^]*?(?=:event-type|$))/g;
        const legacyEventRegex = /event(\{.*?(?=event\{|$))/gs;
        
        // 首先尝试使用 SSE 格式解析
        let matches = [...rawStr.matchAll(sseEventRegex)];
        
        // 如果 SSE 格式没有匹配到，回退到旧的格式
        if (matches.length === 0) {
            matches = [...rawStr.matchAll(legacyEventRegex)];
        }

        for (const match of matches) {
            const potentialJsonBlock = match[1];
            if (!potentialJsonBlock || potentialJsonBlock.trim().length === 0) {
                continue;
            }

            // 尝试找到完整的 JSON 对象
            let searchPos = 0;
            while ((searchPos = potentialJsonBlock.indexOf('}', searchPos + 1)) !== -1) {
                const jsonCandidate = potentialJsonBlock.substring(0, searchPos + 1).trim();
                try {
                    const eventData = JSON.parse(jsonCandidate);

                    // 优先处理结构化工具调用事件
                    if (eventData.name && eventData.toolUseId) {
                        if (!currentToolCallDict) {
                            currentToolCallDict = {
                                id: eventData.toolUseId,
                                type: "function",
                                function: {
                                    name: eventData.name,
                                    arguments: ""
                                }
                            };
                        }
                        if (eventData.input) {
                            currentToolCallDict.function.arguments += eventData.input;
                        }
                        if (eventData.stop) {
                            try {
                                const args = JSON.parse(currentToolCallDict.function.arguments);
                                currentToolCallDict.function.arguments = JSON.stringify(args);
                            } catch (e) {
                                logger.warn(`[Kiro] Tool call arguments not valid JSON: ${currentToolCallDict.function.arguments}`);
                            }
                            toolCalls.push(currentToolCallDict);
                            currentToolCallDict = null;
                        }
                    } else if (!eventData.followupPrompt && eventData.content) {
                        // 处理内容，移除转义字符
                        let decodedContent = eventData.content;
                        // 处理常见的转义序列
                        decodedContent = decodedContent.replace(/(?<!\\)\\n/g, '\n');
                        // decodedContent = decodedContent.replace(/(?<!\\)\\t/g, '\t');
                        // decodedContent = decodedContent.replace(/\\"/g, '"');
                        // decodedContent = decodedContent.replace(/\\\\/g, '\\');
                        fullContent += decodedContent;
                    }
                    break;
                } catch (e) {
                    // JSON 解析失败，继续寻找下一个可能的结束位置
                    continue;
                }
            }
        }
        
        // 如果还有未完成的工具调用，添加到列表中
        if (currentToolCallDict) {
            toolCalls.push(currentToolCallDict);
        }

        // 检查解析后文本中的 bracket 格式工具调用
        const bracketToolCalls = parseBracketToolCalls(fullContent);
        if (bracketToolCalls) {
            toolCalls.push(...bracketToolCalls);
            // 从响应文本中移除工具调用文本
            for (const tc of bracketToolCalls) {
                const funcName = tc.function.name;
                const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`\\[Called\\s+${escapedName}\\s+with\\s+args:\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}\\]`, 'gs');
                fullContent = fullContent.replace(pattern, '');
            }
            fullContent = fullContent.replace(/\s+/g, ' ').trim();
        }

        const uniqueToolCalls = deduplicateToolCalls(toolCalls);
        return { content: fullContent || '', toolCalls: uniqueToolCalls };
    }
 

    /**
     * 调用 API 并处理错误重试
     */
    async callApi(method, model, body, isRetry = false, retryCount = 0) {
        if (!this.isInitialized) await this.initialize();
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        // 处理不同格式的请求体（messages 或 contents）
        let messages = body.messages;
        if (!messages && body.contents) {
            // 将 Gemini 格式的 contents 转换为 messages 格式
            messages = body.contents.map(content => ({
                role: content.role || 'user',
                content: content.parts?.map(part => part.text).join('') || ''
            }));
        }
        
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            throw new Error('No messages found in request body');
        }

        const requestData = await this.buildCodewhispererRequest(messages, model, body.tools, body.system, body.thinking);

        try {
            const token = this.accessToken; // Use the already initialized token
            const headers = {
                'Authorization': `Bearer ${token}`,
                'amz-sdk-invocation-id': `${uuidv4()}`,
            };

            // 当 model 以 kiro-amazonq 开头时，使用 amazonQUrl，否则使用 baseUrl
            const requestUrl = model.startsWith('amazonq') ? this.amazonQUrl : this.baseUrl;
            const response = await this.axiosInstance.post(requestUrl, requestData, { headers });
            return response;
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            // Handle 401 (Unauthorized) - refresh UUID first, then try to refresh token
            if (status === 401 && !isRetry) {
                logger.info('[Kiro] Received 401. Refreshing UUID and triggering background refresh via PoolManager...');
                
                // 1. 先刷新 UUID
                const newUuid = this._refreshUuid();
                if (newUuid) {
                    logger.info(`[Kiro] UUID refreshed: ${this.uuid} -> ${newUuid}`);
                    this.uuid = newUuid;
                }
                
                // 标记当前凭证为不健康（会自动进入刷新队列）
                this._markCredentialNeedRefresh('401 Unauthorized - Triggering auto-refresh');
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }
    
            // Handle 402 (Payment Required / Quota Exceeded) - verify usage and mark as unhealthy with recovery time
            if (status === 402 && !isRetry) {
                await this._handle402Error(error, 'callApi');
            }

            // Handle 403 (Forbidden) - mark as unhealthy immediately, no retry
            if (status === 403 && !isRetry) {
                logger.info('[Kiro] Received 403. Marking credential as need refresh...');
                
                // 检查是否为 temporarily suspended 错误
                const isSuspended = errorMessage && errorMessage.toLowerCase().includes('temporarily is suspended');
                
                if (isSuspended) {
                    // temporarily suspended 错误：直接标记为不健康，不刷新 UUID
                    logger.info('[Kiro] Account temporarily suspended. Marking as unhealthy without UUID refresh...');
                    this._markCredentialUnhealthy('403 Forbidden - Account temporarily suspended', error);
                } else {
                    // 其他 403 错误：先刷新 UUID，然后标记需要刷新
                    // const newUuid = this._refreshUuid();
                    // if (newUuid) {
                    //     logger.info(`[Kiro] UUID refreshed: ${this.uuid} -> ${newUuid}`);
                    //     this.uuid = newUuid;
                    // }
                    this._markCredentialNeedRefresh('403 Forbidden', error);
                }
                
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }
            
            // Handle 429 (Too Many Requests) - wait baseDelay then switch credential
            if (status === 429) {
                logger.info(`[Kiro] Received 429 (Too Many Requests). Waiting ${baseDelay}ms before switching credential...`);
                await new Promise(resolve => setTimeout(resolve, baseDelay));
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            // Handle 5xx server errors - wait baseDelay then switch credential
            if (status >= 500 && status < 600) {
                logger.info(`[Kiro] Received ${status} server error. Waiting ${baseDelay}ms before switching credential...`);
                await new Promise(resolve => setTimeout(resolve, baseDelay));
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                logger.info(`[Kiro] Network error (${errorIdentifier}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, model, body, isRetry, retryCount + 1);
            }

            logger.error(`[Kiro] API call failed (Status: ${status}, Code: ${errorCode}):`, error.message);
            throw error;
        }
    }

    /**
     * Helper method to refresh the current credential's UUID
     * Used when encountering 401 errors to get a fresh identity
     * @returns {string|null} - The new UUID, or null if refresh failed
     * @private
     */
    _refreshUuid() {
        const poolManager = getProviderPoolManager();
        if (poolManager && this.uuid) {
            const newUuid = poolManager.refreshProviderUuid(MODEL_PROVIDER.KIRO_API, {
                uuid: this.uuid
            });
            return newUuid;
        } else {
            logger.warn(`[Kiro] Cannot refresh UUID: poolManager=${!!poolManager}, uuid=${this.uuid}`);
            return null;
        }
    }

    /**
     * Helper method to mark the current credential as unhealthy
     * @param {string} reason - The reason for marking unhealthy
     * @param {Error} [error] - Optional error object to attach the marker to
     * @returns {boolean} - Whether the credential was successfully marked as unhealthy
     * @private
     */
    _markCredentialNeedRefresh(reason, error = null) {
        const poolManager = getProviderPoolManager();
        if (poolManager && this.uuid) {
            logger.info(`[Kiro] Marking credential ${this.uuid} as needs refresh. Reason: ${reason}`);
            // 使用新的 markProviderNeedRefresh 方法代替 markProviderUnhealthyImmediately
            poolManager.markProviderNeedRefresh(MODEL_PROVIDER.KIRO_API, {
                uuid: this.uuid
            });
            // Attach marker to error object to prevent duplicate marking in upper layers
            if (error) {
                error.credentialMarkedUnhealthy = true;
            }
            return true;
        } else {
            logger.warn(`[Kiro] Cannot mark credential as unhealthy: poolManager=${!!poolManager}, uuid=${this.uuid}`);
            return false;
        }
    }
    
    /**
     * Helper method to mark the current credential as unhealthy
     * @param {string} reason - The reason for marking unhealthy
     * @param {Error} [error] - Optional error object to attach the marker to
     * @returns {boolean} - Whether the credential was successfully marked as unhealthy
     * @private
     */
    _markCredentialUnhealthy(reason, error = null) {
        const poolManager = getProviderPoolManager();
        if (poolManager && this.uuid) {
            logger.info(`[Kiro] Marking credential ${this.uuid} as unhealthy. Reason: ${reason}`);
            poolManager.markProviderUnhealthyImmediately(MODEL_PROVIDER.KIRO_API, {
                uuid: this.uuid
            }, reason);
            // Attach marker to error object to prevent duplicate marking in upper layers
            if (error) {
                error.credentialMarkedUnhealthy = true;
            }
            return true;
        } else {
            logger.warn(`[Kiro] Cannot mark credential as unhealthy: poolManager=${!!poolManager}, uuid=${this.uuid}`);
            return false;
        }
    }

    /**
     * Helper method to mark the current credential as unhealthy with a scheduled recovery time
     * Used for quota exhaustion (402) where quota resets at a specific time (e.g., 1st of next month)
     * @param {string} reason - The reason for marking unhealthy
     * @param {Error} [error] - Optional error object to attach the marker to
     * @param {Date} [recoveryTime] - The time when the credential should be marked healthy again
     * @returns {boolean} - Whether the credential was successfully marked as unhealthy
     * @private
     */
    _markCredentialUnhealthyWithRecovery(reason, error = null, recoveryTime = null) {
        const poolManager = getProviderPoolManager();
        if (poolManager && this.uuid) {
            logger.info(`[Kiro] Marking credential ${this.uuid} as unhealthy with recovery time. Reason: ${reason}, Recovery: ${recoveryTime?.toISOString()}`);
            poolManager.markProviderUnhealthyWithRecoveryTime(MODEL_PROVIDER.KIRO_API, {
                uuid: this.uuid
            }, reason, recoveryTime);
            // Attach marker to error object to prevent duplicate marking in upper layers
            if (error) {
                error.credentialMarkedUnhealthy = true;
            }
            return true;
        } else {
            logger.warn(`[Kiro] Cannot mark credential as unhealthy: poolManager=${!!poolManager}, uuid=${this.uuid}`);
            return false;
        }
    }

    /**
     * 计算下月1日 00:00:00 UTC 时间
     * @returns {Date} 下月1日的 Date 对象
     * @private
     */
    _getNextMonthFirstDay() {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    }

    /**
     * 处理 402 错误（配额耗尽）
     * 验证用量限制并标记凭证为不健康，设置恢复时间为下月1日
     * @param {Error} error - 原始错误对象
     * @param {string} context - 错误发生的上下文（如 'callApi', 'stream'）
     * @throws {Error} 抛出带有切换凭证标记的错误
     * @private
     */
    async _handle402Error(error, context = 'unknown') {
        logger.info(`[Kiro] Received 402 (Quota Exceeded) in ${context}. Verifying usage limits...`);
        try {
            // Verify usage limits to confirm quota exhaustion
            const usageLimits = await this.getUsageLimits();
            const isQuotaExhausted = usageLimits?.usedCount >= usageLimits?.limitCount;
            
            logger.info(`[Kiro] Quota confirmed exhausted: ${usageLimits?.usedCount}/${usageLimits?.limitCount}`);
            // Calculate recovery time: 1st day of next month at 00:00:00 UTC
            const nextMonth = this._getNextMonthFirstDay();
            this._markCredentialUnhealthyWithRecovery('402 Payment Required - Quota Exhausted', error, nextMonth);
        } catch (usageError) {
            logger.warn('[Kiro] Failed to verify usage limits:', usageError.message);
            // If we can't verify, still mark as unhealthy with recovery time
            const nextMonth = this._getNextMonthFirstDay();
            this._markCredentialUnhealthyWithRecovery('402 Payment Required - Quota Exceeded (unverified)', error, nextMonth);
        }
        // Mark error for credential switch without recording error count
        error.shouldSwitchCredential = true;
        error.skipErrorCount = true;
        throw error;
    }

    _processApiResponse(response) {
        const rawResponseText = Buffer.isBuffer(response.data) ? response.data.toString('utf8') : String(response.data);
        //logger.info(`[Kiro] Raw response length: ${rawResponseText.length}`);
        if (rawResponseText.includes("[Called")) {
            logger.info("[Kiro] Raw response contains [Called marker.");
        }

        // 1. Parse structured events and bracket calls from parsed content
        const parsedFromEvents = this.parseEventStreamChunk(rawResponseText);
        let fullResponseText = parsedFromEvents.content;
        let allToolCalls = [...parsedFromEvents.toolCalls]; // clone
        //logger.info(`[Kiro] Found ${allToolCalls.length} tool calls from event stream parsing.`);

        // 2. Crucial fix from Python example: Parse bracket tool calls from the original raw response
        const rawBracketToolCalls = parseBracketToolCalls(rawResponseText);
        if (rawBracketToolCalls) {
            //logger.info(`[Kiro] Found ${rawBracketToolCalls.length} bracket tool calls in raw response.`);
            allToolCalls.push(...rawBracketToolCalls);
        }

        // 3. Deduplicate all collected tool calls
        const uniqueToolCalls = deduplicateToolCalls(allToolCalls);
        //logger.info(`[Kiro] Total unique tool calls after deduplication: ${uniqueToolCalls.length}`);

        // 4. Clean up response text by removing all tool call syntax from the final text.
        // The text from parseEventStreamChunk is already partially cleaned.
        // We re-clean here with all unique tool calls to be certain.
        if (uniqueToolCalls.length > 0) {
            for (const tc of uniqueToolCalls) {
                const funcName = tc.function.name;
                const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`\\[Called\\s+${escapedName}\\s+with\\s+args:\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}\\]`, 'gs');
                fullResponseText = fullResponseText.replace(pattern, '');
            }
            fullResponseText = fullResponseText.replace(/\s+/g, ' ').trim();
        }
        
        //logger.info(`[Kiro] Final response text after tool call cleanup: ${fullResponseText}`);
        //logger.info(`[Kiro] Final tool calls after deduplication: ${JSON.stringify(uniqueToolCalls)}`);
        return { responseText: fullResponseText, toolCalls: uniqueToolCalls };
    }

    async generateContent(model, requestBody) {
        if (!this.isInitialized) await this.initialize();

        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        
        // 检查 token 是否即将过期，如果是则推送到刷新队列
        if (this.isExpiryDateNear()) {
            logger.info('[Kiro] Token is near expiry, marking credential as need refresh...');
            this._markCredentialNeedRefresh('Token near expiry in generateContent');
        }
        
        const finalModel = MODEL_MAPPING[model] ? model : this.modelName;
        logger.info(`[Kiro] Calling generateContent with model: ${finalModel}`);
        
        // Estimate input tokens before making the API call
        const inputTokens = this.estimateInputTokens(requestBody);
        
        const response = await this.callApi('', finalModel, requestBody);

        try {
            const { responseText, toolCalls } = this._processApiResponse(response);
            return this.buildClaudeResponse(responseText, false, 'assistant', model, toolCalls, inputTokens);
        } catch (error) {
            logger.error('[Kiro] Error in generateContent:', error);
            throw new Error(`Error processing response: ${error.message}`);
        }
    }

    /**
     * 解析 AWS Event Stream 格式，提取所有完整的 JSON 事件
     * 返回 { events: 解析出的事件数组, remaining: 未处理完的缓冲区 }
     */
    parseAwsEventStreamBuffer(buffer) {
        const events = [];
        let remaining = buffer;
        let searchStart = 0;
        
        while (true) {
            // 查找真正的 JSON payload 起始位置
            // AWS Event Stream 包含二进制头部，我们只搜索有效的 JSON 模式
            // Kiro 返回格式: {"content":"..."} 或 {"name":"xxx","toolUseId":"xxx",...} 或 {"followupPrompt":"..."}
            
            // 搜索所有可能的 JSON payload 开头模式
            // Kiro 返回的 toolUse 可能分多个事件：
            // 1. {"name":"xxx","toolUseId":"xxx"} - 开始
            // 2. {"input":"..."} - input 数据（可能多次）
            // 3. {"stop":true} - 结束
            // 4. {"contextUsagePercentage":...} - 上下文使用百分比（最后一条消息）
            const contentStart = remaining.indexOf('{"content":', searchStart);
            const nameStart = remaining.indexOf('{"name":', searchStart);
            const followupStart = remaining.indexOf('{"followupPrompt":', searchStart);
            const inputStart = remaining.indexOf('{"input":', searchStart);
            const stopStart = remaining.indexOf('{"stop":', searchStart);
            const contextUsageStart = remaining.indexOf('{"contextUsagePercentage":', searchStart);
            
            // 找到最早出现的有效 JSON 模式
            const candidates = [contentStart, nameStart, followupStart, inputStart, stopStart, contextUsageStart].filter(pos => pos >= 0);
            if (candidates.length === 0) break;
            
            const jsonStart = Math.min(...candidates);
            if (jsonStart < 0) break;
            
            // 正确处理嵌套的 {} - 使用括号计数法
            let braceCount = 0;
            let jsonEnd = -1;
            let inString = false;
            let escapeNext = false;
            
            for (let i = jsonStart; i < remaining.length; i++) {
                const char = remaining[i];
                
                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }
                
                if (char === '\\') {
                    escapeNext = true;
                    continue;
                }
                
                if (char === '"') {
                    inString = !inString;
                    continue;
                }
                
                if (!inString) {
                    if (char === '{') {
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            jsonEnd = i;
                            break;
                        }
                    }
                }
            }
            
            if (jsonEnd < 0) {
                // 不完整的 JSON，保留在缓冲区等待更多数据
                remaining = remaining.substring(jsonStart);
                break;
            }
            
            const jsonStr = remaining.substring(jsonStart, jsonEnd + 1);
            try {
                const parsed = JSON.parse(jsonStr);
                // 处理 content 事件
                if (parsed.content !== undefined && !parsed.followupPrompt) {
                    // 处理转义字符
                    let decodedContent = parsed.content;
                    // 无须处理转义的换行符，原来要处理是因为智能体返回的 content 需要通过换行符切割不同的json
                    // decodedContent = decodedContent.replace(/(?<!\\)\\n/g, '\n');
                    events.push({ type: 'content', data: decodedContent });
                }
                // 处理结构化工具调用事件 - 开始事件（包含 name 和 toolUseId）
                else if (parsed.name && parsed.toolUseId) {
                    events.push({ 
                        type: 'toolUse', 
                        data: {
                            name: parsed.name,
                            toolUseId: parsed.toolUseId,
                            input: parsed.input || '',
                            stop: parsed.stop || false
                        }
                    });
                }
                // 处理工具调用的 input 续传事件（只有 input 字段）
                else if (parsed.input !== undefined && !parsed.name) {
                    events.push({
                        type: 'toolUseInput',
                        data: {
                            input: parsed.input
                        }
                    });
                }
                // 处理工具调用的结束事件（只有 stop 字段，且不包含 contextUsagePercentage）
                else if (parsed.stop !== undefined && parsed.contextUsagePercentage === undefined) {
                    events.push({
                        type: 'toolUseStop',
                        data: {
                            stop: parsed.stop
                        }
                    });
                }
                // 处理上下文使用百分比事件（最后一条消息）
                else if (parsed.contextUsagePercentage !== undefined) {
                    events.push({
                        type: 'contextUsage',
                        data: {
                            contextUsagePercentage: parsed.contextUsagePercentage
                        }
                    });
                }
            } catch (e) {
                // JSON 解析失败，跳过这个位置继续搜索
            }
            
            searchStart = jsonEnd + 1;
            if (searchStart >= remaining.length) {
                remaining = '';
                break;
            }
        }
        
        // 如果 searchStart 有进展，截取剩余部分
        if (searchStart > 0 && remaining.length > 0) {
            remaining = remaining.substring(searchStart);
        }
        
        return { events, remaining };
    }

    /**
     * 真正的流式 API 调用 - 使用 responseType: 'stream'
     */
    async * streamApiReal(method, model, body, isRetry = false, retryCount = 0) {
        if (!this.isInitialized) await this.initialize();
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        // 处理不同格式的请求体（messages 或 contents）
        let messages = body.messages;
        if (!messages && body.contents) {
            // 将 Gemini 格式的 contents 转换为 messages 格式
            messages = body.contents.map(content => ({
                role: content.role || 'user',
                content: content.parts?.map(part => part.text).join('') || ''
            }));
        }
        
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            throw new Error('No messages found in request body');
        }

        const requestData = await this.buildCodewhispererRequest(messages, model, body.tools, body.system, body.thinking);

        const token = this.accessToken;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'amz-sdk-invocation-id': `${uuidv4()}`,
        };

        const requestUrl = model.startsWith('amazonq') ? this.amazonQUrl : this.baseUrl;

        let stream = null;
        try {
            const response = await this.axiosInstance.post(requestUrl, requestData, { 
                headers,
                responseType: 'stream'
            });

            stream = response.data;
            let buffer = '';
            let lastContentEvent = null;  // 用于检测连续重复的 content 事件

            for await (const chunk of stream) {
                buffer += chunk.toString();
                
                // 解析缓冲区中的事件
                const { events, remaining } = this.parseAwsEventStreamBuffer(buffer);
                buffer = remaining;
                
                // yield 所有事件，但过滤连续完全相同的 content 事件（Kiro API 有时会重复发送）
                for (const event of events) {
                    if (event.type === 'content' && event.data) {
                        // 检查是否与上一个 content 事件完全相同
                        if (lastContentEvent === event.data) {
                            // 跳过重复的内容
                            continue;
                        }
                        lastContentEvent = event.data;
                        yield { type: 'content', content: event.data };
                    } else if (event.type === 'toolUse') {
                        yield { type: 'toolUse', toolUse: event.data };
                    } else if (event.type === 'toolUseInput') {
                        yield { type: 'toolUseInput', input: event.data.input };
                    } else if (event.type === 'toolUseStop') {
                        yield { type: 'toolUseStop', stop: event.data.stop };
                    } else if (event.type === 'contextUsage') {
                        yield { type: 'contextUsage', contextUsagePercentage: event.data.contextUsagePercentage };
                    }
                }
            }
        } catch (error) {
            // 确保出错时关闭流
            if (stream && typeof stream.destroy === 'function') {
                stream.destroy();
            }
            
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            // Handle 401 (Unauthorized) - try to refresh token first
            if (status === 401 && !isRetry) {
                logger.info('[Kiro] Received 401 in stream. Triggering background refresh via PoolManager...');
                
                // 1. 先刷新 UUID
                const newUuid = this._refreshUuid();
                if (newUuid) {
                    logger.info(`[Kiro] UUID refreshed: ${this.uuid} -> ${newUuid}`);
                    this.uuid = newUuid;
                }
                // 标记当前凭证为不健康（会自动进入刷新队列）
                this._markCredentialNeedRefresh('401 Unauthorized in stream - Triggering auto-refresh');
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }
            
            // Handle 402 (Payment Required / Quota Exceeded) - verify usage and mark as unhealthy with recovery time
            if (status === 402 && !isRetry) {
                await this._handle402Error(error, 'stream');
            }

            // Handle 403 (Forbidden) - mark as unhealthy immediately, no retry
            if (status === 403 && !isRetry) {
                logger.info('[Kiro] Received 403 in stream. Marking credential as need refresh...');
                
                // 检查是否为 temporarily suspended 错误
                const isSuspended = errorMessage && errorMessage.toLowerCase().includes('temporarily is suspended');
                
                if (isSuspended) {
                    // temporarily suspended 错误：直接标记为不健康，不刷新 UUID
                    logger.info('[Kiro] Account temporarily suspended in stream. Marking as unhealthy without UUID refresh...');
                    this._markCredentialUnhealthy('403 Forbidden - Account temporarily suspended', error);
                } else {
                    // 其他 403 错误：先刷新 UUID，然后标记需要刷新
                    // const newUuid = this._refreshUuid();
                    // if (newUuid) {
                    //     logger.info(`[Kiro] UUID refreshed: ${this.uuid} -> ${newUuid}`);
                    //     this.uuid = newUuid;
                    // }
                    this._markCredentialNeedRefresh('403 Forbidden', error);
                }

                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }
            
            // Handle 429 (Too Many Requests) - wait baseDelay then switch credential
            if (status === 429) {
                logger.info(`[Kiro] Received 429 (Too Many Requests) in stream. Waiting ${baseDelay}ms before switching credential...`);
                await new Promise(resolve => setTimeout(resolve, baseDelay));
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            // Handle 5xx server errors - wait baseDelay then switch credential
            if (status >= 500 && status < 600) {
                logger.info(`[Kiro] Received ${status} server error in stream. Waiting ${baseDelay}ms before switching credential...`);
                await new Promise(resolve => setTimeout(resolve, baseDelay));
                // Mark error for credential switch without recording error count
                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            // Handle network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
            if (isNetworkError && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                logger.info(`[Kiro] Network error (${errorIdentifier}) in stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApiReal(method, model, body, isRetry, retryCount + 1);
                return;
            }

            logger.error(`[Kiro] Stream API call failed (Status: ${status}, Code: ${errorCode}):`, error.message);
            throw error;
        } finally {
            // 确保流被关闭，释放资源
            if (stream && typeof stream.destroy === 'function') {
                stream.destroy();
            }
        }
    }

    // 保留旧的非流式方法用于 generateContent
    async streamApi(method, model, body, isRetry = false, retryCount = 0) {
        try {
            return await this.callApi(method, model, body, isRetry, retryCount);
        } catch (error) {
            logger.error('[Kiro] Error calling API:', error);
            throw error;
        }
    }

    // 真正的流式传输实现
    async * generateContentStream(model, requestBody) {
        if (!this.isInitialized) await this.initialize();

        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        
        // 检查 token 是否即将过期，如果是则推送到刷新队列
        if (this.isExpiryDateNear()) {
            logger.info('[Kiro] Token is near expiry, marking credential as need refresh...');
            this._markCredentialNeedRefresh('Token near expiry in generateContentStream');
        }
        
        const finalModel = MODEL_MAPPING[model] ? model : this.modelName;
        logger.info(`[Kiro] Calling generateContentStream with model: ${finalModel} (real streaming)`);

        let inputTokens = 0;
        let contextUsagePercentage = null;
        const messageId = `${uuidv4()}`;

        const thinkingRequested = requestBody?.thinking?.type === 'enabled';

        const streamState = {
            thinkingRequested,
            buffer: '',
            inThinking: false,
            thinkingExtracted: false,
            thinkingBlockIndex: null,
            textBlockIndex: null,
            nextBlockIndex: 0,
            stoppedBlocks: new Set(),
        };

        const ensureBlockStart = (blockType) => {
            if (blockType === 'thinking') {
                if (streamState.thinkingBlockIndex != null) return [];
                const idx = streamState.nextBlockIndex++;
                streamState.thinkingBlockIndex = idx;
                return [{
                    type: "content_block_start",
                    index: idx,
                    content_block: { type: "thinking", thinking: "" }
                }];
            }
            if (blockType === 'text') {
                if (streamState.textBlockIndex != null) return [];
                const idx = streamState.nextBlockIndex++;
                streamState.textBlockIndex = idx;
                return [{
                    type: "content_block_start",
                    index: idx,
                    content_block: { type: "text", text: "" }
                }];
            }
            return [];
        };

        const stopBlock = (index) => {
            if (index == null) return [];
            if (streamState.stoppedBlocks.has(index)) return [];
            streamState.stoppedBlocks.add(index);
            return [{ type: "content_block_stop", index }];
        };

        const createTextDeltaEvents = (text) => {
            if (!text) return [];
            const events = [];
            events.push(...ensureBlockStart('text'));
            events.push({
                type: "content_block_delta",
                index: streamState.textBlockIndex,
                delta: { type: "text_delta", text }
            });
            return events;
        };

        const createThinkingDeltaEvents = (thinking) => {
            const events = [];
            events.push(...ensureBlockStart('thinking'));
            events.push({
                type: "content_block_delta",
                index: streamState.thinkingBlockIndex,
                delta: { type: "thinking_delta", thinking }
            });
            return events;
        };

        function* pushEvents(events) {
            for (const ev of events) {
                yield ev;
            }
        }

        try {
            let totalContent = '';
            let outputTokens = 0;
            const toolCalls = [];
            let currentToolCall = null; // 用于累积结构化工具调用

            const estimatedInputTokens = this.estimateInputTokens(requestBody);

            // 1. 先发送 message_start 事件
            yield {
                type: "message_start",
                message: {
                    id: messageId,
                    type: "message",
                    role: "assistant",
                    model: model,
                    usage: {
                        input_tokens: estimatedInputTokens,
                        output_tokens: 0,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0
                    },
                    content: []
                }
            };

            // 2. 流式接收并发送每个 content_block_delta
            for await (const event of this.streamApiReal('', finalModel, requestBody)) {
                if (event.type === 'contextUsage' && event.contextUsagePercentage) {
                    // 捕获上下文使用百分比（包含输入和输出的总使用量）
                    contextUsagePercentage = event.contextUsagePercentage;
                } else if (event.type === 'content' && event.content) {
                    totalContent += event.content;

                    if (!thinkingRequested) {
                        yield* pushEvents(createTextDeltaEvents(event.content));
                        continue;
                    }

                    streamState.buffer += event.content;
                    const events = [];

                    while (streamState.buffer.length > 0) {
                        if (!streamState.inThinking && !streamState.thinkingExtracted) {
                            const startPos = findRealTag(streamState.buffer, KIRO_THINKING.START_TAG);
                            if (startPos !== -1) {
                                const before = streamState.buffer.slice(0, startPos);
                                if (before) events.push(...createTextDeltaEvents(before));

                                streamState.buffer = streamState.buffer.slice(startPos + KIRO_THINKING.START_TAG.length);
                                streamState.inThinking = true;
                                continue;
                            }

                            const safeLen = Math.max(0, streamState.buffer.length - KIRO_THINKING.START_TAG.length);
                            if (safeLen > 0) {
                                const safeText = streamState.buffer.slice(0, safeLen);
                                if (safeText) events.push(...createTextDeltaEvents(safeText));
                                streamState.buffer = streamState.buffer.slice(safeLen);
                            }
                            break;
                        }

                        if (streamState.inThinking) {
                            const endPos = findRealTag(streamState.buffer, KIRO_THINKING.END_TAG);
                            if (endPos !== -1) {
                                const thinkingPart = streamState.buffer.slice(0, endPos);
                                if (thinkingPart) events.push(...createThinkingDeltaEvents(thinkingPart));

                                streamState.buffer = streamState.buffer.slice(endPos + KIRO_THINKING.END_TAG.length);
                                streamState.inThinking = false;
                                streamState.thinkingExtracted = true;

                                events.push(...createThinkingDeltaEvents(""));
                                events.push(...stopBlock(streamState.thinkingBlockIndex));

                                if (streamState.buffer.startsWith('\n\n')) {
                                    streamState.buffer = streamState.buffer.slice(2);
                                }
                                continue;
                            }

                            const safeLen = Math.max(0, streamState.buffer.length - KIRO_THINKING.END_TAG.length);
                            if (safeLen > 0) {
                                const safeThinking = streamState.buffer.slice(0, safeLen);
                                if (safeThinking) events.push(...createThinkingDeltaEvents(safeThinking));
                                streamState.buffer = streamState.buffer.slice(safeLen);
                            }
                            break;
                        }

                        if (streamState.thinkingExtracted) {
                            const rest = streamState.buffer;
                            streamState.buffer = '';
                            if (rest) events.push(...createTextDeltaEvents(rest));
                            break;
                        }
                    }

                    yield* pushEvents(events);
                } else if (event.type === 'toolUse') {
                    const tc = event.toolUse;
                    // 统计工具调用的内容到 totalContent（用于 token 计算）
                    if (tc.name) {
                        totalContent += tc.name;
                    }
                    if (tc.input) {
                        totalContent += tc.input;
                    }
                    // 工具调用事件（包含 name 和 toolUseId）
                    if (tc.name && tc.toolUseId) {
                        // 检查是否是同一个工具调用的续传（相同 toolUseId）
                        if (currentToolCall && currentToolCall.toolUseId === tc.toolUseId) {
                            // 同一个工具调用，累积 input
                            currentToolCall.input += tc.input || '';
                        } else {
                            // 不同的工具调用
                            // 如果有未完成的工具调用，先保存它
                            if (currentToolCall) {
                                try {
                                    currentToolCall.input = JSON.parse(currentToolCall.input);
                                } catch (e) {
                                    // input 不是有效 JSON，保持原样
                                }
                                toolCalls.push(currentToolCall);
                            }
                            // 开始新的工具调用
                            currentToolCall = {
                                toolUseId: tc.toolUseId,
                                name: tc.name,
                                input: tc.input || ''
                            };
                        }
                        // 如果这个事件包含 stop，完成工具调用
                        if (tc.stop) {
                            try {
                                currentToolCall.input = JSON.parse(currentToolCall.input);
                            } catch (e) {}
                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }
                    }
                } else if (event.type === 'toolUseInput') {
                    // 工具调用的 input 续传事件
                    // 统计 input 内容到 totalContent（用于 token 计算）
                    if (event.input) {
                        totalContent += event.input;
                    }
                    if (currentToolCall) {
                        currentToolCall.input += event.input || '';
                    }
                } else if (event.type === 'toolUseStop') {
                    // 工具调用结束事件
                    if (currentToolCall && event.stop) {
                        try {
                            currentToolCall.input = JSON.parse(currentToolCall.input);
                        } catch (e) {
                            // input 不是有效 JSON，保持原样
                        }
                        toolCalls.push(currentToolCall);
                        currentToolCall = null;
                    }
                }
            }
            
            // 处理未完成的工具调用（如果流提前结束）
            if (currentToolCall) {
                try {
                    currentToolCall.input = JSON.parse(currentToolCall.input);
                } catch (e) {}
                toolCalls.push(currentToolCall);
                currentToolCall = null;
            }

            if (thinkingRequested && streamState.buffer) {
                if (streamState.inThinking) {
                    logger.warn('[Kiro] Incomplete thinking tag at stream end');
                    yield* pushEvents(createThinkingDeltaEvents(streamState.buffer));
                    streamState.buffer = '';
                    yield* pushEvents(createThinkingDeltaEvents(""));
                    yield* pushEvents(stopBlock(streamState.thinkingBlockIndex));
                } else if (!streamState.thinkingExtracted) {
                    yield* pushEvents(createTextDeltaEvents(streamState.buffer));
                    streamState.buffer = '';
                } else {
                    yield* pushEvents(createTextDeltaEvents(streamState.buffer));
                    streamState.buffer = '';
                }
            }

            yield* pushEvents(stopBlock(streamState.textBlockIndex));

            // 检查文本内容中的 bracket 格式工具调用
            const bracketToolCalls = parseBracketToolCalls(totalContent);
            if (bracketToolCalls && bracketToolCalls.length > 0) {
                for (const btc of bracketToolCalls) {
                    toolCalls.push({
                        toolUseId: btc.id || `tool_${uuidv4()}`,
                        name: btc.function.name,
                        input: JSON.parse(btc.function.arguments || '{}')
                    });
                }
            }

            // 3. 处理工具调用（如果有）
            if (toolCalls.length > 0) {
                const baseIndex = streamState.nextBlockIndex;
                for (let i = 0; i < toolCalls.length; i++) {
                    const tc = toolCalls[i];
                    const blockIndex = baseIndex + i;

                    yield {
                        type: "content_block_start",
                        index: blockIndex,
                        content_block: {
                            type: "tool_use",
                            id: tc.toolUseId || `tool_${uuidv4()}`,
                            name: tc.name,
                            input: {}
                        }
                    };
                    
                    yield {
                        type: "content_block_delta",
                        index: blockIndex,
                        delta: {
                            type: "input_json_delta",
                            partial_json: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || {})
                        }
                    };
                    
                    yield { type: "content_block_stop", index: blockIndex };
                }
            }

            // 计算 output tokens
            const contentBlocksForCount = thinkingRequested
                ? this._toClaudeContentBlocksFromKiroText(totalContent)
                : [{ type: "text", text: totalContent }];
            const plainForCount = contentBlocksForCount
                .map(b => (b.type === 'thinking' ? (b.thinking ?? '') : (b.text ?? '')))
                .join('');
            outputTokens = this.countTextTokens(plainForCount);

            for (const tc of toolCalls) {
                outputTokens += this.countTextTokens(JSON.stringify(tc.input || {}));
            }

            // 计算 input tokens
            // contextUsagePercentage 是包含输入和输出的总使用量百分比
            // 总 token = TOTAL_CONTEXT_TOKENS * contextUsagePercentage / 100
            // input token = 总 token - output token
            if (contextUsagePercentage !== null && contextUsagePercentage > 0) {
                const totalTokens = Math.round(KIRO_CONSTANTS.TOTAL_CONTEXT_TOKENS * contextUsagePercentage / 100);
                inputTokens = Math.max(0, totalTokens - outputTokens);
                logger.info(`[Kiro] Token calculation from contextUsagePercentage: total=${totalTokens}, output=${outputTokens}, input=${inputTokens}`);
            } else {
                logger.warn('[Kiro Stream] contextUsagePercentage not received, using estimation');
                inputTokens = estimatedInputTokens;
            }

            // 4. 发送 message_delta 事件
            yield {
                type: "message_delta",
                delta: { stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn" },
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0
                }
            };

            // 5. 发送 message_stop 事件
            yield { type: "message_stop" };

        } catch (error) {
            logger.error('[Kiro] Error in streaming generation:', error);
            throw new Error(`Error processing response: ${error.message}`);
        }
    }

    /**
     * Count tokens for a given text using Claude's official tokenizer
     */
    countTextTokens(text) {
        if (!text) return 0;
        try {
            return countTokens(text);
        } catch (error) {
            // Fallback to estimation if tokenizer fails
            logger.warn('[Kiro] Tokenizer error, falling back to estimation:', error.message);
            return Math.ceil((text || '').length / 4);
        }
    }

    /**
     * Calculate input tokens from request body using Claude's official tokenizer
     */
    estimateInputTokens(requestBody) {
        let allText = "";
        
        // Count system prompt tokens
        if (requestBody.system) {
            allText += this.processContent(requestBody.system);
        }
        
        // Count thinking prefix tokens if thinking is enabled
        if (requestBody.thinking?.type === 'enabled') {
            const budget = this._normalizeThinkingBudgetTokens(requestBody.thinking.budget_tokens);
            allText += `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>`;
        }
        
        // Count all messages tokens
        if (requestBody.messages && Array.isArray(requestBody.messages)) {
            for (const message of requestBody.messages) {
                if (message.content) {
                    allText += this.processContent(message.content);
                }
            }
        }
        
        // Count tools definitions tokens if present
        if (requestBody.tools && Array.isArray(requestBody.tools)) {
            allText += JSON.stringify(requestBody.tools);
        }
        
        return this.countTextTokens(allText);
    }

    /**
     * Build Claude compatible response object
     */
    buildClaudeResponse(content, isStream = false, role = 'assistant', model, toolCalls = null, inputTokens = 0) {
        const messageId = `${uuidv4()}`;

        if (isStream) {
            // Kiro API is "pseudo-streaming", so we'll send a few events to simulate
            // a full Claude stream, but the content/tool_calls will be sent in one go.
            const events = [];

            // 1. message_start event
            events.push({
                type: "message_start",
                message: {
                    id: messageId,
                    type: "message",
                    role: role,
                    model: model,
                    usage: {
                        input_tokens: inputTokens,
                        output_tokens: 0 // Will be updated in message_delta
                    },
                    content: [] // Content will be streamed via content_block_delta
                }
            });
 
            let totalOutputTokens = 0;
            let stopReason = "end_turn";

            if (content) {
                // If there are tool calls AND content, the content block index should be after tool calls
                const contentBlockIndex = (toolCalls && toolCalls.length > 0) ? toolCalls.length : 0;

                // 2. content_block_start for text
                events.push({
                    type: "content_block_start",
                    index: contentBlockIndex,
                    content_block: {
                        type: "text",
                        text: "" // Initial empty text
                    }
                });
                // 3. content_block_delta for text
                events.push({
                    type: "content_block_delta",
                    index: contentBlockIndex,
                    delta: {
                        type: "text_delta",
                        text: content
                    }
                });
                // 4. content_block_stop
                events.push({
                    type: "content_block_stop",
                    index: contentBlockIndex
                });
                totalOutputTokens += this.countTextTokens(content);
                // If there are tool calls, the stop reason remains "tool_use".
                // If only content, it's "end_turn".
                if (!toolCalls || toolCalls.length === 0) {
                    stopReason = "end_turn";
                }
            }

            if (toolCalls && toolCalls.length > 0) {
                toolCalls.forEach((tc, index) => {
                    let inputObject;
                    try {
                        // Arguments should be a stringified JSON object, need to parse it
                        const args = tc.function.arguments;
                        inputObject = typeof args === 'string' ? JSON.parse(args) : args;
                    } catch (e) {
                        logger.warn(`[Kiro] Invalid JSON for tool call arguments. Wrapping in raw_arguments. Error: ${e.message}`, tc.function.arguments);
                        // If parsing fails, wrap the raw string in an object as a fallback,
                        // since Claude's `input` field expects an object.
                        inputObject = { "raw_arguments": tc.function.arguments };
                    }
                    // 2. content_block_start for each tool_use
                    events.push({
                        type: "content_block_start",
                        index: index,
                        content_block: {
                            type: "tool_use",
                            id: tc.id,
                            name: tc.function.name,
                            input: {} // input is streamed via input_json_delta
                        }
                    });

                    // 3. content_block_delta for each tool_use
                    // Since Kiro is not truly streaming, we send the full arguments as one delta.
                    events.push({
                        type: "content_block_delta",
                        index: index,
                        delta: {
                            type: "input_json_delta",
                            partial_json: JSON.stringify(inputObject)
                        }
                    });

                    // 4. content_block_stop for each tool_use
                    events.push({
                        type: "content_block_stop",
                        index: index
                    });
                    totalOutputTokens += this.countTextTokens(JSON.stringify(inputObject));
                });
                stopReason = "tool_use"; // If there are tool calls, the stop reason is tool_use
            }

            // 5. message_delta with appropriate stop reason
            events.push({
                type: "message_delta",
                delta: {
                    stop_reason: stopReason,
                    stop_sequence: null,
                },
                usage: { output_tokens: totalOutputTokens }
            });

            // 6. message_stop event
            events.push({
                type: "message_stop"
            });

            return events; // Return an array of events for streaming
        } else {
            // Non-streaming response (full message object)
            const contentArray = [];
            let stopReason = "end_turn";
            let outputTokens = 0;

            if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    let inputObject;
                    try {
                        // Arguments should be a stringified JSON object, need to parse it
                        const args = tc.function.arguments;
                        inputObject = typeof args === 'string' ? JSON.parse(args) : args;
                    } catch (e) {
                        logger.warn(`[Kiro] Invalid JSON for tool call arguments. Wrapping in raw_arguments. Error: ${e.message}`, tc.function.arguments);
                        // If parsing fails, wrap the raw string in an object as a fallback,
                        // since Claude's `input` field expects an object.
                        inputObject = { "raw_arguments": tc.function.arguments };
                    }
                    contentArray.push({
                        type: "tool_use",
                        id: tc.id,
                        name: tc.function.name,
                        input: inputObject
                    });
                    outputTokens += this.countTextTokens(tc.function.arguments);
                }
                stopReason = "tool_use"; // Set stop_reason to "tool_use" when toolCalls exist
            } else if (content) {
                contentArray.push({
                    type: "text",
                    text: content
                });
                outputTokens += this.countTextTokens(content);
            }

            return {
                id: messageId,
                type: "message",
                role: role,
                model: model,
                stop_reason: stopReason,
                stop_sequence: null,
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: outputTokens
                },
                content: contentArray
            };
        }
    }

    /**
     * List available models
     */
    async listModels() {
        const models = KIRO_MODELS.map(id => ({
            name: id
        }));
        
        return { models: models };
    }

    /**
     * Checks if the token is completely expired (cannot be used at all).
     * @returns {boolean} - True if token is expired, false otherwise.
     */
    isTokenExpired() {
        try {
            if (!this.expiresAt) return true;
            const expirationTime = new Date(this.expiresAt);
            const currentTime = new Date();
            // 给 30 秒缓冲，避免请求过程中过期
            const bufferMs = 30 * 1000;
            return expirationTime.getTime() <= (currentTime.getTime() + bufferMs);
        } catch (error) {
            logger.error(`[Kiro] Error checking token expiry: ${error.message}`);
            return true; // Treat as expired if parsing fails
        }
    }

    /**
     * Checks if the given expiresAt timestamp is within 10 minutes from now (needs refresh soon).
     * @returns {boolean} - True if expiresAt is less than 10 minutes from now, false otherwise.
     */
    isExpiryDateNear() {
        try {
            const expirationTime = new Date(this.expiresAt);
            const nearMinutes = 30;
            const { message, isNearExpiry } = formatExpiryLog('Kiro', expirationTime.getTime(), nearMinutes);
            logger.info(message);
            return isNearExpiry;
        } catch (error) {
            logger.error(`[Kiro] Error checking expiry date: ${this.expiresAt}, Error: ${error.message}`);
            return false; // Treat as expired if parsing fails
        }
    }

    /**
     * 后台异步刷新 token（不阻塞当前请求）
     */
    triggerBackgroundRefresh() {
        logger.info('[Kiro] Background token refresh started...');
        this.initializeAuth(true).then(() => {
            logger.info('[Kiro] Background token refresh completed successfully');
        }).catch((error) => {
            logger.error('[Kiro] Background token refresh failed:', error.message);
            // 后台刷新失败不抛出错误，下次请求会重试
        });
    }

    /**
     * Count tokens for a message request (compatible with Anthropic API)
     * POST /v1/messages/count_tokens
     * @param {Object} requestBody - The request body containing model, messages, system, tools, etc.
     * @returns {Object} { input_tokens: number }
     */
    countTokens(requestBody) {
        let allText = "";
        let extraTokens = 0;

        // Count system prompt tokens
        if (requestBody.system) {
            allText += this.processContent(requestBody.system);
        }

        // Count all messages tokens
        if (requestBody.messages && Array.isArray(requestBody.messages)) {
            for (const message of requestBody.messages) {
                if (message.content) {
                    if (Array.isArray(message.content)) {
                        for (const block of message.content) {
                            if (block.type === 'image') {
                                // Images have a fixed token cost (approximately 1600 tokens for a typical image)
                                // This is an estimation as actual cost depends on image size
                                extraTokens += 1600;
                            } else if (block.type === 'document') {
                                // Documents - estimate based on content if available
                                if (block.source?.data) {
                                    // For base64 encoded documents, estimate tokens
                                    const estimatedChars = block.source.data.length * 0.75; // base64 to bytes ratio
                                    extraTokens += Math.ceil(estimatedChars / 4);
                                }
                            } else {
                                allText += this.processContent([block]);
                            }
                        }
                    } else {
                        allText += this.processContent(message.content);
                    }
                }
            }
        }

        // Count tools definitions tokens if present
        if (requestBody.tools && Array.isArray(requestBody.tools)) {
            allText += JSON.stringify(requestBody.tools);
        }

        return { input_tokens: this.countTextTokens(allText) + extraTokens };
    }

    /**
     * 获取用量限制信息
     * @returns {Promise<Object>} 用量限制信息
     */
    async getUsageLimits() {
        if (!this.isInitialized) await this.initialize();

        // Token 刷新策略：
        // 1. 已过期 → 必须等待刷新
        // 2. 即将过期但还能用 → 后台异步刷新，不阻塞当前请求
        // if (this.isTokenExpired()) {
        //     logger.info('[Kiro] Token is expired, must refresh before getUsageLimits request...');
        //     await this.initializeAuth(true);
        // } else if (this.isExpiryDateNear()) {
        //     logger.info('[Kiro] Token is near expiry, triggering background refresh...');
        //     this.triggerBackgroundRefresh();
        // }
        
        // 内部固定的资源类型
        const resourceType = 'AGENTIC_REQUEST';
        
        // 构建请求 URL
        let usageLimitsUrl = this.baseUrl;
        usageLimitsUrl = usageLimitsUrl.replace('generateAssistantResponse', 'getUsageLimits');
        const params = new URLSearchParams({
            isEmailRequired: 'true',
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
            resourceType: resourceType
        });
         if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL && this.profileArn) {
            params.append('profileArn', this.profileArn);
        }
        const fullUrl = `${usageLimitsUrl}?${params.toString()}`;

        // 动态生成 headers
        const machineId = generateMachineIdFromConfig({
            uuid: this.uuid,
            profileArn: this.profileArn,
            clientId: this.clientId
        });
        const kiroVersion = KIRO_CONSTANTS.KIRO_VERSION;
        const { osName, nodeVersion } = getSystemRuntimeInfo();

        const headers = {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-user-agent': `aws-sdk-js/1.0.0 KiroIDE-${kiroVersion}-${machineId}`,
            'user-agent': `aws-sdk-js/1.0.0 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererruntime#1.0.0 m/E KiroIDE-${kiroVersion}-${machineId}`,
            'amz-sdk-invocation-id': uuidv4(),
            'amz-sdk-request': 'attempt=1; max=1',
            'Connection': 'close'
        };

        try {
            const response = await this.axiosInstance.get(fullUrl, { headers });
            logger.info('[Kiro] Usage limits fetched successfully');
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            
            // 从响应体中提取错误信息
            let errorMessage = error.message;
            if (error.response?.data) {
                // 尝试从响应体中获取错误描述
                const responseData = error.response.data;
                if (typeof responseData === 'string') {
                    errorMessage = responseData;
                } else if (responseData.message) {
                    errorMessage = responseData.message;
                } else if (responseData.error) {
                    errorMessage = typeof responseData.error === 'string' ? responseData.error : responseData.error.message || JSON.stringify(responseData.error);
                }
            }
            
            // 构建包含状态码和错误描述的错误信息
            const formattedError = status
                ? new Error(`API call failed: ${status} - ${errorMessage}`)
                : new Error(`API call failed: ${errorMessage}`);
            
            // 对于用量查询，401/403 错误直接标记凭证为不健康，不重试
            if (status === 401) {
                logger.info('[Kiro] Received 401 on getUsageLimits. Marking credential as unhealthy (no retry)...');
                this._markCredentialNeedRefresh('401 Unauthorized on usage query', formattedError);
                throw formattedError;
            }
            
            if (status === 403) {
                logger.info('[Kiro] Received 403 on getUsageLimits. Marking credential as unhealthy (no retry)...');
                
                // 检查是否为 temporarily suspended 错误
                const isSuspended = errorMessage && errorMessage.toLowerCase().includes('temporarily is suspended');
                
                if (isSuspended) {
                    // temporarily suspended 错误：直接标记为不健康，不刷新 UUID
                    logger.info('[Kiro] Account temporarily suspended on usage query. Marking as unhealthy without UUID refresh...');
                    this._markCredentialUnhealthy('403 Forbidden - Account temporarily suspended on usage query', formattedError);
                } else {
                    // 其他 403 错误：标记需要刷新
                    this._markCredentialNeedRefresh('403 Forbidden on usage query', formattedError);
                }
                
                throw formattedError;
            }
            
            logger.error('[Kiro] Failed to fetch usage limits:', formattedError.message, error);
            throw formattedError;
        }
    }
}

