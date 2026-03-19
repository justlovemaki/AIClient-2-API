/**
 * MiniMax API Integration Tests
 *
 * Tests direct API calls to MiniMax's OpenAI-compatible endpoint.
 * Requires MINIMAX_API_KEY environment variable.
 *
 * Run: MINIMAX_API_KEY=<key> npx jest tests/minimax-integration.test.js
 */

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

const describeIfApiKey = MINIMAX_API_KEY ? describe : describe.skip;

describeIfApiKey('MiniMax API Integration Tests', () => {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    };

    /**
     * Strip <think>...</think> blocks from MiniMax response content.
     * M2.7 models may include thinking/reasoning blocks.
     */
    function stripThinking(content) {
        if (!content) return content;
        return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }

    describe('Chat Completions (non-streaming)', () => {
        it('should generate a response with MiniMax-M2.7', async () => {
            const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'MiniMax-M2.7',
                    messages: [
                        { role: 'user', content: 'What is 2+2? Reply with just the number.' }
                    ],
                    max_tokens: 256,
                    temperature: 0.01,
                }),
            });

            expect(response.status).toBe(200);
            const data = await response.json();

            expect(data.choices).toBeDefined();
            expect(data.choices.length).toBeGreaterThan(0);
            expect(data.choices[0].message).toBeDefined();
            expect(data.choices[0].message.content).toBeDefined();

            const content = stripThinking(data.choices[0].message.content);
            expect(content.length).toBeGreaterThan(0);
            expect(content).toContain('4');
        }, 60000);

        it('should generate a response with MiniMax-M2.7-highspeed', async () => {
            const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'MiniMax-M2.7-highspeed',
                    messages: [
                        { role: 'user', content: 'Say "hello" in one word.' }
                    ],
                    max_tokens: 64,
                    temperature: 0.01,
                }),
            });

            expect(response.status).toBe(200);
            const data = await response.json();

            expect(data.choices).toBeDefined();
            expect(data.choices.length).toBeGreaterThan(0);
            expect(data.choices[0].message.content).toBeDefined();
        }, 60000);

        it('should handle temperature=0.01 correctly (near-zero)', async () => {
            const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'MiniMax-M2.7-highspeed',
                    messages: [
                        { role: 'user', content: 'Reply with exactly: OK' }
                    ],
                    max_tokens: 64,
                    temperature: 0.01,
                }),
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.choices[0].message.content).toBeDefined();
        }, 60000);
    });

    describe('Chat Completions (streaming)', () => {
        it('should stream a response with MiniMax-M2.7-highspeed', async () => {
            const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'MiniMax-M2.7-highspeed',
                    messages: [
                        { role: 'user', content: 'Count from 1 to 3.' }
                    ],
                    max_tokens: 64,
                    temperature: 0.5,
                    stream: true,
                }),
            });

            expect(response.status).toBe(200);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                const lines = text.split('\n').filter(l => l.startsWith('data: '));

                for (const line of lines) {
                    const jsonStr = line.substring(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        if (chunk.choices?.[0]?.delta?.content) {
                            fullText += chunk.choices[0].delta.content;
                            chunkCount++;
                        }
                    } catch (e) {
                        // skip unparseable chunks
                    }
                }
            }

            expect(chunkCount).toBeGreaterThan(0);
            expect(fullText.length).toBeGreaterThan(0);
        }, 60000);
    });
});
