/**
 * @file Warp Provider Strategy
 * @description Implements provider-specific logic for Warp API integration.
 * Handles request/response transformation, system prompt management, and protocol-specific operations.
 * Extends base ProviderStrategy to provide Warp-specific implementations for model extraction,
 * text extraction, and system prompt handling.
 */

import { ProviderStrategy } from '../provider-strategy.js';
import { promises as fs } from 'fs';
import { FETCH_SYSTEM_PROMPT_FILE } from '../common.js';

/**
 * Warp Strategy Class
 */
export class WarpStrategy extends ProviderStrategy {
    /**
     * Extract model and stream information from request
     */
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model || 'claude-4.1-opus';
        const isStream = requestBody.stream === true;
        
        return { model, isStream };
    }

    /**
     * Extract text content from Warp response
     */
    extractResponseText(response) {
        if (!response || !response.choices || response.choices.length === 0) {
            return '';
        }

        const choice = response.choices[0];
        
        // Handle streaming response
        if (choice.delta) {
            return choice.delta.content || '';
        }
        
        // Handle non-streaming response
        if (choice.message) {
            return choice.message.content || '';
        }

        return '';
    }

    /**
     * Extract prompt text from request body
     */
    extractPromptText(requestBody) {
        if (!requestBody.messages || requestBody.messages.length === 0) {
            return '';
        }

        // Get the last user message
        const messages = requestBody.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                const content = messages[i].content;
                if (typeof content === 'string') {
                    return content;
                }
                if (Array.isArray(content)) {
                    // Extract text from content array
                    const textParts = content
                        .filter(part => part.type === 'text')
                        .map(part => part.text);
                    return textParts.join('\n');
                }
            }
        }

        return '';
    }

    /**
     * Apply system prompt from file to request body
     */
    async applySystemPromptFromFile(config, requestBody) {
        if (!config.SYSTEM_PROMPT_FILE_PATH) {
            return requestBody;
        }

        const filePromptContent = config.SYSTEM_PROMPT_CONTENT;
        if (filePromptContent === null) {
            return requestBody;
        }

        // Warp uses 'system' field for system prompts
        // Check if there's already a system prompt in the request
        const existingSystemText = requestBody.system || '';

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        requestBody.system = newSystemText;
        console.log(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'warp'.`);

        return requestBody;
    }

    /**
     * Manage system prompt file
     */
    async manageSystemPrompt(requestBody) {
        let incomingSystemText = '';

        // Extract system prompt from request
        if (requestBody.system) {
            incomingSystemText = requestBody.system;
        } else if (requestBody.messages && requestBody.messages.length > 0) {
            // Check if first message is a system message
            const firstMessage = requestBody.messages[0];
            if (firstMessage.role === 'system') {
                const content = firstMessage.content;
                if (typeof content === 'string') {
                    incomingSystemText = content;
                } else if (Array.isArray(content)) {
                    const textParts = content
                        .filter(part => part.type === 'text')
                        .map(part => part.text);
                    incomingSystemText = textParts.join('\n');
                }
            }
        }

        await this._updateSystemPromptFile(incomingSystemText, 'Warp');
    }
}
