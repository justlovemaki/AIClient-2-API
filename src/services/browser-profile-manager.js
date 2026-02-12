import logger from '../utils/logger.js';
import {
    bitbrowserOpenProfile,
    bitbrowserOpenUrlInProfile,
    bitbrowserUpsertProfile
} from '../utils/bitbrowser-client.js';
import { isProxyEnabledForProvider } from '../utils/proxy-utils.js';
import {
    ensureLocalBrowserProfileDir,
    openLocalBrowser
} from '../utils/local-browser-client.js';

const ISOLATED_BROWSER_PROVIDER = {
    BITBROWSER: 'bitbrowser',
    LOCAL_CHROMIUM: 'local-chromium'
};

function normalizeString(value) {
    if (value === undefined || value === null) return '';
    const s = String(value).trim();
    return s || '';
}

function normalizeBrowserProvider(value) {
    const raw = normalizeString(value).toLowerCase();
    if (!raw) return '';
    if (raw === 'bitbrowser') return ISOLATED_BROWSER_PROVIDER.BITBROWSER;
    if (
        raw === 'local-chromium' ||
        raw === 'local' ||
        raw === 'chromium' ||
        raw === 'chrome'
    ) {
        return ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM;
    }
    return '';
}

function getBitBrowserConfig(appConfig) {
    return {
        enabled: appConfig?.BITBROWSER_ENABLED === true,
        apiUrl: appConfig?.BITBROWSER_API_URL || 'http://127.0.0.1:54345',
        coreVersion: appConfig?.BITBROWSER_CORE_VERSION || '124'
    };
}

function getLocalBrowserConfig(appConfig) {
    return {
        enabled: appConfig?.LOCAL_BROWSER_ENABLED === true,
        openCommand: normalizeString(appConfig?.LOCAL_BROWSER_OPEN_COMMAND),
        profileBaseDir: normalizeString(appConfig?.LOCAL_BROWSER_PROFILE_BASE_DIR) || 'configs/browser-profiles',
        binary: normalizeString(appConfig?.LOCAL_BROWSER_BINARY),
        extraArgs: normalizeString(appConfig?.LOCAL_BROWSER_EXTRA_ARGS)
    };
}

function getIsolatedBrowserConfig(appConfig) {
    const bitbrowser = getBitBrowserConfig(appConfig);
    const local = getLocalBrowserConfig(appConfig);
    const explicitProvider = normalizeBrowserProvider(appConfig?.ISOLATED_BROWSER_PROVIDER);

    const provider = explicitProvider ||
        (bitbrowser.enabled ? ISOLATED_BROWSER_PROVIDER.BITBROWSER : ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM);

    return {
        provider,
        bitbrowser,
        local
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

function getNodeProxyUrl(nodeConfig, appConfig, providerType) {
    const hasNodeOverride = Object.prototype.hasOwnProperty.call(nodeConfig, 'PROXY_URL');
    return hasNodeOverride
        ? nodeConfig.PROXY_URL
        : (isProxyEnabledForProvider(appConfig, providerType) ? appConfig.PROXY_URL : undefined);
}

function validateCommonInput(providerPoolManager, providerType, uuid) {
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
    return nodeConfig;
}

function resolveProviderForAction(appConfig, forceProvider = '') {
    const cfg = getIsolatedBrowserConfig(appConfig);
    const forced = normalizeBrowserProvider(forceProvider);
    const provider = forced || cfg.provider;

    if (provider === ISOLATED_BROWSER_PROVIDER.BITBROWSER && cfg.bitbrowser.enabled !== true) {
        throw new Error('BitBrowser is disabled (set BITBROWSER_ENABLED=true)');
    }

    if (provider === ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM && cfg.local.enabled !== true) {
        throw new Error(
            'Local Chromium isolated browser is disabled (set LOCAL_BROWSER_ENABLED=true or switch provider)'
        );
    }

    if (!provider) {
        throw new Error('No isolated browser provider configured');
    }

    return { provider, cfg };
}

async function ensureBitBrowserProfileInternal({
    appConfig,
    providerPoolManager,
    providerType,
    uuid
}) {
    const bb = getBitBrowserConfig(appConfig);
    const nodeConfig = validateCommonInput(providerPoolManager, providerType, uuid);

    const existingProfileId = nodeConfig.BITBROWSER_PROFILE_ID || null;
    const proxyUrl = getNodeProxyUrl(nodeConfig, appConfig, providerType);

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
        provider: ISOLATED_BROWSER_PROVIDER.BITBROWSER,
        profileId: result.profileId,
        proxyUrl: proxyUrl ?? null,
        name,
        remark
    };
}

async function openBitBrowserProfileInternal({
    appConfig,
    providerPoolManager,
    providerType,
    uuid,
    url
}) {
    const ensured = await ensureBitBrowserProfileInternal({
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
            provider: ISOLATED_BROWSER_PROVIDER.BITBROWSER,
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
        provider: ISOLATED_BROWSER_PROVIDER.BITBROWSER,
        profileId: ensured.profileId,
        openInfo
    };
}

async function ensureLocalChromiumProfileInternal({
    appConfig,
    providerPoolManager,
    providerType,
    uuid
}) {
    const local = getLocalBrowserConfig(appConfig);
    const nodeConfig = validateCommonInput(providerPoolManager, providerType, uuid);
    const profileBaseDir = normalizeString(nodeConfig?.LOCAL_BROWSER_PROFILE_BASE_DIR) || local.profileBaseDir;
    const profileDir = normalizeString(nodeConfig?.LOCAL_BROWSER_PROFILE_DIR) ||
        await ensureLocalBrowserProfileDir({
            baseDir: profileBaseDir,
            providerType,
            uuid
        });

    const profileId = normalizeString(nodeConfig?.LOCAL_BROWSER_PROFILE_ID) || `local-${uuid}`;
    const proxyUrl = getNodeProxyUrl(nodeConfig, appConfig, providerType);
    const name = buildProfileName(nodeConfig, providerType);
    const remark = buildProfileRemark(nodeConfig, providerType);

    if (typeof providerPoolManager.patchProviderConfig === 'function') {
        providerPoolManager.patchProviderConfig(providerType, uuid, {
            LOCAL_BROWSER_PROFILE_ID: profileId,
            LOCAL_BROWSER_PROFILE_DIR: profileDir,
            ISOLATED_BROWSER_PROFILE_PROVIDER: ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM
        });
    }

    return {
        provider: ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM,
        profileId,
        profileDir,
        proxyUrl: proxyUrl ?? null,
        name,
        remark
    };
}

async function openLocalChromiumProfileInternal({
    appConfig,
    providerPoolManager,
    providerType,
    uuid,
    url
}) {
    const local = getLocalBrowserConfig(appConfig);
    const nodeConfig = validateCommonInput(providerPoolManager, providerType, uuid);
    const ensured = await ensureLocalChromiumProfileInternal({
        appConfig,
        providerPoolManager,
        providerType,
        uuid
    });

    const commandTemplate = normalizeString(nodeConfig?.LOCAL_BROWSER_OPEN_COMMAND) || local.openCommand;
    const browserBinary = normalizeString(nodeConfig?.LOCAL_BROWSER_BINARY) || local.binary;
    const extraArgs = normalizeString(nodeConfig?.LOCAL_BROWSER_EXTRA_ARGS) || local.extraArgs;

    const openInfo = await openLocalBrowser({
        providerType,
        uuid,
        url: normalizeString(url),
        profileDir: ensured.profileDir,
        proxyUrl: ensured.proxyUrl || '',
        commandTemplate,
        browserBinary,
        extraArgs
    });

    return {
        provider: ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM,
        profileId: ensured.profileId,
        profileDir: ensured.profileDir,
        openInfo,
        openedUrl: Boolean(normalizeString(url))
    };
}

export async function ensureIsolatedBrowserForCredential({
    appConfig,
    providerPoolManager,
    providerType,
    uuid,
    forceProvider = ''
}) {
    const { provider } = resolveProviderForAction(appConfig, forceProvider);

    if (provider === ISOLATED_BROWSER_PROVIDER.BITBROWSER) {
        return await ensureBitBrowserProfileInternal({
            appConfig,
            providerPoolManager,
            providerType,
            uuid
        });
    }

    if (provider === ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM) {
        return await ensureLocalChromiumProfileInternal({
            appConfig,
            providerPoolManager,
            providerType,
            uuid
        });
    }

    throw new Error(`Unsupported isolated browser provider: ${provider}`);
}

export async function openIsolatedBrowserForCredential({
    appConfig,
    providerPoolManager,
    providerType,
    uuid,
    url,
    forceProvider = ''
}) {
    const { provider } = resolveProviderForAction(appConfig, forceProvider);

    if (provider === ISOLATED_BROWSER_PROVIDER.BITBROWSER) {
        return await openBitBrowserProfileInternal({
            appConfig,
            providerPoolManager,
            providerType,
            uuid,
            url
        });
    }

    if (provider === ISOLATED_BROWSER_PROVIDER.LOCAL_CHROMIUM) {
        return await openLocalChromiumProfileInternal({
            appConfig,
            providerPoolManager,
            providerType,
            uuid,
            url
        });
    }

    throw new Error(`Unsupported isolated browser provider: ${provider}`);
}

export async function ensureBitBrowserProfileForCredential(args) {
    return await ensureIsolatedBrowserForCredential({
        ...args,
        forceProvider: ISOLATED_BROWSER_PROVIDER.BITBROWSER
    });
}

export async function openBitBrowserProfileForCredential(args) {
    return await openIsolatedBrowserForCredential({
        ...args,
        forceProvider: ISOLATED_BROWSER_PROVIDER.BITBROWSER
    });
}
