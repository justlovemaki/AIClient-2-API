import { promises as fs } from 'fs';
import * as path from 'path';
import * as http from 'http'; // Add http for IncomingMessage and ServerResponse types
import * as crypto from 'crypto'; // Import crypto for MD5 hashing
import logger from './logger.js';
import { convertData, getOpenAIStreamChunkStop } from '../convert/convert.js';
import { ProviderStrategyFactory } from './provider-strategies.js';
import { getPluginManager } from '../core/plugin-manager.js';

// ==================== 网络错误处理 ====================

/**
 * 可重试的网络错误标识列表
 * 这些错误可能出现在 error.code 或 error.message 中
 */
export const RETRYABLE_NETWORK_ERRORS = [
    'ECONNRESET',      // 连接被重置
    'ETIMEDOUT',       // 连接超时
    'ECONNREFUSED',    // 连接被拒绝
    'ENOTFOUND',       // DNS 解析失败
    'ENETUNREACH',     // 网络不可达
    'EHOSTUNREACH',    // 主机不可达
    'EPIPE',           // 管道破裂
    'EAI_AGAIN',       // DNS 临时失败
    'ECONNABORTED',    // 连接中止
    'ESOCKETTIMEDOUT', // Socket 超时
];

/**
 * 检查是否为可重试的网络错误
 * @param {Error} error - 错误对象
 * @returns {boolean} - 是否为可重试的网络错误
 */
export function isRetryableNetworkError(error) {
    if (!error) return false;
    
    const errorCode = error.code || '';
    const errorMessage = error.message || '';
    
    return RETRYABLE_NETWORK_ERRORS.some(errId =>
        errorCode === errId || errorMessage.includes(errId)
    );
}

// ==================== API 常量 ====================

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
    CODEX: 'codex',
    FORWARD: 'forward',
}

export const MODEL_PROVIDER = {
    // Model provider constants
    GEMINI_CLI: 'gemini-cli-oauth',
    ANTIGRAVITY: 'gemini-antigravity',
    OPENAI_CUSTOM: 'openai-custom',
    OPENAI_CUSTOM_RESPONSES: 'openaiResponses-custom',
    CLAUDE_CUSTOM: 'claude-custom',
    KIRO_API: 'claude-kiro-oauth',
    QWEN_API: 'openai-qwen-oauth',
    IFLOW_API: 'openai-iflow',
    CODEX_API: 'openai-codex-oauth',
    FORWARD_API: 'forward-api',
}

/**
 * Extracts the protocol prefix from a given model provider string.
 * This is used to determine if two providers belong to the same underlying protocol (e.g., gemini, openai, claude).
 * @param {string} provider - The model provider string (e.g., 'gemini-cli', 'openai-custom').
 * @returns {string} The protocol prefix (e.g., 'gemini', 'openai', 'claude').
 */
export function getProtocolPrefix(provider) {
    // Special case for Codex - it needs its own protocol
    if (provider === 'openai-codex-oauth') {
        return 'codex';
    }

    const hyphenIndex = provider.indexOf('-');
    if (hyphenIndex !== -1) {
        return provider.substring(0, hyphenIndex);
    }
    return provider; // Return original if no hyphen is found
}

export const ENDPOINT_TYPE = {
    OPENAI_CHAT: 'openai_chat',
    OPENAI_RESPONSES: 'openai_responses',
    GEMINI_CONTENT: 'gemini_content',
    CLAUDE_MESSAGE: 'claude_message',
    OPENAI_MODEL_LIST: 'openai_model_list',
    GEMINI_MODEL_LIST: 'gemini_model_list',
};

export const FETCH_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'configs', 'fetch_system_prompt.txt');
export const INPUT_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'configs', 'input_system_prompt.txt');

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
 * 格式化日志输出，统一日志格式
 * @param {string} tag - 日志标签，如 'Qwen', 'Kiro' 等
 * @param {string} message - 日志消息
 * @param {Object} [data] - 可选的数据对象，将被格式化输出
 * @returns {string} 格式化后的日志字符串
 */
export function formatLog(tag, message, data = null) {
    let logMessage = `[${tag}] ${message}`;
    
    if (data !== null && data !== undefined) {
        if (typeof data === 'object') {
            const dataStr = Object.entries(data)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
            logMessage += ` | ${dataStr}`;
        } else {
            logMessage += ` | ${data}`;
        }
    }
    
    return logMessage;
}

/**
 * 格式化凭证过期时间日志
 * @param {string} tag - 日志标签，如 'Qwen', 'Kiro' 等
 * @param {number} expiryDate - 过期时间戳
 * @param {number} nearMinutes - 临近过期的分钟数
 * @returns {{message: string, isNearExpiry: boolean}} 格式化后的日志字符串和是否临近过期
 */
export function formatExpiryLog(tag, expiryDate, nearMinutes) {
    const currentTime = Date.now();
    const nearMinutesInMillis = nearMinutes * 60 * 1000;
    const thresholdTime = currentTime + nearMinutesInMillis;
    const isNearExpiry = expiryDate <= thresholdTime;
    
    const message = formatLog(tag, 'Checking expiry date', {
        'Expiry date': expiryDate,
        'Current time': currentTime,
        [`${nearMinutes} minutes from now`]: thresholdTime,
        'Is near expiry': isNearExpiry
    });
    
    return { message, isNearExpiry };
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
        logger.info(logEntry);
    } else if (logMode === 'file') {
        try {
            // Append to the file
            await fs.appendFile(logFilename, logEntry);
        } catch (err) {
            logger.error(`[Error] Failed to write conversation log to ${logFilename}:`, err);
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

    logger.info(`[Auth] Unauthorized request denied. Bearer: "${authHeader ? 'present' : 'N/A'}", Query Key: "${queryKey}", x-goog-api-key: "${googApiKey}", x-api-key: "${claudeApiKey}"`);
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

export async function handleStreamRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid, customName, retryContext = null) {
    let fullResponseText = '';
    let fullResponseJson = '';
    let fullOldResponseJson = '';
    let responseClosed = false;
    
    // 重试上下文：包含 CONFIG 和重试计数
    // maxRetries: 凭证切换最大次数（跨凭证），默认 5 次
    const maxRetries = retryContext?.maxRetries ?? 5;
    const currentRetry = retryContext?.currentRetry ?? 0;
    const CONFIG = retryContext?.CONFIG;
    const isRetry = currentRetry > 0;
    
    // 使用共享的 clientDisconnected 状态（如果是重试，继承上层的状态）
    let clientDisconnected = retryContext?.clientDisconnected || { value: false };
    if (!isRetry) {
        clientDisconnected = { value: false }; // 使用对象引用，便于在递归中共享状态
    }

    // 监听客户端断开连接事件（命名函数，便于移除）
    const onClientClose = () => {
        clientDisconnected.value = true;
        logger.info('[Stream] Client disconnected, stopping stream processing');
    };
    
    const onClientError = (err) => {
        clientDisconnected.value = true;
        logger.error('[Stream] Response stream error:', err.message);
    };
    
    // 只在首次请求时注册事件监听器（避免重试时重复注册）
    if (!isRetry) {
        res.on('close', onClientClose);
        res.on('error', onClientError);
    }

    // 只在首次请求时发送响应头，重试时跳过（响应头已发送）
    if (!isRetry) {
        await handleUnifiedResponse(res, '', true);
    }

    // fs.writeFile('request'+Date.now()+'.json', JSON.stringify(requestBody));
    // The service returns a stream in its native format (toProvider).
    const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
    requestBody.model = model;
    const nativeStream = await service.generateContentStream(model, requestBody);
    const addEvent = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.CLAUDE || getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES;

    let hasToolCall = false;
    let hasMessageStop = false; // 跟踪是否已经发送过结束标志（message_stop / done）

    try {
        for await (const nativeChunk of nativeStream) {
            // 检查客户端是否已断开连接
            if (clientDisconnected.value) {
                logger.info('[Stream] Stopping iteration due to client disconnect');
                break;
            }
            
            // Extract text for logging purposes
            const chunkText = extractResponseText(nativeChunk, toProvider);
            if (chunkText && !Array.isArray(chunkText)) {
                fullResponseText += chunkText;
            }

            // Convert the complete chunk object to the client's format (fromProvider), if necessary.
            const chunkToSend = needsConversion
                ? convertData(nativeChunk, 'streamChunk', toProvider, fromProvider, model)
                : nativeChunk;

            // 监控钩子：流式响应分块
            if (CONFIG?._monitorRequestId) {
                try {
                    const pluginManager = getPluginManager();
                    await pluginManager.executeHook('onStreamChunk', {
                        nativeChunk,
                        chunkToSend,
                        fromProvider,
                        toProvider,
                        model,
                        requestId: CONFIG._monitorRequestId
                    });
                } catch (e) {}
            }

            if (!chunkToSend) {
                continue;
            }

            // 处理 chunkToSend 可能是数组或对象的情况
            const chunksToSend = Array.isArray(chunkToSend) ? chunkToSend : [chunkToSend];

            for (const chunk of chunksToSend) {
                // 再次检查客户端连接状态
                if (clientDisconnected.value) {
                    break;
                }
                
                // [FIX] 跟踪工具调用并在结束时修正 finish_reason
                // OpenAI 格式
                if (chunk.choices?.[0]?.delta?.tool_calls || chunk.choices?.[0]?.finish_reason === 'tool_calls') {
                    hasToolCall = true;
                }
                // Claude 格式
                if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
                    hasToolCall = true;
                }
                if (chunk.type === 'message_delta' && (chunk.delta?.stop_reason === 'tool_use' || chunk.stop_reason === 'tool_use')) {
                    hasToolCall = true;
                }
                // Gemini 格式
                if (chunk.candidates?.[0]?.content?.parts?.some(p => p.functionCall)) {
                    hasToolCall = true;
                }

                // 如果之前有工具调用，且当前 chunk 是正常结束，修正为 tool_calls / tool_use / FINISH_REASON_TOOL_CALLS
                if (hasToolCall && needsConversion) {
                    if (chunk.choices?.[0]?.finish_reason === 'stop') {
                        chunk.choices[0].finish_reason = 'tool_calls';
                    } else if (chunk.type === 'message_delta' && chunk.delta?.stop_reason === 'end_turn') {
                        chunk.delta.stop_reason = 'tool_use';
                    } else if (chunk.candidates?.[0]?.finishReason === 'STOP' || chunk.candidates?.[0]?.finishReason === 'stop') {
                        // 修正 Gemini 原生格式的结束原因
                        chunk.candidates[0].finishReason = 'TOOL_CALLS';
                    }
                }

                // 防止重复发送结束标志
                // OpenAI: choices[].finish_reason
                // Claude: message_stop
                // OpenAI Responses: done
                // Gemini: candidates[].finishReason（如 STOP / MAX_TOKENS / SAFETY 等）
                if (
                    chunk?.choices?.some(choice => choice?.finish_reason) ||
                    chunk?.type === 'message_stop' ||
                    chunk?.type === 'done' ||
                    chunk?.candidates?.some(candidate => candidate?.finishReason)
                ) {
                    hasMessageStop = true;
                }

                if (addEvent) {
                    // fullOldResponseJson += chunk.type+"\n";
                    // fullResponseJson += chunk.type+"\n";
                    if (!clientDisconnected.value && !res.writableEnded) {
                        try {
                            res.write(`event: ${chunk.type}\n`);
                        } catch (writeErr) {
                            logger.error('[Stream] Failed to write event:', writeErr.message);
                            clientDisconnected.value = true;
                            break;
                        }
                    }
                    // logger.info(`event: ${chunk.type}\n`);
                }

                // fullOldResponseJson += JSON.stringify(chunk)+"\n";
                // fullResponseJson += JSON.stringify(chunk)+"\n\n";
                if (!clientDisconnected.value && !res.writableEnded) {
                    try {
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    } catch (writeErr) {
                        logger.error('[Stream] Failed to write data:', writeErr.message);
                        clientDisconnected.value = true;
                        break;
                    }
                }
                // logger.info(`data: ${JSON.stringify(chunk)}\n`);
            }
        }

        // 流式请求成功完成，统计使用次数，错误次数重置为0
        if (providerPoolManager && pooluuid) {
            const customNameDisplay = customName ? `, ${customName}` : '';
            logger.info(`[Provider Pool] Increasing usage count for ${toProvider} (${pooluuid}${customNameDisplay}) after successful stream request`);
            providerPoolManager.markProviderHealthy(toProvider, {
                uuid: pooluuid
            });
        }

    }  catch (error) {
        logger.error('\n[Server] Error during stream processing:', error.stack);
        
        // 如果客户端已断开，不需要发送错误响应
        if (clientDisconnected.value) {
            logger.info('[Stream] Skipping error response due to client disconnect');
            responseClosed = true;
            return;
        }
        
        // 如果已经发送了内容，不进行重试（避免响应数据损坏）
        if (fullResponseText.length > 0) {
            logger.info(`[Stream Retry] Cannot retry: ${fullResponseText.length} bytes already sent to client`);
            // 直接发送错误并结束
            const errorPayload = createStreamErrorResponse(error, fromProvider);
            if (!res.writableEnded) {
                try {
                    res.write(errorPayload);
                    res.end();
                } catch (writeErr) {
                    logger.error('[Stream] Failed to write error response:', writeErr.message);
                }
            }
            responseClosed = true;
            return;
        }
        
        // 获取状态码（用于日志记录，不再用于判断是否重试）
        const status = error.response?.status;
        
        // 检查是否应该跳过错误计数（用于 429/5xx 等需要直接切换凭证的情况）
        const skipErrorCount = error.skipErrorCount === true;
        // 检查是否应该切换凭证（用于 429/5xx/402/403 等情况）
        const shouldSwitchCredential = error.shouldSwitchCredential === true;
        
        // 检查凭证是否已在底层被标记为不健康（避免重复标记）
        let credentialMarkedUnhealthy = error.credentialMarkedUnhealthy === true;
        
        // 如果底层未标记，且不跳过错误计数，则在此处标记
        if (!credentialMarkedUnhealthy && !skipErrorCount && providerPoolManager && pooluuid) {
            // 400 报错码通常是请求参数问题，不记录为提供商错误
            if (error.code === 400) {
                logger.info(`[Provider Pool] Skipping unhealthy marking for ${toProvider} (${pooluuid}) due to status 400 (client error)`);
            } else {
                logger.info(`[Provider Pool] Marking ${toProvider} as unhealthy due to stream error (status: ${status || 'unknown'})`);
                // 如果是号池模式，并且请求处理失败，则标记当前使用的提供者为不健康
                providerPoolManager.markProviderUnhealthy(toProvider, {
                    uuid: pooluuid
                }, error.message);
                credentialMarkedUnhealthy = true;
            }
        } else if (credentialMarkedUnhealthy) {
            logger.info(`[Provider Pool] Credential ${pooluuid} already marked as unhealthy by lower layer, skipping duplicate marking`);
        } else if (skipErrorCount) {
            logger.info(`[Provider Pool] Skipping error count for ${toProvider} (${pooluuid}) - will switch credential without marking unhealthy`);
        }
        
        // 如果需要切换凭证（无论是否标记不健康），都设置标记以触发重试
        if (shouldSwitchCredential && !credentialMarkedUnhealthy) {
            credentialMarkedUnhealthy = true; // 触发下面的重试逻辑
        }
        
        // 凭证已被标记为不健康后，尝试切换到新凭证重试
        // 不再依赖状态码判断，只要凭证被标记不健康且可以重试，就尝试切换
        if (credentialMarkedUnhealthy && currentRetry < maxRetries && providerPoolManager && CONFIG) {
            // 增加10秒内的随机等待时间，避免所有请求同时切换凭证
            const randomDelay = Math.floor(Math.random() * 10000); // 0-10000毫秒
            logger.info(`[Stream Retry] Credential marked unhealthy. Waiting ${randomDelay}ms before retry ${currentRetry + 1}/${maxRetries} with different credential...`);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
            
            try {
                // 动态导入以避免循环依赖
                const { getApiServiceWithFallback } = await import('../services/service-manager.js');
                const result = await getApiServiceWithFallback(CONFIG, model);
                
                if (result && result.service) {
                    logger.info(`[Stream Retry] Switched to new credential: ${result.uuid} (provider: ${result.actualProviderType})`);
                    
                    // 使用新服务重试
                    const newRetryContext = {
                        ...retryContext,
                        CONFIG,
                        currentRetry: currentRetry + 1,
                        maxRetries,
                        clientDisconnected  // 传递断开状态
                    };
                    
                    // 递归调用，使用新的服务
                    return await handleStreamRequest(
                        res,
                        result.service,
                        result.actualModel || model,
                        requestBody,
                        fromProvider,
                        result.actualProviderType || toProvider,
                        PROMPT_LOG_MODE,
                        PROMPT_LOG_FILENAME,
                        providerPoolManager,
                        result.uuid,
                        result.serviceConfig?.customName || customName,
                        newRetryContext
                    );
                } else {
                    logger.info(`[Stream Retry] No healthy credential available for retry.`);
                }
            } catch (retryError) {
                logger.error(`[Stream Retry] Failed to get alternative service:`, retryError.message);
            }
        }

        // 使用新方法创建符合 fromProvider 格式的流式错误响应
        const errorPayload = createStreamErrorResponse(error, fromProvider);
        if (!clientDisconnected.value && !res.writableEnded) {
            try {
                res.write(errorPayload);
                res.end();
            } catch (writeErr) {
                logger.error('[Stream] Failed to write error response:', writeErr.message);
            }
        }
        responseClosed = true;
    } finally {
        // 只在首次请求时移除事件监听器（避免重试时误删）
        if (!isRetry) {
            res.off('close', onClientClose);
            res.off('error', onClientError);
        }
        
        // 只在非重试或重试失败时才发送结束标记
        // 如果是重试成功，递归调用会处理结束标记
        if (!responseClosed && !clientDisconnected.value && !isRetry) {
            // 根据客户端协议发送相应的流式结束标记
            const clientProtocol = getProtocolPrefix(fromProvider);
            if (!res.writableEnded) {
                try {
                    if (clientProtocol === MODEL_PROTOCOL_PREFIX.OPENAI) {
                        if (!hasMessageStop) {
                            res.write('data: [DONE]\n\n');
                            hasMessageStop = true;
                        }
                    } else if (clientProtocol === MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES) {
                        if (!hasMessageStop) {
                            res.write('event: done\n');
                            res.write('data: {}\n\n');
                            hasMessageStop = true;
                        }
                    } else if (clientProtocol === MODEL_PROTOCOL_PREFIX.CLAUDE) {
                        if (!hasMessageStop) {
                            res.write('event: message_stop\n');
                            res.write('data: {"type":"message_stop"}\n\n');
                            hasMessageStop = true;
                        }
                    } else if (clientProtocol === MODEL_PROTOCOL_PREFIX.GEMINI) {
                        if (!hasMessageStop) {
                            res.write('data: {"candidates":[{"finishReason":"STOP"}]}\n\n');
                            hasMessageStop = true;
                        }
                    }
                    res.end();
                } catch (writeErr) {
                    logger.error('[Stream] Failed to write completion marker:', writeErr.message);
                }
            }
        }
        
        // 只在首次请求时记录日志（避免重试时重复记录）
        if (!isRetry) {
            await logConversation('output', fullResponseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
        }
        // fs.writeFile('oldResponseChunk'+Date.now()+'.json', fullOldResponseJson);
        // fs.writeFile('responseChunk'+Date.now()+'.json', fullResponseJson);
    }
}


export async function handleUnaryRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid, customName, retryContext = null) {
    // 重试上下文：包含 CONFIG 和重试计数
    // maxRetries: 凭证切换最大次数（跨凭证），默认 5 次
    const maxRetries = retryContext?.maxRetries ?? 5;
    const currentRetry = retryContext?.currentRetry ?? 0;
    const CONFIG = retryContext?.CONFIG;
    
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
            logger.info(`[Response Convert] Converting response from ${toProvider} to ${fromProvider}`);
            clientResponse = convertData(nativeResponse, 'response', toProvider, fromProvider, model);
        }

        // 监控钩子：非流式响应
        if (CONFIG?._monitorRequestId) {
            try {
                const pluginManager = getPluginManager();
                await pluginManager.executeHook('onUnaryResponse', {
                    nativeResponse,
                    clientResponse,
                    fromProvider,
                    toProvider,
                    model,
                    requestId: CONFIG._monitorRequestId
                });
            } catch (e) {}
        }

        //logger.info(`[Response] Sending response to client: ${JSON.stringify(clientResponse)}`);
        await handleUnifiedResponse(res, JSON.stringify(clientResponse), false);
        await logConversation('output', responseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
        // fs.writeFile('oldResponse'+Date.now()+'.json', JSON.stringify(clientResponse));
        
        // 一元请求成功完成，统计使用次数，错误次数重置为0
        if (providerPoolManager && pooluuid) {
            const customNameDisplay = customName ? `, ${customName}` : '';
            logger.info(`[Provider Pool] Increasing usage count for ${toProvider} (${pooluuid}${customNameDisplay}) after successful unary request`);
            providerPoolManager.markProviderHealthy(toProvider, {
                uuid: pooluuid
            });
        }
    } catch (error) {
        logger.error('\n[Server] Error during unary processing:', error.stack);
        
        // 获取状态码（用于日志记录，不再用于判断是否重试）
        const status = error.response?.status;
        
        // 检查是否应该跳过错误计数（用于 429/5xx 等需要直接切换凭证的情况）
        const skipErrorCount = error.skipErrorCount === true;
        // 检查是否应该切换凭证（用于 429/5xx/402/403 等情况）
        const shouldSwitchCredential = error.shouldSwitchCredential === true;
        
        // 检查凭证是否已在底层被标记为不健康（避免重复标记）
        let credentialMarkedUnhealthy = error.credentialMarkedUnhealthy === true;
        
        // 如果底层未标记，且不跳过错误计数，则在此处标记
        if (!credentialMarkedUnhealthy && !skipErrorCount && providerPoolManager && pooluuid) {
            // 400 报错码通常是请求参数问题，不记录为提供商错误
            if (error.code === 400) {
                logger.info(`[Provider Pool] Skipping unhealthy marking for ${toProvider} (${pooluuid}) due to status 400 (client error)`);
            } else {
                logger.info(`[Provider Pool] Marking ${toProvider} as unhealthy due to unary error (status: ${status || 'unknown'})`);
                // 如果是号池模式，并且请求处理失败，则标记当前使用的提供者为不健康
                providerPoolManager.markProviderUnhealthy(toProvider, {
                    uuid: pooluuid
                }, error.message);
                credentialMarkedUnhealthy = true;
            }
        } else if (credentialMarkedUnhealthy) {
            logger.info(`[Provider Pool] Credential ${pooluuid} already marked as unhealthy by lower layer, skipping duplicate marking`);
        } else if (skipErrorCount) {
            logger.info(`[Provider Pool] Skipping error count for ${toProvider} (${pooluuid}) - will switch credential without marking unhealthy`);
        }
        
        // 如果需要切换凭证（无论是否标记不健康），都设置标记以触发重试
        if (shouldSwitchCredential && !credentialMarkedUnhealthy) {
            credentialMarkedUnhealthy = true; // 触发下面的重试逻辑
        }
        
        // 凭证已被标记为不健康后，尝试切换到新凭证重试
        // 不再依赖状态码判断，只要凭证被标记不健康且可以重试，就尝试切换
        if (credentialMarkedUnhealthy && currentRetry < maxRetries && providerPoolManager && CONFIG) {
            // 增加10秒内的随机等待时间，避免所有请求同时切换凭证
            const randomDelay = Math.floor(Math.random() * 10000); // 0-10000毫秒
            logger.info(`[Unary Retry] Credential marked unhealthy. Waiting ${randomDelay}ms before retry ${currentRetry + 1}/${maxRetries} with different credential...`);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
            
            try {
                // 动态导入以避免循环依赖
                const { getApiServiceWithFallback } = await import('../services/service-manager.js');
                const result = await getApiServiceWithFallback(CONFIG, model);
                
                if (result && result.service) {
                    logger.info(`[Unary Retry] Switched to new credential: ${result.uuid} (provider: ${result.actualProviderType})`);
                    
                    // 使用新服务重试
                    const newRetryContext = {
                        ...retryContext,
                        CONFIG,
                        currentRetry: currentRetry + 1,
                        maxRetries
                    };
                    
                    // 递归调用，使用新的服务
                    return await handleUnaryRequest(
                        res,
                        result.service,
                        result.actualModel || model,
                        requestBody,
                        fromProvider,
                        result.actualProviderType || toProvider,
                        PROMPT_LOG_MODE,
                        PROMPT_LOG_FILENAME,
                        providerPoolManager,
                        result.uuid,
                        result.serviceConfig?.customName || customName,
                        newRetryContext
                    );
                } else {
                    logger.info(`[Unary Retry] No healthy credential available for retry.`);
                }
            } catch (retryError) {
                logger.error(`[Unary Retry] Failed to get alternative service:`, retryError.message);
            }
        }

        // 使用新方法创建符合 fromProvider 格式的错误响应
        const errorResponse = createErrorResponse(error, fromProvider);
        await handleUnifiedResponse(res, JSON.stringify(errorResponse), false);
    }
}

/**
 * Handles requests for listing available models. It fetches models from the
 * service, transforms them to the format expected by the client (OpenAI, Claude, etc.),
 * and sends the JSON response.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {http.ServerResponse} res The HTTP response object.
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

        // 1. Get the model list in the backend's native format.
        const nativeModelList = await service.listModels();
                
        // 2. Convert the model list to the client's expected format, if necessary.
        let clientModelList = nativeModelList;
        if (!getProtocolPrefix(toProvider).includes(getProtocolPrefix(fromProvider))) {
            logger.info(`[ModelList Convert] Converting model list from ${toProvider} to ${fromProvider}`);
            clientModelList = convertData(nativeModelList, 'modelList', toProvider, fromProvider);
        } else {
            logger.info(`[ModelList Convert] Model list format matches. No conversion needed.`);
        }

        logger.info(`[ModelList Response] Sending model list to client: ${JSON.stringify(clientModelList)}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clientModelList));
    } catch (error) {
        logger.error('\n[Server] Error during model list processing:', error.stack);
        if (providerPoolManager) {
            // 如果是号池模式，并且请求处理失败，则标记当前使用的提供者为不健康
            providerPoolManager.markProviderUnhealthy(toProvider, {
                uuid: pooluuid
            }, error.message);
        }
    }
}

/**
 * Handles requests for content generation (both unary and streaming). This function
 * orchestrates request body parsing, conversion to the internal Gemini format,
 * logging, and dispatching to the appropriate stream or unary handler.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {http.ServerResponse} res The HTTP response object.
 * @param {string} endpointType The type of endpoint being called (e.g., OPENAI_CHAT).
 * @param {Object} CONFIG - The server configuration object.
 * @param {string} PROMPT_LOG_FILENAME - The prompt log filename.
 */
export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid, requestPath = null) {
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
    // 使用实际的提供商类型（可能是 fallback 后的类型）
    let toProvider = CONFIG.actualProviderType || CONFIG.MODEL_PROVIDER;
    let actualUuid = pooluuid;
    
    if (!fromProvider) {
        throw new Error(`Unsupported endpoint type for content generation: ${endpointType}`);
    }

    // 2. Extract model and determine if the request is for streaming.
    let { model, isStream } = _extractModelAndStreamInfo(req, originalRequestBody, fromProvider);

    if (!model) {
        throw new Error("Could not determine the model from the request.");
    }
    logger.info(`[Content Generation] Model: ${model}, Stream: ${isStream}`);

    let actualCustomName = CONFIG.customName;

    // 2.5. 如果使用了提供商池，根据模型重新选择提供商（支持 Fallback）
    // 注意：这里使用 skipUsageCount: true，因为初次选择时已经增加了 usageCount
    if (providerPoolManager && CONFIG.providerPools && CONFIG.providerPools[CONFIG.MODEL_PROVIDER]) {
        const { getApiServiceWithFallback } = await import('../services/service-manager.js');
        const result = await getApiServiceWithFallback(CONFIG, model);
        
        service = result.service;
        toProvider = result.actualProviderType;
        actualUuid = result.uuid || pooluuid;
        actualCustomName = result.serviceConfig?.customName || CONFIG.customName;
        
        // 如果发生了模型级别的 fallback，需要更新请求使用的模型
        if (result.actualModel && result.actualModel !== model) {
            logger.info(`[Content Generation] Model Fallback: ${model} -> ${result.actualModel}`);
            model = result.actualModel;
        }

        if (result.isFallback) {
            logger.info(`[Content Generation] Fallback activated: ${CONFIG.MODEL_PROVIDER} -> ${toProvider} (uuid: ${actualUuid})`);
        } else {
            logger.info(`[Content Generation] Re-selected service adapter based on model: ${model}`);
        }
    }

    // 1. Convert request body from client format to backend format, if necessary.
    let processedRequestBody = originalRequestBody;
    // 将 _monitorRequestId 注入到 requestBody 中，以便在 service 内部访问
    if (CONFIG._monitorRequestId) {
        processedRequestBody._monitorRequestId = CONFIG._monitorRequestId;
    }

    // fs.writeFile('originalRequestBody'+Date.now()+'.json', JSON.stringify(originalRequestBody));
    if (getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider)) {
        logger.info(`[Request Convert] Converting request from ${fromProvider} to ${toProvider}`);
        processedRequestBody = convertData(originalRequestBody, 'request', fromProvider, toProvider);
    } else {
        logger.info(`[Request Convert] Request format matches backend provider. No conversion needed.`);
    }
    
    // 为 forward provider 添加原始请求路径作为 endpoint
    if (requestPath && toProvider === MODEL_PROVIDER.FORWARD_API) {
        logger.info(`[Forward API] Request path: ${requestPath}`);
        processedRequestBody.endpoint = requestPath;
    }

    // 3. Apply system prompt from file if configured.
    processedRequestBody = await _applySystemPromptFromFile(CONFIG, processedRequestBody, toProvider);
    await _manageSystemPrompt(processedRequestBody, toProvider);

    // 4. Log the incoming prompt (after potential conversion to the backend's format).
    const promptText = extractPromptText(processedRequestBody, toProvider);
    await logConversation('input', promptText, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
    
    // 5. Call the appropriate stream or unary handler, passing the provider info.
    // 创建重试上下文，包含 CONFIG 以便在认证错误时切换凭证重试
    // 凭证切换重试次数（默认 5），可在配置中自定义更大的值
    // 注意：这与底层的 429/5xx 重试（REQUEST_MAX_RETRIES）是不同层次的重试机制
    // - 底层重试：同一凭证遇到 429/5xx 时的重试
    // - 凭证切换重试：凭证被标记不健康后切换到其他凭证
    // 当没有不同的健康凭证可用时，重试会自动停止
    const credentialSwitchMaxRetries = CONFIG.CREDENTIAL_SWITCH_MAX_RETRIES || 5;
    const retryContext = providerPoolManager ? { CONFIG, currentRetry: 0, maxRetries: credentialSwitchMaxRetries } : null;
    
    if (isStream) {
        await handleStreamRequest(res, service, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, actualUuid, actualCustomName, retryContext);
    } else {
        await handleUnaryRequest(res, service, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, actualUuid, actualCustomName, retryContext);
    }

    if (CONFIG?._monitorRequestId) {
        // 执行插件钩子：内容生成后
        try {
            const pluginManager = getPluginManager();
            await pluginManager.executeHook('onContentGenerated', {
                ...CONFIG,
                originalRequestBody,
                processedRequestBody,
                fromProvider,
                toProvider,
                model,
                isStream
            });
        } catch (e) { /* 静默失败，不影响主流程 */ }
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

export function handleError(res, error, provider = null) {
    const statusCode = error.response?.status || error.statusCode || error.status || error.code || 500;
    let errorMessage = error.message;
    let suggestions = [];

    // 仅在没有传入错误信息时，才使用默认消息；否则只添加建议
    const hasOriginalMessage = error.message && error.message.trim() !== '';

    // 根据提供商获取适配的错误信息和建议
    const providerSuggestions = _getProviderSpecificSuggestions(statusCode, provider);
    
    // Provide detailed information and suggestions for different error types
    switch (statusCode) {
        case 401:
            errorMessage = 'Authentication failed. Please check your credentials.';
            suggestions = providerSuggestions.auth;
            break;
        case 403:
            errorMessage = 'Access forbidden. Insufficient permissions.';
            suggestions = providerSuggestions.permission;
            break;
        case 429:
            errorMessage = 'Too many requests. Rate limit exceeded.';
            suggestions = providerSuggestions.rateLimit;
            break;
        case 500:
        case 502:
        case 503:
        case 504:
            errorMessage = 'Server error occurred. This is usually temporary.';
            suggestions = providerSuggestions.serverError;
            break;
        default:
            if (statusCode >= 400 && statusCode < 500) {
                errorMessage = `Client error (${statusCode}): ${error.message}`;
                suggestions = providerSuggestions.clientError;
            } else if (statusCode >= 500) {
                errorMessage = `Server error (${statusCode}): ${error.message}`;
                suggestions = providerSuggestions.serverError;
            }
    }

    errorMessage = hasOriginalMessage ? error.message.trim() : errorMessage;
    logger.error(`\n[Server] Request failed (${statusCode}): ${errorMessage}`);
    if (suggestions.length > 0) {
        logger.error('[Server] Suggestions:');
        suggestions.forEach((suggestion, index) => {
            logger.error(`  ${index + 1}. ${suggestion}`);
        });
    }
    logger.error('[Server] Full error details:', error.stack);

    // 检查响应流是否已关闭或结束
    if (res.writableEnded || res.destroyed) {
        logger.warn('[Server] Response already ended or destroyed, skipping error response');
        return;
    }

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
    
    try {
        res.end(JSON.stringify(errorPayload));
    } catch (writeError) {
        logger.error('[Server] Failed to write error response:', writeError.message);
    }
}

/**
 * 根据提供商类型获取适配的错误建议
 * @param {number} statusCode - HTTP 状态码
 * @param {string|null} provider - 提供商类型
 * @returns {Object} 包含各类错误建议的对象
 */
function _getProviderSpecificSuggestions(statusCode, provider) {
    const protocolPrefix = provider ? getProtocolPrefix(provider) : null;
    
    // 默认/通用建议
    const defaultSuggestions = {
        auth: [
            'Verify your API key or credentials are valid',
            'Check if your credentials have expired',
            'Ensure the API key has the necessary permissions'
        ],
        permission: [
            'Check if your account has the necessary permissions',
            'Verify the API endpoint is accessible with your credentials',
            'Contact your administrator if permissions are restricted'
        ],
        rateLimit: [
            'The request has been automatically retried with exponential backoff',
            'If the issue persists, try reducing the request frequency',
            'Consider upgrading your API quota if available'
        ],
        serverError: [
            'The request has been automatically retried',
            'If the issue persists, try again in a few minutes',
            'Check the service status page for outages'
        ],
        clientError: [
            'Check your request format and parameters',
            'Verify the model name is correct',
            'Ensure all required fields are provided'
        ]
    };
    
    // 根据提供商返回特定建议
    switch (protocolPrefix) {
        case MODEL_PROTOCOL_PREFIX.GEMINI:
            return {
                auth: [
                    'Verify your OAuth credentials are valid',
                    'Try re-authenticating by deleting the credentials file',
                    'Check if your Google Cloud project has the necessary permissions'
                ],
                permission: [
                    'Ensure your Google Cloud project has the Gemini API enabled',
                    'Check if your account has the necessary permissions',
                    'Verify the project ID is correct'
                ],
                rateLimit: [
                    'The request has been automatically retried with exponential backoff',
                    'If the issue persists, try reducing the request frequency',
                    'Consider upgrading your Google Cloud API quota'
                ],
                serverError: [
                    'The request has been automatically retried',
                    'If the issue persists, try again in a few minutes',
                    'Check Google Cloud status page for service outages'
                ],
                clientError: [
                    'Check your request format and parameters',
                    'Verify the model name is a valid Gemini model',
                    'Ensure all required fields are provided'
                ]
            };
            
        case MODEL_PROTOCOL_PREFIX.OPENAI:
        case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
            return {
                auth: [
                    'Verify your OpenAI API key is valid',
                    'Check if your API key has expired or been revoked',
                    'Ensure the API key is correctly formatted (starts with sk-)'
                ],
                permission: [
                    'Check if your OpenAI account has access to the requested model',
                    'Verify your organization settings allow this operation',
                    'Ensure you have sufficient credits in your account'
                ],
                rateLimit: [
                    'The request has been automatically retried with exponential backoff',
                    'If the issue persists, try reducing the request frequency',
                    'Consider upgrading your OpenAI usage tier for higher limits'
                ],
                serverError: [
                    'The request has been automatically retried',
                    'If the issue persists, try again in a few minutes',
                    'Check OpenAI status page (status.openai.com) for outages'
                ],
                clientError: [
                    'Check your request format and parameters',
                    'Verify the model name is a valid OpenAI model',
                    'Ensure the message format is correct (role and content fields)'
                ]
            };
            
        case MODEL_PROTOCOL_PREFIX.CLAUDE:
            return {
                auth: [
                    'Verify your Anthropic API key is valid',
                    'Check if your API key has expired or been revoked',
                    'Ensure the x-api-key header is correctly set'
                ],
                permission: [
                    'Check if your Anthropic account has access to the requested model',
                    'Verify your account is in good standing',
                    'Ensure you have sufficient credits in your account'
                ],
                rateLimit: [
                    'The request has been automatically retried with exponential backoff',
                    'If the issue persists, try reducing the request frequency',
                    'Consider upgrading your Anthropic usage tier for higher limits'
                ],
                serverError: [
                    'The request has been automatically retried',
                    'If the issue persists, try again in a few minutes',
                    'Check Anthropic status page for service outages'
                ],
                clientError: [
                    'Check your request format and parameters',
                    'Verify the model name is a valid Claude model',
                    'Ensure the message format follows Anthropic API specifications'
                ]
            };
            
        case MODEL_PROTOCOL_PREFIX.OLLAMA:
            return {
                auth: [
                    'Ollama typically does not require authentication',
                    'If using a custom setup, verify your credentials',
                    'Check if the Ollama server requires authentication'
                ],
                permission: [
                    'Verify the Ollama server is accessible',
                    'Check if the requested model is available locally',
                    'Ensure the Ollama server allows the requested operation'
                ],
                rateLimit: [
                    'The local Ollama server may be overloaded',
                    'Try reducing concurrent requests',
                    'Consider increasing server resources if running locally'
                ],
                serverError: [
                    'Check if the Ollama server is running',
                    'Verify the server address and port are correct',
                    'Check Ollama server logs for detailed error information'
                ],
                clientError: [
                    'Check your request format and parameters',
                    'Verify the model name is available in your Ollama installation',
                    'Try pulling the model first with: ollama pull <model-name>'
                ]
            };
            
        default:
            return defaultSuggestions;
    }
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
            logger.warn(`[System Prompt] Unknown provider: ${provider}`);
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

/**
 * 将日期转换为系统本地时间格式
 * @param {string|number} dateInput - 日期字符串或时间戳
 * @returns {string} 格式化后的时间字符串
 */
export function formatToLocal(dateInput) {
    try {
        if (!dateInput) return '--';
        // 处理数值型时间戳（秒 -> 毫秒）
        let finalInput = dateInput;
        if (typeof dateInput === 'number' && dateInput < 10000000000) {
            finalInput = dateInput * 1000;
        }
        const date = new Date(finalInput);
        if (isNaN(date.getTime())) return '--';
        
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\//g, '-');
    } catch (e) {
        return '--';
    }
}


/**
 * 创建符合 fromProvider 格式的错误响应（非流式）
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {Object} 格式化的错误响应对象
 */
function createErrorResponse(error, fromProvider) {
    const protocolPrefix = getProtocolPrefix(fromProvider);
    const statusCode = error.status || error.code || 500;
    const errorMessage = error.message || "An error occurred during processing.";
    
    // 根据 HTTP 状态码映射错误类型
    const getErrorType = (code) => {
        if (code === 401) return 'authentication_error';
        if (code === 403) return 'permission_error';
        if (code === 429) return 'rate_limit_error';
        if (code >= 500) return 'server_error';
        return 'invalid_request_error';
    };
    
    // 根据 HTTP 状态码映射 Gemini 的 status
    const getGeminiStatus = (code) => {
        if (code === 400) return 'INVALID_ARGUMENT';
        if (code === 401) return 'UNAUTHENTICATED';
        if (code === 403) return 'PERMISSION_DENIED';
        if (code === 404) return 'NOT_FOUND';
        if (code === 429) return 'RESOURCE_EXHAUSTED';
        if (code >= 500) return 'INTERNAL';
        return 'UNKNOWN';
    };
    
    switch (protocolPrefix) {
        case MODEL_PROTOCOL_PREFIX.OPENAI:
            // OpenAI 非流式错误格式
            return {
                error: {
                    message: errorMessage,
                    type: getErrorType(statusCode),
                    code: getErrorType(statusCode)  // OpenAI 使用 code 字段作为核心判断
                }
            };
            
        case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
            // OpenAI Responses API 非流式错误格式
            return {
                error: {
                    type: getErrorType(statusCode),
                    message: errorMessage,
                    code: getErrorType(statusCode)
                }
            };
            
        case MODEL_PROTOCOL_PREFIX.CLAUDE:
            // Claude 非流式错误格式（外层有 type 标记）
            return {
                type: "error",  // 核心区分标记
                error: {
                    type: getErrorType(statusCode),  // Claude 使用 error.type 作为核心判断
                    message: errorMessage
                }
            };
            
        case MODEL_PROTOCOL_PREFIX.GEMINI:
            // Gemini 非流式错误格式（遵循 Google Cloud 标准）
            return {
                error: {
                    code: statusCode,
                    message: errorMessage,
                    status: getGeminiStatus(statusCode)  // Gemini 使用 status 作为核心判断
                }
            };
            
        default:
            // 默认使用 OpenAI 格式
            return {
                error: {
                    message: errorMessage,
                    type: getErrorType(statusCode),
                    code: getErrorType(statusCode)
                }
            };
    }
}

/**
 * 创建符合 fromProvider 格式的流式错误响应
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {string} 格式化的流式错误响应字符串
 */
function createStreamErrorResponse(error, fromProvider) {
    const protocolPrefix = getProtocolPrefix(fromProvider);
    const statusCode = error.status || error.code || 500;
    const errorMessage = error.message || "An error occurred during streaming.";
    
    // 根据 HTTP 状态码映射错误类型
    const getErrorType = (code) => {
        if (code === 401) return 'authentication_error';
        if (code === 403) return 'permission_error';
        if (code === 429) return 'rate_limit_error';
        if (code >= 500) return 'server_error';
        return 'invalid_request_error';
    };
    
    // 根据 HTTP 状态码映射 Gemini 的 status
    const getGeminiStatus = (code) => {
        if (code === 400) return 'INVALID_ARGUMENT';
        if (code === 401) return 'UNAUTHENTICATED';
        if (code === 403) return 'PERMISSION_DENIED';
        if (code === 404) return 'NOT_FOUND';
        if (code === 429) return 'RESOURCE_EXHAUSTED';
        if (code >= 500) return 'INTERNAL';
        return 'UNKNOWN';
    };
    
    switch (protocolPrefix) {
        case MODEL_PROTOCOL_PREFIX.OPENAI:
            // OpenAI 流式错误格式（SSE data 块）
            const openaiError = {
                error: {
                    message: errorMessage,
                    type: getErrorType(statusCode),
                    code: null
                }
            };
            return `data: ${JSON.stringify(openaiError)}\n\n`;
            
        case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
            // OpenAI Responses API 流式错误格式（SSE event + data）
            const responsesError = {
                id: `resp_${Date.now()}`,
                object: "error",
                created: Math.floor(Date.now() / 1000),
                error: {
                    type: getErrorType(statusCode),
                    message: errorMessage,
                    code: getErrorType(statusCode)
                }
            };
            return `event: error\ndata: ${JSON.stringify(responsesError)}\n\n`;
            
        case MODEL_PROTOCOL_PREFIX.CLAUDE:
            // Claude 流式错误格式（SSE event + data）
            const claudeError = {
                type: "error",
                error: {
                    type: getErrorType(statusCode),
                    message: errorMessage
                }
            };
            return `event: error\ndata: ${JSON.stringify(claudeError)}\n\n`;
            
        case MODEL_PROTOCOL_PREFIX.GEMINI:
            // Gemini 流式错误格式
            // 注意：虽然 Gemini 原生使用 JSON 数组，但在我们的实现中已经转换为 SSE 格式
            // 所以这里也需要使用 data: 前缀，保持与正常流式响应一致
            const geminiError = {
                error: {
                    code: statusCode,
                    message: errorMessage,
                    status: getGeminiStatus(statusCode)
                }
            };
            return `data: ${JSON.stringify(geminiError)}\n\n`;
            
        default:
            // 默认使用 OpenAI SSE 格式
            const defaultError = {
                error: {
                    message: errorMessage,
                    type: getErrorType(statusCode),
                    code: null
                }
            };
            return `data: ${JSON.stringify(defaultError)}\n\n`;
    }
}
