import { spawn, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger.js';

const DEFAULT_BROWSER_BINARIES = [
    'chromium-browser',
    'chromium',
    'google-chrome',
    'google-chrome-stable',
    'microsoft-edge',
    'microsoft-edge-stable',
    'brave-browser'
];

function normalizeString(value) {
    if (value === undefined || value === null) return '';
    const s = String(value).trim();
    return s || '';
}

function shellEscape(value) {
    return `"${String(value ?? '').replace(/(["\\$`])/g, '\\$1')}"`;
}

function resolveProfileDir(baseDir, providerType, uuid) {
    const normalizedBase = normalizeString(baseDir) || 'configs/browser-profiles';
    const absoluteBase = path.isAbsolute(normalizedBase)
        ? normalizedBase
        : path.join(process.cwd(), normalizedBase);
    return path.join(absoluteBase, providerType, uuid);
}

function splitCommandLineArgs(value) {
    const raw = normalizeString(value);
    if (!raw) return [];
    return raw.split(/\s+/).filter(Boolean);
}

function normalizeProxyInput(value) {
    let raw = normalizeString(value);
    if (!raw) return '';

    // Accept shorthand like: "http host:port:user:pass"
    raw = raw.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*)\s+/, (_, scheme) => `${scheme}://`);

    // Accept shorthand like: "host:port:user:pass" (defaults to http)
    if (!raw.includes('://') && /^[^:\s]+:\d+:[^:\s]+:[^:\s]+$/.test(raw)) {
        const [host, port, username, password] = raw.split(':');
        return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    }

    // Accept shorthand like: "host:port" (defaults to http)
    if (!raw.includes('://') && /^[^:\s]+:\d+$/.test(raw)) {
        return `http://${raw}`;
    }

    return raw;
}

function buildChromiumProxyServer(proxyUrl) {
    const normalized = normalizeProxyInput(proxyUrl);
    if (!normalized) {
        return { proxyServer: '', hadCredentials: false };
    }

    try {
        const parsed = new URL(normalized);
        const protocol = (parsed.protocol || 'http:').replace(/:$/, '');
        const host = parsed.hostname;
        const port = parsed.port ? `:${parsed.port}` : '';
        const hadCredentials = Boolean(parsed.username || parsed.password);
        if (!host) {
            return { proxyServer: normalized, hadCredentials: false };
        }
        return {
            proxyServer: `${protocol}://${host}${port}`,
            hadCredentials
        };
    } catch {
        // Keep best-effort behavior for uncommon proxy formats.
        return { proxyServer: normalized, hadCredentials: false };
    }
}

function findBrowserExecutable(explicitBinary = '') {
    const explicit = normalizeString(explicitBinary);
    const candidates = explicit ? [explicit] : DEFAULT_BROWSER_BINARIES;

    for (const candidate of candidates) {
        try {
            const out = spawnSync('which', [candidate], { encoding: 'utf8' });
            if (out.status === 0) {
                const resolved = normalizeString(out.stdout);
                if (resolved) {
                    return resolved.split('\n')[0].trim();
                }
            }
        } catch {}
    }
    return null;
}

function buildCommandFromTemplate(template, vars) {
    const render = String(template || '')
        .replaceAll('{url}', shellEscape(vars.url || ''))
        .replaceAll('{profileDir}', shellEscape(vars.profileDir || ''))
        .replaceAll('{proxyUrl}', shellEscape(vars.proxyUrl || ''))
        .replaceAll('{providerType}', shellEscape(vars.providerType || ''))
        .replaceAll('{uuid}', shellEscape(vars.uuid || ''))
        .replaceAll('{url_raw}', vars.url || '')
        .replaceAll('{profileDir_raw}', vars.profileDir || '')
        .replaceAll('{proxyUrl_raw}', vars.proxyUrl || '')
        .replaceAll('{providerType_raw}', vars.providerType || '')
        .replaceAll('{uuid_raw}', vars.uuid || '');

    return render.trim();
}

async function spawnDetachedViaShell(command) {
    const child = spawn('/bin/bash', ['-lc', command], {
        detached: true,
        stdio: 'ignore',
        env: process.env
    });
    child.unref();
    return child;
}

async function spawnDetachedDirect(executable, args = []) {
    const child = spawn(executable, args, {
        detached: true,
        stdio: 'ignore',
        env: process.env
    });
    child.unref();
    return child;
}

export async function ensureLocalBrowserProfileDir({
    baseDir = 'configs/browser-profiles',
    providerType,
    uuid
} = {}) {
    if (!providerType || !uuid) {
        throw new Error('providerType and uuid are required');
    }
    const profileDir = resolveProfileDir(baseDir, providerType, uuid);
    await fs.mkdir(profileDir, { recursive: true });
    return profileDir;
}

export async function openLocalBrowser({
    providerType,
    uuid,
    url = '',
    profileDir,
    proxyUrl = '',
    commandTemplate = '',
    browserBinary = '',
    extraArgs = ''
} = {}) {
    const normalizedUrl = normalizeString(url);
    const normalizedProfileDir = normalizeString(profileDir);
    const normalizedProxyUrl = normalizeString(proxyUrl);
    const normalizedTemplate = normalizeString(commandTemplate);

    if (!providerType || !uuid) {
        throw new Error('providerType and uuid are required');
    }
    if (!normalizedProfileDir) {
        throw new Error('profileDir is required');
    }

    const chromiumProxy = buildChromiumProxyServer(normalizedProxyUrl);

    if (normalizedTemplate) {
        const command = buildCommandFromTemplate(normalizedTemplate, {
            providerType,
            uuid,
            url: normalizedUrl,
            profileDir: normalizedProfileDir,
            proxyUrl: normalizedProxyUrl
        });
        if (!command) {
            throw new Error('LOCAL_BROWSER_OPEN_COMMAND rendered to empty command');
        }

        const child = await spawnDetachedViaShell(command);
        logger.info(`[IsolatedBrowser] Opened local browser via template for ${providerType}/${uuid}`);
        return {
            mode: 'template',
            command,
            pid: child.pid || null
        };
    }

    const executable = findBrowserExecutable(browserBinary);
    if (!executable) {
        throw new Error(
            'Chromium/Chrome binary not found. Set LOCAL_BROWSER_BINARY or LOCAL_BROWSER_OPEN_COMMAND.'
        );
    }

    const args = [
        `--user-data-dir=${normalizedProfileDir}`,
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--proxy-bypass-list=<-loopback>'
    ];

    if (chromiumProxy.proxyServer) {
        args.push(`--proxy-server=${chromiumProxy.proxyServer}`);
    }

    if (chromiumProxy.hadCredentials) {
        logger.warn(
            '[IsolatedBrowser] Chromium does not accept proxy credentials in --proxy-server. ' +
            'Using host:port; browser may prompt for proxy auth.'
        );
    }

    args.push(...splitCommandLineArgs(extraArgs));
    if (normalizedUrl) {
        args.push(normalizedUrl);
    }

    const child = await spawnDetachedDirect(executable, args);
    logger.info(`[IsolatedBrowser] Opened local browser via ${executable} for ${providerType}/${uuid}`);
    return {
        mode: 'direct',
        executable,
        args,
        proxyServer: chromiumProxy.proxyServer || '',
        proxyCredentialsStripped: chromiumProxy.hadCredentials === true,
        pid: child.pid || null
    };
}
