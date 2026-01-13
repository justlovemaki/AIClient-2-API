import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import open from 'open';
import { broadcastEvent } from '../services/ui-manager.js';
import { autoLinkProviderConfigs } from '../services/service-manager.js';
import { CONFIG } from '../core/config-manager.js';
import { getGoogleAuthProxyConfig, getProxyConfigForProvider } from '../utils/proxy-utils.js';

/**
 * OAuth 提供商配置
 */
const OAUTH_PROVIDERS = {
    'gemini-cli-oauth': {
        clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
        clientSecret: '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',
        port: 8085,
        credentialsDir: '.gemini',
        credentialsFile: 'oauth_creds.json',
        scope: ['https://www.googleapis.com/auth/cloud-platform'],
        logPrefix: '[Gemini Auth]'
    },
    'gemini-antigravity': {
        clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
        clientSecret: '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',
        port: 8086,
        credentialsDir: '.antigravity',
        credentialsFile: 'oauth_creds.json',
        scope: ['https://www.googleapis.com/auth/cloud-platform'],
        logPrefix: '[Antigravity Auth]'
    }
};

/**
 * 活动的服务器实例管理
 */
const activeServers = new Map();

/**
 * 活动的轮询任务管理
 */
const activePollingTasks = new Map();

/**
 * Qwen OAuth 配置
 */
const QWEN_OAUTH_CONFIG = {
    clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
    scope: 'openid profile email model.completion',
    deviceCodeEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
    tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
    grantType: 'urn:ietf:params:oauth:grant-type:device_code',
    credentialsDir: '.qwen',
    credentialsFile: 'oauth_creds.json',
    logPrefix: '[Qwen Auth]'
};

/**
 * Kiro OAuth 配置（支持多种认证方式）
 */
const KIRO_OAUTH_CONFIG = {
    // Kiro Auth Service 端点 (用于 Social Auth)
    authServiceEndpoint: 'https://prod.us-east-1.auth.desktop.kiro.dev',
    
    // AWS SSO OIDC 端点 (用于 Builder ID)
    ssoOIDCEndpoint: 'https://oidc.us-east-1.amazonaws.com',
    
    // AWS Builder ID 起始 URL
    builderIDStartURL: 'https://view.awsapps.com/start',
    
    // 本地回调端口范围（用于 Social Auth HTTP 回调）
    callbackPortStart: 19876,
    callbackPortEnd: 19880,
    
    // 超时配置
    authTimeout: 10 * 60 * 1000,  // 10 分钟
    pollInterval: 5000,           // 5 秒
    
    // CodeWhisperer Scopes
    scopes: [
        'codewhisperer:completions',
        'codewhisperer:analysis',
        'codewhisperer:conversations',
        'codewhisperer:transformations',
        'codewhisperer:taskassist'
    ],
    
    // 凭据存储（符合现有规范）
    credentialsDir: '.kiro',
    credentialsFile: 'oauth_creds.json',
    
    // 日志前缀
    logPrefix: '[Kiro Auth]'
};

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
 * 活动的 Kiro 回调服务器管理
 */
const activeKiroServers = new Map();

/**
 * 活动的 Kiro 轮询任务管理（用于 Builder ID Device Code）
 */
const activeKiroPollingTasks = new Map();

/**
 * 创建带代理支持的 fetch 请求
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {string} providerType - 提供商类型，用于获取代理配置
 * @returns {Promise<Response>}
 */
async function fetchWithProxy(url, options = {}, providerType) {
    const proxyConfig = getProxyConfigForProvider(CONFIG, providerType);

    if (proxyConfig) {
        // 根据 URL 协议选择合适的 agent
        const urlObj = new URL(url);
        const agent = urlObj.protocol === 'https:' ? proxyConfig.httpsAgent : proxyConfig.httpAgent;
        options.dispatcher = agent;
    }

    return fetch(url, options);
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
 * 关闭指定端口的活动服务器
 * @param {number} port - 端口号
 * @returns {Promise<void>}
 */
async function closeActiveServer(provider, port = null) {
    // 1. 关闭该提供商之前的所有服务器
    const existing = activeServers.get(provider);
    if (existing) {
        await new Promise((resolve) => {
            existing.server.close(() => {
                activeServers.delete(provider);
                console.log(`[OAuth] 已关闭提供商 ${provider} 在端口 ${existing.port} 上的旧服务器`);
                resolve();
            });
        });
    }

    // 2. 如果指定了端口，检查是否有其他提供商占用了该端口
    if (port) {
        for (const [p, info] of activeServers.entries()) {
            if (info.port === port) {
                await new Promise((resolve) => {
                    info.server.close(() => {
                        activeServers.delete(p);
                        console.log(`[OAuth] 已关闭端口 ${port} 上被占用（提供商: ${p}）的旧服务器`);
                        resolve();
                    });
                });
            }
        }
    }
}

/**
 * 创建 OAuth 回调服务器
 * @param {Object} config - OAuth 提供商配置
 * @param {string} redirectUri - 重定向 URI
 * @param {OAuth2Client} authClient - OAuth2 客户端
 * @param {string} credPath - 凭据保存路径
 * @param {string} provider - 提供商标识
 * @returns {Promise<http.Server>} HTTP 服务器实例
 */
async function createOAuthCallbackServer(config, redirectUri, authClient, credPath, provider, options = {}) {
    const port = parseInt(options.port) || config.port;
    // 先关闭该提供商之前可能运行的所有服务器，或该端口上的旧服务器
    await closeActiveServer(provider, port);
    
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url, redirectUri);
                const code = url.searchParams.get('code');
                const errorParam = url.searchParams.get('error');
                
                if (code) {
                    console.log(`${config.logPrefix} 收到来自 Google 的成功回调: ${req.url}`);
                    
                    try {
                        const { tokens } = await authClient.getToken(code);
                        let finalCredPath = credPath;
                        
                        // 如果指定了保存到 configs 目录
                        if (options.saveToConfigs) {
                            const providerDir = options.providerDir;
                            const targetDir = path.join(process.cwd(), 'configs', providerDir);
                            await fs.promises.mkdir(targetDir, { recursive: true });
                            const timestamp = Date.now();
                            const filename = `${timestamp}_oauth_creds.json`;
                            finalCredPath = path.join(targetDir, filename);
                        }

                        await fs.promises.mkdir(path.dirname(finalCredPath), { recursive: true });
                        await fs.promises.writeFile(finalCredPath, JSON.stringify(tokens, null, 2));
                        console.log(`${config.logPrefix} 新令牌已接收并保存到文件: ${finalCredPath}`);
                        
                        const relativePath = path.relative(process.cwd(), finalCredPath);

                        // 广播授权成功事件
                        broadcastEvent('oauth_success', {
                            provider: provider,
                            credPath: finalCredPath,
                            relativePath: relativePath,
                            timestamp: new Date().toISOString()
                        });
                        
                        // 自动关联新生成的凭据到 Pools
                        await autoLinkProviderConfigs(CONFIG);
                        
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(true, '您可以关闭此页面'));
                    } catch (tokenError) {
                        console.error(`${config.logPrefix} 获取令牌失败:`, tokenError);
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `获取令牌失败: ${tokenError.message}`));
                    } finally {
                        server.close(() => {
                            activeServers.delete(provider);
                        });
                    }
                } else if (errorParam) {
                    const errorMessage = `授权失败。Google 返回错误: ${errorParam}`;
                    console.error(`${config.logPrefix}`, errorMessage);
                    
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(generateResponsePage(false, errorMessage));
                    server.close(() => {
                        activeServers.delete(provider);
                    });
                } else {
                    console.log(`${config.logPrefix} 忽略无关请求: ${req.url}`);
                    res.writeHead(204);
                    res.end();
                }
            } catch (error) {
                console.error(`${config.logPrefix} 处理回调时出错:`, error);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(generateResponsePage(false, `服务器错误: ${error.message}`));
                
                if (server.listening) {
                    server.close(() => {
                        activeServers.delete(provider);
                    });
                }
            }
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`${config.logPrefix} 端口 ${port} 已被占用`);
                reject(new Error(`端口 ${port} 已被占用`));
            } else {
                console.error(`${config.logPrefix} 服务器错误:`, err);
                reject(err);
            }
        });
        
        const host = '0.0.0.0';
        server.listen(port, host, () => {
            console.log(`${config.logPrefix} OAuth 回调服务器已启动于 ${host}:${port}`);
            activeServers.set(provider, { server, port });
            resolve(server);
        });
    });
}

/**
 * 处理 Google OAuth 授权（通用函数）
 * @param {string} providerKey - 提供商键名
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
async function handleGoogleOAuth(providerKey, currentConfig, options = {}) {
    const config = OAUTH_PROVIDERS[providerKey];
    if (!config) {
        throw new Error(`未知的提供商: ${providerKey}`);
    }
    
    const port = parseInt(options.port) || config.port;
    const host = 'localhost';
    const redirectUri = `http://${host}:${port}`;

    // 获取代理配置
    const proxyConfig = getGoogleAuthProxyConfig(currentConfig, providerKey);

    // 构建 OAuth2Client 选项
    const oauth2Options = {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
    };

    if (proxyConfig) {
        oauth2Options.transporterOptions = proxyConfig;
        console.log(`${config.logPrefix} Using proxy for OAuth token exchange`);
    }

    const authClient = new OAuth2Client(oauth2Options);
    authClient.redirectUri = redirectUri;
    
    const authUrl = authClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'select_account',
        scope: config.scope
    });
    
    // 启动回调服务器
    const credPath = path.join(os.homedir(), config.credentialsDir, config.credentialsFile);
    
    try {
        await createOAuthCallbackServer(config, redirectUri, authClient, credPath, providerKey, options);
    } catch (error) {
        throw new Error(`启动回调服务器失败: ${error.message}`);
    }
    
    return {
        authUrl,
        authInfo: {
            provider: providerKey,
            redirectUri: redirectUri,
            port: port,
            ...options
        }
    };
}

/**
 * 处理 Gemini CLI OAuth 授权
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleGeminiCliOAuth(currentConfig, options = {}) {
    return handleGoogleOAuth('gemini-cli-oauth', currentConfig, options);
}

/**
 * 处理 Gemini Antigravity OAuth 授权
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleGeminiAntigravityOAuth(currentConfig, options = {}) {
    return handleGoogleOAuth('gemini-antigravity', currentConfig, options);
}

/**
 * 生成 PKCE 代码验证器
 * @returns {string} Base64URL 编码的随机字符串
 */
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * 生成 PKCE 代码挑战
 * @param {string} codeVerifier - 代码验证器
 * @returns {string} Base64URL 编码的 SHA256 哈希
 */
function generateCodeChallenge(codeVerifier) {
    const hash = crypto.createHash('sha256');
    hash.update(codeVerifier);
    return hash.digest('base64url');
}

/**
 * 停止活动的轮询任务
 * @param {string} taskId - 任务标识符
 */
function stopPollingTask(taskId) {
    const task = activePollingTasks.get(taskId);
    if (task) {
        task.shouldStop = true;
        activePollingTasks.delete(taskId);
        console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 已停止轮询任务: ${taskId}`);
    }
}

/**
 * 轮询获取 Qwen OAuth 令牌
 * @param {string} deviceCode - 设备代码
 * @param {string} codeVerifier - PKCE 代码验证器
 * @param {number} interval - 轮询间隔（秒）
 * @param {number} expiresIn - 过期时间（秒）
 * @param {string} taskId - 任务标识符
 * @param {Object} options - 额外选项
 * @returns {Promise<Object>} 返回令牌信息
 */
async function pollQwenToken(deviceCode, codeVerifier, interval = 5, expiresIn = 300, taskId = 'default', options = {}) {
    let credPath = path.join(os.homedir(), QWEN_OAUTH_CONFIG.credentialsDir, QWEN_OAUTH_CONFIG.credentialsFile);
    const maxAttempts = Math.floor(expiresIn / interval);
    let attempts = 0;
    
    // 创建任务控制对象
    const taskControl = { shouldStop: false };
    activePollingTasks.set(taskId, taskControl);
    
    console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 开始轮询令牌 [${taskId}]，间隔 ${interval} 秒，最多尝试 ${maxAttempts} 次`);
    
    const poll = async () => {
        // 检查是否需要停止
        if (taskControl.shouldStop) {
            console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 轮询任务 [${taskId}] 已被停止`);
            throw new Error('轮询任务已被取消');
        }
        
        if (attempts >= maxAttempts) {
            activePollingTasks.delete(taskId);
            throw new Error('授权超时，请重新开始授权流程');
        }
        
        attempts++;
        
        const bodyData = {
            client_id: QWEN_OAUTH_CONFIG.clientId,
            device_code: deviceCode,
            grant_type: QWEN_OAUTH_CONFIG.grantType,
            code_verifier: codeVerifier
        };
        
        const formBody = Object.entries(bodyData)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        
        try {
            const response = await fetchWithProxy(QWEN_OAUTH_CONFIG.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: formBody
            }, 'openai-qwen-oauth');
            
            const data = await response.json();
            
            if (response.ok && data.access_token) {
                // 成功获取令牌
                console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 成功获取令牌 [${taskId}]`);
                
                // 如果指定了保存到 configs 目录
                if (options.saveToConfigs) {
                    const targetDir = path.join(process.cwd(), 'configs', options.providerDir);
                    await fs.promises.mkdir(targetDir, { recursive: true });
                    const timestamp = Date.now();
                    const filename = `${timestamp}_oauth_creds.json`;
                    credPath = path.join(targetDir, filename);
                }

                // 保存令牌到文件
                await fs.promises.mkdir(path.dirname(credPath), { recursive: true });
                await fs.promises.writeFile(credPath, JSON.stringify(data, null, 2));
                console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 令牌已保存到 ${credPath}`);
                
                const relativePath = path.relative(process.cwd(), credPath);

                // 清理任务
                activePollingTasks.delete(taskId);
                
                // 广播授权成功事件
                broadcastEvent('oauth_success', {
                    provider: 'openai-qwen-oauth',
                    credPath: credPath,
                    relativePath: relativePath,
                    timestamp: new Date().toISOString()
                });
                
                // 自动关联新生成的凭据到 Pools
                await autoLinkProviderConfigs(CONFIG);
                
                return data;
            }
            
            // 检查错误类型
            if (data.error === 'authorization_pending') {
                // 用户尚未完成授权，继续轮询
                console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 等待用户授权 [${taskId}]... (第 ${attempts}/${maxAttempts} 次尝试)`);
                await new Promise(resolve => setTimeout(resolve, interval * 1000));
                return poll();
            } else if (data.error === 'slow_down') {
                // 需要降低轮询频率
                console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 降低轮询频率`);
                await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000));
                return poll();
            } else if (data.error === 'expired_token') {
                activePollingTasks.delete(taskId);
                throw new Error('设备代码已过期，请重新开始授权流程');
            } else if (data.error === 'access_denied') {
                activePollingTasks.delete(taskId);
                throw new Error('用户拒绝了授权请求');
            } else {
                activePollingTasks.delete(taskId);
                throw new Error(`授权失败: ${data.error || '未知错误'}`);
            }
        } catch (error) {
            if (error.message.includes('授权') || error.message.includes('过期') || error.message.includes('拒绝')) {
                throw error;
            }
            console.error(`${QWEN_OAUTH_CONFIG.logPrefix} 轮询出错:`, error);
            // 网络错误，继续重试
            await new Promise(resolve => setTimeout(resolve, interval * 1000));
            return poll();
        }
    };
    
    return poll();
}

/**
 * 处理 Qwen OAuth 授权（设备授权流程）
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleQwenOAuth(currentConfig, options = {}) {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    
    const bodyData = {
        client_id: QWEN_OAUTH_CONFIG.clientId,
        scope: QWEN_OAUTH_CONFIG.scope,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
    };
    
    const formBody = Object.entries(bodyData)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    
    try {
        const response = await fetchWithProxy(QWEN_OAUTH_CONFIG.deviceCodeEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: formBody
        }, 'openai-qwen-oauth');
        
        if (!response.ok) {
            throw new Error(`Qwen OAuth请求失败: ${response.status} ${response.statusText}`);
        }
        
        const deviceAuth = await response.json();
        
        if (!deviceAuth.device_code || !deviceAuth.verification_uri_complete) {
            throw new Error('Qwen OAuth响应格式错误，缺少必要字段');
        }
        
        // 启动后台轮询获取令牌
        const interval = 5;
        // const expiresIn = deviceAuth.expires_in || 1800;
        const expiresIn = 300;
        
        // 生成唯一的任务ID
        const taskId = `qwen-${deviceAuth.device_code.substring(0, 8)}-${Date.now()}`;
        
        // 先停止之前可能存在的所有 Qwen 轮询任务
        for (const [existingTaskId] of activePollingTasks.entries()) {
            if (existingTaskId.startsWith('qwen-')) {
                stopPollingTask(existingTaskId);
            }
        }
        
        // 不等待轮询完成，立即返回授权信息
        pollQwenToken(deviceAuth.device_code, codeVerifier, interval, expiresIn, taskId, options)
            .catch(error => {
                console.error(`${QWEN_OAUTH_CONFIG.logPrefix} 轮询失败 [${taskId}]:`, error);
                // 广播授权失败事件
                broadcastEvent('oauth_error', {
                    provider: 'openai-qwen-oauth',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            });
        
        return {
            authUrl: deviceAuth.verification_uri_complete,
            authInfo: {
                provider: 'openai-qwen-oauth',
                deviceCode: deviceAuth.device_code,
                userCode: deviceAuth.user_code,
                verificationUri: deviceAuth.verification_uri,
                verificationUriComplete: deviceAuth.verification_uri_complete,
                expiresIn: expiresIn,
                interval: interval,
                codeVerifier: codeVerifier
            }
        };
    } catch (error) {
        console.error(`${QWEN_OAUTH_CONFIG.logPrefix} 请求失败:`, error);
        throw new Error(`Qwen OAuth 授权失败: ${error.message}`);
    }
}

/**
 * 处理 Kiro OAuth 授权（统一入口）
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 *   - method: 'google' | 'github' | 'builder-id'
 *   - saveToConfigs: boolean
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleKiroOAuth(currentConfig, options = {}) {
    const method = options.method || options.authMethod || 'google';  // 默认使用 Google，同时支持 authMethod 参数
    
    console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Starting OAuth with method: ${method}`);
    
    switch (method) {
        case 'google':
            return handleKiroSocialAuth('Google', currentConfig, options);
        case 'github':
            return handleKiroSocialAuth('Github', currentConfig, options);
        case 'builder-id':
            return handleKiroBuilderIDDeviceCode(currentConfig, options);
        default:
            throw new Error(`不支持的认证方式: ${method}`);
    }
}

/**
 * Kiro Social Auth (Google/GitHub) - 使用 HTTP localhost 回调
 */
async function handleKiroSocialAuth(provider, currentConfig, options = {}) {
    // 生成 PKCE 参数
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('base64url');
    
    // 启动本地回调服务器并获取端口
    let handlerPort;
    const providerKey = 'claude-kiro-oauth';
    if (options.port) {
        const port = parseInt(options.port);
        await closeKiroServer(providerKey, port);
        const server = await createKiroHttpCallbackServer(port, codeVerifier, state, options);
        activeKiroServers.set(providerKey, { server, port });
        handlerPort = port;
    } else {
        handlerPort = await startKiroCallbackServer(codeVerifier, state, options);
    }
    
    // 使用 HTTP localhost 作为 redirect_uri
    const redirectUri = `http://127.0.0.1:${handlerPort}/oauth/callback`;
    
    // 构建授权 URL
    const authUrl = `${KIRO_OAUTH_CONFIG.authServiceEndpoint}/login?` +
        `idp=${provider}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256&` +
        `state=${state}&` +
        `prompt=select_account`;
    
    return {
        authUrl,
        authInfo: {
            provider: 'claude-kiro-oauth',
            authMethod: 'social',
            socialProvider: provider,
            port: handlerPort,
            redirectUri: redirectUri,
            state: state,
            ...options
        }
    };
}

/**
 * Kiro Builder ID - Device Code Flow（类似 Qwen OAuth 模式）
 */
async function handleKiroBuilderIDDeviceCode(currentConfig, options = {}) {
    // 停止之前的轮询任务
    for (const [existingTaskId] of activeKiroPollingTasks.entries()) {
        if (existingTaskId.startsWith('kiro-')) {
            stopKiroPollingTask(existingTaskId);
        }
    }

    // 获取 Builder ID Start URL（优先使用前端传入的值，否则使用默认值）
    const builderIDStartURL = options.builderIDStartURL || KIRO_OAUTH_CONFIG.builderIDStartURL;
    console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Using Builder ID Start URL: ${builderIDStartURL}`);

    // 1. 注册 OIDC 客户端
    const regResponse = await fetchWithProxy(`${KIRO_OAUTH_CONFIG.ssoOIDCEndpoint}/client/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'KiroIDE'
        },
        body: JSON.stringify({
            clientName: 'Kiro IDE',
            clientType: 'public',
            scopes: KIRO_OAUTH_CONFIG.scopes,
            grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
        })
    }, 'claude-kiro-oauth');
    
    if (!regResponse.ok) {
        throw new Error(`Kiro OAuth 客户端注册失败: ${regResponse.status}`);
    }
    
    const regData = await regResponse.json();
    
    // 2. 启动设备授权
    const authResponse = await fetchWithProxy(`${KIRO_OAUTH_CONFIG.ssoOIDCEndpoint}/device_authorization`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'KiroIDE'
        },
        body: JSON.stringify({
            clientId: regData.clientId,
            clientSecret: regData.clientSecret,
            startUrl: builderIDStartURL
        })
    }, 'claude-kiro-oauth');
    
    if (!authResponse.ok) {
        throw new Error(`Kiro OAuth 设备授权失败: ${authResponse.status}`);
    }
    
    const deviceAuth = await authResponse.json();
    
    // 3. 启动后台轮询（类似 Qwen OAuth 的模式）
    const taskId = `kiro-${deviceAuth.deviceCode.substring(0, 8)}-${Date.now()}`;

    
    // 异步轮询
    pollKiroBuilderIDToken(
        regData.clientId,
        regData.clientSecret,
        deviceAuth.deviceCode,
        5, 
        300, 
        taskId,
        options
    ).catch(error => {
        console.error(`${KIRO_OAUTH_CONFIG.logPrefix} 轮询失败 [${taskId}]:`, error);
        broadcastEvent('oauth_error', {
            provider: 'claude-kiro-oauth',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    });
    
    return {
        authUrl: deviceAuth.verificationUriComplete,
        authInfo: {
            provider: 'claude-kiro-oauth',
            authMethod: 'builder-id',
            deviceCode: deviceAuth.deviceCode,
            userCode: deviceAuth.userCode,
            verificationUri: deviceAuth.verificationUri,
            verificationUriComplete: deviceAuth.verificationUriComplete,
            expiresIn: deviceAuth.expiresIn,
            interval: deviceAuth.interval,
            ...options
        }
    };
}

/**
 * 轮询获取 Kiro Builder ID Token
 */
async function pollKiroBuilderIDToken(clientId, clientSecret, deviceCode, interval, expiresIn, taskId, options = {}) {
    let credPath = path.join(os.homedir(), KIRO_OAUTH_CONFIG.credentialsDir, KIRO_OAUTH_CONFIG.credentialsFile);
    const maxAttempts = Math.floor(expiresIn / interval);
    let attempts = 0;
    
    const taskControl = { shouldStop: false };
    activeKiroPollingTasks.set(taskId, taskControl);
    
    console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 开始轮询令牌 [${taskId}]`);
    
    const poll = async () => {
        if (taskControl.shouldStop) {
            throw new Error('轮询任务已被取消');
        }
        
        if (attempts >= maxAttempts) {
            activeKiroPollingTasks.delete(taskId);
            throw new Error('授权超时');
        }
        
        attempts++;
        
        try {
            const response = await fetchWithProxy(`${KIRO_OAUTH_CONFIG.ssoOIDCEndpoint}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'KiroIDE'
                },
                body: JSON.stringify({
                    clientId,
                    clientSecret,
                    deviceCode,
                    grantType: 'urn:ietf:params:oauth:grant-type:device_code'
                })
            }, 'claude-kiro-oauth');
            
            const data = await response.json();
            
            if (response.ok && data.accessToken) {
                console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 成功获取令牌 [${taskId}]`);
                
                // 保存令牌（符合现有规范）
                if (options.saveToConfigs) {
                    const timestamp = Date.now();
                    const folderName = `${timestamp}_kiro-auth-token`;
                    const targetDir = path.join(process.cwd(), 'configs', 'kiro', folderName);
                    await fs.promises.mkdir(targetDir, { recursive: true });
                    credPath = path.join(targetDir, `${folderName}.json`);
                }
                
                const tokenData = {
                    accessToken: data.accessToken,
                    refreshToken: data.refreshToken,
                    expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString(),
                    authMethod: 'builder-id',
                    clientId,
                    clientSecret,
                    region: 'us-east-1'
                };
                
                await fs.promises.mkdir(path.dirname(credPath), { recursive: true });
                await fs.promises.writeFile(credPath, JSON.stringify(tokenData, null, 2));
                
                activeKiroPollingTasks.delete(taskId);
                
                // 广播成功事件（符合现有规范）
                broadcastEvent('oauth_success', {
                    provider: 'claude-kiro-oauth',
                    credPath,
                    relativePath: path.relative(process.cwd(), credPath),
                    timestamp: new Date().toISOString()
                });
                
                // 自动关联新生成的凭据到 Pools
                await autoLinkProviderConfigs(CONFIG);
                
                return tokenData;
            }
            
            // 检查错误类型
            if (data.error === 'authorization_pending') {
                console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 等待用户授权 [${taskId}]... (${attempts}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, interval * 1000));
                return poll();
            } else if (data.error === 'slow_down') {
                await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000));
                return poll();
            } else {
                activeKiroPollingTasks.delete(taskId);
                throw new Error(`授权失败: ${data.error || '未知错误'}`);
            }
        } catch (error) {
            if (error.message.includes('授权') || error.message.includes('取消')) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, interval * 1000));
            return poll();
        }
    };
    
    return poll();
}

/**
 * 停止 Kiro 轮询任务
 */
function stopKiroPollingTask(taskId) {
    const task = activeKiroPollingTasks.get(taskId);
    if (task) {
        task.shouldStop = true;
        activeKiroPollingTasks.delete(taskId);
        console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 已停止轮询任务: ${taskId}`);
    }
}

/**
 * 启动 Kiro 回调服务器（用于 Social Auth HTTP 回调）
 */
async function startKiroCallbackServer(codeVerifier, expectedState, options = {}) {
    const portStart = KIRO_OAUTH_CONFIG.callbackPortStart;
    const portEnd = KIRO_OAUTH_CONFIG.callbackPortEnd;
    
    for (let port = portStart; port <= portEnd; port++) {
    // 关闭已存在的服务器
    await closeKiroServer(port);
    
    try {
        const server = await createKiroHttpCallbackServer(port, codeVerifier, expectedState, options);
        activeKiroServers.set('claude-kiro-oauth', { server, port });
        console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 回调服务器已启动于端口 ${port}`);
        return port;
    } catch (err) {
            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 端口 ${port} 被占用，尝试下一个...`);
    }
    }
    
    throw new Error('所有端口都被占用');
}

/**
 * 关闭 Kiro 服务器
 */
async function closeKiroServer(provider, port = null) {
    const existing = activeKiroServers.get(provider);
    if (existing) {
        await new Promise((resolve) => {
            existing.server.close(() => {
                activeKiroServers.delete(provider);
                console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 已关闭提供商 ${provider} 在端口 ${existing.port} 上的旧服务器`);
                resolve();
            });
        });
    }

    if (port) {
        for (const [p, info] of activeKiroServers.entries()) {
            if (info.port === port) {
                await new Promise((resolve) => {
                    info.server.close(() => {
                        activeKiroServers.delete(p);
                        console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 已关闭端口 ${port} 上的旧服务器`);
                        resolve();
                    });
                });
            }
        }
    }
}

/**
 * 创建 Kiro HTTP 回调服务器
 */
function createKiroHttpCallbackServer(port, codeVerifier, expectedState, options = {}) {
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url, `http://127.0.0.1:${port}`);
                
                if (url.pathname === '/oauth/callback') {
                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const errorParam = url.searchParams.get('error');
                    
                    if (errorParam) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `授权失败: ${errorParam}`));
                        return;
                    }
                    
                    if (state !== expectedState) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, 'State 验证失败'));
                        return;
                    }
                    
                    // 交换 Code 获取 Token（使用动态的 redirect_uri）
                    const tokenResponse = await fetchWithProxy(`${KIRO_OAUTH_CONFIG.authServiceEndpoint}/oauth/token`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': 'AIClient-2-API/1.0.0'
                        },
                        body: JSON.stringify({
                            code,
                            code_verifier: codeVerifier,
                            redirect_uri: redirectUri
                        })
                    }, 'claude-kiro-oauth');
                    
                    if (!tokenResponse.ok) {
                        const errorText = await tokenResponse.text();
                        console.error(`${KIRO_OAUTH_CONFIG.logPrefix} Token exchange failed:`, errorText);
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `获取令牌失败: ${tokenResponse.status}`));
                        return;
                    }
                    
                    const tokenData = await tokenResponse.json();
                    
                    // 保存令牌
                    let credPath = path.join(os.homedir(), KIRO_OAUTH_CONFIG.credentialsDir, KIRO_OAUTH_CONFIG.credentialsFile);
                    
                    if (options.saveToConfigs) {
                        const timestamp = Date.now();
                        const folderName = `${timestamp}_kiro-auth-token`;
                        const targetDir = path.join(process.cwd(), 'configs', 'kiro', folderName);
                        await fs.promises.mkdir(targetDir, { recursive: true });
                        credPath = path.join(targetDir, `${folderName}.json`);
                    }
                    
                    const saveData = {
                        accessToken: tokenData.accessToken,
                        refreshToken: tokenData.refreshToken,
                        profileArn: tokenData.profileArn,
                        expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
                        authMethod: 'social',
                        region: 'us-east-1'
                    };
                    
                    await fs.promises.mkdir(path.dirname(credPath), { recursive: true });
                    await fs.promises.writeFile(credPath, JSON.stringify(saveData, null, 2));
                    
                    console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 令牌已保存: ${credPath}`);
                    
                    // 广播成功事件
                    broadcastEvent('oauth_success', {
                        provider: 'claude-kiro-oauth',
                        credPath,
                        relativePath: path.relative(process.cwd(), credPath),
                        timestamp: new Date().toISOString()
                    });
                    
                    // 自动关联新生成的凭据到 Pools
                    await autoLinkProviderConfigs(CONFIG);
                    
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(generateResponsePage(true, '授权成功！您可以关闭此页面'));
                    
                    // 关闭服务器
                    server.close(() => {
                        activeKiroServers.delete('claude-kiro-oauth');
                    });
                    
                } else {
                    res.writeHead(204);
                    res.end();
                }
            } catch (error) {
                console.error(`${KIRO_OAUTH_CONFIG.logPrefix} 处理回调出错:`, error);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(generateResponsePage(false, `服务器错误: ${error.message}`));
            }
        });
        
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
        
        // 超时自动关闭
        setTimeout(() => {
            if (server.listening) {
                server.close(() => {
                    activeKiroServers.delete('claude-kiro-oauth');
                });
            }
        }, KIRO_OAUTH_CONFIG.authTimeout);
    });
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
                console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 已关闭提供商 ${provider} 在端口 ${existing.port} 上的旧服务器`);
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
                        console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 已关闭端口 ${port} 上的旧服务器`);
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
                        console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 授权失败: ${errorParam}`);
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `授权失败: ${errorParam}`));
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                        return;
                    }
                    
                    if (state !== expectedState) {
                        console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} State 验证失败`);
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, 'State 验证失败'));
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                        return;
                    }
                    
                    if (!code) {
                        console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 缺少授权码`);
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, '缺少授权码'));
                        server.close(() => {
                            activeIFlowServers.delete('openai-iflow');
                        });
                        return;
                    }
                    
                    console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 收到授权回调，正在交换令牌...`);
                    
                    try {
                        // 1. 交换授权码获取令牌
                        const tokenData = await exchangeIFlowCodeForTokens(code, redirectUri);
                        console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 令牌交换成功`);
                        
                        // 2. 获取用户信息（包含 API Key）
                        const userInfo = await fetchIFlowUserInfo(tokenData.accessToken);
                        console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 用户信息获取成功: ${userInfo.email}`);
                        
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
                        console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 凭据已保存: ${credPath}`);
                        
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
                        await autoLinkProviderConfigs(CONFIG);
                        
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(true, `授权成功！账户: ${userInfo.email}，您可以关闭此页面`));
                        
                    } catch (tokenError) {
                        console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 令牌处理失败:`, tokenError);
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
                console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 处理回调出错:`, error);
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
                console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 端口 ${port} 已被占用`);
                reject(new Error(`端口 ${port} 已被占用`));
            } else {
                console.error(`${IFLOW_OAUTH_CONFIG.logPrefix} 服务器错误:`, err);
                reject(err);
            }
        });
        
        const host = '0.0.0.0';
        server.listen(port, host, () => {
            console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} OAuth 回调服务器已启动于 ${host}:${port}`);
            resolve(server);
        });
        
        // 10 分钟超时自动关闭
        setTimeout(() => {
            if (server.listening) {
                console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 回调服务器超时，自动关闭`);
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
    
    console.log(`${IFLOW_OAUTH_CONFIG.logPrefix} 生成授权链接: ${authUrl}`);
    
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

/**
 * Kiro Token 刷新常量
 */
const KIRO_REFRESH_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    CONTENT_TYPE_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    DEFAULT_PROVIDER: 'Google',
    REQUEST_TIMEOUT: 30000,
    DEFAULT_REGION: 'us-east-1'
};

/**
 * 通过 refreshToken 获取 accessToken
 * @param {string} refreshToken - Kiro 的 refresh token
 * @param {string} region - AWS 区域 (默认: us-east-1)
 * @returns {Promise<Object>} 包含 accessToken 等信息的对象
 */
async function refreshKiroToken(refreshToken, region = KIRO_REFRESH_CONSTANTS.DEFAULT_REGION) {
    const refreshUrl = KIRO_REFRESH_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), KIRO_REFRESH_CONSTANTS.REQUEST_TIMEOUT);
    
    try {
        const response = await fetchWithProxy(refreshUrl, {
            method: 'POST',
            headers: {
                'Content-Type': KIRO_REFRESH_CONSTANTS.CONTENT_TYPE_JSON
            },
            body: JSON.stringify({ refreshToken }),
            signal: controller.signal
        }, 'claude-kiro-oauth');
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.accessToken) {
            throw new Error('Invalid refresh response: Missing accessToken');
        }
        
        const expiresIn = data.expiresIn || 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        
        return {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken || refreshToken,
            profileArn: data.profileArn || '',
            expiresAt: expiresAt,
            authMethod: KIRO_REFRESH_CONSTANTS.AUTH_METHOD_SOCIAL,
            provider: KIRO_REFRESH_CONSTANTS.DEFAULT_PROVIDER,
            region: region
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timeout');
        }
        throw error;
    }
}

/**
 * 检查 Kiro 凭据是否已存在（基于 refreshToken + provider 组合）
 * @param {string} refreshToken - 要检查的 refreshToken
 * @param {string} provider - 提供商名称 (默认: 'claude-kiro-oauth')
 * @returns {Promise<{isDuplicate: boolean, existingPath?: string}>} 检查结果
 */
export async function checkKiroCredentialsDuplicate(refreshToken, provider = 'claude-kiro-oauth') {
    const kiroDir = path.join(process.cwd(), 'configs', 'kiro');
    
    try {
        // 检查 configs/kiro 目录是否存在
        if (!fs.existsSync(kiroDir)) {
            return { isDuplicate: false };
        }
        
        // 递归扫描所有 JSON 文件
        const scanDirectory = async (dirPath) => {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    const result = await scanDirectory(fullPath);
                    if (result.isDuplicate) {
                        return result;
                    }
                } else if (entry.isFile() && entry.name.endsWith('.json')) {
                    try {
                        const content = await fs.promises.readFile(fullPath, 'utf8');
                        const credentials = JSON.parse(content);
                        
                        // 检查 refreshToken 是否匹配
                        if (credentials.refreshToken && credentials.refreshToken === refreshToken) {
                            const relativePath = path.relative(process.cwd(), fullPath);
                            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Found duplicate refreshToken in: ${relativePath}`);
                            return {
                                isDuplicate: true,
                                existingPath: relativePath
                            };
                        }
                    } catch (parseError) {
                        // 忽略解析错误的文件
                    }
                }
            }
            
            return { isDuplicate: false };
        };
        
        return await scanDirectory(kiroDir);
        
    } catch (error) {
        console.warn(`${KIRO_OAUTH_CONFIG.logPrefix} Error checking duplicates:`, error.message);
        return { isDuplicate: false };
    }
}

/**
 * 批量导入 Kiro refreshToken 并生成凭据文件
 * @param {string[]} refreshTokens - refreshToken 数组
 * @param {string} region - AWS 区域 (默认: us-east-1)
 * @param {boolean} skipDuplicateCheck - 是否跳过重复检查 (默认: false)
 * @returns {Promise<Object>} 批量处理结果
 */
export async function batchImportKiroRefreshTokens(refreshTokens, region = KIRO_REFRESH_CONSTANTS.DEFAULT_REGION, skipDuplicateCheck = false) {
    const results = {
        total: refreshTokens.length,
        success: 0,
        failed: 0,
        details: []
    };
    
    for (let i = 0; i < refreshTokens.length; i++) {
        const refreshToken = refreshTokens[i].trim();
        
        if (!refreshToken) {
            results.details.push({
                index: i + 1,
                success: false,
                error: 'Empty token'
            });
            results.failed++;
            continue;
        }
        
        // 检查重复
        if (!skipDuplicateCheck) {
            const duplicateCheck = await checkKiroCredentialsDuplicate(refreshToken);
            if (duplicateCheck.isDuplicate) {
                results.details.push({
                    index: i + 1,
                    success: false,
                    error: 'duplicate',
                    existingPath: duplicateCheck.existingPath
                });
                results.failed++;
                continue;
            }
        }
        
        try {
            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 正在刷新第 ${i + 1}/${refreshTokens.length} 个 token...`);
            
            const tokenData = await refreshKiroToken(refreshToken, region);
            
            // 生成文件路径: configs/kiro/{timestamp}_kiro-auth-token/{timestamp}_kiro-auth-token.json
            const timestamp = Date.now();
            const folderName = `${timestamp}_kiro-auth-token`;
            const targetDir = path.join(process.cwd(), 'configs', 'kiro', folderName);
            await fs.promises.mkdir(targetDir, { recursive: true });
            
            const credPath = path.join(targetDir, `${folderName}.json`);
            await fs.promises.writeFile(credPath, JSON.stringify(tokenData, null, 2));
            
            const relativePath = path.relative(process.cwd(), credPath);
            
            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Token ${i + 1} 已保存: ${relativePath}`);
            
            results.details.push({
                index: i + 1,
                success: true,
                path: relativePath,
                expiresAt: tokenData.expiresAt
            });
            results.success++;
            
        } catch (error) {
            console.error(`${KIRO_OAUTH_CONFIG.logPrefix} Token ${i + 1} 刷新失败:`, error.message);
            
            results.details.push({
                index: i + 1,
                success: false,
                error: error.message
            });
            results.failed++;
        }
    }
    
    // 如果有成功的，广播事件并自动关联
    if (results.success > 0) {
        broadcastEvent('oauth_batch_success', {
            provider: 'claude-kiro-oauth',
            count: results.success,
            timestamp: new Date().toISOString()
        });
        
        // 自动关联新生成的凭据到 Pools
        await autoLinkProviderConfigs(CONFIG);
    }
    
    return results;
}

/**
 * 批量导入 Kiro refreshToken 并生成凭据文件（流式版本，支持实时进度回调）
 * @param {string[]} refreshTokens - refreshToken 数组
 * @param {string} region - AWS 区域 (默认: us-east-1)
 * @param {Function} onProgress - 进度回调函数，每处理完一个 token 调用
 * @param {boolean} skipDuplicateCheck - 是否跳过重复检查 (默认: false)
 * @returns {Promise<Object>} 批量处理结果
 */
export async function batchImportKiroRefreshTokensStream(refreshTokens, region = KIRO_REFRESH_CONSTANTS.DEFAULT_REGION, onProgress = null, skipDuplicateCheck = false) {
    const results = {
        total: refreshTokens.length,
        success: 0,
        failed: 0,
        details: []
    };
    
    for (let i = 0; i < refreshTokens.length; i++) {
        const refreshToken = refreshTokens[i].trim();
        const progressData = {
            index: i + 1,
            total: refreshTokens.length,
            current: null
        };
        
        if (!refreshToken) {
            progressData.current = {
                index: i + 1,
                success: false,
                error: 'Empty token'
            };
            results.details.push(progressData.current);
            results.failed++;
            
            // 发送进度更新
            if (onProgress) {
                onProgress({
                    ...progressData,
                    successCount: results.success,
                    failedCount: results.failed
                });
            }
            continue;
        }
        
        // 检查重复
        if (!skipDuplicateCheck) {
            const duplicateCheck = await checkKiroCredentialsDuplicate(refreshToken);
            if (duplicateCheck.isDuplicate) {
                progressData.current = {
                    index: i + 1,
                    success: false,
                    error: 'duplicate',
                    existingPath: duplicateCheck.existingPath
                };
                results.details.push(progressData.current);
                results.failed++;
                
                // 发送进度更新
                if (onProgress) {
                    onProgress({
                        ...progressData,
                        successCount: results.success,
                        failedCount: results.failed
                    });
                }
                continue;
            }
        }
        
        try {
            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} 正在刷新第 ${i + 1}/${refreshTokens.length} 个 token...`);
            
            const tokenData = await refreshKiroToken(refreshToken, region);
            
            // 生成文件路径: configs/kiro/{timestamp}_kiro-auth-token/{timestamp}_kiro-auth-token.json
            const timestamp = Date.now();
            const folderName = `${timestamp}_kiro-auth-token`;
            const targetDir = path.join(process.cwd(), 'configs', 'kiro', folderName);
            await fs.promises.mkdir(targetDir, { recursive: true });
            
            const credPath = path.join(targetDir, `${folderName}.json`);
            await fs.promises.writeFile(credPath, JSON.stringify(tokenData, null, 2));
            
            const relativePath = path.relative(process.cwd(), credPath);
            
            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Token ${i + 1} 已保存: ${relativePath}`);
            
            progressData.current = {
                index: i + 1,
                success: true,
                path: relativePath,
                expiresAt: tokenData.expiresAt
            };
            results.details.push(progressData.current);
            results.success++;
            
        } catch (error) {
            console.error(`${KIRO_OAUTH_CONFIG.logPrefix} Token ${i + 1} 刷新失败:`, error.message);
            
            progressData.current = {
                index: i + 1,
                success: false,
                error: error.message
            };
            results.details.push(progressData.current);
            results.failed++;
        }
        
        // 发送进度更新
        if (onProgress) {
            onProgress({
                ...progressData,
                successCount: results.success,
                failedCount: results.failed
            });
        }
    }
    
    // 如果有成功的，广播事件并自动关联
    if (results.success > 0) {
        broadcastEvent('oauth_batch_success', {
            provider: 'claude-kiro-oauth',
            count: results.success,
            timestamp: new Date().toISOString()
        });
        
        // 自动关联新生成的凭据到 Pools
        await autoLinkProviderConfigs(CONFIG);
    }
    
    return results;
}

/**
 * 导入 AWS SSO 凭据用于 Kiro (Builder ID 模式)
 * 从用户上传的 AWS SSO cache 文件中导入凭据
 * @param {Object} credentials - 合并后的凭据对象，需包含 clientId 和 clientSecret
 * @param {boolean} skipDuplicateCheck - 是否跳过重复检查 (默认: false)
 * @returns {Promise<Object>} 导入结果
 */
export async function importAwsCredentials(credentials, skipDuplicateCheck = false) {
    try {
        // 验证必需字段 - 需要四个字段都存在
        const missingFields = [];
        if (!credentials.clientId) missingFields.push('clientId');
        if (!credentials.clientSecret) missingFields.push('clientSecret');
        if (!credentials.accessToken) missingFields.push('accessToken');
        if (!credentials.refreshToken) missingFields.push('refreshToken');
        
        if (missingFields.length > 0) {
            return {
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            };
        }
        
        // 检查重复凭据
        if (!skipDuplicateCheck) {
            const duplicateCheck = await checkKiroCredentialsDuplicate(credentials.refreshToken);
            if (duplicateCheck.isDuplicate) {
                return {
                    success: false,
                    error: 'duplicate',
                    existingPath: duplicateCheck.existingPath
                };
            }
        }
        
        console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Importing AWS credentials...`);
        
        // 准备凭据数据 - 四个字段都是必需的
        const credentialsData = {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            accessToken: credentials.accessToken,
            refreshToken: credentials.refreshToken,
            authMethod: credentials.authMethod || 'builder-id',
            region: credentials.region || KIRO_REFRESH_CONSTANTS.DEFAULT_REGION
        };
        
        // 可选字段
        if (credentials.expiresAt) {
            credentialsData.expiresAt = credentials.expiresAt;
        }
        if (credentials.startUrl) {
            credentialsData.startUrl = credentials.startUrl;
        }
        if (credentials.registrationExpiresAt) {
            credentialsData.registrationExpiresAt = credentials.registrationExpiresAt;
        }
        
        // 尝试刷新获取最新的 accessToken
        try {
            console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Attempting to refresh token with provided credentials...`);
            
            const region = credentials.region || KIRO_REFRESH_CONSTANTS.DEFAULT_REGION;
            const refreshUrl = KIRO_REFRESH_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', region);
            
            const refreshResponse = await fetchWithProxy(refreshUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    refreshToken: credentials.refreshToken,
                    clientId: credentials.clientId,
                    clientSecret: credentials.clientSecret,
                    grantType: 'refresh_token'
                })
            }, 'claude-kiro-oauth');
            
            if (refreshResponse.ok) {
                const tokenData = await refreshResponse.json();
                credentialsData.accessToken = tokenData.accessToken;
                credentialsData.refreshToken = tokenData.refreshToken;
                const expiresIn = tokenData.expiresIn || 3600;
                credentialsData.expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
                console.log(`${KIRO_OAUTH_CONFIG.logPrefix} Token refreshed successfully`);
            } else {
                console.warn(`${KIRO_OAUTH_CONFIG.logPrefix} Token refresh failed, saving original credentials`);
            }
        } catch (refreshError) {
            console.warn(`${KIRO_OAUTH_CONFIG.logPrefix} Token refresh error:`, refreshError.message);
            // 继续保存原始凭据
        }
        
        // 生成文件路径: configs/kiro/{timestamp}_kiro-auth-token/{timestamp}_kiro-auth-token.json
        const timestamp = Date.now();
        const folderName = `${timestamp}_kiro-auth-token`;
        const targetDir = path.join(process.cwd(), 'configs', 'kiro', folderName);
        await fs.promises.mkdir(targetDir, { recursive: true });
        
        const credPath = path.join(targetDir, `${folderName}.json`);
        await fs.promises.writeFile(credPath, JSON.stringify(credentialsData, null, 2));
        
        const relativePath = path.relative(process.cwd(), credPath);
        
        console.log(`${KIRO_OAUTH_CONFIG.logPrefix} AWS credentials saved to: ${relativePath}`);
        
        // 广播事件
        broadcastEvent('oauth_success', {
            provider: 'claude-kiro-oauth',
            relativePath: relativePath,
            timestamp: new Date().toISOString()
        });
        
        // 自动关联新生成的凭据到 Pools
        await autoLinkProviderConfigs(CONFIG);
        
        return {
            success: true,
            path: relativePath
        };
        
    } catch (error) {
        console.error(`${KIRO_OAUTH_CONFIG.logPrefix} AWS credentials import failed:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ============================================================================
// Orchids OAuth 配置和处理函数
// ============================================================================

/**
 * Orchids OAuth 配置
 */
const ORCHIDS_OAUTH_CONFIG = {
    // Clerk Token 端点
    clerkTokenEndpoint: 'https://clerk.orchids.app/v1/client/sessions/{sessionId}/tokens',
    clerkJsVersion: '5.114.0',
    
    // 凭据存储
    credentialsDir: 'orchids',
    credentialsFile: 'orchids_creds.json',
    
    // 日志前缀
    logPrefix: '[Orchids Auth]'
};

/**
 * 解析 Orchids 凭据字符串（简化版）
 * 只需要 __client JWT 即可，其他参数通过 Clerk API 自动获取
 *
 * 支持的格式:
 * 1. 纯 JWT 字符串: "eyJhbGciOiJSUzI1NiJ9..." (从 payload 中提取 rotating_token)
 * 2. __client=xxx 格式: "__client=eyJhbGciOiJSUzI1NiJ9..."
 * 3. 完整 Cookies 格式（兼容旧版）: "__client=xxx; __session=xxx"
 * 4. JWT|xxx 格式（兼容旧版）
 *
 * @param {string} inputString - 输入字符串
 * @returns {Object} 解析后的凭据数据
 */
function parseOrchidsCredentials(inputString) {
    if (!inputString || typeof inputString !== 'string') {
        throw new Error('Invalid input string');
    }
    
    const trimmedInput = inputString.trim();
    
    // 格式1: 纯 JWT 字符串（三段式，以点分隔）
    if (trimmedInput.split('.').length === 3 && !trimmedInput.includes('=') && !trimmedInput.includes('|')) {
        console.log('[Orchids Auth] Detected pure JWT format');
        
        // 尝试从 JWT payload 中提取 rotating_token
        let rotatingToken = null;
        try {
            const parts = trimmedInput.split('.');
            if (parts.length === 3) {
                // 解码 JWT payload (Base64URL -> Base64 -> JSON)
                let payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                // 添加 padding
                while (payloadBase64.length % 4) {
                    payloadBase64 += '=';
                }
                const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
                const payload = JSON.parse(payloadJson);
                
                if (payload.rotating_token) {
                    rotatingToken = payload.rotating_token;
                    console.log('[Orchids Auth] Extracted rotating_token from JWT payload');
                }
            }
        } catch (e) {
            console.warn('[Orchids Auth] Failed to extract rotating_token from JWT payload:', e.message);
        }
        
        return {
            type: 'jwt',
            clientJwt: trimmedInput,
            rotatingToken: rotatingToken
        };
    }
    
    // 格式2: __client=xxx 格式（可能包含或不包含 __session）
    if (trimmedInput.includes('__client=')) {
        const clientMatch = trimmedInput.match(/__client=([^;]+)/);
        if (clientMatch) {
            const clientValue = clientMatch[1].trim();
            // 处理可能的 | 分隔符（如 JWT|rotating_token）
            let jwtPart = clientValue;
            let rotatingToken = null;
            if (clientValue.includes('|')) {
                const parts = clientValue.split('|');
                jwtPart = parts[0];
                rotatingToken = parts[1] || null;
            }
            
            if (jwtPart.split('.').length === 3) {
                console.log('[Orchids Auth] Detected __client cookie format');
                return {
                    type: 'jwt',
                    clientJwt: jwtPart,
                    rotatingToken: rotatingToken
                };
            }
        }
        throw new Error('Invalid __client value. Expected a valid JWT.');
    }
    
    // 格式3: JWT|rotating_token 格式
    if (trimmedInput.includes('|')) {
        const parts = trimmedInput.split('|');
        if (parts.length >= 1) {
            const jwtPart = parts[0].trim();
            const rotatingToken = parts.length >= 2 ? parts[1].trim() : null;
            if (jwtPart.split('.').length === 3) {
                console.log('[Orchids Auth] Detected JWT|rotating_token format');
                return {
                    type: 'jwt',
                    clientJwt: jwtPart,
                    rotatingToken: rotatingToken
                };
            }
        }
    }
    
    throw new Error('Invalid format. Please provide the __client cookie value (JWT format). Example: eyJhbGciOiJSUzI1NiJ9...');
}

/**
 * 解析 Orchids JWT Token 字符串 (保留用于向后兼容)
 * @deprecated 请使用 parseOrchidsCredentials
 * 格式: JWT|rotating_token
 * JWT 包含 id (client_id) 和 rotating_token
 * @param {string} tokenString - 完整的 token 字符串
 * @returns {Object} 解析后的 token 数据
 */
function parseOrchidsToken(tokenString) {
    const result = parseOrchidsCredentials(tokenString);
    if (result.type === 'legacy') {
        return {
            clientId: result.clientId,
            rotatingToken: result.rotatingToken,
            jwt: result.jwt,
            rawPayload: result.rawPayload
        };
    }
    // 对于新格式，返回兼容的结构
    return {
        clientId: null,
        rotatingToken: result.clientValue,
        jwt: null,
        rawPayload: null
    };
}

/**
 * 从 Clerk 获取 session token
 * @param {string} sessionId - Clerk session ID
 * @param {string} cookies - Cookie 字符串
 * @returns {Promise<string>} JWT token
 */
async function getClerkSessionToken(sessionId, cookies) {
    const tokenUrl = ORCHIDS_OAUTH_CONFIG.clerkTokenEndpoint
        .replace('{sessionId}', sessionId) +
        `?_clerk_js_version=${ORCHIDS_OAUTH_CONFIG.clerkJsVersion}`;
    
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookies,
            'Origin': 'https://www.orchids.app'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Clerk token request failed: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    return data.jwt;
}

/**
 * 导入 Orchids 凭据并生成凭据文件（简化版）
 * 只需要 __client JWT，其他参数在运行时通过 Clerk API 自动获取
 *
 * @param {string} inputString - __client JWT 字符串
 * @param {Object} options - 额外选项
 *   - workingDir: 默认工作目录
 * @returns {Promise<Object>} 导入结果
 */
export async function importOrchidsToken(inputString, options = {}) {
    try {
        console.log(`${ORCHIDS_OAUTH_CONFIG.logPrefix} Parsing Orchids credentials (simplified)...`);

        // 解析凭据 - 只提取 clientJwt
        const credData = parseOrchidsCredentials(inputString);
        
        if (!credData.clientJwt) {
            throw new Error('Failed to extract clientJwt from input');
        }

        // 凭据数据 - 保存 clientJwt 和可选的 rotatingToken
        const credentialsData = {
            // 核心字段：__client JWT（必需的凭据）
            clientJwt: credData.clientJwt,
            // 导入时间
            importedAt: new Date().toISOString()
        };
        
        // 如果存在 rotatingToken，也保存它（可选，备用）
        if (credData.rotatingToken) {
            credentialsData.rotatingToken = credData.rotatingToken;
            console.log(`${ORCHIDS_OAUTH_CONFIG.logPrefix} rotatingToken also saved for future use.`);
        }
        
        // 生成文件路径: configs/orchids/{timestamp}_orchids_creds/{timestamp}_orchids_creds.json
        const timestamp = Date.now();
        const folderName = `${timestamp}_orchids_creds`;
        const targetDir = path.join(process.cwd(), 'configs', ORCHIDS_OAUTH_CONFIG.credentialsDir, folderName);
        await fs.promises.mkdir(targetDir, { recursive: true });
        
        const filename = `${folderName}.json`;
        const credPath = path.join(targetDir, filename);
        await fs.promises.writeFile(credPath, JSON.stringify(credentialsData, null, 2));
        
        const relativePath = path.relative(process.cwd(), credPath);
        
        console.log(`${ORCHIDS_OAUTH_CONFIG.logPrefix} Credentials saved to: ${relativePath}`);
        console.log(`${ORCHIDS_OAUTH_CONFIG.logPrefix} Only clientJwt is stored. Session info will be fetched at runtime.`);
        
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
            message: 'Credentials imported successfully. Session info will be fetched at runtime via Clerk API.'
        };
        
    } catch (error) {
        console.error(`${ORCHIDS_OAUTH_CONFIG.logPrefix} Token import failed:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 处理 Orchids OAuth（手动导入模式 - 简化版）
 * 只需要 __client JWT，其他参数自动获取
 * @param {Object} currentConfig - 当前配置对象
 * @param {Object} options - 额外选项
 * @returns {Promise<Object>} 返回导入说明
 */
export async function handleOrchidsOAuth(currentConfig, options = {}) {
    // Orchids 使用简化的手动导入模式
    // 只需要 __client cookie 的值
    return {
        authUrl: null,
        authInfo: {
            provider: 'claude-orchids-oauth',
            method: 'manual-import',
            instructions: [
                '1. 登录 Orchids 平台 (https://orchids.app)',
                '2. 打开浏览器开发者工具 (F12)',
                '3. 切换到 Application > Cookies > https://orchids.app',
                '4. 找到 __client 并复制其值（一个长的 JWT 字符串）',
                '5. 使用 "导入 Token" 功能粘贴该值'
            ],
            tokenFormat: 'eyJhbGciOiJSUzI1NiJ9...',
            example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsaWVudF8uLi4',
            note: '只需要 __client 的值即可，sessionId 等参数会自动获取'
        }
    };
}

