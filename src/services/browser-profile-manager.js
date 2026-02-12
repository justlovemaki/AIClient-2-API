import logger from '../utils/logger.js';
import {
    bitbrowserOpenProfile,
    bitbrowserOpenUrlInProfile,
    bitbrowserUpsertProfile
} from '../utils/bitbrowser-client.js';
import { isProxyEnabledForProvider } from '../utils/proxy-utils.js';

function getBitBrowserConfig(appConfig) {
    return {
        enabled: appConfig?.BITBROWSER_ENABLED === true,
        apiUrl: appConfig?.BITBROWSER_API_URL || 'http://127.0.0.1:54345',
        coreVersion: appConfig?.BITBROWSER_CORE_VERSION || '124'
    };
}

function findNodeConfig(providerPoolManager, providerType, uuid) {
    const list = providerPoolManager?.providerStatus?.[providerType];
    if (!Array.isArray(list)) return null;
    const entry = list.find((p) => p?.config?.uuid === uuid);
    return entry?.config || null;
}

function buildProfileName(nodeConfig, providerType) {
    const label = nodeConfig?.accountId || nodeConfig?.customName || nodeConfig?.uuid || 'unknown';
    return `AIClient ${providerType} ${label}`.slice(0, 64);
}

function buildProfileRemark(nodeConfig, providerType) {
    const parts = [
        `provider=${providerType}`,
        nodeConfig?.uuid ? `uuid=${nodeConfig.uuid}` : null,
        nodeConfig?.accountId ? `accountId=${nodeConfig.accountId}` : null,
        nodeConfig?.customName ? `name=${nodeConfig.customName}` : null
    ].filter(Boolean);
    return parts.join(' | ').slice(0, 256);
}

export async function ensureBitBrowserProfileForCredential({
    appConfig,
    providerPoolManager,
    providerType,
    uuid
}) {
    const bb = getBitBrowserConfig(appConfig);
    if (!bb.enabled) {
        throw new Error('BitBrowser is disabled (set BITBROWSER_ENABLED=true)');
    }
    if (!providerPoolManager) {
        throw new Error('ProviderPoolManager unavailable');
    }
    if (!providerType || !uuid) {
        throw new Error('providerType and uuid are required');
    }

    const nodeConfig = findNodeConfig(providerPoolManager, providerType, uuid);
    if (!nodeConfig) {
        throw new Error(`Provider node not found: ${providerType}/${uuid}`);
    }

    const existingProfileId = nodeConfig.BITBROWSER_PROFILE_ID || null;
    const hasNodeOverride = Object.prototype.hasOwnProperty.call(nodeConfig, 'PROXY_URL');
    const proxyUrl = hasNodeOverride
        ? nodeConfig.PROXY_URL
        : (isProxyEnabledForProvider(appConfig, providerType) ? appConfig.PROXY_URL : undefined);

    const name = buildProfileName(nodeConfig, providerType);
    const remark = buildProfileRemark(nodeConfig, providerType);

    const result = await bitbrowserUpsertProfile({
        apiUrl: bb.apiUrl,
        profileId: existingProfileId,
        name,
        remark,
        proxyUrl,
        coreVersion: bb.coreVersion
    });

    if (result.profileId && result.profileId !== existingProfileId) {
        if (typeof providerPoolManager.patchProviderConfig === 'function') {
            providerPoolManager.patchProviderConfig(providerType, uuid, {
                BITBROWSER_PROFILE_ID: result.profileId
            });
        } else {
            // Fallback: leave unpersisted; UI/API should surface the returned id.
            logger.warn('[BitBrowser] ProviderPoolManager.patchProviderConfig missing; profile binding not persisted');
        }
    }

    return {
        profileId: result.profileId,
        proxyUrl: proxyUrl ?? null,
        name,
        remark
    };
}

export async function openBitBrowserProfileForCredential({
    appConfig,
    providerPoolManager,
    providerType,
    uuid,
    url
}) {
    const ensured = await ensureBitBrowserProfileForCredential({
        appConfig,
        providerPoolManager,
        providerType,
        uuid
    });

    const bb = getBitBrowserConfig(appConfig);
    if (url) {
        const { openInfo, openedUrl, openUrlError } = await bitbrowserOpenUrlInProfile({
            apiUrl: bb.apiUrl,
            profileId: ensured.profileId,
            url
        });
        return {
            profileId: ensured.profileId,
            openInfo,
            openedUrl,
            openUrlError: openUrlError || null
        };
    }

    const openInfo = await bitbrowserOpenProfile({
        apiUrl: bb.apiUrl,
        profileId: ensured.profileId
    });
    return {
        profileId: ensured.profileId,
        openInfo
    };
}
