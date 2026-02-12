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
        authFailureStreak: 0,
        ...overrides
    };
}

function createManager(providers, globalConfig = {}) {
    const manager = new ProviderPoolManager(
        {
            'claude-kiro-oauth': providers
        },
        {
            saveDebounceTime: 10,
            globalConfig
        }
    );
    if (manager.saveTimer) {
        clearTimeout(manager.saveTimer);
        manager.saveTimer = null;
    }
    manager.pendingSaves?.clear?.();
    manager._debouncedSave = () => {};
    return manager;
}

describe('ProviderPoolManager account-aware policy', () => {
    test('excludes active cooldown nodes when account rotation policy is enabled', async () => {
        const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const manager = createManager([
            createProvider('cooldown-node', {
                cooldownUntil: future,
                lastUsed: null,
                usageCount: 0
            }),
            createProvider('ready-node', {
                cooldownUntil: null,
                lastUsed: null,
                usageCount: 0
            })
        ], {
            ACCOUNT_ROTATION_POLICY_ENABLED: true
        });

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('ready-node');
    });

    test('prefers lower authFailureStreak when nodes are otherwise equivalent', async () => {
        const baseTs = new Date('2026-01-01T00:00:00.000Z').toISOString();
        const manager = createManager([
            createProvider('streak-high', {
                authFailureStreak: 5,
                lastUsed: baseTs,
                usageCount: 1
            }),
            createProvider('streak-low', {
                authFailureStreak: 0,
                lastUsed: baseTs,
                usageCount: 1
            })
        ]);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('streak-low');
    });

    test('builds same account refresh key for same account identity', () => {
        const manager = createManager([createProvider('a')]);
        const first = manager._buildAccountRefreshKey('claude-kiro-oauth', {
            accountId: 'acct-1',
            authMethod: 'social',
            uuid: 'node-a'
        });
        const second = manager._buildAccountRefreshKey('claude-kiro-oauth', {
            accountId: 'acct-1',
            authMethod: 'social',
            uuid: 'node-b'
        });
        expect(first).toBe(second);
    });
});
