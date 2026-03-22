import { getProviderModels } from '../src/providers/provider-models.js';

describe('provider models', () => {
    test('openai-codex-oauth exposes gpt-5.4-mini', () => {
        const models = getProviderModels('openai-codex-oauth');

        expect(models).toContain('gpt-5.4-mini');
    });
});
