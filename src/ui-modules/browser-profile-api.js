import { getRequestBody } from '../utils/common.js';
import logger from '../utils/logger.js';
import {
    ensureBitBrowserProfileForCredential,
    openBitBrowserProfileForCredential
} from '../services/browser-profile-manager.js';

function requireBitBrowserEnabled(currentConfig) {
    if (currentConfig?.BITBROWSER_ENABLED !== true) {
        const apiUrl = currentConfig?.BITBROWSER_API_URL || 'http://127.0.0.1:54345';
        throw new Error(`BitBrowser is disabled. Set BITBROWSER_ENABLED=true (API: ${apiUrl})`);
    }
}

export async function handleEnsureBrowserProfile(req, res, currentConfig, providerPoolManager, providerType, uuid) {
    try {
        requireBitBrowserEnabled(currentConfig);

        const result = await ensureBitBrowserProfileForCredential({
            appConfig: currentConfig,
            providerPoolManager,
            providerType,
            uuid
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
        return true;
    } catch (error) {
        logger.error('[UI API] ensure browser profile failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return true;
    }
}

export async function handleOpenBrowserProfile(req, res, currentConfig, providerPoolManager, providerType, uuid) {
    try {
        requireBitBrowserEnabled(currentConfig);

        let body = {};
        try {
            body = await getRequestBody(req);
        } catch {}

        const url = body?.url ? String(body.url) : null;

        const result = await openBitBrowserProfileForCredential({
            appConfig: currentConfig,
            providerPoolManager,
            providerType,
            uuid,
            url
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
        return true;
    } catch (error) {
        logger.error('[UI API] open browser profile failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return true;
    }
}
