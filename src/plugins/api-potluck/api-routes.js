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
    getStats,
    validateKey,
    KEY_PREFIX
} from './key-manager.js';
import path from 'path';
import { promises as fs } from 'fs';
import multer from 'multer';
import { batchImportKiroRefreshTokensStream, importAwsCredentials } from '../../oauth-handlers.js';
import { handleUploadOAuthCredentials } from '../../ui-manager.js';
import { autoLinkProviderConfigs } from '../../service-manager.js';
import { CONFIG } from '../../config-manager.js';

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
            sendJson(res, 200, { 
                success: true, 
                data: { 
                    keys, 
                    stats 
                } 
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

        // POST /api/potluckuser/kiro/batch-import-tokens - 批量导入 Kiro refresh token
        if (method === 'POST' && path === '/api/potluckuser/kiro/batch-import-tokens') {
            return await handleKiroBatchImportTokens(req, res, apiKey);
        }

        // POST /api/potluckuser/kiro/import-aws-credentials - 导入 AWS SSO 凭据
        if (method === 'POST' && path === '/api/potluckuser/kiro/import-aws-credentials') {
            return await handleKiroImportAwsCredentials(req, res, apiKey);
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
 * 处理用户上传授权文件（带自动绑定功能）
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} apiKey - 用户的 API Key
 * @returns {Promise<boolean>}
 */
async function handleUserUpload(req, res, apiKey) {
    // 创建一个包装的响应对象来捕获上传结果
    let uploadResult = null;
    const originalEnd = res.end.bind(res);
    const originalWriteHead = res.writeHead.bind(res);
    let statusCode = 200;
    
    // 拦截响应以获取上传结果
    res.writeHead = function(code, headers) {
        statusCode = code;
        return originalWriteHead(code, headers);
    };
    
    res.end = function(data) {
        if (statusCode === 200 && data) {
            try {
                uploadResult = JSON.parse(data);
            } catch (e) {
                // 忽略解析错误
            }
        }
        return originalEnd(data);
    };
    
    // 执行文件上传
    const handled = await handleUploadOAuthCredentials(req, res, {
        providerMap: providerMap,
        logPrefix: '[API Potluck User]',
        userInfo: `user: ${apiKey.substring(0, 12)}...`,
        customUpload: userUpload
    });
    
    // 如果上传成功，调用自动绑定功能扫描并绑定新上传的配置文件
    if (uploadResult && uploadResult.success && uploadResult.filePath) {
        try {
            console.log(`[API Potluck User] Triggering auto-link for uploaded file: ${uploadResult.filePath}`);
            await autoLinkProviderConfigs(CONFIG);
        } catch (linkError) {
            // 自动绑定失败不影响上传结果，只记录日志
            console.warn(`[API Potluck User] Auto-link failed:`, linkError.message);
        }
    }
    
    return handled;
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
            (progress) => {
                // 每处理完一个 token 发送进度更新
                sendSSE('progress', progress);
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
            sendJson(res, 200, {
                success: true,
                path: result.path,
                message: 'AWS credentials imported successfully'
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
