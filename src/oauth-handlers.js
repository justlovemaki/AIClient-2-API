import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import open from 'open';
import { broadcastEvent } from './ui-manager.js';

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
async function closeActiveServer(port) {
    const existingServer = activeServers.get(port);
    if (existingServer && existingServer.listening) {
        return new Promise((resolve) => {
            existingServer.close(() => {
                activeServers.delete(port);
                console.log(`[OAuth] 已关闭端口 ${port} 上的旧服务器`);
                resolve();
            });
        });
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
async function createOAuthCallbackServer(config, redirectUri, authClient, credPath, provider) {
    // 先关闭该端口上的旧服务器
    await closeActiveServer(config.port);
    
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
                        await fs.promises.mkdir(path.dirname(credPath), { recursive: true });
                        await fs.promises.writeFile(credPath, JSON.stringify(tokens, null, 2));
                        console.log(`${config.logPrefix} 新令牌已接收并保存到文件`);
                        
                        // 广播授权成功事件
                        broadcastEvent('oauth_success', {
                            provider: provider,
                            credPath: credPath,
                            timestamp: new Date().toISOString()
                        });
                        
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(true, '您可以关闭此页面'));
                    } catch (tokenError) {
                        console.error(`${config.logPrefix} 获取令牌失败:`, tokenError);
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `获取令牌失败: ${tokenError.message}`));
                    } finally {
                        server.close(() => {
                            activeServers.delete(config.port);
                        });
                    }
                } else if (errorParam) {
                    const errorMessage = `授权失败。Google 返回错误: ${errorParam}`;
                    console.error(`${config.logPrefix}`, errorMessage);
                    
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(generateResponsePage(false, errorMessage));
                    server.close(() => {
                        activeServers.delete(config.port);
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
                        activeServers.delete(config.port);
                    });
                }
            }
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`${config.logPrefix} 端口 ${config.port} 已被占用`);
                reject(new Error(`端口 ${config.port} 已被占用`));
            } else {
                console.error(`${config.logPrefix} 服务器错误:`, err);
                reject(err);
            }
        });
        
        const host = 'localhost';
        server.listen(config.port, host, () => {
            console.log(`${config.logPrefix} OAuth 回调服务器已启动于 ${host}:${config.port}`);
            activeServers.set(config.port, server);
            resolve(server);
        });
    });
}

/**
 * 处理 Google OAuth 授权（通用函数）
 * @param {string} providerKey - 提供商键名
 * @param {Object} currentConfig - 当前配置对象
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
async function handleGoogleOAuth(providerKey, currentConfig) {
    const config = OAUTH_PROVIDERS[providerKey];
    if (!config) {
        throw new Error(`未知的提供商: ${providerKey}`);
    }
    
    const host = 'localhost';
    const redirectUri = `http://${host}:${config.port}`;
    
    const authClient = new OAuth2Client(config.clientId, config.clientSecret);
    authClient.redirectUri = redirectUri;
    
    const authUrl = authClient.generateAuthUrl({
        access_type: 'offline',
        scope: config.scope
    });
    
    // 启动回调服务器
    const credPath = path.join(os.homedir(), config.credentialsDir, config.credentialsFile);
    
    try {
        await createOAuthCallbackServer(config, redirectUri, authClient, credPath, providerKey);
    } catch (error) {
        throw new Error(`启动回调服务器失败: ${error.message}`);
    }
    
    return {
        authUrl,
        authInfo: {
            provider: providerKey,
            redirectUri: redirectUri,
            port: config.port,
            instructions: '请在浏览器中打开此链接进行授权，授权完成后会自动保存凭据文件'
        }
    };
}

/**
 * 处理 Gemini CLI OAuth 授权
 * @param {Object} currentConfig - 当前配置对象
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleGeminiCliOAuth(currentConfig) {
    return handleGoogleOAuth('gemini-cli-oauth', currentConfig);
}

/**
 * 处理 Gemini Antigravity OAuth 授权
 * @param {Object} currentConfig - 当前配置对象
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleGeminiAntigravityOAuth(currentConfig) {
    return handleGoogleOAuth('gemini-antigravity', currentConfig);
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
 * @returns {Promise<Object>} 返回令牌信息
 */
async function pollQwenToken(deviceCode, codeVerifier, interval = 5, expiresIn = 300, taskId = 'default') {
    const credPath = path.join(os.homedir(), QWEN_OAUTH_CONFIG.credentialsDir, QWEN_OAUTH_CONFIG.credentialsFile);
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
            const response = await fetch(QWEN_OAUTH_CONFIG.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: formBody
            });
            
            const data = await response.json();
            
            if (response.ok && data.access_token) {
                // 成功获取令牌
                console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 成功获取令牌 [${taskId}]`);
                
                // 保存令牌到文件
                await fs.promises.mkdir(path.dirname(credPath), { recursive: true });
                await fs.promises.writeFile(credPath, JSON.stringify(data, null, 2));
                console.log(`${QWEN_OAUTH_CONFIG.logPrefix} 令牌已保存到 ${credPath}`);
                
                // 清理任务
                activePollingTasks.delete(taskId);
                
                // 广播授权成功事件
                broadcastEvent('oauth_success', {
                    provider: 'openai-qwen-oauth',
                    credPath: credPath,
                    timestamp: new Date().toISOString()
                });
                
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
 * @returns {Promise<Object>} 返回授权URL和相关信息
 */
export async function handleQwenOAuth(currentConfig) {
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
        const response = await fetch(QWEN_OAUTH_CONFIG.deviceCodeEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: formBody
        });
        
        if (!response.ok) {
            throw new Error(`Qwen OAuth请求失败: ${response.status} ${response.statusText}`);
        }
        
        const deviceAuth = await response.json();
        
        if (!deviceAuth.device_code || !deviceAuth.verification_uri_complete) {
            throw new Error('Qwen OAuth响应格式错误，缺少必要字段');
        }
        
        // 启动后台轮询获取令牌
        const interval = deviceAuth.interval || 5;
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
        pollQwenToken(deviceAuth.device_code, codeVerifier, interval, expiresIn, taskId)
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
                codeVerifier: codeVerifier,
                instructions: '请在浏览器中打开此链接并输入用户码进行授权。授权完成后，系统会自动轮询获取访问令牌。'
            }
        };
    } catch (error) {
        console.error(`${QWEN_OAUTH_CONFIG.logPrefix} 请求失败:`, error);
        throw new Error(`Qwen OAuth 授权失败: ${error.message}`);
    }
}