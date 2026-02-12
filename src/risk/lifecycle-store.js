import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { LIFECYCLE_STATE } from './constants.js';

function nowIso() {
    return new Date().toISOString();
}

function toCredentialId(providerType, uuid) {
    return `${providerType}:${uuid}`;
}

function deriveInitialState(providerConfig = {}) {
    if (providerConfig.isDisabled) return LIFECYCLE_STATE.DISABLED;
    if (providerConfig.needsRefresh) return LIFECYCLE_STATE.NEEDS_REFRESH;

    if (providerConfig.scheduledRecoveryTime) {
        const recovery = new Date(providerConfig.scheduledRecoveryTime).getTime();
        if (Number.isFinite(recovery) && recovery > Date.now()) {
            return LIFECYCLE_STATE.COOLDOWN;
        }
    }

    if (providerConfig.isHealthy === false) return LIFECYCLE_STATE.QUARANTINED;
    return LIFECYCLE_STATE.HEALTHY;
}

export class LifecycleStore {
    constructor(options = {}) {
        this.filePath = options.filePath || path.join('configs', 'risk-lifecycle.json');
        this.maxEvents = Number.isFinite(options.maxEvents) ? options.maxEvents : 5000;
        this.flushDebounceMs = Number.isFinite(options.flushDebounceMs) ? options.flushDebounceMs : 500;

        this.credentials = new Map();
        this.events = [];

        this._flushTimer = null;
        this._isDirty = false;
    }

    loadFromDisk() {
        try {
            if (!existsSync(this.filePath)) {
                return;
            }

            const content = readFileSync(this.filePath, 'utf8');
            if (!content.trim()) {
                return;
            }

            const parsed = JSON.parse(content);

            if (Array.isArray(parsed.credentials)) {
                parsed.credentials.forEach((record) => {
                    if (!record?.providerType || !record?.uuid) return;
                    const key = toCredentialId(record.providerType, record.uuid);
                    this.credentials.set(key, record);
                });
            }

            if (Array.isArray(parsed.events)) {
                this.events = parsed.events.slice(-this.maxEvents);
            }
        } catch (error) {
            logger.error('[RiskLifecycleStore] Failed to load lifecycle store:', error.message);
        }
    }

    initializeFromProviderPools(providerPools = {}) {
        for (const [providerType, providers] of Object.entries(providerPools)) {
            if (!Array.isArray(providers)) continue;
            for (const provider of providers) {
                if (!provider?.uuid) continue;
                const key = toCredentialId(providerType, provider.uuid);
                const existing = this.credentials.get(key);
                const state = deriveInitialState(provider);
                const now = nowIso();

                const merged = {
                    credentialId: key,
                    providerType,
                    uuid: provider.uuid,
                    customName: provider.customName || null,
                    lifecycleState: existing?.lifecycleState || state,
                    cooldownUntil: provider.scheduledRecoveryTime || existing?.cooldownUntil || null,
                    lastSignalType: existing?.lastSignalType || null,
                    lastReasonCode: existing?.lastReasonCode || null,
                    lastStatusCode: existing?.lastStatusCode || null,
                    lastSource: existing?.lastSource || null,
                    lastErrorMessage: provider.lastErrorMessage || existing?.lastErrorMessage || null,
                    firstSeenAt: existing?.firstSeenAt || now,
                    updatedAt: now,
                    metadata: {
                        isHealthy: provider.isHealthy !== false,
                        isDisabled: provider.isDisabled === true,
                        needsRefresh: provider.needsRefresh === true,
                        priority: provider.priority ?? null
                    }
                };

                this.credentials.set(key, merged);
            }
        }

        this._markDirty();
    }

    upsertCredential(record = {}) {
        const providerType = record.providerType;
        const uuid = record.uuid;
        if (!providerType || !uuid) return null;

        const key = toCredentialId(providerType, uuid);
        const now = nowIso();
        const existing = this.credentials.get(key);

        const merged = {
            credentialId: key,
            providerType,
            uuid,
            customName: record.customName ?? existing?.customName ?? null,
            lifecycleState: record.lifecycleState || existing?.lifecycleState || LIFECYCLE_STATE.UNKNOWN,
            cooldownUntil: record.cooldownUntil ?? existing?.cooldownUntil ?? null,
            lastSignalType: record.lastSignalType ?? existing?.lastSignalType ?? null,
            lastReasonCode: record.lastReasonCode ?? existing?.lastReasonCode ?? null,
            lastStatusCode: record.lastStatusCode ?? existing?.lastStatusCode ?? null,
            lastSource: record.lastSource ?? existing?.lastSource ?? null,
            lastErrorMessage: record.lastErrorMessage ?? existing?.lastErrorMessage ?? null,
            firstSeenAt: existing?.firstSeenAt || now,
            updatedAt: now,
            metadata: {
                ...(existing?.metadata || {}),
                ...(record.metadata || {})
            }
        };

        this.credentials.set(key, merged);
        this._markDirty();
        return merged;
    }

    appendEvent(event) {
        if (!event) return;
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(-this.maxEvents);
        }
        this._markDirty();
    }

    getCredential(providerType, uuid) {
        if (!providerType || !uuid) return null;
        return this.credentials.get(toCredentialId(providerType, uuid)) || null;
    }

    getAllCredentials(filters = {}) {
        const { providerType, lifecycleState } = filters;
        return Array.from(this.credentials.values()).filter((record) => {
            if (providerType && record.providerType !== providerType) return false;
            if (lifecycleState && record.lifecycleState !== lifecycleState) return false;
            return true;
        });
    }

    getRecentEvents(limit = 100, filters = {}) {
        const parsedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
        const { providerType, uuid, signalType } = filters;
        const filtered = this.events.filter((event) => {
            if (providerType && event.providerType !== providerType) return false;
            if (uuid && event.uuid !== uuid) return false;
            if (signalType && event.signalType !== signalType) return false;
            return true;
        });
        return filtered.slice(-parsedLimit).reverse();
    }

    getSummary() {
        const credentials = Array.from(this.credentials.values());
        const stateCount = {};
        credentials.forEach((record) => {
            const state = record.lifecycleState || LIFECYCLE_STATE.UNKNOWN;
            stateCount[state] = (stateCount[state] || 0) + 1;
        });

        return {
            totalCredentials: credentials.length,
            stateCount,
            eventCount: this.events.length,
            lastEventAt: this.events.length > 0 ? this.events[this.events.length - 1].timestamp : null,
            updatedAt: nowIso()
        };
    }

    flushNow() {
        if (!this._isDirty) return;

        try {
            const dir = path.dirname(this.filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }

            const payload = {
                version: 1,
                generatedAt: nowIso(),
                credentials: Array.from(this.credentials.values()),
                events: this.events
            };

            writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
            this._isDirty = false;
        } catch (error) {
            logger.error('[RiskLifecycleStore] Failed to persist lifecycle store:', error.message);
        }
    }

    _markDirty() {
        this._isDirty = true;
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
        }
        this._flushTimer = setTimeout(() => {
            this.flushNow();
        }, this.flushDebounceMs);
    }
}
