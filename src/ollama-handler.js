/**
 * Ollama API 处理器
 * 处理Ollama特定的端点并在后端协议之间进行转换
 */

import { getRequestBody, handleError, MODEL_PROTOCOL_PREFIX, getProtocolPrefix, addModelPrefix, removeModelPrefix, addPrefixToModels } from './common.js';
import { convertData } from './convert.js';
import { ConverterFactory } from './converters/ConverterFactory.js';

// Ollama版本号
const OLLAMA_VERSION = '0.12.10';

/**
 * 处理 Ollama /api/tags 端点（列出模型）
 */
export async function handleOllamaTags(req, res, apiService, currentConfig, providerPoolManager) {
    try {
        console.log('[Ollama] Handling /api/tags request');
        
        const ollamaConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OLLAMA);
        
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
        const fetchPromises = [fetchProviderModels(currentConfig.MODEL_PROVIDER, apiService)];
        
        // Add provider pool fetches
        if (providerPoolManager?.providerPools) {
            const { getServiceAdapter } = await import('./adapter.js');
            
            for (const [providerType, providers] of Object.entries(providerPoolManager.providerPools)) {
                if (providerType === currentConfig.MODEL_PROVIDER) continue;
                
                const healthyProvider = providers.find(p => p.isHealthy);
                if (healthyProvider) {
                    const tempConfig = { ...currentConfig, ...healthyProvider, MODEL_PROVIDER: providerType };
                    const service = getServiceAdapter(tempConfig);
                    fetchPromises.push(fetchProviderModels(providerType, service));
                }
            }
        }
        
        // Execute all fetches in parallel
        const results = await Promise.all(fetchPromises);
        const allModels = results.flat();
        
        const response = { models: allModels };
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Server': `ollama/${OLLAMA_VERSION}`
        });
        res.end(JSON.stringify(response));
    } catch (error) {
        console.error('[Ollama Tags Error]', error);
        handleError(res, error);
    }
}

/**
 * 处理 Ollama /api/show 端点（显示模型信息）
 */
export async function handleOllamaShow(req, res) {
    try {
        console.log('[Ollama] Handling /api/show request');
        
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
        handleError(res, error);
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
        handleError(res, error);
    }
}

/**
 * 处理 Ollama /api/chat 端点
 */
export async function handleOllamaChat(req, res, apiService, currentConfig, providerPoolManager) {
    try {
        console.log('[Ollama] Handling /api/chat request');
        
        const ollamaRequest = await getRequestBody(req);
        
        // Determine provider based on model name
        const { getProviderForModel } = await import('./model-provider-mapper.js');
        const rawModelName = ollamaRequest.model;
        const modelName = removeModelPrefix(rawModelName);
        ollamaRequest.model = modelName; // Use clean model name
        const detectedProvider = getProviderForModel(rawModelName, currentConfig.MODEL_PROVIDER);
        
        console.log(`[Ollama] Model: ${modelName}, Detected provider: ${detectedProvider}`);
        
        // If provider is different, get the appropriate service
        let actualApiService = apiService;
        let actualConfig = currentConfig;
        
        if (detectedProvider !== currentConfig.MODEL_PROVIDER && providerPoolManager) {
            // Select provider from pool
            const providerConfig = providerPoolManager.selectProvider(detectedProvider);
            if (providerConfig) {
                actualConfig = {
                    ...currentConfig,
                    ...providerConfig,
                    MODEL_PROVIDER: detectedProvider
                };
                
                // Get service adapter for the detected provider
                const { getServiceAdapter } = await import('./adapter.js');
                actualApiService = getServiceAdapter(actualConfig);
                console.log(`[Ollama] Switched to provider: ${detectedProvider}`);
            } else {
                console.warn(`[Ollama] No healthy provider found for ${detectedProvider}, using default`);
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
        handleError(res, error);
    }
}

/**
 * 处理 Ollama /api/generate 端点
 */
export async function handleOllamaGenerate(req, res, apiService, currentConfig, providerPoolManager) {
    try {
        console.log('[Ollama] Handling /api/generate request');
        
        const ollamaRequest = await getRequestBody(req);
        
        // Determine provider based on model name
        const { getProviderForModel } = await import('./model-provider-mapper.js');
        const rawModelName = ollamaRequest.model;
        const modelName = removeModelPrefix(rawModelName);
        ollamaRequest.model = modelName; // Use clean model name
        const detectedProvider = getProviderForModel(rawModelName, currentConfig.MODEL_PROVIDER);
        
        console.log(`[Ollama] Model: ${modelName}, Detected provider: ${detectedProvider}`);
        
        // If provider is different, get the appropriate service
        let actualApiService = apiService;
        let actualConfig = currentConfig;
        
        if (detectedProvider !== currentConfig.MODEL_PROVIDER && providerPoolManager) {
            // Select provider from pool
            const providerConfig = providerPoolManager.selectProvider(detectedProvider);
            if (providerConfig) {
                actualConfig = {
                    ...currentConfig,
                    ...providerConfig,
                    MODEL_PROVIDER: detectedProvider
                };
                
                // Get service adapter for the detected provider
                const { getServiceAdapter } = await import('./adapter.js');
                actualApiService = getServiceAdapter(actualConfig);
                console.log(`[Ollama] Switched to provider: ${detectedProvider}`);
            } else {
                console.warn(`[Ollama] No healthy provider found for ${detectedProvider}, using default`);
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
        handleError(res, error);
    }
}

