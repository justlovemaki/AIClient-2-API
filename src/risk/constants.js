export const RISK_POLICY_MODE = {
    OBSERVE: 'observe',
    ENFORCE_SOFT: 'enforce-soft',
    ENFORCE_STRICT: 'enforce-strict',
    PROTECTIVE_EMERGENCY: 'protective-emergency'
};

export const RISK_SIGNAL = {
    SUCCESS: 'SUCCESS',
    MANUAL_RELEASE: 'MANUAL_RELEASE',
    AUTH_INVALID: 'AUTH_INVALID',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    RATE_LIMITED: 'RATE_LIMITED',
    SUSPENDED: 'SUSPENDED',
    BANNED: 'BANNED',
    IDENTITY_COLLISION: 'IDENTITY_COLLISION',
    NETWORK_TRANSIENT: 'NETWORK_TRANSIENT',
    PROVIDER_MARKED_UNHEALTHY: 'PROVIDER_MARKED_UNHEALTHY',
    PROVIDER_MARKED_HEALTHY: 'PROVIDER_MARKED_HEALTHY',
    PROVIDER_NEEDS_REFRESH: 'PROVIDER_NEEDS_REFRESH',
    PROVIDER_DISABLED: 'PROVIDER_DISABLED',
    PROVIDER_ENABLED: 'PROVIDER_ENABLED',
    UNKNOWN: 'UNKNOWN'
};

export const LIFECYCLE_STATE = {
    HEALTHY: 'healthy',
    NEEDS_REFRESH: 'needs_refresh',
    COOLDOWN: 'cooldown',
    QUARANTINED: 'quarantined',
    SUSPENDED: 'suspended',
    BANNED: 'banned',
    DISABLED: 'disabled',
    UNKNOWN: 'unknown'
};

export const DECISION = {
    OBSERVE_ONLY: 'observe_only',
    NO_STATE_CHANGE: 'no_state_change',
    TRANSITION: 'transition'
};

export const DEFAULT_RISK_CONFIG = {
    enabled: true,
    mode: RISK_POLICY_MODE.ENFORCE_STRICT,
    lifecycleFilePath: 'configs/risk-lifecycle.json',
    maxEvents: 5000,
    flushDebounceMs: 500,
    identityCollisionWindowMs: 5 * 60 * 1000
};

export const RISK_STATUS_REASON = {
    HTTP_401: 'HTTP_401',
    HTTP_402: 'HTTP_402',
    HTTP_403: 'HTTP_403',
    HTTP_423: 'HTTP_423',
    HTTP_429: 'HTTP_429',
    HTTP_5XX: 'HTTP_5XX',
    NETWORK_ERROR: 'NETWORK_ERROR',
    IDENTITY_COLLISION: 'IDENTITY_COLLISION',
    MANUAL_RELEASE: 'MANUAL_RELEASE',
    PROVIDER_SIGNAL: 'PROVIDER_SIGNAL',
    SUCCESS: 'SUCCESS',
    UNKNOWN: 'UNKNOWN'
};

export const SUSPENSION_MARKERS = [
    'temporarily suspended',
    'temporarily is suspended',
    'account suspended',
    'suspended',
    '423 locked',
    'locked'
];

export const BAN_MARKERS = [
    'banned',
    'ban',
    'permanently disabled',
    'account has been closed',
    'BANNED:'
];
