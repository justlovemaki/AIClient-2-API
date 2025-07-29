import { v4 as uuidv4 } from 'uuid';
import { MODEL_PROTOCOL_PREFIX, getProtocolPrefix } from './common.js';

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
            },
        },
        response: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIChatCompletionFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIChatCompletionFromClaude, // from Claude protocol
            },
        },
        streamChunk: {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: { // to OpenAI protocol
                [MODEL_PROTOCOL_PREFIX.GEMINI]: toOpenAIStreamChunkFromGemini, // from Gemini protocol
                [MODEL_PROTOCOL_PREFIX.CLAUDE]: toOpenAIStreamChunkFromClaude, // from Claude protocol
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
        model: geminiRequest.model || "gpt-3.5-turbo" // Default model if not specified in Gemini request
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
        choices: [{
            index: 0,
            delta: { content: claudeChunk },
            finish_reason: null,
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
        max_tokens: claudeRequest.max_tokens,
        temperature: claudeRequest.temperature,
        top_p: claudeRequest.top_p,
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
    if (temperature !== undefined) config.temperature = temperature;
    if (max_tokens !== undefined) config.maxOutputTokens = max_tokens;
    if (top_p !== undefined) config.topP = top_p;
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
        max_tokens: openaiRequest.max_tokens || 1024,
        temperature: openaiRequest.temperature || 0.7,
        top_p: openaiRequest.top_p || 0.9,
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
