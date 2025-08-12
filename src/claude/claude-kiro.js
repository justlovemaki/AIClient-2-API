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
};

const MODEL_MAPPING = {
    "claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
    "claude-3-7-sonnet-20250219": "CLAUDE_3_7_SONNET_20250219_V1_0",
    "amazonq-claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
    "amazonq-claude-3-7-sonnet-20250219": "CLAUDE_3_7_SONNET_20250219_V1_0"
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

// Helper functions for tool calls
function findMatchingBracket(text, startPos) {
    if (!text || startPos >= text.length || text[startPos] !== '[') {
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
            if (char === '[') {
                bracketCount++;
            } else if (char === ']') {
                bracketCount--;
                if (bracketCount === 0) {
                    return i;
                }
            }
        }
    }
    return -1;
}

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
        // Simple repair for common issues like trailing commas or unquoted keys
        let repairedJson = jsonCandidate;
        // Remove trailing comma before closing brace/bracket
        repairedJson = repairedJson.replace(/,\s*([}\]])/g, '$1');
        // Add quotes to unquoted keys (basic attempt)
        repairedJson = repairedJson.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
        // Ensure string values are properly quoted if they contain special characters and are not already quoted
        repairedJson = repairedJson.replace(/:\s*([a-zA-Z0-9_]+)(?=[,\}\]])/g, ':"$1"');


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
        console.error(`Failed to parse tool call arguments: ${e.message}`, jsonCandidate);
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
            console.log(`Skipping duplicate tool call: ${tc.function.name}`);
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
        // this.accessToken = config.KIRO_ACCESS_TOKEN;
        // this.refreshToken = config.KIRO_REFRESH_TOKEN;
        // this.clientId = config.KIRO_CLIENT_ID;
        // this.clientSecret = config.KIRO_CLIENT_SECRET;
        // this.authMethod = KIRO_CONSTANTS.AUTH_METHOD_SOCIAL;
        // this.refreshUrl = KIRO_CONSTANTS.REFRESH_URL;
        // this.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL;
        // this.baseUrl = KIRO_CONSTANTS.BASE_URL;
        // this.amazonQUrl = KIRO_CONSTANTS.AMAZON_Q_URL;

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

        // Priority 3: Load from default directory only if no specific file path is configured
        if (!this.credsFilePath) {
            const dirPath = this.credPath;
            console.debug(`[Kiro Auth] Attempting to load credentials from directory: ${dirPath}`);
            try {
                const files = await fs.readdir(dirPath);
                for (const file of files) {
                    if (file.endsWith('.json') && file !== KIRO_AUTH_TOKEN_FILE) {
                        const filePath = path.join(dirPath, file);
                        const credentials = await loadCredentialsFromFile(filePath);
                        if (credentials) {
                            credentials.expiresAt = mergedCredentials.expiresAt;
                            Object.assign(mergedCredentials, credentials);
                            console.debug(`[Kiro Auth] Loaded credentials from ${file}`);
                        }
                    }
                }
            } catch (error) {
                console.debug(`[Kiro Auth] Could not read credential directory ${dirPath}: ${error.message}`);
            }
        } else {
            console.debug(`[Kiro Auth] Skipping directory scan because specific file path is configured: ${this.credsFilePath}`);
        }

        // console.log('[Kiro Auth] Merged credentials:', mergedCredentials);
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
            console.warn('[Kiro Auth] Region not found in credentials. Using default region us-east-1 for URLs.');
            this.region = 'us-east-1'; // Set default region
        }

        this.refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace("{{region}}", this.region);
        this.refreshIDCUrl = KIRO_CONSTANTS.REFRESH_IDC_URL.replace("{{region}}", this.region);
        this.baseUrl = KIRO_CONSTANTS.BASE_URL.replace("{{region}}", this.region);
        this.amazonQUrl = KIRO_CONSTANTS.AMAZON_Q_URL.replace("{{region}}", this.region);
    } catch (error) {
        console.warn(`[Kiro Auth] Error during credential loading: ${error.message}`);
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

                // Update the token file - use specified path if configured, otherwise use default
                const tokenFilePath = this.credsFilePath || path.join(this.credPath, KIRO_AUTH_TOKEN_FILE);
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
        if(message==null){
            return "";
        }
        if (Array.isArray(message) ) {
            return message
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text)
                .join('');
        } else if (typeof message.content === 'string') {
            return message.content;
        } else if (Array.isArray(message.content) ) {
            return message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text)
                .join('');
        } 
        return String(message.content || message);
    }

    /**
     * Build CodeWhisperer request from OpenAI messages
     */
    buildCodewhispererRequest(messages, model, tools = null, inSystemPrompt = null) {
        const conversationId = uuidv4();
        
        let systemPrompt = this.getContentText(inSystemPrompt);
        const processedMessages = messages;

        if (processedMessages.length === 0) {
            throw new Error('No user messages found');
        }

        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[this.modelName];
        
        let toolsContext = {};
        if (tools && Array.isArray(tools) && tools.length > 0) {
            toolsContext = {
                tools: tools.map(tool => ({
                    toolSpecification: {
                        name: tool.name,
                        description: tool.description || "",
                        inputSchema: { json: tool.input_schema || {} }
                    }
                }))
            };
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

        // Add remaining user/assistant messages to history
        for (let i = startIndex; i < processedMessages.length - 1; i++) {
            const message = processedMessages[i];
            if (message.role === 'user') {
                let userInputMessage = {
                    content: '',
                    modelId: codewhispererModel,
                    origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    userInputMessageContext: {}
                };
                if (Array.isArray(message.content)) {
                    userInputMessage.images = []; // Initialize images array
                    for (const part of message.content) {
                        if (part.type === 'text') {
                            userInputMessage.content += part.text;
                        } else if (part.type === 'tool_result') {
                            if (!userInputMessage.userInputMessageContext.toolResults) {
                                userInputMessage.userInputMessageContext.toolResults = [];
                            }
                            userInputMessage.userInputMessageContext.toolResults.push({
                                content: [{ text: this.getContentText(part.content) }],
                                status: 'success',
                                toolUseId: part.tool_use_id
                            });
                        } else if (part.type === 'image') {
                            userInputMessage.images.push({
                                format: part.source.media_type.split('/')[1],
                                source: {
                                    bytes: part.source.data
                                }
                            });
                        }
                    }
                } else {
                    userInputMessage.content = this.getContentText(message);
                }
                history.push({ userInputMessage });
            } else if (message.role === 'assistant') {
                let assistantResponseMessage = {
                    content: '',
                    toolUses: []
                };
                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part.type === 'text') {
                            assistantResponseMessage.content += part.text;
                        } else if (part.type === 'tool_use') {
                            assistantResponseMessage.toolUses.push({
                                input: part.input,
                                name: part.name,
                                toolUseId: part.id
                            });
                        }
                    }
                } else {
                    assistantResponseMessage.content = this.getContentText(message);
                }
                history.push({ assistantResponseMessage });
            }
        }

        // Build current message
        const currentMessage = processedMessages[processedMessages.length - 1];
        let currentContent = '';
        let currentToolResults = [];
        let currentToolUses = [];
        let currentImages = [];

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

        if (!currentContent && currentToolResults.length === 0 && currentToolUses.length === 0) {
            currentContent = 'Continue';
        }

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId: conversationId,
                currentMessage: {}, // Will be populated based on the last message's role
                history: history
            }
        };

        if (currentMessage.role === 'user') {
            request.conversationState.currentMessage.userInputMessage = {
                content: currentContent,
                modelId: codewhispererModel,
                origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                images: currentImages && currentImages.length > 0 ? currentImages : null, // Add images here
                userInputMessageContext: {
                    toolResults: currentToolResults.length > 0 ? currentToolResults : null,
                    tools: Object.keys(toolsContext).length > 0 ? toolsContext.tools : null
                }
            };
        } else if (currentMessage.role === 'assistant') {
            request.conversationState.currentMessage.assistantResponseMessage = {
                content: currentContent,
                toolUses: currentToolUses.length > 0 ? currentToolUses : undefined
            };
        }

        if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            request.profileArn = this.profileArn;
        }
        
        return request;
    }

    parseEventStreamChunk(rawData) {
        const rawStr = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData);
        let fullContent = '';
        const toolCalls = [];
        let currentToolCallDict = null;

        const eventBlockRegex = /event({.*?(?=event{|$))/gs;

        for (const match of rawStr.matchAll(eventBlockRegex)) {
            const potentialJsonBlock = match[1];
            let searchPos = 0;
            while ((searchPos = potentialJsonBlock.indexOf('}', searchPos + 1)) !== -1) {
                const jsonCandidate = potentialJsonBlock.substring(0, searchPos + 1);
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
                                console.warn(`Tool call arguments not valid JSON: ${currentToolCallDict.function.arguments}`);
                            }
                            toolCalls.push(currentToolCallDict);
                            currentToolCallDict = null;
                        }
                    } else if (!eventData.followupPrompt && eventData.content) {
                        const decodedContent = eventData.content.replace(/\\n/g, '\n');
                        fullContent += decodedContent;
                    }
                    break;
                } catch (e) {
                    // 解析失败，说明这个 '}' 是内容的一部分，继续寻找下一个 '}'。
                }
            }
        }
        
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
 

    async callApi(method, model, body, isRetry = false, retryCount = 0) {
        if (!this.isInitialized) await this.initialize();
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        const requestData = this.buildCodewhispererRequest(body.messages, model, body.tools, body.system);

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

    _processApiResponse(response) {
        const rawResponseText = Buffer.isBuffer(response.data) ? response.data.toString('utf8') : String(response.data);
        //console.log(`[Kiro] Raw response length: ${rawResponseText.length}`);
        if (rawResponseText.includes("[Called")) {
            console.log("[Kiro] Raw response contains [Called marker.");
        }

        // 1. Parse structured events and bracket calls from parsed content
        const parsedFromEvents = this.parseEventStreamChunk(rawResponseText);
        let fullResponseText = parsedFromEvents.content;
        let allToolCalls = [...parsedFromEvents.toolCalls]; // clone
        //console.log(`[Kiro] Found ${allToolCalls.length} tool calls from event stream parsing.`);

        // 2. Crucial fix from Python example: Parse bracket tool calls from the original raw response
        const rawBracketToolCalls = parseBracketToolCalls(rawResponseText);
        if (rawBracketToolCalls) {
            //console.log(`[Kiro] Found ${rawBracketToolCalls.length} bracket tool calls in raw response.`);
            allToolCalls.push(...rawBracketToolCalls);
        }

        // 3. Deduplicate all collected tool calls
        const uniqueToolCalls = deduplicateToolCalls(allToolCalls);
        //console.log(`[Kiro] Total unique tool calls after deduplication: ${uniqueToolCalls.length}`);

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
        
        //console.log(`[Kiro] Final response text after tool call cleanup: ${fullResponseText}`);
        //console.log(`[Kiro] Final tool calls after deduplication: ${JSON.stringify(uniqueToolCalls)}`);
        return { responseText: fullResponseText, toolCalls: uniqueToolCalls };
    }

    async generateContent(model, requestBody) {
        if (!this.isInitialized) await this.initialize();
        const finalModel = MODEL_MAPPING[model] ? model : this.modelName;
        const response = await this.callApi('', finalModel, requestBody);

        try {
            const { responseText, toolCalls } = this._processApiResponse(response);
            return this.buildClaudeResponse(responseText, false, 'assistant', model, toolCalls);
        } catch (error) {
            console.error('[Kiro] Error in generateContent:', error);
            throw new Error(`Error processing response: ${error.message}`);
        }
    }

    //kiro提供的接口没有流式返回
    async streamApi(method, model, body, isRetry = false, retryCount = 0) {
        try {
            // 直接调用并返回Promise，最终解析为response
            return await this.callApi(method, model, body, isRetry, retryCount);
        } catch (error) {
            console.error('[Kiro] Error calling API:', error);
            throw error; // 向上抛出错误
        }
    }

    // 重构2: generateContentStream 调用新的普通async函数
    async * generateContentStream(model, requestBody) {
        if (!this.isInitialized) await this.initialize();
        const finalModel = MODEL_MAPPING[model] ? model : this.modelName;

        try {
            const response = await this.streamApi('', finalModel, requestBody);
            const { responseText, toolCalls } = this._processApiResponse(response);

            // Pass both responseText and toolCalls to buildClaudeResponse
            // buildClaudeResponse will handle the logic of combining them into a single stream
            for (const chunkJson of this.buildClaudeResponse(responseText, true, 'assistant', model, toolCalls)) {
                yield chunkJson;
            }
        } catch (error) {
            console.error('[Kiro] Error in streaming generation:', error);
            // For Claude, we yield an array of events for streaming error
            // Ensure error message is passed as content, not toolCalls
            for (const chunkJson of this.buildClaudeResponse(`Error: ${error.message}`, true, 'assistant', model, null)) {
                yield chunkJson;
            }
        }
    }

    /**
     * Build Claude compatible response object
     */
    buildClaudeResponse(content, isStream = false, role = 'assistant', model, toolCalls = null) {
        const messageId = `${uuidv4()}`;
        // Helper to estimate tokens (simple heuristic)
        const estimateTokens = (text) => Math.ceil((text || '').length / 4);

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
                        input_tokens: 0, // Kiro API doesn't provide this
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
                totalOutputTokens += estimateTokens(content);
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
                        // Arguments should be a stringified JSON object.
                        inputObject = tc.function.arguments;
                    } catch (e) {
                        console.warn(`[Kiro] Invalid JSON for tool call arguments. Wrapping in raw_arguments. Error: ${e.message}`, tc.function.arguments);
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
                            partial_json: inputObject
                        }
                    });
 
                    // 4. content_block_stop for each tool_use
                    events.push({
                        type: "content_block_stop",
                        index: index
                    });
                    totalOutputTokens += estimateTokens(JSON.stringify(inputObject));
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
                        // Arguments should be a stringified JSON object.
                        inputObject = tc.function.arguments;
                    } catch (e) {
                        console.warn(`[Kiro] Invalid JSON for tool call arguments. Wrapping in raw_arguments. Error: ${e.message}`, tc.function.arguments);
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
                    outputTokens += estimateTokens(tc.function.arguments);
                }
                stopReason = "tool_use"; // Set stop_reason to "tool_use" when toolCalls exist
            } else if (content) {
                contentArray.push({
                    type: "text",
                    text: content
                });
                outputTokens += estimateTokens(content);
            }

            return {
                id: messageId,
                type: "message",
                role: role,
                model: model,
                stop_reason: stopReason,
                stop_sequence: null,
                usage: {
                    input_tokens: 0, // Kiro API doesn't provide this
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
        const models = Object.keys(MODEL_MAPPING).map(id => ({
            name: id
        }));
        
        return { models: models };
    }

    /**
     * Checks if the given expiresAt timestamp is within 10 minutes from now.
     * @returns {boolean} - True if expiresAt is less than 10 minutes from now, false otherwise.
     */
    isExpiryDateNear() {
        try {
            const expirationTime = new Date(this.expiresAt);
            const currentTime = new Date();
            const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
            const thresholdTime = new Date(currentTime.getTime() + cronNearMinutesInMillis);
            console.log(`[Kiro] Expiry date: ${expirationTime.getTime()}, Current time: ${currentTime.getTime()}, ${this.config.CRON_NEAR_MINUTES || 10} minutes from now: ${thresholdTime.getTime()}`);
            return expirationTime.getTime() <= thresholdTime.getTime();
        } catch (error) {
            console.error(`[Kiro] Error checking expiry date: ${this.expiresAt}, Error: ${error.message}`);
            return false; // Treat as expired if parsing fails
        }
    }
}
