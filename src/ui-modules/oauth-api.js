import { getRequestBody } from '../utils/common.js';
import {
    handleGeminiCliOAuth,
    handleGeminiAntigravityOAuth,
    handleQwenOAuth,
    handleKiroOAuth,
    handleIFlowOAuth,
    handleOrchidsOAuth,
    batchImportKiroRefreshTokensStream,
    importAwsCredentials,
    importOrchidsToken
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
        } else if (providerType === 'claude-orchids-oauth') {
            // Orchids OAuth（手动导入模式）
            const result = await handleOrchidsOAuth(currentConfig, options);
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
        const token = url.searchParams.get('token');
        
        if (!code && !token) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Callback URL must contain code or token parameter'
            }));
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

/**
 * 导入 Orchids Token
 * 支持三种格式：
 * 1. cookieString 格式 (完整的 Cookie 字符串，包含 __client 和 __session)
 * 2. token 字符串格式 (JWT|rotating_token) - 已废弃
 * 3. credentials 对象格式 (cookies, clerkSessionId, userId, workingDir)
 */
export async function handleImportOrchidsToken(req, res) {
    try {
        const body = await getRequestBody(req);
        const { token, credentials, workingDir, cookieString } = body;

        // 新格式：完整的 Cookie 字符串
        if (cookieString && typeof cookieString === 'string') {
            console.log('[Orchids Import] Starting cookie string import...');

            // 解析 Cookie 字符串
            const parsedResult = parseOrchidsCookieString(cookieString);
            if (!parsedResult.success) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: parsedResult.error
                }));
                return true;
            }

            // 保存凭据
            const result = await saveOrchidsCredentials(parsedResult.credentials);

            if (result.success) {
                console.log(`[Orchids Import] Successfully imported credentials to: ${result.path}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    path: result.path,
                    sessionId: result.sessionId,
                    userId: result.userId,
                    message: 'Orchids credentials imported successfully'
                }));
            } else {
                const statusCode = result.error === 'duplicate' ? 409 : 500;
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: result.error,
                    existingPath: result.existingPath || null
                }));
            }
            return true;
        }

        // 如果提供了 credentials 对象，直接保存
        if (credentials && typeof credentials === 'object') {
            console.log('[Orchids Import] Starting credentials import...');

            // 验证必需字段
            if (!credentials.cookies && (!credentials.clerkSessionId)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'credentials must contain cookies or clerkSessionId'
                }));
                return true;
            }

            // 直接保存凭据
            const result = await saveOrchidsCredentials(credentials);

            if (result.success) {
                console.log(`[Orchids Import] Successfully imported token to: ${result.path}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    path: result.path,
                    sessionId: result.sessionId,
                    userId: result.userId,
                    message: 'Orchids credentials imported successfully'
                }));
            } else {
                const statusCode = result.error === 'duplicate' ? 409 : 500;
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: result.error,
                    existingPath: result.existingPath || null
                }));
            }
            return true;
        }

        // 原有的 token 字符串格式
        if (!token || typeof token !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'cookieString, token string or credentials object is required'
            }));
            return true;
        }

        console.log('[Orchids Import] Starting token import...');

        const result = await importOrchidsToken(token, { workingDir });
        
        if (result.success) {
            console.log(`[Orchids Import] Successfully imported token to: ${result.path}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                path: result.path,
                sessionId: result.sessionId,
                userId: result.userId,
                message: 'Orchids token imported successfully'
            }));
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: result.error
            }));
        }
        return true;
        
    } catch (error) {
        console.error('[Orchids Import] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
        return true;
    }
}

/**
 * 直接保存 Orchids 凭据（从 UI 表单提交）
 */
async function saveOrchidsCredentials(credentials) {
    const fs = await import('fs');
    const path = await import('path');
    const { broadcastEvent } = await import('../services/ui-manager.js');
    const { autoLinkProviderConfigs } = await import('../services/service-manager.js');
    const { CONFIG } = await import('../core/config-manager.js');

    try {
        // 准备凭据数据
        const credentialsData = {
            cookies: credentials.cookies || '',
            clerkSessionId: credentials.clerkSessionId || `sess_${Date.now()}`,
            userId: credentials.userId || 'user_unknown',
            workingDir: credentials.workingDir || 'E:\\path\\to\\default\\project',
            expiresAt: credentials.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            importedAt: new Date().toISOString()
        };

        // 生成文件路径: configs/orchids/{timestamp}_orchids_creds/{timestamp}_orchids_creds.json
        // 与 importOrchidsToken 保持一致的目录结构
        const timestamp = Date.now();
        const folderName = `${timestamp}_orchids_creds`;
        const targetDir = path.default.join(process.cwd(), 'configs', 'orchids', folderName);
        await fs.promises.mkdir(targetDir, { recursive: true });

        const filename = `${folderName}.json`;
        const credPath = path.default.join(targetDir, filename);
        await fs.promises.writeFile(credPath, JSON.stringify(credentialsData, null, 2));

        const relativePath = path.default.relative(process.cwd(), credPath);

        console.log(`[Orchids Import] Credentials saved to: ${relativePath}`);

        // 广播事件
        broadcastEvent('oauth_success', {
            provider: 'claude-orchids-oauth',
            relativePath: relativePath,
            timestamp: new Date().toISOString()
        });

        // 自动关联新生成的凭据到 Pools
        await autoLinkProviderConfigs(CONFIG);

        return {
            success: true,
            path: relativePath,
            sessionId: credentialsData.clerkSessionId,
            userId: credentialsData.userId
        };
        
    } catch (error) {
        console.error('[Orchids Import] Save credentials failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 解析 Orchids Cookie 字符串
 * 从完整的 Cookie 字符串中提取 __client、__session 和 clerkSessionId
 * @param {string} cookieString - 完整的 Cookie 字符串
 * @returns {Object} 解析结果
 */
function parseOrchidsCookieString(cookieString) {
    try {
        // 提取 __client cookie
        const clientMatch = cookieString.match(/__client=([^;]+)/);
        if (!clientMatch) {
            return { success: false, error: 'Cookie 中缺少 __client' };
        }
        const clientCookie = clientMatch[1].trim();

        // 提取 __session cookie
        const sessionMatch = cookieString.match(/__session=([^;]+)/);
        if (!sessionMatch) {
            return { success: false, error: 'Cookie 中缺少 __session' };
        }
        const sessionCookie = sessionMatch[1].trim();

        // 从 __session JWT 中解析 clerkSessionId (sid) 和 userId (sub)
        let clerkSessionId = null;
        let userId = 'user_unknown';

        try {
            const sessionParts = sessionCookie.split('.');
            if (sessionParts.length === 3) {
                const payloadBase64 = sessionParts[1].replace(/-/g, '+').replace(/_/g, '/');
                const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
                const payload = JSON.parse(payloadJson);

                if (payload.sid) {
                    clerkSessionId = payload.sid;
                }
                if (payload.sub) {
                    userId = payload.sub;
                }
            }
        } catch (e) {
            console.warn('[Orchids Import] Failed to parse __session JWT:', e.message);
        }

        // 如果无法从 __session 获取 sid，尝试从 __client 获取
        if (!clerkSessionId) {
            try {
                const clientParts = clientCookie.split('.');
                if (clientParts.length === 3) {
                    const payloadBase64 = clientParts[1].replace(/-/g, '+').replace(/_/g, '/');
                    const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
                    const payload = JSON.parse(payloadJson);

                    // 从 client_id 推断 session_id
                    if (payload.id && payload.id.startsWith('client_')) {
                        clerkSessionId = 'sess_' + payload.id.substring(7);
                    }
                }
            } catch (e) {
                console.warn('[Orchids Import] Failed to parse __client JWT:', e.message);
            }
        }

        if (!clerkSessionId) {
            return { success: false, error: '无法从 Cookie 中提取 Session ID' };
        }

        // 构建 cookies 字符串（只保留 __client 和 __session）
        const cookies = `__client=${clientCookie}; __session=${sessionCookie}`;

        return {
            success: true,
            credentials: {
                cookies: cookies,
                clerkSessionId: clerkSessionId,
                userId: userId,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        };

    } catch (error) {
        return { success: false, error: `解析 Cookie 失败: ${error.message}` };
    }
}