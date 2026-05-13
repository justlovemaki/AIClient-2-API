import { ProviderStrategy } from '../../utils/provider-strategy.js';
import logger from '../../utils/logger.js';
import { extractSystemPromptFromRequestBody, MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';
import { applySystemPromptReplacements } from '../../converters/utils.js';

/**
 * OpenAI Responses API strategy implementation.
 * Migrated from Chat Completions API to Responses API.
 */
class ResponsesAPIStrategy extends ProviderStrategy {
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model;
        const isStream = requestBody.stream === true;
        return { model, isStream };
    }

    extractResponseText(response) {
        if (!response.output) {
            return '';
        }

        // In Responses API, output is an array of items
        for (const item of response.output) {
            if (item.type === 'message' && item.content && item.content.length > 0) {
                for (const content of item.content) {
                    if (content.type === 'output_text' && content.text) {
                        return content.text;
                    }
                }
            }
        }
        return '';
    }

    extractPromptText(requestBody) {
        // In Responses API, input can be a string or array of items
        if (typeof requestBody.input === 'string') {
            return requestBody.input;
        } else if (Array.isArray(requestBody.input)) {
            // If input is an array of items/messages, get the last user content
            const userInputItems = requestBody.input.filter(item =>
                (item.role && item.role === 'user') ||
                (item.type && item.type === 'message' && item.role === 'user') ||
                (item.type && item.type === 'user')
            );

            if (userInputItems.length > 0) {
                const lastInput = userInputItems[userInputItems.length - 1];
                if (typeof lastInput.content === 'string') {
                    return lastInput.content;
                } else if (Array.isArray(lastInput.content)) {
                    return lastInput.content.map(item => item.text || item.content || '').join('\n');
                }
            }
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

        const existingSystemText = extractSystemPromptFromRequestBody(requestBody, MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES);

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        const finalSystemText = applySystemPromptReplacements(newSystemText, config.SYSTEM_PROMPT_REPLACEMENTS);

        const systemMessageIndex = Array.isArray(requestBody.input)
            ? requestBody.input.findIndex(m =>
                m.role === 'system' || m.role === 'developer' || m.type === 'system' || m.type === 'developer'
            )
            : -1;

        if (!requestBody.instructions && systemMessageIndex !== -1) {
            requestBody.input[systemMessageIndex].content = finalSystemText;
        } else {
            requestBody.instructions = finalSystemText;
        }

        logger.info(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'responses'.`);

        return requestBody;
    }

    async manageSystemPrompt(requestBody) {
        // For Responses API, we may extract instructions or system messages from input
        let incomingSystemText = '';

        if (requestBody.instructions) {
            incomingSystemText = requestBody.instructions;
        } else if (Array.isArray(requestBody.input)) {
            const systemMessage = requestBody.input.find(item =>
                item.role === 'system' || (item.type && item.type === 'system')
            );
            if (systemMessage && systemMessage.content) {
                incomingSystemText = systemMessage.content;
            }
        }

        await this._updateSystemPromptFile(incomingSystemText, MODEL_PROTOCOL_PREFIX.OPENAI);
    }
}

export { ResponsesAPIStrategy };
