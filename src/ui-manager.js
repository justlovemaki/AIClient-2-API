import { existsSync, readFileSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import multer from 'multer';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getRequestBody } from './common.js';

const execAsync = promisify(exec);

// CPU 使用率计算相关变量
let previousCpuInfo = null;

/**
 * 获取 CPU 使用率百分比
 * @returns {string} CPU 使用率字符串，如 "25.5%"
 */
function getCpuUsagePercent() {
    const cpus = os.cpus();
    
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    }
    
    const currentCpuInfo = {
        idle: totalIdle,
        total: totalTick
    };
    
    let cpuPercent = 0;
    
    if (previousCpuInfo) {
        const idleDiff = currentCpuInfo.idle - previousCpuInfo.idle;
        const totalDiff = currentCpuInfo.total - previousCpuInfo.total;
        
        if (totalDiff > 0) {
            cpuPercent = 100 - (100 * idleDiff / totalDiff);
        }
    }
    
    previousCpuInfo = currentCpuInfo;
    
    return `${cpuPercent.toFixed(1)}%`;
}

import { getAllProviderModels, getProviderModels } from './provider-models.js';
import { CONFIG } from './config-manager.js';
import { serviceInstances, getServiceAdapter } from './adapter.js';
import { initApiService } from './service-manager.js';
import { handleGeminiCliOAuth, handleGeminiAntigravityOAuth, handleQwenOAuth, handleKiroOAuth, handleIFlowOAuth, batchImportKiroRefreshTokens } from './oauth-handlers.js';
import {
    generateUUID,
    normalizePath,
    getFileName,
    pathsEqual,
    isPathUsed,
    detectProviderFromPath,
    isValidOAuthCredentials,
    createProviderConfig,
    addToUsedPaths,
    formatSystemPath
} from './provider-utils.js';
import { formatKiroUsage, formatGeminiUsage, formatAntigravityUsage } from './usage-service.js';

// Token存储到本地文件中
const TOKEN_STORE_FILE = path.join(process.cwd(), 'configs', 'token-store.json');

// 用量缓存文件路径
const USAGE_CACHE_FILE = path.join(process.cwd(), 'configs', 'usage-cache.json');

/**
 * 读取用量缓存文件
 * @returns {Promise<Object|null>} 缓存的用量数据，如果不存在或读取失败则返回 null
 */
async function readUsageCache() {
    try {
        if (existsSync(USAGE_CACHE_FILE)) {
            const content = await fs.readFile(USAGE_CACHE_FILE, 'utf8');
            return JSON.parse(content);
        }
        return null;
    } catch (error) {
        console.warn('[Usage Cache] Failed to read usage cache:', error.message);
        return null;
    }
}

/**
 * 写入用量缓存文件
 * @param {Object} usageData - 用量数据
 */
async function writeUsageCache(usageData) {
    try {
        await fs.writeFile(USAGE_CACHE_FILE, JSON.stringify(usageData, null, 2), 'utf8');
        console.log('[Usage Cache] Usage data cached to', USAGE_CACHE_FILE);
    } catch (error) {
        console.error('[Usage Cache] Failed to write usage cache:', error.message);
    }
}

/**
 * 读取特定提供商类型的用量缓存
 * @param {string} providerType - 提供商类型
 * @returns {Promise<Object|null>} 缓存的用量数据
 */
async function readProviderUsageCache(providerType) {
    const cache = await readUsageCache();
    if (cache && cache.providers && cache.providers[providerType]) {
        return {
            ...cache.providers[providerType],
            cachedAt: cache.timestamp,
            fromCache: true
        };
    }
    return null;
}

/**
 * 更新特定提供商类型的用量缓存
 * @param {string} providerType - 提供商类型
 * @param {Object} usageData - 用量数据
 */
async function updateProviderUsageCache(providerType, usageData) {
    let cache = await readUsageCache();
    if (!cache) {
        cache = {
            timestamp: new Date().toISOString(),
            providers: {}
        };
    }
    cache.providers[providerType] = usageData;
    cache.timestamp = new Date().toISOString();
    await writeUsageCache(cache);
}

/**
 * 读取token存储文件
 */
async function readTokenStore() {
    try {
        if (existsSync(TOKEN_STORE_FILE)) {
            const content = await fs.readFile(TOKEN_STORE_FILE, 'utf8');
            return JSON.parse(content);
        } else {
            // 如果文件不存在，创建一个默认的token store
            await writeTokenStore({ tokens: {} });
            return { tokens: {} };
        }
    } catch (error) {
        console.error('[Token Store] Failed to read token store file:', error);
        return { tokens: {} };
    }
}

/**
 * 写入token存储文件
 */
async function writeTokenStore(tokenStore) {
    try {
        await fs.writeFile(TOKEN_STORE_FILE, JSON.stringify(tokenStore, null, 2), 'utf8');
    } catch (error) {
        console.error('[Token Store] Failed to write token store file:', error);
    }
}

/**
 * 生成简单的token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成token过期时间
 */
function getExpiryTime() {
    const now = Date.now();
    const expiry = 60 * 60 * 1000; // 1小时
    return now + expiry;
}

/**
 * 验证简单token
 */
async function verifyToken(token) {
    const tokenStore = await readTokenStore();
    const tokenInfo = tokenStore.tokens[token];
    if (!tokenInfo) {
        return null;
    }
    
    // 检查是否过期
    if (Date.now() > tokenInfo.expiryTime) {
        await deleteToken(token);
        return null;
    }
    
    return tokenInfo;
}

/**
 * 保存token到本地文件
 */
async function saveToken(token, tokenInfo) {
    const tokenStore = await readTokenStore();
    tokenStore.tokens[token] = tokenInfo;
    await writeTokenStore(tokenStore);
}

/**
 * 删除token
 */
async function deleteToken(token) {
    const tokenStore = await readTokenStore();
    if (tokenStore.tokens[token]) {
        delete tokenStore.tokens[token];
        await writeTokenStore(tokenStore);
    }
}

/**
 * 清理过期的token
 */
async function cleanupExpiredTokens() {
    const tokenStore = await readTokenStore();
    const now = Date.now();
    let hasChanges = false;
    
    for (const token in tokenStore.tokens) {
        if (now > tokenStore.tokens[token].expiryTime) {
            delete tokenStore.tokens[token];
            hasChanges = true;
        }
    }
    
    if (hasChanges) {
        await writeTokenStore(tokenStore);
    }
}

/**
 * 默认密码（当pwd文件不存在时使用）
 */
const DEFAULT_PASSWORD = 'admin123';

/**
 * 读取密码文件内容
 * 如果文件不存在或读取失败，返回默认密码
 */
async function readPasswordFile() {
    const pwdFilePath = path.join(process.cwd(), 'configs', 'pwd');
    try {
        // 使用异步方式检查文件是否存在并读取，避免竞态条件
        const password = await fs.readFile(pwdFilePath, 'utf8');
        const trimmedPassword = password.trim();
        // 如果密码文件为空，使用默认密码
        if (!trimmedPassword) {
            console.log('[Auth] Password file is empty, using default password: ' + DEFAULT_PASSWORD);
            return DEFAULT_PASSWORD;
        }
        console.log('[Auth] Successfully read password file');
        return trimmedPassword;
    } catch (error) {
        // ENOENT means file does not exist, which is normal
        if (error.code === 'ENOENT') {
            console.log('[Auth] Password file does not exist, using default password: ' + DEFAULT_PASSWORD);
        } else {
            console.error('[Auth] Failed to read password file:', error.code || error.message);
            console.log('[Auth] Using default password: ' + DEFAULT_PASSWORD);
        }
        return DEFAULT_PASSWORD;
    }
}

/**
 * 验证登录凭据
 */
async function validateCredentials(password) {
    const storedPassword = await readPasswordFile();
    console.log('[Auth] Validating password, stored password length:', storedPassword ? storedPassword.length : 0, ', input password length:', password ? password.length : 0);
    const isValid = storedPassword && password === storedPassword;
    console.log('[Auth] Password validation result:', isValid);
    return isValid;
}

/**
 * 解析请求体JSON
 */
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                if (!body.trim()) {
                    resolve({});
                } else {
                    resolve(JSON.parse(body));
                }
            } catch (error) {
                reject(new Error('Invalid JSON format'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 检查token验证
 */
async function checkAuth(req) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.substring(7);
    const tokenInfo = await verifyToken(token);
    
    return tokenInfo !== null;
}

/**
 * 处理登录请求
 */
async function handleLoginRequest(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Only POST requests are supported' }));
        return true;
    }

    try {
        const requestData = await parseRequestBody(req);
        const { password } = requestData;
        
        if (!password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Password cannot be empty' }));
            return true;
        }

        const isValid = await validateCredentials(password);
        
        if (isValid) {
            // Generate simple token
            const token = generateToken();
            const expiryTime = getExpiryTime();
            
            // Store token info to local file
            await saveToken(token, {
                username: 'admin',
                loginTime: Date.now(),
                expiryTime
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Login successful',
                token,
                expiresIn: '1 hour'
            }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'Incorrect password, please try again'
            }));
        }
    } catch (error) {
        console.error('[Auth] Login processing error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message || 'Server error'
        }));
    }
    return true;
}

// 定时清理过期token
setInterval(cleanupExpiredTokens, 5 * 60 * 1000); // 每5分钟清理一次

// 配置multer中间件
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            // multer在destination回调时req.body还未解析，先使用默认路径
            // 实际的provider会在文件上传完成后从req.body中获取
            const uploadPath = path.join(process.cwd(), 'configs', 'temp');
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.json', '.txt', '.key', '.pem', '.p12', '.pfx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file type'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB限制
    }
});

/**
 * Serve static files for the UI
 * @param {string} path - The request path
 * @param {http.ServerResponse} res - The HTTP response object
 */
export async function serveStaticFiles(pathParam, res) {
    const filePath = path.join(process.cwd(), 'static', pathParam === '/' || pathParam === '/index.html' ? 'index.html' : pathParam.replace('/static/', ''));

    if (existsSync(filePath)) {
        const ext = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.ico': 'image/x-icon'
        }[ext] || 'text/plain';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(readFileSync(filePath));
        return true;
    }
    return false;
}

/**
 * Handle UI management API requests
 * @param {string} method - The HTTP method
 * @param {string} path - The request path
 * @param {http.IncomingMessage} req - The HTTP request object
 * @param {http.ServerResponse} res - The HTTP response object
 * @param {Object} currentConfig - The current configuration object
 * @param {Object} providerPoolManager - The provider pool manager instance
 * @returns {Promise<boolean>} - True if the request was handled by UI API
 */
/**
 * 重载配置文件
 * 动态导入config-manager并重新初始化配置
 * @returns {Promise<Object>} 返回重载后的配置对象
 */
async function reloadConfig(providerPoolManager) {
    try {
        // Import config manager dynamically
        const { initializeConfig } = await import('./config-manager.js');
        
        // Reload main config
        const newConfig = await initializeConfig(process.argv.slice(2), 'configs/config.json');
        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = newConfig.providerPools;
            providerPoolManager.initializeProviderStatus();
        }
        
        // Update global CONFIG
        Object.assign(CONFIG, newConfig);
        console.log('[UI API] Configuration reloaded:');

        // Update initApiService - 清空并重新初始化服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);
        initApiService(CONFIG);
        
        console.log('[UI API] Configuration reloaded successfully');
        
        return newConfig;
    } catch (error) {
        console.error('[UI API] Failed to reload configuration:', error);
        throw error;
    }
}

export async function handleUIApiRequests(method, pathParam, req, res, currentConfig, providerPoolManager) {
    // 处理登录接口
    if (method === 'POST' && pathParam === '/api/login') {
        const handled = await handleLoginRequest(req, res);
        if (handled) return true;
    }

    // 健康检查接口（用于前端token验证）
    if (method === 'GET' && pathParam === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
        return true;
    }
    
    // Handle UI management API requests (需要token验证，除了登录接口、健康检查和Events接口)
    if (pathParam.startsWith('/api/') && pathParam !== '/api/login' && pathParam !== '/api/health' && pathParam !== '/api/events') {
        // 检查token验证
        const isAuth = await checkAuth(req);
        if (!isAuth) {
            res.writeHead(401, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end(JSON.stringify({
                error: {
                    message: 'Unauthorized access, please login first',
                    code: 'UNAUTHORIZED'
                }
            }));
            return true;
        }
    }

    // 文件上传API
    if (method === 'POST' && pathParam === '/api/upload-oauth-credentials') {
        const uploadMiddleware = upload.single('file');
        
        uploadMiddleware(req, res, async (err) => {
            if (err) {
                console.error('[UI API] File upload error:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: err.message || 'File upload failed'
                    }
                }));
                return;
            }

            try {
                if (!req.file) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: {
                            message: 'No file was uploaded'
                        }
                    }));
                    return;
                }

                // multer执行完成后，表单字段已解析到req.body中
                const provider = req.body.provider || 'common';
                const tempFilePath = req.file.path;
                
                // 根据实际的provider移动文件到正确的目录
                let targetDir = path.join(process.cwd(), 'configs', provider);
                
                // 如果是kiro类型的凭证，需要再包裹一层文件夹
                if (provider === 'kiro') {
                    // 使用时间戳作为子文件夹名称，确保每个上传的文件都有独立的目录
                    const timestamp = Date.now();
                    const originalNameWithoutExt = path.parse(req.file.originalname).name;
                    const subFolder = `${timestamp}_${originalNameWithoutExt}`;
                    targetDir = path.join(targetDir, subFolder);
                }
                
                await fs.mkdir(targetDir, { recursive: true });
                
                const targetFilePath = path.join(targetDir, req.file.filename);
                await fs.rename(tempFilePath, targetFilePath);
                
                const relativePath = path.relative(process.cwd(), targetFilePath);

                // 广播更新事件
                broadcastEvent('config_update', {
                    action: 'add',
                    filePath: relativePath,
                    provider: provider,
                    timestamp: new Date().toISOString()
                });

                console.log(`[UI API] OAuth credentials file uploaded: ${targetFilePath} (provider: ${provider})`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'File uploaded successfully',
                    filePath: relativePath,
                    originalName: req.file.originalname,
                    provider: provider
                }));

            } catch (error) {
                console.error('[UI API] File upload processing error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'File upload processing failed: ' + error.message
                    }
                }));
            }
        });
        return true;
    }

    // Update admin password
    if (method === 'POST' && pathParam === '/api/admin-password') {
        try {
            const body = await getRequestBody(req);
            const { password } = body;

            if (!password || password.trim() === '') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'Password cannot be empty'
                    }
                }));
                return true;
            }

            // 写入密码到 pwd 文件
            const pwdFilePath = path.join(process.cwd(), 'configs', 'pwd');
            await fs.writeFile(pwdFilePath, password.trim(), 'utf8');
            
            console.log('[UI API] Admin password updated successfully');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Admin password updated successfully'
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to update admin password:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to update password: ' + error.message
                }
            }));
            return true;
        }
    }

    // Get configuration
    if (method === 'GET' && pathParam === '/api/config') {
        let systemPrompt = '';

        if (currentConfig.SYSTEM_PROMPT_FILE_PATH && existsSync(currentConfig.SYSTEM_PROMPT_FILE_PATH)) {
            try {
                systemPrompt = readFileSync(currentConfig.SYSTEM_PROMPT_FILE_PATH, 'utf-8');
            } catch (e) {
                console.warn('[UI API] Failed to read system prompt file:', e.message);
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ...currentConfig,
            systemPrompt
        }));
        return true;
    }

    // Update configuration
    if (method === 'POST' && pathParam === '/api/config') {
        try {
            const body = await getRequestBody(req);
            const newConfig = body;

            // Update config values in memory
            if (newConfig.REQUIRED_API_KEY !== undefined) currentConfig.REQUIRED_API_KEY = newConfig.REQUIRED_API_KEY;
            if (newConfig.HOST !== undefined) currentConfig.HOST = newConfig.HOST;
            if (newConfig.SERVER_PORT !== undefined) currentConfig.SERVER_PORT = newConfig.SERVER_PORT;
            if (newConfig.MODEL_PROVIDER !== undefined) currentConfig.MODEL_PROVIDER = newConfig.MODEL_PROVIDER;
            if (newConfig.SYSTEM_PROMPT_FILE_PATH !== undefined) currentConfig.SYSTEM_PROMPT_FILE_PATH = newConfig.SYSTEM_PROMPT_FILE_PATH;
            if (newConfig.SYSTEM_PROMPT_MODE !== undefined) currentConfig.SYSTEM_PROMPT_MODE = newConfig.SYSTEM_PROMPT_MODE;
            if (newConfig.PROMPT_LOG_BASE_NAME !== undefined) currentConfig.PROMPT_LOG_BASE_NAME = newConfig.PROMPT_LOG_BASE_NAME;
            if (newConfig.PROMPT_LOG_MODE !== undefined) currentConfig.PROMPT_LOG_MODE = newConfig.PROMPT_LOG_MODE;
            if (newConfig.REQUEST_MAX_RETRIES !== undefined) currentConfig.REQUEST_MAX_RETRIES = newConfig.REQUEST_MAX_RETRIES;
            if (newConfig.REQUEST_BASE_DELAY !== undefined) currentConfig.REQUEST_BASE_DELAY = newConfig.REQUEST_BASE_DELAY;
            if (newConfig.CRON_NEAR_MINUTES !== undefined) currentConfig.CRON_NEAR_MINUTES = newConfig.CRON_NEAR_MINUTES;
            if (newConfig.CRON_REFRESH_TOKEN !== undefined) currentConfig.CRON_REFRESH_TOKEN = newConfig.CRON_REFRESH_TOKEN;
            if (newConfig.PROVIDER_POOLS_FILE_PATH !== undefined) currentConfig.PROVIDER_POOLS_FILE_PATH = newConfig.PROVIDER_POOLS_FILE_PATH;
            if (newConfig.MAX_ERROR_COUNT !== undefined) currentConfig.MAX_ERROR_COUNT = newConfig.MAX_ERROR_COUNT;
            if (newConfig.providerFallbackChain !== undefined) currentConfig.providerFallbackChain = newConfig.providerFallbackChain;
            if (newConfig.modelFallbackMapping !== undefined) currentConfig.modelFallbackMapping = newConfig.modelFallbackMapping;
            
            // Proxy settings
            if (newConfig.PROXY_URL !== undefined) currentConfig.PROXY_URL = newConfig.PROXY_URL;
            if (newConfig.PROXY_ENABLED_PROVIDERS !== undefined) currentConfig.PROXY_ENABLED_PROVIDERS = newConfig.PROXY_ENABLED_PROVIDERS;

            // Handle system prompt update
            if (newConfig.systemPrompt !== undefined) {
                const promptPath = currentConfig.SYSTEM_PROMPT_FILE_PATH || 'configs/input_system_prompt.txt';
                try {
                    const relativePath = path.relative(process.cwd(), promptPath);
                    writeFileSync(promptPath, newConfig.systemPrompt, 'utf-8');

                    // 广播更新事件
                    broadcastEvent('config_update', {
                        action: 'update',
                        filePath: relativePath,
                        type: 'system_prompt',
                        timestamp: new Date().toISOString()
                    });
                    
                    console.log('[UI API] System prompt updated');
                } catch (e) {
                    console.warn('[UI API] Failed to write system prompt:', e.message);
                }
            }

            // Update config.json file
            try {
                const configPath = 'configs/config.json';
                
                // Create a clean config object for saving (exclude runtime-only properties)
                const configToSave = {
                    REQUIRED_API_KEY: currentConfig.REQUIRED_API_KEY,
                    SERVER_PORT: currentConfig.SERVER_PORT,
                    HOST: currentConfig.HOST,
                    MODEL_PROVIDER: currentConfig.MODEL_PROVIDER,
                    SYSTEM_PROMPT_FILE_PATH: currentConfig.SYSTEM_PROMPT_FILE_PATH,
                    SYSTEM_PROMPT_MODE: currentConfig.SYSTEM_PROMPT_MODE,
                    PROMPT_LOG_BASE_NAME: currentConfig.PROMPT_LOG_BASE_NAME,
                    PROMPT_LOG_MODE: currentConfig.PROMPT_LOG_MODE,
                    REQUEST_MAX_RETRIES: currentConfig.REQUEST_MAX_RETRIES,
                    REQUEST_BASE_DELAY: currentConfig.REQUEST_BASE_DELAY,
                    CRON_NEAR_MINUTES: currentConfig.CRON_NEAR_MINUTES,
                    CRON_REFRESH_TOKEN: currentConfig.CRON_REFRESH_TOKEN,
                    PROVIDER_POOLS_FILE_PATH: currentConfig.PROVIDER_POOLS_FILE_PATH,
                    MAX_ERROR_COUNT: currentConfig.MAX_ERROR_COUNT,
                    providerFallbackChain: currentConfig.providerFallbackChain,
                    modelFallbackMapping: currentConfig.modelFallbackMapping,
                    PROXY_URL: currentConfig.PROXY_URL,
                    PROXY_ENABLED_PROVIDERS: currentConfig.PROXY_ENABLED_PROVIDERS
                };

                writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
                console.log('[UI API] Configuration saved to configs/config.json');
                
                // 广播更新事件
                broadcastEvent('config_update', {
                    action: 'update',
                    filePath: 'configs/config.json',
                    type: 'main_config',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('[UI API] Failed to save configuration to file:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'Failed to save configuration to file: ' + error.message,
                        partial: true  // Indicate that memory config was updated but not saved
                    }
                }));
                return true;
            }

            // Update the global CONFIG object to reflect changes immediately
            Object.assign(CONFIG, currentConfig);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Configuration updated successfully',
                details: 'Configuration has been updated in both memory and config.json file'
            }));
            return true;
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Get system information
    if (method === 'GET' && pathParam === '/api/system') {
        const memUsage = process.memoryUsage();
        
        // 读取版本号
        let appVersion = 'unknown';
        try {
            const versionFilePath = path.join(process.cwd(), 'VERSION');
            if (existsSync(versionFilePath)) {
                appVersion = readFileSync(versionFilePath, 'utf8').trim();
            }
        } catch (error) {
            console.warn('[UI API] Failed to read VERSION file:', error.message);
        }
        
        // 计算 CPU 使用率
        const cpuUsage = getCpuUsagePercent();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            appVersion: appVersion,
            nodeVersion: process.version,
            serverTime: new Date().toLocaleString(),
            memoryUsage: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
            cpuUsage: cpuUsage,
            uptime: process.uptime()
        }));
        return true;
    }

    // Get provider pools summary
    if (method === 'GET' && pathParam === '/api/providers') {
        let providerPools = {};
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        try {
            if (providerPoolManager && providerPoolManager.providerPools) {
                providerPools = providerPoolManager.providerPools;
            } else if (filePath && existsSync(filePath)) {
                const poolsData = JSON.parse(readFileSync(filePath, 'utf-8'));
                providerPools = poolsData;
            }
        } catch (error) {
            console.warn('[UI API] Failed to load provider pools:', error.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(providerPools));
        return true;
    }

    // Get specific provider type details
    const providerTypeMatch = pathParam.match(/^\/api\/providers\/([^\/]+)$/);
    if (method === 'GET' && providerTypeMatch) {
        const providerType = decodeURIComponent(providerTypeMatch[1]);
        let providerPools = {};
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        try {
            if (providerPoolManager && providerPoolManager.providerPools) {
                providerPools = providerPoolManager.providerPools;
            } else if (filePath && existsSync(filePath)) {
                const poolsData = JSON.parse(readFileSync(filePath, 'utf-8'));
                providerPools = poolsData;
            }
        } catch (error) {
            console.warn('[UI API] Failed to load provider pools:', error.message);
        }

        const providers = providerPools[providerType] || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            providerType,
            providers,
            totalCount: providers.length,
            healthyCount: providers.filter(p => p.isHealthy).length
        }));
        return true;
    }

    // Get available models for all providers or specific provider type
    if (method === 'GET' && pathParam === '/api/provider-models') {
        const allModels = getAllProviderModels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(allModels));
        return true;
    }

    // Get available models for a specific provider type
    const providerModelsMatch = pathParam.match(/^\/api\/provider-models\/([^\/]+)$/);
    if (method === 'GET' && providerModelsMatch) {
        const providerType = decodeURIComponent(providerModelsMatch[1]);
        const models = getProviderModels(providerType);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            providerType,
            models
        }));
        return true;
    }

    // Add new provider configuration
    if (method === 'POST' && pathParam === '/api/providers') {
        try {
            const body = await getRequestBody(req);
            const { providerType, providerConfig } = body;

            if (!providerType || !providerConfig) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'providerType and providerConfig are required' } }));
                return true;
            }

            // Generate UUID if not provided
            if (!providerConfig.uuid) {
                providerConfig.uuid = generateUUID();
            }

            // Set default values
            providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
            providerConfig.lastUsed = providerConfig.lastUsed || null;
            providerConfig.usageCount = providerConfig.usageCount || 0;
            providerConfig.errorCount = providerConfig.errorCount || 0;
            providerConfig.lastErrorTime = providerConfig.lastErrorTime || null;

            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
            let providerPools = {};
            
            // Load existing pools
            if (existsSync(filePath)) {
                try {
                    const fileContent = readFileSync(filePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                } catch (readError) {
                    console.warn('[UI API] Failed to read existing provider pools:', readError.message);
                }
            }

            // Add new provider to the appropriate type
            if (!providerPools[providerType]) {
                providerPools[providerType] = [];
            }
            providerPools[providerType].push(providerConfig);

            // Save to file
            writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf8');
            console.log(`[UI API] Added new provider to ${providerType}: ${providerConfig.uuid}`);

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                providerPoolManager.initializeProviderStatus();
            }

            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'add',
                filePath: filePath,
                providerType,
                providerConfig,
                timestamp: new Date().toISOString()
            });

            // 广播提供商更新事件
            broadcastEvent('provider_update', {
                action: 'add',
                providerType,
                providerConfig,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Provider added successfully',
                provider: providerConfig,
                providerType
            }));
            return true;
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Update specific provider configuration
    const updateProviderMatch = pathParam.match(/^\/api\/providers\/([^\/]+)\/([^\/]+)$/);
    if (method === 'PUT' && updateProviderMatch) {
        const providerType = decodeURIComponent(updateProviderMatch[1]);
        const providerUuid = updateProviderMatch[2];

        try {
            const body = await getRequestBody(req);
            const { providerConfig } = body;

            if (!providerConfig) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'providerConfig is required' } }));
                return true;
            }

            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let providerPools = {};
            
            // Load existing pools
            if (existsSync(filePath)) {
                try {
                    const fileContent = readFileSync(filePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                } catch (readError) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                    return true;
                }
            }

            // Find and update the provider
            const providers = providerPools[providerType] || [];
            const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
            
            if (providerIndex === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
                return true;
            }

            // Update provider while preserving certain fields
            const existingProvider = providers[providerIndex];
            const updatedProvider = {
                ...existingProvider,
                ...providerConfig,
                uuid: providerUuid, // Ensure UUID doesn't change
                lastUsed: existingProvider.lastUsed, // Preserve usage stats
                usageCount: existingProvider.usageCount,
                errorCount: existingProvider.errorCount,
                lastErrorTime: existingProvider.lastErrorTime
            };

            providerPools[providerType][providerIndex] = updatedProvider;

            // Save to file
            writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf8');
            console.log(`[UI API] Updated provider ${providerUuid} in ${providerType}`);

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                providerPoolManager.initializeProviderStatus();
            }

            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'update',
                filePath: filePath,
                providerType,
                providerConfig: updatedProvider,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Provider updated successfully',
                provider: updatedProvider
            }));
            return true;
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Delete specific provider configuration
    if (method === 'DELETE' && updateProviderMatch) {
        const providerType = decodeURIComponent(updateProviderMatch[1]);
        const providerUuid = updateProviderMatch[2];

        try {
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let providerPools = {};
            
            // Load existing pools
            if (existsSync(filePath)) {
                try {
                    const fileContent = readFileSync(filePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                } catch (readError) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                    return true;
                }
            }

            // Find and remove the provider
            const providers = providerPools[providerType] || [];
            const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
            
            if (providerIndex === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
                return true;
            }

            const deletedProvider = providers[providerIndex];
            providers.splice(providerIndex, 1);

            // Remove the entire provider type if no providers left
            if (providers.length === 0) {
                delete providerPools[providerType];
            }

            // Save to file
            writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf8');
            console.log(`[UI API] Deleted provider ${providerUuid} from ${providerType}`);

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                providerPoolManager.initializeProviderStatus();
            }

            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'delete',
                filePath: filePath,
                providerType,
                providerConfig: deletedProvider,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Provider deleted successfully',
                deletedProvider
            }));
            return true;
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Disable/Enable specific provider configuration
    const disableEnableProviderMatch = pathParam.match(/^\/api\/providers\/([^\/]+)\/([^\/]+)\/(disable|enable)$/);
    if (disableEnableProviderMatch) {
        const providerType = decodeURIComponent(disableEnableProviderMatch[1]);
        const providerUuid = disableEnableProviderMatch[2];
        const action = disableEnableProviderMatch[3];

        try {
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let providerPools = {};
            
            // Load existing pools
            if (existsSync(filePath)) {
                try {
                    const fileContent = readFileSync(filePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                } catch (readError) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                    return true;
                }
            }

            // Find and update the provider
            const providers = providerPools[providerType] || [];
            const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
            
            if (providerIndex === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
                return true;
            }

            // Update isDisabled field
            const provider = providers[providerIndex];
            provider.isDisabled = action === 'disable';
            
            // Save to file
            writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf8');
            console.log(`[UI API] ${action === 'disable' ? 'Disabled' : 'Enabled'} provider ${providerUuid} in ${providerType}`);

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                
                // Call the appropriate method
                if (action === 'disable') {
                    providerPoolManager.disableProvider(providerType, provider);
                } else {
                    providerPoolManager.enableProvider(providerType, provider);
                }
            }

            // 广播更新事件
            broadcastEvent('config_update', {
                action: action,
                filePath: filePath,
                providerType,
                providerConfig: provider,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: `Provider ${action}d successfully`,
                provider: provider
            }));
            return true;
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Reset all providers health status for a specific provider type
    const resetHealthMatch = pathParam.match(/^\/api\/providers\/([^\/]+)\/reset-health$/);
    if (method === 'POST' && resetHealthMatch) {
        const providerType = decodeURIComponent(resetHealthMatch[1]);

        try {
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let providerPools = {};
            
            // Load existing pools
            if (existsSync(filePath)) {
                try {
                    const fileContent = readFileSync(filePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                } catch (readError) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                    return true;
                }
            }

            // Reset health status for all providers of this type
            const providers = providerPools[providerType] || [];
            
            if (providers.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'No providers found for this type' } }));
                return true;
            }

            let resetCount = 0;
            providers.forEach(provider => {
                if (!provider.isHealthy) {
                    provider.isHealthy = true;
                    provider.errorCount = 0;
                    provider.lastErrorTime = null;
                    resetCount++;
                }
            });

            // Save to file
            writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf8');
            console.log(`[UI API] Reset health status for ${resetCount} providers in ${providerType}`);

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                providerPoolManager.initializeProviderStatus();
            }

            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'reset_health',
                filePath: filePath,
                providerType,
                resetCount,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: `Successfully reset health status for ${resetCount} providers`,
                resetCount,
                totalCount: providers.length
            }));
            return true;
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Perform health check for all providers of a specific type
    const healthCheckMatch = pathParam.match(/^\/api\/providers\/([^\/]+)\/health-check$/);
    if (method === 'POST' && healthCheckMatch) {
        const providerType = decodeURIComponent(healthCheckMatch[1]);

        try {
            if (!providerPoolManager) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pool manager not initialized' } }));
                return true;
            }

            const providers = providerPoolManager.providerStatus[providerType] || [];
            
            if (providers.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'No providers found for this type' } }));
                return true;
            }

            console.log(`[UI API] Starting health check for ${providers.length} providers in ${providerType}`);

            // 执行健康检测（强制检查，忽略 checkHealth 配置）
            const results = [];
            for (const providerStatus of providers) {
                const providerConfig = providerStatus.config;
                
                // 跳过已禁用的节点
                if (providerConfig.isDisabled) {
                    console.log(`[UI API] Skipping health check for disabled provider: ${providerConfig.uuid}`);
                    continue;
                }

                try {
                    // 传递 forceCheck = true 强制执行健康检查，忽略 checkHealth 配置
                    const healthResult = await providerPoolManager._checkProviderHealth(providerType, providerConfig, true);
                    
                    if (healthResult === null) {
                        results.push({
                            uuid: providerConfig.uuid,
                            success: null,
                            message: 'Health check not supported for this provider type'
                        });
                        continue;
                    }
                    
                    if (healthResult.success) {
                        providerPoolManager.markProviderHealthy(providerType, providerConfig, false, healthResult.modelName);
                        results.push({
                            uuid: providerConfig.uuid,
                            success: true,
                            modelName: healthResult.modelName,
                            message: 'Healthy'
                        });
                    } else {
                        providerPoolManager.markProviderUnhealthy(providerType, providerConfig, healthResult.errorMessage);
                        providerStatus.config.lastHealthCheckTime = new Date().toISOString();
                        if (healthResult.modelName) {
                            providerStatus.config.lastHealthCheckModel = healthResult.modelName;
                        }
                        results.push({
                            uuid: providerConfig.uuid,
                            success: false,
                            modelName: healthResult.modelName,
                            message: healthResult.errorMessage || 'Check failed'
                        });
                    }
                } catch (error) {
                    providerPoolManager.markProviderUnhealthy(providerType, providerConfig, error.message);
                    results.push({
                        uuid: providerConfig.uuid,
                        success: false,
                        message: error.message
                    });
                }
            }

            // 保存更新后的状态到文件
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            
            // 从 providerStatus 构建 providerPools 对象并保存
            const providerPools = {};
            for (const pType in providerPoolManager.providerStatus) {
                providerPools[pType] = providerPoolManager.providerStatus[pType].map(ps => ps.config);
            }
            writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf8');

            const successCount = results.filter(r => r.success === true).length;
            const failCount = results.filter(r => r.success === false).length;

            console.log(`[UI API] Health check completed for ${providerType}: ${successCount} healthy, ${failCount} unhealthy`);

            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'health_check',
                filePath: filePath,
                providerType,
                results,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: `Health check completed: ${successCount} healthy, ${failCount} unhealthy`,
                successCount,
                failCount,
                totalCount: providers.length,
                results
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Health check error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
            return true;
        }
    }

    // Generate OAuth authorization URL for providers
    const generateAuthUrlMatch = pathParam.match(/^\/api\/providers\/([^\/]+)\/generate-auth-url$/);
    if (method === 'POST' && generateAuthUrlMatch) {
        const providerType = decodeURIComponent(generateAuthUrlMatch[1]);
        
        try {
            let authUrl = '';
            let authInfo = {};
            
            // 解析 options
            let options = {};
            try {
                options = await getRequestBody(req);
            } catch (e) {
                // 如果没有请求体，使用默认空对象
            }

            // 根据提供商类型生成授权链接并启动回调服务器
            if (providerType === 'gemini-cli-oauth') {
                const result = await handleGeminiCliOAuth(currentConfig, options);
                authUrl = result.authUrl;
                authInfo = result.authInfo;
            } else if (providerType === 'gemini-antigravity') {
                const result = await handleGeminiAntigravityOAuth(currentConfig, options);
                authUrl = result.authUrl;
                authInfo = result.authInfo;
            } else if (providerType === 'openai-qwen-oauth') {
                const result = await handleQwenOAuth(currentConfig, options);
                authUrl = result.authUrl;
                authInfo = result.authInfo;
            } else if (providerType === 'claude-kiro-oauth') {
                // Kiro OAuth 支持多种认证方式
                // options.method 可以是: 'google' | 'github' | 'builder-id'
                const result = await handleKiroOAuth(currentConfig, options);
                authUrl = result.authUrl;
                authInfo = result.authInfo;
            } else if (providerType === 'openai-iflow') {
                // iFlow OAuth 授权
                const result = await handleIFlowOAuth(currentConfig, options);
                authUrl = result.authUrl;
                authInfo = result.authInfo;
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: `Unsupported provider type: ${providerType}`
                    }
                }));
                return true;
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                authUrl: authUrl,
                authInfo: authInfo
            }));
            return true;
            
        } catch (error) {
            console.error(`[UI API] Failed to generate auth URL for ${providerType}:`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: `Failed to generate auth URL: ${error.message}`
                }
            }));
            return true;
        }
    }

    // Handle manual OAuth callback
    if (method === 'POST' && pathParam === '/api/oauth/manual-callback') {
        try {
            const body = await getRequestBody(req);
            const { provider, callbackUrl, authMethod } = body;
            
            if (!provider || !callbackUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'provider and callbackUrl are required'
                }));
                return true;
            }
            
            console.log(`[OAuth Manual Callback] Processing manual callback for ${provider}`);
            console.log(`[OAuth Manual Callback] Callback URL: ${callbackUrl}`);
            
            // 解析回调URL
            const url = new URL(callbackUrl);
            const code = url.searchParams.get('code');
            const token = url.searchParams.get('token');
            
            if (!code && !token) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Callback URL must contain code or token parameter'
                }));
                return true;
            }
            
            // 通过fetch请求本地OAuth回调服务器处理
            // 使用localhost而不是原始hostname，确保请求到达本地服务器
            const localUrl = new URL(callbackUrl);
            localUrl.hostname = 'localhost';
            localUrl.protocol = 'http:';
            
            try {
                const response = await fetch(localUrl.href);
                
                if (response.ok) {
                    console.log(`[OAuth Manual Callback] Successfully processed callback for ${provider}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        message: 'OAuth callback processed successfully'
                    }));
                } else {
                    const errorText = await response.text();
                    console.error(`[OAuth Manual Callback] Callback processing failed:`, errorText);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: false,
                        error: `Callback processing failed: ${response.status}`
                    }));
                }
            } catch (fetchError) {
                console.error(`[OAuth Manual Callback] Failed to process callback:`, fetchError);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: `Failed to process callback: ${fetchError.message}`
                }));
            }
            
            return true;
        } catch (error) {
            console.error('[OAuth Manual Callback] Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message
            }));
            return true;
        }
    }

    // Server-Sent Events for real-time updates
    if (method === 'GET' && pathParam === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        res.write('\n');

        // Store the response object for broadcasting
        if (!global.eventClients) {
            global.eventClients = [];
        }
        global.eventClients.push(res);

        // Keep connection alive
        const keepAlive = setInterval(() => {
            res.write(':\n\n');
        }, 30000);

        req.on('close', () => {
            clearInterval(keepAlive);
            global.eventClients = global.eventClients.filter(r => r !== res);
        });

        return true;
    }

    // Get upload configuration files list
    if (method === 'GET' && pathParam === '/api/upload-configs') {
        try {
            const configFiles = await scanConfigFiles(currentConfig, providerPoolManager);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(configFiles));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to scan config files:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to scan config files: ' + error.message
                }
            }));
            return true;
        }
    }

    // View specific configuration file
    const viewConfigMatch = pathParam.match(/^\/api\/upload-configs\/view\/(.+)$/);
    if (method === 'GET' && viewConfigMatch) {
        try {
            const filePath = decodeURIComponent(viewConfigMatch[1]);
            const fullPath = path.join(process.cwd(), filePath);
            
            // 安全检查：确保文件路径在允许的目录内
            const allowedDirs = ['configs'];
            const relativePath = path.relative(process.cwd(), fullPath);
            const isAllowed = allowedDirs.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir);
            
            if (!isAllowed) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'Access denied: can only view files in configs directory'
                    }
                }));
                return true;
            }
            
            if (!existsSync(fullPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'File does not exist'
                    }
                }));
                return true;
            }
            
            const content = await fs.readFile(fullPath, 'utf8');
            const stats = await fs.stat(fullPath);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                path: relativePath,
                content: content,
                size: stats.size,
                modified: stats.mtime.toISOString(),
                name: path.basename(fullPath)
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to view config file:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to view config file: ' + error.message
                }
            }));
            return true;
        }
    }

    // Delete specific configuration file
    const deleteConfigMatch = pathParam.match(/^\/api\/upload-configs\/delete\/(.+)$/);
    if (method === 'DELETE' && deleteConfigMatch) {
        try {
            const filePath = decodeURIComponent(deleteConfigMatch[1]);
            const fullPath = path.join(process.cwd(), filePath);
            
            // 安全检查：确保文件路径在允许的目录内
            const allowedDirs = ['configs'];
            const relativePath = path.relative(process.cwd(), fullPath);
            const isAllowed = allowedDirs.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir);
            
            if (!isAllowed) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'Access denied: can only delete files in configs directory'
                    }
                }));
                return true;
            }
            
            if (!existsSync(fullPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'File does not exist'
                    }
                }));
                return true;
            }
            
            
            await fs.unlink(fullPath);
            
            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'delete',
                filePath: relativePath,
                timestamp: new Date().toISOString()
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'File deleted successfully',
                filePath: relativePath
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to delete config file:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to delete config file: ' + error.message
                }
            }));
            return true;
        }
    }

    // Download all configs as zip
    if (method === 'GET' && pathParam === '/api/upload-configs/download-all') {
        try {
            const configsPath = path.join(process.cwd(), 'configs');
            if (!existsSync(configsPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'configs directory does not exist' } }));
                return true;
            }

            const zip = new AdmZip();
            
            // 递归添加目录函数
            const addDirectoryToZip = async (dirPath, zipPath = '') => {
                const items = await fs.readdir(dirPath, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dirPath, item.name);
                    const itemZipPath = zipPath ? path.join(zipPath, item.name) : item.name;
                    
                    if (item.isFile()) {
                        const content = await fs.readFile(fullPath);
                        zip.addFile(itemZipPath.replace(/\\/g, '/'), content);
                    } else if (item.isDirectory()) {
                        await addDirectoryToZip(fullPath, itemZipPath);
                    }
                }
            };

            await addDirectoryToZip(configsPath);
            
            const zipBuffer = zip.toBuffer();
            const filename = `configs_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': zipBuffer.length
            });
            res.end(zipBuffer);
            
            console.log(`[UI API] All configs downloaded as zip: ${filename}`);
            return true;
        } catch (error) {
            console.error('[UI API] Failed to download all configs:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to download zip: ' + error.message
                }
            }));
            return true;
        }
    }

    // Quick link config to corresponding provider based on directory
    if (method === 'POST' && pathParam === '/api/quick-link-provider') {
        try {
            const body = await getRequestBody(req);
            const { filePath } = body;

            if (!filePath) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
                return true;
            }

            const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
            
            // 根据文件路径自动识别提供商类型
            const providerMapping = detectProviderFromPath(normalizedPath);
            
            if (!providerMapping) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'Unable to identify provider type for config file, please ensure file is in configs/kiro/, configs/gemini/, configs/qwen/ or configs/antigravity/ directory'
                    }
                }));
                return true;
            }

            const { providerType, credPathKey, defaultCheckModel, displayName } = providerMapping;
            const poolsFilePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            
            // Load existing pools
            let providerPools = {};
            if (existsSync(poolsFilePath)) {
                try {
                    const fileContent = readFileSync(poolsFilePath, 'utf8');
                    providerPools = JSON.parse(fileContent);
                } catch (readError) {
                    console.warn('[UI API] Failed to read existing provider pools:', readError.message);
                }
            }

            // Ensure provider type array exists
            if (!providerPools[providerType]) {
                providerPools[providerType] = [];
            }

            // Check if already linked - 使用标准化路径进行比较
            const normalizedForComparison = filePath.replace(/\\/g, '/');
            const isAlreadyLinked = providerPools[providerType].some(p => {
                const existingPath = p[credPathKey];
                if (!existingPath) return false;
                const normalizedExistingPath = existingPath.replace(/\\/g, '/');
                return normalizedExistingPath === normalizedForComparison ||
                       normalizedExistingPath === './' + normalizedForComparison ||
                       './' + normalizedExistingPath === normalizedForComparison;
            });

            if (isAlreadyLinked) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'This config file is already linked' } }));
                return true;
            }

            // Create new provider config based on provider type
            const newProvider = createProviderConfig({
                credPathKey,
                credPath: formatSystemPath(filePath),
                defaultCheckModel,
                needsProjectId: providerMapping.needsProjectId
            });

            providerPools[providerType].push(newProvider);

            // Save to file
            writeFileSync(poolsFilePath, JSON.stringify(providerPools, null, 2), 'utf8');
            console.log(`[UI API] Quick linked config: ${filePath} -> ${providerType}`);

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                providerPoolManager.initializeProviderStatus();
            }

            // Broadcast update event
            broadcastEvent('config_update', {
                action: 'quick_link',
                filePath: poolsFilePath,
                providerType,
                newProvider,
                timestamp: new Date().toISOString()
            });

            broadcastEvent('provider_update', {
                action: 'add',
                providerType,
                providerConfig: newProvider,
                timestamp: new Date().toISOString()
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: `Config successfully linked to ${displayName}`,
                provider: newProvider,
                providerType: providerType
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Quick link failed:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Link failed: ' + error.message
                }
            }));
            return true;
        }
    }

    // Get usage limits for all providers
    if (method === 'GET' && pathParam === '/api/usage') {
        try {
            // 解析查询参数，检查是否需要强制刷新
            const url = new URL(req.url, `http://${req.headers.host}`);
            const refresh = url.searchParams.get('refresh') === 'true';
            
            let usageResults;
            
            if (!refresh) {
                // 优先读取缓存
                const cachedData = await readUsageCache();
                if (cachedData) {
                    console.log('[Usage API] Returning cached usage data');
                    usageResults = { ...cachedData, fromCache: true };
                }
            }
            
            if (!usageResults) {
                // 缓存不存在或需要刷新，重新查询
                console.log('[Usage API] Fetching fresh usage data');
                usageResults = await getAllProvidersUsage(currentConfig, providerPoolManager);
                // 写入缓存
                await writeUsageCache(usageResults);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(usageResults));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to get usage:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to get usage info: ' + error.message
                }
            }));
            return true;
        }
    }

    // Get usage limits for a specific provider type
    const usageProviderMatch = pathParam.match(/^\/api\/usage\/([^\/]+)$/);
    if (method === 'GET' && usageProviderMatch) {
        const providerType = decodeURIComponent(usageProviderMatch[1]);
        try {
            // 解析查询参数，检查是否需要强制刷新
            const url = new URL(req.url, `http://${req.headers.host}`);
            const refresh = url.searchParams.get('refresh') === 'true';
            
            let usageResults;
            
            if (!refresh) {
                // Prefer reading from cache
                const cachedData = await readProviderUsageCache(providerType);
                if (cachedData) {
                    console.log(`[Usage API] Returning cached usage data for ${providerType}`);
                    usageResults = cachedData;
                }
            }
            
            if (!usageResults) {
                // Cache does not exist or refresh required, re-query
                console.log(`[Usage API] Fetching fresh usage data for ${providerType}`);
                usageResults = await getProviderTypeUsage(providerType, currentConfig, providerPoolManager);
                // 更新缓存
                await updateProviderUsageCache(providerType, usageResults);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(usageResults));
            return true;
        } catch (error) {
            console.error(`[UI API] Failed to get usage for ${providerType}:`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: `Failed to get usage info for ${providerType}: ` + error.message
                }
            }));
            return true;
        }
    }

    // Check for updates - compare local VERSION with latest git tag
    if (method === 'GET' && pathParam === '/api/check-update') {
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

    // Perform update - git fetch and checkout to latest tag
    if (method === 'POST' && pathParam === '/api/update') {
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

    // Reload configuration files
    if (method === 'POST' && pathParam === '/api/reload-config') {
        try {
            // 调用重载配置函数
            const newConfig = await reloadConfig(providerPoolManager);
            
            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'reload',
                filePath: 'configs/config.json',
                providerPoolsPath: newConfig.PROVIDER_POOLS_FILE_PATH || null,
                timestamp: new Date().toISOString()
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Configuration files reloaded successfully',
                details: {
                    configReloaded: true,
                    configPath: 'configs/config.json',
                    providerPoolsPath: newConfig.PROVIDER_POOLS_FILE_PATH || null
                }
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to reload config files:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to reload configuration files: ' + error.message
                }
            }));
            return true;
        }
    }

    // Restart service (worker process)
    // 重启服务端点 - 支持主进程-子进程架构
    if (method === 'POST' && pathParam === '/api/restart-service') {
        try {
            const IS_WORKER_PROCESS = process.env.IS_WORKER_PROCESS === 'true';
            
            if (IS_WORKER_PROCESS && process.send) {
                // 作为子进程运行，通知主进程重启
                console.log('[UI API] Requesting restart from master process...');
                process.send({ type: 'restart_request' });
                
                // 广播重启事件
                broadcastEvent('service_restart', {
                    action: 'restart_requested',
                    timestamp: new Date().toISOString(),
                    message: 'Service restart requested, worker will be restarted by master process'
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Restart request sent to master process',
                    mode: 'worker',
                    details: {
                        workerPid: process.pid,
                        restartMethod: 'master_controlled'
                    }
                }));
            } else {
                // 独立运行模式，无法自动重启
                console.log('[UI API] Service is running in standalone mode, cannot auto-restart');
                
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    message: 'Service is running in standalone mode. Please use master.js to enable auto-restart feature.',
                    mode: 'standalone',
                    hint: 'Start the service with: node src/master.js [args]'
                }));
            }
            return true;
        } catch (error) {
            console.error('[UI API] Failed to restart service:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to restart service: ' + error.message
                }
            }));
            return true;
        }
    }

    // Get service mode information
    // 获取服务运行模式信息
    if (method === 'GET' && pathParam === '/api/service-mode') {
        const IS_WORKER_PROCESS = process.env.IS_WORKER_PROCESS === 'true';
        const masterPort = process.env.MASTER_PORT || 3100;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            mode: IS_WORKER_PROCESS ? 'worker' : 'standalone',
            pid: process.pid,
            ppid: process.ppid,
            uptime: process.uptime(),
            canAutoRestart: IS_WORKER_PROCESS && !!process.send,
            masterPort: IS_WORKER_PROCESS ? masterPort : null,
            nodeVersion: process.version,
            platform: process.platform
        }));
        return true;
    }

    // Batch import Kiro refresh tokens
    // 批量导入 Kiro refreshToken
    if (method === 'POST' && pathParam === '/api/kiro/batch-import-tokens') {
        try {
            const body = await getRequestBody(req);
            const { refreshTokens, region } = body;
            
            if (!refreshTokens || !Array.isArray(refreshTokens) || refreshTokens.length === 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'refreshTokens array is required and must not be empty'
                }));
                return true;
            }
            
            console.log(`[Kiro Batch Import] Starting batch import of ${refreshTokens.length} tokens...`);
            
            const result = await batchImportKiroRefreshTokens(refreshTokens, region || 'us-east-1');
            
            console.log(`[Kiro Batch Import] Completed: ${result.success} success, ${result.failed} failed`);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                ...result
            }));
            return true;
            
        } catch (error) {
            console.error('[Kiro Batch Import] Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message
            }));
            return true;
        }
    }

    return false;
}

/**
 * Initialize UI management features
 */
export function initializeUIManagement() {
    // Initialize log broadcasting for UI
    if (!global.eventClients) {
        global.eventClients = [];
    }
    if (!global.logBuffer) {
        global.logBuffer = [];
    }

    // Override console.log to broadcast logs
    const originalLog = console.log;
    console.log = function(...args) {
        originalLog.apply(console, args);
        const message = args.map(arg => {
            if (typeof arg === 'string') return arg;
            try {
                return JSON.stringify(arg);
            } catch (e) {
                if (arg instanceof Error) {
                    return `[Error: ${arg.message}] ${arg.stack || ''}`;
                }
                return `[Object: ${Object.prototype.toString.call(arg)}] (Circular or too complex to stringify)`;
            }
        }).join(' ');
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: message
        };
        global.logBuffer.push(logEntry);
        if (global.logBuffer.length > 100) {
            global.logBuffer.shift();
        }
        broadcastEvent('log', logEntry);
    };

    // Override console.error to broadcast errors
    const originalError = console.error;
    console.error = function(...args) {
        originalError.apply(console, args);
        const message = args.map(arg => {
            if (typeof arg === 'string') return arg;
            try {
                return JSON.stringify(arg);
            } catch (e) {
                if (arg instanceof Error) {
                    return `[Error: ${arg.message}] ${arg.stack || ''}`;
                }
                return `[Object: ${Object.prototype.toString.call(arg)}] (Circular or too complex to stringify)`;
            }
        }).join(' ');
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: message
        };
        global.logBuffer.push(logEntry);
        if (global.logBuffer.length > 100) {
            global.logBuffer.shift();
        }
        broadcastEvent('log', logEntry);
    };
}

/**
 * Helper function to broadcast events to UI clients
 * @param {string} eventType - The type of event
 * @param {any} data - The data to broadcast
 */
export function broadcastEvent(eventType, data) {
    if (global.eventClients && global.eventClients.length > 0) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        global.eventClients.forEach(client => {
            client.write(`event: ${eventType}\n`);
            client.write(`data: ${payload}\n\n`);
        });
    }
}

/**
 * Scan and analyze configuration files
 * @param {Object} currentConfig - The current configuration object
 * @param {Object} providerPoolManager - Provider pool manager instance
 * @returns {Promise<Array>} Array of configuration file objects
 */
async function scanConfigFiles(currentConfig, providerPoolManager) {
    const configFiles = [];
    
    // 只扫描configs目录
    const configsPath = path.join(process.cwd(), 'configs');
    
    if (!existsSync(configsPath)) {
        // console.log('[Config Scanner] configs directory not found, creating empty result');
        return configFiles;
    }

    const usedPaths = new Set(); // 存储已使用的路径，用于判断关联状态

    // 从配置中提取所有OAuth凭据文件路径 - 标准化路径格式
    addToUsedPaths(usedPaths, currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.IFLOW_TOKEN_FILE_PATH);

    // 使用最新的提供商池数据
    let providerPools = currentConfig.providerPools;
    if (providerPoolManager && providerPoolManager.providerPools) {
        providerPools = providerPoolManager.providerPools;
    }

    // 检查提供商池文件中的所有OAuth凭据路径 - 标准化路径格式
    if (providerPools) {
        for (const [providerType, providers] of Object.entries(providerPools)) {
            for (const provider of providers) {
                addToUsedPaths(usedPaths, provider.GEMINI_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.KIRO_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.QWEN_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.IFLOW_TOKEN_FILE_PATH);
            }
        }
    }

    try {
        // 扫描configs目录下的所有子目录和文件
        const configsFiles = await scanOAuthDirectory(configsPath, usedPaths, currentConfig);
        configFiles.push(...configsFiles);
    } catch (error) {
        console.warn(`[Config Scanner] Failed to scan configs directory:`, error.message);
    }

    return configFiles;
}

/**
 * Analyze OAuth configuration file and return metadata
 * @param {string} filePath - Full path to the file
 * @param {Set} usedPaths - Set of paths currently in use
 * @returns {Promise<Object|null>} OAuth file information object
 */
async function analyzeOAuthFile(filePath, usedPaths, currentConfig) {
    try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const filename = path.basename(filePath);
        const relativePath = path.relative(process.cwd(), filePath);
        
        // 读取文件内容进行分析
        let content = '';
        let type = 'oauth_credentials';
        let isValid = true;
        let errorMessage = '';
        let oauthProvider = 'unknown';
        let usageInfo = getFileUsageInfo(relativePath, filename, usedPaths, currentConfig);
        
        try {
            if (ext === '.json') {
                const rawContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(rawContent);
                content = rawContent;
                
                // 识别OAuth提供商
                if (jsonData.apiKey || jsonData.api_key) {
                    type = 'api_key';
                } else if (jsonData.client_id || jsonData.client_secret) {
                    oauthProvider = 'oauth2';
                } else if (jsonData.access_token || jsonData.refresh_token) {
                    oauthProvider = 'token_based';
                } else if (jsonData.credentials) {
                    oauthProvider = 'service_account';
                }
                
                if (jsonData.base_url || jsonData.endpoint) {
                    if (jsonData.base_url.includes('openai.com')) {
                        oauthProvider = 'openai';
                    } else if (jsonData.base_url.includes('anthropic.com')) {
                        oauthProvider = 'claude';
                    } else if (jsonData.base_url.includes('googleapis.com')) {
                        oauthProvider = 'gemini';
                    }
                }
            } else {
                content = await fs.readFile(filePath, 'utf8');
                
                if (ext === '.key' || ext === '.pem') {
                    if (content.includes('-----BEGIN') && content.includes('PRIVATE KEY-----')) {
                        oauthProvider = 'private_key';
                    }
                } else if (ext === '.txt') {
                    if (content.includes('api_key') || content.includes('apikey')) {
                        oauthProvider = 'api_key';
                    }
                } else if (ext === '.oauth' || ext === '.creds') {
                    oauthProvider = 'oauth_credentials';
                }
            }
        } catch (readError) {
            isValid = false;
            errorMessage = `Unable to read file: ${readError.message}`;
        }
        
        return {
            name: filename,
            path: relativePath,
            size: stats.size,
            type: type,
            provider: oauthProvider,
            extension: ext,
            modified: stats.mtime.toISOString(),
            isValid: isValid,
            errorMessage: errorMessage,
            isUsed: isPathUsed(relativePath, filename, usedPaths),
            usageInfo: usageInfo, // 新增详细关联信息
            preview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
        };
    } catch (error) {
        console.warn(`[OAuth Analyzer] Failed to analyze file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Get detailed usage information for a file
 * @param {string} relativePath - Relative file path
 * @param {string} fileName - File name
 * @param {Set} usedPaths - Set of used paths
 * @param {Object} currentConfig - Current configuration
 * @returns {Object} Usage information object
 */
function getFileUsageInfo(relativePath, fileName, usedPaths, currentConfig) {
    const usageInfo = {
        isUsed: false,
        usageType: null,
        usageDetails: []
    };

    // 检查是否被使用
    const isUsed = isPathUsed(relativePath, fileName, usedPaths);
    if (!isUsed) {
        return usageInfo;
    }

    usageInfo.isUsed = true;

    // 检查主要配置中的使用情况
    if (currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Gemini OAuth credentials file path',
            configKey: 'GEMINI_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.KIRO_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Kiro OAuth credentials file path',
            configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.QWEN_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Qwen OAuth credentials file path',
            configKey: 'QWEN_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.IFLOW_TOKEN_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.IFLOW_TOKEN_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.IFLOW_TOKEN_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'iFlow Token file path',
            configKey: 'IFLOW_TOKEN_FILE_PATH'
        });
    }

    // 检查提供商池中的使用情况
    if (currentConfig.providerPools) {
        // 使用 flatMap 将双重循环优化为单层循环 O(n)
        const allProviders = Object.entries(currentConfig.providerPools).flatMap(
            ([providerType, providers]) =>
                providers.map((provider, index) => ({ provider, providerType, index }))
        );

        for (const { provider, providerType, index } of allProviders) {
            const providerUsages = [];

            if (provider.GEMINI_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.GEMINI_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.GEMINI_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Gemini OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'GEMINI_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.KIRO_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Kiro OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.QWEN_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.QWEN_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Qwen OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'QWEN_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Antigravity OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.IFLOW_TOKEN_FILE_PATH &&
                (pathsEqual(relativePath, provider.IFLOW_TOKEN_FILE_PATH) ||
                 pathsEqual(relativePath, provider.IFLOW_TOKEN_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `iFlow Token (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'IFLOW_TOKEN_FILE_PATH'
                });
            }
            
            if (providerUsages.length > 0) {
                usageInfo.usageType = 'provider_pool';
                usageInfo.usageDetails.push(...providerUsages);
            }
        }
    }

    // 如果有多个使用位置，标记为多种用途
    if (usageInfo.usageDetails.length > 1) {
        usageInfo.usageType = 'multiple';
    }

    return usageInfo;
}

/**
 * Scan OAuth directory for credential files
 * @param {string} dirPath - Directory path to scan
 * @param {Set} usedPaths - Set of used paths
 * @param {Object} currentConfig - Current configuration
 * @returns {Promise<Array>} Array of OAuth configuration file objects
 */
async function scanOAuthDirectory(dirPath, usedPaths, currentConfig) {
    const oauthFiles = [];
    
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isFile()) {
                const ext = path.extname(file.name).toLowerCase();
                // 只关注OAuth相关的文件类型
                if (['.json', '.oauth', '.creds', '.key', '.pem', '.txt'].includes(ext)) {
                    const fileInfo = await analyzeOAuthFile(fullPath, usedPaths, currentConfig);
                    if (fileInfo) {
                        oauthFiles.push(fileInfo);
                    }
                }
            } else if (file.isDirectory()) {
                // 递归扫描子目录（限制深度）
                const relativePath = path.relative(process.cwd(), fullPath);
                // 最大深度4层，以支持 configs/kiro/{subfolder}/file.json 这样的结构
                if (relativePath.split(path.sep).length < 4) {
                    const subFiles = await scanOAuthDirectory(fullPath, usedPaths, currentConfig);
                    oauthFiles.push(...subFiles);
                }
            }
        }
    } catch (error) {
        console.warn(`[OAuth Scanner] Failed to scan directory ${dirPath}:`, error.message);
    }
    
    return oauthFiles;
}


// 注意：normalizePath, getFileName, pathsEqual, isPathUsed, detectProviderFromPath
// 已移至 provider-utils.js 公共模块

/**
 * 获取所有支持用量查询的提供商的用量信息
 * @param {Object} currentConfig - 当前配置
 * @param {Object} providerPoolManager - 提供商池管理器
 * @returns {Promise<Object>} 所有提供商的用量信息
 */
async function getAllProvidersUsage(currentConfig, providerPoolManager) {
    const results = {
        timestamp: new Date().toISOString(),
        providers: {}
    };

    // 支持用量查询的提供商列表
    const supportedProviders = ['claude-kiro-oauth', 'gemini-cli-oauth', 'gemini-antigravity'];

    // 并发获取所有提供商的用量数据
    const usagePromises = supportedProviders.map(async (providerType) => {
        try {
            const providerUsage = await getProviderTypeUsage(providerType, currentConfig, providerPoolManager);
            return { providerType, data: providerUsage, success: true };
        } catch (error) {
            return {
                providerType,
                data: {
                    error: error.message,
                    instances: []
                },
                success: false
            };
        }
    });

    // 等待所有并发请求完成
    const usageResults = await Promise.all(usagePromises);

    // 将结果整合到 results.providers 中
    for (const result of usageResults) {
        results.providers[result.providerType] = result.data;
    }

    return results;
}

/**
 * 获取指定提供商类型的用量信息
 * @param {string} providerType - 提供商类型
 * @param {Object} currentConfig - 当前配置
 * @param {Object} providerPoolManager - 提供商池管理器
 * @returns {Promise<Object>} 提供商用量信息
 */
async function getProviderTypeUsage(providerType, currentConfig, providerPoolManager) {
    const result = {
        providerType,
        instances: [],
        totalCount: 0,
        successCount: 0,
        errorCount: 0
    };

    // 获取提供商池中的所有实例
    let providers = [];
    if (providerPoolManager && providerPoolManager.providerPools && providerPoolManager.providerPools[providerType]) {
        providers = providerPoolManager.providerPools[providerType];
    } else if (currentConfig.providerPools && currentConfig.providerPools[providerType]) {
        providers = currentConfig.providerPools[providerType];
    }

    result.totalCount = providers.length;

    // 遍历所有提供商实例获取用量
    for (const provider of providers) {
        const providerKey = providerType + (provider.uuid || '');
        let adapter = serviceInstances[providerKey];
        
        const instanceResult = {
            uuid: provider.uuid || 'unknown',
            name: getProviderDisplayName(provider, providerType),
            isHealthy: provider.isHealthy !== false,
            isDisabled: provider.isDisabled === true,
            success: false,
            usage: null,
            error: null
        };

        // First check if disabled, skip initialization for disabled providers
        if (provider.isDisabled) {
            instanceResult.error = 'Provider is disabled';
            result.errorCount++;
        } else if (!adapter) {
            // Service instance not initialized, try auto-initialization
            try {
                console.log(`[Usage API] Auto-initializing service adapter for ${providerType}: ${provider.uuid}`);
                // Build configuration object
                const serviceConfig = {
                    ...CONFIG,
                    ...provider,
                    MODEL_PROVIDER: providerType
                };
                adapter = getServiceAdapter(serviceConfig);
            } catch (initError) {
                console.error(`[Usage API] Failed to initialize adapter for ${providerType}: ${provider.uuid}:`, initError.message);
                instanceResult.error = `Service instance initialization failed: ${initError.message}`;
                result.errorCount++;
            }
        }
        
        // If adapter exists (including just initialized), and no error, try to get usage
        if (adapter && !instanceResult.error) {
            try {
                const usage = await getAdapterUsage(adapter, providerType);
                instanceResult.success = true;
                instanceResult.usage = usage;
                result.successCount++;
            } catch (error) {
                instanceResult.error = error.message;
                result.errorCount++;
            }
        }

        result.instances.push(instanceResult);
    }

    return result;
}

/**
 * 从适配器获取用量信息
 * @param {Object} adapter - 服务适配器
 * @param {string} providerType - 提供商类型
 * @returns {Promise<Object>} 用量信息
 */
async function getAdapterUsage(adapter, providerType) {
    if (providerType === 'claude-kiro-oauth') {
        if (typeof adapter.getUsageLimits === 'function') {
            const rawUsage = await adapter.getUsageLimits();
            return formatKiroUsage(rawUsage);
        } else if (adapter.kiroApiService && typeof adapter.kiroApiService.getUsageLimits === 'function') {
            const rawUsage = await adapter.kiroApiService.getUsageLimits();
            return formatKiroUsage(rawUsage);
        }
        throw new Error('This adapter does not support usage query');
    }
    
    if (providerType === 'gemini-cli-oauth') {
        if (typeof adapter.getUsageLimits === 'function') {
            const rawUsage = await adapter.getUsageLimits();
            return formatGeminiUsage(rawUsage);
        } else if (adapter.geminiApiService && typeof adapter.geminiApiService.getUsageLimits === 'function') {
            const rawUsage = await adapter.geminiApiService.getUsageLimits();
            return formatGeminiUsage(rawUsage);
        }
        throw new Error('This adapter does not support usage query');
    }
    
    if (providerType === 'gemini-antigravity') {
        if (typeof adapter.getUsageLimits === 'function') {
            const rawUsage = await adapter.getUsageLimits();
            return formatAntigravityUsage(rawUsage);
        } else if (adapter.antigravityApiService && typeof adapter.antigravityApiService.getUsageLimits === 'function') {
            const rawUsage = await adapter.antigravityApiService.getUsageLimits();
            return formatAntigravityUsage(rawUsage);
        }
        throw new Error('This adapter does not support usage query');
    }
    
    throw new Error(`Unsupported provider type: ${providerType}`);
}

/**
 * 获取提供商显示名称
 * @param {Object} provider - 提供商配置
 * @param {string} providerType - 提供商类型
 * @returns {string} 显示名称
 */
function getProviderDisplayName(provider, providerType) {
    // 优先使用自定义名称
    if (provider.customName) {
        return provider.customName;
    }

    // 尝试从凭据文件路径提取名称
    const credPathKey = {
        'claude-kiro-oauth': 'KIRO_OAUTH_CREDS_FILE_PATH',
        'gemini-cli-oauth': 'GEMINI_OAUTH_CREDS_FILE_PATH',
        'gemini-antigravity': 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH',
        'openai-qwen-oauth': 'QWEN_OAUTH_CREDS_FILE_PATH',
        'openai-iflow': 'IFLOW_TOKEN_FILE_PATH'
    }[providerType];

    if (credPathKey && provider[credPathKey]) {
        const filePath = provider[credPathKey];
        const fileName = path.basename(filePath);
        const dirName = path.basename(path.dirname(filePath));
        return `${dirName}/${fileName}`;
    }

    return provider.uuid || 'Unnamed';
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
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/tags`;
    
    try {
        console.log('[Update] Fetching latest version from GitHub API...');
        const response = await fetch(apiUrl, {
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
async function checkForUpdates() {
    const versionFilePath = path.join(process.cwd(), 'VERSION');
    
    // 读取本地版本
    let localVersion = 'unknown';
    try {
        if (existsSync(versionFilePath)) {
            localVersion = readFileSync(versionFilePath, 'utf8').trim();
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
async function performUpdate() {
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
        writeFileSync(versionFilePath, newVersion, 'utf8');
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
    const tarballUrl = `https://github.com/${GITHUB_REPO}/archive/refs/tags/${latestTag}.tar.gz`;
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
        const response = await fetch(tarballUrl, {
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
            ? readFileSync(path.join(appDir, 'package.json'), 'utf8')
            : null;
        
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
            const newPackageJson = readFileSync(path.join(appDir, 'package.json'), 'utf8');
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
