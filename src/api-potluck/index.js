/**
 * API 大锅饭 - 模块入口
 * 导出所有功能供外部使用
 */

// Key 管理
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
    DEFAULT_DAILY_LIMIT
} from './key-manager.js';

// 中间件
export {
    extractPotluckKey,
    isPotluckRequest,
    potluckAuthMiddleware,
    recordPotluckUsage,
    sendPotluckError
} from './middleware.js';

// API 路由
export { handlePotluckApiRoutes } from './api-routes.js';
