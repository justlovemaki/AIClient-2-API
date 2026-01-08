/**
 * API 大锅饭 - 管理 API 路由
 * 提供 Key 管理的 RESTful API
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
    getStats
} from './key-manager.js';

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
