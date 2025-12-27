import { OpenAIResponsesConverter } from '../src/converters/strategies/OpenAIResponsesConverter.js';

describe('OpenAIResponsesConverter', () => {
    let converter;

    beforeEach(() => {
        converter = new OpenAIResponsesConverter();
    });

    test('toGeminiRequest should handle input without explicit type as message', () => {
        const responsesRequest = {
            "model": "gemini-2.0-flash-exp",
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Hello, world!"
                        }
                    ]
                }
            ],
            "max_output_tokens": 200
        };

        const geminiRequest = converter.toGeminiRequest(responsesRequest);

        expect(geminiRequest.contents).toBeDefined();
        expect(geminiRequest.contents.length).toBe(1);
        expect(geminiRequest.contents[0].role).toBe('user');
        expect(geminiRequest.contents[0].parts[0].text).toBe('Hello, world!');
    });

    test('toGeminiRequest should handle string content in input', () => {
        const responsesRequest = {
            "model": "gemini-2.0-flash-exp",
            "input": [
                {
                    "role": "user",
                    "content": "Hello, world!"
                }
            ],
            "max_output_tokens": 200
        };

        const geminiRequest = converter.toGeminiRequest(responsesRequest);

        expect(geminiRequest.contents).toBeDefined();
        expect(geminiRequest.contents.length).toBe(1);
        expect(geminiRequest.contents[0].role).toBe('user');
        expect(geminiRequest.contents[0].parts[0].text).toBe('Hello, world!');
    });

    test('toGeminiRequest should handle input with explicit message type', () => {
        const responsesRequest = {
            "model": "gemini-2.0-flash-exp",
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Hello, world!"
                        }
                    ]
                }
            ],
            "max_output_tokens": 200
        };

        const geminiRequest = converter.toGeminiRequest(responsesRequest);

        expect(geminiRequest.contents).toBeDefined();
        expect(geminiRequest.contents.length).toBe(1);
        expect(geminiRequest.contents[0].role).toBe('user');
        expect(geminiRequest.contents[0].parts[0].text).toBe('Hello, world!');
    });
});
