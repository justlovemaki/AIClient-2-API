import { OAuth2Client } from 'google-auth-library';
import logger from '../utils/logger.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { broadcastEvent } from '../services/ui-manager.js';
import { autoLinkProviderConfigs } from '../services/service-manager.js';
import { CONFIG } from '../core/config-manager.js';
import { getGoogleAuthProxyConfig } from '../utils/proxy-utils.js';

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
                logger.info(`[OAuth] 已关闭提供商 ${provider} 在端口 ${existing.port} 上的旧服务器`);
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
                        logger.info(`[OAuth] 已关闭端口 ${port} 上被占用（提供商: ${p}）的旧服务器`);
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
                    logger.info(`${config.logPrefix} 收到来自 Google 的成功回调: ${req.url}`);
                    
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
                        logger.info(`${config.logPrefix} 新令牌已接收并保存到文件: ${finalCredPath}`);
                        
                        const relativePath = path.relative(process.cwd(), finalCredPath);

                        // 广播授权成功事件
                        broadcastEvent('oauth_success', {
                            provider: provider,
                            credPath: finalCredPath,
                            relativePath: relativePath,
                            timestamp: new Date().toISOString()
                        });
                        
                        // 自动关联新生成的凭据到 Pools
                        await autoLinkProviderConfigs(CONFIG, {
                            onlyCurrentCred: true,
                            credPath: relativePath
                        });
                        
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(true, '您可以关闭此页面'));
                    } catch (tokenError) {
                        logger.error(`${config.logPrefix} 获取令牌失败:`, tokenError);
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(false, `获取令牌失败: ${tokenError.message}`));
                    } finally {
                        server.close(() => {
                            activeServers.delete(provider);
                        });
                    }
                } else if (errorParam) {
                    const errorMessage = `授权失败。Google 返回错误: ${errorParam}`;
                    logger.error(`${config.logPrefix}`, errorMessage);
                    
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(generateResponsePage(false, errorMessage));
                    server.close(() => {
                        activeServers.delete(provider);
                    });
                } else {
                    logger.info(`${config.logPrefix} 忽略无关请求: ${req.url}`);
                    res.writeHead(204);
                    res.end();
                }
            } catch (error) {
                logger.error(`${config.logPrefix} 处理回调时出错:`, error);
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
                logger.error(`${config.logPrefix} 端口 ${port} 已被占用`);
                reject(new Error(`端口 ${port} 已被占用`));
            } else {
                logger.error(`${config.logPrefix} 服务器错误:`, err);
                reject(err);
            }
        });
        
        const host = '0.0.0.0';
        server.listen(port, host, () => {
            logger.info(`${config.logPrefix} OAuth 回调服务器已启动于 ${host}:${port}`);
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
        logger.info(`${config.logPrefix} Using proxy for OAuth token exchange`);
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
 * 检查 Gemini 凭据是否已存在（基于 refresh_token）
 * @param {string} providerType - 提供商类型
 * @param {string} refreshToken - 要检查的 refreshToken
 * @returns {Promise<{isDuplicate: boolean, existingPath?: string}>} 检查结果
 */
export async function checkGeminiCredentialsDuplicate(providerType, refreshToken) {
    const config = OAUTH_PROVIDERS[providerType];
    if (!config) return { isDuplicate: false };

    const providerDir = config.credentialsDir.replace('.', '');
    const targetDir = path.join(process.cwd(), 'configs', providerDir);
    
    try {
        if (!fs.existsSync(targetDir)) {
            return { isDuplicate: false };
        }
        
        const files = await fs.promises.readdir(targetDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const fullPath = path.join(targetDir, file);
                    const content = await fs.promises.readFile(fullPath, 'utf8');
                    const credentials = JSON.parse(content);
                    
                    if (credentials.refresh_token === refreshToken) {
                        const relativePath = path.relative(process.cwd(), fullPath);
                        return {
                            isDuplicate: true,
                            existingPath: relativePath
                        };
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }
        }
        return { isDuplicate: false };
    } catch (error) {
        logger.warn(`[Gemini Auth] Error checking duplicates for ${providerType}:`, error.message);
        return { isDuplicate: false };
    }
}

/**
 * 批量导入 Gemini Token 并生成凭据文件（流式版本，支持实时进度回调）
 * @param {string} providerType - 提供商类型 ('gemini-cli-oauth' 或 'gemini-antigravity')
 * @param {Object[]} tokens - Token 对象数组
 * @param {Function} onProgress - 进度回调函数
 * @param {boolean} skipDuplicateCheck - 是否跳过重复检查 (默认: false)
 * @returns {Promise<Object>} 批量处理结果
 */
export async function batchImportGeminiTokensStream(providerType, tokens, onProgress = null, skipDuplicateCheck = false) {
    const config = OAUTH_PROVIDERS[providerType];
    if (!config) {
        throw new Error(`未知的提供商: ${providerType}`);
    }

    const results = {
        total: tokens.length,
        success: 0,
        failed: 0,
        details: []
    };
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const progressData = {
            index: i + 1,
            total: tokens.length,
            current: null
        };
        
        try {
            // 验证 token 是否包含必需字段 (通常是 access_token 和 refresh_token)
            if (!token.access_token || !token.refresh_token) {
                throw new Error('Token 缺少必需字段 (access_token 或 refresh_token)');
            }

            // 检查重复
            if (!skipDuplicateCheck) {
                const duplicateCheck = await checkGeminiCredentialsDuplicate(providerType, token.refresh_token);
                if (duplicateCheck.isDuplicate) {
                    progressData.current = {
                        index: i + 1,
                        success: false,
                        error: 'duplicate',
                        existingPath: duplicateCheck.existingPath
                    };
                    results.failed++;
                    results.details.push(progressData.current);
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

            // 生成文件路径
            const timestamp = Date.now();
            const providerDir = config.credentialsDir.replace('.', ''); // 去掉开头的点
            const targetDir = path.join(process.cwd(), 'configs', providerDir);
            await fs.promises.mkdir(targetDir, { recursive: true });
            
            const filename = `${timestamp}_${i}_oauth_creds.json`;
            const credPath = path.join(targetDir, filename);
            
            await fs.promises.writeFile(credPath, JSON.stringify(token, null, 2));
            
            const relativePath = path.relative(process.cwd(), credPath);
            
            logger.info(`${config.logPrefix} Token ${i + 1} 已导入并保存: ${relativePath}`);
            
            progressData.current = {
                index: i + 1,
                success: true,
                path: relativePath
            };
            results.success++;

            // 自动关联新生成的凭据到 Pools
            await autoLinkProviderConfigs(CONFIG, {
                onlyCurrentCred: true,
                credPath: relativePath
            });
            
        } catch (error) {
            logger.error(`${config.logPrefix} Token ${i + 1} 导入失败:`, error.message);
            
            progressData.current = {
                index: i + 1,
                success: false,
                error: error.message
            };
            results.failed++;
        }
        
        results.details.push(progressData.current);

        // 发送进度更新
        if (onProgress) {
            onProgress({
                ...progressData,
                successCount: results.success,
                failedCount: results.failed
            });
        }
    }
    
    // 如果有成功的，广播事件
    if (results.success > 0) {
        broadcastEvent('oauth_batch_success', {
            provider: providerType,
            count: results.success,
            timestamp: new Date().toISOString()
        });
    }
    
    return results;
}
