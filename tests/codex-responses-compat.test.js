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

    test('keeps Responses stream chunks raw by default', () => {
        const converter = new CodexConverter();
        const chunk = { type: 'response.output_text.delta', delta: 'OK' };
        delete process.env.CODEX_RESPONSES_STREAM_MODE;

        expect(converter.toOpenAIResponsesStreamChunk(chunk, 'gpt-5.5', 'req_raw')).toBe(chunk);
    });

    test('canonical Responses stream emits typed text lifecycle', () => {
        const converter = new CodexConverter();
        process.env.CODEX_RESPONSES_STREAM_MODE = 'canonical';
        try {
            const events = [];
            const push = value => events.push(...(Array.isArray(value) ? value : [value]).filter(Boolean));

            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.created',
                response: { id: 'resp_text', model: 'gpt-5.5' }
            }, 'gpt-5.5', 'req_text'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.output_text.delta',
                response_id: 'resp_text',
                delta: 'OK'
            }, 'gpt-5.5', 'req_text'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.completed',
                response: { id: 'resp_text', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
            }, 'gpt-5.5', 'req_text'));

            expect(events.map(event => event.type)).toEqual([
                'response.created',
                'response.in_progress',
                'response.output_item.added',
                'response.content_part.added',
                'response.output_text.delta',
                'response.output_text.done',
                'response.content_part.done',
                'response.output_item.done',
                'response.completed'
            ]);
            const completed = events.at(-1);
            expect(completed.response.output[0]).toMatchObject({ type: 'message', role: 'assistant' });
            expect(completed.response.output[0].content[0].text).toBe('OK');
        } finally {
            delete process.env.CODEX_RESPONSES_STREAM_MODE;
        }
    });

    test('canonical Responses stream emits complete function_call lifecycle', () => {
        const converter = new CodexConverter();
        process.env.CODEX_RESPONSES_STREAM_MODE = 'canonical';
        try {
            const events = [];
            const push = value => events.push(...(Array.isArray(value) ? value : [value]).filter(Boolean));

            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.created',
                response: { id: 'resp_tool', model: 'gpt-5.5' }
            }, 'gpt-5.5', 'req_tool'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.output_item.done',
                response_id: 'resp_tool',
                output_index: 0,
                item: {
                    id: 'fc_1',
                    call_id: 'call_1',
                    type: 'function_call',
                    name: 'get_city_time',
                    arguments: '{"city":"Paris"}',
                    status: 'completed'
                }
            }, 'gpt-5.5', 'req_tool'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.completed',
                response: { id: 'resp_tool', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
            }, 'gpt-5.5', 'req_tool'));

            expect(events.map(event => event.type)).toEqual([
                'response.created',
                'response.in_progress',
                'response.output_item.added',
                'response.function_call_arguments.delta',
                'response.function_call_arguments.done',
                'response.output_item.done',
                'response.completed'
            ]);
            const completedCall = events.at(-1).response.output[0];
            expect(completedCall).toMatchObject({
                id: 'fc_1',
                call_id: 'call_1',
                type: 'function_call',
                name: 'get_city_time',
                arguments: '{"city":"Paris"}',
                status: 'completed'
            });
        } finally {
            delete process.env.CODEX_RESPONSES_STREAM_MODE;
        }
    });


    test('normalizes Responses function_call call_id from item id', () => {
        const converter = new CodexConverter();
        const response = converter.toOpenAIResponsesResponse({
            type: 'response.completed',
            response: {
                id: 'resp_tool',
                model: 'gpt-5.5',
                output: [{
                    id: 'fc_1',
                    type: 'function_call',
                    name: 'get_probe',
                    arguments: '{}',
                    status: 'completed'
                }],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
            }
        }, 'gpt-5.5');

        expect(response.output[0]).toMatchObject({
            id: 'fc_1',
            call_id: 'fc_1',
            type: 'function_call',
            name: 'get_probe',
            arguments: '{}',
            status: 'completed'
        });
    });


    test('canonical Responses stream densifies sparse upstream function_call indexes', () => {
        const converter = new CodexConverter();
        process.env.CODEX_RESPONSES_STREAM_MODE = 'canonical';
        try {
            const events = [];
            const push = value => events.push(...(Array.isArray(value) ? value : [value]).filter(Boolean));

            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.created',
                response: { id: 'resp_sparse_tool', model: 'gpt-5.5' }
            }, 'gpt-5.5', 'req_sparse_tool'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.output_item.done',
                response_id: 'resp_sparse_tool',
                output_index: 3,
                item: {
                    id: 'fc_sparse',
                    call_id: 'call_sparse',
                    type: 'function_call',
                    name: 'get_city_time',
                    arguments: '{"city":"Paris"}',
                    status: 'completed'
                }
            }, 'gpt-5.5', 'req_sparse_tool'));

            const functionEvents = events.filter(event => event.output_index !== undefined);
            expect(functionEvents.map(event => event.output_index)).toEqual([0, 0, 0, 0]);
            expect(functionEvents.map(event => event.type)).toEqual([
                'response.output_item.added',
                'response.function_call_arguments.delta',
                'response.function_call_arguments.done',
                'response.output_item.done'
            ]);
        } finally {
            delete process.env.CODEX_RESPONSES_STREAM_MODE;
        }
    });

    test('canonical Responses stream keeps text and sparse function_call indexes dense', () => {
        const converter = new CodexConverter();
        process.env.CODEX_RESPONSES_STREAM_MODE = 'canonical';
        try {
            const events = [];
            const push = value => events.push(...(Array.isArray(value) ? value : [value]).filter(Boolean));

            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.created',
                response: { id: 'resp_text_tool_sparse', model: 'gpt-5.5' }
            }, 'gpt-5.5', 'req_text_tool_sparse'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.output_text.delta',
                response_id: 'resp_text_tool_sparse',
                delta: 'Need a tool.'
            }, 'gpt-5.5', 'req_text_tool_sparse'));
            push(converter.toOpenAIResponsesStreamChunk({
                type: 'response.output_item.done',
                response_id: 'resp_text_tool_sparse',
                output_index: 5,
                item: {
                    id: 'fc_after_text',
                    call_id: 'call_after_text',
                    type: 'function_call',
                    name: 'get_city_time',
                    arguments: '{"city":"Paris"}',
                    status: 'completed'
                }
            }, 'gpt-5.5', 'req_text_tool_sparse'));

            const indexedEvents = events.filter(event => event.output_index !== undefined);
            expect(indexedEvents.map(event => event.output_index)).toEqual([0, 0, 0, 1, 1, 1, 1]);
        } finally {
            delete process.env.CODEX_RESPONSES_STREAM_MODE;
        }
    });

});
