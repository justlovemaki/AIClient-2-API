import { existsSync, readFileSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CONFIG } from '../core/config-manager.js';
import { parseProxyUrl } from '../utils/proxy-utils.js';

const execAsync = promisify(exec);

/**
 * 获取更新检查使用的代理配置
 * @returns {Object|null} 代理配置对象或 null
 */
function getUpdateProxyConfig() {
    if (!CONFIG || !CONFIG.PROXY_URL) {
        return null;
    }
    
    const proxyConfig = parseProxyUrl(CONFIG.PROXY_URL);
    if (proxyConfig) {
        console.log(`[Update] Using ${proxyConfig.proxyType} proxy for update check: ${CONFIG.PROXY_URL}`);
    }
    return proxyConfig;
}

/**
 * 带代理支持的 fetch 封装
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @returns {Promise<Response>}
 */
async function fetchWithProxy(url, options = {}) {
    const proxyConfig = getUpdateProxyConfig();
    
    if (proxyConfig) {
        // 使用 undici 的 fetch 支持代理
        const fetchOptions = {
            ...options,
            dispatcher: undefined
        };
        
        // 根据 URL 协议选择合适的 agent
        const urlObj = new URL(url);
        if (urlObj.protocol === 'https:') {
            fetchOptions.agent = proxyConfig.httpsAgent;
        } else {
            fetchOptions.agent = proxyConfig.httpAgent;
        }
        
        // Node.js 原生 fetch 不直接支持 agent，需要使用 undici 或 node-fetch
        // 这里使用动态导入 undici 来支持代理
        try {
            const { fetch: undiciFetch, ProxyAgent } = await import('undici');
            const proxyAgent = new ProxyAgent(CONFIG.PROXY_URL);
            return await undiciFetch(url, {
                ...options,
                dispatcher: proxyAgent
            });
        } catch (importError) {
            // 如果 undici 不可用，回退到原生 fetch（不使用代理）
            console.warn('[Update] undici not available, falling back to native fetch without proxy');
            return await fetch(url, options);
        }
    }
    
    return await fetch(url, options);
}

/**
 * 比较版本号
 * @param {string} v1 - 版本号1
 * @param {string} v2 - 版本号2
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
    // 移除 'v' 前缀（如果有）
    const clean1 = v1.replace(/^v/, '');
    const clean2 = v2.replace(/^v/, '');
    
    const parts1 = clean1.split('.').map(Number);
    const parts2 = clean2.split('.').map(Number);
    
    const maxLen = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLen; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;
        
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    
    return 0;
}

/**
 * 通过 GitHub API 获取最新版本
 * @returns {Promise<string|null>} 最新版本号或 null
 */
async function getLatestVersionFromGitHub() {
    const GITHUB_REPO = 'justlovemaki/AIClient-2-API';
    const apiUrl = `https://gh-proxy.org/https://api.github.com/repos/${GITHUB_REPO}/tags`;
    
    try {
        console.log('[Update] Fetching latest version from GitHub API...');
        const response = await fetchWithProxy(apiUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'AIClient2API-UpdateChecker'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
        }
        
        const tags = await response.json();
        
        if (!Array.isArray(tags) || tags.length === 0) {
            return null;
        }
        
        // 提取版本号并排序
        const versions = tags
            .map(tag => tag.name)
            .filter(name => /^v?\d+\.\d+/.test(name)); // 只保留符合版本号格式的 tag
        
        if (versions.length === 0) {
            return null;
        }
        
        // 按版本号排序（降序）
        versions.sort((a, b) => compareVersions(b, a));
        
        return versions[0];
    } catch (error) {
        console.warn('[Update] Failed to fetch from GitHub API:', error.message);
        return null;
    }
}

/**
 * 检查是否有新版本可用
 * 支持两种模式：
 * 1. Git 仓库模式：通过 git 命令获取最新 tag
 * 2. Docker/非 Git 模式：通过 GitHub API 获取最新版本
 * @returns {Promise<Object>} 更新信息
 */
export async function checkForUpdates() {
    const versionFilePath = path.join(process.cwd(), 'VERSION');
    
    // 读取本地版本
    let localVersion = 'unknown';
    try {
        if (existsSync(versionFilePath)) {
            localVersion = readFileSync(versionFilePath, 'utf-8').trim();
        }
    } catch (error) {
        console.warn('[Update] Failed to read local VERSION file:', error.message);
    }
    
    // 检查是否在 git 仓库中
    let isGitRepo = false;
    try {
        await execAsync('git rev-parse --git-dir');
        isGitRepo = true;
    } catch (error) {
        isGitRepo = false;
        console.log('[Update] Not in a Git repository, will use GitHub API to check for updates');
    }
    
    let latestTag = null;
    let updateMethod = 'unknown';
    
    if (isGitRepo) {
        // Git 仓库模式：使用 git 命令
        updateMethod = 'git';
        
        // 获取远程 tags
        try {
            console.log('[Update] Fetching remote tags...');
            await execAsync('git fetch --tags');
        } catch (error) {
            console.warn('[Update] Failed to fetch tags via git, falling back to GitHub API:', error.message);
            // 如果 git fetch 失败，回退到 GitHub API
            latestTag = await getLatestVersionFromGitHub();
            updateMethod = 'github_api';
        }
        
        // 如果 git fetch 成功，获取最新的 tag
        if (!latestTag && updateMethod === 'git') {
            const isWindows = process.platform === 'win32';
            
            try {
                if (isWindows) {
                    // Windows: 使用 git for-each-ref，这是跨平台兼容的方式
                    const { stdout } = await execAsync('git for-each-ref --sort=-v:refname --format="%(refname:short)" refs/tags --count=1');
                    latestTag = stdout.trim();
                } else {
                    // Linux/macOS: 使用 head 命令，更高效
                    const { stdout } = await execAsync('git tag --sort=-v:refname | head -n 1');
                    latestTag = stdout.trim();
                }
            } catch (error) {
                // 备用方案：获取所有 tags 并在 JavaScript 中排序
                try {
                    const { stdout } = await execAsync('git tag');
                    const tags = stdout.trim().split('\n').filter(t => t);
                    if (tags.length > 0) {
                        // 按版本号排序（降序）
                        tags.sort((a, b) => compareVersions(b, a));
                        latestTag = tags[0];
                    }
                } catch (e) {
                    console.warn('[Update] Failed to get latest tag via git, falling back to GitHub API:', e.message);
                    latestTag = await getLatestVersionFromGitHub();
                    updateMethod = 'github_api';
                }
            }
        }
    } else {
        // 非 Git 仓库模式（如 Docker 容器）：使用 GitHub API
        updateMethod = 'github_api';
        latestTag = await getLatestVersionFromGitHub();
    }
    
    if (!latestTag) {
        return {
            hasUpdate: false,
            localVersion,
            latestVersion: null,
            updateMethod,
            error: 'Unable to get latest version information'
        };
    }
    
    // 比较版本
    const comparison = compareVersions(latestTag, localVersion);
    const hasUpdate = comparison > 0;
    
    console.log(`[Update] Local version: ${localVersion}, Latest version: ${latestTag}, Has update: ${hasUpdate}, Method: ${updateMethod}`);
    
    return {
        hasUpdate,
        localVersion,
        latestVersion: latestTag,
        updateMethod,
        error: null
    };
}

/**
 * 执行更新操作
 * @returns {Promise<Object>} 更新结果
 */
export async function performUpdate() {
    // 首先检查是否有更新
    const updateInfo = await checkForUpdates();
    
    if (updateInfo.error) {
        throw new Error(updateInfo.error);
    }
    
    if (!updateInfo.hasUpdate) {
        return {
            success: true,
            message: 'Already at the latest version',
            localVersion: updateInfo.localVersion,
            latestVersion: updateInfo.latestVersion,
            updated: false
        };
    }
    
    const latestTag = updateInfo.latestVersion;
    
    // 检查更新方式 - 如果是通过 GitHub API 获取的版本信息，说明不在 Git 仓库中
    if (updateInfo.updateMethod === 'github_api') {
        // Docker/非 Git 环境，通过下载 tarball 更新
        console.log('[Update] Running in Docker/non-Git environment, will download and extract tarball');
        return await performTarballUpdate(updateInfo.localVersion, latestTag);
    }
    
    console.log(`[Update] Starting update to ${latestTag}...`);
    
    // 检查是否有未提交的更改
    try {
        const { stdout: statusOutput } = await execAsync('git status --porcelain');
        if (statusOutput.trim()) {
            // 有未提交的更改，先 stash
            console.log('[Update] Stashing local changes...');
            await execAsync('git stash');
        }
    } catch (error) {
        console.warn('[Update] Failed to check git status:', error.message);
    }
    
    // 执行 checkout 到最新 tag
    try {
        console.log(`[Update] Checking out to ${latestTag}...`);
        await execAsync(`git checkout ${latestTag}`);
    } catch (error) {
        console.error('[Update] Failed to checkout:', error.message);
        throw new Error('Failed to switch to new version: ' + error.message);
    }
    
    // 更新 VERSION 文件（如果 tag 和 VERSION 文件不同步）
    const versionFilePath = path.join(process.cwd(), 'VERSION');
    try {
        const newVersion = latestTag.replace(/^v/, '');
        writeFileSync(versionFilePath, newVersion, 'utf-8');
        console.log(`[Update] VERSION file updated to ${newVersion}`);
    } catch (error) {
        console.warn('[Update] Failed to update VERSION file:', error.message);
    }
    
    // 检查是否需要安装依赖
    let needsRestart = false;
    try {
        // 确保本地版本号有 v 前缀，以匹配 git tag 格式
        const localVersionTag = updateInfo.localVersion.startsWith('v') ? updateInfo.localVersion : `v${updateInfo.localVersion}`;
        const { stdout: diffOutput } = await execAsync(`git diff ${localVersionTag}..${latestTag} --name-only`);
        if (diffOutput.includes('package.json') || diffOutput.includes('package-lock.json')) {
            console.log('[Update] package.json changed, running npm install...');
            await execAsync('npm install');
            needsRestart = true;
        }
    } catch (error) {
        console.warn('[Update] Failed to check package changes:', error.message);
    }
    
    console.log(`[Update] Update completed successfully to ${latestTag}`);
    
    return {
        success: true,
        message: `Successfully updated to version ${latestTag}`,
        localVersion: updateInfo.localVersion,
        latestVersion: latestTag,
        updated: true,
        updateMethod: 'git',
        needsRestart: needsRestart,
        restartMessage: needsRestart ? 'Dependencies updated, recommend restarting service to apply changes' : null
    };
}

/**
 * 通过下载 tarball 执行更新（用于 Docker/非 Git 环境）
 * @param {string} localVersion - 本地版本
 * @param {string} latestTag - 最新版本 tag
 * @returns {Promise<Object>} 更新结果
 */
async function performTarballUpdate(localVersion, latestTag) {
    const GITHUB_REPO = 'justlovemaki/AIClient-2-API';
    const tarballUrl = `https://gh-proxy.org/https://github.com/${GITHUB_REPO}/archive/refs/tags/${latestTag}.tar.gz`;
    const appDir = process.cwd();
    const tempDir = path.join(appDir, '.update_temp');
    const tarballPath = path.join(tempDir, 'update.tar.gz');
    
    console.log(`[Update] Starting tarball update to ${latestTag}...`);
    console.log(`[Update] Download URL: ${tarballUrl}`);
    
    try {
        // 1. 创建临时目录
        await fs.mkdir(tempDir, { recursive: true });
        console.log('[Update] Created temp directory');
        
        // 2. 下载 tarball
        console.log('[Update] Downloading tarball...');
        const response = await fetchWithProxy(tarballUrl, {
            headers: {
                'User-Agent': 'AIClient2API-Updater'
            },
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to download tarball: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(tarballPath, buffer);
        console.log(`[Update] Downloaded tarball (${buffer.length} bytes)`);
        
        // 3. 解压 tarball
        console.log('[Update] Extracting tarball...');
        await execAsync(`tar -xzf "${tarballPath}" -C "${tempDir}"`);
        
        // 4. 找到解压后的目录（格式通常是 repo-name-tag）
        const extractedItems = await fs.readdir(tempDir);
        const extractedDir = extractedItems.find(item =>
            item.startsWith('AIClient-2-API-') || item.startsWith('AIClient2API-')
        );
        
        if (!extractedDir) {
            throw new Error('Could not find extracted directory');
        }
        
        const sourcePath = path.join(tempDir, extractedDir);
        console.log(`[Update] Extracted to: ${sourcePath}`);
        
        // 5. 备份当前的 package.json 用于比较
        const oldPackageJson = existsSync(path.join(appDir, 'package.json'))
            ? readFileSync(path.join(appDir, 'package.json'), 'utf-8')
            : null;
        
        // 5.5 在解压前删除 src/ 和 static/ 目录，确保旧代码被完全清除
        const dirsToClean = ['src', 'static'];
        for (const dirName of dirsToClean) {
            const dirPath = path.join(appDir, dirName);
            if (existsSync(dirPath)) {
                console.log(`[Update] Removing old ${dirName}/ directory before extraction...`);
                await fs.rm(dirPath, { recursive: true, force: true });
                console.log(`[Update] Old ${dirName}/ directory removed`);
            }
        }
        
        // 6. 定义需要保留的目录和文件（不被覆盖）
        const preservePaths = [
            'configs',           // 用户配置目录
            'node_modules',      // 依赖目录
            '.update_temp',      // 临时更新目录
            'logs'               // 日志目录
        ];
        
        // 7. 复制新文件到应用目录
        console.log('[Update] Copying new files...');
        const sourceItems = await fs.readdir(sourcePath);
        
        for (const item of sourceItems) {
            // 跳过需要保留的目录
            if (preservePaths.includes(item)) {
                console.log(`[Update] Skipping preserved path: ${item}`);
                continue;
            }
            
            const srcItemPath = path.join(sourcePath, item);
            const destItemPath = path.join(appDir, item);
            
            // 删除旧文件/目录（如果存在）
            if (existsSync(destItemPath)) {
                const stat = await fs.stat(destItemPath);
                if (stat.isDirectory()) {
                    await fs.rm(destItemPath, { recursive: true, force: true });
                } else {
                    await fs.unlink(destItemPath);
                }
            }
            
            // 复制新文件/目录
            await copyRecursive(srcItemPath, destItemPath);
            console.log(`[Update] Copied: ${item}`);
        }
        
        // 8. 检查是否需要更新依赖
        let needsRestart = true; // tarball 更新后总是建议重启
        let needsNpmInstall = false;
        
        if (oldPackageJson) {
            const newPackageJson = readFileSync(path.join(appDir, 'package.json'), 'utf-8');
            if (oldPackageJson !== newPackageJson) {
                console.log('[Update] package.json changed, running npm install...');
                needsNpmInstall = true;
                try {
                    await execAsync('npm install', { cwd: appDir });
                    console.log('[Update] npm install completed');
                } catch (npmError) {
                    console.error('[Update] npm install failed:', npmError.message);
                    // 不抛出错误，继续更新流程
                }
            }
        }
        
        // 9. 清理临时目录
        console.log('[Update] Cleaning up...');
        await fs.rm(tempDir, { recursive: true, force: true });
        
        console.log(`[Update] Tarball update completed successfully to ${latestTag}`);
        
        return {
            success: true,
            message: `Successfully updated to version ${latestTag}`,
            localVersion: localVersion,
            latestVersion: latestTag,
            updated: true,
            updateMethod: 'tarball',
            needsRestart: needsRestart,
            needsNpmInstall: needsNpmInstall,
            restartMessage: 'Code updated, please restart the service to apply changes'
        };
        
    } catch (error) {
        // 清理临时目录
        try {
            if (existsSync(tempDir)) {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        } catch (cleanupError) {
            console.warn('[Update] Failed to cleanup temp directory:', cleanupError.message);
        }
        
        console.error('[Update] Tarball update failed:', error.message);
        throw new Error(`Tarball update failed: ${error.message}`);
    }
}

/**
 * 递归复制文件或目录
 * @param {string} src - 源路径
 * @param {string} dest - 目标路径
 */
async function copyRecursive(src, dest) {
    const stat = await fs.stat(src);
    
    if (stat.isDirectory()) {
        await fs.mkdir(dest, { recursive: true });
        const items = await fs.readdir(src);
        for (const item of items) {
            await copyRecursive(path.join(src, item), path.join(dest, item));
        }
    } else {
        await fs.copyFile(src, dest);
    }
}

/**
 * 检查更新
 */
export async function handleCheckUpdate(req, res) {
    try {
        const updateInfo = await checkForUpdates();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updateInfo));
        return true;
    } catch (error) {
        console.error('[UI API] Failed to check for updates:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to check for updates: ' + error.message
            }
        }));
        return true;
    }
}

/**
 * 执行更新
 */
export async function handlePerformUpdate(req, res) {
    try {
        const updateResult = await performUpdate();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updateResult));
        return true;
    } catch (error) {
        console.error('[UI API] Failed to perform update:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Update failed: ' + error.message
            }
        }));
        return true;
    }
}