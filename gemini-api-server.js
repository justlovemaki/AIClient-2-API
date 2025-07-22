/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 描述:
 * (最终生产可用版)
 * 该脚本创建了一个独立的 Node.js HTTP 服务器，作为 Google Cloud Code Assist API 的本地代理。
 * 此版本包含了所有功能和错误修复，设计稳健、灵活，并通过全面且可控的日志系统使其易于监控。
 *
 * 主要功能:
 * - OpenAI & Gemini 双重兼容: 无缝桥接使用 OpenAI API 格式的客户端与 Google Gemini API。同时支持原生 Gemini API (`/v1beta`) 和兼容 OpenAI 的 (`/v1`) 端点。
 * - 强大的认证管理: 支持多种认证方式，包括通过 Base64 字符串、文件路径或自动发现本地凭证来配置 OAuth 2.0。能够自动刷新过期的令牌，确保服务持续运行。
 * - 灵活的 API 密钥校验: 支持三种 API 密钥验证方式：`Authorization: Bearer <key>` 请求头、`x-goog-api-key` 请求头以及 `?key=` URL 查询参数，可通过 `--api-key` 启动参数进行设置。
 * - 动态系统提示词管理:
 *   - 文件注入: 通过 `--system-prompt-file` 从外部文件加载系统提示，并用 `--system-prompt-mode` 控制其行为 (覆盖或追加)。
 *   - 实时同步: 能够将请求中包含的系统提示词实时写入 `fetch_system_prompt.txt` 文件，方便开发者观察和调试。
 * - 请求智能转换与修复: 自动将 OpenAI 格式的请求转换为 Gemini 格式，包括角色映射 (`assistant` -> `model`)、合并连续的同角色消息，并修复缺失的 `role` 字段。
 * - 全面且可控的日志系统: 提供控制台或文件两种日志模式，详细记录每个请求的输入与输出、令牌剩余有效期等信息，便于监控和调试。
 * - 高度可配置化启动: 支持通过命令行参数配置服务监听地址、端口、项目ID、API密钥及日志模式等。
 *
 * -----------------------------------------------------------------------------
 * 使用说明 & 命令行示例
 * -----------------------------------------------------------------------------
 *
 * 1. 环境设置:
 *    // 在脚本所在目录创建一个 `package.json` 文件，内容为: {"type": "module"}
 *    // 以避免模块类型警告。
 *
 *    // 安装依赖:
 *    npm install
 *
 * 2. 启动服务 (根据需要组合使用以下参数):
 *
 *    // 默认启动: 监听 localhost，不打印提示词
 *    node gemini-api-server-final.js
 *
 *    // 指定监听IP: 监听所有网络接口 (例如，用于 Docker 或局域网访问)
 *    node gemini-api-server-final.js 0.0.0.0
 *
 *    // 打印提示词到控制台: 监听 localhost，并在控制台输出提示词详情
 *    node gemini-api-server-final.js --log-prompts console
 *
 *    // 打印提示词到文件: 监听 localhost，并将提示词详情保存到一个带启动时间戳的新文件中
 *    // (例如: prompts-20231027-153055.log)
 *    node gemini-api-server-final.js --log-prompts file
 *
 *    // 组合使用参数 (参数顺序无关):
 *    // 在指定 IP 上运行，并打印提示词到控制台
 *    node gemini-api-server-final.js 192.168.1.100 --log-prompts console
 *
 *    // 在所有网络接口上运行，并打印提示词到文件
 *    node gemini-api-server-final.js --log-prompts file 0.0.0.0
 *
 *    // 指定 API Key 和端口 (参数顺序无关)
 *    node gemini-api-server-final.js --api-key your_secret_key --port 3001
 *
 *    // 通过 base64 编码的凭证启动 (例如，用于 Docker 或 CI/CD 环境)
 *    node gemini-api-server.js --oauth-creds-base64 "YOUR_BASE64_ENCODED_OAUTH_CREDS_JSON"
 *
 *    // 通过指定凭证文件路径启动 (例如，用于自定义凭证位置)
 *    node gemini-api-server.js --oauth-creds-file "/path/to/your/oauth_creds.json"
 *
 *    // 通过指定项目ID启动 (例如，用于多项目环境)
 *    node gemini-api-server.js --project-id your-gcp-project-id
 *
 *    // 使用指定的系统提示文件 (覆盖模式)
 *    node gemini-api-server.js --system-prompt-file /path/to/your/prompt.txt
 *
 *    // 使用指定的系统提示文件并设置为追加模式
 *    node gemini-api-server.js --system-prompt-file /path/to/your/prompt.txt --system-prompt-mode append
 * 
 *
 */



import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
    GeminiApiService,
    API_ACTIONS,
    formatExpiryTime,
    logConversation, // Changed from logPrompt
    extractPromptText,
    extractResponseText,
    getRequestBody,
} from './gemini-core.js';
import 'dotenv/config'; // Import dotenv and configure it

// --- Configuration Parsing ---
let HOST = 'localhost';
let PROMPT_LOG_MODE = 'none'; // 'none', 'console', 'file'
const PROMPT_LOG_BASE_NAME = 'prompts';
let PROMPT_LOG_FILENAME = '';
let REQUIRED_API_KEY = '123456'; // Default API Key
let SERVER_PORT = 3000; // Default Port
let OAUTH_CREDS_BASE64 = null; // New variable for base64 encoded OAuth credentials
let OAUTH_CREDS_FILE_PATH = null; // New variable for OAuth credentials file path
let PROJECT_ID = null; // New variable for project ID
let SYSTEM_PROMPT_FILE_PATH = null; // New variable for system prompt file 
let SYSTEM_PROMPT_MODE = 'overwrite'; // New variable for system prompt mode 

const args = process.argv.slice(2);
const remainingArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-key') {
        if (i + 1 < args.length) {
            REQUIRED_API_KEY = args[i + 1];
            i++; // Skip the value
        } else {
             console.warn(`[Config Warning] --api-key flag requires a value.`);
        }
    } else if (args[i] === '--log-prompts') {
        if (i + 1 < args.length) {
            const mode = args[i + 1];
            if (mode === 'console' || mode === 'file') {
                PROMPT_LOG_MODE = mode;
            } else {
                console.warn(`[Config Warning] Invalid mode for --log-prompts. Expected 'console' or 'file'. Prompt logging is disabled.`);
            }
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --log-prompts flag requires a value.`);
        }
    } else if (args[i] === '--port') {
        if (i + 1 < args.length) {
            SERVER_PORT = parseInt(args[i + 1], 10);
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --port flag requires a value.`);
        }
    } else if (args[i] === '--oauth-creds-base64') {
        if (i + 1 < args.length) {
            OAUTH_CREDS_BASE64 = args[i + 1];
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --oauth-creds-base64 flag requires a value.`);
        }
    } else if (args[i] === '--oauth-creds-file') {
        if (i + 1 < args.length) {
            OAUTH_CREDS_FILE_PATH = args[i + 1];
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --oauth-creds-file flag requires a value.`);
        }
    } else if (args[i] === '--project-id') { // New argument for project ID
        if (i + 1 < args.length) {
            PROJECT_ID = args[i + 1];
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --project-id flag requires a value.`);
        }
    } else if (args[i] === '--system-prompt-file') { // New argument for system prompt file path
        if (i + 1 < args.length) {
            SYSTEM_PROMPT_FILE_PATH = args[i + 1];
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --system-prompt-file flag requires a value.`);
        }
    } else if (args[i] === '--system-prompt-mode') { // New argument for system prompt mode
        if (i + 1 < args.length) {
            const mode = args[i + 1];
            if (mode === 'overwrite' || mode === 'append') {
                SYSTEM_PROMPT_MODE = mode;
            } else {
                console.warn(`[Config Warning] Invalid mode for --system-prompt-mode. Expected 'overwrite' or 'append'. Using default 'overwrite'.`);
            }
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --system-prompt-mode flag requires a value.`);
        }
    } else {
        remainingArgs.push(args[i]);
    }
}

if (remainingArgs.length > 0) {
    HOST = remainingArgs[0];
}

if (PROMPT_LOG_MODE === 'file') {
    const now = new Date();
    const pad = (num) => num.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    PROMPT_LOG_FILENAME = `${PROMPT_LOG_BASE_NAME}-${timestamp}.log`;
}

// --- Constants ---
// SERVER_PORT is now a configurable variable

// --- Format Conversion Functions ---

/**
 * Extracts text from the 'content' field of an OpenAI message,
 * which can be a string or an array of content parts (for multimodal input).
 * @param {string|Array<Object>} content The content field from a message.
 * @returns {string} The extracted text content.
 */
function extractTextFromMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        // Filter for text parts and join them. This gracefully handles multimodal inputs
        // by only extracting the text, which is what the Gemini text models expect.
        return content
            .filter(part => part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text)
            .join('\n');
    }
    // Return an empty string if content is not in a recognized format.
    return '';
}


/**
 * Extracts and combines all 'system' role messages into a single system instruction.
 * Filters out system messages and returns the remaining non-system messages.
 * @param {Array<Object>} messages - Array of message objects from OpenAI request.
 * @returns {{systemInstruction: Object|null, nonSystemMessages: Array<Object>}}
 *          An object containing the system instruction and an array of non-system messages.
 */
function extractAndProcessSystemMessages(messages) {
    const systemContents = [];
    const nonSystemMessages = [];

    for (const message of messages) {
        if (message.role === 'system') {
            systemContents.push(extractTextFromMessageContent(message.content));
        } else {
            nonSystemMessages.push(message);
        }
    }

    let systemInstruction = null;
    if (systemContents.length > 0) {
        systemInstruction = {
            parts: [{
                text: systemContents.join('\n')
            }]
        };
    }
    return { systemInstruction, nonSystemMessages };
}

/**
 * Converts an OpenAI chat completion request body to a Gemini API request body.
 * Handles system instructions and merges consecutive messages of the same role.
 * @param {Object} openaiRequest - The request body from the OpenAI API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
function toGeminiRequest(openaiRequest) {
    const geminiRequest = {
        contents: []
    };

    const messages = openaiRequest.messages || [];

    // 1. Extract and process system messages
    const { systemInstruction, nonSystemMessages } = extractAndProcessSystemMessages(messages);
    if (systemInstruction) {
        geminiRequest.systemInstruction = systemInstruction;
    }

    // 2. Process non-system messages, merging consecutive messages of the same role.
    if (nonSystemMessages.length > 0) {
        const mergedContents = nonSystemMessages.reduce((acc, message) => {
            // Map OpenAI 'assistant' role to Gemini 'model' role
            const geminiRole = message.role === 'assistant' ? 'model' : message.role;

            // Ignore roles that are not 'user' or 'model' (e.g., 'tool' messages)
            if (geminiRole !== 'user' && geminiRole !== 'model') {
                return acc;
            }

            const messageText = extractTextFromMessageContent(message.content);

            if (acc.length > 0 && acc[acc.length - 1].role === geminiRole) {
                // If the last content block has the same role, append to its text
                acc[acc.length - 1].parts[0].text += '\n' + messageText;
            } else {
                // Otherwise, start a new content block for the new role
                acc.push({
                    role: geminiRole,
                    parts: [{ text: messageText }]
                });
            }
            return acc;
        }, []);
        geminiRequest.contents = mergedContents;
    }

    // 3. Basic validation and logging (the Gemini API will perform final validation)
    // Log warnings if the conversation does not start or end with a 'user' role,
    // as this is often required by Gemini for multi-turn conversations.
    if (geminiRequest.contents.length > 0) {
        if (geminiRequest.contents[0].role !== 'user') {
            console.warn("[Request Conversion] Warning: Conversation doesn't start with a 'user' role. The API may reject this request.");
        }
        if (geminiRequest.contents[geminiRequest.contents.length - 1].role !== 'user') {
            console.warn("[Request Conversion] Warning: The last message in the conversation is not from the 'user'. The API may reject this request.");
        }
    }

    return geminiRequest;
}

function toOpenAIModelList(geminiModels) {
    return {
        object: "list",
        data: geminiModels.map(modelId => ({
            id: modelId,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "google",
        })),
    };
}

function toOpenAIChatCompletion(geminiResponse, model) {
    const text = extractResponseText(geminiResponse);
    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: text,
            },
            finish_reason: "stop",
        }],
        usage: geminiResponse.usageMetadata ? {
            prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
            total_tokens: geminiResponse.usageMetadata.totalTokenCount || 0,
        } : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

function toOpenAIStreamChunk(geminiChunk, model) {
    const text = extractResponseText(geminiChunk);
    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: { content: text },
            finish_reason: null,
        }],
        usage: geminiChunk.usageMetadata ? {
            prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
            total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
        } : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

function isAuthorized(req, requestUrl) {
    const authHeader = req.headers['authorization'];
    const queryKey = requestUrl.searchParams.get('key');
    const headerKey = req.headers['x-goog-api-key'];

    // Check for Bearer token in Authorization header (OpenAI style)
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === REQUIRED_API_KEY) {
            return true;
        }
    }

    // Check for API key in URL query parameter (Gemini style)
    if (queryKey === REQUIRED_API_KEY) {
        return true;
    }

    // Check for API key in x-goog-api-key header (Gemini style)
    if (headerKey === REQUIRED_API_KEY) {
        return true;
    }
    
    console.log(`[Auth] Unauthorized request denied. Bearer token: "${authHeader ? authHeader.substring(7) : 'N/A'}", Query key: "${queryKey}", Header key: "${headerKey}"`);
    return false;
}

// --- Singleton Instance & HTTP Server Handlers ---
let apiServiceInstance = null;
async function getApiService() {
    if (!apiServiceInstance) {
        apiServiceInstance = new GeminiApiService(HOST, OAUTH_CREDS_BASE64, OAUTH_CREDS_FILE_PATH, PROJECT_ID, SYSTEM_PROMPT_FILE_PATH, SYSTEM_PROMPT_MODE);
        await apiServiceInstance.initialize();
    } else if (!apiServiceInstance.isInitialized) {
        await apiServiceInstance.initialize();
    }
    return apiServiceInstance;
}
async function handleStreamRequest(res, service, model, requestBody) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Transfer-Encoding": "chunked" });
    const stream = service.generateContentStream(model, requestBody);
    console.log('[Server Response Stream]');
    process.stdout.write('> ');
    let fullResponseText = '';
    for await (const chunk of stream) {
        const chunkText = extractResponseText(chunk);
        if (chunkText) {
            process.stdout.write(chunkText);
            fullResponseText += chunkText;
        }
        const chunkString = JSON.stringify(chunk);
        res.write(`data: ${chunkString}\n\n`);
    }
    process.stdout.write('\n');
    res.end();
    const expiryDate = service.authClient.credentials.expiry_date;
    console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);

    await logConversation('output', fullResponseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
}

async function handleOpenAIStreamRequest(res, service, model, requestBody) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    const stream = service.generateContentStream(model, requestBody);
    console.log('[Server Response Stream]');
    process.stdout.write('> ');
    let fullResponseText = ''; // Declare fullResponseText here
    try {
        for await (const chunk of stream) {
            const openAIChunk = toOpenAIStreamChunk(chunk, model);
            const chunkText = openAIChunk.choices[0].delta.content || "";
            if (chunkText) {
                process.stdout.write(chunkText);
                fullResponseText += chunkText; // Accumulate text here
            }
            res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
        }
        // Send the final [DONE] message according to OpenAI spec
        res.write('data: [DONE]\n\n');
    } catch (error) {
        console.error('\n[Server] Error during stream processing:', error.stack);
        if (!res.writableEnded) {
            // We may not be able to write headers, but we can try to send an error payload.
            const errorPayload = { error: { message: "An error occurred during streaming.", details: error.message } };
            res.end(JSON.stringify(errorPayload)); // End the response with an error
        }
    } finally {
        process.stdout.write('\n');
        if (!res.writableEnded) {
            res.end();
        }
        // Log the full conversation here
        await logConversation('output', fullResponseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
    }
    const expiryDate = service.authClient.credentials.expiry_date;
    console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);
}

async function handleUnaryRequest(res, service, model, requestBody) {
    const response = await service.generateContent(model, requestBody);
    console.log('[Server Response Unary]');
    process.stdout.write('> ');
    const responseText = extractResponseText(response);
    process.stdout.write(responseText);
    process.stdout.write('\n');
    const responseString = JSON.stringify(response);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(responseString);
    const expiryDate = service.authClient.credentials.expiry_date;
    console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);

    await logConversation('output', responseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
}

async function handleOpenAIUnaryRequest(res, service, model, requestBody) {
    const geminiResponse = await service.generateContent(model, requestBody);
    const openAIResponse = toOpenAIChatCompletion(geminiResponse, model);
    console.log('[Server Response Unary]');
    process.stdout.write('> ');
    const responseText = extractResponseText(geminiResponse);
    process.stdout.write(responseText);
    process.stdout.write('\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(openAIResponse));
    const expiryDate = service.authClient.credentials.expiry_date;
    console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);

    await logConversation('output', responseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
}
function handleError(res, error) {
    console.error('\n[Server] Request failed:', error.stack);
    if (!res.headersSent) {
        const statusCode = error.response?.status || 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    }
    const errorPayload = { error: { message: error.message, details: error.response?.data } };
    res.end(JSON.stringify(errorPayload));
}

async function requestHandler(req, res) {
    console.log(`\n[Server] Received request: ${req.method} http://${req.headers.host}${req.url}`);
    
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'OPTIONS'){
        res.writeHead(200, { 'Content-Type': 'application/json' });
        console.log("OPTIONS REQUEST SUCCESS");
        return res.end("OPTIONS REQUEST SUCCESS");
    }

    if (!isAuthorized(req, requestUrl)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing. Provide it in the `Authorization: Bearer <key>` header, as a `key` query parameter, or in the `x-goog-api-key` header.' } }));
    }

    try {
        const service = await getApiService();
    
        // --- OpenAI Compatible Endpoints ---
        if (req.method === 'GET' && requestUrl.pathname === '/v1/models') {
            const models = await service.listModels();
            const openAIModels = toOpenAIModelList(models.models.map(m => m.name.replace('models/', '')));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            const expiryDate = service.authClient.credentials.expiry_date;
            console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);
            return res.end(JSON.stringify(openAIModels));
        }

        if (req.method === 'POST' && requestUrl.pathname === '/v1/chat/completions') {
            const openaiRequest = await getRequestBody(req);
            const model = openaiRequest.model;
            const geminiRequest = toGeminiRequest(openaiRequest);
            const promptText = extractPromptText(geminiRequest); // Use geminiRequest for logging
            await logConversation('input', promptText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);

            if (openaiRequest.stream) {
                await handleOpenAIStreamRequest(res, service, model, geminiRequest);
            } else {
                await handleOpenAIUnaryRequest(res, service, model, geminiRequest);
            }
            return;
        }

        // --- Gemini Endpoints ---
        if (req.method === 'GET' && requestUrl.pathname === '/v1beta/models') {
            const models = await service.listModels();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            const expiryDate = service.authClient.credentials.expiry_date;
            console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);
            return res.end(JSON.stringify(models));
        }
        
        const urlPattern = new RegExp(`/v1beta/models/(.+?):(${API_ACTIONS.GENERATE_CONTENT}|${API_ACTIONS.STREAM_GENERATE_CONTENT})`);
        const urlMatch = requestUrl.pathname.match(urlPattern);
        
        if (req.method === 'POST' && urlMatch) {
            const [, model, action] = urlMatch;
            const requestBody = await getRequestBody(req);            
            const promptText = extractPromptText(requestBody);
            await logConversation('input', promptText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
            
            if (action === API_ACTIONS.STREAM_GENERATE_CONTENT) {
                await handleStreamRequest(res, service, model, requestBody);
            } else {
                await handleUnaryRequest(res, service, model, requestBody);
            }

            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Not Found' } }));

    } catch (error) {
        handleError(res, error);
    }
}

// --- Server Initialization ---
const server = http.createServer(requestHandler);

server.listen(SERVER_PORT, HOST, () => {
    console.log(`--- Unified API Server Configuration ---`);
    console.log(`  Host: ${HOST}`);
    console.log(`  Port: ${SERVER_PORT}`);
    console.log(`  Required API Key: ${REQUIRED_API_KEY}`);
    console.log(`  Prompt Logging: ${PROMPT_LOG_MODE}${PROMPT_LOG_MODE === 'file' ? ` (to ${PROMPT_LOG_FILENAME})` : ''}`);
    console.log(`  OAuth Creds File Path: ${OAUTH_CREDS_FILE_PATH || 'Default'}`);
    console.log(`  Project ID: ${PROJECT_ID || 'Auto-discovered'}`);
    console.log(`  System Prompt File: ${SYSTEM_PROMPT_FILE_PATH || 'Default'}`);
    console.log(`  System Prompt Mode: ${SYSTEM_PROMPT_MODE}`);
    console.log(`------------------------------------------`);
    console.log(`\nUnified API Server running on http://${HOST}:${SERVER_PORT}`);
    console.log(`Supports both Gemini (/v1beta) and OpenAI-compatible (/v1) endpoints.`);
    console.log('Initializing backend service... This may take a moment.');
    getApiService().catch(err => {
        console.error("[Server] Pre-warming failed.", err.message);
    });
});
