import { countTokens } from '@anthropic-ai/tokenizer';
import logger from './logger.js';

/**
 * Extract text content from message format
 */
export function getContentText(message) {
    if (message == null) {
        return "";
    }
    if (Array.isArray(message)) {
        return message.map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
                if (part.type === 'text' && part.text) return part.text;
                if (part.text) return part.text;
            }
            return '';
        }).join('');
    } else if (typeof message.content === 'string') {
        return message.content;
    } else if (Array.isArray(message.content)) {
        return message.content.map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
                if (part.type === 'text' && part.text) return part.text;
                if (part.text) return part.text;
            }
            return '';
        }).join('');
    }
    return String(message.content || message);
}

/**
 * Process content blocks into text
 * @param {any} content - content object or array
 * @returns {string} processed text
 */
export function processContent(content) {
    if (!content) return "";
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
                if (part.type === 'text') return part.text || "";
                if (part.type === 'thinking') return part.thinking || part.text || "";
                if (part.type === 'tool_result') return processContent(part.content);
                if (part.type === 'tool_use' && part.input) return JSON.stringify(part.input);
                if (part.text) return part.text;
            }
            return "";
        }).join("");
    }
    return getContentText(content);
}

/**
 * Count tokens for a given text using Claude's official tokenizer
 */
export function countTextTokens(text) {
    if (!text) return 0;
    try {
        return countTokens(text);
    } catch (error) {
        // Fallback to estimation if tokenizer fails
        logger.warn('[TokenUtils] Tokenizer error, falling back to estimation:', error.message);
        return Math.ceil((text || '').length / 4);
    }
}

/**
 * Calculate input tokens from request body using Claude's official tokenizer
 */
export function estimateInputTokens(requestBody) {
    let allText = "";
    
    // Count system prompt tokens
    if (requestBody.system) {
        allText += processContent(requestBody.system);
    }
    
    // Count thinking prefix tokens if thinking is enabled
    if (requestBody.thinking?.type && typeof requestBody.thinking.type === 'string') {
        const t = requestBody.thinking.type.toLowerCase().trim();
        if (t === 'enabled') {
            const budgetTokens = requestBody.thinking.budget_tokens;
            let budget = Number(budgetTokens);
            if (!Number.isFinite(budget) || budget <= 0) {
                budget = 20000;
            }
            budget = Math.floor(budget);
            if (budget < 1024) budget = 1024;
            budget = Math.min(budget, 24576);
            allText += `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>`;
        }
else if (t === 'adaptive') {
            const effortRaw = typeof requestBody.thinking.effort === 'string' ? requestBody.thinking.effort : '';
            const effort = effortRaw.toLowerCase().trim();
            const normalizedEffort = (effort === 'low' || effort === 'medium' || effort === 'high') ? effort : 'high';
            allText += `<thinking_mode>adaptive</thinking_mode><thinking_effort>${normalizedEffort}</thinking_effort>`;
        }
    }
    
    // Count all messages tokens
    if (requestBody.messages && Array.isArray(requestBody.messages)) {
        for (const message of requestBody.messages) {
            if (message.content) {
                allText += processContent(message.content);
            }
        }
    }
    
    // Count tools definitions tokens if present
    if (requestBody.tools && Array.isArray(requestBody.tools)) {
        allText += JSON.stringify(requestBody.tools);
    }
    
    return countTextTokens(allText);
}

/**
 * Count tokens for a message request (compatible with Anthropic API)
 * @param {Object} requestBody - The request body containing model, messages, system, tools, etc.
 * @returns {Object} { input_tokens: number }
 */
export function countTokensAnthropic(requestBody) {
    let allText = "";
    let extraTokens = 0;

    // Count system prompt tokens
    if (requestBody.system) {
        allText += processContent(requestBody.system);
    }

    // Count all messages tokens
    if (requestBody.messages && Array.isArray(requestBody.messages)) {
        for (const message of requestBody.messages) {
            if (message.content) {
                if (Array.isArray(message.content)) {
                    for (const block of message.content) {
                        if (block.type === 'image') {
                            // Images have a fixed token cost (approximately 1600 tokens for a typical image)
                            extraTokens += 1600;
                        } else if (block.type === 'document') {
                            // Documents - estimate based on content if available
                            if (block.source?.data) {
                                // For base64 encoded documents, estimate tokens
                                const estimatedChars = block.source.data.length * 0.75; // base64 to bytes ratio
                                extraTokens += Math.ceil(estimatedChars / 4);
                            }
                        } else {
                            allText += processContent([block]);
                        }
                    }
                } else {
                    allText += processContent(message.content);
                }
            }
        }
    }

    // Count tools definitions tokens if present
    if (requestBody.tools && Array.isArray(requestBody.tools)) {
        allText += JSON.stringify(requestBody.tools);
    }

    return { input_tokens: countTextTokens(allText) + extraTokens };
}
