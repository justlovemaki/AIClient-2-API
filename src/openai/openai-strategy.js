import { ProviderStrategy } from '../provider-strategy.js';

/**
 * OpenAI provider strategy implementation.
 */
class OpenAIStrategy extends ProviderStrategy {
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model;
        const isStream = requestBody.stream === true;
        return { model, isStream };
    }

    extractResponseText(response) {
        if (!response.choices) {
            return '';
        }
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            if (choice.message && choice.message.content) {
                return choice.message.content;
            } else if (choice.delta && choice.delta.content) {
                return choice.delta.content;
            }
        }
        return '';
    }

    extractPromptText(requestBody) {
        if (requestBody.messages && requestBody.messages.length > 0) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];
            let content = lastMessage.content;
            if (typeof content === 'object' && content !== null) {
                if (Array.isArray(content)) {
                    return content.map(item => item.text).join('\n');
                } else {
                    return JSON.stringify(content);
                }
            }
            return content;
        }
        return '';
    }

    async applySystemPromptFromFile(config, requestBody) {
        if (!config.SYSTEM_PROMPT_FILE_PATH) {
            return requestBody;
        }

        const filePromptContent = config.SYSTEM_PROMPT_CONTENT;
        if (filePromptContent === null) {
            return requestBody;
        }

        let existingSystemText = '';
        const systemMessage = requestBody.messages?.find(m => m.role === 'system');
        if (systemMessage) {
            existingSystemText = systemMessage.content || '';
        }

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        if (!requestBody.messages) {
            requestBody.messages = [];
        }
        const systemMessageIndex = requestBody.messages.findIndex(m => m.role === 'system');
        if (systemMessageIndex !== -1) {
            requestBody.messages[systemMessageIndex].content = newSystemText;
        } else {
            requestBody.messages.unshift({ role: 'system', content: newSystemText });
        }
        console.log(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'openai'.`);

        return requestBody;
    }

    async manageSystemPrompt(requestBody) {
        //console.log('[System Prompt] Managing system prompt for provider "openai".', requestBody);
        let incomingSystemText = '';
        const systemMessage = requestBody.messages?.find(m => m.role === 'system');
        if (systemMessage?.content) {
            incomingSystemText = systemMessage.content;
        }
        if (!incomingSystemText) {
            incomingSystemText = requestBody.messages.filter(m => m.role === 'user')[0].content;
        }
        await this._updateSystemPromptFile(incomingSystemText, 'openai');
    }
}

export { OpenAIStrategy };
