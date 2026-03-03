import deepmerge from 'deepmerge';
import logger from '../utils/logger.js';
import { handleError, getClientIp } from '../utils/common.js';
import { handleUIApiRequests, serveStaticFiles } from '../services/ui-manager.js';
import { handleAPIRequests } from '../services/api-manager.js';
import { getApiService, getProviderStatus } from '../services/service-manager.js';
import { getProviderPoolManager } from '../services/service-manager.js';
import { MODEL_PROVIDER } from '../utils/common.js';
import { getRegisteredProviders } from '../providers/adapter.js';
import { countTokensAnthropic } from '../utils/token-utils.js';
import { PROMPT_LOG_FILENAME } from '../core/config-manager.js';
import { getPluginManager } from '../core/plugin-manager.js';
import { randomUUID } from 'crypto';
import { handleGrokAssetsProxy } from '../utils/grok-assets-proxy.js';

/**
 * Generate a short unique request ID (8 characters)
 */
function generateRequestId() {
    return randomUUID().slice(0, 8);
}

/**
 * Parse request body as JSON
 */
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON in request body'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Main request handler. It authenticates the request, determines the endpoint type,
 * and delegates to the appropriate specialized handler function.
 * @param {Object} config - The server configuration
 * @param {Object} providerPoolManager - The provider pool manager instance
 * @returns {Function} - The request handler function
 */
export function createRequestHandler(config, providerPoolManager) {
    return async function requestHandler(req, res) {
        // Generate unique request ID and set it in logger context
        const clientIp = getClientIp(req);
        const requestId = `${clientIp}:${generateRequestId()}`;
        logger.setRequestContext(requestId);

        // Deep copy the config for each request to allow dynamic modification
        const currentConfig = deepmerge({}, config);
        
        // 计算当前请求的基础 URL
        const protocol = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.headers.host;
        currentConfig.requestBaseUrl = `${protocol}://${host}`;
        
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        let path = requestUrl.pathname;
        const method = req.method;

        // Set CORS headers for all requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, Model-Provider, X-Requested-With, Accept, Origin');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours cache for preflight

        // Handle CORS preflight requests
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Serve static files for UI (除了登录页面需要认证)
        // 检查是否是插件静态文件
        const pluginManager = getPluginManager();
        const isPluginStatic = pluginManager.isPluginStaticPath(path);
        if (path.startsWith('/static/') || path === '/' || path === '/favicon.ico' || path === '/index.html' || path.startsWith('/app/') || path.startsWith('/components/') || path === '/login.html' || isPluginStatic) {
            const served = await serveStaticFiles(path, res);
            if (served) return;
        }

        // 执行插件路由
        const pluginRouteHandled = await pluginManager.executeRoutes(method, path, req, res);
        if (pluginRouteHandled) return;

        const uiHandled = await handleUIApiRequests(method, path, req, res, currentConfig, providerPoolManager);
        if (uiHandled) return;

        // logger.info(`\n${new Date().toLocaleString()}`);
        logger.info(`[Server] Received request: ${req.method} http://${req.headers.host}${req.url}`);

        // Health check endpoint
        if (method === 'GET' && path === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                provider: currentConfig.MODEL_PROVIDER
            }));
            return true;
        }

        // Grok assets proxy endpoint
        if (method === 'GET' && path === '/api/grok/assets') {
            await handleGrokAssetsProxy(req, res, currentConfig, providerPoolManager);
            return true;
        }

        // providers health endpoint
        // url params: provider[string], customName[string], unhealthRatioThreshold[float]
        // 支持provider, customName过滤记录 
        // 支持unhealthRatioThreshold控制不健康比例的阈值, 当unhealthyRatio超过阈值返回summaryHealthy: false
        if (method === 'GET' && path === '/provider_health') {
            try {
                const provider = requestUrl.searchParams.get('provider');
                const customName = requestUrl.searchParams.get('customName');
                let unhealthRatioThreshold = requestUrl.searchParams.get('unhealthRatioThreshold');
                unhealthRatioThreshold = unhealthRatioThreshold === null ? 0.0001 : parseFloat(unhealthRatioThreshold);
                let provideStatus = await getProviderStatus(currentConfig, { provider, customName });
                let summaryHealth = true;
                if (!isNaN(unhealthRatioThreshold)) {
                    summaryHealth = provideStatus.unhealthyRatio <= unhealthRatioThreshold;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    items: provideStatus.providerPoolsSlim,
                    count: provideStatus.count,
                    unhealthyCount: provideStatus.unhealthyCount,
                    unhealthyRatio: provideStatus.unhealthyRatio,
                    unhealthySummeryMessage: provideStatus.unhealthySummeryMessage,
                    summaryHealth
                }));
                return true;
            } catch (error) {
                logger.info(`[Server] req provider_health error: ${error.message}`);
                handleError(res, { statusCode: 500, message: `Failed to get providers health: ${error.message}` }, currentConfig.MODEL_PROVIDER);
                return;
            }
        }


        // Handle API requests
        // Allow overriding MODEL_PROVIDER via request header
        const modelProviderHeader = req.headers['model-provider'];
        if (modelProviderHeader) {
            const registeredProviders = getRegisteredProviders();
            if (registeredProviders.includes(modelProviderHeader)) {
                currentConfig.MODEL_PROVIDER = modelProviderHeader;
                logger.info(`[Config] MODEL_PROVIDER overridden by header to: ${currentConfig.MODEL_PROVIDER}`);
            } else {
                logger.warn(`[Config] Provider ${modelProviderHeader} in header is not available.`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `Provider ${modelProviderHeader} is not available.` } }));
                return;
            }
        }
          
        // Check if the first path segment matches a MODEL_PROVIDER and switch if it does
        const pathSegments = path.split('/').filter(segment => segment.length > 0);
        
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0];
            const registeredProviders = getRegisteredProviders();
            const isValidProvider = registeredProviders.includes(firstSegment);
            const isAutoMode = firstSegment === MODEL_PROVIDER.AUTO;

            if (firstSegment && (isValidProvider || isAutoMode)) {
                currentConfig.MODEL_PROVIDER = firstSegment;
                logger.info(`[Config] MODEL_PROVIDER overridden by path segment to: ${currentConfig.MODEL_PROVIDER}`);
                pathSegments.shift();
                path = '/' + pathSegments.join('/');
                requestUrl.pathname = path;
            } else if (firstSegment && Object.values(MODEL_PROVIDER).includes(firstSegment)) {
                // 如果在 MODEL_PROVIDER 中但没注册适配器，拦截并报错
                logger.warn(`[Config] Provider ${firstSegment} is recognized but no adapter is registered.`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `Provider ${firstSegment} is not available.` } }));
                return;
            } else if (firstSegment && !isValidProvider) {
                logger.info(`[Config] Ignoring invalid MODEL_PROVIDER in path segment: ${firstSegment}`);
            }
        }

        // 1. 执行认证流程（只有 type='auth' 的插件参与）
        const authResult = await pluginManager.executeAuth(req, res, requestUrl, currentConfig);
        if (authResult.handled) {
            // 认证插件已处理请求（如发送了错误响应）
            return;
        }
        if (!authResult.authorized) {
            // 没有认证插件授权，返回 401
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing.' } }));
            return;
        }
        
        // 2. 执行普通中间件（type!='auth' 的插件）
        const middlewareResult = await pluginManager.executeMiddleware(req, res, requestUrl, currentConfig);
        if (middlewareResult.handled) {
            // 中间件已处理请求
            return;
        }

        // Handle count_tokens requests (Anthropic API compatible)
        if (path.includes('/count_tokens') && method === 'POST') {
            try {
                const body = await parseRequestBody(req);
                logger.info(`[Server] Handling count_tokens request for model: ${body.model}`);

                // Use common utility method directly
                try {
                    const result = countTokensAnthropic(body);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (tokenError) {
                    logger.warn(`[Server] Common countTokens failed, falling back: ${tokenError.message}`);
                    // Last resort: return 0
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ input_tokens: 0 }));
                }
                return true;
            } catch (error) {
                logger.error(`[Server] count_tokens error: ${error.message}`);
                handleError(res, { statusCode: 500, message: `Failed to count tokens: ${error.message}` }, currentConfig.MODEL_PROVIDER);
                return;
            }
        }

        // 获取或选择 API Service 实例
        let apiService;
        // try {
        //     apiService = await getApiService(currentConfig);
        // } catch (error) {
        //     handleError(res, { statusCode: 500, message: `Failed to get API service: ${error.message}` }, currentConfig.MODEL_PROVIDER);
        //     const poolManager = getProviderPoolManager();
        //     if (poolManager) {
        //         poolManager.markProviderUnhealthy(currentConfig.MODEL_PROVIDER, {
        //             uuid: currentConfig.uuid
        //         });
        //     }
        //     return;
        // }

        try {
            // Handle API requests
            const apiHandled = await handleAPIRequests(method, path, req, res, currentConfig, apiService, providerPoolManager, PROMPT_LOG_FILENAME);
            if (apiHandled) return;

            // Fallback for unmatched routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            handleError(res, error, currentConfig.MODEL_PROVIDER);
        } finally {
            // Clear request context after request is complete
            logger.clearRequestContext(requestId);
        }
    };
}
