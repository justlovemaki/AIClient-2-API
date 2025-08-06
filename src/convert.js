import { v4 as uuidv4 } from 'uuid';
import { MODEL_PROTOCOL_PREFIX, getProtocolPrefix } from './common.js';

// 定义默认常量
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_GEMINI_MAX_TOKENS = 65536;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_TOP_P = 0.9;

// 辅助函数：判断值是否为 undefined 或 0，并返回默认值
function checkAndAssignOrDefault(value, defaultValue) {
    if (value !== undefined && value !== 0) {
        return value;
    }
    return defaultValue;
}

/**
 * Generic data conversion function.
 * @param {object} data - The data to convert (request body or response).
 * @param {string} type - The type of conversion: 'request', 'response', 'streamChunk', 'modelList'.
 * @param {string} fromProvider - The source model provider (e.g., MODEL_PROVIDER.GEMINI_CLI).
 * @param {string} toProvider - The target model provider (e.g., MODEL_PROVIDER.OPENAI_CUSTOM).
 * @param {string} [model] - Optional model name for response conversions.
 * @returns {object} The converted data.
 * @throws {Error} If no suitable conversion function is found.
 */
export function convertData(data, type, fromProvider, toProvider, model) {
    // Define a map of conversion functions using protocol prefixes
    const conversionMap = {
        request: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIRequestFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIRequestFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toClaudeRequestFromOpenAI, // from OpenAI protocol
            },
            [MODEL_PROTOCOL_PREFIX.GEMINI]: { // to Gemini protocol
                [MODEL_PROTOCOL_PREFIX.OPENAI]: toGeminiRequestFromOpenAI, // from OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toGeminiRequestFromClaude, // from Claude protocol
            },
        },
        response: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIChatCompletionFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIChatCompletionFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toClaudeChatCompletionFromGemini, // from Gemini protocol
            },
        },
        streamChunk: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIStreamChunkFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIStreamChunkFromClaude, // from Claude protocol
            },
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: { // to Claude protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toClaudeStreamChunkFromGemini, // from Gemini protocol
            },
        },
        modelList: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIModelListFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIModelListFromClaude, // from Claude protocol
            },
        }
    };

    const targetConversions = conversionMap[type];
    if (!targetConversions) {
        throw new Error(`Unsupported conversion type: ${type}`);
    }

    const toConversions = targetConversions[getProtocolPrefix(toProvider)];
    if (!toConversions) {
        throw new Error(`No conversions defined for target protocol: ${getProtocolPrefix(toProvider)} for type: ${type}`);
    }

    const conversionFunction = toConversions[getProtocolPrefix(fromProvider)];
    if (!conversionFunction) {
        throw new Error(`No conversion function found from ${fromProvider} to ${toProvider} for type: ${type}`);
    }

    console.log(conversionFunction);
    if (type === 'response' || type === 'streamChunk' || type === 'modelList') {
        return conversionFunction(data, model);
    } else {
        return conversionFunction(data);
    }
}


/**
 * Converts a Gemini API request body to an OpenAI chat completion request body.
 * Handles system instructions and role mapping with multimodal support.
 * @param {Object} geminiRequest - The request body from the Gemini API.
 * @returns {Object} The formatted request body for the OpenAI API.
 */
export function toOpenAIRequestFromGemini(geminiRequest) {
    const openaiRequest = {
        messages: [],
        model: geminiRequest.model || "gpt-3.5-turbo", // Default model if not specified in Gemini request
        max_tokens: checkAndAssignOrDefault(geminiRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(geminiRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(geminiRequest.top_p, DEFAULT_TOP_P),
    };

    // Process system instruction
    if (geminiRequest.systemInstruction && Array.isArray(geminiRequest.systemInstruction.parts)) {
        const systemContent = processGeminiPartsToOpenAIContent(geminiRequest.systemInstruction.parts);
        if (systemContent) {
            openaiRequest.messages.push({
                role: 'system',
                content: systemContent
            });
        }
    }

    // Process contents
    if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
        geminiRequest.contents.forEach(content => {
            if (content && Array.isArray(content.parts)) {
                const openaiContent = processGeminiPartsToOpenAIContent(content.parts);
                if (openaiContent && openaiContent.length > 0) {
                    const openaiRole = content.role === 'model' ? 'assistant' : content.role;
                    openaiRequest.messages.push({
                        role: openaiRole,
                        content: openaiContent
                    });
                }
            }
        });
    }

    return openaiRequest;
}

/**
 * Processes Gemini parts to OpenAI content format with multimodal support.
 * @param {Array} parts - Array of Gemini parts.
 * @returns {Array|string} OpenAI content format.
 */
function processGeminiPartsToOpenAIContent(parts) {
    if (!parts || !Array.isArray(parts)) return '';
    
    const contentArray = [];
    
    parts.forEach(part => {
        if (!part) return;
        
        // Handle text content
        if (typeof part.text === 'string') {
            contentArray.push({
                type: 'text',
                text: part.text
            });
        }
        
        // Handle inline data (images, audio)
        if (part.inlineData) {
            const { mimeType, data } = part.inlineData;
            if (mimeType && data) {
                contentArray.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${data}`
                    }
                });
            }
        }
        
        // Handle file data
        if (part.fileData) {
            const { mimeType, fileUri } = part.fileData;
            if (mimeType && fileUri) {
                // For file URIs, we need to determine if it's an image or audio
                if (mimeType.startsWith('image/')) {
                    contentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: fileUri
                        }
                    });
                } else if (mimeType.startsWith('audio/')) {
                    // For audio, we'll use a placeholder or handle as text description
                    contentArray.push({
                        type: 'text',
                        text: `[Audio file: ${fileUri}]`
                    });
                }
            }
        }
    });
    
    // Return as array for multimodal, or string for simple text
    return contentArray.length === 1 && contentArray[0].type === 'text'
        ? contentArray[0].text
        : contentArray;
}


export function toOpenAIModelListFromGemini(geminiModels) {
    return {
        object: "list",
        data: geminiModels.models.map(m => ({
            id: m.name.startsWith('models/') ? m.name.substring(7) : m.name, // 移除 'models/' 前缀作为 id
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "google",
        })),
    };
}

export function toOpenAIChatCompletionFromGemini(geminiResponse, model) {
    const content = processGeminiResponseContent(geminiResponse);
    
    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: content
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

/**
 * Processes Gemini response content to OpenAI format with multimodal support.
 * @param {Object} geminiResponse - The Gemini API response.
 * @returns {string|Array} Processed content.
 */
function processGeminiResponseContent(geminiResponse) {
    if (!geminiResponse || !geminiResponse.candidates) return '';
    
    const contents = [];
    
    geminiResponse.candidates.forEach(candidate => {
        if (candidate.content && candidate.content.parts) {
            candidate.content.parts.forEach(part => {
                if (part.text) {
                    contents.push(part.text);
                }
                // Note: Gemini response typically doesn't include multimodal content in responses
                // but we handle it for completeness
            });
        }
    });
    
    return contents.join('\n');
}

export function toOpenAIStreamChunkFromGemini(geminiChunk, model) {
    return {
        id: `chatcmpl-${uuidv4()}`, // uuidv4 needs to be imported or handled
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: { content: geminiChunk },
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

/**
 * Converts a Claude API messages response to an OpenAI chat completion response.
 * @param {Object} claudeResponse - The Claude API messages response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted OpenAI chat completion response.
 */
export function toOpenAIChatCompletionFromClaude(claudeResponse, model) {
    if (!claudeResponse || !claudeResponse.content || claudeResponse.content.length === 0) {
        return {
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: "",
                },
                finish_reason: "stop",
            }],
            usage: {
                prompt_tokens: claudeResponse.usage?.input_tokens || 0,
                completion_tokens: claudeResponse.usage?.output_tokens || 0,
                total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
            },
        };
    }

    const content = processClaudeResponseContent(claudeResponse.content);
    const finishReason = claudeResponse.stop_reason === 'end_turn' ? 'stop' : claudeResponse.stop_reason;

    return {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: content
            },
            finish_reason: finishReason,
        }],
        usage: {
            prompt_tokens: claudeResponse.usage?.input_tokens || 0,
            completion_tokens: claudeResponse.usage?.output_tokens || 0,
            total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
        },
    };
}

/**
 * Processes Claude response content to OpenAI format with multimodal support.
 * @param {Array} content - Array of Claude content blocks.
 * @returns {string|Array} Processed content.
 */
function processClaudeResponseContent(content) {
    if (!content || !Array.isArray(content)) return '';
    
    const contentArray = [];
    
    content.forEach(block => {
        if (!block) return;
        
        switch (block.type) {
            case 'text':
                contentArray.push({
                    type: 'text',
                    text: block.text || ''
                });
                break;
                
            case 'image':
                // Handle image blocks from Claude
                if (block.source && block.source.type === 'base64') {
                    contentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${block.source.media_type};base64,${block.source.data}`
                        }
                    });
                }
                break;
                
            default:
                // Handle other content types as text
                if (block.text) {
                    contentArray.push({
                        type: 'text',
                        text: block.text
                    });
                }
        }
    });
    
    // Return as array for multimodal, or string for simple text
    return contentArray.length === 1 && contentArray[0].type === 'text'
        ? contentArray[0].text
        : contentArray;
}

/**
 * Converts a Claude API messages stream chunk to an OpenAI chat completion stream chunk.
 * Based on the official Claude Messages API stream events.
 * @param {Object} claudeChunk - The Claude API messages stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @returns {Object} The formatted OpenAI chat completion stream chunk, or an empty object for events that don't map.
 */
export function toOpenAIStreamChunkFromClaude(claudeChunk, model) {
    if (!claudeChunk) {
        return null;
    }
    return {
        id: `chatcmpl-${uuidv4()}`, // uuidv4 needs to be imported or handled
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        system_fingerprint: "",
        choices: [{
            index: 0,
            delta: { 
                content: claudeChunk,
                reasoning_content: ""
            },
            finish_reason: !claudeChunk ? 'stop' : null,
            message: {
                content: claudeChunk,
                reasoning_content: ""
            }
        }],
        usage:{
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

export function getOpenAIStreamChunkStop(model) {
    return {
        id: `chatcmpl-${uuidv4()}`, // uuidv4 needs to be imported or handled
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        system_fingerprint: "",
        choices: [{
            index: 0,
            delta: { 
                content: "",
                reasoning_content: ""
            },
            finish_reason: 'stop',
            message: {
                content: "",
                reasoning_content: ""
            }
        }],
        usage:{
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}



/**
 * Converts a Claude API model list response to an OpenAI model list response.
 * @param {Array<Object>} claudeModels - The array of model objects from Claude API.
 * @returns {Object} The formatted OpenAI model list response.
 */
export function toOpenAIModelListFromClaude(claudeModels) {
    return {
        object: "list",
        data: claudeModels.models.map(m => ({
            id: m.id || m.name, // Claude models might use 'name' instead of 'id'
            object: "model",
            created: Math.floor(Date.now() / 1000), // Claude may not provide 'created' timestamp
            owned_by: "anthropic",
            // You can add more properties here if they exist in Claude's model response
            // and you want to map them to OpenAI's format, e.g., permissions.
        })),
    };
}



/**
 * Converts a Claude API request body to an OpenAI chat completion request body.
 * Handles system instructions and multimodal content.
 * @param {Object} claudeRequest - The request body from the Claude API.
 * @returns {Object} The formatted request body for the OpenAI API.
 */
export function toOpenAIRequestFromClaude(claudeRequest) {
    const openaiMessages = [];
    let systemMessageContent = '';

    // Claude system message handling
    if (claudeRequest.system) {
        systemMessageContent = claudeRequest.system;
    }

    if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
        claudeRequest.messages.forEach(message => {
            const openaiRole = message.role === 'assistant' ? 'assistant' : 'user';
            const content = message.content; // Claude content can be string or array

            if (typeof content === 'string') {
                openaiMessages.push({ role: openaiRole, content: content });
            } else if (Array.isArray(content)) {
                // Process multimodal content
                const processedContent = processClaudeContentToOpenAIContent(content);
                if (processedContent && processedContent.length > 0) {
                    openaiMessages.push({
                        role: openaiRole,
                        content: processedContent
                    });
                }
            }
        });
    }

    const openaiRequest = {
        model: claudeRequest.model || 'gpt-3.5-turbo', // Default OpenAI model
        messages: openaiMessages,
        max_tokens: checkAndAssignOrDefault(claudeRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(claudeRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(claudeRequest.top_p, DEFAULT_TOP_P),
        // stream: claudeRequest.stream, // Stream mode is handled by different endpoint
    };

    // Add system message at the beginning if present
    if (systemMessageContent) {
        openaiRequest.messages.unshift({ role: 'system', content: systemMessageContent });
    }

    return openaiRequest;
}

/**
 * Processes Claude content to OpenAI content format with multimodal support.
 * @param {Array} content - Array of Claude content blocks.
 * @returns {Array} OpenAI content format.
 */
function processClaudeContentToOpenAIContent(content) {
    if (!content || !Array.isArray(content)) return [];
    
    const contentArray = [];
    
    content.forEach(block => {
        if (!block) return;
        
        switch (block.type) {
            case 'text':
                if (block.text) {
                    contentArray.push({
                        type: 'text',
                        text: block.text
                    });
                }
                break;
                
            case 'image':
                // Handle image blocks from Claude
                if (block.source && block.source.type === 'base64') {
                    contentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${block.source.media_type};base64,${block.source.data}`
                        }
                    });
                }
                break;
                
            case 'tool_use':
                // Handle tool use as text
                contentArray.push({
                    type: 'text',
                    text: `[Tool use: ${block.name}]`
                });
                break;
                
            case 'tool_result':
                // Handle tool results as text
                contentArray.push({
                    type: 'text',
                    text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                });
                break;
                
            default:
                // Handle any other content types as text
                if (block.text) {
                    contentArray.push({
                        type: 'text',
                        text: block.text
                    });
                }
        }
    });
    
    return contentArray;
}


/**
 * Converts an OpenAI chat completion request body to a Gemini API request body.
 * Handles system instructions and merges consecutive messages of the same role with multimodal support.
 * @param {Object} openaiRequest - The request body from the OpenAI API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
export function toGeminiRequestFromOpenAI(openaiRequest) {
    const messages = openaiRequest.messages || [];
    const { systemInstruction, nonSystemMessages } = extractAndProcessSystemMessages(messages);
    
    // Process messages with role conversion and multimodal support
    const processedMessages = [];
    let lastMessage = null;
    
    for (const message of nonSystemMessages) {
        const geminiRole = message.role === 'assistant' ? 'model' : message.role;
        
        // Handle tool responses
        if (geminiRole === 'tool') {
            if (lastMessage) processedMessages.push(lastMessage);
            processedMessages.push({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: message.name,
                        response: { content: safeParseJSON(message.content) }
                    }
                }]
            });
            lastMessage = null;
            continue;
        }
        
        // Process multimodal content
        const processedContent = processOpenAIContentToGeminiParts(message.content);
        
        // Merge consecutive text messages
        if (lastMessage && lastMessage.role === geminiRole && !message.tool_calls &&
            Array.isArray(processedContent) && processedContent.every(p => p.text) &&
            Array.isArray(lastMessage.parts) && lastMessage.parts.every(p => p.text)) {
            lastMessage.parts.push(...processedContent);
            continue;
        }
        
        if (lastMessage) processedMessages.push(lastMessage);
        lastMessage = { role: geminiRole, parts: processedContent };
    }
    if (lastMessage) processedMessages.push(lastMessage);
    
    // Build Gemini request
    const geminiRequest = {
        contents: processedMessages.filter(item => item.parts && item.parts.length > 0)
    };
    
    if (systemInstruction) geminiRequest.systemInstruction = systemInstruction;
    
    // Handle tools and tool_choice
    if (openaiRequest.tools?.length) {
        geminiRequest.tools = [{
            functionDeclarations: openaiRequest.tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters
            }))
        }];
    }
    
    if (openaiRequest.tool_choice) {
        geminiRequest.toolConfig = buildToolConfig(openaiRequest.tool_choice);
    }
    
    // Add generation config
    const config = buildGenerationConfig(openaiRequest);
    if (Object.keys(config).length) geminiRequest.generationConfig = config;
    
    // Validation
    if (geminiRequest.contents[0]?.role !== 'user') {
        console.warn(`[Request Conversion] Warning: Conversation does not start with a 'user' role.`);
    }
    
    return geminiRequest;
}

/**
 * Processes OpenAI content to Gemini parts format with multimodal support.
 * @param {string|Array} content - OpenAI message content.
 * @returns {Array} Array of Gemini parts.
 */
function processOpenAIContentToGeminiParts(content) {
    if (!content) return [];
    
    // Handle string content
    if (typeof content === 'string') {
        return [{ text: content }];
    }
    
    // Handle array content (multimodal)
    if (Array.isArray(content)) {
        const parts = [];
        
        content.forEach(item => {
            if (!item) return;
            
            switch (item.type) {
                case 'text':
                    if (item.text) {
                        parts.push({ text: item.text });
                    }
                    break;
                    
                case 'image_url':
                    if (item.image_url) {
                        const imageUrl = typeof item.image_url === 'string'
                            ? item.image_url
                            : item.image_url.url;
                            
                        if (imageUrl.startsWith('data:')) {
                            // Handle base64 data URL
                            const [header, data] = imageUrl.split(',');
                            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                            parts.push({
                                inlineData: {
                                    mimeType,
                                    data
                                }
                            });
                        } else {
                            // Handle regular URL
                            parts.push({
                                fileData: {
                                    mimeType: 'image/jpeg', // Default MIME type
                                    fileUri: imageUrl
                                }
                            });
                        }
                    }
                    break;
                    
                case 'audio':
                    // Handle audio content
                    if (item.audio_url) {
                        const audioUrl = typeof item.audio_url === 'string'
                            ? item.audio_url
                            : item.audio_url.url;
                            
                        if (audioUrl.startsWith('data:')) {
                            const [header, data] = audioUrl.split(',');
                            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'audio/wav';
                            parts.push({
                                inlineData: {
                                    mimeType,
                                    data
                                }
                            });
                        } else {
                            parts.push({
                                fileData: {
                                    mimeType: 'audio/wav', // Default MIME type
                                    fileUri: audioUrl
                                }
                            });
                        }
                    }
                    break;
            }
        });
        
        return parts;
    }
    
    return [];
}

function safeParseJSON(str) {
    try {
        return JSON.parse(str || '{}');
    } catch {
        return str;
    }
}

function buildToolConfig(toolChoice) {
    if (typeof toolChoice === 'string' && ['none', 'auto'].includes(toolChoice)) {
        return { functionCallingConfig: { mode: toolChoice.toUpperCase() } };
    }
    if (typeof toolChoice === 'object' && toolChoice.function) {
        return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.function.name] } };
    }
    return null;
}

function buildGenerationConfig({ temperature, max_tokens, top_p, stop }) {
    const config = {};
    config.temperature = checkAndAssignOrDefault(temperature, DEFAULT_TEMPERATURE);
    config.maxOutputTokens = checkAndAssignOrDefault(max_tokens, DEFAULT_GEMINI_MAX_TOKENS);
    config.topP = checkAndAssignOrDefault(top_p, DEFAULT_TOP_P);
    if (stop !== undefined) config.stopSequences = Array.isArray(stop) ? stop : [stop];
    return config;
}


/**
 * Converts an OpenAI chat completion request body to a Claude API request body.
 * Handles system instructions, tool calls, and multimodal content.
 * @param {Object} openaiRequest - The request body from the OpenAI API.
 * @returns {Object} The formatted request body for the Claude API.
 */
export function toClaudeRequestFromOpenAI(openaiRequest) {
    const messages = openaiRequest.messages || [];
    const { systemInstruction, nonSystemMessages } = extractAndProcessSystemMessages(messages);

    const claudeMessages = [];

    for (const message of nonSystemMessages) {
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        let content = [];

        if (message.role === 'tool') {
            // Claude expects tool_result to be in a 'user' message
            // The content of a tool message is a single tool_result block
            content.push({
                type: 'tool_result',
                tool_use_id: message.tool_call_id, // Use tool_call_id from OpenAI tool message
                content: safeParseJSON(message.content) // Parse content as JSON if possible
            });
            claudeMessages.push({ role: 'user', content: content });
        } else if (message.role === 'assistant' && message.tool_calls?.length) {
            // Assistant message with tool calls - properly format as tool_use blocks
            // Claude expects tool_use to be in an 'assistant' message
            const toolUseBlocks = message.tool_calls.map(tc => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: safeParseJSON(tc.function.arguments)
            }));
            claudeMessages.push({ role: 'assistant', content: toolUseBlocks });
        } else {
            // Regular user or assistant message (text and multimodal)
            if (typeof message.content === 'string') {
                if (message.content) {
                    content.push({ type: 'text', text: message.content });
                }
            } else if (Array.isArray(message.content)) {
                message.content.forEach(item => {
                    if (!item) return;
                    switch (item.type) {
                        case 'text':
                            if (item.text) {
                                content.push({ type: 'text', text: item.text });
                            }
                            break;
                        case 'image_url':
                            if (item.image_url) {
                                const imageUrl = typeof item.image_url === 'string'
                                    ? item.image_url
                                    : item.image_url.url;
                                if (imageUrl.startsWith('data:')) {
                                    const [header, data] = imageUrl.split(',');
                                    const mediaType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
                                    content.push({
                                        type: 'image',
                                        source: {
                                            type: 'base64',
                                            media_type: mediaType,
                                            data: data
                                        }
                                    });
                                } else {
                                    // Claude requires base64 for images, so for URLs, we'll represent as text
                                    content.push({ type: 'text', text: `[Image: ${imageUrl}]` });
                                }
                            }
                            break;
                        case 'audio':
                            // Handle audio content as text placeholder
                            if (item.audio_url) {
                                const audioUrl = typeof item.audio_url === 'string'
                                    ? item.audio_url
                                    : item.audio_url.url;
                                content.push({ type: 'text', text: `[Audio: ${audioUrl}]` });
                            }
                            break;
                    }
                });
            }
            // Only add message if content is not empty
            if (content.length > 0) {
                claudeMessages.push({ role: role, content: content });
            }
        }
    }

    const claudeRequest = {
        model: openaiRequest.model || 'claude-3-opus-20240229',
        messages: claudeMessages,
        max_tokens: checkAndAssignOrDefault(openaiRequest.max_tokens, DEFAULT_MAX_TOKENS),
        temperature: checkAndAssignOrDefault(openaiRequest.temperature, DEFAULT_TEMPERATURE),
        top_p: checkAndAssignOrDefault(openaiRequest.top_p, DEFAULT_TOP_P),
    };

    if (systemInstruction) {
        claudeRequest.system = extractTextFromMessageContent(systemInstruction.parts[0].text);
    }

    if (openaiRequest.tools?.length) {
        claudeRequest.tools = openaiRequest.tools.map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            input_schema: t.function.parameters || { type: 'object', properties: {} }
        }));
        claudeRequest.tool_choice = buildClaudeToolChoice(openaiRequest.tool_choice);
    }

    return claudeRequest;
}

function buildClaudeToolChoice(toolChoice) {
    if (typeof toolChoice === 'string') {
        const mapping = { auto: 'auto', none: 'none', required: 'any' };
        return { type: mapping[toolChoice] };
    }
    if (typeof toolChoice === 'object' && toolChoice.function) {
        return { type: 'tool', name: toolChoice.function.name };
    }
    return undefined;
}


/**
 * Extracts and combines all 'system' role messages into a single system instruction.
 * Filters out system messages and returns the remaining non-system messages.
 * @param {Array<Object>} messages - Array of message objects from OpenAI request.
 * @returns {{systemInstruction: Object|null, nonSystemMessages: Array<Object>}}
 *          An object containing the system instruction and an array of non-system messages.
 */
export function extractAndProcessSystemMessages(messages) {
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
 * Extracts text from various forms of message content.
 * @param {string|Array<Object>} content - The content from a message object.
 * @returns {string} The extracted text.
 */
export function extractTextFromMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('\n');
    }
    return '';
}

/**
 * Utility function to detect MIME type from base64 data URL
 * @param {string} dataUrl - Data URL string
 * @returns {string} MIME type
 */
function detectMimeType(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

/**
 * Utility function to extract base64 data from data URL
 * @param {string} dataUrl - Data URL string
 * @returns {string} Base64 data
 */
function extractBase64Data(dataUrl) {
    return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

/**
 * Utility function to validate image MIME types
 * @param {string} mimeType - MIME type to validate
 * @returns {boolean} Whether it's a valid image type
 */
function isValidImageType(mimeType) {
    const validTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
        'image/webp', 'image/bmp', 'image/tiff'
    ];
    return validTypes.includes(mimeType.toLowerCase());
}

/**
 * Utility function to validate audio MIME types
 * @param {string} mimeType - MIME type to validate
 * @returns {boolean} Whether it's a valid audio type
 */
function isValidAudioType(mimeType) {
    const validTypes = [
        'audio/wav', 'audio/wave', 'audio/mp3', 'audio/mpeg',
        'audio/ogg', 'audio/aac', 'audio/flac', 'audio/m4a'
    ];
    return validTypes.includes(mimeType.toLowerCase());
}

/**
 * Converts a Claude API request body to a Gemini API request body.
 * Handles system instructions and multimodal content.
 * @param {Object} claudeRequest - The request body from the Claude API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
/**
 * Converts a Claude API request body to a Gemini API request body.
 * Handles system instructions and multimodal content.
 * @param {Object} claudeRequest - The request body from the Claude API.
 * @returns {Object} The formatted request body for the Gemini API.
 */
export function toGeminiRequestFromClaude(claudeRequest) {
    // Ensure claudeRequest is a valid object
    if (!claudeRequest || typeof claudeRequest !== 'object') {
        console.warn("Invalid claudeRequest provided to toGeminiRequestFromClaude.");
        return { contents: [] };
    }

    const geminiRequest = {
        contents: []
    };

    // Handle system instruction
    if (claudeRequest.system) {
        let incomingSystemText = null;
        if (typeof claudeRequest.system === 'string') {
            incomingSystemText = claudeRequest.system;
        } else if (typeof claudeRequest.system === 'object') {
            incomingSystemText = JSON.stringify(claudeRequest.system);
        } else if (claudeRequest.messages?.length > 0) {
            // Fallback to first user message if no system property
            const userMessage = claudeRequest.messages.find(m => m.role === 'user');
            if (userMessage) {
                if (Array.isArray(userMessage.content)) {
                    incomingSystemText = userMessage.content.map(block => block.text).join('');
                } else {
                    incomingSystemText = userMessage.content;
                }
            }
        }
        geminiRequest.systemInstruction = {
            parts: [{ text: incomingSystemText}] // Ensure system is string
        };
    }

    // Process messages
    if (Array.isArray(claudeRequest.messages)) {
        claudeRequest.messages.forEach(message => {
            // Ensure message is a valid object and has a role and content
            if (!message || typeof message !== 'object' || !message.role || !message.content) {
                console.warn("Skipping invalid message in claudeRequest.messages.");
                return;
            }

            const geminiRole = message.role === 'assistant' ? 'model' : 'user';
            const processedParts = processClaudeContentToGeminiParts(message.content);

            // If the processed parts contain a function response, it should be a 'function' role message
            // Claude's tool_result block does not contain the function name, only tool_use_id.
            // We need to infer the function name from the previous tool_use message.
            // For simplicity in this conversion, we'll assume the tool_use_id is the function name
            // or that the tool_result is always preceded by a tool_use with the correct name.
            // A more robust solution would involve tracking tool_use_ids to function names.
            const functionResponsePart = processedParts.find(part => part.functionResponse);
            if (functionResponsePart) {
                geminiRequest.contents.push({
                    role: 'function',
                    parts: [functionResponsePart]
                });
            } else if (processedParts.length > 0) { // Only push if there are actual parts
                geminiRequest.contents.push({
                    role: geminiRole,
                    parts: processedParts
                });
            }
        });
    }

    // Add generation config
    const generationConfig = {};
    generationConfig.maxOutputTokens = checkAndAssignOrDefault(claudeRequest.max_tokens, DEFAULT_GEMINI_MAX_TOKENS);
    generationConfig.temperature = checkAndAssignOrDefault(claudeRequest.temperature, DEFAULT_TEMPERATURE);
    generationConfig.topP = checkAndAssignOrDefault(claudeRequest.top_p, DEFAULT_TOP_P);
    
    if (Object.keys(generationConfig).length > 0) {
        geminiRequest.generationConfig = generationConfig;
    }

    // Handle tools
    if (Array.isArray(claudeRequest.tools)) {
        geminiRequest.tools = [{
            functionDeclarations: claudeRequest.tools.map(tool => {
                // Ensure tool is a valid object and has a name
                if (!tool || typeof tool !== 'object' || !tool.name) {
                    console.warn("Skipping invalid tool declaration in claudeRequest.tools.");
                    return null; // Return null for invalid tools, filter out later
                }

                delete tool.input_schema.$schema;
                return {
                    name: String(tool.name), // Ensure name is string
                    description: String(tool.description || ''), // Ensure description is string
                    parameters: tool.input_schema && typeof tool.input_schema === 'object' ? tool.input_schema : { type: 'object', properties: {} }
                };
            }).filter(Boolean) // Filter out any nulls from invalid tool declarations
        }];
        // If no valid functionDeclarations, remove the tools array
        if (geminiRequest.tools[0].functionDeclarations.length === 0) {
            delete geminiRequest.tools;
        }
    }

    // Handle tool_choice
    if (claudeRequest.tool_choice) {
        geminiRequest.toolConfig = buildGeminiToolConfigFromClaude(claudeRequest.tool_choice);
    }

    return geminiRequest;
}

/**
 * Builds Gemini toolConfig from Claude tool_choice.
 * @param {Object} claudeToolChoice - The tool_choice object from Claude API.
 * @returns {Object|undefined} The formatted toolConfig for Gemini API, or undefined if invalid.
 */
function buildGeminiToolConfigFromClaude(claudeToolChoice) {
    if (!claudeToolChoice || typeof claudeToolChoice !== 'object' || !claudeToolChoice.type) {
        console.warn("Invalid claudeToolChoice provided to buildGeminiToolConfigFromClaude.");
        return undefined;
    }

    switch (claudeToolChoice.type) {
        case 'auto':
            return { functionCallingConfig: { mode: 'AUTO' } };
        case 'none':
            return { functionCallingConfig: { mode: 'NONE' } };
        case 'tool':
            if (claudeToolChoice.name && typeof claudeToolChoice.name === 'string') {
                return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [claudeToolChoice.name] } };
            }
            console.warn("Invalid tool name in claudeToolChoice of type 'tool'.");
            return undefined;
        default:
            console.warn(`Unsupported claudeToolChoice type: ${claudeToolChoice.type}`);
            return undefined;
    }
}

/**
 * Processes Claude content to Gemini parts format with multimodal support.
 * @param {string|Array} content - Claude message content.
 * @returns {Array} Array of Gemini parts.
 */
function processClaudeContentToGeminiParts(content) {
    if (!content) return [];

    // Handle string content
    if (typeof content === 'string') {
        return [{ text: content }];
    }

    // Handle array content (multimodal)
    if (Array.isArray(content)) {
        const parts = [];

        content.forEach(block => {
            // Ensure block is a valid object and has a type
            if (!block || typeof block !== 'object' || !block.type) {
                console.warn("Skipping invalid content block in processClaudeContentToGeminiParts.");
                return;
            }

            switch (block.type) {
                case 'text':
                    if (typeof block.text === 'string') {
                        parts.push({ text: block.text });
                    } else {
                        console.warn("Invalid text content in Claude text block.");
                    }
                    break;

                case 'image':
                    if (block.source && typeof block.source === 'object' && block.source.type === 'base64' &&
                        typeof block.source.media_type === 'string' && typeof block.source.data === 'string') {
                        parts.push({
                            inlineData: {
                                mimeType: block.source.media_type,
                                data: block.source.data
                            }
                        });
                    } else {
                        console.warn("Invalid image source in Claude image block.");
                    }
                    break;

                case 'tool_use':
                    if (typeof block.name === 'string' && block.input && typeof block.input === 'object') {
                        parts.push({
                            functionCall: {
                                name: block.name,
                                args: block.input
                            }
                        });
                    } else {
                        console.warn("Invalid tool_use block in Claude content.");
                    }
                    break;

                case 'tool_result':
                    // Claude's tool_result block does not contain the function name, only tool_use_id.
                    // Gemini's functionResponse requires a function name.
                    // For now, we'll use the tool_use_id as the name, but this is a potential point of failure
                    // if the tool_use_id is not the actual function name in Gemini's context.
                    // A more robust solution would involve tracking the function name from the tool_use block.
                    if (typeof block.tool_use_id === 'string') {
                        parts.push({
                            functionResponse: {
                                name: block.tool_use_id, // This might need to be the actual function name
                                response: { content: block.content } // content can be any JSON-serializable value
                            }
                        });
                    } else {
                        console.warn("Invalid tool_result block in Claude content: missing tool_use_id.");
                    }
                    break;

                default:
                    // Handle any other content types as text if they have a text property
                    if (typeof block.text === 'string') {
                        parts.push({ text: block.text });
                    } else {
                        console.warn(`Unsupported Claude content block type: ${block.type}. Skipping.`);
                    }
            }
        });

        return parts;
    }

    return [];
}

/**
 * Converts a Gemini API response to a Claude API messages response.
 * @param {Object} geminiResponse - The Gemini API response object.
 * @param {string} model - The model name to include in the response.
 * @returns {Object} The formatted Claude API messages response.
 */
export function toClaudeChatCompletionFromGemini(geminiResponse, model) {
    // Handle cases where geminiResponse or candidates are missing or empty
    if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
        return {
            id: `msg_${uuidv4()}`,
            type: "message",
            role: "assistant",
            content: [], // Empty content for no candidates
            model: model,
            stop_reason: "end_turn", // Default stop reason
            stop_sequence: null,
            usage: {
                input_tokens: geminiResponse?.usageMetadata?.promptTokenCount || 0,
                output_tokens: geminiResponse?.usageMetadata?.candidatesTokenCount || 0
            }
        };
    }

    const candidate = geminiResponse.candidates[0];
    const content = processGeminiResponseToClaudeContent(geminiResponse);
    const finishReason = candidate.finishReason;
    let stopReason = "end_turn"; // Default stop reason

    if (finishReason) {
        switch (finishReason) {
            case 'STOP':
                stopReason = 'end_turn';
                break;
            case 'MAX_TOKENS':
                stopReason = 'max_tokens';
                break;
            case 'SAFETY':
                stopReason = 'safety';
                break;
            case 'RECITATION':
                stopReason = 'recitation';
                break;
            case 'OTHER':
                stopReason = 'other';
                break;
            default:
                stopReason = 'end_turn';
        }
    }

    return {
        id: `msg_${uuidv4()}`,
        type: "message",
        role: "assistant",
        content: content,
        model: model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
            output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0
        }
    };
}

/**
 * Processes Gemini response content to Claude format.
 * @param {Object} geminiResponse - The Gemini API response.
 * @returns {Array} Array of Claude content blocks.
 */
function processGeminiResponseToClaudeContent(geminiResponse) {
    if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) return [];

    const content = [];

    geminiResponse.candidates.forEach(candidate => {
        if (candidate.content && candidate.content.parts) {
            candidate.content.parts.forEach(part => {
                if (part.text) {
                    content.push({
                        type: 'text',
                        text: part.text
                    });
                } else if (part.inlineData) {
                    content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: part.inlineData.mimeType,
                            data: part.inlineData.data
                        }
                    });
                } else if (part.functionCall) {
                    // Convert Gemini functionCall to Claude tool_use
                    content.push({
                        type: 'tool_use',
                        id: uuidv4(), // Generate a new ID for the tool use
                        name: part.functionCall.name,
                        input: part.functionCall.args || {}
                    });
                }
            });
        }
    });

    return content;
}

/**
 * Converts a Gemini API stream chunk to a Claude API messages stream chunk.
 * @param {Object} geminiChunk - The Gemini API stream chunk object.
 * @param {string} [model] - Optional model name to include in the response.
 * @returns {Object} The formatted Claude API messages stream chunk.
 */
export function toClaudeStreamChunkFromGemini(geminiChunk, model) {
    if (!geminiChunk) {
        return null;
    }

    // Handle different types of Gemini stream events
    if (geminiChunk.candidates && geminiChunk.candidates.length > 0) {
        const candidate = geminiChunk.candidates[0];

        if (candidate.content && candidate.content.parts) {
            const textParts = candidate.content.parts
                .filter(part => part.text)
                .map(part => part.text);

            const functionCallPart = candidate.content.parts.find(part => part.functionCall);

            if (functionCallPart) {
                // Handle tool_use
                return {
                    type: "content_block_start",
                    index: 0,
                    content_block: {
                        type: "tool_use",
                        id: `toolu_${uuidv4()}`, // Claude tool use ID format
                        name: functionCallPart.functionCall.name,
                        input: functionCallPart.functionCall.args || {}
                    }
                };
            } else if (textParts.length > 0) {
                return {
                    type: "content_block_delta",
                    index: 0,
                    delta: {
                        type: "text_delta",
                        text: textParts.join('')
                    }
                };
            }
        }

        // Handle finish reason
        if (candidate.finishReason) {
            let stopReason = "end_turn";
            switch (candidate.finishReason) {
                case 'STOP':
                    stopReason = 'end_turn';
                    break;
                case 'MAX_TOKENS':
                    stopReason = 'max_tokens';
                    break;
                case 'SAFETY':
                    stopReason = 'safety';
                    break;
                case 'RECITATION':
                    stopReason = 'recitation';
                    break;
                case 'OTHER':
                    stopReason = 'other';
                    break;
                default:
                    stopReason = 'end_turn';
            }
            return {
                type: "message_delta",
                delta: {
                    stop_reason: stopReason,
                    stop_sequence: null
                },
                usage: geminiChunk.usageMetadata ? {
                    output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0
                } : undefined
            };
        }
    }

    // Handle usage metadata updates (only if no other content/finish reason)
    if (geminiChunk.usageMetadata && (!geminiChunk.candidates || geminiChunk.candidates.length === 0)) {
        return {
            type: "message_delta",
            delta: {},
            usage: {
                input_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0
            }
        };
    }

    // Default text delta for simple text chunks (should ideally be handled by candidate.content.parts)
    // This case might occur if the geminiChunk is just a string, which is not typical for Gemini API.
    // Added for robustness, but main logic should rely on geminiChunk.candidates.
    if (typeof geminiChunk === 'string') {
        return {
            type: "content_block_delta",
            index: 0,
            delta: {
                type: "text_delta",
                text: geminiChunk
            }
        };
    }

    return null;
}
