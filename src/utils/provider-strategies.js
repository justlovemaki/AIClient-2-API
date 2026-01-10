import { MODEL_PROTOCOL_PREFIX } from '../utils/common.js';
import { GeminiStrategy } from '../providers/gemini/gemini-strategy.js';
import { OpenAIStrategy } from '../providers/openai/openai-strategy.js';
import { ClaudeStrategy } from '../providers/claude/claude-strategy.js';
import { ResponsesAPIStrategy } from '../providers/openai/openai-responses-strategy.js';

/**
 * Strategy factory that returns the appropriate strategy instance based on the provider protocol.
 */
class ProviderStrategyFactory {
    static getStrategy(providerProtocol) {
        switch (providerProtocol) {
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return new GeminiStrategy();
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return new OpenAIStrategy();
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return new ResponsesAPIStrategy();
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return new ClaudeStrategy();
            default:
                throw new Error(`Unsupported provider protocol: ${providerProtocol}`);
        }
    }
}

export { ProviderStrategyFactory };
