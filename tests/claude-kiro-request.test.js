import { execFileSync } from 'child_process';

describe('Kiro CodeWhisperer request conversion', () => {
    test('keeps single-turn user requests out of history', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            const service = new KiroApiService();
            const inputMessages = [
                { role: 'user', content: 'hello' }
            ];

            const request = await service.buildCodewhispererRequest(
                inputMessages,
                'claude-opus-4-7',
                null,
                'system prompt'
            );

            if (request.conversationState.history !== undefined) {
                throw new Error('single-turn request unexpectedly has history');
            }

            const content = request.conversationState.currentMessage.userInputMessage.content;
            if (!content.includes('system prompt') || !content.includes('hello')) {
                throw new Error('current message missing expected content');
            }

            if (JSON.stringify(inputMessages) !== JSON.stringify([{ role: 'user', content: 'hello' }])) {
                throw new Error('input messages were mutated');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });

    test('keeps prior turns in history for multi-turn requests', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            const service = new KiroApiService();
            const request = await service.buildCodewhispererRequest(
                [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'second' },
                    { role: 'user', content: 'third' }
                ],
                'claude-opus-4-7',
                null,
                'system prompt'
            );

            const history = request.conversationState.history;
            if (!Array.isArray(history) || history.length !== 2) {
                throw new Error('multi-turn history length changed');
            }

            if (!history[0].userInputMessage?.content.includes('first')) {
                throw new Error('first user turn missing from history');
            }

            if (history[1].assistantResponseMessage?.content !== 'second') {
                throw new Error('assistant turn missing from history');
            }

            if (request.conversationState.currentMessage.userInputMessage.content !== 'third') {
                throw new Error('current message changed');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });
});
