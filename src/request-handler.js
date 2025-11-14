import deepmerge from 'deepmerge';
import { handleError, isAuthorized } from './common.js';
import { handleUIApiRequests, serveStaticFiles } from './ui-manager.js';
import { handleAPIRequests } from './api-manager.js';
import { getApiService } from './service-manager.js';
import { getProviderPoolManager } from './service-manager.js';
import { MODEL_PROVIDER } from './common.js';
import { PROMPT_LOG_FILENAME } from './config-manager.js';
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

        // Handle CORS preflight requests
        if (method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, Model-Provider');
            res.writeHead(204);
            res.end();
            return;
        }

        // Serve static files for UI (除了登录页面需要认证)
        if (path.startsWith('/static/') || path === '/' || path === '/favicon.ico' || path === '/index.html' || path.startsWith('/app/') || path === '/login.html') {
            const served = await serveStaticFiles(path, res);
            if (served) return;
        }

        const uiHandled = await handleUIApiRequests(method, path, req, res, currentConfig, providerPoolManager);
        if (uiHandled) return;

        console.log(`\n${new Date().toLocaleString()}`);
        console.log(`[Server] Received request: ${req.method} http://${req.headers.host}${req.url}`);
        // Handle API requests
        // Allow overriding MODEL_PROVIDER via request header
        const modelProviderHeader = req.headers['model-provider'];
        if (modelProviderHeader) {
            currentConfig.MODEL_PROVIDER = modelProviderHeader;
            console.log(`[Config] MODEL_PROVIDER overridden by header to: ${currentConfig.MODEL_PROVIDER}`);
        }
          
        // Check if the first path segment matches a MODEL_PROVIDER and switch if it does
        const pathSegments = path.split('/').filter(segment => segment.length > 0);
        if (pathSegments.length > 0) {
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

        // 获取或选择 API Service 实例
        let apiService;
        try {
            apiService = await getApiService(currentConfig);
        } catch (error) {
            handleError(res, { statusCode: 500, message: `Failed to get API service: ${error.message}` });
            const poolManager = getProviderPoolManager();
            if (poolManager) {
                poolManager.markProviderUnhealthy(currentConfig.MODEL_PROVIDER, {
                    uuid: currentConfig.uuid
                });
            }
            return;
        }
        
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

        // Ignore count_tokens requests
        if (path.includes('/count_tokens')) {
            console.log(`[Server] Ignoring count_tokens request: ${path}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                tokens: 0,
                message: 'Token counting is not supported'
            }));
            return true;
        }

        // Check authentication for API requests
        if (!isAuthorized(req, requestUrl, currentConfig.REQUIRED_API_KEY)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing.' } }));
            return;
        }

        try {
            // Handle API requests
            const apiHandled = await handleAPIRequests(method, path, req, res, currentConfig, apiService, providerPoolManager, PROMPT_LOG_FILENAME);
            if (apiHandled) return;

            // Fallback for unmatched routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            handleError(res, error);
        }
    };
}