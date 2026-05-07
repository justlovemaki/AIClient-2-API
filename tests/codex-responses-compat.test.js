import { CodexConverter } from '../src/converters/strategies/CodexConverter.js';

describe('Codex Responses compatibility', () => {
    test('converts Responses tools, direct tool_choice name, and strips unsupported fields', () => {
        const converter = new CodexConverter();
        const request = converter.toOpenAIResponsesToCodexRequest({
            model: 'gpt-5.5',
            input: 'Call the tool.',
            tools: [{
                type: 'function',
                name: 'get_city_time',
                description: 'Get city time',
                parameters: {
                    type: 'object',
                    properties: { city: { type: 'string' } },
                    required: ['city'],
                    additionalProperties: false
                }
            }],
            tool_choice: { type: 'function', name: 'get_city_time' },
            prompt_cache_retention: '24h',
            safety_identifier: 'user-123',
            user: 'user-123'
        });

        expect(request.instructions).toBe('You are a helpful coding assistant.');
        expect(request.tools).toHaveLength(1);
        expect(request.tools[0]).toMatchObject({ type: 'function', name: 'get_city_time' });
        expect(request.tool_choice).toEqual({ type: 'function', name: 'get_city_time' });
        expect(request.prompt_cache_retention).toBeUndefined();
        expect(request.safety_identifier).toBeUndefined();
        expect(request.user).toBeUndefined();
    });

    test('maps direct Responses tool_choice names through shortened tool-name map', () => {
        const converter = new CodexConverter();
        const longName = `mcp__server__${'x'.repeat(80)}`;
        const request = converter.toOpenAIResponsesToCodexRequest({
            model: 'gpt-5.5',
            input: 'Call the tool.',
            tools: [{
                type: 'function',
                name: longName,
                description: 'Long tool name',
                parameters: { type: 'object', properties: {} }
            }],
            tool_choice: { type: 'function', name: longName }
        });

        expect(request.tools[0].name.length).toBeLessThanOrEqual(64);
        expect(request.tool_choice.name).toBe(request.tools[0].name);
    });
});
