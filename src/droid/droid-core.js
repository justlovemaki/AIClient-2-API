import { spawn } from 'child_process';

/**
 * Droid (Factory.ai) API Service
 * Wraps the Droid CLI to provide an API-compatible interface
 */
export class DroidApiService {
    /**
     * Constructor
     * @param {object} config - Configuration object
     */
    constructor(config = {}) {
        this.config = config;
        this.isInitialized = false;
        this.droidCommand = config.DROID_COMMAND || 'droid';
    }

    /**
     * Initialize the service by checking if droid CLI is available
     * @returns {Promise<boolean>} True if initialization succeeded
     */
    async initialize() {
        try {
            console.log('[Droid] Initializing Droid API Service...');
            await this.executeDroidCommand(['--version']);
            this.isInitialized = true;
            console.log('[Droid] Initialization complete.');
            return true;
        } catch (error) {
            console.error('[Droid] Droid CLI not available:', error.message);
            this.isInitialized = false;
            throw new Error('Droid CLI is not installed or not in PATH. Please install from https://factory.ai/product/cli');
        }
    }

    /**
     * Execute droid CLI command and return output
     * @param {Array<string>} args - Command arguments
     * @returns {Promise<string>} Command output
     */
    async executeDroidCommand(args) {
        return new Promise((resolve, reject) => {
            const droid = spawn(this.droidCommand, args);
            let stdout = '';
            let stderr = '';

            droid.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            droid.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            droid.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Droid command failed: ${stderr || stdout}`));
                } else {
                    resolve(stdout);
                }
            });

            droid.on('error', (err) => {
                reject(new Error(`Failed to spawn droid: ${err.message}`));
            });
        });
    }

    /**
     * Convert Claude-format messages to a simple prompt string
     * @param {Array<object>} messages - Array of message objects
     * @returns {string} Combined prompt string
     */
    messagesToPrompt(messages) {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return msg.content;
            } else if (msg.role === 'assistant') {
                return `Assistant: ${msg.content}`;
            } else if (msg.role === 'system') {
                return `System: ${msg.content}`;
            }
            return msg.content;
        }).join('\n\n');
    }

    /**
     * Generates content (non-streaming)
     * @param {string} model - Model name
     * @param {object} requestBody - Request body (Claude format)
     * @returns {Promise<object>} Claude API response (Claude compatible format)
     */
    async generateContent(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const prompt = this.messagesToPrompt(requestBody.messages);
            const output = await this.executeDroidCommand(['exec', prompt]);

            return {
                id: `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [{
                    type: 'text',
                    text: output.trim()
                }],
                model: model,
                stop_reason: 'end_turn',
                usage: {
                    input_tokens: Math.ceil(prompt.length / 4),
                    output_tokens: Math.ceil(output.length / 4)
                }
            };
        } catch (error) {
            throw this._handleError(error);
        }
    }

    /**
     * Streams content generation
     * @param {string} model - Model name
     * @param {object} requestBody - Request body (Claude format)
     * @returns {AsyncIterable<object>} Claude API response stream (Claude compatible format)
     */
    async *generateContentStream(model, requestBody) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const prompt = this.messagesToPrompt(requestBody.messages);

        yield {
            type: 'message_start',
            message: {
                id: `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model: model
            }
        };

        yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' }
        };

        const droid = spawn(this.droidCommand, ['exec', prompt]);

        let buffer = '';
        for await (const chunk of droid.stdout) {
            const text = chunk.toString();
            buffer += text;

            yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: text }
            };
        }

        yield {
            type: 'content_block_stop',
            index: 0
        };

        yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: Math.ceil(buffer.length / 4) }
        };

        yield {
            type: 'message_stop'
        };
    }

    /**
     * Lists available models
     * The Droid provider supports Claude models available through Factory.ai
     * @returns {Promise<object>} List of models
     */
    async listModels() {
        console.log('[Droid] Listing available models.');
        return {
            data: [
                {
                    id: 'claude-sonnet-4-5-20250929',
                    object: 'model',
                    created: 1725494400,
                    owned_by: 'anthropic'
                },
                {
                    id: 'claude-3-7-sonnet-20250219',
                    object: 'model',
                    created: 1708387200,
                    owned_by: 'anthropic'
                },
                {
                    id: 'claude-3-5-sonnet-20241022',
                    object: 'model',
                    created: 1698019200,
                    owned_by: 'anthropic'
                },
                {
                    id: 'claude-3-opus-20240229',
                    object: 'model',
                    created: 1709251200,
                    owned_by: 'anthropic'
                }
            ],
            object: 'list'
        };
    }

    /**
     * Handle CLI errors
     * @param {Error} error - Error object
     * @returns {Error} Formatted error
     */
    _handleError(error) {
        console.error('[Droid] Error:', error.message);
        return new Error(`Droid CLI error: ${error.message}`);
    }
}
