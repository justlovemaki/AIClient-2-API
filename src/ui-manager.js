import { existsSync, readFileSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { getRequestBody } from './common.js';
import { CONFIG } from './config-manager.js';

// Token存储在内存中（生产环境建议使用Redis）
const tokenStore = new Map();

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
function verifyToken(token) {
    const tokenInfo = tokenStore.get(token);
    if (!tokenInfo) {
        return null;
    }
    
    // 检查是否过期
    if (Date.now() > tokenInfo.expiryTime) {
        tokenStore.delete(token);
        return null;
    }
    
    return tokenInfo;
}

/**
 * 清理过期的token
 */
function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, info] of tokenStore.entries()) {
        if (now > info.expiryTime) {
            tokenStore.delete(token);
        }
    }
}

/**
 * 读取密码文件内容
 */
async function readPasswordFile() {
    try {
        const password = await fs.readFile('./pwd', 'utf8');
        return password.trim();
    } catch (error) {
        console.error('读取密码文件失败:', error);
        return null;
    }
}

/**
 * 验证登录凭据
 */
async function validateCredentials(password) {
    const storedPassword = await readPasswordFile();
    return storedPassword && password === storedPassword;
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
                reject(new Error('无效的JSON格式'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 检查token验证
 */
function checkAuth(req) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.substring(7);
    const tokenInfo = verifyToken(token);
    
    return tokenInfo !== null;
}

/**
 * 处理登录请求
 */
async function handleLoginRequest(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: '仅支持POST请求' }));
        return true;
    }

    try {
        const requestData = await parseRequestBody(req);
        const { password } = requestData;
        
        if (!password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '密码不能为空' }));
            return true;
        }

        const isValid = await validateCredentials(password);
        
        if (isValid) {
            // 生成简单token
            const token = generateToken();
            const expiryTime = getExpiryTime();
            
            // 存储token信息
            tokenStore.set(token, {
                username: 'admin',
                loginTime: Date.now(),
                expiryTime
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: '登录成功',
                token,
                expiresIn: '1小时'
            }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: '密码错误，请重试'
            }));
        }
    } catch (error) {
        console.error('登录处理错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message || '服务器错误'
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
        cb(new Error('不支持的文件类型'), false);
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
        if (!checkAuth(req)) {
            res.writeHead(401, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end(JSON.stringify({
                error: {
                    message: '未授权访问，请先登录',
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
                console.error('文件上传错误:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: err.message || '文件上传失败'
                    }
                }));
                return;
            }

            try {
                if (!req.file) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: {
                            message: '没有文件被上传'
                        }
                    }));
                    return;
                }

                // multer执行完成后，表单字段已解析到req.body中
                const provider = req.body.provider || 'common';
                const tempFilePath = req.file.path;
                
                // 根据实际的provider移动文件到正确的目录
                const targetDir = path.join(process.cwd(), 'configs', provider);
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

                console.log(`[UI API] OAuth凭据文件已上传: ${targetFilePath} (提供商: ${provider})`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: '文件上传成功',
                    filePath: relativePath,
                    originalName: req.file.originalname,
                    provider: provider
                }));

            } catch (error) {
                console.error('文件上传处理错误:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: '文件上传处理失败: ' + error.message
                    }
                }));
            }
        });
        return true;
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
            if (newConfig.PROJECT_ID !== undefined) currentConfig.PROJECT_ID = newConfig.PROJECT_ID;
            if (newConfig.OPENAI_API_KEY !== undefined) currentConfig.OPENAI_API_KEY = newConfig.OPENAI_API_KEY;
            if (newConfig.OPENAI_BASE_URL !== undefined) currentConfig.OPENAI_BASE_URL = newConfig.OPENAI_BASE_URL;
            if (newConfig.CLAUDE_API_KEY !== undefined) currentConfig.CLAUDE_API_KEY = newConfig.CLAUDE_API_KEY;
            if (newConfig.CLAUDE_BASE_URL !== undefined) currentConfig.CLAUDE_BASE_URL = newConfig.CLAUDE_BASE_URL;
            if (newConfig.GEMINI_OAUTH_CREDS_BASE64 !== undefined) currentConfig.GEMINI_OAUTH_CREDS_BASE64 = newConfig.GEMINI_OAUTH_CREDS_BASE64;
            if (newConfig.GEMINI_OAUTH_CREDS_FILE_PATH !== undefined) currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH = newConfig.GEMINI_OAUTH_CREDS_FILE_PATH;
            if (newConfig.KIRO_OAUTH_CREDS_BASE64 !== undefined) currentConfig.KIRO_OAUTH_CREDS_BASE64 = newConfig.KIRO_OAUTH_CREDS_BASE64;
            if (newConfig.KIRO_OAUTH_CREDS_FILE_PATH !== undefined) currentConfig.KIRO_OAUTH_CREDS_FILE_PATH = newConfig.KIRO_OAUTH_CREDS_FILE_PATH;
            if (newConfig.QWEN_OAUTH_CREDS_FILE_PATH !== undefined) currentConfig.QWEN_OAUTH_CREDS_FILE_PATH = newConfig.QWEN_OAUTH_CREDS_FILE_PATH;
            if (newConfig.SYSTEM_PROMPT_FILE_PATH !== undefined) currentConfig.SYSTEM_PROMPT_FILE_PATH = newConfig.SYSTEM_PROMPT_FILE_PATH;
            if (newConfig.SYSTEM_PROMPT_MODE !== undefined) currentConfig.SYSTEM_PROMPT_MODE = newConfig.SYSTEM_PROMPT_MODE;
            if (newConfig.PROMPT_LOG_BASE_NAME !== undefined) currentConfig.PROMPT_LOG_BASE_NAME = newConfig.PROMPT_LOG_BASE_NAME;
            if (newConfig.PROMPT_LOG_MODE !== undefined) currentConfig.PROMPT_LOG_MODE = newConfig.PROMPT_LOG_MODE;
            if (newConfig.REQUEST_MAX_RETRIES !== undefined) currentConfig.REQUEST_MAX_RETRIES = newConfig.REQUEST_MAX_RETRIES;
            if (newConfig.REQUEST_BASE_DELAY !== undefined) currentConfig.REQUEST_BASE_DELAY = newConfig.REQUEST_BASE_DELAY;
            if (newConfig.CRON_NEAR_MINUTES !== undefined) currentConfig.CRON_NEAR_MINUTES = newConfig.CRON_NEAR_MINUTES;
            if (newConfig.CRON_REFRESH_TOKEN !== undefined) currentConfig.CRON_REFRESH_TOKEN = newConfig.CRON_REFRESH_TOKEN;
            if (newConfig.PROVIDER_POOLS_FILE_PATH !== undefined) currentConfig.PROVIDER_POOLS_FILE_PATH = newConfig.PROVIDER_POOLS_FILE_PATH;

            // Handle system prompt update
            if (newConfig.systemPrompt !== undefined) {
                const promptPath = currentConfig.SYSTEM_PROMPT_FILE_PATH || 'input_system_prompt.txt';
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
                const configPath = 'config.json';
                
                // Create a clean config object for saving (exclude runtime-only properties)
                const configToSave = {
                    REQUIRED_API_KEY: currentConfig.REQUIRED_API_KEY,
                    SERVER_PORT: currentConfig.SERVER_PORT,
                    HOST: currentConfig.HOST,
                    MODEL_PROVIDER: currentConfig.MODEL_PROVIDER,
                    OPENAI_API_KEY: currentConfig.OPENAI_API_KEY,
                    OPENAI_BASE_URL: currentConfig.OPENAI_BASE_URL,
                    CLAUDE_API_KEY: currentConfig.CLAUDE_API_KEY,
                    CLAUDE_BASE_URL: currentConfig.CLAUDE_BASE_URL,
                    PROJECT_ID: currentConfig.PROJECT_ID,
                    GEMINI_OAUTH_CREDS_BASE64: currentConfig.GEMINI_OAUTH_CREDS_BASE64,
                    GEMINI_OAUTH_CREDS_FILE_PATH: currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH,
                    KIRO_OAUTH_CREDS_BASE64: currentConfig.KIRO_OAUTH_CREDS_BASE64,
                    KIRO_OAUTH_CREDS_FILE_PATH: currentConfig.KIRO_OAUTH_CREDS_FILE_PATH,
                    QWEN_OAUTH_CREDS_FILE_PATH: currentConfig.QWEN_OAUTH_CREDS_FILE_PATH,
                    SYSTEM_PROMPT_FILE_PATH: currentConfig.SYSTEM_PROMPT_FILE_PATH,
                    SYSTEM_PROMPT_MODE: currentConfig.SYSTEM_PROMPT_MODE,
                    PROMPT_LOG_BASE_NAME: currentConfig.PROMPT_LOG_BASE_NAME,
                    PROMPT_LOG_MODE: currentConfig.PROMPT_LOG_MODE,
                    REQUEST_MAX_RETRIES: currentConfig.REQUEST_MAX_RETRIES,
                    REQUEST_BASE_DELAY: currentConfig.REQUEST_BASE_DELAY,
                    CRON_NEAR_MINUTES: currentConfig.CRON_NEAR_MINUTES,
                    CRON_REFRESH_TOKEN: currentConfig.CRON_REFRESH_TOKEN,
                    PROVIDER_POOLS_FILE_PATH: currentConfig.PROVIDER_POOLS_FILE_PATH
                };

                writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
                console.log('[UI API] Configuration saved to config.json');
                
                // 广播更新事件
                broadcastEvent('config_update', {
                    action: 'update',
                    filePath: 'config.json',
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            nodeVersion: process.version,
            serverTime: new Date().toLocaleString(),
            memoryUsage: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
            uptime: process.uptime()
        }));
        return true;
    }

    // Get provider pools summary
    if (method === 'GET' && pathParam === '/api/providers') {
        let providerPools = {};
        try {
            if (providerPoolManager && providerPoolManager.providerPools) {
                providerPools = providerPoolManager.providerPools;
            } else if (currentConfig.PROVIDER_POOLS_FILE_PATH && existsSync(currentConfig.PROVIDER_POOLS_FILE_PATH)) {
                const poolsData = JSON.parse(readFileSync(currentConfig.PROVIDER_POOLS_FILE_PATH, 'utf-8'));
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
        
        try {
            if (providerPoolManager && providerPoolManager.providerPools) {
                providerPools = providerPoolManager.providerPools;
            } else if (currentConfig.PROVIDER_POOLS_FILE_PATH && existsSync(currentConfig.PROVIDER_POOLS_FILE_PATH)) {
                const poolsData = JSON.parse(readFileSync(currentConfig.PROVIDER_POOLS_FILE_PATH, 'utf-8'));
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
                providerConfig.uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
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

            // Update CONFIG cache to maintain consistency
            CONFIG.providerPools = providerPools;

            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'add',
                filePath: filePath,
                providerType,
                providerConfig,
                timestamp: new Date().toISOString()
            });

            // 广播供应商更新事件
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

            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
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

            // Update CONFIG cache to maintain consistency
            CONFIG.providerPools = providerPools;

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
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
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

            // Update CONFIG cache to maintain consistency
            CONFIG.providerPools = providerPools;

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
            const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
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

            // Update CONFIG cache to maintain consistency
            CONFIG.providerPools = providerPools;

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
                        message: '访问被拒绝：只能查看configs目录下的文件'
                    }
                }));
                return true;
            }
            
            if (!existsSync(fullPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: '文件不存在'
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
                        message: '访问被拒绝：只能删除configs目录下的文件'
                    }
                }));
                return true;
            }
            
            if (!existsSync(fullPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: '文件不存在'
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
                message: '文件删除成功',
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

    // Reload configuration files
    if (method === 'POST' && pathParam === '/api/reload-config') {
        try {
            // Import config manager dynamically
            const { initializeConfig } = await import('./config-manager.js');
            
            // Reload main config
            const newConfig = await initializeConfig(process.argv.slice(2), 'config.json');
            
            // Update global CONFIG
            Object.assign(CONFIG, newConfig);
            
            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'reload',
                filePath: 'config.json',
                providerPoolsPath: newConfig.PROVIDER_POOLS_FILE_PATH || null,
                timestamp: new Date().toISOString()
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: '配置文件重新加载成功',
                details: {
                    configReloaded: true,
                    configPath: 'config.json',
                    providerPoolsPath: newConfig.PROVIDER_POOLS_FILE_PATH || null
                }
            }));
            return true;
        } catch (error) {
            console.error('[UI API] Failed to reload config files:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: '重新加载配置文件失败: ' + error.message
                }
            }));
            return true;
        }
    }

    return false;
}

/**
 * Initialize UI management features
 * @param {Object} config - The server configuration
 */
export function initializeUIManagement(config) {
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
        const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
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
        const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
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
    if (currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH) {
        const normalizedPath = currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
        usedPaths.add(currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH);
        usedPaths.add(normalizedPath);
        if (normalizedPath.startsWith('./')) {
            usedPaths.add(normalizedPath.slice(2));
        }
    }
    if (currentConfig.KIRO_OAUTH_CREDS_FILE_PATH) {
        const normalizedPath = currentConfig.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
        usedPaths.add(currentConfig.KIRO_OAUTH_CREDS_FILE_PATH);
        usedPaths.add(normalizedPath);
        if (normalizedPath.startsWith('./')) {
            usedPaths.add(normalizedPath.slice(2));
        }
    }
    if (currentConfig.QWEN_OAUTH_CREDS_FILE_PATH) {
        const normalizedPath = currentConfig.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
        usedPaths.add(currentConfig.QWEN_OAUTH_CREDS_FILE_PATH);
        usedPaths.add(normalizedPath);
        if (normalizedPath.startsWith('./')) {
            usedPaths.add(normalizedPath.slice(2));
        }
    }

    // 使用最新的供应商池数据
    let providerPools = currentConfig.providerPools;
    if (providerPoolManager && providerPoolManager.providerPools) {
        providerPools = providerPoolManager.providerPools;
    }

    // 检查供应商池文件中的所有OAuth凭据路径 - 标准化路径格式
    if (providerPools) {
        for (const [providerType, providers] of Object.entries(providerPools)) {
            for (const provider of providers) {
                if (provider.GEMINI_OAUTH_CREDS_FILE_PATH) {
                    const normalizedPath = provider.GEMINI_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
                    usedPaths.add(provider.GEMINI_OAUTH_CREDS_FILE_PATH);
                    usedPaths.add(normalizedPath);
                    if (normalizedPath.startsWith('./')) {
                        usedPaths.add(normalizedPath.slice(2));
                    }
                }
                if (provider.KIRO_OAUTH_CREDS_FILE_PATH) {
                    const normalizedPath = provider.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
                    usedPaths.add(provider.KIRO_OAUTH_CREDS_FILE_PATH);
                    usedPaths.add(normalizedPath);
                    if (normalizedPath.startsWith('./')) {
                        usedPaths.add(normalizedPath.slice(2));
                    }
                }
                if (provider.QWEN_OAUTH_CREDS_FILE_PATH) {
                    const normalizedPath = provider.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
                    usedPaths.add(provider.QWEN_OAUTH_CREDS_FILE_PATH);
                    usedPaths.add(normalizedPath);
                    if (normalizedPath.startsWith('./')) {
                        usedPaths.add(normalizedPath.slice(2));
                    }
                }
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
            errorMessage = `无法读取文件: ${readError.message}`;
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
            type: '主要配置',
            location: 'Gemini OAuth凭据文件路径',
            configKey: 'GEMINI_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.KIRO_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: '主要配置',
            location: 'Kiro OAuth凭据文件路径',
            configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.QWEN_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: '主要配置',
            location: 'Qwen OAuth凭据文件路径',
            configKey: 'QWEN_OAUTH_CREDS_FILE_PATH'
        });
    }

    // 检查供应商池中的使用情况
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
                    type: '供应商池',
                    location: `Gemini OAuth凭据 (节点${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'GEMINI_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.KIRO_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: '供应商池',
                    location: `Kiro OAuth凭据 (节点${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.QWEN_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.QWEN_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: '供应商池',
                    location: `Qwen OAuth凭据 (节点${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    configKey: 'QWEN_OAUTH_CREDS_FILE_PATH'
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
                if (relativePath.split(path.sep).length < 3) { // 最大深度3层
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


/**
 * Normalize a path for cross-platform compatibility
 * @param {string} filePath - The file path to normalize
 * @returns {string} Normalized path using forward slashes
 */
function normalizePath(filePath) {
    if (!filePath) return filePath;
    
    // Use path module to normalize and then convert to forward slashes
    const normalized = path.normalize(filePath);
    return normalized.replace(/\\/g, '/');
}

/**
 * Extract filename from any path format
 * @param {string} filePath - The file path
 * @returns {string} Filename
 */
function getFileName(filePath) {
    return path.basename(filePath);
}

/**
 * Check if two paths refer to the same file (cross-platform compatible)
 * @param {string} path1 - First path
 * @param {string} path2 - Second path
 * @returns {boolean} True if paths refer to same file
 */
function pathsEqual(path1, path2) {
    if (!path1 || !path2) return false;
    
    try {
        // Normalize both paths
        const normalized1 = normalizePath(path1);
        const normalized2 = normalizePath(path2);
        
        // Direct match
        if (normalized1 === normalized2) {
            return true;
        }
        
        // Remove leading './' if present
        const clean1 = normalized1.replace(/^\.\//, '');
        const clean2 = normalized2.replace(/^\.\//, '');
        
        if (clean1 === clean2) {
            return true;
        }
        
        // Check if one is a subset of the other (for relative vs absolute)
        if (normalized1.endsWith('/' + clean2) || normalized2.endsWith('/' + clean1)) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.warn(`[Path Comparison] Error comparing paths: ${path1} vs ${path2}`, error.message);
        return false;
    }
}

/**
 * Check if a file path is being used (cross-platform compatible)
 * @param {string} relativePath - Relative path
 * @param {string} fileName - File name
 * @param {Set} usedPaths - Set of used paths
 * @returns {boolean} True if the file is being used
 */
function isPathUsed(relativePath, fileName, usedPaths) {
    if (!relativePath) return false;
    
    // Normalize the relative path
    const normalizedRelativePath = normalizePath(relativePath);
    const cleanRelativePath = normalizedRelativePath.replace(/^\.\//, '');
    
    // Get the filename from relative path
    const relativeFileName = getFileName(normalizedRelativePath);
    
    // 遍历所有已使用路径进行匹配
    for (const usedPath of usedPaths) {
        if (!usedPath) continue;
        
        // 1. 直接路径匹配
        if (pathsEqual(relativePath, usedPath) || pathsEqual(relativePath, './' + usedPath)) {
            return true;
        }
        
        // 2. 标准化路径匹配
        if (pathsEqual(normalizedRelativePath, usedPath) ||
            pathsEqual(normalizedRelativePath, './' + usedPath)) {
            return true;
        }
        
        // 3. 清理后的路径匹配
        if (pathsEqual(cleanRelativePath, usedPath) ||
            pathsEqual(cleanRelativePath, './' + usedPath)) {
            return true;
        }
        
        // 4. 文件名匹配（确保不是误匹配）
        const usedFileName = getFileName(usedPath);
        if (usedFileName === fileName || usedFileName === relativeFileName) {
            // 确保是同一个目录下的文件
            const usedDir = path.dirname(usedPath);
            const relativeDir = path.dirname(normalizedRelativePath);
            
            if (pathsEqual(usedDir, relativeDir) ||
                pathsEqual(usedDir, cleanRelativePath.replace(/\/[^\/]+$/, '')) ||
                pathsEqual(relativeDir.replace(/^\.\//, ''), usedDir.replace(/^\.\//, ''))) {
                return true;
            }
        }
        
        // 5. 绝对路径匹配（Windows和Unix）
        try {
            const resolvedUsedPath = path.resolve(usedPath);
            const resolvedRelativePath = path.resolve(relativePath);
            
            if (resolvedUsedPath === resolvedRelativePath) {
                return true;
            }
        } catch (error) {
            // Ignore path resolution errors
        }
    }
    
    return false;
}