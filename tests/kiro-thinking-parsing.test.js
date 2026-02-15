import { KiroApiService } from '../src/providers/claude/claude-kiro.js';

describe('KiroApiService thinking tag parsing', () => {
    let svc;

    beforeEach(() => {
        svc = new KiroApiService({});
    });

    test('splits <thinking>...</thinking> into Claude content blocks', () => {
        const blocks = svc._toClaudeContentBlocksFromKiroText('<thinking>a</thinking>\n\nhello');
        expect(blocks).toEqual([
            { type: 'thinking', thinking: 'a' },
            { type: 'text', text: 'hello' }
        ]);
    });

    test('ignores quoted </thinking> inside thinking content', () => {
        const blocks = svc._toClaudeContentBlocksFromKiroText('<thinking>about `</thinking>` tag</thinking>\n\nhi');
        expect(blocks).toEqual([
            { type: 'thinking', thinking: 'about `</thinking>` tag' },
            { type: 'text', text: 'hi' }
        ]);
    });

    test('does not treat </thinking> without delimiter as a real end tag', () => {
        const blocks = svc._toClaudeContentBlocksFromKiroText('<thinking>a</thinking>hello');
        expect(blocks).toEqual([
            { type: 'thinking', thinking: 'a</thinking>hello' }
        ]);
    });

    test('treats </thinking> at buffer end as an end tag', () => {
        const blocks = svc._toClaudeContentBlocksFromKiroText('<thinking>a</thinking>');
        expect(blocks).toEqual([
            { type: 'thinking', thinking: 'a' }
        ]);
    });
});

