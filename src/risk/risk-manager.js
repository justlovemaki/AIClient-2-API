import crypto from 'crypto';
import logger from '../utils/logger.js';
import {
    DEFAULT_RISK_CONFIG,
    LIFECYCLE_STATE,
    RISK_POLICY_MODE,
    RISK_SIGNAL,
    RISK_STATUS_REASON
} from './constants.js';
import { normalizeSignalFromError } from './error-normalizer.js';
import { LifecycleStore } from './lifecycle-store.js';
import { RiskPolicyEngine } from './risk-policy-engine.js';

function nowIso() {
    return new Date().toISOString();
}

function toBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    return fallback;
}

function hashEvent(payload) {
    return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

const STRICT_BLOCKED_STATES = new Set([
    LIFECYCLE_STATE.SUSPENDED,
    LIFECYCLE_STATE.BANNED,
    LIFECYCLE_STATE.DISABLED,
    LIFECYCLE_STATE.QUARANTINED
]);

const RELEASABLE_LIFECYCLE_STATES = new Set([
    LIFECYCLE_STATE.QUARANTINED,
    LIFECYCLE_STATE.SUSPENDED,
    LIFECYCLE_STATE.BANNED,
    LIFECYCLE_STATE.COOLDOWN,
    LIFECYCLE_STATE.NEEDS_REFRESH
]);

const MANUAL_RELEASE_TARGET_STATES = new Set([
    LIFECYCLE_STATE.HEALTHY,
    LIFECYCLE_STATE.NEEDS_REFRESH
]);

function createRiskError(message, code, statusCode = 400, details = null) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    if (details) {
        error.details = details;
    }
    return error;
}

class RiskManager {
    constructor() {
        this.initialized = false;
        this.enabled = true;
        this.mode = DEFAULT_RISK_CONFIG.mode;
        this.identityCollisionWindowMs = DEFAULT_RISK_CONFIG.identityCollisionWindowMs;

        this.store = null;
        this.policyEngine = null;
        this.identityClaims = new Map();
    }

    init(config = {}, providerPools = {}) {
        const mergedConfig = {
            ...DEFAULT_RISK_CONFIG,
            enabled: toBoolean(config.RISK_POLICY_ENABLED, DEFAULT_RISK_CONFIG.enabled),
            mode: config.RISK_POLICY_MODE || DEFAULT_RISK_CONFIG.mode,
            lifecycleFilePath: config.RISK_LIFECYCLE_FILE_PATH || DEFAULT_RISK_CONFIG.lifecycleFilePath,
            maxEvents: Number.isFinite(config.RISK_MAX_EVENTS) ? config.RISK_MAX_EVENTS : DEFAULT_RISK_CONFIG.maxEvents,
            flushDebounceMs: Number.isFinite(config.RISK_FLUSH_DEBOUNCE_MS)
                ? config.RISK_FLUSH_DEBOUNCE_MS
                : DEFAULT_RISK_CONFIG.flushDebounceMs,
            identityCollisionWindowMs: Number.isFinite(config.RISK_IDENTITY_COLLISION_WINDOW_MS)
                ? config.RISK_IDENTITY_COLLISION_WINDOW_MS
                : DEFAULT_RISK_CONFIG.identityCollisionWindowMs
        };

        this.enabled = mergedConfig.enabled;
        this.mode = mergedConfig.mode;
        this.identityCollisionWindowMs = mergedConfig.identityCollisionWindowMs;
        this.policyEngine = new RiskPolicyEngine({ mode: this.mode });
        this.store = new LifecycleStore({
            filePath: mergedConfig.lifecycleFilePath,
            maxEvents: mergedConfig.maxEvents,
            flushDebounceMs: mergedConfig.flushDebounceMs
        });

        this.store.loadFromDisk();
        this.store.initializeFromProviderPools(providerPools || {});
        this.store.flushNow();

        this.initialized = true;

        logger.info(`[RiskManager] Initialized (enabled=${this.enabled}, mode=${this.mode}, file=${mergedConfig.lifecycleFilePath}, collisionWindowMs=${this.identityCollisionWindowMs})`);
    }

    isEnabled() {
        return this.initialized && this.enabled;
    }

    observeSuccess(context = {}) {
        return this._applySignal(RISK_SIGNAL.SUCCESS, {
            ...context,
            reasonCode: RISK_STATUS_REASON.SUCCESS
        });
    }

    observeError(error, context = {}) {
        const normalized = normalizeSignalFromError(error, context);

        return this._applySignal(normalized.signalType, {
            ...context,
            statusCode: normalized.statusCode,
            reasonCode: normalized.reasonCode,
            rawMessage: normalized.rawMessage || context.errorMessage || null
        });
    }

    observeSignal(signalType, context = {}) {
        const signal = Object.values(RISK_SIGNAL).includes(signalType) ? signalType : RISK_SIGNAL.UNKNOWN;
        return this._applySignal(signal, {
            ...context,
            reasonCode: context.reasonCode || RISK_STATUS_REASON.PROVIDER_SIGNAL
        });
    }

    observeIdentityClaim(context = {}) {
        if (!this.isEnabled()) return { collision: false };

        const providerType = context.providerType || null;
        const uuid = context.uuid || null;
        const identityProfileId = context.identityProfileId || null;

        if (!providerType || !uuid || !identityProfileId) {
            return { collision: false };
        }

        const key = identityProfileId;
        const now = Date.now();
        const existing = this.identityClaims.get(key);

        let collision = false;
        let collidedWith = null;
        if (existing) {
            const isDifferentCredential = existing.providerType !== providerType || existing.uuid !== uuid;
            const withinWindow = now - existing.lastSeenAt <= this.identityCollisionWindowMs;
            if (isDifferentCredential && withinWindow) {
                collision = true;
                collidedWith = `${existing.providerType}:${existing.uuid}`;
                logger.warn(`[RiskManager] Identity collision detected: profile=${identityProfileId} current=${providerType}:${uuid} previous=${collidedWith}`);
                this._applySignal(RISK_SIGNAL.IDENTITY_COLLISION, {
                    providerType,
                    uuid,
                    customName: context.customName || null,
                    source: context.source || 'identity-guard',
                    reasonCode: RISK_STATUS_REASON.IDENTITY_COLLISION,
                    requestId: context.requestId || null,
                    identityProfileId,
                    collidedWith,
                    metadata: {
                        identityProfileId,
                        collidedWith,
                        clientIp: context.clientIp || null,
                        machineCode: context.machineCode || null
                    }
                });
            }
        }

        this.identityClaims.set(key, {
            providerType,
            uuid,
            lastSeenAt: now
        });
        this._pruneIdentityClaims(now);

        return {
            collision,
            collidedWith
        };
    }

    getSummary() {
        if (!this.store) {
            return {
                enabled: this.enabled,
                mode: this.mode,
                initialized: false,
                totalCredentials: 0,
                stateCount: {},
                eventCount: 0,
                lastEventAt: null,
                updatedAt: nowIso()
            };
        }

        const credentials = this.store.getAllCredentials();
        const blockedCredentialCount = credentials.filter((item) => this.getAdmissionDecision(item.providerType, item.uuid).blocked).length;
        const identityCollisionCount = this.store.getRecentEvents(this.store.maxEvents, { signalType: RISK_SIGNAL.IDENTITY_COLLISION }).length;

        return {
            enabled: this.enabled,
            mode: this.mode,
            initialized: this.initialized,
            blockedCredentialCount,
            identityCollisionCount,
            ...this.store.getSummary()
        };
    }

    syncProviderPools(providerPools = {}) {
        if (!this.isEnabled() || !this.store) return;
        this.store.initializeFromProviderPools(providerPools);
    }

    getCredentials(filters = {}) {
        if (!this.store) return [];
        return this.store.getAllCredentials(filters);
    }

    getEvents(options = {}) {
        if (!this.store) return [];
        const limit = options.limit ?? 100;
        return this.store.getRecentEvents(limit, {
            providerType: options.providerType || null,
            uuid: options.uuid || null,
            signalType: options.signalType || null
        });
    }

    getCredential(providerType, uuid) {
        if (!this.store) return null;
        return this.store.getCredential(providerType, uuid);
    }

    flush() {
        if (this.store) {
            this.store.flushNow();
        }
    }

    getPolicyConfig() {
        return {
            enabled: this.enabled,
            mode: this.mode,
            identityCollisionWindowMs: this.identityCollisionWindowMs,
            availableModes: Object.values(RISK_POLICY_MODE),
            initialized: this.initialized
        };
    }

    updatePolicyConfig(options = {}) {
        if (!this.initialized || !this.policyEngine) {
            throw createRiskError('Risk policy manager is not initialized.', 'RISK_NOT_INITIALIZED', 409);
        }

        if (options.enabled !== undefined) {
            this.enabled = options.enabled === true;
        }

        if (options.mode !== undefined) {
            const nextMode = typeof options.mode === 'string' ? options.mode.trim() : '';
            if (!Object.values(RISK_POLICY_MODE).includes(nextMode)) {
                throw createRiskError(
                    `Invalid risk policy mode '${options.mode}'. Allowed: ${Object.values(RISK_POLICY_MODE).join(', ')}`,
                    'RISK_INVALID_MODE',
                    400,
                    { mode: options.mode }
                );
            }
            this.mode = nextMode;
            this.policyEngine.setMode(nextMode);
        }

        if (options.identityCollisionWindowMs !== undefined) {
            const parsedWindow = Number(options.identityCollisionWindowMs);
            if (!Number.isFinite(parsedWindow) || parsedWindow < 0) {
                throw createRiskError(
                    'identityCollisionWindowMs must be a non-negative number.',
                    'RISK_INVALID_COLLISION_WINDOW',
                    400
                );
            }
            this.identityCollisionWindowMs = parsedWindow;
        }

        this.recordControlPlaneAction('policy_update', {
            source: options.source || 'ui.api.policy-update',
            requestId: options.requestId || null,
            metadata: {
                enabled: this.enabled,
                mode: this.mode,
                identityCollisionWindowMs: this.identityCollisionWindowMs,
                operator: options.operator || null,
                reason: options.reason || null
            }
        });

        return this.getPolicyConfig();
    }

    recordControlPlaneAction(action, context = {}) {
        if (!this.store || !this.initialized) return null;

        const providerType = context.providerType || null;
        const uuid = context.uuid || null;
        const actionName = typeof action === 'string' ? action.trim() : '';
        if (!actionName) return null;

        if (providerType && uuid) {
            const existing = this.store.getCredential(providerType, uuid);
            if (existing) {
                this.store.upsertCredential({
                    providerType,
                    uuid,
                    customName: existing.customName || null,
                    lifecycleState: existing.lifecycleState || LIFECYCLE_STATE.UNKNOWN,
                    cooldownUntil: context.cooldownUntil !== undefined ? context.cooldownUntil : existing.cooldownUntil || null,
                    lastSource: context.source || existing.lastSource || 'control-plane',
                    metadata: {
                        ...(existing.metadata || {}),
                        ...(context.metadata || {})
                    }
                });
            }
        }

        const eventBase = {
            timestamp: nowIso(),
            providerType,
            uuid,
            customName: context.customName || null,
            signalType: 'CONTROL_PLANE_ACTION',
            reasonCode: actionName,
            statusCode: null,
            source: context.source || 'control-plane',
            mode: this.mode,
            decision: 'control_action',
            previousState: null,
            nextState: null,
            changed: false,
            requestId: context.requestId || null,
            stream: false,
            model: null,
            rawMessage: context.rawMessage || null,
            identityProfileId: null,
            collidedWith: null
        };

        const event = {
            ...eventBase,
            eventId: `${Date.now()}-${hashEvent(eventBase)}`,
            metadata: {
                action: actionName,
                ...(context.metadata || {})
            }
        };

        this.store.appendEvent(event);
        return event;
    }

    manualReleaseCredential(providerType, uuid, options = {}) {
        if (!this.isEnabled()) {
            throw createRiskError('Risk policy manager is disabled.', 'RISK_POLICY_DISABLED', 409);
        }

        if (!providerType || !uuid) {
            throw createRiskError('providerType and uuid are required for manual release.', 'RISK_INVALID_REQUEST', 400);
        }

        const existing = this.store.getCredential(providerType, uuid);
        if (!existing) {
            throw createRiskError(`Credential not found for ${providerType}/${uuid}.`, 'RISK_CREDENTIAL_NOT_FOUND', 404);
        }

        const currentState = existing.lifecycleState || LIFECYCLE_STATE.UNKNOWN;
        if (!RELEASABLE_LIFECYCLE_STATES.has(currentState)) {
            throw createRiskError(
                `Credential ${providerType}/${uuid} is in '${currentState}' and is not eligible for manual release.`,
                'RISK_RELEASE_STATE_NOT_ELIGIBLE',
                409,
                { currentState }
            );
        }

        const targetState = typeof options.targetState === 'string'
            ? options.targetState.trim().toLowerCase()
            : LIFECYCLE_STATE.HEALTHY;
        if (!MANUAL_RELEASE_TARGET_STATES.has(targetState)) {
            throw createRiskError(
                `targetState must be one of: ${Array.from(MANUAL_RELEASE_TARGET_STATES).join(', ')}`,
                'RISK_INVALID_RELEASE_TARGET',
                400,
                { targetState }
            );
        }

        const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
        if (reason.length < 8) {
            throw createRiskError(
                'Manual release reason must be at least 8 characters.',
                'RISK_RELEASE_REASON_REQUIRED',
                400
            );
        }

        const force = options.force === true;
        if ((currentState === LIFECYCLE_STATE.SUSPENDED || currentState === LIFECYCLE_STATE.BANNED) && !force) {
            throw createRiskError(
                `Manual release from '${currentState}' requires force=true.`,
                'RISK_RELEASE_FORCE_REQUIRED',
                409,
                { currentState }
            );
        }

        if (currentState === LIFECYCLE_STATE.COOLDOWN && existing.cooldownUntil) {
            const cooldownTs = new Date(existing.cooldownUntil).getTime();
            if (Number.isFinite(cooldownTs) && cooldownTs > Date.now() && !force) {
                throw createRiskError(
                    `Credential is in cooldown until ${existing.cooldownUntil}. Use force=true only after manual verification.`,
                    'RISK_COOLDOWN_ACTIVE',
                    409,
                    { cooldownUntil: existing.cooldownUntil }
                );
            }
        }

        const expectedCredentialId = `${providerType}:${uuid}`;
        const confirmCredentialId = typeof options.confirmCredentialId === 'string'
            ? options.confirmCredentialId.trim()
            : '';
        if (!confirmCredentialId || confirmCredentialId !== expectedCredentialId) {
            throw createRiskError(
                `confirmCredentialId must exactly match '${expectedCredentialId}'.`,
                'RISK_RELEASE_CONFIRMATION_REQUIRED',
                409
            );
        }

        const result = this._applySignal(RISK_SIGNAL.MANUAL_RELEASE, {
            providerType,
            uuid,
            customName: existing.customName || null,
            source: options.source || 'ui.manual-release',
            reasonCode: RISK_STATUS_REASON.MANUAL_RELEASE,
            requestId: options.requestId || null,
            rawMessage: reason,
            targetState,
            cooldownUntil: null,
            metadata: {
                ...(options.metadata || {}),
                operator: options.operator || null,
                force,
                confirmCredentialId,
                releasedFromState: currentState,
                releasedToState: targetState
            }
        });

        if (!result) {
            throw createRiskError('Failed to persist manual release transition.', 'RISK_RELEASE_FAILED', 500);
        }

        return {
            credential: result.credential,
            event: result.event,
            evaluation: result.evaluation
        };
    }

    getAdmissionDecision(providerType, uuid) {
        const baseResult = {
            blocked: false,
            mode: this.mode,
            lifecycleState: LIFECYCLE_STATE.UNKNOWN,
            reason: null
        };

        if (!this.isEnabled()) {
            return baseResult;
        }

        const credential = this.store.getCredential(providerType, uuid);
        if (!credential) {
            return baseResult;
        }

        const lifecycleState = credential.lifecycleState || LIFECYCLE_STATE.UNKNOWN;
        let blocked = false;
        let reason = null;

        switch (this.mode) {
            case RISK_POLICY_MODE.ENFORCE_SOFT:
                blocked = lifecycleState === LIFECYCLE_STATE.SUSPENDED || lifecycleState === LIFECYCLE_STATE.BANNED;
                break;
            case RISK_POLICY_MODE.ENFORCE_STRICT:
                blocked = STRICT_BLOCKED_STATES.has(lifecycleState);
                break;
            case RISK_POLICY_MODE.PROTECTIVE_EMERGENCY:
                blocked = lifecycleState !== LIFECYCLE_STATE.HEALTHY;
                break;
            default:
                blocked = false;
                break;
        }

        if (blocked) {
            reason = `blocked_in_${this.mode}`;
        }

        return {
            blocked,
            mode: this.mode,
            lifecycleState,
            reason
        };
    }

    isCredentialBlocked(providerType, uuid) {
        return this.getAdmissionDecision(providerType, uuid).blocked;
    }

    _applySignal(signalType, context) {
        if (!this.isEnabled()) return null;

        const providerType = context.providerType || null;
        const uuid = context.uuid || null;

        if (!providerType || !uuid) {
            return null;
        }

        const existing = this.store.getCredential(providerType, uuid) || {
            providerType,
            uuid,
            lifecycleState: LIFECYCLE_STATE.UNKNOWN,
            firstSeenAt: nowIso()
        };

        const evaluation = this.policyEngine.evaluate(existing.lifecycleState, signalType, context);

        const updated = this.store.upsertCredential({
            providerType,
            uuid,
            customName: context.customName || existing.customName || null,
            lifecycleState: evaluation.nextState,
            cooldownUntil: context.cooldownUntil !== undefined
                ? context.cooldownUntil
                : (existing.cooldownUntil || null),
            lastSignalType: signalType,
            lastReasonCode: context.reasonCode || RISK_STATUS_REASON.UNKNOWN,
            lastStatusCode: context.statusCode ?? existing.lastStatusCode ?? null,
            lastSource: context.source || existing.lastSource || null,
            lastErrorMessage: context.rawMessage || context.errorMessage || existing.lastErrorMessage || null,
            metadata: {
                ...(context.metadata || {}),
                model: context.model || null,
                stream: context.stream === true,
                requestId: context.requestId || null,
                retryAttempt: Number.isFinite(context.retryAttempt) ? context.retryAttempt : null,
                shouldSwitchCredential: context.shouldSwitchCredential === true,
                skipErrorCount: context.skipErrorCount === true,
                identityProfileId: context.identityProfileId || null,
                collidedWith: context.collidedWith || null
            }
        });

        const eventBase = {
            timestamp: nowIso(),
            providerType,
            uuid,
            customName: context.customName || null,
            signalType,
            reasonCode: context.reasonCode || RISK_STATUS_REASON.UNKNOWN,
            statusCode: context.statusCode ?? null,
            source: context.source || 'runtime',
            mode: this.mode,
            decision: evaluation.decision,
            previousState: evaluation.previousState,
            nextState: evaluation.nextState,
            changed: evaluation.changed,
            requestId: context.requestId || null,
            stream: context.stream === true,
            model: context.model || null,
            rawMessage: context.rawMessage || null,
            identityProfileId: context.identityProfileId || null,
            collidedWith: context.collidedWith || null
        };

        const event = {
            ...eventBase,
            eventId: `${Date.now()}-${hashEvent(eventBase)}`
        };

        this.store.appendEvent(event);

        if (evaluation.changed) {
            logger.info(`[RiskManager] ${providerType}/${uuid} ${evaluation.previousState} -> ${evaluation.nextState} (signal=${signalType}, mode=${this.mode})`);
        }

        return {
            credential: updated,
            event,
            evaluation
        };
    }

    _pruneIdentityClaims(now = Date.now()) {
        const expireBefore = now - (this.identityCollisionWindowMs * 2);
        for (const [key, claim] of this.identityClaims.entries()) {
            if (claim.lastSeenAt < expireBefore) {
                this.identityClaims.delete(key);
            }
        }
    }
}

const riskManager = new RiskManager();

export function initializeRiskManager(config, providerPools = {}) {
    riskManager.init(config, providerPools);
    return riskManager;
}

export function getRiskManager() {
    return riskManager;
}
