import { DECISION, LIFECYCLE_STATE, RISK_POLICY_MODE, RISK_SIGNAL } from './constants.js';

function keepStateIfUnknown(currentState) {
    return currentState || LIFECYCLE_STATE.UNKNOWN;
}

export class RiskPolicyEngine {
    constructor(config = {}) {
        this.mode = config.mode || RISK_POLICY_MODE.OBSERVE;
    }

    setMode(mode) {
        this.mode = mode || RISK_POLICY_MODE.OBSERVE;
    }

    evaluate(currentState, signalType, context = {}) {
        const normalizedCurrent = keepStateIfUnknown(currentState);

        let targetState = normalizedCurrent;
        switch (signalType) {
            case RISK_SIGNAL.SUCCESS:
            case RISK_SIGNAL.PROVIDER_MARKED_HEALTHY:
            case RISK_SIGNAL.PROVIDER_ENABLED:
                targetState = LIFECYCLE_STATE.HEALTHY;
                break;
            case RISK_SIGNAL.MANUAL_RELEASE: {
                const requestedState = typeof context.targetState === 'string'
                    ? context.targetState.trim().toLowerCase()
                    : '';
                const allowedManualTargets = new Set([
                    LIFECYCLE_STATE.HEALTHY,
                    LIFECYCLE_STATE.NEEDS_REFRESH
                ]);
                targetState = allowedManualTargets.has(requestedState)
                    ? requestedState
                    : LIFECYCLE_STATE.HEALTHY;
                break;
            }
            case RISK_SIGNAL.AUTH_INVALID:
            case RISK_SIGNAL.PROVIDER_NEEDS_REFRESH:
                targetState = LIFECYCLE_STATE.NEEDS_REFRESH;
                break;
            case RISK_SIGNAL.QUOTA_EXCEEDED:
                targetState = LIFECYCLE_STATE.COOLDOWN;
                break;
            case RISK_SIGNAL.RATE_LIMITED:
            case RISK_SIGNAL.NETWORK_TRANSIENT:
            case RISK_SIGNAL.IDENTITY_COLLISION:
                targetState = normalizedCurrent;
                break;
            case RISK_SIGNAL.SUSPENDED:
                targetState = LIFECYCLE_STATE.SUSPENDED;
                break;
            case RISK_SIGNAL.BANNED:
                targetState = LIFECYCLE_STATE.BANNED;
                break;
            case RISK_SIGNAL.PROVIDER_DISABLED:
                targetState = LIFECYCLE_STATE.DISABLED;
                break;
            case RISK_SIGNAL.PROVIDER_MARKED_UNHEALTHY:
                if (normalizedCurrent === LIFECYCLE_STATE.HEALTHY || normalizedCurrent === LIFECYCLE_STATE.UNKNOWN) {
                    targetState = LIFECYCLE_STATE.QUARANTINED;
                }
                break;
            default:
                targetState = normalizedCurrent;
                break;
        }

        const changed = targetState !== normalizedCurrent;
        const decision = this.mode === RISK_POLICY_MODE.OBSERVE
            ? DECISION.OBSERVE_ONLY
            : changed
                ? DECISION.TRANSITION
                : DECISION.NO_STATE_CHANGE;

        return {
            decision,
            previousState: normalizedCurrent,
            nextState: targetState,
            changed,
            mode: this.mode,
            contextSnapshot: {
                providerType: context.providerType || null,
                uuid: context.uuid || null,
                source: context.source || null,
                stream: context.stream === true,
                requestId: context.requestId || null
            }
        };
    }
}
