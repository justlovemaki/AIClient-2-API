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

function parseProxyForChromium(proxyUrl) {
    const normalized = normalizeProxyInput(proxyUrl);
    if (!normalized) {
        return { proxyServer: '', hadCredentials: false, username: '', password: '' };
    }

    try {
        const parsed = new URL(normalized);
        const protocol = (parsed.protocol || 'http:').replace(/:$/, '');
        const host = parsed.hostname;
        const port = parsed.port ? `:${parsed.port}` : '';
        const username = parsed.username || '';
        const password = parsed.password || '';
        const hadCredentials = Boolean(username || password);
        if (!host) {
            return { proxyServer: normalized, hadCredentials: false, username: '', password: '' };
        }
        return {
            proxyServer: `${protocol}://${host}${port}`,
            hadCredentials,
            username,
            password
        };
    } catch {
        // Keep best-effort behavior for uncommon proxy formats.
        return { proxyServer: normalized, hadCredentials: false, username: '', password: '' };
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

async function ensureProxyAuthExtension(profileDir, username, password) {
    const safeProfileDir = normalizeString(profileDir);
    if (!safeProfileDir) {
        throw new Error('profileDir is required for proxy auth extension');
    }
    if (!username || !password) {
        throw new Error('username/password required for proxy auth extension');
    }

    const extDir = path.join(safeProfileDir, '.aiclient-proxy-auth-ext');
    await fs.mkdir(extDir, { recursive: true, mode: 0o700 });

    const manifest = {
        manifest_version: 2,
        name: 'AIClient Proxy Auth',
        version: '1.0.0',
        permissions: [
            'webRequest',
            'webRequestBlocking',
            '<all_urls>'
        ],
        background: {
            scripts: ['background.js']
        }
    };

    // NOTE: Chromium does not accept credentials in --proxy-server, so we provide them via onAuthRequired.
    // This is intentionally scoped to the isolated profile directory, and never logged.
    const backgroundJs = `
chrome.webRequest.onAuthRequired.addListener(
  function(details) {
    return { authCredentials: { username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} } };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
`.trimStart();

    await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
        encoding: 'utf8',
        mode: 0o600
    });
    await fs.writeFile(path.join(extDir, 'background.js'), backgroundJs, {
        encoding: 'utf8',
        mode: 0o600
    });

    return extDir;
}

async function spawnDetachedViaShell(command) {
    // Use /bin/sh for compatibility (Alpine images don't ship bash by default).
    const child = spawn('/bin/sh', ['-c', command], {
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

    const chromiumProxy = parseProxyForChromium(normalizedProxyUrl);

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
        '--disable-dev-shm-usage',
        '--proxy-bypass-list=<-loopback>'
    ];

    // Chromium sandbox won't start as root in containers unless additional kernel features
    // are configured. Default to --no-sandbox when running as root on Linux.
    try {
        if (
            process.platform === 'linux' &&
            typeof process.getuid === 'function' &&
            process.getuid() === 0
        ) {
            args.push('--no-sandbox');
        }
    } catch {}

    if (chromiumProxy.proxyServer) {
        args.push(`--proxy-server=${chromiumProxy.proxyServer}`);
    }

    let proxyAuthInjected = false;
    if (chromiumProxy.hadCredentials) {
        try {
            const extDir = await ensureProxyAuthExtension(
                normalizedProfileDir,
                chromiumProxy.username,
                chromiumProxy.password
            );
            args.push(`--disable-extensions-except=${extDir}`);
            args.push(`--load-extension=${extDir}`);
            proxyAuthInjected = true;
            logger.info('[IsolatedBrowser] Proxy credentials detected; injected proxy-auth extension for Chromium profile.');
        } catch (e) {
            logger.warn(
                '[IsolatedBrowser] Chromium proxy credentials detected, but proxy-auth extension setup failed. ' +
                `Browser may prompt for proxy auth. (${e.message})`
            );
        }
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
        proxyAuthInjected,
        pid: child.pid || null
    };
}
