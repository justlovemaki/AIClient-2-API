import { promises as fs } from 'fs';
import { FETCH_SYSTEM_PROMPT_FILE } from '../utils/common.js';

/**
 * Abstract provider strategy class, defining the interface for handling different model providers.
 */
export class ProviderStrategy {
    /**
     * Extracts model and stream information.
     * @param {object} req - HTTP request object.
     * @param {object} requestBody - Parsed request body.
     * @returns {{model: string, isStream: boolean}} Object containing model name and stream status.
     */
    extractModelAndStreamInfo(req, requestBody) {
        throw new Error("Method 'extractModelAndStreamInfo()' must be implemented.");
    }

    /**
     * Extracts text content from the response.
     * @param {object} response - API response object.
     * @returns {string} Extracted text content.
     */
    extractResponseText(response) {
        throw new Error("Method 'extractResponseText()' must be implemented.");
    }

    /**
     * Extracts prompt text from the request body.
     * @param {object} requestBody - Request body object.
     * @returns {string} Extracted prompt text.
     */
    extractPromptText(requestBody) {
        throw new Error("Method 'extractPromptText()' must be implemented.");
    }

    /**
     * Applies system prompt file content to the request body.
     * @param {object} config - Configuration object.
     * @param {object} requestBody - Request body object.
     * @returns {Promise<object>} Modified request body.
     */
    async applySystemPromptFromFile(config, requestBody) {
        throw new Error("Method 'applySystemPromptFromFile()' must be implemented.");
    }

    /**
     * Manages the system prompt file.
     * @param {object} requestBody - Request body object.
     * @returns {Promise<void>}
     */
    async manageSystemPrompt(requestBody) {
        throw new Error("Method 'manageSystemPrompt()' must be implemented.");
    }

    /**
     * Updates the system prompt file.
     * @param {string} incomingSystemText - Incoming system prompt text.
     * @param {string} providerName - Provider name (for logging).
     * @returns {Promise<void>}
     */
    async _updateSystemPromptFile(incomingSystemText, providerName) {
        let currentSystemText = '';
        try {
            currentSystemText = await fs.readFile(FETCH_SYSTEM_PROMPT_FILE, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`[System Prompt Manager] Error reading system prompt file: ${error.message}`);
            }
        }

        try {
            if (incomingSystemText && incomingSystemText !== currentSystemText) {
                await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, incomingSystemText);
                console.log(`[System Prompt Manager] System prompt updated in file for provider '${providerName}'.`);
            } else if (!incomingSystemText && currentSystemText) {
                await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, '');
                console.log('[System Prompt Manager] System prompt cleared from file.');
            }
        } catch (error) {
            console.error(`[System Prompt Manager] Failed to manage system prompt file: ${error.message}`);
        }
    }
}
