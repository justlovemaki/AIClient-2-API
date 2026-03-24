import fs from 'fs';
import path from 'path';
const grokCorePath = path.join(process.cwd(), 'src/providers/grok/grok-core.js');

describe('Grok 4.20 payload format implementation', () => {
    const content = fs.readFileSync(grokCorePath, 'utf8');

    test('adds grok-4.20-fast model mapping', () => {
        expect(content).toContain("'grok-4.20-fast': { name: 'grok-420', mode: 'MODEL_MODE_FAST', modeId: 'fast' }");
    });

    test('uses modeId format for grok-420 payload', () => {
        expect(content).toContain("if (mapping.name === 'grok-420')");
        expect(content).toContain("delete payload.modelName;");
        expect(content).toContain("delete payload.modelMode;");
        expect(content).toContain("payload.modeId = mapping.modeId || 'expert';");
        expect(content).toContain("payload.enable420 = true;");
    });

    test('allows extra_body.temporary to override default temporary=true', () => {
        expect(content).toContain('"temporary": requestBody?.extra_body?.temporary ?? true');
    });
});
