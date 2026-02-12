import { buildProviderIdentityContext, classifyProviderError } from '../src/risk/provider-account-policy.js';
import { RISK_SIGNAL } from '../src/risk/constants.js';

describe('provider-account-policy classification', () => {
    test('AUTH_INVALID on oauth-like provider marks needs_refresh and switches credential', () => {
        const error = {
            response: { status: 401 },
            message: 'Unauthorized'
        };

        const result = classifyProviderError(error, {
            providerType: 'claude-kiro-oauth',
            providerConfig: { authMethod: 'social' },
            retryAttempt: 0
        });

        expect(result.signalType).toBe(RISK_SIGNAL.AUTH_INVALID);
        expect(result.markNeedRefresh).toBe(true);
        expect(result.shouldSwitchCredential).toBe(true);
        expect(result.skipErrorCount).toBe(true);
        expect(result.action).toBe('refresh_then_retry');
    });

    test('QUOTA_EXCEEDED returns cooldown decision with scheduled timestamp', () => {
        const result = classifyProviderError(
            {
                response: { status: 402 },
                message: 'quota exceeded'
            },
            {
                providerType: 'openai-qwen-oauth',
                defaultQuotaCooldownMs: 5000
            }
        );

        expect(result.signalType).toBe(RISK_SIGNAL.QUOTA_EXCEEDED);
        expect(result.action).toBe('cooldown');
        expect(result.shouldSwitchCredential).toBe(true);
        expect(result.skipErrorCount).toBe(true);
        expect(typeof result.cooldownUntil).toBe('string');
    });

    test('explicit provider flags override default classification', () => {
        const result = classifyProviderError(
            {
                response: { status: 500 },
                message: 'internal server error',
                shouldSwitchCredential: true,
                skipErrorCount: true
            },
            {
                providerType: 'openai-custom'
            }
        );

        expect(result.shouldSwitchCredential).toBe(true);
        expect(result.skipErrorCount).toBe(true);
    });
});

describe('provider-account-policy identity context', () => {
    test('buildProviderIdentityContext merges runtime and provider identity fields', () => {
        const context = buildProviderIdentityContext(
            'claude-kiro-oauth',
            {
                uuid: 'node-1',
                accountId: 'acct-001',
                authMethod: 'social',
                machineId: 'machine-node-1'
            },
            {
                identityProfileId: 'identity-abc',
                clientIp: '127.0.0.1'
            }
        );

        expect(context.providerType).toBe('claude-kiro-oauth');
        expect(context.uuid).toBe('node-1');
        expect(context.accountId).toBe('acct-001');
        expect(context.machineCode).toBe('machine-node-1');
        expect(context.identityProfileId).toBe('identity-abc');
        expect(context.clientIp).toBe('127.0.0.1');
    });
});
