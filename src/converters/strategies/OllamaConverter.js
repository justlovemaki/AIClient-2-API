/**
 * Ollama转换器
 * 处理Ollama协议与其他协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';
import {
    OLLAMA_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_DEFAULT_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_45_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_45_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_HAIKU_45_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_HAIKU_45_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_OPUS_41_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_OPUS_41_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_SONNET_40_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_40_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_SONNET_37_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_37_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_OPUS_40_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_OPUS_40_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_HAIKU_35_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_HAIKU_30_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_HAIKU_30_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_SONNET_35_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_35_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_OPUS_30_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_OPUS_30_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_PRO_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_PRO_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_FLASH_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_IMAGE_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_IMAGE_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_LIVE_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_LIVE_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_TTS_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_TTS_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_20_FLASH_CONTEXT_LENGTH,
    OLLAMA_GEMINI_20_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_20_IMAGE_CONTEXT_LENGTH,
    OLLAMA_GEMINI_20_IMAGE_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_15_PRO_CONTEXT_LENGTH,
    OLLAMA_GEMINI_15_PRO_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_15_FLASH_CONTEXT_LENGTH,
    OLLAMA_GEMINI_15_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT4_TURBO_CONTEXT_LENGTH,
    OLLAMA_GPT4_TURBO_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT4_32K_CONTEXT_LENGTH,
    OLLAMA_GPT4_32K_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT4_BASE_CONTEXT_LENGTH,
    OLLAMA_GPT4_BASE_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT35_16K_CONTEXT_LENGTH,
    OLLAMA_GPT35_16K_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT35_BASE_CONTEXT_LENGTH,
    OLLAMA_GPT35_BASE_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_CODER_PLUS_CONTEXT_LENGTH,
    OLLAMA_QWEN_CODER_PLUS_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_VL_PLUS_CONTEXT_LENGTH,
    OLLAMA_QWEN_VL_PLUS_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_CODER_FLASH_CONTEXT_LENGTH,
    OLLAMA_QWEN_CODER_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_QWEN_DEFAULT_MAX_OUTPUT_TOKENS,
    OLLAMA_DEFAULT_FILE_TYPE,
    OLLAMA_DEFAULT_QUANTIZATION_VERSION,
    OLLAMA_DEFAULT_ROPE_FREQ_BASE,
    OLLAMA_DEFAULT_TEMPERATURE,
    OLLAMA_DEFAULT_TOP_P,
    OLLAMA_DEFAULT_QUANTIZATION_LEVEL,
    OLLAMA_SHOW_QUANTIZATION_LEVEL
} from '../utils.js';



/**
 * Ollama转换器类
 * 实现Ollama协议到其他协议的转换
 */
export class OllamaConverter extends BaseConverter {
    constructor() {
        super('ollama');
    }

    /**
     * 转换请求 - Ollama -> 其他协议
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toOpenAIRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换响应 - 其他协议 -> Ollama
     */
    convertResponse(data, sourceProtocol, model) {
        return this.toOllamaChatResponse(data, model);
    }

    /**
     * 转换流式响应块 - 其他协议 -> Ollama
     */
    convertStreamChunk(chunk, sourceProtocol, model, isDone = false) {
        return this.toOllamaStreamChunk(chunk, model, isDone);
    }

    /**
     * 转换模型列表 - 其他协议 -> Ollama
     */
    convertModelList(data, sourceProtocol) {
        return this.toOllamaTags(data, sourceProtocol);
    }

    // =========================================================================
    // Ollama -> OpenAI 转换
    // =========================================================================

    /**
     * Ollama请求 -> OpenAI请求
     */
    toOpenAIRequest(ollamaRequest) {
        const openaiRequest = {
            model: ollamaRequest.model || 'default',
            messages: [],
            stream: ollamaRequest.stream !== undefined ? ollamaRequest.stream : false
        };

        // Map Ollama messages to OpenAI format
        if (ollamaRequest.messages && Array.isArray(ollamaRequest.messages)) {
            openaiRequest.messages = ollamaRequest.messages.map(msg => ({
                role: msg.role || 'user',
                content: msg.content || ''
            }));
        }

        // Map Ollama options to OpenAI parameters
        if (ollamaRequest.options) {
            const opts = ollamaRequest.options;
            if (opts.temperature !== undefined) openaiRequest.temperature = opts.temperature;
            if (opts.top_p !== undefined) openaiRequest.top_p = opts.top_p;
            if (opts.top_k !== undefined) openaiRequest.top_k = opts.top_k;
            if (opts.num_predict !== undefined) openaiRequest.max_tokens = opts.num_predict;
            if (opts.stop !== undefined) openaiRequest.stop = opts.stop;
        }

        // Handle system prompt
        if (ollamaRequest.system) {
            openaiRequest.messages.unshift({
                role: 'system',
                content: ollamaRequest.system
            });
        }

        // Handle template/prompt for generate endpoint
        if (ollamaRequest.prompt) {
            openaiRequest.messages = [{
                role: 'user',
                content: ollamaRequest.prompt
            }];
            
            // Add system prompt if provided
            if (ollamaRequest.system) {
                openaiRequest.messages.unshift({
                    role: 'system',
                    content: ollamaRequest.system
                });
            }
        }

        return openaiRequest;
    }

    // =========================================================================
    // OpenAI/Claude/Gemini -> Ollama 转换
    // =========================================================================

    /**
     * OpenAI/Claude/Gemini响应 -> Ollama chat响应
     */
    toOllamaChatResponse(response, model) {
        const ollamaResponse = {
            model: model || response.model || 'unknown',
            created_at: new Date().toISOString(),
            done: true
        };

        // Handle OpenAI format (choices array)
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            ollamaResponse.message = {
                role: choice.message?.role || 'assistant',
                content: choice.message?.content || ''
            };

            // Map finish reason
            if (choice.finish_reason) {
                ollamaResponse.done_reason = choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason;
            }
        }
        // Handle Claude format (content array)
        else if (response.content && Array.isArray(response.content)) {
            let textContent = '';
            response.content.forEach(block => {
                if (block.type === 'text' && block.text) {
                    textContent += block.text;
                }
            });
            
            ollamaResponse.message = {
                role: response.role || 'assistant',
                content: textContent
            };

            if (response.stop_reason) {
                ollamaResponse.done_reason = response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason;
            }
        }
        // Handle Gemini format (candidates array)
        else if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            let textContent = '';
            if (candidate.content && candidate.content.parts) {
                textContent = candidate.content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join('');
            }
            
            ollamaResponse.message = {
                role: candidate.content?.role || 'assistant',
                content: textContent
            };

            if (candidate.finishReason) {
                ollamaResponse.done_reason = candidate.finishReason.toLowerCase();
            }
        }

        // Add usage statistics if available
        const usage = response.usage || response.usageMetadata;
        if (usage) {
            ollamaResponse.prompt_eval_count = usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount || 0;
            ollamaResponse.eval_count = usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount || 0;
            ollamaResponse.total_duration = 0;
            ollamaResponse.load_duration = 0;
            ollamaResponse.prompt_eval_duration = 0;
            ollamaResponse.eval_duration = 0;
        }

        return ollamaResponse;
    }

    /**
     * OpenAI/Claude/Gemini generate响应 -> Ollama generate响应
     */
    toOllamaGenerateResponse(response, model) {
        const ollamaResponse = {
            model: model || response.model || 'unknown',
            created_at: new Date().toISOString(),
            done: true
        };

        // Handle OpenAI format
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            ollamaResponse.response = choice.message?.content || choice.text || '';
            
            if (choice.finish_reason) {
                ollamaResponse.done_reason = choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason;
            }
        }
        // Handle Claude format
        else if (response.content && Array.isArray(response.content)) {
            let textContent = '';
            response.content.forEach(block => {
                if (block.type === 'text' && block.text) {
                    textContent += block.text;
                }
            });
            ollamaResponse.response = textContent;

            if (response.stop_reason) {
                ollamaResponse.done_reason = response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason;
            }
        }
        // Handle Gemini format
        else if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            let textContent = '';
            if (candidate.content && candidate.content.parts) {
                textContent = candidate.content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join('');
            }
            ollamaResponse.response = textContent;

            if (candidate.finishReason) {
                ollamaResponse.done_reason = candidate.finishReason.toLowerCase();
            }
        }

        // Add usage statistics
        const genUsage = response.usage || response.usageMetadata;
        if (genUsage) {
            ollamaResponse.prompt_eval_count = genUsage.prompt_tokens || genUsage.input_tokens || genUsage.promptTokenCount || 0;
            ollamaResponse.eval_count = genUsage.completion_tokens || genUsage.output_tokens || genUsage.candidatesTokenCount || 0;
            ollamaResponse.total_duration = 0;
            ollamaResponse.load_duration = 0;
            ollamaResponse.prompt_eval_duration = 0;
            ollamaResponse.eval_duration = 0;
        }

        return ollamaResponse;
    }

    /**
     * OpenAI/Claude/Gemini流式块 -> Ollama流式块
     */
    toOllamaStreamChunk(chunk, model, isDone = false) {
        const ollamaChunk = {
            model: model || 'unknown',
            created_at: new Date().toISOString(),
            done: isDone
        };

        // Handle Claude SSE format
        if (chunk.type) {
            if (chunk.type === 'content_block_delta' && chunk.delta) {
                ollamaChunk.message = {
                    role: 'assistant',
                    content: chunk.delta.text || ''
                };
            } else if (chunk.type === 'message_delta' && chunk.usage) {
                ollamaChunk.message = {
                    role: 'assistant',
                    content: ''
                };
                ollamaChunk.prompt_eval_count = 0;
                ollamaChunk.eval_count = chunk.usage.output_tokens || 0;
            } else {
                ollamaChunk.message = {
                    role: 'assistant',
                    content: ''
                };
            }
        }
        // Handle Gemini format
        else if (!isDone && chunk.candidates && chunk.candidates.length > 0) {
            const candidate = chunk.candidates[0];
            let content = '';
            if (candidate.content && candidate.content.parts) {
                content = candidate.content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join('');
            }
            ollamaChunk.message = {
                role: 'assistant',
                content: content
            };
        }
        // Handle OpenAI format
        else if (!isDone && chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            ollamaChunk.message = {
                role: delta.role || 'assistant',
                content: delta.content || ''
            };
        } 
        // Handle final chunk
        else if (isDone) {
            ollamaChunk.message = {
                role: 'assistant',
                content: ''
            };
            ollamaChunk.done_reason = 'stop';
        }

        return ollamaChunk;
    }

    /**
     * OpenAI/Claude/Gemini流式块 -> Ollama generate流式块
     */
    toOllamaGenerateStreamChunk(chunk, model, isDone = false) {
        const ollamaChunk = {
            model: model || 'unknown',
            created_at: new Date().toISOString(),
            done: isDone
        };

        // Handle Claude SSE format
        if (chunk.type) {
            if (chunk.type === 'content_block_delta' && chunk.delta) {
                ollamaChunk.response = chunk.delta.text || '';
            } else if (chunk.type === 'message_delta' && chunk.usage) {
                ollamaChunk.response = '';
                ollamaChunk.prompt_eval_count = 0;
                ollamaChunk.eval_count = chunk.usage.output_tokens || 0;
            } else {
                ollamaChunk.response = '';
            }
        }
        // Handle OpenAI format
        else if (!isDone && chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            ollamaChunk.response = delta.content || '';
        }
        // Handle final chunk
        else if (isDone) {
            ollamaChunk.response = '';
            ollamaChunk.done_reason = 'stop';
        }

        return ollamaChunk;
    }

    /**
     * OpenAI/Claude/Gemini模型列表 -> Ollama tags
     */
    toOllamaTags(modelList, sourceProtocol = null) {
        const models = [];

        // Handle both OpenAI format (data array) and Gemini format (models array)
        const sourceModels = modelList.data || modelList.models || [];
        
        if (Array.isArray(sourceModels)) {
            sourceModels.forEach(model => {
                // Get model name
                let modelName = model.id || model.name || model.displayName || 'unknown';
                
                // Remove "models/" prefix if present (for Gemini)
                if (modelName.startsWith('models/')) {
                    modelName = modelName.substring(7); // Remove "models/"
                }
                
                // Skip models with invalid names
                if (modelName === 'unknown' || !modelName) {
                    return;
                }
                
                // IMPORTANT: Copilot expects family: "Ollama" with capital O!
                const modelOwner = 'Ollama';
                
                models.push({
                    name: modelName,
                    model: modelName,
                    modified_at: new Date().toISOString(),
                    size: 0,  // As in the old patch
                    digest: '',  // Empty string, as in the old patch
                    details: {
                        parent_model: '',
                        format: 'gguf',
                        family: modelOwner,  // "Ollama" with capital O
                        families: [modelOwner],
                        parameter_size: '0B',  // As in the old patch
                        quantization_level: OLLAMA_DEFAULT_QUANTIZATION_LEVEL
                    }
                });
            });
        }

        return { models };
    }

    /**
     * Generate Ollama show response
     */
    toOllamaShowResponse(modelName) {
        // Minimal implementation, as in the old patch
        let contextLength = OLLAMA_DEFAULT_CONTEXT_LENGTH;
        let maxOutputTokens = OLLAMA_DEFAULT_MAX_OUTPUT_TOKENS;
        let family = 'Ollama';  // ВАЖНО: С большой буквы, как ожидает Copilot!
        let architecture = 'transformer';
        
        const lowerName = modelName.toLowerCase();
        
        // Determine contextLength by model name
        // Claude models
        if (lowerName.includes('claude')) {
            architecture = 'claude';
            contextLength = OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH; // Default 200K
            
            // Claude Sonnet 4.5
            if (lowerName.includes('sonnet-4-5') || lowerName.includes('sonnet-4.5')) {
                contextLength = OLLAMA_CLAUDE_SONNET_45_CONTEXT_LENGTH; // 200K (1M beta available)
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_45_MAX_OUTPUT_TOKENS; // 64K output
            }
            // Claude Haiku 4.5
            else if (lowerName.includes('haiku-4-5') || lowerName.includes('haiku-4.5')) {
                contextLength = OLLAMA_CLAUDE_HAIKU_45_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_45_MAX_OUTPUT_TOKENS; // 64K output
            }
            // Claude Opus 4.1
            else if (lowerName.includes('opus-4-1') || lowerName.includes('opus-4.1')) {
                contextLength = OLLAMA_CLAUDE_OPUS_41_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_OPUS_41_MAX_OUTPUT_TOKENS; // 32K output
            }
            // Claude Sonnet 4.0 (legacy)
            else if (lowerName.includes('sonnet-4-0') || lowerName.includes('sonnet-4.0') || lowerName.includes('sonnet-4-20')) {
                contextLength = OLLAMA_CLAUDE_SONNET_40_CONTEXT_LENGTH; // 200K (1M beta available)
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_40_MAX_OUTPUT_TOKENS; // 64K output
            }
            // Claude Sonnet 3.7 (legacy)
            else if (lowerName.includes('3-7') || lowerName.includes('3.7')) {
                contextLength = OLLAMA_CLAUDE_SONNET_37_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_37_MAX_OUTPUT_TOKENS; // 64K output (128K beta available)
            }
            // Claude Opus 4.0 (legacy)
            else if (lowerName.includes('opus-4-0') || lowerName.includes('opus-4.0') || lowerName.includes('opus-4-20')) {
                contextLength = OLLAMA_CLAUDE_OPUS_40_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_OPUS_40_MAX_OUTPUT_TOKENS; // 32K output
            }
            // Claude Haiku 3.5 (legacy)
            else if (lowerName.includes('haiku-3-5') || lowerName.includes('haiku-3.5')) {
                contextLength = OLLAMA_CLAUDE_HAIKU_35_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS; // 8K output
            }
            // Claude Haiku 3.0 (legacy)
            else if (lowerName.includes('haiku-3-0') || lowerName.includes('haiku-3.0') || lowerName.includes('haiku-20240307')) {
                contextLength = OLLAMA_CLAUDE_HAIKU_30_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_30_MAX_OUTPUT_TOKENS; // 4K output
            }
            // Claude Sonnet 3.5 (legacy)
            else if (lowerName.includes('sonnet-3-5') || lowerName.includes('sonnet-3.5')) {
                contextLength = OLLAMA_CLAUDE_SONNET_35_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_35_MAX_OUTPUT_TOKENS; // 8K output
            }
            // Claude Opus 3.0 (legacy)
            else if (lowerName.includes('opus-3-0') || lowerName.includes('opus-3.0') || lowerName.includes('opus') && lowerName.includes('20240229')) {
                contextLength = OLLAMA_CLAUDE_OPUS_30_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_OPUS_30_MAX_OUTPUT_TOKENS; // 4K output
            }
            // Default for Claude
            else {
                contextLength = OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS; // 8K output
            }
        }
        // Gemini models
        else if (lowerName.includes('gemini')) {
            architecture = 'gemini';
            
            // Gemini 2.5 Pro
            if (lowerName.includes('2.5') && lowerName.includes('pro')) {
                contextLength = OLLAMA_GEMINI_25_PRO_CONTEXT_LENGTH; // 1M input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_PRO_MAX_OUTPUT_TOKENS; // 65K output tokens
            }
            // Gemini 2.5 Flash / Flash-Lite
            else if (lowerName.includes('2.5') && (lowerName.includes('flash') || lowerName.includes('lite'))) {
                contextLength = OLLAMA_GEMINI_25_FLASH_CONTEXT_LENGTH; // 1M input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_FLASH_MAX_OUTPUT_TOKENS; // 65K output tokens
            }
            // Gemini 2.5 Flash Image
            else if (lowerName.includes('2.5') && lowerName.includes('image')) {
                contextLength = OLLAMA_GEMINI_25_IMAGE_CONTEXT_LENGTH; // 65K input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_IMAGE_MAX_OUTPUT_TOKENS; // 32K output tokens
            }
            // Gemini 2.5 Flash Live / Native Audio
            else if (lowerName.includes('2.5') && (lowerName.includes('live') || lowerName.includes('native-audio'))) {
                contextLength = OLLAMA_GEMINI_25_LIVE_CONTEXT_LENGTH; // 131K input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_LIVE_MAX_OUTPUT_TOKENS; // 8K output tokens
            }
            // Gemini 2.5 TTS
            else if (lowerName.includes('2.5') && lowerName.includes('tts')) {
                contextLength = OLLAMA_GEMINI_25_TTS_CONTEXT_LENGTH; // 8K input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_TTS_MAX_OUTPUT_TOKENS; // 16K output tokens
            }
            // Gemini 2.0 Flash
            else if (lowerName.includes('2.0') && lowerName.includes('flash')) {
                contextLength = OLLAMA_GEMINI_20_FLASH_CONTEXT_LENGTH; // 1M input tokens
                maxOutputTokens = OLLAMA_GEMINI_20_FLASH_MAX_OUTPUT_TOKENS; // 8K output tokens
            }
            // Gemini 2.0 Flash Image
            else if (lowerName.includes('2.0') && lowerName.includes('image')) {
                contextLength = OLLAMA_GEMINI_20_IMAGE_CONTEXT_LENGTH; // 32K input tokens
                maxOutputTokens = OLLAMA_GEMINI_20_IMAGE_MAX_OUTPUT_TOKENS; // 8K output tokens
            }
            // Gemini 1.5 Pro (legacy)
            else if (lowerName.includes('1.5') && lowerName.includes('pro')) {
                contextLength = OLLAMA_GEMINI_15_PRO_CONTEXT_LENGTH; // 2M tokens
                maxOutputTokens = OLLAMA_GEMINI_15_PRO_MAX_OUTPUT_TOKENS;
            }
            // Gemini 1.5 Flash (legacy)
            else if (lowerName.includes('1.5') && lowerName.includes('flash')) {
                contextLength = OLLAMA_GEMINI_15_FLASH_CONTEXT_LENGTH; // 1M tokens
                maxOutputTokens = OLLAMA_GEMINI_15_FLASH_MAX_OUTPUT_TOKENS;
            }
            // Default for Gemini
            else {
                contextLength = OLLAMA_GEMINI_DEFAULT_CONTEXT_LENGTH; // 1M tokens
                maxOutputTokens = OLLAMA_GEMINI_DEFAULT_MAX_OUTPUT_TOKENS;
            }
        }
        // GPT-4 models
        else if (lowerName.includes('gpt-4')) {
            architecture = 'gpt';
            
            if (lowerName.includes('turbo') || lowerName.includes('preview')) {
                contextLength = OLLAMA_GPT4_TURBO_CONTEXT_LENGTH; // GPT-4 Turbo
                maxOutputTokens = OLLAMA_GPT4_TURBO_MAX_OUTPUT_TOKENS;
            } else if (lowerName.includes('32k')) {
                contextLength = OLLAMA_GPT4_32K_CONTEXT_LENGTH;
                maxOutputTokens = OLLAMA_GPT4_32K_MAX_OUTPUT_TOKENS;
            } else {
                contextLength = OLLAMA_GPT4_BASE_CONTEXT_LENGTH; // GPT-4 base
                maxOutputTokens = OLLAMA_GPT4_BASE_MAX_OUTPUT_TOKENS;
            }
        }
        // GPT-3.5 models
        else if (lowerName.includes('gpt-3.5')) {
            architecture = 'gpt';
            
            if (lowerName.includes('16k')) {
                contextLength = OLLAMA_GPT35_16K_CONTEXT_LENGTH;
                maxOutputTokens = OLLAMA_GPT35_16K_MAX_OUTPUT_TOKENS;
            } else {
                contextLength = OLLAMA_GPT35_BASE_CONTEXT_LENGTH;
                maxOutputTokens = OLLAMA_GPT35_BASE_MAX_OUTPUT_TOKENS;
            }
        }
        // Qwen models
        else if (lowerName.includes('qwen')) {
            architecture = 'qwen';
            
            // Qwen3 Coder Plus (coder-model)
            if (lowerName.includes('coder-plus') || lowerName.includes('coder_plus') || lowerName.includes('coder-model')) {
                contextLength = OLLAMA_QWEN_CODER_PLUS_CONTEXT_LENGTH; // 128K tokens
                maxOutputTokens = OLLAMA_QWEN_CODER_PLUS_MAX_OUTPUT_TOKENS; // 65K output
            }
            // Qwen3 VL Plus (vision-model)
            else if (lowerName.includes('vl-plus') || lowerName.includes('vl_plus') || lowerName.includes('vision-model')) {
                contextLength = OLLAMA_QWEN_VL_PLUS_CONTEXT_LENGTH; // 256K tokens
                maxOutputTokens = OLLAMA_QWEN_VL_PLUS_MAX_OUTPUT_TOKENS; // 32K output
            }
            // Qwen3 Coder Flash
            else if (lowerName.includes('coder-flash') || lowerName.includes('coder_flash')) {
                contextLength = OLLAMA_QWEN_CODER_FLASH_CONTEXT_LENGTH; // 128K tokens
                maxOutputTokens = OLLAMA_QWEN_CODER_FLASH_MAX_OUTPUT_TOKENS; // 65K output
            }
            // Default for Qwen
            else {
                contextLength = OLLAMA_QWEN_DEFAULT_CONTEXT_LENGTH; // 32K tokens
                maxOutputTokens = OLLAMA_QWEN_DEFAULT_MAX_OUTPUT_TOKENS;
            }
        }
        
        // Minimal parameter_size, as in the old patch
        let parameterSize = '0B';
        
        return {
            license: '',
            modelfile: `# Modelfile for ${modelName}\nFROM ${modelName}`,
            parameters: `num_ctx ${contextLength}\nnum_predict ${maxOutputTokens}\ntemperature ${OLLAMA_DEFAULT_TEMPERATURE}\ntop_p ${OLLAMA_DEFAULT_TOP_P}`,
            template: '{{ if .System }}{{ .System }}\n{{ end }}{{ .Prompt }}',
            details: {
                parent_model: '',
                format: 'gguf',
                family: family,
                families: [family],
                parameter_size: parameterSize,
                quantization_level: OLLAMA_SHOW_QUANTIZATION_LEVEL
            },
            model_info: {
                'general.architecture': architecture,
                'general.file_type': OLLAMA_DEFAULT_FILE_TYPE,
                'general.parameter_count': 0,
                'general.quantization_version': OLLAMA_DEFAULT_QUANTIZATION_VERSION,
                'general.context_length': contextLength,
                'llama.context_length': contextLength,
                'llama.rope.freq_base': OLLAMA_DEFAULT_ROPE_FREQ_BASE
            },
            capabilities: ['tools', 'vision', 'completion']  // Indicate that the model supports tool calling
        };
    }
}
