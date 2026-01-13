import deepmerge from 'deepmerge';
import { handleError } from '../utils/common.js';
import { handleUIApiRequests, serveStaticFiles } from '../services/ui-manager.js';
import { handleAPIRequests } from '../services/api-manager.js';
import { getApiService, getProviderStatus } from '../services/service-manager.js';
import { getProviderPoolManager } from '../services/service-manager.js';
import { MODEL_PROVIDER } from '../utils/common.js';
import { PROMPT_LOG_FILENAME } from '../core/config-manager.js';
import { handleOllamaRequest, handleOllamaShow } from './ollama-handler.js';
import { getPluginManager } from '../core/plugin-manager.js';

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
        // Deep copy the config for each request to allow dynamic modification
        const currentConfig = deepmerge({}, config);
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

        // Ollama show endpoint with model name
        if (method === 'POST' && path === '/ollama/api/show') {
            await handleOllamaShow(req, res);
            return true;
        }

        console.log(`\n${new Date().toLocaleString()}`);
        console.log(`[Server] Received request: ${req.method} http://${req.headers.host}${req.url}`);

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
                console.log(`[Server] req provider_health error: ${error.message}`);
                handleError(res, { statusCode: 500, message: `Failed to get providers health: ${error.message}` }, currentConfig.MODEL_PROVIDER);
                return;
            }
        }


        // Handle API requests
        // Allow overriding MODEL_PROVIDER via request header
        const modelProviderHeader = req.headers['model-provider'];
        if (modelProviderHeader) {
            currentConfig.MODEL_PROVIDER = modelProviderHeader;
            console.log(`[Config] MODEL_PROVIDER overridden by header to: ${currentConfig.MODEL_PROVIDER}`);
        }
          
        // Check if the first path segment matches a MODEL_PROVIDER and switch if it does
        // Note: 'ollama' is not a valid MODEL_PROVIDER, it's a protocol prefix for Ollama API compatibility
        const pathSegments = path.split('/').filter(segment => segment.length > 0);
        const isOllamaPath = pathSegments[0] === 'ollama' || path.startsWith('/api/');
        
        if (pathSegments.length > 0 && !isOllamaPath) {
            const firstSegment = pathSegments[0];
            const isValidProvider = Object.values(MODEL_PROVIDER).includes(firstSegment);
            if (firstSegment && isValidProvider) {
                currentConfig.MODEL_PROVIDER = firstSegment;
                console.log(`[Config] MODEL_PROVIDER overridden by path segment to: ${currentConfig.MODEL_PROVIDER}`);
                pathSegments.shift();
                path = '/' + pathSegments.join('/');
                requestUrl.pathname = path;
            } else if (firstSegment && !isValidProvider) {
                console.log(`[Config] Ignoring invalid MODEL_PROVIDER in path segment: ${firstSegment}`);
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

        // Handle Ollama request BEFORE getting apiService (Ollama endpoints handle their own provider selection)
        // This is important because Ollama /api/tags aggregates models from ALL providers, not just the default one
        if (isOllamaPath) {
            const { handled, normalizedPath } = await handleOllamaRequest(method, path, requestUrl, req, res, null, currentConfig, providerPoolManager);
            if (handled) return;
            // If not handled by Ollama handler, continue with normal flow
            path = normalizedPath;
        }

        // 获取或选择 API Service 实例
        let apiService;
        try {
            apiService = await getApiService(currentConfig);
        } catch (error) {
            handleError(res, { statusCode: 500, message: `Failed to get API service: ${error.message}` }, currentConfig.MODEL_PROVIDER);
            const poolManager = getProviderPoolManager();
            if (poolManager) {
                poolManager.markProviderUnhealthy(currentConfig.MODEL_PROVIDER, {
                    uuid: currentConfig.uuid
                });
            }
            return;
        }

        // Handle count_tokens requests (Anthropic API compatible)
        if (path.includes('/count_tokens') && method === 'POST') {
            try {
                const body = await parseRequestBody(req);
                console.log(`[Server] Handling count_tokens request for model: ${body.model}`);

                // Check if apiService has countTokens method
                if (apiService && typeof apiService.countTokens === 'function') {
                    const result = apiService.countTokens(body);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } else {
                    // Fallback: use estimateInputTokens if available
                    if (apiService && typeof apiService.estimateInputTokens === 'function') {
                        const inputTokens = apiService.estimateInputTokens(body);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ input_tokens: inputTokens }));
                    } else {
                        // Last resort: return 0 with a message
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ input_tokens: 0 }));
                    }
                }
                return true;
            } catch (error) {
                console.error(`[Server] count_tokens error: ${error.message}`);
                handleError(res, { statusCode: 500, message: `Failed to count tokens: ${error.message}` }, currentConfig.MODEL_PROVIDER);
                return;
            }
        }

        try {
            // Handle API requests (Ollama requests are already handled above before apiService is obtained)
            const apiHandled = await handleAPIRequests(method, path, req, res, currentConfig, apiService, providerPoolManager, PROMPT_LOG_FILENAME);
            if (apiHandled) return;

            // Fallback for unmatched routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            handleError(res, error, currentConfig.MODEL_PROVIDER);
        }
    };
}
