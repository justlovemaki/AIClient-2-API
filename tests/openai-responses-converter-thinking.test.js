import { OpenAIResponsesConverter } from '../src/converters/strategies/OpenAIResponsesConverter.js';

describe('OpenAIResponsesConverter reasoning -> thinking mapping', () => {
    let converter;

    beforeEach(() => {
        converter = new OpenAIResponsesConverter();
    });

    test.each([
        ['low', 2048],
        ['medium', 8192],
        ['high', 20000],
        ['unknown', 20000],
    ])('toClaudeRequest maps reasoning.effort=%s to budget_tokens=%i', (effort, budgetTokens) => {
        const responsesRequest = {
            model: 'claude-sonnet-4-5',
            max_output_tokens: 64,
            reasoning: { effort },
            input: [{ role: 'user', content: 'hi' }]
        };

        const claudeRequest = converter.toClaudeRequest(responsesRequest);
        expect(claudeRequest.thinking).toEqual({ type: 'enabled', budget_tokens: budgetTokens });
    });
});

