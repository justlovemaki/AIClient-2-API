import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { auditSecurityEvent } from './plugin-security.js';

const require = createRequire(import.meta.url);
const fs = require('fs');
const cp = require('child_process');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const workerThreads = require('worker_threads');
const cluster = require('cluster');
const vm = require('vm');
const inspector = require('inspector');
const { syncBuiltinESMExports } = require('module');

const SENSITIVE_READ_PATTERNS = [
    /(^|[\\/])\.env(\.|$)/i,
    /(^|[\\/])pwd$/i,
    /token/i,
    /oauth/i,
    /creds?/i,
    /credentials?/i,
    /provider_pools\.json$/i,
    /config\.json$/i
];

const origRealpathSync = fs.realpathSync;
const origExistsSync = fs.existsSync;
const origStatSync = fs.statSync;

function normalizeFsPath(targetPath) {
    if (targetPath instanceof URL) {
        return fileURLToPath(targetPath);
    }
    if (Buffer.isBuffer(targetPath)) {
        return targetPath.toString();
    }
    return String(targetPath);
}

// Helper to check if caller stack trace belongs to a plugin
function getPluginStack() {
    const err = new Error();
    const stack = err.stack || '';
    const lines = stack.split('\n');
    for (const line of lines) {
        if (line.includes('node:internal') || line.includes('node:')) continue;
        if (line.includes('plugin-installer.js') || line.includes('plugin-manager.js') || line.includes('security-hardening.js')) continue;
        
        if (/src[\\/]plugins(-user)?[\\/]/.test(line)) {
            return stack;
        }
    }
    return null;
}

function getPluginContext(stack) {
    if (!stack) return null;
    const lines = stack.split('\n');
    for (const line of lines) {
        if (line.includes('node:internal') || line.includes('node:')) continue;
        if (line.includes('plugin-installer.js') || line.includes('plugin-manager.js') || line.includes('security-hardening.js')) continue;

        const match = line.match(/src[\\/](plugins|plugins-user)[\\/]([^\\/]+)/);
        if (match) {
            return {
                pluginDirType: match[1],
                pluginId: match[2],
                isUserPlugin: match[1] === 'plugins-user',
                baseDir: path.resolve(process.cwd(), 'src', match[1], match[2])
            };
        }
    }
    return null;
}

function isInsidePath(basePath, targetPath) {
    const relativePath = path.relative(basePath, targetPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getNearestExistingPath(targetPath) {
    let current = path.resolve(normalizeFsPath(targetPath));
    while (!origExistsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) return current;
        current = parent;
    }
    return current;
}

function resolvePhysicalParent(targetPath) {
    const resolvedTarget = path.resolve(normalizeFsPath(targetPath));
    const parentPath = path.dirname(resolvedTarget);
    const existingParent = getNearestExistingPath(parentPath);
    try {
        return origRealpathSync(existingParent);
    } catch {
        return path.resolve(existingParent);
    }
}

function isSensitiveReadPath(targetPath) {
    const normalized = path.resolve(normalizeFsPath(targetPath));
    return SENSITIVE_READ_PATTERNS.some(pattern => pattern.test(normalized));
}

// Helper to verify if path is allowed (configs/, logs/ or plugin's own folder)
function isPathAllowed(targetPath, stack) {
    const resolvedTarget = path.resolve(normalizeFsPath(targetPath));
    const physicalParent = resolvePhysicalParent(resolvedTarget);
    
    // 1. Allow the global configs directory
    const configsDir = path.resolve(process.cwd(), 'configs');
    const physicalConfigsDir = origExistsSync(configsDir) ? origRealpathSync(configsDir) : configsDir;
    if (isInsidePath(configsDir, resolvedTarget) && isInsidePath(physicalConfigsDir, physicalParent)) {
        return true;
    }

    // 2. Allow the global logs directory. Plugin-triggered logging still runs through
    // logger in the host process, and log rotation performs fs.statSync/writeStream.
    const logsDir = path.resolve(process.cwd(), 'logs');
    const physicalLogsDir = origExistsSync(logsDir) ? origRealpathSync(logsDir) : logsDir;
    if (isInsidePath(logsDir, resolvedTarget) && isInsidePath(physicalLogsDir, physicalParent)) {
        return true;
    }
    
    // 3. Allow the plugin's own directory
    const pluginContext = getPluginContext(stack);
    if (pluginContext) {
        const physicalPluginDir = origExistsSync(pluginContext.baseDir) ? origRealpathSync(pluginContext.baseDir) : pluginContext.baseDir;
        if (isInsidePath(pluginContext.baseDir, resolvedTarget) && isInsidePath(physicalPluginDir, physicalParent)) {
            return true;
        }
    }
    
    return false;
}

// Helper to check if fs.open flags are for writing
function isWriteFlag(flags) {
    if (typeof flags === 'number') {
        // In Node.js, O_RDONLY is 0. Any other flags usually mean writing/appending/etc.
        return flags !== 0;
    }
    if (typeof flags === 'string') {
        const lower = flags.toLowerCase();
        return lower.includes('w') || lower.includes('a') || lower.includes('+');
    }
    return false;
}

function isReadFlag(flags) {
    if (typeof flags === 'number') {
        return true;
    }
    if (typeof flags === 'string') {
        const lower = flags.toLowerCase();
        return lower.includes('r') || lower.includes('+');
    }
    return true;
}

function auditDeniedAttempt(stack, operationName, target, reason) {
    const pluginContext = getPluginContext(stack);
    auditSecurityEvent({
        type: 'plugin_security_denied',
        plugin: pluginContext?.pluginId || 'unknown',
        pluginDirType: pluginContext?.pluginDirType || 'unknown',
        operation: operationName,
        target: String(target),
        reason
    });
}

// Intercept write attempts
function handleWriteAttempt(targetPath, operationName) {
    const stack = getPluginStack();
    if (stack) {
        if (!isPathAllowed(targetPath, stack)) {
            auditDeniedAttempt(stack, operationName, targetPath, 'write_outside_allowed_paths');
            throw new Error(`[Security Hardening] Permission Denied: Plugins are not allowed to write/modify files outside of 'configs' or their own directory during '${operationName}' (Target: ${targetPath})`);
        }
    }
}

function handleReadAttempt(targetPath, operationName) {
    const stack = getPluginStack();
    if (!stack) return;

    const pluginContext = getPluginContext(stack);
    if (pluginContext?.isUserPlugin && isSensitiveReadPath(targetPath)) {
        auditDeniedAttempt(stack, operationName, targetPath, 'sensitive_read');
        throw new Error(`[Security Hardening] Permission Denied: User plugins are not allowed to read sensitive files during '${operationName}' (Target: ${targetPath})`);
    }

    if (!isPathAllowed(targetPath, stack)) {
        auditDeniedAttempt(stack, operationName, targetPath, 'read_outside_allowed_paths');
        throw new Error(`[Security Hardening] Permission Denied: Plugins are not allowed to read files outside of 'configs' or their own directory during '${operationName}' (Target: ${targetPath})`);
    }
}

// Intercept execution attempts
function handleExecutionAttempt(command, operationName) {
    const stack = getPluginStack();
    if (stack) {
        auditDeniedAttempt(stack, operationName, command, 'process_execution');
        throw new Error(`[Security Hardening] Permission Denied: Plugins are strictly prohibited from executing system commands or processes (Operation: ${operationName}, Command: ${command})`);
    }
}

function handleForbiddenAttempt(target, operationName) {
    const stack = getPluginStack();
    if (stack) {
        auditDeniedAttempt(stack, operationName, target, 'forbidden_api');
        throw new Error(`[Security Hardening] Permission Denied: Plugins are not allowed to use '${operationName}' (Target: ${target})`);
    }
}

function handleNetworkAttempt(target, operationName) {
    const stack = getPluginStack();
    if (stack) {
        auditDeniedAttempt(stack, operationName, target, 'network');
        throw new Error(`[Security Hardening] Permission Denied: Plugins are not allowed to initiate network connections (Operation: ${operationName}, Target: ${target})`);
    }
}

function handleProcessControlAttempt(target, operationName) {
    const stack = getPluginStack();
    if (stack) {
        auditDeniedAttempt(stack, operationName, target, 'process_control');
        throw new Error(`[Security Hardening] Permission Denied: Plugins are not allowed to control the host process (Operation: ${operationName}, Target: ${target})`);
    }
}

function handleUserPluginProcessMutationAttempt(target, operationName) {
    const stack = getPluginStack();
    const pluginContext = getPluginContext(stack);
    if (pluginContext?.isUserPlugin) {
        auditDeniedAttempt(stack, operationName, target, 'process_global_mutation');
        throw new Error(`[Security Hardening] Permission Denied: User plugins are not allowed to mutate process-global state (Operation: ${operationName}, Target: ${target})`);
    }
}

// --- Monkey-patch fs functions ---

const origReadFile = fs.readFile;
fs.readFile = function (file, ...args) {
    handleReadAttempt(file, 'fs.readFile');
    return origReadFile.call(this, file, ...args);
};

const origReadFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
    handleReadAttempt(file, 'fs.readFileSync');
    return origReadFileSync.call(this, file, ...args);
};

const origCreateReadStream = fs.createReadStream;
fs.createReadStream = function (path, ...args) {
    handleReadAttempt(path, 'fs.createReadStream');
    return origCreateReadStream.call(this, path, ...args);
};

const origReaddir = fs.readdir;
fs.readdir = function (path, ...args) {
    handleReadAttempt(path, 'fs.readdir');
    return origReaddir.call(this, path, ...args);
};

const origReaddirSync = fs.readdirSync;
fs.readdirSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.readdirSync');
    return origReaddirSync.call(this, path, ...args);
};

const origStat = fs.stat;
fs.stat = function (path, ...args) {
    handleReadAttempt(path, 'fs.stat');
    return origStat.call(this, path, ...args);
};

fs.statSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.statSync');
    return origStatSync.call(this, path, ...args);
};

const origLstat = fs.lstat;
fs.lstat = function (path, ...args) {
    handleReadAttempt(path, 'fs.lstat');
    return origLstat.call(this, path, ...args);
};

const origLstatSync = fs.lstatSync;
fs.lstatSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.lstatSync');
    return origLstatSync.call(this, path, ...args);
};

const origRealpath = fs.realpath;
fs.realpath = function (path, ...args) {
    handleReadAttempt(path, 'fs.realpath');
    return origRealpath.call(this, path, ...args);
};

fs.realpathSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.realpathSync');
    return origRealpathSync.call(this, path, ...args);
};

const origReadlink = fs.readlink;
fs.readlink = function (path, ...args) {
    handleReadAttempt(path, 'fs.readlink');
    return origReadlink.call(this, path, ...args);
};

const origReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.readlinkSync');
    return origReadlinkSync.call(this, path, ...args);
};

const origOpendir = fs.opendir;
fs.opendir = function (path, ...args) {
    handleReadAttempt(path, 'fs.opendir');
    return origOpendir.call(this, path, ...args);
};

const origOpendirSync = fs.opendirSync;
fs.opendirSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.opendirSync');
    return origOpendirSync.call(this, path, ...args);
};

const origAccess = fs.access;
fs.access = function (path, ...args) {
    handleReadAttempt(path, 'fs.access');
    return origAccess.call(this, path, ...args);
};

const origAccessSync = fs.accessSync;
fs.accessSync = function (path, ...args) {
    handleReadAttempt(path, 'fs.accessSync');
    return origAccessSync.call(this, path, ...args);
};

const origWriteFile = fs.writeFile;
fs.writeFile = function (file, ...args) {
    handleWriteAttempt(file, 'fs.writeFile');
    return origWriteFile.call(this, file, ...args);
};

const origWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
    handleWriteAttempt(file, 'fs.writeFileSync');
    return origWriteFileSync.call(this, file, ...args);
};

const origAppendFile = fs.appendFile;
fs.appendFile = function (file, ...args) {
    handleWriteAttempt(file, 'fs.appendFile');
    return origAppendFile.call(this, file, ...args);
};

const origAppendFileSync = fs.appendFileSync;
fs.appendFileSync = function (file, ...args) {
    handleWriteAttempt(file, 'fs.appendFileSync');
    return origAppendFileSync.call(this, file, ...args);
};

const origCreateWriteStream = fs.createWriteStream;
fs.createWriteStream = function (path, ...args) {
    handleWriteAttempt(path, 'fs.createWriteStream');
    return origCreateWriteStream.call(this, path, ...args);
};

const origOpen = fs.open;
fs.open = function (path, flags, ...args) {
    if (isReadFlag(flags)) {
        handleReadAttempt(path, 'fs.open');
    }
    if (isWriteFlag(flags)) {
        handleWriteAttempt(path, 'fs.open');
    }
    return origOpen.call(this, path, flags, ...args);
};

const origOpenSync = fs.openSync;
fs.openSync = function (path, flags, ...args) {
    if (isReadFlag(flags)) {
        handleReadAttempt(path, 'fs.openSync');
    }
    if (isWriteFlag(flags)) {
        handleWriteAttempt(path, 'fs.openSync');
    }
    return origOpenSync.call(this, path, flags, ...args);
};

const origCopyFile = fs.copyFile;
fs.copyFile = function (src, dest, ...args) {
    handleReadAttempt(src, 'fs.copyFile');
    handleWriteAttempt(dest, 'fs.copyFile');
    return origCopyFile.call(this, src, dest, ...args);
};

const origCopyFileSync = fs.copyFileSync;
fs.copyFileSync = function (src, dest, ...args) {
    handleReadAttempt(src, 'fs.copyFileSync');
    handleWriteAttempt(dest, 'fs.copyFileSync');
    return origCopyFileSync.call(this, src, dest, ...args);
};

const origRename = fs.rename;
fs.rename = function (oldPath, newPath, ...args) {
    handleWriteAttempt(oldPath, 'fs.rename');
    handleWriteAttempt(newPath, 'fs.rename');
    return origRename.call(this, oldPath, newPath, ...args);
};

const origRenameSync = fs.renameSync;
fs.renameSync = function (oldPath, newPath, ...args) {
    handleWriteAttempt(oldPath, 'fs.renameSync');
    handleWriteAttempt(newPath, 'fs.renameSync');
    return origRenameSync.call(this, oldPath, newPath, ...args);
};

const origCp = fs.cp;
if (origCp) {
    fs.cp = function (src, dest, ...args) {
        handleReadAttempt(src, 'fs.cp');
        handleWriteAttempt(dest, 'fs.cp');
        return origCp.call(this, src, dest, ...args);
    };
}

const origCpSync = fs.cpSync;
if (origCpSync) {
    fs.cpSync = function (src, dest, ...args) {
        handleReadAttempt(src, 'fs.cpSync');
        handleWriteAttempt(dest, 'fs.cpSync');
        return origCpSync.call(this, src, dest, ...args);
    };
}

const origMkdir = fs.mkdir;
fs.mkdir = function (path, ...args) {
    handleWriteAttempt(path, 'fs.mkdir');
    return origMkdir.call(this, path, ...args);
};

const origMkdirSync = fs.mkdirSync;
fs.mkdirSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.mkdirSync');
    return origMkdirSync.call(this, path, ...args);
};

const origMkdtemp = fs.mkdtemp;
fs.mkdtemp = function (prefix, ...args) {
    handleWriteAttempt(prefix, 'fs.mkdtemp');
    return origMkdtemp.call(this, prefix, ...args);
};

const origMkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = function (prefix, ...args) {
    handleWriteAttempt(prefix, 'fs.mkdtempSync');
    return origMkdtempSync.call(this, prefix, ...args);
};

const origUnlink = fs.unlink;
fs.unlink = function (path, ...args) {
    handleWriteAttempt(path, 'fs.unlink');
    return origUnlink.call(this, path, ...args);
};

const origUnlinkSync = fs.unlinkSync;
fs.unlinkSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.unlinkSync');
    return origUnlinkSync.call(this, path, ...args);
};

const origRm = fs.rm;
if (origRm) {
    fs.rm = function (path, ...args) {
        handleWriteAttempt(path, 'fs.rm');
        return origRm.call(this, path, ...args);
    };
}

const origRmSync = fs.rmSync;
if (origRmSync) {
    fs.rmSync = function (path, ...args) {
        handleWriteAttempt(path, 'fs.rmSync');
        return origRmSync.call(this, path, ...args);
    };
}

const origRmdir = fs.rmdir;
fs.rmdir = function (path, ...args) {
    handleWriteAttempt(path, 'fs.rmdir');
    return origRmdir.call(this, path, ...args);
};

const origRmdirSync = fs.rmdirSync;
fs.rmdirSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.rmdirSync');
    return origRmdirSync.call(this, path, ...args);
};

const origTruncate = fs.truncate;
fs.truncate = function (path, ...args) {
    handleWriteAttempt(path, 'fs.truncate');
    return origTruncate.call(this, path, ...args);
};

const origTruncateSync = fs.truncateSync;
fs.truncateSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.truncateSync');
    return origTruncateSync.call(this, path, ...args);
};

const origChmod = fs.chmod;
fs.chmod = function (path, ...args) {
    handleWriteAttempt(path, 'fs.chmod');
    return origChmod.call(this, path, ...args);
};

const origChmodSync = fs.chmodSync;
fs.chmodSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.chmodSync');
    return origChmodSync.call(this, path, ...args);
};

const origChown = fs.chown;
fs.chown = function (path, ...args) {
    handleWriteAttempt(path, 'fs.chown');
    return origChown.call(this, path, ...args);
};

const origChownSync = fs.chownSync;
fs.chownSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.chownSync');
    return origChownSync.call(this, path, ...args);
};

const origUtimes = fs.utimes;
fs.utimes = function (path, ...args) {
    handleWriteAttempt(path, 'fs.utimes');
    return origUtimes.call(this, path, ...args);
};

const origUtimesSync = fs.utimesSync;
fs.utimesSync = function (path, ...args) {
    handleWriteAttempt(path, 'fs.utimesSync');
    return origUtimesSync.call(this, path, ...args);
};

const origSymlink = fs.symlink;
fs.symlink = function (target, path, ...args) {
    handleForbiddenAttempt(path, 'fs.symlink');
    return origSymlink.call(this, target, path, ...args);
};

const origSymlinkSync = fs.symlinkSync;
fs.symlinkSync = function (target, path, ...args) {
    handleForbiddenAttempt(path, 'fs.symlinkSync');
    return origSymlinkSync.call(this, target, path, ...args);
};

const origLink = fs.link;
fs.link = function (existingPath, newPath, ...args) {
    handleForbiddenAttempt(newPath, 'fs.link');
    return origLink.call(this, existingPath, newPath, ...args);
};

const origLinkSync = fs.linkSync;
fs.linkSync = function (existingPath, newPath, ...args) {
    handleForbiddenAttempt(newPath, 'fs.linkSync');
    return origLinkSync.call(this, existingPath, newPath, ...args);
};

const origWatch = fs.watch;
fs.watch = function (filename, ...args) {
    handleReadAttempt(filename, 'fs.watch');
    return origWatch.call(this, filename, ...args);
};

const origWatchFile = fs.watchFile;
fs.watchFile = function (filename, ...args) {
    handleReadAttempt(filename, 'fs.watchFile');
    return origWatchFile.call(this, filename, ...args);
};

// --- Monkey-patch fs/promises ---

const fspPromises = fs.promises;
if (fspPromises) {
    const origFspReadFile = fspPromises.readFile;
    fspPromises.readFile = function (file, ...args) {
        handleReadAttempt(file, 'fs.promises.readFile');
        return origFspReadFile.call(this, file, ...args);
    };

    const origFspReaddir = fspPromises.readdir;
    fspPromises.readdir = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.readdir');
        return origFspReaddir.call(this, path, ...args);
    };

    const origFspStat = fspPromises.stat;
    fspPromises.stat = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.stat');
        return origFspStat.call(this, path, ...args);
    };

    const origFspLstat = fspPromises.lstat;
    fspPromises.lstat = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.lstat');
        return origFspLstat.call(this, path, ...args);
    };

    const origFspRealpath = fspPromises.realpath;
    fspPromises.realpath = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.realpath');
        return origFspRealpath.call(this, path, ...args);
    };

    const origFspReadlink = fspPromises.readlink;
    fspPromises.readlink = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.readlink');
        return origFspReadlink.call(this, path, ...args);
    };

    const origFspOpendir = fspPromises.opendir;
    fspPromises.opendir = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.opendir');
        return origFspOpendir.call(this, path, ...args);
    };

    const origFspAccess = fspPromises.access;
    fspPromises.access = function (path, ...args) {
        handleReadAttempt(path, 'fs.promises.access');
        return origFspAccess.call(this, path, ...args);
    };

    const origFspWriteFile = fspPromises.writeFile;
    fspPromises.writeFile = function (file, ...args) {
        handleWriteAttempt(file, 'fs.promises.writeFile');
        return origFspWriteFile.call(this, file, ...args);
    };

    const origFspAppendFile = fspPromises.appendFile;
    fspPromises.appendFile = function (file, ...args) {
        handleWriteAttempt(file, 'fs.promises.appendFile');
        return origFspAppendFile.call(this, file, ...args);
    };

    const origFspOpen = fspPromises.open;
    fspPromises.open = function (path, flags, ...args) {
        if (isReadFlag(flags)) {
            handleReadAttempt(path, 'fs.promises.open');
        }
        if (isWriteFlag(flags)) {
            handleWriteAttempt(path, 'fs.promises.open');
        }
        return origFspOpen.call(this, path, flags, ...args);
    };

    const origFspCopyFile = fspPromises.copyFile;
    fspPromises.copyFile = function (src, dest, ...args) {
        handleReadAttempt(src, 'fs.promises.copyFile');
        handleWriteAttempt(dest, 'fs.promises.copyFile');
        return origFspCopyFile.call(this, src, dest, ...args);
    };

    const origFspRename = fspPromises.rename;
    fspPromises.rename = function (oldPath, newPath, ...args) {
        handleWriteAttempt(oldPath, 'fs.promises.rename');
        handleWriteAttempt(newPath, 'fs.promises.rename');
        return origFspRename.call(this, oldPath, newPath, ...args);
    };

    const origFspCp = fspPromises.cp;
    if (origFspCp) {
        fspPromises.cp = function (src, dest, ...args) {
            handleReadAttempt(src, 'fs.promises.cp');
            handleWriteAttempt(dest, 'fs.promises.cp');
            return origFspCp.call(this, src, dest, ...args);
        };
    }

    const origFspMkdir = fspPromises.mkdir;
    fspPromises.mkdir = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.mkdir');
        return origFspMkdir.call(this, path, ...args);
    };

    const origFspMkdtemp = fspPromises.mkdtemp;
    fspPromises.mkdtemp = function (prefix, ...args) {
        handleWriteAttempt(prefix, 'fs.promises.mkdtemp');
        return origFspMkdtemp.call(this, prefix, ...args);
    };

    const origFspUnlink = fspPromises.unlink;
    fspPromises.unlink = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.unlink');
        return origFspUnlink.call(this, path, ...args);
    };

    const origFspRm = fspPromises.rm;
    if (origFspRm) {
        fspPromises.rm = function (path, ...args) {
            handleWriteAttempt(path, 'fs.promises.rm');
            return origFspRm.call(this, path, ...args);
        };
    }

    const origFspRmdir = fspPromises.rmdir;
    fspPromises.rmdir = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.rmdir');
        return origFspRmdir.call(this, path, ...args);
    };

    const origFspTruncate = fspPromises.truncate;
    fspPromises.truncate = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.truncate');
        return origFspTruncate.call(this, path, ...args);
    };

    const origFspChmod = fspPromises.chmod;
    fspPromises.chmod = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.chmod');
        return origFspChmod.call(this, path, ...args);
    };

    const origFspChown = fspPromises.chown;
    fspPromises.chown = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.chown');
        return origFspChown.call(this, path, ...args);
    };

    const origFspUtimes = fspPromises.utimes;
    fspPromises.utimes = function (path, ...args) {
        handleWriteAttempt(path, 'fs.promises.utimes');
        return origFspUtimes.call(this, path, ...args);
    };

    const origFspSymlink = fspPromises.symlink;
    fspPromises.symlink = function (target, path, ...args) {
        handleForbiddenAttempt(path, 'fs.promises.symlink');
        return origFspSymlink.call(this, target, path, ...args);
    };

    const origFspLink = fspPromises.link;
    fspPromises.link = function (existingPath, newPath, ...args) {
        handleForbiddenAttempt(newPath, 'fs.promises.link');
        return origFspLink.call(this, existingPath, newPath, ...args);
    };
}

// --- Monkey-patch child_process ---

const origSpawn = cp.spawn;
cp.spawn = function (command, ...args) {
    handleExecutionAttempt(command, 'child_process.spawn');
    return origSpawn.call(this, command, ...args);
};

const origSpawnSync = cp.spawnSync;
cp.spawnSync = function (command, ...args) {
    handleExecutionAttempt(command, 'child_process.spawnSync');
    return origSpawnSync.call(this, command, ...args);
};

const origExec = cp.exec;
cp.exec = function (command, ...args) {
    handleExecutionAttempt(command, 'child_process.exec');
    return origExec.call(this, command, ...args);
};

const origExecSync = cp.execSync;
cp.execSync = function (command, ...args) {
    handleExecutionAttempt(command, 'child_process.execSync');
    return origExecSync.call(this, command, ...args);
};

const origExecFile = cp.execFile;
cp.execFile = function (file, ...args) {
    handleExecutionAttempt(file, 'child_process.execFile');
    return origExecFile.call(this, file, ...args);
};

const origExecFileSync = cp.execFileSync;
cp.execFileSync = function (file, ...args) {
    handleExecutionAttempt(file, 'child_process.execFileSync');
    return origExecFileSync.call(this, file, ...args);
};

const origFork = cp.fork;
cp.fork = function (modulePath, ...args) {
    handleExecutionAttempt(modulePath, 'child_process.fork');
    return origFork.call(this, modulePath, ...args);
};

// --- Monkey-patch network APIs ---

const origHttpRequest = http.request;
http.request = function (...args) {
    handleNetworkAttempt(args[0]?.href || args[0]?.hostname || args[0], 'http.request');
    return origHttpRequest.apply(this, args);
};

const origHttpGet = http.get;
http.get = function (...args) {
    handleNetworkAttempt(args[0]?.href || args[0]?.hostname || args[0], 'http.get');
    return origHttpGet.apply(this, args);
};

const origHttpsRequest = https.request;
https.request = function (...args) {
    handleNetworkAttempt(args[0]?.href || args[0]?.hostname || args[0], 'https.request');
    return origHttpsRequest.apply(this, args);
};

const origHttpsGet = https.get;
https.get = function (...args) {
    handleNetworkAttempt(args[0]?.href || args[0]?.hostname || args[0], 'https.get');
    return origHttpsGet.apply(this, args);
};

const origNetConnect = net.connect;
net.connect = function (...args) {
    handleNetworkAttempt(args[0]?.host || args[0], 'net.connect');
    return origNetConnect.apply(this, args);
};
net.createConnection = net.connect;

const origTlsConnect = tls.connect;
tls.connect = function (...args) {
    handleNetworkAttempt(args[0]?.host || args[0], 'tls.connect');
    return origTlsConnect.apply(this, args);
};

const origDgramCreateSocket = dgram.createSocket;
dgram.createSocket = function (...args) {
    handleNetworkAttempt(args[0], 'dgram.createSocket');
    return origDgramCreateSocket.apply(this, args);
};

if (globalThis.fetch) {
    const origFetch = globalThis.fetch;
    globalThis.fetch = function (...args) {
        handleNetworkAttempt(args[0]?.url || args[0], 'global.fetch');
        return origFetch.apply(this, args);
    };
}

// --- Monkey-patch dangerous runtime APIs ---

const origWorker = workerThreads.Worker;
workerThreads.Worker = function (filename, ...args) {
    handleForbiddenAttempt(filename, 'worker_threads.Worker');
    return new origWorker(filename, ...args);
};

const origClusterFork = cluster.fork;
if (origClusterFork) {
    cluster.fork = function (...args) {
        handleForbiddenAttempt('cluster.fork', 'cluster.fork');
        return origClusterFork.apply(this, args);
    };
}

const origVmRunInThisContext = vm.runInThisContext;
vm.runInThisContext = function (code, ...args) {
    handleForbiddenAttempt('vm.runInThisContext', 'vm.runInThisContext');
    return origVmRunInThisContext.call(this, code, ...args);
};

const origVmRunInNewContext = vm.runInNewContext;
vm.runInNewContext = function (code, ...args) {
    handleForbiddenAttempt('vm.runInNewContext', 'vm.runInNewContext');
    return origVmRunInNewContext.call(this, code, ...args);
};

const origVmRunInContext = vm.runInContext;
vm.runInContext = function (code, ...args) {
    handleForbiddenAttempt('vm.runInContext', 'vm.runInContext');
    return origVmRunInContext.call(this, code, ...args);
};

const origVmScript = vm.Script;
vm.Script = function (code, ...args) {
    handleForbiddenAttempt('vm.Script', 'vm.Script');
    return new origVmScript(code, ...args);
};

const origInspectorOpen = inspector.open;
inspector.open = function (...args) {
    handleForbiddenAttempt('inspector.open', 'inspector.open');
    return origInspectorOpen.apply(this, args);
};

const origProcessExit = process.exit;
process.exit = function (code) {
    handleProcessControlAttempt(code, 'process.exit');
    return origProcessExit.call(this, code);
};

const origProcessKill = process.kill;
process.kill = function (pid, signal) {
    handleProcessControlAttempt(pid, 'process.kill');
    return origProcessKill.call(this, pid, signal);
};

const origProcessChdir = process.chdir;
process.chdir = function (directory) {
    handleProcessControlAttempt(directory, 'process.chdir');
    return origProcessChdir.call(this, directory);
};

const origProcessOn = process.on;
process.on = function (eventName, ...args) {
    handleUserPluginProcessMutationAttempt(eventName, 'process.on');
    return origProcessOn.call(this, eventName, ...args);
};

const origProcessAddListener = process.addListener;
process.addListener = function (eventName, ...args) {
    handleUserPluginProcessMutationAttempt(eventName, 'process.addListener');
    return origProcessAddListener.call(this, eventName, ...args);
};

const origProcessOnce = process.once;
process.once = function (eventName, ...args) {
    handleUserPluginProcessMutationAttempt(eventName, 'process.once');
    return origProcessOnce.call(this, eventName, ...args);
};

const origProcessPrependListener = process.prependListener;
process.prependListener = function (eventName, ...args) {
    handleUserPluginProcessMutationAttempt(eventName, 'process.prependListener');
    return origProcessPrependListener.call(this, eventName, ...args);
};

const origProcessPrependOnceListener = process.prependOnceListener;
process.prependOnceListener = function (eventName, ...args) {
    handleUserPluginProcessMutationAttempt(eventName, 'process.prependOnceListener');
    return origProcessPrependOnceListener.call(this, eventName, ...args);
};

process.env = new Proxy(process.env, {
    set(target, property, value) {
        handleUserPluginProcessMutationAttempt(`process.env.${String(property)}`, 'process.env.set');
        target[property] = value;
        return true;
    },
    deleteProperty(target, property) {
        handleUserPluginProcessMutationAttempt(`process.env.${String(property)}`, 'process.env.delete');
        return delete target[property];
    },
    defineProperty(target, property, descriptor) {
        handleUserPluginProcessMutationAttempt(`process.env.${String(property)}`, 'process.env.defineProperty');
        return Reflect.defineProperty(target, property, descriptor);
    }
});

syncBuiltinESMExports();

console.log('[Security Hardening] Active: Plugin file write constraints and command execution ban are successfully configured.');
