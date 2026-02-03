import fs from 'fs';
import logger from '../utils/logger.js';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { broadcastEvent } from '../services/ui-manager.js';
import { autoLinkProviderConfigs } from '../services/service-manager.js';
import { CONFIG } from '../core/config-manager.js';
import { getProxyConfigForProvider } from '../utils/proxy-utils.js';

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
 * 活动的轮询任务管理
 */
const activePollingTasks = new Map();

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
        logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 已停止轮询任务: ${taskId}`);
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
    
    logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 开始轮询令牌 [${taskId}]，间隔 ${interval} 秒，最多尝试 ${maxAttempts} 次`);
    
    const poll = async () => {
        // 检查是否需要停止
        if (taskControl.shouldStop) {
            logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 轮询任务 [${taskId}] 已被停止`);
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
                logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 成功获取令牌 [${taskId}]`);
                
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
                logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 令牌已保存到 ${credPath}`);
                
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
                await autoLinkProviderConfigs(CONFIG, {
                    onlyCurrentCred: true,
                    credPath: relativePath
                });
                
                return data;
            }
            
            // 检查错误类型
            if (data.error === 'authorization_pending') {
                // 用户尚未完成授权，继续轮询
                logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 等待用户授权 [${taskId}]... (第 ${attempts}/${maxAttempts} 次尝试)`);
                await new Promise(resolve => setTimeout(resolve, interval * 1000));
                return poll();
            } else if (data.error === 'slow_down') {
                // 需要降低轮询频率
                logger.info(`${QWEN_OAUTH_CONFIG.logPrefix} 降低轮询频率`);
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
            logger.error(`${QWEN_OAUTH_CONFIG.logPrefix} 轮询出错:`, error);
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
                logger.error(`${QWEN_OAUTH_CONFIG.logPrefix} 轮询失败 [${taskId}]:`, error);
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
        logger.error(`${QWEN_OAUTH_CONFIG.logPrefix} 请求失败:`, error);
        throw new Error(`Qwen OAuth 授权失败: ${error.message}`);
    }
}