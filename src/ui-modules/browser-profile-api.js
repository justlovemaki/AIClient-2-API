import { getRequestBody } from '../utils/common.js';
import logger from '../utils/logger.js';
import {
    ensureIsolatedBrowserForCredential,
    openIsolatedBrowserForCredential
} from '../services/browser-profile-manager.js';

export async function handleEnsureBrowserProfile(req, res, currentConfig, providerPoolManager, providerType, uuid) {
    try {
        const result = await ensureIsolatedBrowserForCredential({
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
        let body = {};
        try {
            body = await getRequestBody(req);
        } catch {}

        const url = body?.url ? String(body.url) : null;

        const result = await openIsolatedBrowserForCredential({
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
