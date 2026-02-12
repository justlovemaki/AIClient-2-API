import logger from '../utils/logger.js';
import { getRiskManager } from '../risk/risk-manager.js';
import { LIFECYCLE_STATE } from '../risk/constants.js';
import { getRequestBody } from '../utils/common.js';

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function parseRequestUrl(req) {
    const host = req.headers.host || 'localhost';
    return new URL(req.url, `http://${host}`);
}

function normalizeState(value, fallback = LIFECYCLE_STATE.HEALTHY) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    return normalized || fallback;
}

function parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return fallback;
}

function parseNumber(value, fallback = null) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
}

function toSafeErrorPayload(error, fallbackMessage) {
    return {
        message: error?.message || fallbackMessage,
        code: error?.code || 'RISK_API_ERROR',
        details: error?.details || null
    };
}

function syncRuntimeStateForManualRelease(providerPoolManager, providerType, uuid, targetState) {
    if (!providerPoolManager) {
        return {
            applied: false,
            action: 'skipped_no_provider_pool_manager'
        };
    }

    if (targetState === LIFECYCLE_STATE.HEALTHY) {
        providerPoolManager.markProviderHealthy(
            providerType,
            { uuid },
            false,
            'manual-release',
            { preserveUsageCount: true }
        );
        return {
            applied: true,
            action: 'mark_provider_healthy'
        };
    }

    if (targetState === LIFECYCLE_STATE.NEEDS_REFRESH) {
        providerPoolManager.markProviderNeedRefresh(providerType, { uuid });
        return {
            applied: true,
            action: 'mark_provider_needs_refresh'
        };
    }

    return {
        applied: false,
        action: 'no_runtime_sync_for_target_state',
        targetState
    };
}

export async function handleGetRiskSummary(req, res) {
    try {
        const manager = getRiskManager();
        const summary = manager.getSummary();
        sendJson(res, 200, summary);
    } catch (error) {
        logger.error('[Risk API] Failed to get summary:', error.message);
        sendJson(res, 500, { error: { message: 'Failed to get risk summary' } });
    }
    return true;
}

export async function handleGetRiskPolicyConfig(req, res) {
    try {
        const manager = getRiskManager();
        const policy = manager.getPolicyConfig();
        sendJson(res, 200, policy);
    } catch (error) {
        logger.error('[Risk API] Failed to get policy config:', error.message);
        sendJson(res, 500, { error: { message: 'Failed to get risk policy config' } });
    }
    return true;
}

export async function handleUpdateRiskPolicyConfig(req, res) {
    try {
        const manager = getRiskManager();
        const body = await getRequestBody(req);
        const enabled = body.enabled === undefined ? undefined : parseBoolean(body.enabled, false);

        const updated = manager.updatePolicyConfig({
            enabled,
            mode: body.mode,
            identityCollisionWindowMs: body.identityCollisionWindowMs,
            source: 'ui.api.policy-update',
            operator: typeof body.operator === 'string' ? body.operator.trim() : null,
            reason: typeof body.reason === 'string' ? body.reason.trim() : null,
            requestId: typeof body.requestId === 'string' ? body.requestId.trim() : null
        });

        sendJson(res, 200, {
            success: true,
            message: 'Risk policy updated successfully',
            policy: updated
        });
    } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        if (statusCode >= 500) {
            logger.error('[Risk API] Failed to update policy config:', error.message);
        } else {
            logger.warn('[Risk API] Invalid policy update request:', error.message);
        }
        sendJson(res, statusCode, {
            error: toSafeErrorPayload(error, 'Failed to update risk policy config')
        });
    }
    return true;
}

export async function handleGetRiskCredentials(req, res) {
    try {
        const manager = getRiskManager();
        const requestUrl = parseRequestUrl(req);
        const providerType = requestUrl.searchParams.get('providerType') || null;
        const lifecycleState = requestUrl.searchParams.get('lifecycleState') || null;

        const credentials = manager.getCredentials({ providerType, lifecycleState });
        sendJson(res, 200, {
            count: credentials.length,
            items: credentials
        });
    } catch (error) {
        logger.error('[Risk API] Failed to get credentials:', error.message);
        sendJson(res, 500, { error: { message: 'Failed to get risk credentials' } });
    }
    return true;
}

export async function handleGetRiskEvents(req, res) {
    try {
        const manager = getRiskManager();
        const requestUrl = parseRequestUrl(req);
        const providerType = requestUrl.searchParams.get('providerType') || null;
        const uuid = requestUrl.searchParams.get('uuid') || null;
        const signalType = requestUrl.searchParams.get('signalType') || null;
        const limit = parseInt(requestUrl.searchParams.get('limit') || '100', 10);

        const events = manager.getEvents({
            providerType,
            uuid,
            signalType,
            limit: Number.isFinite(limit) ? limit : 100
        });

        sendJson(res, 200, {
            count: events.length,
            items: events
        });
    } catch (error) {
        logger.error('[Risk API] Failed to get events:', error.message);
        sendJson(res, 500, { error: { message: 'Failed to get risk events' } });
    }
    return true;
}

export async function handleFlushRiskStore(req, res) {
    try {
        const manager = getRiskManager();
        manager.flush();
        sendJson(res, 200, {
            success: true,
            message: 'Risk lifecycle store flushed'
        });
    } catch (error) {
        logger.error('[Risk API] Failed to flush risk store:', error.message);
        sendJson(res, 500, { error: { message: 'Failed to flush risk lifecycle store' } });
    }
    return true;
}

export async function handleGetRiskCredentialReleaseInfo(req, res, providerType, uuid) {
    try {
        const manager = getRiskManager();
        const credential = manager.getCredential(providerType, uuid);
        if (!credential) {
            sendJson(res, 404, {
                error: {
                    message: `Credential not found for ${providerType}/${uuid}`,
                    code: 'RISK_CREDENTIAL_NOT_FOUND'
                }
            });
            return true;
        }

        const state = credential.lifecycleState || LIFECYCLE_STATE.UNKNOWN;
        const releasableStates = new Set([
            LIFECYCLE_STATE.QUARANTINED,
            LIFECYCLE_STATE.SUSPENDED,
            LIFECYCLE_STATE.BANNED,
            LIFECYCLE_STATE.COOLDOWN,
            LIFECYCLE_STATE.NEEDS_REFRESH
        ]);

        const requiresForceByState = state === LIFECYCLE_STATE.SUSPENDED || state === LIFECYCLE_STATE.BANNED;
        const now = Date.now();
        const cooldownUntil = credential.cooldownUntil || null;
        const cooldownTs = cooldownUntil ? new Date(cooldownUntil).getTime() : null;
        const cooldownStillActive = Number.isFinite(cooldownTs) ? cooldownTs > now : false;

        sendJson(res, 200, {
            credentialId: `${providerType}:${uuid}`,
            providerType,
            uuid,
            currentState: state,
            cooldownUntil,
            cooldownStillActive,
            canManualRelease: releasableStates.has(state),
            requiresForce: requiresForceByState || (state === LIFECYCLE_STATE.COOLDOWN && cooldownStillActive),
            requiredFields: ['confirmCredentialId', 'reason'],
            allowedTargetStates: [LIFECYCLE_STATE.HEALTHY, LIFECYCLE_STATE.NEEDS_REFRESH]
        });
    } catch (error) {
        logger.error('[Risk API] Failed to get release info:', error.message);
        sendJson(res, 500, { error: { message: 'Failed to get risk release info' } });
    }
    return true;
}

export async function handleReleaseRiskCredential(req, res, providerPoolManager, providerType, uuid) {
    try {
        const manager = getRiskManager();
        const body = await getRequestBody(req);
        const targetState = normalizeState(body.targetState, LIFECYCLE_STATE.HEALTHY);

        const releaseResult = manager.manualReleaseCredential(providerType, uuid, {
            targetState,
            reason: body.reason,
            force: body.force === true,
            operator: typeof body.operator === 'string' ? body.operator.trim() : null,
            confirmCredentialId: typeof body.confirmCredentialId === 'string' ? body.confirmCredentialId.trim() : '',
            requestId: typeof body.requestId === 'string' ? body.requestId.trim() : null,
            source: 'ui.api.manual-release',
            metadata: {
                releaseTicketId: body.releaseTicketId || null
            }
        });

        const runtimeSync = syncRuntimeStateForManualRelease(
            providerPoolManager,
            providerType,
            uuid,
            releaseResult?.credential?.lifecycleState || targetState
        );

        sendJson(res, 200, {
            success: true,
            message: `Credential ${providerType}/${uuid} manually released to ${releaseResult?.credential?.lifecycleState || targetState}`,
            credential: releaseResult.credential,
            event: releaseResult.event,
            runtimeSync
        });
    } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        if (statusCode >= 500) {
            logger.error('[Risk API] Failed to release credential:', error.message);
        } else {
            logger.warn('[Risk API] Manual release rejected:', error.message);
        }

        sendJson(res, statusCode, {
            error: toSafeErrorPayload(error, 'Failed to release credential')
        });
    }
    return true;
}

export async function handleRiskCredentialAction(req, res, providerPoolManager, providerType, uuid) {
    if (!providerPoolManager) {
        sendJson(res, 409, {
            error: {
                message: 'Provider pool manager is unavailable',
                code: 'RISK_PROVIDER_POOL_MANAGER_UNAVAILABLE'
            }
        });
        return true;
    }

    try {
        const manager = getRiskManager();
        const body = await getRequestBody(req);
        const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';

        const operator = typeof body.operator === 'string' ? body.operator.trim() : 'ui-admin';
        const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
        const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : null;
        const releaseReason = (reason && reason.length >= 8)
            ? reason
            : `manual cooldown clear via control plane (${operator})`;
        const releaseCredentialId = `${providerType}:${uuid}`;

        let result = null;
        let releaseResult = null;
        switch (action) {
            case 'set-drain':
            case 'set_drain':
                result = providerPoolManager.setProviderDrainMode(
                    providerType,
                    uuid,
                    parseBoolean(body.isDraining, true),
                    {
                        source: 'ui.api.risk-action.set-drain',
                        operator,
                        reason,
                        requestId
                    }
                );
                break;

            case 'clear-drain':
            case 'clear_drain':
                result = providerPoolManager.setProviderDrainMode(
                    providerType,
                    uuid,
                    false,
                    {
                        source: 'ui.api.risk-action.clear-drain',
                        operator,
                        reason,
                        requestId
                    }
                );
                break;

            case 'apply-cooldown':
            case 'apply_cooldown':
                result = providerPoolManager.applyProviderCooldown(
                    providerType,
                    uuid,
                    {
                        cooldownUntil: body.cooldownUntil || null,
                        durationMs: parseNumber(body.durationMs, null),
                        operator,
                        reason,
                        requestId,
                        source: 'ui.api.risk-action.apply-cooldown'
                    }
                );
                break;

            case 'clear-cooldown':
            case 'clear_cooldown':
                result = providerPoolManager.clearProviderCooldown(
                    providerType,
                    uuid,
                    {
                        operator,
                        reason,
                        requestId,
                        source: 'ui.api.risk-action.clear-cooldown'
                    }
                );

                // Cooldown is a releasable lifecycle state; clear action also normalizes lifecycle to healthy.
                if (result?.success === true) {
                    const credential = manager.getCredential(providerType, uuid);
                    if (credential?.lifecycleState === LIFECYCLE_STATE.COOLDOWN) {
                        releaseResult = manager.manualReleaseCredential(providerType, uuid, {
                            targetState: LIFECYCLE_STATE.HEALTHY,
                            reason: releaseReason,
                            force: true,
                            operator,
                            requestId,
                            confirmCredentialId: releaseCredentialId,
                            source: 'ui.api.risk-action.clear-cooldown',
                            metadata: {
                                releaseTicketId: body.releaseTicketId || null
                            }
                        });
                    } else {
                        manager.recordControlPlaneAction('clear_cooldown', {
                            providerType,
                            uuid,
                            source: 'ui.api.risk-action.clear-cooldown',
                            requestId,
                            metadata: {
                                operator,
                                reason: releaseReason
                            }
                        });
                    }
                }
                break;

            case 'force-refresh':
            case 'force_refresh':
                result = providerPoolManager.forceRefreshProviderCredential(
                    providerType,
                    uuid,
                    {
                        operator,
                        reason,
                        requestId,
                        source: 'ui.api.risk-action.force-refresh'
                    }
                );
                break;

            default:
                sendJson(res, 400, {
                    error: {
                        message: `Unsupported risk credential action '${action}'.`,
                        code: 'RISK_UNSUPPORTED_ACTION',
                        details: {
                            action,
                            supportedActions: [
                                'set-drain',
                                'clear-drain',
                                'apply-cooldown',
                                'clear-cooldown',
                                'force-refresh'
                            ]
                        }
                    }
                });
                return true;
        }

        if (!result?.success) {
            sendJson(res, 404, {
                error: {
                    message: result?.error || `Failed to execute action '${action}' for ${providerType}/${uuid}`,
                    code: 'RISK_ACTION_FAILED'
                }
            });
            return true;
        }

        sendJson(res, 200, {
            success: true,
            action,
            message: `Executed action '${action}' for ${providerType}/${uuid}`,
            result,
            release: releaseResult
                ? {
                    credential: releaseResult.credential,
                    event: releaseResult.event
                }
                : null
        });
    } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        if (statusCode >= 500) {
            logger.error('[Risk API] Failed to execute credential action:', error.message);
        } else {
            logger.warn('[Risk API] Credential action rejected:', error.message);
        }
        sendJson(res, statusCode, {
            error: toSafeErrorPayload(error, 'Failed to execute risk credential action')
        });
    }
    return true;
}

export async function handleRiskProviderSelectionPreview(req, res, providerPoolManager, providerType) {
    if (!providerPoolManager) {
        sendJson(res, 409, {
            error: {
                message: 'Provider pool manager is unavailable',
                code: 'RISK_PROVIDER_POOL_MANAGER_UNAVAILABLE'
            }
        });
        return true;
    }

    try {
        const requestUrl = parseRequestUrl(req);
        const requestedModel = requestUrl.searchParams.get('model') || null;
        const maxCandidates = parseNumber(requestUrl.searchParams.get('maxCandidates'), null);

        const preview = providerPoolManager.getSelectionPreview(providerType, requestedModel, {
            maxCandidates
        });

        sendJson(res, 200, preview);
    } catch (error) {
        logger.error('[Risk API] Failed to get selection preview:', error.message);
        sendJson(res, 500, {
            error: toSafeErrorPayload(error, 'Failed to get provider selection preview')
        });
    }
    return true;
}
