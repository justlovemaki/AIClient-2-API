/**
 * Ollama API 处理器
 * 处理Ollama特定的端点并在后端协议之间进行转换
 */

import { getRequestBody, handleError, MODEL_PROTOCOL_PREFIX, MODEL_PROVIDER, getProtocolPrefix } from '../utils/common.js';
import { convertData } from '../convert/convert.js';
import { ConverterFactory } from '../converters/ConverterFactory.js';

// Ollama版本号
/**
 * Model name prefix mapping for different providers
 * These prefixes are added to model names in the list for user visibility
 * but are removed before sending to actual providers
 */
export const MODEL_PREFIX_MAP = {
    [MODEL_PROVIDER.KIRO_API]: '[Kiro]',
    [MODEL_PROVIDER.CLAUDE_CUSTOM]: '[Claude]',
    [MODEL_PROVIDER.GEMINI_CLI]: '[Gemini CLI]',
    [MODEL_PROVIDER.OPENAI_CUSTOM]: '[OpenAI]',
    [MODEL_PROVIDER.QWEN_API]: '[Qwen CLI]',
    [MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES]: '[OpenAI Responses]',
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

const OLLAMA_VERSION = '0.12.10';

/**
 * Model to Provider Mapper
 * Maps model names to their corresponding providers
 */

/**
 * Get provider type for a given model name
 * @param {string} modelName - The model name to look up (may include prefix like "[Warp] gpt-5")
 * @param {string} defaultProvider - The default provider if no match is found
 * @returns {string} The provider type
 */
export function getProviderForModel(modelName, defaultProvider) {
    if (!modelName) {
        return defaultProvider;
    }

    // First, check if model name has a prefix that directly indicates the provider
    const providerFromPrefix = getProviderFromPrefix(modelName);
    if (providerFromPrefix) {
        return providerFromPrefix;
    }
    
    // Remove prefix for further analysis
    const cleanModelName = removeModelPrefix(modelName);
    const lowerModel = cleanModelName.toLowerCase();

    // Gemini models
    if (lowerModel.includes('gemini')) {
        return MODEL_PROVIDER.GEMINI_CLI;
    }

    // Claude models (excluding Warp's claude models)
    if (lowerModel.includes('claude')) {
        // Check if it's a Kiro model
        if (lowerModel.includes('amazonq')) {
            return MODEL_PROVIDER.KIRO_API;
        }
        return MODEL_PROVIDER.CLAUDE_CUSTOM;
    }

    // Qwen models
    if (lowerModel.includes('qwen')) {
        return MODEL_PROVIDER.QWEN_API;
    }

    // OpenAI models (excluding Warp's gpt models)
    if (lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3')) {
        return MODEL_PROVIDER.OPENAI_CUSTOM;
    }

    // Default to the provided default provider
    return defaultProvider;
}

/**
 * Check if a model belongs to a specific provider
 * @param {string} modelName - The model name
 * @param {string} providerType - The provider type to check
 * @returns {boolean} True if the model belongs to the provider
 */
export function isModelFromProvider(modelName, providerType) {
    const detectedProvider = getProviderForModel(modelName, null);
    return detectedProvider === providerType;
}

/**
 * 规范化 Ollama 路径并检查是否为 Ollama 端点
 * @param {string} path - 原始路径
 * @param {URL} requestUrl - 请求 URL 对象
 * @returns {Object} - { normalizedPath: string, isOllamaEndpoint: boolean }
 */
export function normalizeOllamaPath(path, requestUrl) {
    let normalizedPath = path;
    
    // Normalize common Ollama path aliases (e.g., '/ollama/api/tags' -> '/api/tags')
    if (normalizedPath.startsWith('/ollama/')) {
        normalizedPath = normalizedPath.replace(/^\/ollama/, '');
        if (requestUrl) {
            requestUrl.pathname = normalizedPath;
        }
    }
    
    // Map other common aliases
    if (normalizedPath === '/api/models') {
        normalizedPath = '/api/tags';
        if (requestUrl) {
            requestUrl.pathname = normalizedPath;
        }
    }
    if (normalizedPath === '/api/tags/') {
        normalizedPath = '/api/tags';
        if (requestUrl) {
            requestUrl.pathname = normalizedPath;
        }
    }
    
    // Check if this is an Ollama endpoint
    const isOllamaEndpoint = normalizedPath.startsWith('/api/');
    
    return { normalizedPath, isOllamaEndpoint };
}

/**
 * 处理所有 Ollama 相关的路径规范化和端点路由
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {URL} requestUrl - 请求 URL 对象
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {Object} apiService - API 服务实例
 * @param {Object} currentConfig - 当前配置
 * @param {Object} providerPoolManager - 提供商池管理器
 * @returns {Object} - { handled: boolean, normalizedPath: string }
 */
export async function handleOllamaRequest(method, path, requestUrl, req, res, apiService, currentConfig, providerPoolManager) {
    // Normalize Ollama paths
    const { normalizedPath } = normalizeOllamaPath(path, requestUrl);
    
    // Handle Ollama endpoints before auth check
    const ollamaHandledBeforeAuth = await handleOllamaEndpointsBeforeAuth(method, normalizedPath, req, res);
    if (ollamaHandledBeforeAuth) {
        return { handled: true, normalizedPath };
    }
    
    // Handle Ollama endpoints after auth check
    const ollamaHandledAfterAuth = await handleOllamaEndpointsAfterAuth(method, normalizedPath, req, res, apiService, currentConfig, providerPoolManager);
    if (ollamaHandledAfterAuth) {
        return { handled: true, normalizedPath };
    }
    
    return { handled: false, normalizedPath };
}

/**
 * 处理 Ollama 端点路由（在认证检查之前）
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @returns {boolean} - 是否已处理请求
 */
export async function handleOllamaEndpointsBeforeAuth(method, path, req, res) {
    // Handle Ollama API endpoints BEFORE auth check (Ollama doesn't use authentication by default)
    if (method === 'GET' && path === '/api/version') {
        handleOllamaVersion(res);
        return true;
    }
    
    return false;
}

/**
 * 处理 Ollama 端点路由（在认证检查之后）
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {Object} apiService - API 服务实例
 * @param {Object} currentConfig - 当前配置
 * @param {Object} providerPoolManager - 提供商池管理器
 * @returns {boolean} - 是否已处理请求
 */
export async function handleOllamaEndpointsAfterAuth(method, path, req, res, apiService, currentConfig, providerPoolManager) {
    // Handle Ollama endpoints that need apiService (after auth check)
    if (method === 'GET' && path === '/api/tags') {
        await handleOllamaTags(req, res, apiService, currentConfig, providerPoolManager);
        return true;
    }
    if (method === 'POST' && path === '/api/chat') {
        await handleOllamaChat(req, res, apiService, currentConfig, providerPoolManager);
        return true;
    }
    if (method === 'POST' && path === '/api/generate') {
        await handleOllamaGenerate(req, res, apiService, currentConfig, providerPoolManager);
        return true;
    }
    
    return false;
}

/**
 * 处理 Ollama /api/tags 端点（列出模型）
 * Note: apiService can be null when called before provider selection (e.g., from /ollama/api/tags)
 * In this case, we fetch models from all healthy providers in the pool
 */
export async function handleOllamaTags(req, res, apiService, currentConfig, providerPoolManager) {
    try {
        console.log('[Ollama] Handling /api/tags request');
        
        const ollamaConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OLLAMA);
        const { getServiceAdapter } = await import('../providers/adapter.js');
        
        // Helper to fetch and convert models from a provider
        const fetchProviderModels = async (providerType, service) => {
            try {
                const models = await service.listModels();
                const sourceProtocol = getProtocolPrefix(providerType);
                const tags = ollamaConverter.convertModelList(models, sourceProtocol);
                
                if (tags.models && Array.isArray(tags.models)) {
                    return addPrefixToModels(tags.models, providerType, 'ollama');
                }
                return [];
            } catch (error) {
                console.error(`[Ollama] Error from ${providerType}:`, error.message);
                return [];
            }
        };
        
        // Collect fetch promises
        const fetchPromises = [];
        const processedProviderTypes = new Set();
        
        // If apiService is provided, use it for the default provider
        if (apiService) {
            fetchPromises.push(fetchProviderModels(currentConfig.MODEL_PROVIDER, apiService));
            processedProviderTypes.add(currentConfig.MODEL_PROVIDER);
        }
        
        // Add provider pool fetches (for all healthy providers)
        if (providerPoolManager?.providerPools) {
            for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
                // Skip if already processed
                if (processedProviderTypes.has(providerType)) continue;
                
                const healthyProvider = providers.find(p => p.isHealthy && !p.isDisabled);
                if (healthyProvider) {
                    const tempConfig = { ...currentConfig, ...healthyProvider, MODEL_PROVIDER: providerType };
                    const service = getServiceAdapter(tempConfig);
                    fetchPromises.push(fetchProviderModels(providerType, service));
                    processedProviderTypes.add(providerType);
                }
            }
        }
        
        // If no providers available, return empty list
        if (fetchPromises.length === 0) {
            console.warn('[Ollama] No healthy providers available to fetch models');
            const response = { models: [] };
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Server': `ollama/${OLLAMA_VERSION}`
            });
            res.end(JSON.stringify(response));
            return;
        }
        
        // Execute all fetches in parallel
        const results = await Promise.all(fetchPromises);
        const allModels = results.flat();
        
        console.log(`[Ollama] Fetched ${allModels.length} models from ${processedProviderTypes.size} provider(s)`);
        
        const response = { models: allModels };
        
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Server': `ollama/${OLLAMA_VERSION}`
        });
        res.end(JSON.stringify(response));
    } catch (error) {
        console.error('[Ollama Tags Error]', error);
        handleError(res, error, MODEL_PROTOCOL_PREFIX.OLLAMA);
    }
}

/**
 * 处理 Ollama /api/show 端点（显示模型信息）
 */
export async function handleOllamaShow(req, res) {
    try {
        // console.log('[Ollama] Handling /api/show request');
        
        const body = await getRequestBody(req);
        const modelName = body.name || body.model || 'unknown';
        
        const ollamaConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OLLAMA);
        const showResponse = ollamaConverter.toOllamaShowResponse(modelName);
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Server': `ollama/${OLLAMA_VERSION}`
        });
        res.end(JSON.stringify(showResponse));
    } catch (error) {
        console.error('[Ollama Show Error]', error);
        handleError(res, error, MODEL_PROTOCOL_PREFIX.OLLAMA);
    }
}

/**
 * 处理 Ollama /api/version 端点
 */
export function handleOllamaVersion(res) {
    try {
        const response = { version: OLLAMA_VERSION };
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Server': `ollama/${OLLAMA_VERSION}`
        });
        res.end(JSON.stringify(response));
    } catch (error) {
        console.error('[Ollama Version Error]', error);
        handleError(res, error, MODEL_PROTOCOL_PREFIX.OLLAMA);
    }
}

/**
 * 处理 Ollama /api/chat 端点
 * Note: apiService can be null when called before provider selection
 */
export async function handleOllamaChat(req, res, apiService, currentConfig, providerPoolManager) {
    try {
        console.log('[Ollama] Handling /api/chat request');
        
        const ollamaRequest = await getRequestBody(req);
        const { getServiceAdapter } = await import('../providers/adapter.js');
        
        // Determine provider based on model name
        const rawModelName = ollamaRequest.model;
        const modelName = removeModelPrefix(rawModelName);
        ollamaRequest.model = modelName; // Use clean model name
        const detectedProvider = getProviderForModel(rawModelName, currentConfig.MODEL_PROVIDER);
        
        console.log(`[Ollama] Model: ${modelName}, Detected provider: ${detectedProvider}`);
        
        // Get the appropriate service based on detected provider
        let actualApiService = apiService;
        let actualConfig = currentConfig;
        
        // If apiService is null or provider is different, get the appropriate service from pool
        if (!apiService || detectedProvider !== currentConfig.MODEL_PROVIDER) {
            if (providerPoolManager) {
                // Select provider from pool
                const providerConfig = providerPoolManager.selectProvider(detectedProvider, modelName, { skipUsageCount: true });
                if (providerConfig) {
                    actualConfig = {
                        ...currentConfig,
                        ...providerConfig,
                        MODEL_PROVIDER: detectedProvider
                    };
                    actualApiService = getServiceAdapter(actualConfig);
                    console.log(`[Ollama] Using provider from pool: ${detectedProvider}`);
                } else {
                    // No healthy provider in pool, try to create service directly
                    console.warn(`[Ollama] No healthy provider found for ${detectedProvider} in pool`);
                    if (!apiService) {
                        throw new Error(`No healthy provider available for ${detectedProvider}`);
                    }
                }
            } else if (!apiService) {
                // No pool manager and no apiService, try to create service directly
                actualConfig = { ...currentConfig, MODEL_PROVIDER: detectedProvider };
                actualApiService = getServiceAdapter(actualConfig);
                console.log(`[Ollama] Created service adapter for: ${detectedProvider}`);
            }
        }
        
        // Convert Ollama request to OpenAI format
        const ollamaConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OLLAMA);
        const openaiRequest = ollamaConverter.convertRequest(ollamaRequest, MODEL_PROTOCOL_PREFIX.OPENAI);
        
        // Get the source protocol from the actual provider
        const sourceProtocol = getProtocolPrefix(actualConfig.MODEL_PROVIDER);
        
        // Convert OpenAI format to backend provider format if needed
        let backendRequest = openaiRequest;
        if (sourceProtocol !== MODEL_PROTOCOL_PREFIX.OPENAI) {
            backendRequest = convertData(openaiRequest, 'request', MODEL_PROTOCOL_PREFIX.OPENAI, sourceProtocol);
        }
        
        // Handle streaming
        if (ollamaRequest.stream) {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Transfer-Encoding': 'chunked',
                'Access-Control-Allow-Origin': '*',
                'Server': `ollama/${OLLAMA_VERSION}`
            });
            
            const stream = await actualApiService.generateContentStream(openaiRequest.model, backendRequest);
            
            for await (const chunk of stream) {
                try {
                    // Convert backend chunk to Ollama format
                    const ollamaChunk = ollamaConverter.convertStreamChunk(chunk, sourceProtocol, ollamaRequest.model, false);
                    res.write(JSON.stringify(ollamaChunk) + '\n');
                } catch (chunkError) {
                    console.error('[Ollama] Error processing chunk:', chunkError);
                }
            }
            
            // Send final chunk
            const finalChunk = ollamaConverter.convertStreamChunk({}, sourceProtocol, ollamaRequest.model, true);
            res.write(JSON.stringify(finalChunk) + '\n');
            res.end();
        } else {
            // Non-streaming response
            const backendResponse = await actualApiService.generateContent(openaiRequest.model, backendRequest);
            const ollamaResponse = ollamaConverter.convertResponse(backendResponse, sourceProtocol, ollamaRequest.model);
            
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Server': `ollama/${OLLAMA_VERSION}`
            });
            res.end(JSON.stringify(ollamaResponse));
        }
    } catch (error) {
        console.error('[Ollama Chat Error]', error);
        handleError(res, error, MODEL_PROTOCOL_PREFIX.OLLAMA);
    }
}

/**
 * 处理 Ollama /api/generate 端点
 * Note: apiService can be null when called before provider selection
 */
export async function handleOllamaGenerate(req, res, apiService, currentConfig, providerPoolManager) {
    try {
        console.log('[Ollama] Handling /api/generate request');
        
        const ollamaRequest = await getRequestBody(req);
        const { getServiceAdapter } = await import('../providers/adapter.js');
        
        // Determine provider based on model name
        const rawModelName = ollamaRequest.model;
        const modelName = removeModelPrefix(rawModelName);
        ollamaRequest.model = modelName; // Use clean model name
        const detectedProvider = getProviderForModel(rawModelName, currentConfig.MODEL_PROVIDER);
        
        console.log(`[Ollama] Model: ${modelName}, Detected provider: ${detectedProvider}`);
        
        // Get the appropriate service based on detected provider
        let actualApiService = apiService;
        let actualConfig = currentConfig;
        
        // If apiService is null or provider is different, get the appropriate service from pool
        if (!apiService || detectedProvider !== currentConfig.MODEL_PROVIDER) {
            if (providerPoolManager) {
                // Select provider from pool
                const providerConfig = providerPoolManager.selectProvider(detectedProvider, modelName, { skipUsageCount: true });
                if (providerConfig) {
                    actualConfig = {
                        ...currentConfig,
                        ...providerConfig,
                        MODEL_PROVIDER: detectedProvider
                    };
                    actualApiService = getServiceAdapter(actualConfig);
                    console.log(`[Ollama] Using provider from pool: ${detectedProvider}`);
                } else {
                    // No healthy provider in pool, try to create service directly
                    console.warn(`[Ollama] No healthy provider found for ${detectedProvider} in pool`);
                    if (!apiService) {
                        throw new Error(`No healthy provider available for ${detectedProvider}`);
                    }
                }
            } else if (!apiService) {
                // No pool manager and no apiService, try to create service directly
                actualConfig = { ...currentConfig, MODEL_PROVIDER: detectedProvider };
                actualApiService = getServiceAdapter(actualConfig);
                console.log(`[Ollama] Created service adapter for: ${detectedProvider}`);
            }
        }
        
        // Convert Ollama request to OpenAI format
        const ollamaConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OLLAMA);
        const openaiRequest = ollamaConverter.convertRequest(ollamaRequest, MODEL_PROTOCOL_PREFIX.OPENAI);
        
        // Get the source protocol from the actual provider
        const sourceProtocol = getProtocolPrefix(actualConfig.MODEL_PROVIDER);
        
        // Convert OpenAI format to backend provider format if needed
        let backendRequest = openaiRequest;
        if (sourceProtocol !== MODEL_PROTOCOL_PREFIX.OPENAI) {
            backendRequest = convertData(openaiRequest, 'request', MODEL_PROTOCOL_PREFIX.OPENAI, sourceProtocol);
        }
        
        // Handle streaming
        if (ollamaRequest.stream) {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Transfer-Encoding': 'chunked',
                'Access-Control-Allow-Origin': '*',
                'Server': `ollama/${OLLAMA_VERSION}`
            });
            
            const stream = await actualApiService.generateContentStream(openaiRequest.model, backendRequest);
            
            for await (const chunk of stream) {
                try {
                    // Convert backend chunk to Ollama generate format
                    const ollamaChunk = ollamaConverter.toOllamaGenerateStreamChunk(chunk, ollamaRequest.model, false);
                    res.write(JSON.stringify(ollamaChunk) + '\n');
                } catch (chunkError) {
                    console.error('[Ollama] Error processing chunk:', chunkError);
                }
            }
            
            // Send final chunk
            const finalChunk = ollamaConverter.toOllamaGenerateStreamChunk({}, ollamaRequest.model, true);
            res.write(JSON.stringify(finalChunk) + '\n');
            res.end();
        } else {
            // Non-streaming response
            const backendResponse = await actualApiService.generateContent(openaiRequest.model, backendRequest);
            const ollamaResponse = ollamaConverter.toOllamaGenerateResponse(backendResponse, ollamaRequest.model);
            
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Server': `ollama/${OLLAMA_VERSION}`
            });
            res.end(JSON.stringify(ollamaResponse));
        }
    } catch (error) {
        console.error('[Ollama Generate Error]', error);
        handleError(res, error, MODEL_PROTOCOL_PREFIX.OLLAMA);
    }
}

