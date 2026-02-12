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
        isDraining: false,
        lastUsed: null,
        usageCount: 0,
        errorCount: 0,
        authFailureStreak: 0,
        ...overrides
    };
}

function createManager(providers) {
    const manager = new ProviderPoolManager(
        {
            'claude-kiro-oauth': providers
        },
        {
            saveDebounceTime: 10,
            globalConfig: {
                ACCOUNT_ROTATION_POLICY_ENABLED: true
            }
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

describe('ProviderPoolManager risk operator primitives', () => {
    test('setProviderDrainMode excludes drained node from selection', async () => {
        const manager = createManager([
            createProvider('drained-node'),
            createProvider('ready-node')
        ]);

        const op = manager.setProviderDrainMode('claude-kiro-oauth', 'drained-node', true);
        expect(op.success).toBe(true);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('ready-node');
    });

    test('applyProviderCooldown and clearProviderCooldown update runtime gating', () => {
        const manager = createManager([
            createProvider('node-1', { cooldownUntil: null })
        ]);

        const apply = manager.applyProviderCooldown('claude-kiro-oauth', 'node-1', {
            durationMs: 60 * 1000
        });
        expect(apply.success).toBe(true);
        expect(typeof apply.cooldownUntil).toBe('string');

        const provider = manager._findProvider('claude-kiro-oauth', 'node-1');
        expect(provider.config.cooldownUntil).toBeTruthy();
        expect(provider.config.quotaExhaustedUntil).toBeTruthy();

        const clear = manager.clearProviderCooldown('claude-kiro-oauth', 'node-1');
        expect(clear.success).toBe(true);
        expect(provider.config.cooldownUntil).toBeNull();
        expect(provider.config.quotaExhaustedUntil).toBeNull();
    });

    test('forceRefreshProviderCredential marks node and enqueues forced refresh', () => {
        const manager = createManager([
            createProvider('node-1')
        ]);

        const enqueueSpy = jest.spyOn(manager, '_enqueueRefresh').mockImplementation(() => {});

        const result = manager.forceRefreshProviderCredential('claude-kiro-oauth', 'node-1', {
            reason: 'manual intervention'
        });

        expect(result.success).toBe(true);
        const provider = manager._findProvider('claude-kiro-oauth', 'node-1');
        expect(provider.config.needsRefresh).toBe(true);
        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy.mock.calls[0][2]).toBe(true);

        enqueueSpy.mockRestore();
    });

    test('getSelectionPreview returns deterministic candidates without mutating usage counters', async () => {
        const manager = createManager([
            createProvider('node-a', {
                priority: 1,
                usageCount: 0,
                lastUsed: null
            }),
            createProvider('node-b', {
                priority: 1,
                usageCount: 5,
                lastUsed: new Date().toISOString()
            })
        ]);

        const beforeUsageA = manager._findProvider('claude-kiro-oauth', 'node-a').config.usageCount;
        const preview = manager.getSelectionPreview('claude-kiro-oauth');

        expect(preview.selected.uuid).toBe('node-a');
        expect(preview.candidateCount).toBeGreaterThan(0);

        const afterUsageA = manager._findProvider('claude-kiro-oauth', 'node-a').config.usageCount;
        expect(afterUsageA).toBe(beforeUsageA);

        const selected = await manager.selectProvider('claude-kiro-oauth');
        expect(selected.uuid).toBe('node-a');
    });
});
