import { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

// --- Constants ---
const AUTH_REDIRECT_PORT = 8085;
const CREDENTIALS_DIR = '.gemini';
const CREDENTIALS_FILE = 'oauth_creds.json';
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
export const API_ACTIONS = {
    GENERATE_CONTENT: 'generateContent',
    STREAM_GENERATE_CONTENT: 'streamGenerateContent',
};
const FETCH_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'fetch_system_prompt.txt');
// New constant for system prompt override file (optional, can be configured via env var)
const INPUT_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'input_system_prompt.txt');
// --- Utility Functions ---

export function ensureRolesInContents(requestBody) {
    if (!requestBody || !Array.isArray(requestBody.contents)) {
        return requestBody;
    }
    const newRequestBody = requestBody;

    // ** FIX: Rename system_instruction to systemInstruction for the internal API **
    // Ensure system_instruction is correctly renamed before further processing
    if (newRequestBody.system_instruction) {
        newRequestBody.systemInstruction = newRequestBody.system_instruction;
        delete newRequestBody.system_instruction;
    }

    newRequestBody.contents.forEach((content, index) => {
        if (!content.role) {
            content.role = 'auto';
        }
    });
    return newRequestBody;
}

export function formatExpiryTime(expiryTimestamp) {
    if (!expiryTimestamp || typeof expiryTimestamp !== 'number') return "No expiry date available";
    const diffMs = expiryTimestamp - Date.now();
    if (diffMs <= 0) return "Token has expired";
    let totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export async function logConversation(type, content, logMode, logFilename) {
    if (logMode === 'none') return;

    const timestamp = new Date().toLocaleString();
    const logEntry = `${timestamp} [${type.toUpperCase()}]:\n${content}\n\n\n--------------------------------------\n\n\n`;

    if (logMode === 'console' && type === 'input') {
        console.log(logEntry);
    } else if (logMode === 'file') {
        try {
            // Append to the file
            await fs.appendFile(logFilename, logEntry);
        } catch (err) {
            console.error(`[Error] Failed to write conversation log to ${logFilename}:`, err);
        }
    }
}

export function extractPromptText(requestBody) {
    if (!requestBody || !Array.isArray(requestBody.contents)) return "[No request body found]";

    let latestPrompt = "[No text prompt found]";

    // Iterate through contents in reverse to find the latest user prompt
    for (let i = requestBody.contents.length - 1; i >= 0; i--) {
        const content = requestBody.contents[i];
        if (content && content.role === 'user' && Array.isArray(content.parts)) {
            const userParts = content.parts.filter(part => part && typeof part.text === 'string');
            if (userParts.length > 0) {
                latestPrompt = userParts.map(part => part.text).join('\n');
                break; // Found the latest user prompt, exit loop
            }
        }
    }
    return latestPrompt;
}


export async function manageSystemPrompt(requestBody) {
    const incomingSystemInstruction = requestBody.system_instruction || requestBody.systemInstruction;
    let incomingSystemText = '';

    if (incomingSystemInstruction && Array.isArray(incomingSystemInstruction.parts)) {
        incomingSystemText = incomingSystemInstruction.parts
            .filter(p => p && typeof p.text === 'string')
            .map(p => p.text)
            .join('\n');
    }

    try {
        let currentSystemText = '';
        try {
            currentSystemText = await fs.readFile(FETCH_SYSTEM_PROMPT_FILE, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`[System Prompt Manager] Error reading system prompt file: ${error.message}`);
            }
            // If file doesn't exist, currentSystemText remains empty, which is fine.
        }

        if (incomingSystemText && incomingSystemText !== currentSystemText) {
            await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, incomingSystemText);
            console.log('[System Prompt Manager] System prompt updated in file.');
        } else if (!incomingSystemText && currentSystemText) {
            // If incoming request has no system prompt but file has one, clear the file
            await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, '');
            console.log('[System Prompt Manager] System prompt cleared from file.');
        }
    } catch (error) {
        console.error(`[System Prompt Manager] Failed to manage system prompt file: ${error.message}`);
    }
}

export function extractResponseText(responseObject) {
    if (!responseObject || !Array.isArray(responseObject.candidates) || responseObject.candidates.length === 0) return "";
    const firstCandidate = responseObject.candidates[0];
    if (!firstCandidate.content || !Array.isArray(firstCandidate.content.parts)) return "";
    return firstCandidate.content.parts.filter(p => p && typeof p.text === 'string').map(p => p.text).join("");
}

function toGeminiApiResponse(codeAssistResponse) {
    if (!codeAssistResponse) return null;
    const compliantResponse = { candidates: codeAssistResponse.candidates };
    if (codeAssistResponse.usageMetadata) compliantResponse.usageMetadata = codeAssistResponse.usageMetadata;
    if (codeAssistResponse.promptFeedback) compliantResponse.promptFeedback = codeAssistResponse.promptFeedback;
    if (codeAssistResponse.automaticFunctionCallingHistory) compliantResponse.automaticFunctionCallingHistory = codeAssistResponse.automaticFunctionCallingHistory;
    return compliantResponse;
}

export async function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error("Invalid JSON in request body."));
            }
        });
        req.on('error', err => reject(err));
    });
}

// --- Main Service Class ---
export class GeminiApiService {
    constructor(host = 'localhost', oauthCredsBase64 = null, oauthCredsFilePath = null, projectId = null, systemPromptFilePath = null, systemPromptMode = 'overwrite') {
        this.authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        this.projectId = projectId; // Set projectId from constructor argument
        this.availableModels = [];
        this.isInitialized = false;
        this.host = host;
        this.oauthCredsBase64 = oauthCredsBase64;
        this.oauthCredsFilePath = oauthCredsFilePath;
        this.systemPromptFilePath = systemPromptFilePath || INPUT_SYSTEM_PROMPT_FILE; // Store the new parameters
        this.systemPromptMode = systemPromptMode; // 'overwrite' or 'append'
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[Service] Initializing Gemini API Service...');
        await this.initializeAuth();
        // Only discover project ID if it's not already provided
        if (!this.projectId) {
            this.projectId = await this.discoverProjectAndModels();
        } else {
            console.log(`[Service] Using provided Project ID: ${this.projectId}`);
            // Still need to ensure models are set up even if project ID is provided
            this.availableModels = ['gemini-2.5-pro', 'gemini-2.5-flash'];
            console.log(`[Service] Using fixed models: [${this.availableModels.join(', ')}]`);
        }
        if (this.projectId === 'default') {
            throw new Error("Error: 'default' is not a valid project ID. Please provide a valid Google Cloud Project ID using the --project-id argument.");
        }
        this.isInitialized = true;
        console.log(`[Service] Initialization complete. Project ID: ${this.projectId}`);
    }

    async initializeAuth(forceRefresh = false) {
        if (this.authClient.credentials.access_token && !forceRefresh) return;

        if (this.oauthCredsBase64) {
            try {
                const decoded = Buffer.from(this.oauthCredsBase64, 'base64').toString('utf8');
                const credentials = JSON.parse(decoded);
                this.authClient.setCredentials(credentials);
                console.log('[Auth] Authentication configured successfully from base64 string.');
                // If using base64, we don't refresh and save to file automatically
                // as the source of truth is the provided string.
                return;
            } catch (error) {
                console.error('[Auth] Failed to parse base64 OAuth credentials:', error);
                throw new Error(`Failed to load OAuth credentials from base64 string.`);
            }
        }

        const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);
        try {
            const data = await fs.readFile(credPath, "utf8");
            const credentials = JSON.parse(data);
            this.authClient.setCredentials(credentials);
            console.log('[Auth] Authentication configured successfully from file.');
            if (forceRefresh) {
                console.log('[Auth] Forcing token refresh...');
                const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
                this.authClient.setCredentials(newCredentials);
                await fs.writeFile(credPath, JSON.stringify(newCredentials, null, 2));
                console.log('[Auth] Refreshed token saved.');
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`[Auth] Credentials file '${credPath}' not found. Starting new authentication flow...`);
                const newTokens = await this.getNewToken(credPath);
                this.authClient.setCredentials(newTokens);
                console.log('[Auth] New token obtained and loaded into memory.');
            } else {
                console.error('[Auth] Failed to initialize authentication from file:', error);
                throw new Error(`Failed to load OAuth credentials.`);
            }
        }
    }

    async getNewToken(credPath) {
        const redirectUri = `http://${this.host}:${AUTH_REDIRECT_PORT}`;
        this.authClient.redirectUri = redirectUri;
        return new Promise((resolve, reject) => {
            const authUrl = this.authClient.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/cloud-platform'] });
            console.log('\n[Auth] Please open this URL in your browser to authenticate:');
            console.log(authUrl, '\n');
            const server = http.createServer(async (req, res) => {
                try {
                    const url = new URL(req.url, redirectUri);
                    const code = url.searchParams.get('code');
                    const errorParam = url.searchParams.get('error');
                    if (code) {
                        console.log(`[Auth] Received successful callback from Google: ${req.url}`);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Authentication successful! You can close this browser tab.');
                        server.close();
                        const { tokens } = await this.authClient.getToken(code);
                        await fs.mkdir(path.dirname(credPath), { recursive: true });
                        await fs.writeFile(credPath, JSON.stringify(tokens, null, 2));
                        console.log('[Auth] New token received and saved to file.');
                        resolve(tokens);
                    } else if (errorParam) {
                        const errorMessage = `Authentication failed. Google returned an error: ${errorParam}.`;
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end(errorMessage);
                        server.close();
                        reject(new Error(errorMessage));
                    } else {
                        console.log(`[Auth] Ignoring irrelevant request: ${req.url}`);
                        res.writeHead(204);
                        res.end();
                    }
                } catch (e) {
                    if (server.listening) server.close();
                    reject(e);
                }
            });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    const errorMessage = `[Auth] Port ${AUTH_REDIRECT_PORT} on ${this.host} is already in use.`;
                    console.error(errorMessage);
                    reject(new Error(errorMessage));
                } else {
                    reject(err);
                }
            });
            server.listen(AUTH_REDIRECT_PORT, this.host);
        });
    }

    async discoverProjectAndModels() {
        // If projectId is already set, return it directly
        if (this.projectId) {
            console.log(`[Service] Using pre-configured Project ID: ${this.projectId}`);
            return this.projectId;
        }

        console.log('[Service] Discovering Project ID...');
        this.availableModels = ['gemini-2.5-pro', 'gemini-2.5-flash'];
        console.log(`[Service] Using fixed models: [${this.availableModels.join(', ')}]`);
        try {
            const loadResponse = await this.callApi('loadCodeAssist', { metadata: { pluginType: 'GEMINI' } });
            if (loadResponse.cloudaicompanionProject) {
                return loadResponse.cloudaicompanionProject;
            }
            const defaultTier = loadResponse.allowedTiers?.find(tier => tier.isDefault);
            const onboardRequest = { tierId: defaultTier?.id || 'free-tier', metadata: { pluginType: 'GEMINI' } , cloudaicompanionProject: 'default',};
            let lro = await this.callApi('onboardUser', onboardRequest);
            while (!lro.done) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                lro = await this.callApi('onboardUser', onboardRequest);
            }
            return lro.response?.cloudaicompanionProject?.id;
        } catch (error) {
            console.error('[Service] Failed to discover Project ID:', error.response?.data || error.message);
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
                inputTokenLimit: 32768, outputTokenLimit: 8192,
                supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
            };
        });
        return { models: formattedModels };
    }

    async callApi(method, body, isRetry = false) {
        try {
            const requestOptions = {
                url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                responseType: "json",
                body: JSON.stringify(body),
            };
            const res = await this.authClient.request(requestOptions);
            return res.data;
        } catch (error) {
            if (error.response?.status === 401 && !isRetry) {
                console.log('[API] Received 401. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                return this.callApi(method, body, true);
            }
            throw error;
        }
    }

    async * streamApi(method, body, isRetry = false) {
        try {
            const requestOptions = {
                url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
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
            if (error.response?.status === 401 && !isRetry) {
                console.log('[API] Received 401 during stream. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                yield* this.streamApi(method, body, true);
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
                try { yield JSON.parse(buffer.join('\n')); } catch (e) { console.error("[Stream] Failed to parse JSON chunk:", buffer.join('\n')); }
                buffer = [];
            }
        }
        if (buffer.length > 0) {
            try { yield JSON.parse(buffer.join('\n')); } catch (e) { console.error("[Stream] Failed to parse final JSON chunk:", buffer.join('\n')); }
        }
    }

    async _applySystemPromptFromFile(requestBody) {
        if (!this.systemPromptFilePath) {
            return requestBody;
        }

        // requestBody is already a deep copy from ensureRolesInContents, so no need to copy again.
        try {
            await fs.access(this.systemPromptFilePath, fs.constants.F_OK);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`[System Prompt] Specified system prompt file not found: ${this.systemPromptFilePath}`);
                return requestBody;
            } else {
                console.error(`[System Prompt] Error accessing system prompt file ${this.systemPromptFilePath}: ${error.message}`);
                return requestBody;
            }
        }

        // requestBody is already a deep copy from ensureRolesInContents, so no need to copy again.
        try {
            const filePromptContent = await fs.readFile(this.systemPromptFilePath, 'utf8');
            const currentSystemInstruction = requestBody.system_instruction || requestBody.systemInstruction;
            let existingSystemText = '';

            if (currentSystemInstruction && Array.isArray(currentSystemInstruction.parts)) {
                existingSystemText = currentSystemInstruction.parts
                    .filter(p => p && typeof p.text === 'string')
                    .map(p => p.text)
                    .join('\n');
            }

            let newSystemText = '';
            if (this.systemPromptMode === 'append') {
                newSystemText = existingSystemText ? `${existingSystemText}\n${filePromptContent}` : filePromptContent;
            } else { // default to 'overwrite'
                newSystemText = filePromptContent;
            }

            if (newSystemText) {
                requestBody.systemInstruction = { parts: [{ text: newSystemText }] };
                // Ensure system_instruction (old name) is also updated or removed if present
                if (requestBody.system_instruction) {
                    delete requestBody.system_instruction;
                }
            }
        } catch (error) {
            console.error(`[System Prompt] Error reading system prompt file ${this.systemPromptFilePath}: ${error.message}`);
        }
        return requestBody;
    }

    async generateContent(model, requestBody) {
        // First, ensure roles are set and system_instruction is renamed to systemInstruction
        const compliantRequestBodyInitial = ensureRolesInContents(requestBody);
        
        // Then, apply system prompt from file to the now compliant request body
        let modifiedRequestBody = await this._applySystemPromptFromFile(compliantRequestBodyInitial);
        await manageSystemPrompt(requestBody);

        const apiRequest = { model, project: this.projectId, request: modifiedRequestBody };
        const response = await this.callApi(API_ACTIONS.GENERATE_CONTENT, apiRequest);
        return toGeminiApiResponse(response.response);
    }

    async * generateContentStream(model, requestBody) {
        // First, ensure roles are set and system_instruction is renamed to systemInstruction
        const compliantRequestBodyInitial = ensureRolesInContents(requestBody);

        // Then, apply system prompt from file to the now compliant request body
        let modifiedRequestBody = await this._applySystemPromptFromFile(compliantRequestBodyInitial);
        await manageSystemPrompt(requestBody);

        const apiRequest = { model, project: this.projectId, request: modifiedRequestBody };
        const stream = this.streamApi(API_ACTIONS.STREAM_GENERATE_CONTENT, apiRequest);
        for await (const chunk of stream) {
            yield toGeminiApiResponse(chunk.response);
        }
    }
}
