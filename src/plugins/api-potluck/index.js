/**
 * API 大锅饭插件 - 标准插件格式
 * 
 * 功能：
 * 1. API Key 管理（创建、删除、启用/禁用）
 * 2. 每日配额限制
 * 3. 用量统计
 * 4. 管理 API 接口
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
    validateKey,
    incrementUsage,
    getStats,
    KEY_PREFIX,
    DEFAULT_DAILY_LIMIT
} from './key-manager.js';

import {
    extractPotluckKey,
    isPotluckRequest,
    sendPotluckError
} from './middleware.js';

import { handlePotluckApiRoutes, handlePotluckUserApiRoutes } from './api-routes.js';

/**
 * 插件定义
 */
const apiPotluckPlugin = {
    name: 'api-potluck',
    version: '1.0.0',
    description: 'API 大锅饭 - Key 管理和用量统计插件',
    
    // 插件类型：认证插件
    type: 'auth',
    
    // 优先级：数字越小越先执行，默认认证插件优先级为 9999
    _priority: 10,

    /**
     * 初始化钩子
     * @param {Object} config - 服务器配置
     */
    async init(config) {
        console.log('[API Potluck Plugin] Initializing...');
        // 插件初始化逻辑（如果需要）
    },

    /**
     * 销毁钩子
     */
    async destroy() {
        console.log('[API Potluck Plugin] Destroying...');
        // 清理逻辑（如果需要）
    },

    /**
     * 静态文件路径
     */
    staticPaths: ['potluck.html', 'potluck-user.html'],

    /**
     * 公开 API 路径（不需要 UI 管理 API 的 token 验证）
     * 这些路径将跳过 handleUIApiRequests 中的 checkAuth 验证
     */
    publicApiPaths: ['/api/potluckuser'],

    /**
     * 路由定义
     */
    routes: [
        {
            method: '*',
            path: '/api/potluckuser',
            handler: handlePotluckUserApiRoutes
        },
        {
            method: '*',
            path: '/api/potluck',
            handler: handlePotluckApiRoutes
        }
    ],

    /**
     * 认证方法 - 处理 Potluck Key 认证
     * @param {http.IncomingMessage} req - HTTP 请求
     * @param {http.ServerResponse} res - HTTP 响应
     * @param {URL} requestUrl - 解析后的 URL
     * @param {Object} config - 服务器配置
     * @returns {Promise<{handled: boolean, authorized: boolean|null, error?: Object, data?: Object}>}
     */
    async authenticate(req, res, requestUrl, config) {
        const apiKey = extractPotluckKey(req, requestUrl);
        
        if (!apiKey) {
            // 不是 potluck 请求，返回 null 让其他认证插件处理
            return { handled: false, authorized: null };
        }

        // 验证 Key
        const validation = await validateKey(apiKey);
        
        if (!validation.valid) {
            const errorMessages = {
                'invalid_format': 'Invalid API key format',
                'not_found': 'API key not found',
                'disabled': 'API key has been disabled',
                'quota_exceeded': 'Daily quota exceeded for this API key'
            };

            const statusCodes = {
                'invalid_format': 401,
                'not_found': 401,
                'disabled': 403,
                'quota_exceeded': 429
            };

            const error = {
                statusCode: statusCodes[validation.reason] || 401,
                message: errorMessages[validation.reason] || 'Authentication failed',
                code: validation.reason,
                keyData: validation.keyData
            };

            // 发送错误响应
            sendPotluckError(res, error);
            return { handled: true, authorized: false, error };
        }

        // 认证成功，返回数据供后续使用
        console.log(`[API Potluck Plugin] Authorized with key: ${apiKey.substring(0, 12)}...`);
        return {
            handled: false,
            authorized: true,
            data: {
                potluckApiKey: apiKey,
                potluckKeyData: validation.keyData
            }
        };
    },

    /**
     * 钩子函数
     */
    hooks: {
        /**
         * 内容生成后钩子 - 记录用量
         * @param {Object} config - 服务器配置
         */
        async onContentGenerated(config) {
            if (config.potluckApiKey) {
                try {
                    await incrementUsage(config.potluckApiKey);
                } catch (e) {
                    // 静默失败，不影响主流程
                    console.error('[API Potluck Plugin] Failed to record usage:', e.message);
                }
            }
        }
    },

    // 导出内部函数供外部使用（可选）
    exports: {
        createKey,
        listKeys,
        getKey,
        deleteKey,
        updateKeyLimit,
        resetKeyUsage,
        toggleKey,
        updateKeyName,
        validateKey,
        incrementUsage,
        getStats,
        KEY_PREFIX,
        DEFAULT_DAILY_LIMIT,
        extractPotluckKey,
        isPotluckRequest
    }
};

export default apiPotluckPlugin;

// 也导出命名导出，方便直接引用
export {
    createKey,
    listKeys,
    getKey,
    deleteKey,
    updateKeyLimit,
    resetKeyUsage,
    toggleKey,
    updateKeyName,
    validateKey,
    incrementUsage,
    getStats,
    KEY_PREFIX,
    DEFAULT_DAILY_LIMIT,
    extractPotluckKey,
    isPotluckRequest
};