/**
 * API 大锅饭 - 管理 API 路由
 * 提供 Key 管理的 RESTful API 和用户端查询 API
 */

import {
    createKey,
    listKeys,
    getKey,
    deleteKey,
    updateKeyLimit,
    resetKeyUsage,
    toggleKey,
    updateKeyName,
    regenerateKey,
    getStats,
    validateKey,
    KEY_PREFIX,
    setConfigGetter,
    updateBonusRemaining,
    applyDailyLimitToAllKeys,
    getAllKeyIds
} from './key-manager.js';
import {
    getUserCredentials,
    addUserCredential,
    migrateUserCredentials,
    getAllUsersCredentials,
    syncCredentialBonuses,
    getBonusDetails,
    getConfig,
    updateConfig,
    getAllUserApiKeys
} from './user-data-manager.js';
import path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import multer from 'multer';
import { batchImportKiroRefreshTokensStream, importAwsCredentials } from '../../auth/oauth-handlers.js';
import { autoLinkProviderConfigs, getProviderPoolManager } from '../../services/service-manager.js';
import { CONFIG } from '../../core/config-manager.js';

/**
 * 解析请求体
 * @param {http.IncomingMessage} req
 * @returns {Promise<Object>}
 */
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error('Invalid JSON format'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 发送 JSON 响应
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {Object} data
 */
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/**
 * 验证管理员 Token
 * @param {http.IncomingMessage} req
 * @returns {Promise<boolean>}
 */
async function checkAdminAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }
    
    // 动态导入 ui-manager 中的 token 验证逻辑
    try {
        const { existsSync, readFileSync } = await import('fs');
        const { promises: fs } = await import('fs');
        const path = await import('path');
        
        const TOKEN_STORE_FILE = path.join(process.cwd(), 'configs', 'token-store.json');
        
        if (!existsSync(TOKEN_STORE_FILE)) {
            return false;
        }
        
        const content = readFileSync(TOKEN_STORE_FILE, 'utf8');
        const tokenStore = JSON.parse(content);
        const token = authHeader.substring(7);
        const tokenInfo = tokenStore.tokens[token];
        
        if (!tokenInfo) {
            return false;
        }
        
        // 检查是否过期
        if (Date.now() > tokenInfo.expiryTime) {
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('[API Potluck] Auth check error:', error.message);
        return false;
    }
}

/**
 * 处理 Potluck 管理 API 请求
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @returns {Promise<boolean>} - 是否处理了请求
 */
export async function handlePotluckApiRoutes(method, path, req, res) {
    // 只处理 /api/potluck 开头的请求
    if (!path.startsWith('/api/potluck')) {
        return false;
    }
    console.log('[API Potluck] Handling request:', method, path);
    
    // 验证管理员权限
    const isAuthed = await checkAdminAuth(req);
    if (!isAuthed) {
        sendJson(res, 401, { 
            success: false, 
            error: { message: 'Unauthorized: Please login first', code: 'UNAUTHORIZED' } 
        });
        return true;
    }

    try {
        // GET /api/potluck/stats - 获取统计信息
        if (method === 'GET' && path === '/api/potluck/stats') {
            const stats = await getStats();
            sendJson(res, 200, { success: true, data: stats });
            return true;
        }

        // GET /api/potluck/keys - 获取所有 Key 列表
        if (method === 'GET' && path === '/api/potluck/keys') {
            const keys = await listKeys();
            const stats = await getStats();
            const config = getConfig();
            sendJson(res, 200, { 
                success: true, 
                data: { 
                    keys, 
                    stats,
                    config
                } 
            });
            return true;
        }

        // GET /api/potluck/config - 获取配置
        if (method === 'GET' && path === '/api/potluck/config') {
            const config = getConfig();
            sendJson(res, 200, { 
                success: true, 
                data: config
            });
            return true;
        }

        // PUT /api/potluck/config - 更新配置
        if (method === 'PUT' && path === '/api/potluck/config') {
            const body = await parseRequestBody(req);
            const { defaultDailyLimit, bonusPerCredential, bonusValidityDays, persistInterval } = body;
            
            // 验证参数
            if (defaultDailyLimit !== undefined && (typeof defaultDailyLimit !== 'number' || defaultDailyLimit < 1)) {
                sendJson(res, 400, { success: false, error: { message: 'defaultDailyLimit must be a positive number' } });
                return true;
            }
            if (bonusPerCredential !== undefined && (typeof bonusPerCredential !== 'number' || bonusPerCredential < 0)) {
                sendJson(res, 400, { success: false, error: { message: 'bonusPerCredential must be a non-negative number' } });
                return true;
            }
            if (bonusValidityDays !== undefined && (typeof bonusValidityDays !== 'number' || bonusValidityDays < 1)) {
                sendJson(res, 400, { success: false, error: { message: 'bonusValidityDays must be a positive number' } });
                return true;
            }
            if (persistInterval !== undefined && (typeof persistInterval !== 'number' || persistInterval < 1000)) {
                sendJson(res, 400, { success: false, error: { message: 'persistInterval must be at least 1000ms' } });
                return true;
            }
            
            const newConfig = await updateConfig({ defaultDailyLimit, bonusPerCredential, bonusValidityDays, persistInterval });
            sendJson(res, 200, { 
                success: true, 
                message: 'Config updated successfully',
                data: newConfig
            });
            return true;
        }

        // POST /api/potluck/keys/apply-limit - 批量应用每日限额到所有 Key
        if (method === 'POST' && path === '/api/potluck/keys/apply-limit') {
            const config = getConfig();
            const result = await applyDailyLimitToAllKeys(config.defaultDailyLimit);
            sendJson(res, 200, {
                success: true,
                message: `已将每日限额 ${config.defaultDailyLimit} 应用到 ${result.updated}/${result.total} 个 Key`,
                data: result
            });
            return true;
        }

        // POST /api/potluck/keys/apply-bonus - 批量同步所有用户的资源包
        if (method === 'POST' && path === '/api/potluck/keys/apply-bonus') {
            const allKeyIds = getAllKeyIds();
            let totalSynced = 0;
            let totalBonusUpdated = 0;
            
            for (const apiKey of allKeyIds) {
                try {
                    // 获取用户凭据并检查健康状态
                    const credentials = getUserCredentials(apiKey);
                    if (credentials.length === 0) continue;
                    
                    // 构建带健康状态的凭证列表（从主服务同步）
                    const credentialsWithHealth = [];
                    for (const cred of credentials) {
                        const healthResult = await syncCredentialHealthFromPool(apiKey, cred);
                        credentialsWithHealth.push({
                            id: cred.id,
                            isHealthy: healthResult.isHealthy,
                            addedAt: cred.addedAt
                        });
                    }
                    
                    // 同步资源包
                    const bonusSync = await syncCredentialBonuses(apiKey, credentialsWithHealth);
                    await updateBonusRemaining(apiKey, bonusSync.bonusRemaining);
                    
                    totalSynced++;
                    if (bonusSync.added > 0 || bonusSync.removed > 0) {
                        totalBonusUpdated++;
                    }
                } catch (error) {
                    console.warn(`[API Potluck] Failed to sync bonus for ${apiKey.substring(0, 12)}...:`, error.message);
                }
            }
            
            sendJson(res, 200, {
                success: true,
                message: `已同步 ${totalSynced} 个用户的资源包，${totalBonusUpdated} 个有变更`,
                data: { totalKeys: allKeyIds.length, synced: totalSynced, updated: totalBonusUpdated }
            });
            return true;
        }

        // POST /api/potluck/keys - 创建新 Key
        if (method === 'POST' && path === '/api/potluck/keys') {
            const body = await parseRequestBody(req);
            const { name, dailyLimit } = body;
            const keyData = await createKey(name, dailyLimit);
            sendJson(res, 201, { 
                success: true, 
                message: 'API Key created successfully',
                data: keyData 
            });
            return true;
        }

        // 处理带 keyId 的路由
        const keyIdMatch = path.match(/^\/api\/potluck\/keys\/([^\/]+)(\/.*)?$/);
        if (keyIdMatch) {
            const keyId = decodeURIComponent(keyIdMatch[1]);
            const subPath = keyIdMatch[2] || '';

            // GET /api/potluck/keys/:keyId - 获取单个 Key 详情
            if (method === 'GET' && !subPath) {
                const keyData = await getKey(keyId);
                if (!keyData) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { success: true, data: keyData });
                return true;
            }

            // DELETE /api/potluck/keys/:keyId - 删除 Key
            if (method === 'DELETE' && !subPath) {
                const deleted = await deleteKey(keyId);
                if (!deleted) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { success: true, message: 'Key deleted successfully' });
                return true;
            }

            // PUT /api/potluck/keys/:keyId/limit - 更新每日限额
            if (method === 'PUT' && subPath === '/limit') {
                const body = await parseRequestBody(req);
                const { dailyLimit } = body;
                
                if (typeof dailyLimit !== 'number' || dailyLimit < 0) {
                    sendJson(res, 400, { 
                        success: false, 
                        error: { message: 'Invalid dailyLimit value' } 
                    });
                    return true;
                }

                const keyData = await updateKeyLimit(keyId, dailyLimit);
                if (!keyData) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { 
                    success: true, 
                    message: 'Daily limit updated successfully',
                    data: keyData 
                });
                return true;
            }

            // POST /api/potluck/keys/:keyId/reset - 重置当天调用次数
            if (method === 'POST' && subPath === '/reset') {
                const keyData = await resetKeyUsage(keyId);
                if (!keyData) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { 
                    success: true, 
                    message: 'Usage reset successfully',
                    data: keyData 
                });
                return true;
            }

            // POST /api/potluck/keys/:keyId/toggle - 切换启用/禁用状态
            if (method === 'POST' && subPath === '/toggle') {
                const keyData = await toggleKey(keyId);
                if (!keyData) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { 
                    success: true, 
                    message: `Key ${keyData.enabled ? 'enabled' : 'disabled'} successfully`,
                    data: keyData 
                });
                return true;
            }

            // PUT /api/potluck/keys/:keyId/name - 更新 Key 名称
            if (method === 'PUT' && subPath === '/name') {
                const body = await parseRequestBody(req);
                const { name } = body;
                
                if (!name || typeof name !== 'string') {
                    sendJson(res, 400, { 
                        success: false, 
                        error: { message: 'Invalid name value' } 
                    });
                    return true;
                }

                const keyData = await updateKeyName(keyId, name);
                if (!keyData) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { 
                    success: true, 
                    message: 'Name updated successfully',
                    data: keyData 
                });
                return true;
            }

            // POST /api/potluck/keys/:keyId/regenerate - 重新生成 Key
            if (method === 'POST' && subPath === '/regenerate') {
                const result = await regenerateKey(keyId);
                if (!result) {
                    sendJson(res, 404, { success: false, error: { message: 'Key not found' } });
                    return true;
                }
                sendJson(res, 200, { 
                    success: true, 
                    message: 'Key regenerated successfully',
                    data: {
                        oldKey: result.oldKey,
                        newKey: result.newKey,
                        keyData: result.keyData
                    }
                });
                return true;
            }
        }

        // 未匹配的 potluck 路由
        sendJson(res, 404, { success: false, error: { message: 'Potluck API endpoint not found' } });
        return true;

    } catch (error) {
        console.error('[API Potluck] API error:', error);
        sendJson(res, 500, {
            success: false,
            error: { message: error.message || 'Internal server error' }
        });
        return true;
    }
}

/**
 * 从请求中提取 Potluck API Key
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @returns {string|null}
 */
function extractApiKeyFromRequest(req) {
    // 1. 检查 Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token.startsWith(KEY_PREFIX)) {
            return token;
        }
    }

    // 2. 检查 x-api-key header
    const xApiKey = req.headers['x-api-key'];
    if (xApiKey && xApiKey.startsWith(KEY_PREFIX)) {
        return xApiKey;
    }

    return null;
}

/**
 * 处理用户端 API 请求 - 用户通过自己的 API Key 查询使用量
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @returns {Promise<boolean>} - 是否处理了请求
 */
export async function handlePotluckUserApiRoutes(method, path, req, res) {
    // 只处理 /api/potluckuser 开头的请求
    if (!path.startsWith('/api/potluckuser')) {
        return false;
    }
    console.log('[API Potluck User] Handling request:', method, path);

    try {
        // 从请求中提取 API Key
        const apiKey = extractApiKeyFromRequest(req);
        
        if (!apiKey) {
            sendJson(res, 401, {
                success: false,
                error: {
                    message: 'API Key required. Please provide your API Key in Authorization header (Bearer maki_xxx) or x-api-key header.',
                    code: 'API_KEY_REQUIRED'
                }
            });
            return true;
        }

        // 验证 API Key
        const validation = await validateKey(apiKey);
        
        if (!validation.valid && validation.reason !== 'quota_exceeded') {
            const errorMessages = {
                'invalid_format': 'Invalid API key format',
                'not_found': 'API key not found',
                'disabled': 'API key has been disabled'
            };
            
            sendJson(res, 401, {
                success: false,
                error: {
                    message: errorMessages[validation.reason] || 'Invalid API key',
                    code: validation.reason
                }
            });
            return true;
        }

        // GET /api/potluckuser/usage - 获取当前用户的使用量信息
        if (method === 'GET' && path === '/api/potluckuser/usage') {
            const keyData = await getKey(apiKey);
            
            if (!keyData) {
                sendJson(res, 404, {
                    success: false,
                    error: { message: 'Key not found', code: 'KEY_NOT_FOUND' }
                });
                return true;
            }

            // 计算使用百分比
            const usagePercent = keyData.dailyLimit > 0
                ? Math.round((keyData.todayUsage / keyData.dailyLimit) * 100)
                : 0;

            // 获取资源包详情
            const bonusDetails = getBonusDetails(apiKey);
            const bonusTotal = bonusDetails.bonuses.length * bonusDetails.bonusPerCredential;
            const bonusUsed = bonusDetails.bonuses.reduce((sum, b) => sum + b.usedCount, 0);

            // 返回用户友好的使用量信息（隐藏敏感信息）
            sendJson(res, 200, {
                success: true,
                data: {
                    name: keyData.name,
                    enabled: keyData.enabled,
                    usage: {
                        today: keyData.todayUsage,
                        limit: keyData.dailyLimit,
                        remaining: Math.max(0, keyData.dailyLimit - keyData.todayUsage),
                        percent: usagePercent,
                        resetDate: keyData.lastResetDate
                    },
                    bonusRemaining: keyData.bonusRemaining || 0,
                    bonusTotal: bonusTotal,
                    bonusUsed: bonusUsed,
                    total: keyData.totalUsage,
                    lastUsedAt: keyData.lastUsedAt,
                    createdAt: keyData.createdAt,
                    // 显示部分遮蔽的 Key ID
                    maskedKey: `${apiKey.substring(0, 12)}...${apiKey.substring(apiKey.length - 4)}`
                }
            });
            return true;
        }

        // POST /api/potluckuser/upload - 上传授权文件
        if (method === 'POST' && path === '/api/potluckuser/upload') {
            return await handleUserUpload(req, res, apiKey);
        }

        // POST /api/potluckuser/regenerate-key - 用户重置自己的 API Key
        if (method === 'POST' && path === '/api/potluckuser/regenerate-key') {
            const result = await regenerateKey(apiKey);
            if (!result) {
                sendJson(res, 404, {
                    success: false,
                    error: { message: 'Key not found' }
                });
                return true;
            }
            
            // 同时迁移用户的凭据数据到新 Key
            await migrateUserCredentials(apiKey, result.newKey);
            
            sendJson(res, 200, {
                success: true,
                message: 'API Key regenerated successfully',
                data: {
                    newKey: result.newKey,
                    maskedNewKey: `${result.newKey.substring(0, 12)}...${result.newKey.substring(result.newKey.length - 4)}`
                }
            });
            return true;
        }

        // POST /api/potluckuser/kiro/batch-import-tokens - 批量导入 Kiro refresh token
        if (method === 'POST' && path === '/api/potluckuser/kiro/batch-import-tokens') {
            return await handleKiroBatchImportTokens(req, res, apiKey);
        }

        // POST /api/potluckuser/kiro/import-aws-credentials - 导入 AWS SSO 凭据
        if (method === 'POST' && path === '/api/potluckuser/kiro/import-aws-credentials') {
            return await handleKiroImportAwsCredentials(req, res, apiKey);
        }

        // GET /api/potluckuser/credentials - 获取用户的凭据列表
        if (method === 'GET' && path === '/api/potluckuser/credentials') {
            const credentials = getUserCredentials(apiKey);
            const bonusDetails = getBonusDetails(apiKey);
            
            // 将资源包信息附加到对应凭证
            const credentialsWithBonus = credentials.map(cred => {
                const bonus = bonusDetails.bonuses.find(b => b.credentialId === cred.id);
                return {
                    ...cred,
                    bonus: bonus ? {
                        usedCount: bonus.usedCount,
                        remaining: bonus.remaining,
                        total: bonusDetails.bonusPerCredential,
                        expiresAt: bonus.expiresAt
                    } : null
                };
            });
            
            sendJson(res, 200, {
                success: true,
                data: credentialsWithBonus
            });
            return true;
        }

        // POST /api/potluckuser/credentials/check-all - 批量检查所有凭据健康状态
        if (method === 'POST' && path === '/api/potluckuser/credentials/check-all') {
            const results = await checkUserCredentialsHealth(apiKey);
            const credentials = getUserCredentials(apiKey);
            const bonusDetails = getBonusDetails(apiKey);
            
            // 将资源包信息附加到对应凭证
            const credentialsWithBonus = credentials.map(cred => {
                const healthResult = results.find(r => r.id === cred.id);
                const bonus = bonusDetails.bonuses.find(b => b.credentialId === cred.id);
                return {
                    ...cred,
                    isHealthy: healthResult?.isHealthy,
                    healthMessage: healthResult?.message,
                    bonus: bonus ? {
                        usedCount: bonus.usedCount,
                        remaining: bonus.remaining,
                        total: bonusDetails.bonusPerCredential,
                        expiresAt: bonus.expiresAt
                    } : null
                };
            });
            
            sendJson(res, 200, {
                success: true,
                data: {
                    results,
                    credentials: credentialsWithBonus
                }
            });
            return true;
        }

        // 处理凭据相关的路由
        const credentialMatch = path.match(/^\/api\/potluckuser\/credentials\/([^\/]+)(\/.*)?$/);
        if (credentialMatch) {
            const credentialId = decodeURIComponent(credentialMatch[1]);
            const subPath = credentialMatch[2] || '';

            // POST /api/potluckuser/credentials/:id/health - 检查凭据健康状态
            if (method === 'POST' && subPath === '/health') {
                return await handleCredentialHealthCheck(req, res, apiKey, credentialId);
            }
        }

        // 未匹配的用户端路由
        sendJson(res, 404, {
            success: false,
            error: { message: 'User API endpoint not found' }
        });
        return true;

    } catch (error) {
        console.error('[API Potluck] User API error:', error);
        sendJson(res, 500, {
            success: false,
            error: { message: error.message || 'Internal server error' }
        });
        return true;
    }
}

/**
 * 提供商映射
 */
const providerMap = {
    'gemini-cli-oauth': 'gemini',
    'gemini-antigravity': 'antigravity',
    'claude-kiro-oauth': 'kiro',
    'openai-qwen-oauth': 'qwen',
    'openai-iflow': 'iflow'
};

/**
 * 配置 multer 用于用户上传
 */
const userUploadStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            // 先使用临时目录
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

const userUploadFileFilter = (req, file, cb) => {
    const allowedTypes = ['.json', '.txt', '.key', '.pem', '.p12', '.pfx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file type'), false);
    }
};

const userUpload = multer({
    storage: userUploadStorage,
    fileFilter: userUploadFileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB 限制
    }
});

/**
 * 处理用户上传授权文件（带自动绑定和凭据关联功能）
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} apiKey - 用户的 API Key
 * @returns {Promise<boolean>}
 */
async function handleUserUpload(req, res, apiKey) {
    return new Promise((resolve) => {
        userUpload.single('file')(req, res, async (err) => {
            if (err) {
                console.error('[API Potluck User] File upload error:', err.message);
                sendJson(res, 400, { success: false, error: err.message });
                resolve(true);
                return;
            }
            
            if (!req.file) {
                sendJson(res, 400, { success: false, error: 'No file uploaded' });
                resolve(true);
                return;
            }
            
            try {
                const providerType = req.body?.provider || 'common';
                const provider = providerMap[providerType] || providerType;
                const tempFilePath = req.file.path;
                
                // 根据 provider 确定目标目录
                let targetDir = path.join(process.cwd(), 'configs', provider);
                
                // kiro 类型需要子文件夹
                if (provider === 'kiro') {
                    const timestamp = Date.now();
                    const originalNameWithoutExt = path.parse(req.file.originalname).name;
                    const subFolder = `${timestamp}_${originalNameWithoutExt}`;
                    targetDir = path.join(targetDir, subFolder);
                }
                
                await fs.mkdir(targetDir, { recursive: true });
                
                const targetFilePath = path.join(targetDir, req.file.filename);
                await fs.rename(tempFilePath, targetFilePath);
                
                const relativePath = path.relative(process.cwd(), targetFilePath).replace(/\\/g, '/');
                
                // 将凭据关联到用户
                const credentialInfo = {
                    path: relativePath,
                    provider: providerType,
                    authMethod: 'file-upload'
                };
                const credential = await addUserCredential(apiKey, credentialInfo);
                
                // 自动从主服务同步健康状态
                const healthResult = await syncCredentialHealthFromPool(apiKey, credential);
                
                // 触发自动绑定
                try {
                    await autoLinkProviderConfigs(CONFIG);
                } catch (linkError) {
                    console.warn('[API Potluck User] Auto-link failed:', linkError.message);
                }
                
                console.log(`[API Potluck User] File uploaded, linked and health checked: ${relativePath} (provider: ${providerType}, health: ${healthResult.message})`);
                
                sendJson(res, 200, {
                    success: true,
                    message: 'File uploaded successfully',
                    filePath: relativePath,
                    originalName: req.file.originalname,
                    provider: provider,
                    health: healthResult
                });
                resolve(true);
                
            } catch (error) {
                console.error('[API Potluck User] File processing error:', error);
                sendJson(res, 500, { success: false, error: error.message });
                resolve(true);
            }
        });
    });
}

/**
 * 处理 Kiro 批量导入 Refresh Token
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} apiKey - 用户的 API Key
 */
async function handleKiroBatchImportTokens(req, res, apiKey) {
    try {
        const body = await parseRequestBody(req);
        const { refreshTokens, region } = body;
        
        if (!refreshTokens || !Array.isArray(refreshTokens) || refreshTokens.length === 0) {
            sendJson(res, 400, {
                success: false,
                error: 'refreshTokens array is required and must not be empty'
            });
            return true;
        }
        
        console.log(`[API Potluck User] Starting batch import of ${refreshTokens.length} tokens (user: ${apiKey.substring(0, 12)}...)`);
        
        // 设置 SSE 响应头
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        
        // 发送 SSE 事件的辅助函数
        const sendSSE = (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        
        // 发送开始事件
        sendSSE('start', { total: refreshTokens.length });
        
        // 执行流式批量导入
        const result = await batchImportKiroRefreshTokensStream(
            refreshTokens,
            region || 'us-east-1',
            async (progress) => {
                // 每处理完一个 token 发送进度更新
                sendSSE('progress', progress);
                
                // 成功的凭据关联到用户并执行健康检查
                if (progress.current && progress.current.success && progress.current.path) {
                    try {
                        const credentialInfo = {
                            path: progress.current.path.replace(/\\/g, '/'),
                            provider: 'claude-kiro-oauth',
                            authMethod: 'refresh-token'
                        };
                        const credential = await addUserCredential(apiKey, credentialInfo);
                        
                        // 自动从主服务同步健康状态
                        await syncCredentialHealthFromPool(apiKey, credential);
                        console.log(`[API Potluck User] Credential linked and health synced: ${credentialInfo.path}`);
                    } catch (linkError) {
                        console.warn('[API Potluck User] Failed to link/check credential:', linkError.message);
                    }
                }
            }
        );
        
        console.log(`[API Potluck User] Completed: ${result.success} success, ${result.failed} failed`);
        
        // 发送完成事件
        sendSSE('complete', {
            success: true,
            total: result.total,
            successCount: result.success,
            failedCount: result.failed,
            details: result.details
        });
        
        res.end();
        return true;
        
    } catch (error) {
        console.error('[API Potluck User] Kiro Batch Import Error:', error);
        if (res.headersSent) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        } else {
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return true;
    }
}

/**
 * 处理 Kiro 导入 AWS 凭据
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} apiKey - 用户的 API Key
 */
async function handleKiroImportAwsCredentials(req, res, apiKey) {
    try {
        const body = await parseRequestBody(req);
        const { credentials } = body;
        
        if (!credentials || typeof credentials !== 'object') {
            sendJson(res, 400, {
                success: false,
                error: 'credentials object is required'
            });
            return true;
        }
        
        // 验证必需字段
        const missingFields = [];
        if (!credentials.clientId) missingFields.push('clientId');
        if (!credentials.clientSecret) missingFields.push('clientSecret');
        if (!credentials.accessToken) missingFields.push('accessToken');
        if (!credentials.refreshToken) missingFields.push('refreshToken');
        
        if (missingFields.length > 0) {
            sendJson(res, 400, {
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
            return true;
        }
        
        console.log(`[API Potluck User] Starting AWS credentials import (user: ${apiKey.substring(0, 12)}...)`);
        
        const result = await importAwsCredentials(credentials);
        
        if (result.success) {
            console.log(`[API Potluck User] Successfully imported credentials to: ${result.path}`);
            
            // 将凭据路径关联到用户
            const credentialInfo = {
                path: result.path,
                provider: 'claude-kiro-oauth',
                authMethod: credentials.authMethod || 'builder-id'
            };
            const credential = await addUserCredential(apiKey, credentialInfo);
            
            // 自动从主服务同步健康状态
            const healthResult = await syncCredentialHealthFromPool(apiKey, credential);
            console.log(`[API Potluck User] Health sync result: ${healthResult.message}`);
            
            sendJson(res, 200, {
                success: true,
                path: result.path,
                message: 'AWS credentials imported successfully',
                health: healthResult
            });
        } else {
            const statusCode = result.error === 'duplicate' ? 409 : 500;
            sendJson(res, statusCode, {
                success: false,
                error: result.error,
                existingPath: result.existingPath || null
            });
        }
        return true;
        
    } catch (error) {
        console.error('[API Potluck User] Kiro AWS Import Error:', error);
        sendJson(res, 500, {
            success: false,
            error: error.message
        });
        return true;
    }
}

/**
 * 从主服务同步凭据健康状态（不触发实际检查，不存储到本地）
 * @param {string} apiKey - 用户的 API Key（保留参数以兼容调用）
 * @param {Object} credential - 凭据对象
 * @returns {Promise<{isHealthy: boolean|null, message: string}>}
 */
async function syncCredentialHealthFromPool(apiKey, credential) {
    const fullPath = path.join(process.cwd(), credential.path);
    
    // 检查文件是否存在
    if (!existsSync(fullPath)) {
        return { isHealthy: false, message: '凭据文件不存在' };
    }
    
    // 从 ProviderPoolManager 获取该凭据对应的 provider 状态
    const poolManager = getProviderPoolManager();
    if (poolManager && credential.provider) {
        // 在 providerStatus 中查找匹配的配置
        const providerPool = poolManager.providerStatus[credential.provider];
        if (providerPool && providerPool.length > 0) {
            // 通过凭据路径匹配 provider 配置
            const normalizedCredPath = credential.path.replace(/\\/g, '/');
            const matchedProvider = providerPool.find(p => {
                const configPath = p.config.kiroOAuthCredsFile || p.config.oauthCredsFile || '';
                const normalizedConfigPath = configPath.replace(/\\/g, '/');
                return normalizedConfigPath === normalizedCredPath || 
                       normalizedConfigPath.endsWith(normalizedCredPath) ||
                       normalizedCredPath.endsWith(normalizedConfigPath);
            });
            
            if (matchedProvider) {
                const config = matchedProvider.config;
                const isHealthy = config.isHealthy && !config.isDisabled;
                let message = '健康检查:正常';
                
                if (config.isDisabled) {
                    message = '已禁用';
                } else if (!config.isHealthy) {
                    message = config.lastErrorMessage || '健康检查:异常';
                }
                
                return { isHealthy, message };
            }
        }
    }
    
    // 未在主服务中找到匹配的配置，检查文件有效性
    try {
        const content = await fs.readFile(fullPath, 'utf8');
        const credData = JSON.parse(content);
        
        // 检查 expiresAt 字段
        if (credData.expiresAt) {
            const expiresAt = new Date(credData.expiresAt);
            const now = new Date();
            
            if (expiresAt < now) {
                return { isHealthy: false, message: '凭据已过期' };
            }
        }
        
        // 文件存在且未过期，但未在主服务中注册
        return { isHealthy: null, message: '未注册到服务' };
        
    } catch (parseError) {
        return { isHealthy: false, message: '凭据文件格式错误' };
    }
}

/**
 * 处理凭据健康检查
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} apiKey - 用户的 API Key
 * @param {string} credentialId - 凭据 ID
 */
async function handleCredentialHealthCheck(req, res, apiKey, credentialId) {
    try {
        const credentials = getUserCredentials(apiKey);
        const credential = credentials.find(c => c.id === credentialId);
        
        if (!credential) {
            sendJson(res, 404, {
                success: false,
                error: { message: 'Credential not found' }
            });
            return true;
        }
        
        console.log(`[API Potluck User] Syncing health for credential: ${credential.path}`);
        
        const result = await syncCredentialHealthFromPool(apiKey, credential);
        
        sendJson(res, 200, {
            success: true,
            data: result
        });
        return true;
        
    } catch (error) {
        console.error('[API Potluck User] Health check error:', error);
        sendJson(res, 500, {
            success: false,
            error: error.message
        });
        return true;
    }
}


// ============ 定时健康检查 ============

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟
let healthCheckTimer = null;

/**
 * 批量同步所有用户的凭据健康状态（从主服务同步）
 * @returns {Promise<{total: number, checked: number, healthy: number, unhealthy: number}>}
 */
async function checkAllCredentialsHealth() {
    const allUsers = getAllUsersCredentials();
    let total = 0, checked = 0, healthy = 0, unhealthy = 0;
    
    for (const { apiKey, credentials } of allUsers) {
        for (const credential of credentials) {
            total++;
            try {
                const result = await syncCredentialHealthFromPool(apiKey, credential);
                checked++;
                if (result.isHealthy) {
                    healthy++;
                } else if (result.isHealthy === false) {
                    unhealthy++;
                }
                // isHealthy === null 表示未注册到服务，不计入健康/不健康
            } catch (error) {
                console.warn(`[API Potluck] Health sync failed for ${credential.path}:`, error.message);
            }
        }
    }
    
    return { total, checked, healthy, unhealthy };
}

/**
 * 同步单个用户的所有凭据健康状态（从主服务同步）
 * 同时更新资源包状态和 Key 的 bonusRemaining
 * @param {string} apiKey - 用户的 API Key
 * @returns {Promise<Array<{id: string, isHealthy: boolean, message: string}>>}
 */
async function checkUserCredentialsHealth(apiKey) {
    const credentials = getUserCredentials(apiKey);
    const results = [];
    
    for (const credential of credentials) {
        try {
            const result = await syncCredentialHealthFromPool(apiKey, credential);
            results.push({
                id: credential.id,
                isHealthy: result.isHealthy,
                message: result.message,
                addedAt: credential.addedAt  // 传递 addedAt 用于资源包初始化
            });
        } catch (error) {
            results.push({
                id: credential.id,
                isHealthy: null,
                message: '同步失败: ' + error.message,
                addedAt: credential.addedAt
            });
        }
    }
    
    // 同步资源包状态并更新 Key 的 bonusRemaining
    const bonusSync = await syncCredentialBonuses(apiKey, results);
    await updateBonusRemaining(apiKey, bonusSync.bonusRemaining);
    
    return results;
}

/**
 * 启动定时健康检查
 */
export function startHealthCheckScheduler() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
    }
    
    // 启动后延迟 30 秒执行第一次同步
    setTimeout(async () => {
        console.log('[API Potluck] Running initial health sync from pool...');
        const result = await checkAllCredentialsHealth();
        console.log(`[API Potluck] Health sync complete: ${result.healthy}/${result.total} healthy`);
    }, 30000);
    
    // 定时同步
    healthCheckTimer = setInterval(async () => {
        console.log('[API Potluck] Running scheduled health sync from pool...');
        const result = await checkAllCredentialsHealth();
        console.log(`[API Potluck] Health sync complete: ${result.healthy}/${result.total} healthy`);
    }, HEALTH_CHECK_INTERVAL);
    
    console.log(`[API Potluck] Health sync scheduler started (interval: ${HEALTH_CHECK_INTERVAL / 1000}s)`);
}

/**
 * 停止定时健康检查
 */
export function stopHealthCheckScheduler() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
        healthCheckTimer = null;
        console.log('[API Potluck] Health sync scheduler stopped');
    }
}

// 导出批量检查函数供 API 使用
export { checkUserCredentialsHealth };
