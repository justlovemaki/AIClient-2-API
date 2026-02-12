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

    if (normalizedProxyUrl) {
        args.push(`--proxy-server=${normalizedProxyUrl}`);
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
        pid: child.pid || null
    };
}
