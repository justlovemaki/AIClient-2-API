/**
 * 默认认证插件 - 内置插件
 *
 * 提供基于 API Key 的默认认证机制
 * 支持多种认证方式：
 * 1. Authorization: Bearer <key>
 * 2. x-api-key: <key>
 * 3. x-goog-api-key: <key>
 * 4. URL query: ?key=<key>
 */

/**
 * 检查请求是否已授权
 * @param {http.IncomingMessage} req - HTTP 请求
 * @param {URL} requestUrl - 解析后的 URL
 * @param {string} requiredApiKey - 所需的 API Key
 * @returns {boolean}
 */
function isAuthorized(req, requestUrl, requiredApiKey) {
    const authHeader = req.headers['authorization'];
    const queryKey = requestUrl.searchParams.get('key');
    const googApiKey = req.headers['x-goog-api-key'];
    const claudeApiKey = req.headers['x-api-key'];

    // Check for Bearer token in Authorization header (OpenAI style)
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === requiredApiKey) {
            return true;
        }
    }

    // Check for API key in URL query parameter (Gemini style)
    if (queryKey === requiredApiKey) {
        return true;
    }

    // Check for API key in x-goog-api-key header (Gemini style)
    if (googApiKey === requiredApiKey) {
        return true;
    }

    // Check for API key in x-api-key header (Claude style)
    if (claudeApiKey === requiredApiKey) {
        return true;
    }

    return false;
}

/**
 * 默认认证插件定义
 */
const defaultAuthPlugin = {
    name: 'default-auth',
    version: '1.0.0',
    description: '默认 API Key 认证插件',
    
    // 插件类型：认证插件
    type: 'auth',
    
    // 标记为内置插件，优先级最低（最后执行）
    _builtin: true,
    _priority: 9999,

    /**
     * 认证方法 - 默认 API Key 认证
     * @param {http.IncomingMessage} req - HTTP 请求
     * @param {http.ServerResponse} res - HTTP 响应
     * @param {URL} requestUrl - 解析后的 URL
     * @param {Object} config - 服务器配置
     * @returns {Promise<{handled: boolean, authorized: boolean|null}>}
     */
    async authenticate(req, res, requestUrl, config) {
        // 执行默认认证
        if (isAuthorized(req, requestUrl, config.REQUIRED_API_KEY)) {
            // 认证成功
            return { handled: false, authorized: true };
        }

        // 认证失败，记录日志但不发送响应（由 request-handler 统一处理）
        console.log(`[Default Auth] Unauthorized request. Headers: Authorization=${req.headers['authorization'] ? 'present' : 'N/A'}, x-api-key=${req.headers['x-api-key'] || 'N/A'}, x-goog-api-key=${req.headers['x-goog-api-key'] || 'N/A'}`);
        
        // 返回 null 表示此插件不授权，让其他插件或默认逻辑处理
        return { handled: false, authorized: null };
    }
};

export default defaultAuthPlugin;