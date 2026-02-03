import http from 'http';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { broadcastEvent } from '../services/ui-manager.js';
import { autoLinkProviderConfigs } from '../services/service-manager.js';
import { CONFIG } from '../core/config-manager.js';
import { getProxyConfigForProvider } from '../utils/proxy-utils.js';

/**
 * iFlow OAuth 配置
 */
const IFLOW_OAUTH_CONFIG = {
    // OAuth 端点
    tokenEndpoint: 'https://iflow.cn/oauth/token',
    authorizeEndpoint: 'https://iflow.cn/oauth',
    userInfoEndpoint: 'https://iflow.cn/api/oauth/getUserInfo',
    successRedirectURL: 'https://iflow.cn/oauth/success',
    
    // 客户端凭据
    clientId: '10009311001',
    clientSecret: '4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW',
    
    // 本地回调端口
    callbackPort: 8087,
    
    // 凭据存储
    credentialsDir: '.iflow',
    credentialsFile: 'oauth_creds.json',
    
    // 日志前缀
    logPrefix: '[iFlow Auth]'
};

/**
 * 活动的 iFlow 回调服务器管理
 */
const activeIFlowServers = new Map();

/**
 * 创建带代理支持的 fetch 请求
 * 使用 axios 替代原生 fetch，以正确支持代理配置
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项（兼容 fetch API 格式）
 * @param {string} providerType - 提供商类型，用于获取代理配置
 * @returns {Promise<Object>} 返回类似 fetch Response 的对象
 */
async function fetchWithProxy(url, options = {}, providerType) {
    const proxyConfig = getProxyConfigForProvider(CONFIG, providerType);

    // 构建 axios 配置
    const axiosConfig = {
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 30000, // 30 秒超时
    };

    // 处理请求体
    if (options.body) {
        axiosConfig.data = options.body;
    }

    // 配置代理
    if (proxyConfig) {
        axiosConfig.httpAgent = proxyConfig.httpAgent;
        axiosConfig.httpsAgent = proxyConfig.httpsAgent;
        axiosConfig.proxy = false; // 禁用 axios 内置代理，使用我们的 agent
        logger.info(`[OAuth] Using proxy for ${providerType}: ${CONFIG.PROXY_URL}`);
    }

    try {
        const axios = (await import('axios')).default;
        const response = await axios(axiosConfig);
        
        // 返回类似 fetch Response 的对象
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            json: async () => response.data,
            text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        };
    } catch (error) {
        // 处理 axios 错误，转换为类似 fetch 的响应格式
        if (error.response) {
            // 服务器返回了错误状态码
            return {
                ok: false,
                status: error.response.status,
                statusText: error.response.statusText,
                headers: error.response.headers,
                json: async () => error.response.data,
                text: async () => typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data),
            };
        }
        // 网络错误或其他错误
        throw error;
    }
}

/**
 * 生成 HTML 响应页面
 * @param {boolean} isSuccess - 是否成功
 * @param {string} message - 显示消息
 * @returns {string} HTML 内容
 */
function generateResponsePage(isSuccess, message) {
    const title = isSuccess ? '授权成功！' : '授权失败';
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body>
    <div class="container">
        <h1>${title}</h1>
        <p>${message}</p>
    </div>
</body>
</html>`;
}

/**
 * 生成 iFlow 授权链接
 * @param {string} state - 状态参数
 * @param {number} port - 回调端口
 * @returns {Object} 包含 authUrl 和 redirectUri
 */
function generateIFlowAuthorizationURL(state, port) {
    const redirectUri = `http://localhost:${port}/oauth2callback`;
    const params = new URLSearchParams({
        loginMethod: 'phone',
        type: 'phone',
        redirect: redirectUri,
        state: state,
        client_id: IFLOW_OAUTH_CONFIG.clientId
    });
    const authUrl = `${IFLOW_OAUTH_CONFIG.authorizeEndpoint}?${params.toString()}`;
    return { authUrl, redirectUri };
}

/**
 * 交换授权码获取 iFlow 令牌
 * @param {string} code - 授权码
 * @param {string} redirectUri - 重定向 URI
 * @returns {Promise<Object>} 令牌数据
 */
async function exchangeIFlowCodeForTokens(code, redirectUri) {
    const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: IFLOW_OAUTH_CONFIG.clientId,
        client_secret: IFLOW_OAUTH_CONFIG.clientSecret
    });
    
    // 生成 Basic Auth 头
    const basicAuth = Buffer.from(`${IFLOW_OAUTH_CONFIG.clientId}:${IFLOW_OAUTH_CONFIG.clientSecret}`).toString('base64');

    const response = await fetchWithProxy(IFLOW_OAUTH_CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Authorization': `Basic ${basicAuth}`
        },
        body: form.toString()
    }, 'openai-iflow');

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`iFlow token exchange failed: ${response.status} ${errorText}`);
    }
    
    const tokenData = await response.json();
    
    if (!tokenData.access_token) {
        throw new Error('iFlow token: missing access token in response');
    }
    
    return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
        expiresIn: tokenData.expires_in,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    };
}

/**
 * 获取 iFlow 用户信息（包含 API Key）
 * @param {string} accessToken - 访问令牌
 * @returns {Promise<Object>} 用户信息
 */
async function fetchIFlowUserInfo(accessToken) {
    if (!accessToken || accessToken.trim() === '') {
        throw new Error('iFlow api key: access token is empty');
    }
    
    const endpoint = `${IFLOW_OAUTH_CONFIG.userInfoEndpoint}?accessToken=${encodeURIComponent(accessToken)}`;

    const response = await fetchWithProxy(endpoint, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    }, 'openai-iflow');
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`iFlow user info failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
        throw new Error('iFlow api key: request not successful');
    }
    
    if (!result.data || !result.data.apiKey) {
        throw new Error('iFlow api key: missing api key in response');
    }
    
    // 获取邮箱或手机号作为账户标识
    let email = (result.data.email || '').trim();
    if (!email) {
        email = (result.data.phone || '').trim();
    }
    if (!email) {
        throw new Error('iFlow token: missing account email/phone in user info');
    }
    
    return {
        apiKey: result.data.apiKey,
        email: email,
        phone: result.data.phone || ''
    };
}

/**
 * 关闭 iFlow 服务器
 * @param {string} provider - 提供商标识
 * @param {number} port - 端口号（可选）
 */
async function closeIFlowServer(provider, port = null) {
    const existing = activeIFlowServers.get(provider);
    if (existing) {
        await new Promise((resolve) => {
            existing.server.close(() => {
                activeIFlowServers.delete(provider);
                logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 已关闭提供商 ${provider} 在端口 ${existing.port} 上的旧服务器`);
                resolve();
            });
        });
    }

    if (port) {
        for (const [p, info] of activeIFlowServers.entries()) {
            if (info.port === port) {
                await new Promise((resolve) => {
                    info.server.close(() => {
                        activeIFlowServers.delete(p);
                        logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 已关闭端口 ${port} 上的旧服务器`);
                        resolve();
                    });
                });
            }
        }
    }
}

/**
 * 创建 iFlow OAuth 回调服务器
 * @param {number} port - 端口号
 * @param {string} redirectUri - 重定向 URI
 * @param {string} expectedState - 预期的 state 参数
 * @param {Object} options - 额外选项
 * @returns {Promise<http.Server>} HTTP 服务器实例
 */
function createIFlowCallbackServer(port, redirectUri, expectedState, options = {}) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url, `http://localhost:${port}`);
                
                if (url.pathname === '/oauth2callback') {
                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const errorParam = url.searchParams.get('error');
                    
                    if (errorParam) {
                        logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 授权失败: ${errorParam}`);
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `授权失败: ${errorParam}`));
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                        return;
                    }
                    
                    if (state !== expectedState) {
                        logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} State 验证失败`);
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, 'State 验证失败'));
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                        return;
                    }
                    
                    if (!code) {
                        logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 缺少授权码`);
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, '缺少授权码'));
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                        return;
                    }
                    
                    logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 收到授权回调，正在交换令牌...`);
                    
                    try {
                        // 1. 交换授权码获取令牌
                        const tokenData = await exchangeIFlowCodeForTokens(code, redirectUri);
                        logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 令牌交换成功`);
                        
                        // 2. 获取用户信息（包含 API Key）
                        const userInfo = await fetchIFlowUserInfo(tokenData.accessToken);
                        logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 用户信息获取成功: ${userInfo.email}`);
                        
                        // 3. 组合完整的凭据数据
                        const credentialsData = {
                            access_token: tokenData.accessToken,
                            refresh_token: tokenData.refreshToken,
                            expiry_date: new Date(tokenData.expiresAt).getTime(),
                            token_type: tokenData.tokenType,
                            scope: tokenData.scope,
                            apiKey: userInfo.apiKey
                        };
                        
                        // 4. 保存凭据
                        let credPath = path.join(os.homedir(), IFLOW_OAUTH_CONFIG.credentialsDir, IFLOW_OAUTH_CONFIG.credentialsFile);
                        
                        if (options.saveToConfigs) {
                            const providerDir = options.providerDir || 'iflow';
                            const targetDir = path.join(process.cwd(), 'configs', providerDir);
                            await fs.promises.mkdir(targetDir, { recursive: true });
                            const timestamp = Date.now();
                            const filename = `${timestamp}_oauth_creds.json`;
                            credPath = path.join(targetDir, filename);
                        }
                        
                        await fs.promises.mkdir(path.dirname(credPath), { recursive: true });
                        await fs.promises.writeFile(credPath, JSON.stringify(credentialsData, null, 2));
                        logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 凭据已保存: ${credPath}`);
                        
                        const relativePath = path.relative(process.cwd(), credPath);
                        
                        // 5. 广播授权成功事件
                        broadcastEvent('oauth_success', {
                            provider: 'openai-iflow',
                            credPath: credPath,
                            relativePath: relativePath,
                            email: userInfo.email,
                            timestamp: new Date().toISOString()
                        });
                        
                        // 6. 自动关联新生成的凭据到 Pools
                        await autoLinkProviderConfigs(CONFIG, {
                            onlyCurrentCred: true,
                            credPath: relativePath
                        });
                        
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(true, `授权成功！账户: ${userInfo.email}，您可以关闭此页面`));
                        
                    } catch (tokenError) {
                        logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 令牌处理失败:`, tokenError);
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `令牌处理失败: ${tokenError.message}`));
                    } finally {
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                    }
                } else {
                    // 忽略其他请求
                    res.writeHead(204);
                    res.end();
                }
            } catch (error) {
                logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 处理回调出错:`, error);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(generateResponsePage(false, `服务器错误: ${error.message}`));
                
                if (server.listening) {
                    server.close(() => {
                        activeIFlowServers.delete('openai-iflow');
                    });
                }
            }
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 端口 ${port} 已被占用`);
                reject(new Error(`端口 ${port} 已被占用`));
            } else {
                logger.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 服务器错误:`, err);
                reject(err);
            }
        });
        
        const host = '0.0.0.0';
        server.listen(port, host, () => {
            logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} OAuth 回调服务器已启动于 ${host}:${port}`);
            resolve(server);
        });
        
        // 10 分钟超时自动关闭
        setTimeout(() => {
            if (server.listening) {
                logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 回调服务器超时，自动关闭`);
                server.close(() => {
                    activeIFlowServers.delete('openai-iflow');
                });
            }
        }, 10 * 60 * 1000);
    });
}

/**
 * 处理 iFlow OAuth 授权
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 *   - port: 自定义端口号
 *   - saveToConfigs: 是否保存到 configs 目录
 *   - providerDir: 提供商目录名
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleIFlowOAuth(currentConfig, options = {}) {
    const port = parseInt(options.port) || IFLOW_OAUTH_CONFIG.callbackPort;
    const providerKey = 'openai-iflow';
    
    // 生成 state 参数
    const state = crypto.randomBytes(16).toString('base64url');
    
    // 生成授权链接
    const { authUrl, redirectUri } = generateIFlowAuthorizationURL(state, port);
    
    logger.info(`${IFLOW_OAUTH_CONFIG.logPrefix} 生成授权链接: ${authUrl}`);
    
    // 关闭之前可能存在的服务器
    await closeIFlowServer(providerKey, port);
    
    // 启动回调服务器
    try {
        const server = await createIFlowCallbackServer(port, redirectUri, state, options);
        activeIFlowServers.set(providerKey, { server, port });
    } catch (error) {
        throw new Error(`启动 iFlow 回调服务器失败: ${error.message}`);
    }
    
    return {
        authUrl,
        authInfo: {
            provider: 'openai-iflow',
            redirectUri: redirectUri,
            callbackPort: port,
            state: state,
            ...options
        }
    };
}

/**
 * 使用 refresh_token 刷新 iFlow 令牌
 * @param {string} refreshToken - 刷新令牌
 * @returns {Promise<Object>} 新的令牌数据
 */
export async function refreshIFlowTokens(refreshToken) {
    const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: IFLOW_OAUTH_CONFIG.clientId,
        client_secret: IFLOW_OAUTH_CONFIG.clientSecret
    });
    
    // 生成 Basic Auth 头
    const basicAuth = Buffer.from(`${IFLOW_OAUTH_CONFIG.clientId}:${IFLOW_OAUTH_CONFIG.clientSecret}`).toString('base64');

    const response = await fetchWithProxy(IFLOW_OAUTH_CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Authorization': `Basic ${basicAuth}`
        },
        body: form.toString()
    }, 'openai-iflow');

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`iFlow token refresh failed: ${response.status} ${errorText}`);
    }
    
    const tokenData = await response.json();
    
    if (!tokenData.access_token) {
        throw new Error('iFlow token refresh: missing access token in response');
    }
    
    // 获取用户信息以更新 API Key
    const userInfo = await fetchIFlowUserInfo(tokenData.access_token);
    
    return {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: Date.now() + tokenData.expires_in * 1000,
        token_type: tokenData.token_type,
        scope: tokenData.scope,
        apiKey: userInfo.apiKey
    };
}