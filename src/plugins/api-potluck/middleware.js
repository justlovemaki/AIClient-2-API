/**
 * API 大锅饭 - 中间件模块
 * 负责请求拦截和配额检查
 */

import { validateKey, incrementUsage, KEY_PREFIX } from './key-manager.js';

/**
 * 从请求中提取 Potluck API Key
 * 支持多种认证方式：
 * 1. Authorization: Bearer maki_xxx
 * 2. x-api-key: maki_xxx
 * 3. x-goog-api-key: maki_xxx
 * 4. URL query: ?key=maki_xxx
 * 
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {URL} requestUrl - 解析后的 URL 对象
 * @returns {string|null} 提取到的 API Key，如果不是 potluck key 则返回 null
 */
export function extractPotluckKey(req, requestUrl) {
    // 1. 检查 Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token.startsWith(KEY_PREFIX)) {
            return token;
        }
    }

    // 2. 检查 x-api-key header (Claude style)
    const xApiKey = req.headers['x-api-key'];
    if (xApiKey && xApiKey.startsWith(KEY_PREFIX)) {
        return xApiKey;
    }

    // 3. 检查 x-goog-api-key header (Gemini style)
    const googApiKey = req.headers['x-goog-api-key'];
    if (googApiKey && googApiKey.startsWith(KEY_PREFIX)) {
        return googApiKey;
    }

    // 4. 检查 URL query parameter
    const queryKey = requestUrl.searchParams.get('key');
    if (queryKey && queryKey.startsWith(KEY_PREFIX)) {
        return queryKey;
    }

    return null;
}

/**
 * 检查请求是否使用 Potluck Key
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {URL} requestUrl - 解析后的 URL 对象
 * @returns {boolean}
 */
export function isPotluckRequest(req, requestUrl) {
    return extractPotluckKey(req, requestUrl) !== null;
}

/**
 * Potluck 认证中间件
 * 验证 Potluck API Key 并检查配额
 * 
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {URL} requestUrl - 解析后的 URL 对象
 * @returns {Promise<{authorized: boolean, error?: Object, keyData?: Object, apiKey?: string}>}
 */
export async function potluckAuthMiddleware(req, requestUrl) {
    const apiKey = extractPotluckKey(req, requestUrl);
    
    if (!apiKey) {
        // 不是 potluck 请求，返回 null 让原有逻辑处理
        return { authorized: null };
    }

    // 验证 Key
    const validation = await validateKey(apiKey);
    
    if (!validation.valid) {
        const errorMessages = {
            'invalid_format': 'Invalid API key format',
            'not_found': 'API key not found',
            'disabled': 'API key has been disabled',
            'quota_exceeded': 'Quota exceeded for this API key'
        };

        const statusCodes = {
            'invalid_format': 401,
            'not_found': 401,
            'disabled': 403,
            'quota_exceeded': 429
        };

        return {
            authorized: false,
            error: {
                statusCode: statusCodes[validation.reason] || 401,
                message: errorMessages[validation.reason] || 'Authentication failed',
                code: validation.reason,
                keyData: validation.keyData
            }
        };
    }

    return {
        authorized: true,
        keyData: validation.keyData,
        apiKey: apiKey
    };
}

/**
 * 记录 Potluck 请求使用
 * 在请求成功处理后调用
 * 
 * @param {string} apiKey - API Key
 * @returns {Promise<Object|null>}
 */
export async function recordPotluckUsage(apiKey) {
    if (!apiKey || !apiKey.startsWith(KEY_PREFIX)) {
        return null;
    }
    return incrementUsage(apiKey);
}

/**
 * 创建 Potluck 错误响应
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {Object} error - 错误信息
 */
export function sendPotluckError(res, error) {
    const response = {
        error: {
            message: error.message,
            code: error.code,
            type: 'potluck_error'
        }
    };

    // 如果是配额超限，添加额外信息
    if (error.code === 'quota_exceeded' && error.keyData) {
        response.error.quota = {
            used: error.keyData.todayUsage,
            limit: error.keyData.dailyLimit,
            resetDate: error.keyData.lastResetDate
        };
    }

    res.writeHead(error.statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
}
