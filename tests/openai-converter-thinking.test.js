import { OpenAIConverter } from '../src/converters/strategies/OpenAIConverter.js';

describe('OpenAIConverter thinking passthrough', () => {
    let converter;

    beforeEach(() => {
        converter = new OpenAIConverter();
    });

    test('toClaudeRequest maps extra_body.anthropic.thinking enabled', () => {
        const openaiRequest = {
            model: 'claude-sonnet-4-5',
            messages: [{ role: 'user', content: 'hi' }],
            extra_body: {
                anthropic: {
                    thinking: { type: 'enabled', budget_tokens: '10000' }
                }
            }
        };

        const claudeRequest = converter.toClaudeRequest(openaiRequest);
        expect(claudeRequest.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    });

    test('toClaudeRequest maps extra_body.anthropic.thinking adaptive', () => {
        const openaiRequest = {
            model: 'claude-sonnet-4-5',
            messages: [{ role: 'user', content: 'hi' }],
            extra_body: {
                anthropic: {
                    thinking: { type: 'adaptive', effort: 'Medium' }
                }
            }
        };

        const claudeRequest = converter.toClaudeRequest(openaiRequest);
        expect(claudeRequest.thinking).toEqual({ type: 'adaptive', effort: 'medium' });
    });

    test('toClaudeRequest ignores invalid thinking objects', () => {
        const openaiRequest = {
            model: 'claude-sonnet-4-5',
            messages: [{ role: 'user', content: 'hi' }],
            extra_body: {
                anthropic: {
                    thinking: 'enabled'
                }
            }
        };

        const claudeRequest = converter.toClaudeRequest(openaiRequest);
        expect(claudeRequest.thinking).toBeUndefined();
    });
});

