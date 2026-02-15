import { ClaudeConverter } from '../src/converters/strategies/ClaudeConverter.js';

describe('ClaudeConverter thinking -> OpenAI reasoning_content', () => {
    let converter;

    beforeEach(() => {
        converter = new ClaudeConverter();
    });

    test('toOpenAIResponse surfaces thinking blocks as reasoning_content', () => {
        const claudeResponse = {
            content: [
                { type: 'thinking', thinking: 'x' },
                { type: 'text', text: 'y' }
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 2 }
        };

        const openai = converter.toOpenAIResponse(claudeResponse, 'claude-sonnet-4-5');
        expect(openai.choices[0].message.content).toBe('y');
        expect(openai.choices[0].message.reasoning_content).toBe('x');
    });

    test('toOpenAIResponse includes tool_calls and reasoning_content together', () => {
        const claudeResponse = {
            content: [
                { type: 'thinking', thinking: 'r' },
                { type: 'text', text: 't' },
                { type: 'tool_use', id: 'toolu_1', name: 'my_tool', input: { a: 1 } }
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 1, output_tokens: 2 }
        };

        const openai = converter.toOpenAIResponse(claudeResponse, 'claude-sonnet-4-5');
        expect(openai.choices[0].message.content).toBe('t');
        expect(openai.choices[0].message.reasoning_content).toBe('r');
        expect(openai.choices[0].message.tool_calls).toHaveLength(1);
        expect(openai.choices[0].message.tool_calls[0].function.name).toBe('my_tool');
    });
});

