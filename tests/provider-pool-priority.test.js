import { jest } from '@jest/globals';

jest.mock('open', () => ({
    default: jest.fn()
}));

import { ProviderPoolManager } from '../src/providers/provider-pool-manager.js';

function createProvider(uuid, overrides = {}) {
    return {
        uuid,
        checkHealth: false,
        isHealthy: true,
        isDisabled: false,
        needsRefresh: false,
        lastUsed: null,
        usageCount: 0,
        errorCount: 0,
        ...overrides
    };
}

function createManager(providers) {
    const manager = new ProviderPoolManager(
        {
            'claude-kiro-oauth': providers
        },
        {
            saveDebounceTime: 10
        }
    );

    // Tests only validate selection logic; do not write provider_pools.json.
    if (manager.saveTimer) {
        clearTimeout(manager.saveTimer);
        manager.saveTimer = null;
    }
    manager.pendingSaves?.clear?.();
    manager._debouncedSave = () => {};
    return manager;
}

describe('ProviderPoolManager priority selection', () => {
    test('selects lower numeric priority before score/LRU', async () => {
        const manager = createManager([
            createProvider('primary', {
                priority: 1,
                usageCount: 999,
                lastUsed: new Date().toISOString()
            }),
            createProvider('backup', {
                priority: 2,
                usageCount: 0,
                lastUsed: null
            })
        ]);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('primary');
    });

    test('falls back to higher priority number when primary tier is disabled', async () => {
        const manager = createManager([
            createProvider('primary', { priority: 1, isDisabled: true }),
            createProvider('backup', { priority: 2 })
        ]);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('backup');
    });

    test('supports string priorities and defaults invalid values to 100', async () => {
        const manager = createManager([
            createProvider('invalid-default', { priority: 'not-a-number' }),
            createProvider('explicit-primary', { priority: '1' })
        ]);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('explicit-primary');
    });

    test('keeps existing score/LRU behavior inside same priority tier', async () => {
        const manager = createManager([
            createProvider('less-preferred', {
                priority: 1,
                usageCount: 10,
                lastUsed: new Date().toISOString()
            }),
            createProvider('more-preferred', {
                priority: 1,
                usageCount: 0,
                lastUsed: null
            })
        ]);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('more-preferred');
    });
});
