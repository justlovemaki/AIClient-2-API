/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 功能：
 * 该脚本创建一个独立的 Node.js HTTP 服务器，作为 Google Cloud Code Assist API 的本地代理，
 * 但它暴露了与 OpenAI API 兼容的接口，使其可以被任何支持 OpenAI API 的客户端直接使用。
 *
 * 主要特性：
 * - **OpenAI API 兼容性**: 实现了 `/v1/models` 和 `/v1/chat/completions` 端点。
 * - **格式转换**: 自动将 OpenAI 格式的请求/响应与内部 Gemini 格式进行转换。
 * - **流式传输支持**: 完全支持 OpenAI 的流式响应 (`"stream": true`)。
 * - **灵活的认证**: 支持通过 `Authorization: Bearer <key>` 请求头、URL 查询参数 (`?key=...`) 或 `x-goog-api-key` 请求头进行 API 密钥校验。
 * - **全面且可控的日志系统**: 包括令牌剩余有效期、可输出到控制台或文件的带时间戳的提示词日志等。
 * - **可配置性**: 可以通过命令行参数配置监听地址、端口、API 密钥和提示词日志模式。
 * - **重用核心逻辑**: 底层依然使用 `gemini-core.js` 与 Google 服务通信。
 *
 * -----------------------------------------------------------------------------
 * 使用说明 & 命令行示例
 * -----------------------------------------------------------------------------
 *
 * 1. 环境设置:
 *    在项目根目录创建一个 `package.json` 文件，内容为: `{"type": "module"}`，以避免模块类型警告。
 *    (此项目已提供 `package.json` 文件，无需手动创建)
 *
 * 2. 安装依赖:
 *    ```bash
 *    npm install
 *    ```
 *    这将安装 `google-auth-library` 和 `uuid`。
 *
 * 3. 启动服务 (根据需要组合使用以下参数):
 *
 *    - **默认启动**: 监听 `localhost:8000`
 *      ```bash
 *      node openai-api-server.js
 *      ```
 *    - **指定监听 IP** (位置参数):
 *      ```bash
 *      node openai-api-server.js 0.0.0.0
 *      ```
 *    - **使用命名参数指定端口**:
 *      ```bash
 *      node openai-api-server.js --port 8081
 *      ```
 *    - **使用命名参数指定 API Key**:
 *      ```bash
 *      node openai-api-server.js --api-key your_secret_key
 *      ```
 *    - **打印提示词到控制台**: 监听 `localhost`，并在控制台输出提示词详情
 *      ```bash
 *      node openai-api-server.js --log-prompts console
 *      ```
 *    - **打印提示词到文件**: 监听 `localhost`，并将提示词详情保存到一个带启动时间戳的新文件中 (例如: `prompts-20231027-153055.log`)
 *      ```bash
 *      node openai-api-server.js --log-prompts file
 *      ```
 *    - **组合使用参数** (参数顺序无关):
 *      ```bash
 *      node openai-api-server.js --port 8088 --api-key your_secret_key 0.0.0.0
 *      ```
 *
 * 4. 调用 API 接口 (假设 API Key: `your_secret_key`, 服务运行在 `localhost:8000`):
 *
 *    - **a) 列出可用模型**
 *      ```bash
 *      curl http://localhost:8000/v1/models \
 *        -H "Authorization: Bearer your_secret_key"
 *      ```
 *    - **b) 生成内容 - 带系统提示词 (非流式)**
 *      ```bash
 *      curl http://localhost:8000/v1/chat/completions \
 *        -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer your_secret_key" \
 *        -d '{
 *          "model": "gemini-2.5-pro",
 *          "messages": [
 *            {"role": "system", "content": "你是一只名叫 Neko 的猫。"},
 *            {"role": "user", "content": "你好，你叫什么名字？"}
 *          ]
 *        }'
 *      ```
 *    - **c) 生成内容 - 流式**
 *      ```bash
 *      curl http://localhost:8000/v1/chat/completions \
 *        -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer your_secret_key" \
 *        -d '{
 *          "model": "gemini-2.5-flash",
 *          "messages": [
 *            {"role": "user", "content": "写一首关于宇宙的五行短诗"}
 *          ],
 *          "stream": true
 *        }'
 *
 */

import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
    GeminiApiService,
    API_ACTIONS,
    formatExpiryTime,
    logPrompt,
    extractPromptText,
    getRequestBody,
    extractResponseText
} from './gemini-core.js';

// --- Configuration Parsing ---
let HOST = 'localhost';
let PROMPT_LOG_MODE = 'none'; // 'none', 'console', 'file'
const PROMPT_LOG_BASE_NAME = 'prompts';
let PROMPT_LOG_FILENAME = '';
let REQUIRED_API_KEY = '123456'; // Default API Key
let SERVER_PORT = 8000; // Default Port

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
    } else if (args[i] === '--port') {
        if (i + 1 < args.length) {
            SERVER_PORT = parseInt(args[i + 1], 10);
            i++; // Skip the value
        } else {
            console.warn(`[Config Warning] --port flag requires a value.`);
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
    } else {
        remainingArgs.push(args[i]);
    }
}

if (remainingArgs.length > 0) HOST = remainingArgs[0];

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


function toGeminiRequest(openaiRequest) {
    const geminiRequest = {
        contents: []
    };

    let systemContent = [];
    const messages = openaiRequest.messages || [];

    // 1. Extract and combine all system messages
    const otherMessages = messages.filter(m => {
        if (m.role === 'system') {
            // Use the helper function to safely extract text from system messages
            systemContent.push(extractTextFromMessageContent(m.content));
            return false;
        }
        return true;
    });

    if (systemContent.length > 0) {
        console.log('[Debug] systemContent before join:', systemContent);
        geminiRequest.systemInstruction = {
            parts: [{
                // Now systemContent is an array of strings, so join is safe
                text: systemContent.join('\n')
            }]
        };
    }

    // 2. Process the remaining messages, merging consecutive messages of the same role.
    if (otherMessages.length > 0) {
        let currentRole = null;
        let currentContentParts = [];

        for (const message of otherMessages) {
            const role = message.role === 'assistant' ? 'model' : message.role;

            if (role !== 'user' && role !== 'model') continue; // Ignore other roles

            const messageText = extractTextFromMessageContent(message.content);

            if (role === currentRole) {
                // If the role is the same, append the content.
                currentContentParts.push(messageText);
            } else {
                // If the role changes, push the previously accumulated content.
                if (currentRole) {
                    console.log('[Debug] currentContentParts before join (in loop):', currentContentParts);
                    geminiRequest.contents.push({
                        role: currentRole,
                        parts: [{
                            text: currentContentParts.join('\n')
                        }]
                    });
                }
                // Start a new content block for the new role.
                currentRole = role;
                currentContentParts = [messageText];
            }
        }

        // Push the last accumulated content block.
        if (currentRole) {
            console.log('[Debug] currentContentParts before join (at end):', currentContentParts);
            geminiRequest.contents.push({
                role: currentRole,
                parts: [{
                    text: currentContentParts.join('\n')
                }]
            });
        }
    }

    // 3. Basic validation and logging (the API will do the final validation)
    if (geminiRequest.contents.length > 0) {
        if (geminiRequest.contents[0].role !== 'user') {
            console.warn("[Request Conversion] Warning: Conversation doesn't start with a 'user' role. The API will likely reject this request.");
        }
        if (geminiRequest.contents.length > 0 && geminiRequest.contents[geminiRequest.contents.length - 1].role !== 'user') {
            console.warn("[Request Conversion] Warning: The last message in the conversation is not from the 'user'. The API may reject this request.");
        }
    }


    console.log('[Server] Converted Gemini Request (before core processing):', JSON.stringify(geminiRequest, null, 2));

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
        usage: {
            prompt_tokens: 0, // Note: Gemini API doesn't provide token counts
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
    };
}

// --- Authorization ---
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
        apiServiceInstance = new GeminiApiService(HOST);
        await apiServiceInstance.initialize();
    } else if (!apiServiceInstance.isInitialized) { // Ensure re-initialization if not already initialized
        await apiServiceInstance.initialize();
    }
    return apiServiceInstance;
}

async function handleStreamRequest(res, service, model, requestBody) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    const stream = service.generateContentStream(model, requestBody);
    console.log('[Server Response Stream]');
    process.stdout.write('> ');
    try {
        for await (const chunk of stream) {
            const openAIChunk = toOpenAIStreamChunk(chunk, model);
            const chunkText = openAIChunk.choices[0].delta.content || "";
            if (chunkText) {
                process.stdout.write(chunkText);
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
    }
}

async function handleUnaryRequest(res, service, model, requestBody) {
    const geminiResponse = await service.generateContent(model, requestBody);
    console.log('[Server] Raw Gemini Unary Response:', JSON.stringify(geminiResponse, null, 2)); // Add this line
    const openAIResponse = toOpenAIChatCompletion(geminiResponse, model);
    console.log('[Server Response Unary]');
    process.stdout.write('> ');
    const responseText = extractResponseText(geminiResponse);
    process.stdout.write(responseText);
    process.stdout.write('\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(openAIResponse));
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
        return res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing. Provide it in the `Authorization: Bearer <key>` header, as a `key` query parameter, or in the `x-goog-api-key` header.' } }));
    }

    try {
        const service = await getApiService();
        const expiryDate = service.authClient.credentials.expiry_date;
        console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(expiryDate)}`);
        
        if (req.method === 'GET' && requestUrl.pathname === '/v1/models') {
            const models = await service.listModels();
            const openAIModels = toOpenAIModelList(models.models.map(m => m.name.replace('models/', '')));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(openAIModels));
        }

        if (req.method === 'POST' && requestUrl.pathname === '/v1/chat/completions') {
            const openaiRequest = await getRequestBody(req);
            const model = openaiRequest.model;
            const geminiRequest = toGeminiRequest(openaiRequest);

            if (PROMPT_LOG_MODE !== 'none') {
                const promptText = extractPromptText(geminiRequest); // Use geminiRequest for logging
                await logPrompt(promptText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
            }

            if (openaiRequest.stream) {
                await handleStreamRequest(res, service, model, geminiRequest);
            } else {
                await handleUnaryRequest(res, service, model, geminiRequest);
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
    console.log(`--- OpenAI-Compatible Server Configuration ---`);
    console.log(`  Host: ${HOST}`);
    console.log(`  Port: ${SERVER_PORT}`);
    console.log(`  Required API Key: ${REQUIRED_API_KEY}`);
    console.log(`  Prompt Logging: ${PROMPT_LOG_MODE}${PROMPT_LOG_MODE === 'file' ? ` (to ${PROMPT_LOG_FILENAME})` : ''}`);
    console.log(`---------------------------------------------`);
    console.log(`\nServer running on http://${HOST}:${SERVER_PORT}`);
    console.log('Initializing backend service... This may take a moment.');
    getApiService().catch(err => {
        console.error("[Server] Pre-warming failed.", err.message);
    });
});
