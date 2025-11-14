import { promises as fs } from 'fs';
import * as path from 'path';
import * as http from 'http'; // Add http for IncomingMessage and ServerResponse types
import * as crypto from 'crypto'; // Import crypto for MD5 hashing
import { ApiServiceAdapter } from './adapter.js'; // Import ApiServiceAdapter
import { convertData, getOpenAIStreamChunkStop, getOpenAIResponsesStreamChunkBegin, getOpenAIResponsesStreamChunkEnd } from './convert.js';
import { ProviderStrategyFactory } from './provider-strategies.js';
import { getApiService } from './service-manager.js';
import { getAllUniqueModels } from './warp/warp-models.js';

export const API_ACTIONS = {
    GENERATE_CONTENT: 'generateContent',
    STREAM_GENERATE_CONTENT: 'streamGenerateContent',
};

export const MODEL_PROTOCOL_PREFIX = {
    // Model provider constants
    GEMINI: 'gemini',
    OPENAI: 'openai',
    OPENAI_RESPONSES: 'openaiResponses',
    CLAUDE: 'claude',
    OLLAMA: 'ollama',
    WARP: 'warp',
}

export const MODEL_PROVIDER = {
    // Model provider constants
    GEMINI_CLI: 'gemini-cli-oauth',
    OPENAI_CUSTOM: 'openai-custom',
    OPENAI_CUSTOM_RESPONSES: 'openaiResponses-custom',
    CLAUDE_CUSTOM: 'claude-custom',
    KIRO_API: 'claude-kiro-oauth',
    QWEN_API: 'openai-qwen-oauth',
    WARP_API: 'warp-api',
}

/**
 * Model name prefix mapping for different providers
 * These prefixes are added to model names in the list for user visibility
 * but are removed before sending to actual providers
 */
export const MODEL_PREFIX_MAP = {
    [MODEL_PROVIDER.WARP_API]: '[Warp]',
    [MODEL_PROVIDER.KIRO_API]: '[Kiro]',
    [MODEL_PROVIDER.CLAUDE_CUSTOM]: '[Claude API]',
    [MODEL_PROVIDER.GEMINI_CLI]: '[Gemini CLI]',
    [MODEL_PROVIDER.OPENAI_CUSTOM]: '[OpenAI]',
    [MODEL_PROVIDER.QWEN_API]: '[Qwen CLI]',
    [MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES]: '[OpenAI Responses]',
}

/**
 * Extracts the protocol prefix from a given model provider string.
 * This is used to determine if two providers belong to the same underlying protocol (e.g., gemini, openai, claude).
 * @param {string} provider - The model provider string (e.g., 'gemini-cli', 'openai-custom').
 * @returns {string} The protocol prefix (e.g., 'gemini', 'openai', 'claude').
 */
export function getProtocolPrefix(provider) {
    const hyphenIndex = provider.indexOf('-');
    if (hyphenIndex !== -1) {
        const prefix = provider.substring(0, hyphenIndex);
        // Warp uses OpenAI-compatible protocol
        if (prefix === 'warp') {
            return MODEL_PROTOCOL_PREFIX.OPENAI;
        }
        return prefix;
    }
    return provider; // Return original if no hyphen is found
}

/**
 * Adds provider prefix to model name for display purposes
 * @param {string} modelName - Original model name
 * @param {string} provider - Provider type
 * @returns {string} Model name with prefix
 */
export function addModelPrefix(modelName, provider) {
    if (!modelName) return modelName;
    
    // Don't add prefix if already exists
    if (/^\[.*?\]\s+/.test(modelName)) {
        return modelName;
    }
    
    const prefix = MODEL_PREFIX_MAP[provider];
    if (!prefix) {
        return modelName;
    }
    return `${prefix} ${modelName}`;
}

/**
 * Removes provider prefix from model name before sending to provider
 * @param {string} modelName - Model name with possible prefix
 * @returns {string} Clean model name without prefix
 */
export function removeModelPrefix(modelName) {
    if (!modelName) {
        return modelName;
    }
    
    // Remove any prefix pattern like [Warp], [Kiro], etc.
    const prefixPattern = /^\[.*?\]\s+/;
    return modelName.replace(prefixPattern, '');
}

/**
 * Extracts provider type from prefixed model name
 * @param {string} modelName - Model name with possible prefix
 * @returns {string|null} Provider type or null if no prefix found
 */
export function getProviderFromPrefix(modelName) {
    if (!modelName) {
        return null;
    }
    
    const match = modelName.match(/^\[(.*?)\]/);
    if (!match) {
        return null;
    }
    
    const prefixText = `[${match[1]}]`;
    
    // Find provider by prefix
    for (const [provider, prefix] of Object.entries(MODEL_PREFIX_MAP)) {
        if (prefix === prefixText) {
            return provider;
        }
    }
    
    return null;
}

/**
 * Adds provider prefix to array of models (works with any format)
 * @param {Array} models - Array of model objects
 * @param {string} provider - Provider type
 * @param {string} format - Format type ('openai', 'gemini', 'ollama')
 * @returns {Array} Models with prefixed names
 */
export function addPrefixToModels(models, provider, format = 'openai') {
    if (!Array.isArray(models)) return models;
    
    return models.map(model => {
        if (format === 'openai') {
            return { ...model, id: addModelPrefix(model.id, provider) };
        } else if (format === 'ollama') {
            return {
                ...model,
                name: addModelPrefix(model.name, provider),
                model: addModelPrefix(model.model || model.name, provider)
            };
        } else {
            // gemini/claude format
            return {
                ...model,
                name: addModelPrefix(model.name, provider),
                displayName: model.displayName ? addModelPrefix(model.displayName, provider) : undefined
            };
        }
    });
}

/**
 * Determine which provider to use based on model name
 * @param {string} modelName - Model name (may include prefix like "[Warp] gpt-5")
 * @param {Object} providerPoolManager - Provider pool manager
 * @param {string} defaultProvider - Default provider
 * @returns {string} Provider type
 */
export function getProviderByModelName(modelName, providerPoolManager, defaultProvider) {
    if (!modelName || !providerPoolManager || !providerPoolManager.providerPools) {
        return defaultProvider;
    }
    
    // First, check if model name has a prefix that directly indicates the provider
    const providerFromPrefix = getProviderFromPrefix(modelName);
    if (providerFromPrefix) {
        console.log(`[Provider Selection] Provider determined from prefix: ${providerFromPrefix}`);
        return providerFromPrefix;
    }
    
    // Remove prefix for further analysis
    const cleanModelName = removeModelPrefix(modelName);
    const lowerModelName = cleanModelName.toLowerCase();
    
    // IMPORTANT: Check Warp models FIRST before checking GPT/Claude
    // Warp models include names like 'gpt-5', 'claude-4-sonnet' which would match other providers
    try {
        const warpModels = getAllUniqueModels();
        const isWarpModel = warpModels.some(m => m.id.toLowerCase() === lowerModelName);
        
        if (isWarpModel) {
            // Find available Warp provider
            for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
                if (providerType.includes('warp')) {
                    const healthyProvider = providers.find(p => p.isHealthy);
                    if (healthyProvider) {
                        return providerType;
                    }
                }
            }
        }
    } catch (error) {
        console.warn('[Provider Selection] Failed to check Warp models:', error.message);
    }
    
    // Check if it's a Claude model
    if (lowerModelName.includes('claude') || lowerModelName.includes('sonnet') || lowerModelName.includes('opus') || lowerModelName.includes('haiku')) {
        // Find available Claude provider
        for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
            if (providerType.includes('claude') || providerType.includes('kiro')) {
                const healthyProvider = providers.find(p => p.isHealthy);
                if (healthyProvider) {
                    return providerType;
                }
            }
        }
    }
    
    // Check if it's a Gemini model
    if (lowerModelName.includes('gemini')) {
        // Find available Gemini provider
        for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
            if (providerType.includes('gemini')) {
                const healthyProvider = providers.find(p => p.isHealthy);
                if (healthyProvider) {
                    return providerType;
                }
            }
        }
    }
    
    // Check if it's a Qwen model
    if (lowerModelName.includes('qwen')) {
        // Find available Qwen provider
        for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
            if (providerType.includes('qwen')) {
                const healthyProvider = providers.find(p => p.isHealthy);
                if (healthyProvider) {
                    return providerType;
                }
            }
        }
    }
    
    // Check if it's a GPT model
    if (lowerModelName.includes('gpt')) {
        // Find available OpenAI provider
        for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
            if (providerType.includes('openai')) {
                const healthyProvider = providers.find(p => p.isHealthy);
                if (healthyProvider) {
                    return providerType;
                }
            }
        }
    }
    
    return defaultProvider;
}

export const ENDPOINT_TYPE = {
    OPENAI_CHAT: 'openai_chat',
    OPENAI_RESPONSES: 'openai_responses',
    GEMINI_CONTENT: 'gemini_content',
    CLAUDE_MESSAGE: 'claude_message',
    OPENAI_MODEL_LIST: 'openai_model_list',
    GEMINI_MODEL_LIST: 'gemini_model_list',
};

export const FETCH_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'fetch_system_prompt.txt');
export const INPUT_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'input_system_prompt.txt');

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

/**
 * Reads the entire request body from an HTTP request.
 * @param {http.IncomingMessage} req - The HTTP request object.
 * @returns {Promise<Object>} A promise that resolves with the parsed JSON request body.
 * @throws {Error} If the request body is not valid JSON.
 */
export function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            if (!body) {
                return resolve({});
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error("Invalid JSON in request body."));
            }
        });
        req.on('error', err => {
            reject(err);
        });
    });
}

export async function logConversation(type, content, logMode, logFilename) {
    if (logMode === 'none') return;
    if (!content) return;

    const timestamp = new Date().toLocaleString();
    const logEntry = `${timestamp} [${type.toUpperCase()}]:\n${content}\n--------------------------------------\n`;

    if (logMode === 'console') {
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

/**
 * Checks if the request is authorized based on API key.
 * @param {http.IncomingMessage} req - The HTTP request object.
 * @param {URL} requestUrl - The parsed URL object.
 * @param {string} REQUIRED_API_KEY - The API key required for authorization.
 * @returns {boolean} True if authorized, false otherwise.
 */
export function isAuthorized(req, requestUrl, REQUIRED_API_KEY) {
    const authHeader = req.headers['authorization'];
    const queryKey = requestUrl.searchParams.get('key');
    const googApiKey = req.headers['x-goog-api-key'];
    const claudeApiKey = req.headers['x-api-key']; // Claude-specific header

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
    if (googApiKey === REQUIRED_API_KEY) {
        return true;
    }

    // Check for API key in x-api-key header (Claude style)
    if (claudeApiKey === REQUIRED_API_KEY) {
        return true;
    }

    console.log(`[Auth] Unauthorized request denied. Bearer: "${authHeader ? 'present' : 'N/A'}", Query Key: "${queryKey}", x-goog-api-key: "${googApiKey}", x-api-key: "${claudeApiKey}"`);
    return false;
}

/**
 * Handles the common logic for sending API responses (unary and stream).
 * This includes writing response headers, logging conversation, and logging auth token expiry.
 * @param {http.ServerResponse} res - The HTTP response object.
 * @param {Object} responsePayload - The actual response payload (string for unary, object for stream chunks).
 * @param {boolean} isStream - Whether the response is a stream.
 */
export async function handleUnifiedResponse(res, responsePayload, isStream) {
    if (isStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Transfer-Encoding": "chunked" });
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
    }

    if (isStream) {
        // Stream chunks are handled by the calling function that iterates the stream
    } else {
        res.end(responsePayload);
    }
}

export async function handleStreamRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid) {
    let fullResponseText = '';
    let fullResponseJson = '';
    let fullOldResponseJson = '';
    let responseClosed = false;

    await handleUnifiedResponse(res, '', true);

    // fs.writeFile('request'+Date.now()+'.json', JSON.stringify(requestBody));
    // The service returns a stream in its native format (toProvider).
    const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
    requestBody.model = model;
    const nativeStream = await service.generateContentStream(model, requestBody);
    const addEvent = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.CLAUDE || getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES;
    const openStop = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI ;

    try {
        for await (const nativeChunk of nativeStream) {
            // Extract text for logging purposes
            const chunkText = extractResponseText(nativeChunk, toProvider);
            if (chunkText && !Array.isArray(chunkText)) {
                fullResponseText += chunkText;
            }

            // Convert the complete chunk object to the client's format (fromProvider), if necessary.
            const chunkToSend = needsConversion
                ? convertData(nativeChunk, 'streamChunk', toProvider, fromProvider, model)
                : nativeChunk;

            if (!chunkToSend) {
                continue;
            }

            // 处理 chunkToSend 可能是数组或对象的情况
            const chunksToSend = Array.isArray(chunkToSend) ? chunkToSend : [chunkToSend];

            for (const chunk of chunksToSend) {
                if (addEvent) {
                    // fullOldResponseJson += chunk.type+"\n";
                    // fullResponseJson += chunk.type+"\n";
                    res.write(`event: ${chunk.type}\n`);
                    // console.log(`event: ${chunk.type}\n`);
                }

                // fullOldResponseJson += JSON.stringify(chunk)+"\n";
                // fullResponseJson += JSON.stringify(chunk)+"\n\n";
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                // console.log(`data: ${JSON.stringify(chunk)}\n`);
            }
        }
        if (openStop && needsConversion) {
            res.write(`data: ${JSON.stringify(getOpenAIStreamChunkStop(model))}\n\n`);
            // console.log(`data: ${JSON.stringify(getOpenAIStreamChunkStop(model))}\n`);
        }

    }  catch (error) {
        console.error('\n[Server] Error during stream processing:', error.stack);
        if (providerPoolManager) {
            console.log(`[Provider Pool] Marking ${toProvider} as unhealthy due to stream error`);
            // 如果是号池模式，并且请求处理失败，则标记当前使用的提供者为不健康
            providerPoolManager.markProviderUnhealthy(toProvider, {
                uuid: pooluuid
            });
        }

        if (!res.writableEnded) {
            const errorPayload = { error: { message: "An error occurred during streaming.", details: error.message } };
            res.end(JSON.stringify(errorPayload));
            responseClosed = true;
        }

    } finally {
        if (!responseClosed) {
            res.end();
        }
        await logConversation('output', fullResponseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
        // fs.writeFile('oldResponseChunk'+Date.now()+'.json', fullOldResponseJson);
        // fs.writeFile('responseChunk'+Date.now()+'.json', fullResponseJson);
    }
}

export async function handleUnaryRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid) {
    try{
        // The service returns the response in its native format (toProvider).
        const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
        requestBody.model = model;
        // fs.writeFile('oldRequest'+Date.now()+'.json', JSON.stringify(requestBody));
        const nativeResponse = await service.generateContent(model, requestBody);
        const responseText = extractResponseText(nativeResponse, toProvider);

        // Convert the response back to the client's format (fromProvider), if necessary.
        let clientResponse = nativeResponse;
        if (needsConversion) {
            console.log(`[Response Convert] Converting response from ${toProvider} to ${fromProvider}`);
            clientResponse = convertData(nativeResponse, 'response', toProvider, fromProvider, model);
        }

        //console.log(`[Response] Sending response to client: ${JSON.stringify(clientResponse)}`);
        await handleUnifiedResponse(res, JSON.stringify(clientResponse), false);
        await logConversation('output', responseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
        // fs.writeFile('oldResponse'+Date.now()+'.json', JSON.stringify(clientResponse));
    } catch (error) {
        console.error('\n[Server] Error during unary processing:', error.stack);
        if (providerPoolManager) {
            // 如果是号池模式，并且请求处理失败，则标记当前使用的提供者为不健康
            providerPoolManager.markProviderUnhealthy(toProvider, {
                uuid: pooluuid
            });
        }

        // 返回错误响应给客户端
        const errorResponse = {
            error: {
                message: error.message || "An error occurred during processing.",
                code: error.status || 500,
                details: error.stack
            }
        };
        await handleUnifiedResponse(res, JSON.stringify(errorResponse), false);
    }
}

/**
 * Handles requests for listing available models. It fetches models from the
 * service, transforms them to the format expected by the client (OpenAI, Claude, etc.),
 * and sends the JSON response.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {http.ServerResponse} res The HTTP response object.
 * @param {ApiServiceAdapter} service The API service adapter.
 * @param {string} endpointType The type of endpoint being called (e.g., OPENAI_MODEL_LIST).
 * @param {Object} CONFIG - The server configuration object.
 */
export async function handleModelListRequest(req, res, service, endpointType, CONFIG, providerPoolManager, pooluuid) {
    try{
        const clientProviderMap = {
            [ENDPOINT_TYPE.OPENAI_MODEL_LIST]: MODEL_PROTOCOL_PREFIX.OPENAI,
            [ENDPOINT_TYPE.GEMINI_MODEL_LIST]: MODEL_PROTOCOL_PREFIX.GEMINI,
        };


        const fromProvider = clientProviderMap[endpointType];
        const toProvider = CONFIG.MODEL_PROVIDER;

        if (!fromProvider) {
            throw new Error(`Unsupported endpoint type for model list: ${endpointType}`);
        }

        // Helper function to fetch and process models from a provider
        const fetchProviderModels = async (providerType, providerService) => {
            try {
                const models = await providerService.listModels();
                
                // Convert if necessary
                let converted = models;
                if (!getProtocolPrefix(providerType).includes(getProtocolPrefix(fromProvider))) {
                    converted = convertData(models, 'modelList', providerType, fromProvider);
                }
                
                // Determine format and add prefixes
                const format = fromProvider === MODEL_PROTOCOL_PREFIX.OPENAI ? 'openai' : 'gemini';
                if (converted?.models) {
                    return addPrefixToModels(converted.models, providerType, format);
                } else if (converted?.data) {
                    return addPrefixToModels(converted.data, providerType, format);
                }
                return [];
            } catch (error) {
                console.error(`[ModelList] Error from ${providerType}:`, error.message);
                return [];
            }
        };
        
        // Collect all fetch promises
        const fetchPromises = [];
        
        // 1. Fetch from current provider
        fetchPromises.push(fetchProviderModels(toProvider, service));
        
        // 2. Fetch from provider pools in parallel
        if (providerPoolManager?.providerPools) {
            const { getServiceAdapter } = await import('./adapter.js');
            
            for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
                if (providerType === toProvider) continue;
                
                const healthyProvider = providers.find(p => p.isHealthy);
                if (healthyProvider) {
                    const tempConfig = { ...CONFIG, ...healthyProvider, MODEL_PROVIDER: providerType };
                    const tempService = getServiceAdapter(tempConfig);
                    fetchPromises.push(fetchProviderModels(providerType, tempService));
                }
            }
        }
        
        // Execute all fetches in parallel and flatten results
        const results = await Promise.all(fetchPromises);
        const allModels = results.flat();
        
        // 3. Build final response in the correct format
        let finalResponse;
        if (fromProvider === MODEL_PROTOCOL_PREFIX.OPENAI) {
            // OpenAI format
            finalResponse = {
                object: 'list',
                data: allModels
            };
        } else {
            // Gemini/Claude format
            finalResponse = {
                models: allModels
            };
        }

        console.log(`[ModelList Response] Sending ${allModels.length} models to client`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(finalResponse));
    } catch (error) {
        console.error('\n[Server] Error during model list processing:', error.stack);
        if (providerPoolManager) {
            // 如果是号池模式，并且请求处理失败，则标记当前使用的提供者为不健康
            providerPoolManager.markProviderUnhealthy(toProvider, {
                uuid: pooluuid
            });
        }
    }
}

/**
 * Handles requests for content generation (both unary and streaming). This function
 * orchestrates request body parsing, conversion to the internal Gemini format,
 * logging, and dispatching to the appropriate stream or unary handler.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {http.ServerResponse} res The HTTP response object.
 * @param {ApiServiceAdapter} service The API service adapter.
 * @param {string} endpointType The type of endpoint being called (e.g., OPENAI_CHAT).
 * @param {Object} CONFIG - The server configuration object.
 * @param {string} PROMPT_LOG_FILENAME - The prompt log filename.
 */
export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid) {
    const originalRequestBody = await getRequestBody(req);
    if (!originalRequestBody) {
        throw new Error("Request body is missing for content generation.");
    }

    const clientProviderMap = {
        [ENDPOINT_TYPE.OPENAI_CHAT]: MODEL_PROTOCOL_PREFIX.OPENAI,
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES,
        [ENDPOINT_TYPE.CLAUDE_MESSAGE]: MODEL_PROTOCOL_PREFIX.CLAUDE,
        [ENDPOINT_TYPE.GEMINI_CONTENT]: MODEL_PROTOCOL_PREFIX.GEMINI,
    };

    const fromProvider = clientProviderMap[endpointType];
    
    if (!fromProvider) {
        throw new Error(`Unsupported endpoint type for content generation: ${endpointType}`);
    }

    // 1. Extract model first to determine the correct provider
    const { model: rawModel, isStream } = _extractModelAndStreamInfo(req, originalRequestBody, fromProvider);
    
    if (!rawModel) {
        throw new Error("Could not determine the model from the request.");
    }
    
    // Remove prefix from model name if present (e.g., "[Warp] gpt-5" -> "gpt-5")
    const model = removeModelPrefix(rawModel);
    console.log(`[Model Processing] Raw model: ${rawModel}, Clean model: ${model}`);
    
    // 2. Determine the correct provider based on model name
    const toProvider = getProviderByModelName(model, providerPoolManager, CONFIG.MODEL_PROVIDER);
    console.log(`[Provider Selection] Model: ${model}, Selected provider: ${toProvider}`);

    // 3. Convert request body from client format to backend format, if necessary.
    let processedRequestBody = originalRequestBody;
    // fs.writeFile('originalRequestBody'+Date.now()+'.json', JSON.stringify(originalRequestBody));
    if (getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider)) {
        console.log(`[Request Convert] Converting request from ${fromProvider} to ${toProvider}`);
        processedRequestBody = convertData(originalRequestBody, 'request', fromProvider, toProvider);
    } else {
        console.log(`[Request Convert] Request format matches backend provider. No conversion needed.`);
    }

    console.log(`[Content Generation] Model: ${model}, Stream: ${isStream}`);

    // 4. Apply system prompt from file if configured.
    processedRequestBody = await _applySystemPromptFromFile(CONFIG, processedRequestBody, toProvider);
    await _manageSystemPrompt(processedRequestBody, toProvider);

    // 5. Log the incoming prompt (after potential conversion to the backend's format).
    const promptText = extractPromptText(processedRequestBody, toProvider);
    await logConversation('input', promptText, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
    
    // 6. Get the correct service for the selected provider
    const correctService = await getApiService({ ...CONFIG, MODEL_PROVIDER: toProvider }, providerPoolManager);
    
    // 7. Call the appropriate stream or unary handler, passing the provider info.
    if (isStream) {
        await handleStreamRequest(res, correctService, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid);
    } else {
        await handleUnaryRequest(res, correctService, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid);
    }
}

/**
 * Helper function to extract model and stream information from the request.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {Object} requestBody The parsed request body.
 * @param {string} fromProvider The type of endpoint being called.
 * @returns {{model: string, isStream: boolean}} An object containing the model name and stream status.
 */
function _extractModelAndStreamInfo(req, requestBody, fromProvider) {
    const strategy = ProviderStrategyFactory.getStrategy(getProtocolPrefix(fromProvider));
    return strategy.extractModelAndStreamInfo(req, requestBody);
}

async function _applySystemPromptFromFile(config, requestBody, toProvider) {
    const strategy = ProviderStrategyFactory.getStrategy(getProtocolPrefix(toProvider));
    return strategy.applySystemPromptFromFile(config, requestBody);
}

export async function _manageSystemPrompt(requestBody, provider) {
    const strategy = ProviderStrategyFactory.getStrategy(getProtocolPrefix(provider));
    await strategy.manageSystemPrompt(requestBody);
}

// Helper functions for content extraction and conversion (from convert.js, but needed here)
export function extractResponseText(response, provider) {
    const strategy = ProviderStrategyFactory.getStrategy(getProtocolPrefix(provider));
    return strategy.extractResponseText(response);
}

export function extractPromptText(requestBody, provider) {
    const strategy = ProviderStrategyFactory.getStrategy(getProtocolPrefix(provider));
    return strategy.extractPromptText(requestBody);
}

export function handleError(res, error) {
    const statusCode = error.response?.status || 500;
    let errorMessage = error.message;
    let suggestions = [];

    // Provide detailed information and suggestions for different error types
    switch (statusCode) {
        case 401:
            errorMessage = 'Authentication failed. Please check your credentials.';
            suggestions = [
                'Verify your OAuth credentials are valid',
                'Try re-authenticating by deleting the credentials file',
                'Check if your Google Cloud project has the necessary permissions'
            ];
            break;
        case 403:
            errorMessage = 'Access forbidden. Insufficient permissions.';
            suggestions = [
                'Ensure your Google Cloud project has the Code Assist API enabled',
                'Check if your account has the necessary permissions',
                'Verify the project ID is correct'
            ];
            break;
        case 429:
            errorMessage = 'Too many requests. Rate limit exceeded.';
            suggestions = [
                'The request has been automatically retried with exponential backoff',
                'If the issue persists, try reducing the request frequency',
                'Consider upgrading your API quota if available'
            ];
            break;
        case 500:
        case 502:
        case 503:
        case 504:
            errorMessage = 'Server error occurred. This is usually temporary.';
            suggestions = [
                'The request has been automatically retried',
                'If the issue persists, try again in a few minutes',
                'Check Google Cloud status page for service outages'
            ];
            break;
        default:
            if (statusCode >= 400 && statusCode < 500) {
                errorMessage = `Client error (${statusCode}): ${error.message}`;
                suggestions = ['Check your request format and parameters'];
            } else if (statusCode >= 500) {
                errorMessage = `Server error (${statusCode}): ${error.message}`;
                suggestions = ['This is a server-side issue, please try again later'];
            }
    }

    console.error(`\n[Server] Request failed (${statusCode}): ${errorMessage}`);
    if (suggestions.length > 0) {
        console.error('[Server] Suggestions:');
        suggestions.forEach((suggestion, index) => {
            console.error(`  ${index + 1}. ${suggestion}`);
        });
    }
    console.error('[Server] Full error details:', error.stack);

    if (!res.headersSent) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    }

    const errorPayload = {
        error: {
            message: errorMessage,
            code: statusCode,
            suggestions: suggestions,
            details: error.response?.data
        }
    };
    res.end(JSON.stringify(errorPayload));
}

/**
 * 从请求体中提取系统提示词。
 * @param {Object} requestBody - 请求体对象。
 * @param {string} provider - 提供商类型（'openai', 'gemini', 'claude'）。
 * @returns {string} 提取到的系统提示词字符串。
 */
export function extractSystemPromptFromRequestBody(requestBody, provider) {
    let incomingSystemText = '';
    switch (provider) {
        case MODEL_PROTOCOL_PREFIX.OPENAI:
            const openaiSystemMessage = requestBody.messages?.find(m => m.role === 'system');
            if (openaiSystemMessage?.content) {
                incomingSystemText = openaiSystemMessage.content;
            } else if (requestBody.messages?.length > 0) {
                // Fallback to first user message if no system message
                const userMessage = requestBody.messages.find(m => m.role === 'user');
                if (userMessage) {
                    incomingSystemText = userMessage.content;
                }
            }
            break;
        case MODEL_PROTOCOL_PREFIX.GEMINI:
            const geminiSystemInstruction = requestBody.system_instruction || requestBody.systemInstruction;
            if (geminiSystemInstruction?.parts) {
                incomingSystemText = geminiSystemInstruction.parts
                    .filter(p => p?.text)
                    .map(p => p.text)
                    .join('\n');
            } else if (requestBody.contents?.length > 0) {
                // Fallback to first user content if no system instruction
                const userContent = requestBody.contents[0];
                if (userContent?.parts) {
                    incomingSystemText = userContent.parts
                        .filter(p => p?.text)
                        .map(p => p.text)
                        .join('\n');
                }
            }
            break;
        case MODEL_PROTOCOL_PREFIX.CLAUDE:
            if (typeof requestBody.system === 'string') {
                incomingSystemText = requestBody.system;
            } else if (typeof requestBody.system === 'object') {
                incomingSystemText = JSON.stringify(requestBody.system);
            } else if (requestBody.messages?.length > 0) {
                // Fallback to first user message if no system property
                const userMessage = requestBody.messages.find(m => m.role === 'user');
                if (userMessage) {
                    if (Array.isArray(userMessage.content)) {
                        incomingSystemText = userMessage.content.map(block => block.text).join('');
                    } else {
                        incomingSystemText = userMessage.content;
                    }
                }
            }
            break;
        default:
            console.warn(`[System Prompt] Unknown provider: ${provider}`);
            break;
    }
    return incomingSystemText;
}

/**
 * Generates an MD5 hash for a given object by first converting it to a JSON string.
 * @param {object} obj - The object to hash.
 * @returns {string} The MD5 hash of the object's JSON string representation.
 */
export function getMD5Hash(obj) {
    const jsonString = JSON.stringify(obj);
    return crypto.createHash('md5').update(jsonString).digest('hex');
}
