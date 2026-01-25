import { ProviderStrategy } from '../../utils/provider-strategy.js';

/**
 * Forward provider strategy implementation.
 * Designed to be as transparent as possible.
 */
class ForwardStrategy extends ProviderStrategy {
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model || 'default';
        const isStream = requestBody.stream === true;
        return { model, isStream };
    }

    extractResponseText(response) {
        // Attempt to extract text using common patterns (OpenAI, Claude, etc.)
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            if (choice.message && choice.message.content) {
                return choice.message.content;
            } else if (choice.delta && choice.delta.content) {
                return choice.delta.content;
            }
        }
        if (response.content && Array.isArray(response.content)) {
            return response.content.map(c => c.text || '').join('');
        }
        return '';
    }

    extractPromptText(requestBody) {
        if (requestBody.messages && requestBody.messages.length > 0) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];
            let content = lastMessage.content;
            if (typeof content === 'object' && content !== null) {
                return JSON.stringify(content);
            }
            return content;
        }
        return '';
    }

    async applySystemPromptFromFile(config, requestBody) {
        // For forwarder, we might want to skip automatic system prompt application 
        // to keep it transparent, but let's follow the base implementation just in case.
        return requestBody;
    }

    async manageSystemPrompt(requestBody) {
        // No-op for transparency
    }
}

export { ForwardStrategy };

