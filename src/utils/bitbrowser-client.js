import axios from 'axios';
import WebSocket from 'ws';
import logger from './logger.js';

function normalizeApiUrl(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, '');
}

function withTimeout(ms, fn) {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
    });
    return Promise.race([
        fn().finally(() => timeoutId && clearTimeout(timeoutId)),
        timeout
    ]);
}

function parseProxyUrl(proxyUrlRaw) {
    if (proxyUrlRaw === undefined) return { mode: 'unset' };
    const trimmed = String(proxyUrlRaw || '').trim();
    if (!trimmed) return { mode: 'disabled' };

    let url;
    try {
        url = new URL(trimmed);
    } catch (e) {
        throw new Error(`Invalid proxy URL: ${e.message}`);
    }

    const protocol = url.protocol.toLowerCase();
    const host = url.hostname;
    const port = url.port;
    const username = url.username || '';
    const password = url.password || '';

    if (!host || !port) {
        throw new Error('Invalid proxy URL: missing host/port');
    }

    let proxyType = null;
    if (protocol === 'socks5:' || protocol === 'socks:' || protocol === 'socks4:') {
        proxyType = 'socks5';
    } else if (protocol === 'http:' || protocol === 'https:') {
        proxyType = 'http';
    } else {
        throw new Error(`Unsupported proxy protocol: ${protocol}`);
    }

    return {
        mode: 'enabled',
        proxyType,
        host,
        port: String(port),
        username,
        password
    };
}

function maskProxyUrl(proxyUrlRaw) {
    if (!proxyUrlRaw) return '';
    try {
        const url = new URL(String(proxyUrlRaw).trim());
        const auth = url.username || url.password;
        if (auth) {
            url.username = url.username ? '***' : '';
            url.password = url.password ? '***' : '';
        }
        return url.toString();
    } catch {
        return '[invalid proxy url]';
    }
}

async function postJsonNoProxy(apiUrl, pathname, payload, { timeoutMs = 15000 } = {}) {
    const base = normalizeApiUrl(apiUrl);
    if (!base) {
        throw new Error('BitBrowser API URL is not configured');
    }
    const url = `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

    const response = await axios.post(url, payload, {
        timeout: timeoutMs,
        // MUST disable proxy to avoid local API requests being routed through global proxies.
        proxy: false,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true
    });

    if (!response?.data) {
        throw new Error(`BitBrowser API empty response (${response?.status || 'unknown'})`);
    }
    return response.data;
}

async function cdpCreateTarget(wsEndpoint, targetUrl, { timeoutMs = 15000 } = {}) {
    if (!wsEndpoint || !targetUrl) {
        throw new Error('Missing wsEndpoint or targetUrl');
    }

    return await withTimeout(timeoutMs, () => new Promise((resolve, reject) => {
        const ws = new WebSocket(wsEndpoint);
        const requestId = 1;
        let finished = false;

        const done = (err, result) => {
            if (finished) return;
            finished = true;
            try {
                ws.close();
            } catch {}
            if (err) reject(err);
            else resolve(result);
        };

        ws.on('open', () => {
            const msg = {
                id: requestId,
                method: 'Target.createTarget',
                params: {
                    url: targetUrl,
                    newWindow: false,
                    background: false
                }
            };
            ws.send(JSON.stringify(msg));
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.id !== requestId) return;
                if (msg.error) {
                    done(new Error(msg.error.message || 'CDP error'));
                    return;
                }
                done(null, msg.result || {});
            } catch (e) {
                done(new Error(`CDP message parse error: ${e.message}`));
            }
        });

        ws.on('error', (err) => done(err));
        ws.on('close', () => {
            if (!finished) {
                done(new Error('CDP connection closed before response'));
            }
        });
    }));
}

export async function bitbrowserUpsertProfile({
    apiUrl,
    profileId,
    name,
    remark,
    proxyUrl,
    coreVersion
}) {
    const proxy = parseProxyUrl(proxyUrl);

    const payload = {
        ...(profileId ? { id: profileId } : {}),
        name: name || 'AIClient Profile',
        remark: remark || '',
        browserFingerPrint: coreVersion ? { coreVersion: String(coreVersion) } : {}
    };

    if (proxy.mode === 'disabled' || proxy.mode === 'unset') {
        // Prefer explicit no-proxy for deterministic isolation.
        payload.proxyMethod = 3;
        payload.proxyType = 'noproxy';
        payload.host = '';
        payload.port = '';
        // BitBrowser API uses proxyUserName/proxyPassword (some docs mention proxyAccount).
        // Set both for compatibility across BitBrowser versions.
        payload.proxyUserName = '';
        payload.proxyAccount = '';
        payload.proxyPassword = '';
    } else {
        payload.proxyMethod = 2;
        payload.proxyType = proxy.proxyType;
        payload.host = proxy.host;
        payload.port = proxy.port;
        // BitBrowser API uses proxyUserName/proxyPassword (some docs mention proxyAccount).
        // Set both for compatibility across BitBrowser versions.
        payload.proxyUserName = proxy.username;
        payload.proxyAccount = proxy.username;
        payload.proxyPassword = proxy.password;
    }

    const data = await postJsonNoProxy(apiUrl, '/browser/update', payload, { timeoutMs: 20000 });
    if (!data.success) {
        throw new Error(data.msg || data.message || 'BitBrowser update failed');
    }
    const id = data?.data?.id;
    if (!id) {
        throw new Error('BitBrowser update returned no profile id');
    }

    logger.info(`[BitBrowser] Upsert profile ok id=${id} proxy=${maskProxyUrl(proxyUrl) || '[noproxy]'}`);
    return { profileId: id };
}

export async function bitbrowserOpenProfile({
    apiUrl,
    profileId,
    args = undefined,
    queue = true,
    ignoreDefaultUrls = false,
    newPageUrl = undefined
} = {}) {
    if (!profileId) {
        throw new Error('Missing profileId');
    }
    // BitBrowser supports optional open parameters (args/queue/ignoreDefaultUrls/newPageUrl) in newer versions.
    // Keep this function backward-compatible by retrying with the minimal payload when those options are rejected.
    const payload = { id: profileId, queue: Boolean(queue) };
    if (Array.isArray(args) && args.length) {
        payload.args = args.filter(Boolean).map((v) => String(v));
    }
    if (ignoreDefaultUrls) {
        payload.ignoreDefaultUrls = true;
    }
    if (newPageUrl) {
        payload.newPageUrl = String(newPageUrl);
    }

    const usedOptions = Boolean(payload.args?.length || payload.ignoreDefaultUrls || payload.newPageUrl);

    let data = await postJsonNoProxy(apiUrl, '/browser/open', payload, { timeoutMs: 30000 });
    if (!data.success && usedOptions) {
        const message = data.msg || data.message || 'BitBrowser open failed';
        logger.warn(`[BitBrowser] Open failed with options; retrying minimal payload (profile=${profileId}): ${message}`);
        data = await postJsonNoProxy(apiUrl, '/browser/open', { id: profileId }, { timeoutMs: 30000 });
    }

    if (!data.success) {
        throw new Error(data.msg || data.message || 'BitBrowser open failed');
    }
    return data.data || {};
}

export async function bitbrowserCloseProfile({ apiUrl, profileId }) {
    if (!profileId) {
        throw new Error('Missing profileId');
    }
    const data = await postJsonNoProxy(apiUrl, '/browser/close', { id: profileId }, { timeoutMs: 15000 });
    if (!data.success) {
        throw new Error(data.msg || data.message || 'BitBrowser close failed');
    }
    return true;
}

export async function bitbrowserOpenUrlInProfile({ apiUrl, profileId, url }) {
    const openArgs = [];
    const loopbackHosts = new Set(['127.0.0.1', 'localhost']);

    // Ensure OAuth loopback callbacks (http://127.0.0.1:PORT/...) do NOT go through the node proxy.
    // Without this, proxied profiles can fail to reach the local callback server.
    openArgs.push('--proxy-bypass-list=<-loopback>');

    // For WSL/Docker -> Windows host scenarios, BitBrowser sometimes returns loopback CDP endpoints.
    // This arg makes the DevTools server bind to all interfaces so we can reach it from the Linux side.
    try {
        const api = new URL(String(apiUrl));
        if (api.hostname && !loopbackHosts.has(api.hostname)) {
            // Security note: this may expose the DevTools port on LAN. Operators should firewall/segment the host.
            openArgs.push('--remote-debugging-address=0.0.0.0');
        }
    } catch {
        // ignore
    }

    // Preferred: strict /browser/open with newPageUrl.
    // Do NOT fall back silently to the minimal payload here; otherwise we can claim "openedUrl=true"
    // while the URL was never actually opened (common when running AIClient in WSL and BitBrowser on Windows).
    let openNewPageError = null;
    try {
        const payload = {
            id: profileId,
            queue: true,
            ignoreDefaultUrls: true,
            newPageUrl: String(url)
        };
        if (openArgs.length) {
            payload.args = openArgs.filter(Boolean).map((v) => String(v));
        }

        const data = await postJsonNoProxy(apiUrl, '/browser/open', payload, { timeoutMs: 30000 });
        if (!data.success) {
            throw new Error(data.msg || data.message || 'BitBrowser open failed');
        }

        const openInfo = data.data || {};
        logger.info(`[BitBrowser] Requested open URL via /browser/open newPageUrl (profile=${profileId})`);
        return { openInfo, openedUrl: true, openedVia: 'open:newPageUrl' };
    } catch (error) {
        openNewPageError = error;
        logger.warn(`[BitBrowser] /browser/open newPageUrl failed, falling back (profile=${profileId}): ${error?.message || 'unknown error'}`);
    }

    // Fallback: open profile then create a new tab via CDP.
    const openInfo = await bitbrowserOpenProfile({
        apiUrl,
        profileId,
        queue: true,
        args: openArgs.length ? openArgs : undefined
    });
    const wsEndpoint = openInfo.ws || openInfo.webdriver;

    if (!wsEndpoint) {
        logger.warn('[BitBrowser] Open returned no ws endpoint; cannot auto-open URL');
        const hint = openNewPageError
            ? `BitBrowser does not support opening URL automatically on this version. Open the URL manually inside the BitBrowser window. (open error: ${openNewPageError?.message || 'unknown'})`
            : 'Missing ws endpoint';
        return { openInfo, openedUrl: false, openUrlError: hint };
    }

    const endpointsToTry = [];
    endpointsToTry.push(wsEndpoint);

    // Some BitBrowser installs return loopback WS endpoints even when the API is accessed remotely
    // (e.g. WSL -> Windows host). Try rewriting hostname to the API host as a best-effort fallback.
    try {
        const wsUrl = new URL(String(wsEndpoint));
        const api = new URL(String(apiUrl));
        const loopbackHosts = new Set(['127.0.0.1', 'localhost']);
        if (loopbackHosts.has(wsUrl.hostname) && api.hostname && !loopbackHosts.has(api.hostname)) {
            wsUrl.hostname = api.hostname;
            const rewritten = wsUrl.toString();
            if (rewritten !== wsEndpoint) {
                endpointsToTry.push(rewritten);
            }
        }
    } catch {
        // Ignore URL parse errors (we'll just attempt the original endpoint).
    }

    let lastError = null;
    for (const endpoint of [...new Set(endpointsToTry)]) {
        try {
            await cdpCreateTarget(endpoint, url, { timeoutMs: 8000 });
            logger.info(`[BitBrowser] Opened URL in profile id=${profileId}`);
            return { openInfo, openedUrl: true, wsEndpointUsed: endpoint };
        } catch (error) {
            lastError = error;
        }
    }

    // Non-fatal: profile is open, but we couldn't create a new tab via CDP.
    const message = lastError?.message || 'CDP open failed';
    logger.warn(`[BitBrowser] Failed to open URL via CDP (profile=${profileId}): ${message}`);

    const hint = (() => {
        try {
            const wsUrl = new URL(String(wsEndpoint));
            const api = new URL(String(apiUrl));
            if ((wsUrl.hostname === '127.0.0.1' || wsUrl.hostname === 'localhost') && api.hostname && api.hostname !== wsUrl.hostname) {
                return `CDP endpoint is loopback (${wsUrl.hostname}). If AIClient runs in WSL/Docker and BitBrowser runs on the host OS, the browser profile is still opened but URL auto-open is not available. Open the URL manually inside the BitBrowser window. (CDP error: ${message})${openNewPageError ? ` (open error: ${openNewPageError?.message || 'unknown'})` : ''}`;
            }
        } catch {}
        return `Failed to open URL automatically. Open the URL manually in the BitBrowser window. (CDP error: ${message})${openNewPageError ? ` (open error: ${openNewPageError?.message || 'unknown'})` : ''}`;
    })();

    return { openInfo, openedUrl: false, openUrlError: hint };
}
