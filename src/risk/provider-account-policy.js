import { RISK_SIGNAL } from './constants.js';
import { normalizeSignalFromError } from './error-normalizer.js';

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30 * 1000;
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

function toIsoOrNull(value) {
    if (value === undefined || value === null) return null;

    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    if (typeof value === 'number') {
        const normalized = value < 1e12 ? value * 1000 : value;
        const ts = new Date(normalized);
        return Number.isFinite(ts.getTime()) ? ts.toISOString() : null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const asDate = new Date(trimmed);
        if (Number.isFinite(asDate.getTime())) {
            return asDate.toISOString();
        }
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) {
            return toIsoOrNull(asNumber);
        }
    }

    return null;
}

function parseCooldownFromError(error, fallbackMs = null) {
    if (!error) {
        return fallbackMs > 0 ? new Date(Date.now() + fallbackMs).toISOString() : null;
    }

    const candidates = [
        error.cooldownUntil,
        error.scheduledRecoveryTime,
        error.recoveryTime,
        error.quotaResetAt,
        error.rateLimitResetAt,
        error.response?.headers?.['x-ratelimit-reset'],
        error.response?.headers?.['x-rate-limit-reset'],
        error.response?.headers?.['retry-after']
    ];

    for (const value of candidates) {
        const iso = toIsoOrNull(value);
        if (iso) return iso;
    }

    if (fallbackMs && Number.isFinite(fallbackMs) && fallbackMs > 0) {
        return new Date(Date.now() + fallbackMs).toISOString();
    }

    return null;
}

export function isOauthLikeCredential(providerType, providerConfig = {}) {
    const provider = String(providerType || '').toLowerCase();
    const authMethod = String(providerConfig?.authMethod || '').toLowerCase();

    if (provider.includes('oauth')) return true;
    if (provider.includes('kiro')) return true;
    if (provider.includes('gemini')) return true;
    if (provider.includes('qwen')) return true;
    if (provider.includes('iflow')) return true;
    if (provider.includes('codex')) return true;

    return authMethod === 'social' || authMethod === 'idc' || authMethod === 'oauth2' || authMethod === 'builder-id';
}

export function buildProviderIdentityContext(providerType, providerConfig = {}, runtimeContext = {}) {
    return {
        providerType: providerType || null,
        uuid: providerConfig?.uuid || null,
        accountId: providerConfig?.accountId || providerConfig?.profileArn || null,
        authMethod: providerConfig?.authMethod || null,
        machineCode: runtimeContext?.machineCode || providerConfig?.machineId || null,
        identityProfileId: runtimeContext?.identityProfileId || null,
        clientIp: runtimeContext?.clientIp || null,
        userAgent: runtimeContext?.userAgent || null
    };
}

export function classifyProviderError(error, context = {}) {
    const normalized = normalizeSignalFromError(error, { providerType: context.providerType });
    const providerType = context.providerType || null;
    const providerConfig = context.providerConfig || {};
    const retryAttempt = Number.isFinite(context.retryAttempt) ? context.retryAttempt : 0;
    const defaultRateLimitCooldownMs = Number.isFinite(context.defaultRateLimitCooldownMs)
        ? context.defaultRateLimitCooldownMs
        : DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    const defaultQuotaCooldownMs = Number.isFinite(context.defaultQuotaCooldownMs)
        ? context.defaultQuotaCooldownMs
        : DEFAULT_QUOTA_COOLDOWN_MS;

    const classification = {
        signalType: normalized.signalType,
        reasonCode: normalized.reasonCode,
        statusCode: normalized.statusCode,
        rawMessage: normalized.rawMessage || error?.message || null,
        action: 'none',
        shouldSwitchCredential: false,
        shouldRefreshCredential: false,
        skipErrorCount: false,
        markNeedRefresh: false,
        markUnhealthy: false,
        markUnhealthyImmediately: false,
        cooldownUntil: null,
        retryable: false,
        alreadyMarkedUnhealthy: error?.credentialMarkedUnhealthy === true
    };

    const oauthLike = isOauthLikeCredential(providerType, providerConfig);

    switch (normalized.signalType) {
        case RISK_SIGNAL.AUTH_INVALID:
            if (oauthLike) {
                classification.action = 'refresh_then_retry';
                classification.shouldRefreshCredential = true;
                classification.markNeedRefresh = true;
                classification.shouldSwitchCredential = true;
                classification.skipErrorCount = true;
                classification.retryable = true;
            } else {
                classification.action = 'quarantine';
                classification.markUnhealthyImmediately = true;
                classification.shouldSwitchCredential = true;
                classification.retryable = true;
            }
            break;
        case RISK_SIGNAL.QUOTA_EXCEEDED:
            classification.action = 'cooldown';
            classification.cooldownUntil = parseCooldownFromError(error, defaultQuotaCooldownMs);
            classification.shouldSwitchCredential = true;
            classification.skipErrorCount = true;
            classification.markUnhealthy = true;
            classification.retryable = true;
            break;
        case RISK_SIGNAL.RATE_LIMITED:
            classification.action = 'cooldown';
            classification.cooldownUntil = parseCooldownFromError(error, defaultRateLimitCooldownMs);
            classification.shouldSwitchCredential = true;
            classification.skipErrorCount = true;
            classification.retryable = true;
            break;
        case RISK_SIGNAL.SUSPENDED:
        case RISK_SIGNAL.BANNED:
            classification.action = 'quarantine';
            classification.shouldSwitchCredential = true;
            classification.skipErrorCount = true;
            classification.markUnhealthyImmediately = true;
            classification.retryable = false;
            break;
        case RISK_SIGNAL.NETWORK_TRANSIENT:
            classification.action = retryAttempt > 0 ? 'switch_credential' : 'retry_same';
            classification.shouldSwitchCredential = retryAttempt > 0;
            classification.skipErrorCount = true;
            classification.retryable = true;
            break;
        default:
            break;
    }

    if (normalized.signalType === RISK_SIGNAL.UNKNOWN && classification.statusCode && classification.statusCode >= 500) {
        classification.action = 'switch_credential';
        classification.shouldSwitchCredential = true;
        classification.skipErrorCount = true;
        classification.retryable = true;
    }

    if (error?.shouldSwitchCredential === true) {
        classification.shouldSwitchCredential = true;
        if (classification.action === 'none') {
            classification.action = 'switch_credential';
        }
    }
    if (error?.skipErrorCount === true) {
        classification.skipErrorCount = true;
    }
    if (error?.markNeedRefresh === true || error?.providerNeedsRefresh === true) {
        classification.markNeedRefresh = true;
        classification.shouldRefreshCredential = true;
    }
    if (error?.markUnhealthyImmediately === true) {
        classification.markUnhealthyImmediately = true;
    }
    if (!classification.cooldownUntil) {
        classification.cooldownUntil = parseCooldownFromError(error, null);
    }
    if (error?.retryable === true) {
        classification.retryable = true;
    }

    return classification;
}
