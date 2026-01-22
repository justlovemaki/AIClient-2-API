import { getRequestBody } from '../utils/common.js';
import {
    handleGeminiCliOAuth,
    handleGeminiAntigravityOAuth,
    handleQwenOAuth,
    handleKiroOAuth,
    handleIFlowOAuth,
    handleCodexOAuth,
    batchImportKiroRefreshTokensStream,
    importAwsCredentials
} from '../auth/oauth-handlers.js';

/**
 * 生成 OAuth 授权 URL
 */
export async function handleGenerateAuthUrl(req, res, currentConfig, providerType) {
    try {
        let authUrl = '';
        let authInfo = {};
        
        // 解析 options
        let options = {};
        try {
            options = await getRequestBody(req);
        } catch (e) {
            // 如果没有请求体，使用默认空对象
        }

        // 根据提供商类型生成授权链接并启动回调服务器
        if (providerType === 'gemini-cli-oauth') {
            const result = await handleGeminiCliOAuth(currentConfig, options);
            authUrl = result.authUrl;
            authInfo = result.authInfo;
        } else if (providerType === 'gemini-antigravity') {
            const result = await handleGeminiAntigravityOAuth(currentConfig, options);
            authUrl = result.authUrl;
            authInfo = result.authInfo;
        } else if (providerType === 'openai-qwen-oauth') {
            const result = await handleQwenOAuth(currentConfig, options);
            authUrl = result.authUrl;
            authInfo = result.authInfo;
        } else if (providerType === 'claude-kiro-oauth') {
            // Kiro OAuth 支持多种认证方式
            // options.method 可以是: 'google' | 'github' | 'builder-id'
            const result = await handleKiroOAuth(currentConfig, options);
            authUrl = result.authUrl;
            authInfo = result.authInfo;
        } else if (providerType === 'openai-iflow') {
            // iFlow OAuth 授权
            const result = await handleIFlowOAuth(currentConfig, options);
            authUrl = result.authUrl;
            authInfo = result.authInfo;
        } else if (providerType === 'openai-codex-oauth') {
            // Codex OAuth（OAuth2 + PKCE）
            const result = await handleCodexOAuth(currentConfig, options);
            authUrl = result.authUrl;
            authInfo = result.authInfo;
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: `Unsupported provider type: ${providerType}`
                }
            }));
            return true;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            authUrl: authUrl,
            authInfo: authInfo
        }));
        return true;
        
    } catch (error) {
        console.error(`[UI API] Failed to generate auth URL for ${providerType}:`, error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: `Failed to generate auth URL: ${error.message}`
            }
        }));
        return true;
    }
}

/**
 * 处理手动 OAuth 回调
 */
export async function handleManualOAuthCallback(req, res) {
    try {
        const body = await getRequestBody(req);
        const { provider, callbackUrl, authMethod } = body;

        if (!provider || !callbackUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'provider and callbackUrl are required'
            }));
            return true;
        }

        console.log(`[OAuth Manual Callback] Processing manual callback for ${provider}`);
        console.log(`[OAuth Manual Callback] Callback URL: ${callbackUrl}`);

        // 解析回调URL
        const url = new URL(callbackUrl);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const token = url.searchParams.get('token');

        if (!code && !token) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Callback URL must contain code or token parameter'
            }));
            return true;
        }

        // 特殊处理 Codex OAuth 回调
        if (provider === 'openai-codex-oauth' && code && state) {
            const { handleCodexOAuthCallback } = await import('../auth/oauth-handlers.js');
            const result = await handleCodexOAuthCallback(code, state);

            res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return true;
        }

        // 通过fetch请求本地OAuth回调服务器处理
        // 使用localhost而不是原始hostname，确保请求到达本地服务器
        const localUrl = new URL(callbackUrl);
        localUrl.hostname = 'localhost';
        localUrl.protocol = 'http:';

        try {
            const response = await fetch(localUrl.href);

            if (response.ok) {
                console.log(`[OAuth Manual Callback] Successfully processed callback for ${provider}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'OAuth callback processed successfully'
                }));
            } else {
                const errorText = await response.text();
                console.error(`[OAuth Manual Callback] Callback processing failed:`, errorText);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: `Callback processing failed: ${response.status}`
                }));
            }
        } catch (fetchError) {
            console.error(`[OAuth Manual Callback] Failed to process callback:`, fetchError);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: `Failed to process callback: ${fetchError.message}`
            }));
        }

        return true;
    } catch (error) {
        console.error('[OAuth Manual Callback] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
        return true;
    }
}

/**
 * 批量导入 Kiro refreshToken（带实时进度 SSE）
 */
export async function handleBatchImportKiroTokens(req, res) {
    try {
        const body = await getRequestBody(req);
        const { refreshTokens, region } = body;
        
        if (!refreshTokens || !Array.isArray(refreshTokens) || refreshTokens.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'refreshTokens array is required and must not be empty'
            }));
            return true;
        }
        
        console.log(`[Kiro Batch Import] Starting batch import of ${refreshTokens.length} tokens with SSE...`);
        
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
        
        console.log(`[Kiro Batch Import] Completed: ${result.success} success, ${result.failed} failed`);
        
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
        console.error('[Kiro Batch Import] Error:', error);
        // 如果已经开始发送 SSE，则发送错误事件
        if (res.headersSent) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message
            }));
        }
        return true;
    }
}

/**
 * 导入 AWS SSO 凭据用于 Kiro
 */
export async function handleImportAwsCredentials(req, res) {
    try {
        const body = await getRequestBody(req);
        const { credentials } = body;
        
        if (!credentials || typeof credentials !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'credentials object is required'
            }));
            return true;
        }
        
        // 验证必需字段 - 需要四个字段都存在
        const missingFields = [];
        if (!credentials.clientId) missingFields.push('clientId');
        if (!credentials.clientSecret) missingFields.push('clientSecret');
        if (!credentials.accessToken) missingFields.push('accessToken');
        if (!credentials.refreshToken) missingFields.push('refreshToken');
        
        if (missingFields.length > 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            }));
            return true;
        }
        
        console.log('[Kiro AWS Import] Starting AWS credentials import...');
        
        const result = await importAwsCredentials(credentials);
        
        if (result.success) {
            console.log(`[Kiro AWS Import] Successfully imported credentials to: ${result.path}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                path: result.path,
                message: 'AWS credentials imported successfully'
            }));
        } else {
            // 重复凭据返回 409 Conflict，其他错误返回 500
            const statusCode = result.error === 'duplicate' ? 409 : 500;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: result.error,
                existingPath: result.existingPath || null
            }));
        }
        return true;
        
    } catch (error) {
        console.error('[Kiro AWS Import] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
        return true;
    }
}
