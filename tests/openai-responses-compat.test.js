import { OpenAIResponsesConverter } from '../src/converters/strategies/OpenAIResponsesConverter.js';
import { ResponsesAPIStrategy } from '../src/providers/openai/openai-responses-strategy.js';
import { extractSystemPromptFromRequestBody, MODEL_PROTOCOL_PREFIX } from '../src/utils/common.js';

describe('OpenAI Responses compatibility', () => {
    test('extracts system prompt from Responses instructions and input messages', () => {
        expect(extractSystemPromptFromRequestBody({
            instructions: 'Be precise.'
        }, MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES)).toBe('Be precise.');

        expect(extractSystemPromptFromRequestBody({
            input: [{ role: 'system', content: [{ type: 'input_text', text: 'Be safe.' }] }]
        }, MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES)).toBe('Be safe.');
    });

    test('applies Responses system prompt file without ReferenceError', async () => {
        const strategy = new ResponsesAPIStrategy();
        const requestBody = { instructions: 'Original', input: 'Hello' };

        const result = await strategy.applySystemPromptFromFile({
            SYSTEM_PROMPT_FILE_PATH: 'prompt.txt',
            SYSTEM_PROMPT_CONTENT: 'File prompt',
            SYSTEM_PROMPT_MODE: 'append',
            SYSTEM_PROMPT_REPLACEMENTS: []
        }, requestBody);

        expect(result.instructions).toBe('Original\nFile prompt');
        expect(result.input).toBe('Hello');
    });

    test('normalizes direct Responses tool_choice for Chat Completions and Claude', () => {
        const converter = new OpenAIResponsesConverter();
        const request = {
            model: 'gpt-5.5',
            input: [{ role: 'user', content: 'Call the tool.' }],
            tool_choice: { type: 'function', name: 'get_city_time' }
        };

        expect(converter.toOpenAIRequest(request).tool_choice).toEqual({
            type: 'function',
            function: { name: 'get_city_time' }
        });
        expect(converter.toClaudeRequest(request).tool_choice).toEqual({
            type: 'tool',
            name: 'get_city_time'
        });
    });
});