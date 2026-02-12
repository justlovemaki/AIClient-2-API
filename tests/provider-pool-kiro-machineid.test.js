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
            saveDebounceTime: 600000,
            globalConfig: {
                ACCOUNT_ROTATION_POLICY_ENABLED: true
            }
        }
    );
    if (manager.saveTimer) {
        clearTimeout(manager.saveTimer);
        manager.saveTimer = null;
    }
    manager.pendingSaves.clear();
    manager._debouncedSave = () => {};
    return manager;
}

describe('ProviderPoolManager Kiro machineId assignment', () => {
    test('auto-assigns unique machineId for each account node when missing', () => {
        const providers = [
            createProvider('node-1', { accountId: 'acct-1' }),
            createProvider('node-2', { accountId: 'acct-2' })
        ];

        const manager = createManager(providers);
        const node1 = manager._findProvider('claude-kiro-oauth', 'node-1').config;
        const node2 = manager._findProvider('claude-kiro-oauth', 'node-2').config;

        expect(node1.machineId).toBeTruthy();
        expect(node2.machineId).toBeTruthy();
        expect(node1.machineId).not.toBe(node2.machineId);
        expect(node1.KIRO_MACHINE_ID).toBe(node1.machineId);
        expect(node2.KIRO_MACHINE_ID).toBe(node2.machineId);
    });

    test('reuses the same machineId for duplicate accountId within the same pool', () => {
        const providers = [
            createProvider('node-1', { accountId: 'acct-dup' }),
            createProvider('node-2', { accountId: 'acct-dup' })
        ];

        const manager = createManager(providers);
        const node1 = manager._findProvider('claude-kiro-oauth', 'node-1').config;
        const node2 = manager._findProvider('claude-kiro-oauth', 'node-2').config;

        expect(node1.machineId).toBeTruthy();
        expect(node2.machineId).toBeTruthy();
        expect(node2.machineId).toBe(node1.machineId);
        expect(node1.KIRO_MACHINE_ID).toBe(node1.machineId);
        expect(node2.KIRO_MACHINE_ID).toBe(node2.machineId);
    });

    test('keeps configured machineId unchanged', () => {
        const providers = [
            createProvider('node-1', {
                accountId: 'acct-1',
                machineId: 'manual-machine-id-0001'
            })
        ];

        const manager = createManager(providers);
        const node = manager._findProvider('claude-kiro-oauth', 'node-1').config;

        expect(node.machineId).toBe('manual-machine-id-0001');
        expect(node.KIRO_MACHINE_ID).toBe('manual-machine-id-0001');
    });

    test('machineId generation is account-sticky when accountId is stable', () => {
        const providersA = [
            createProvider('node-1', { accountId: 'acct-sticky' })
        ];
        const managerA = createManager(providersA);
        const machineA = managerA._findProvider('claude-kiro-oauth', 'node-1').config.machineId;

        const providersB = [
            createProvider('node-2', { accountId: 'acct-sticky' })
        ];
        const managerB = createManager(providersB);
        const machineB = managerB._findProvider('claude-kiro-oauth', 'node-2').config.machineId;

        expect(machineA).toBe(machineB);
    });
});
