
import GeminiConverter from '../src/converters/strategies/GeminiConverter.js';
import { jest } from '@jest/globals';

describe('GeminiConverter', () => {
    let converter;

    beforeEach(() => {
        converter = new GeminiConverter();
    });

    test('toOpenAIStreamChunk adds index to tool_calls', () => {
        const geminiChunk = {
            candidates: [{
                content: {
                    parts: [{
                        functionCall: {
                            name: 'test_tool',
                            args: { param: 'value' }
                        }
                    }]
                }
            }]
        };

        const result = converter.toOpenAIStreamChunk(geminiChunk, 'gemini-pro');

        expect(result).not.toBeNull();
        expect(result.choices[0].delta).toHaveProperty('tool_calls');
        expect(result.choices[0].delta.tool_calls).toHaveLength(1);
        expect(result.choices[0].delta.tool_calls[0]).toHaveProperty('index');
        expect(result.choices[0].delta.tool_calls[0].index).toBe(0);
        expect(result.choices[0].delta.tool_calls[0].function.name).toBe('test_tool');
    });

    test('toOpenAIStreamChunk handles multiple tool_calls with correct indices', () => {
        const geminiChunk = {
            candidates: [{
                content: {
                    parts: [
                        {
                            functionCall: {
                                name: 'tool_one',
                                args: {}
                            }
                        },
                        {
                            functionCall: {
                                name: 'tool_two',
                                args: {}
                            }
                        }
                    ]
                }
            }]
        };

        const result = converter.toOpenAIStreamChunk(geminiChunk, 'gemini-pro');

        expect(result).not.toBeNull();
        expect(result.choices[0].delta.tool_calls).toHaveLength(2);
        
        expect(result.choices[0].delta.tool_calls[0].index).toBe(0);
        expect(result.choices[0].delta.tool_calls[0].function.name).toBe('tool_one');

        expect(result.choices[0].delta.tool_calls[1].index).toBe(1);
        expect(result.choices[0].delta.tool_calls[1].function.name).toBe('tool_two');
    });

    test('toOpenAIStreamChunk sets finish_reason to tool_calls when tool calls are present and finishReason is STOP', () => {
        const geminiChunk = {
            candidates: [{
                finishReason: 'STOP',
                content: {
                    parts: [{
                        functionCall: {
                            name: 'test_tool',
                            args: {}
                        }
                    }]
                }
            }]
        };

        const result = converter.toOpenAIStreamChunk(geminiChunk, 'gemini-pro');

        expect(result).not.toBeNull();
        expect(result.choices[0].finish_reason).toBe('tool_calls');
    });
});
