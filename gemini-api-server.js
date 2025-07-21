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
 * - 灵活的 API 密钥校验: 只要在 URL 查询参数 (`?key=...`) 或 `x-goog-api-key` 请求头中提供了正确的密钥，请求即可通过授权。密钥可通过 `--api-key` 启动参数设置。
 * - 角色规范化修复: 自动为请求体添加必需的 'user'/'model' 角色，并正确保留 `systemInstruction` (或 `system_instruction`)。
 * - 固定的模型列表: 服务器现在专门提供并使用 `gemini-2.5-pro` 和 `gemini-2.5-flash` 模型。
 * - 完整的 Gemini API 端点支持: 实现了 `listModels`, `generateContent`, `streamGenerateContent`。
 * - 全面且可控的日志系统: 包括令牌剩余有效期、可输出到控制台或文件的带时间戳的提示词日志等。
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
 *    npm install google-auth-library
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
 * 3. 调用 API 接口 (默认 API Key: 123456):
 *
 *    // a) 列出可用模型 (GET 请求，密钥在 URL 参数中)
 *    curl "http://localhost:3000/v1beta/models?key=123456"
 *
 *    // b) 生成内容 - 单轮对话 (POST 请求，密钥在请求头中)
 *    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
 *      -H "Content-Type: application/json" \
 *      -H "x-goog-api-key: 123456" \
 *      -d '{"contents":[{"parts":[{"text":"用一句话解释什么是代理服务器"}]}]}'
 *
 *    // c) 生成内容 - 带系统提示词 (POST 请求，密钥在请求头中，注意 system_instruction)
 *    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
 *      -H "Content-Type: application/json" \
 *      -H "x-goog-api-key: 123456" \
 *      -d '{
 *        "system_instruction": { "parts": [{ "text": "你是一只名叫 Neko 的猫。" }] },
 *        "contents": [{ "parts": [{ "text": "你好，你叫什么名字？" }] }]
 *      }'
 *
 *    // d) 流式生成内容 (POST 请求，密钥在 URL 参数中)
 *    curl "http://localhost:3000/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=123456" \
 *      -H "Content-Type: application/json" \
 *      -d '{"contents":[{"parts":[{"text":"写一首关于宇宙的五行短诗"}]}]}'
 *
 */



import * as http from 'http';
import {
    GeminiApiService,
    API_ACTIONS,
    formatExpiryTime,
    logConversation, // Changed from logPrompt
    extractPromptText,
    extractResponseText,
    getRequestBody,
    manageSystemPrompt,
} from './gemini-core.js';

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

function isAuthorized(req, requestUrl) {
    const queryKey = requestUrl.searchParams.get('key');
    const headerKey = req.headers['x-goog-api-key'];

    if (queryKey === REQUIRED_API_KEY || headerKey === REQUIRED_API_KEY) {
        return true;
    }
    
    console.log(`[Auth] Unauthorized request denied. Query key: "${queryKey}", Header key: "${headerKey}"`);
    return false;
}

// --- Singleton Instance & HTTP Server Handlers ---
let apiServiceInstance = null;
async function getApiService() {
    if (!apiServiceInstance) {
        apiServiceInstance = new GeminiApiService(HOST, OAUTH_CREDS_BASE64, OAUTH_CREDS_FILE_PATH, PROJECT_ID);
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

    if (!isAuthorized(req, requestUrl)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing. Provide it in the `x-goog-api-key` header or as a `key` query parameter.' } }));
    }

    try {
        const service = await getApiService();
        
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
            
            await manageSystemPrompt(requestBody); // Call the new function here
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
    console.log(`--- Server Configuration ---`);
    console.log(`  Host: ${HOST}`);
    console.log(`  Port: ${SERVER_PORT}`);
    console.log(`  Required API Key: ${REQUIRED_API_KEY}`);
    console.log(`  Prompt Logging: ${PROMPT_LOG_MODE}${PROMPT_LOG_MODE === 'file' ? ` (to ${PROMPT_LOG_FILENAME})` : ''}`);
    console.log(`  OAuth Creds File Path: ${OAUTH_CREDS_FILE_PATH || 'Default'}`);
    console.log(`  Project ID: ${PROJECT_ID || 'Auto-discovered'}`); // Log the project ID
    console.log(`--------------------------`);
    console.log(`\nGemini API Server (Final) running on http://${HOST}:${SERVER_PORT}`);
    console.log('Initializing service... This may take a moment.');
    getApiService().catch(err => {
        console.error("[Server] Pre-warming failed.", err.message);
    });
});
