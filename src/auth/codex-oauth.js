import crypto from 'crypto';
import http from 'http';
import open from 'open';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Codex OAuth 配置
 */
const CODEX_CONFIG = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    port: 1455,
    scopes: 'openid email profile offline_access'
};

/**
 * Codex OAuth 认证类
 * 实现 OAuth2 + PKCE 流程
 */
export class CodexAuth {
    constructor(config) {
        this.config = config;
        this.httpClient = axios.create({
            timeout: 30000
        });
        this.server = null; // 存储服务器实例
    }

    /**
     * 生成 PKCE 代码
     * @returns {{verifier: string, challenge: string}}
     */
    generatePKCECodes() {
        // 生成 code verifier (96 随机字节 → 128 base64url 字符)
        const verifier = crypto.randomBytes(96)
            .toString('base64url');

        // 生成 code challenge (SHA256 of verifier)
        const challenge = crypto.createHash('sha256')
            .update(verifier)
            .digest('base64url');

        return { verifier, challenge };
    }

    /**
     * 生成授权 URL（不启动完整流程）
     * @returns {{authUrl: string, state: string, pkce: Object, server: Object}}
     */
    async generateAuthUrl() {
        const pkce = this.generatePKCECodes();
        const state = crypto.randomBytes(16).toString('hex');

        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Generating auth URL...`);

        // 启动本地回调服务器
        const server = await this.startCallbackServer();
        this.server = server;

        // 构建授权 URL
        const authUrl = new URL(CODEX_CONFIG.authUrl);
        authUrl.searchParams.set('client_id', CODEX_CONFIG.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', CODEX_CONFIG.redirectUri);
        authUrl.searchParams.set('scope', CODEX_CONFIG.scopes);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', pkce.challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('prompt', 'login');
        authUrl.searchParams.set('id_token_add_organizations', 'true');
        authUrl.searchParams.set('codex_cli_simplified_flow', 'true');

        return {
            authUrl: authUrl.toString(),
            state,
            pkce,
            server
        };
    }

    /**
     * 完成 OAuth 流程（在收到回调后调用）
     * @param {string} code - 授权码
     * @param {string} state - 状态参数
     * @param {string} expectedState - 期望的状态参数
     * @param {Object} pkce - PKCE 代码
     * @returns {Promise<Object>} tokens 和凭据路径
     */
    async completeOAuthFlow(code, state, expectedState, pkce) {
        // 验证 state
        if (state !== expectedState) {
            throw new Error('State mismatch - possible CSRF attack');
        }

        // 用 code 换取 tokens
        const tokens = await this.exchangeCodeForTokens(code, pkce.verifier);

        // 解析 JWT 提取账户信息
        const claims = this.parseJWT(tokens.id_token);

        // 保存凭据（遵循 CLIProxyAPI 格式）
        const credentials = {
            id_token: tokens.id_token,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            account_id: claims['https://api.openai.com/auth']?.chatgpt_account_id || claims.sub,
            last_refresh: new Date().toISOString(),
            email: claims.email,
            type: 'codex',
            expired: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
        };

        // 获取凭据保存路径
        const email = credentials.email || this.config.CODEX_EMAIL || 'default';
        let credPath;
        if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
            credPath = this.config.CODEX_OAUTH_CREDS_FILE_PATH;
        } else {
            // 保存到 configs/codex 目录（与其他供应商一致）
            const projectDir = process.cwd();
            const targetDir = path.join(projectDir, 'configs', 'codex');
            await fs.mkdir(targetDir, { recursive: true });
            const timestamp = Date.now();
            const filename = `${timestamp}_codex-${email}.json`;
            credPath = path.join(targetDir, filename);
        }

        const saveResult = await this.saveCredentials(credentials);
        credPath = saveResult.credsPath;
        const relativePath = saveResult.relativePath;

        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Authentication successful!`);
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Email: ${credentials.email}`);
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Account ID: ${credentials.account_id}`);
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Credentials saved to: ${relativePath}`);

        // 关闭服务器
        if (this.server) {
            this.server.close();
            this.server = null;
        }

        return {
            ...credentials,
            credPath,
            relativePath
        };
    }

    /**
     * 启动 OAuth 流程
     * @returns {Promise<Object>} 返回 tokens
     */
    async startOAuthFlow() {
        const pkce = this.generatePKCECodes();
        const state = crypto.randomBytes(16).toString('hex');

        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Starting OAuth flow...`);

        // 启动本地回调服务器
        const server = await this.startCallbackServer();

        // 构建授权 URL
        const authUrl = new URL(CODEX_CONFIG.authUrl);
        authUrl.searchParams.set('client_id', CODEX_CONFIG.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', CODEX_CONFIG.redirectUri);
        authUrl.searchParams.set('scope', CODEX_CONFIG.scopes);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', pkce.challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('prompt', 'login');
        authUrl.searchParams.set('id_token_add_organizations', 'true');
        authUrl.searchParams.set('codex_cli_simplified_flow', 'true');

        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Opening browser for authentication...`);
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} If browser doesn't open, visit: ${authUrl.toString()}`);

        try {
            await open(authUrl.toString());
        } catch (error) {
            console.warn(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Failed to open browser automatically:`, error.message);
        }

        // 等待回调
        const result = await this.waitForCallback(server, state);

        // 用 code 换取 tokens
        const tokens = await this.exchangeCodeForTokens(result.code, pkce.verifier);

        // 解析 JWT 提取账户信息
        const claims = this.parseJWT(tokens.id_token);

        // 保存凭据（遵循 CLIProxyAPI 格式）
        const credentials = {
            id_token: tokens.id_token,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            account_id: claims['https://api.openai.com/auth']?.chatgpt_account_id || claims.sub,
            last_refresh: new Date().toISOString(),
            email: claims.email,
            type: 'codex',
            expired: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
        };

        await this.saveCredentials(credentials);

        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Authentication successful!`);
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Email: ${credentials.email}`);
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Account ID: ${credentials.account_id}`);

        return credentials;
    }

    /**
     * 启动回调服务器
     * @returns {Promise<http.Server>}
     */
    async startCallbackServer() {
        return new Promise((resolve, reject) => {
            const server = http.createServer();

            server.on('request', (req, res) => {
                if (req.url.startsWith('/auth/callback')) {
                    const url = new URL(req.url, `http://localhost:${CODEX_CONFIG.port}`);
                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const error = url.searchParams.get('error');
                    const errorDescription = url.searchParams.get('error_description');

                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>Authentication Failed</title>
                                <style>
                                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                                    h1 { color: #d32f2f; }
                                    p { color: #666; }
                                </style>
                            </head>
                            <body>
                                <h1>❌ Authentication Failed</h1>
                                <p>${errorDescription || error}</p>
                                <p>You can close this window and try again.</p>
                            </body>
                            </html>
                        `);
                        server.emit('auth-error', new Error(errorDescription || error));
                    } else if (code && state) {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>Authentication Successful</title>
                                <style>
                                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                                    h1 { color: #4caf50; }
                                    p { color: #666; }
                                    .countdown { font-size: 24px; font-weight: bold; color: #2196f3; }
                                </style>
                                <script>
                                    let countdown = 10;
                                    setInterval(() => {
                                        countdown--;
                                        document.getElementById('countdown').textContent = countdown;
                                        if (countdown <= 0) {
                                            window.close();
                                        }
                                    }, 1000);
                                </script>
                            </head>
                            <body>
                                <h1>✅ Authentication Successful!</h1>
                                <p>You can now close this window and return to the application.</p>
                                <p>This window will close automatically in <span id="countdown" class="countdown">10</span> seconds.</p>
                            </body>
                            </html>
                        `);
                        server.emit('auth-success', { code, state });
                    }
                } else if (req.url === '/success') {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>Success!</h1>');
                }
            });

            server.listen(CODEX_CONFIG.port, () => {
                console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Callback server listening on port ${CODEX_CONFIG.port}`);
                resolve(server);
            });

            server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    reject(new Error(`Port ${CODEX_CONFIG.port} is already in use. Please close other applications using this port.`));
                } else {
                    reject(error);
                }
            });
        });
    }

    /**
     * 等待 OAuth 回调
     * @param {http.Server} server
     * @param {string} expectedState
     * @returns {Promise<{code: string, state: string}>}
     */
    async waitForCallback(server, expectedState) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                server.close();
                reject(new Error('Authentication timeout (10 minutes)'));
            }, 10 * 60 * 1000); // 10 分钟

            server.once('auth-success', (result) => {
                clearTimeout(timeout);
                server.close();

                if (result.state !== expectedState) {
                    reject(new Error('State mismatch - possible CSRF attack'));
                } else {
                    resolve(result);
                }
            });

            server.once('auth-error', (error) => {
                clearTimeout(timeout);
                server.close();
                reject(error);
            });
        });
    }

    /**
     * 用授权码换取 tokens
     * @param {string} code
     * @param {string} codeVerifier
     * @returns {Promise<Object>}
     */
    async exchangeCodeForTokens(code, codeVerifier) {
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Exchanging authorization code for tokens...`);

        try {
            const response = await this.httpClient.post(
                CODEX_CONFIG.tokenUrl,
                new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: CODEX_CONFIG.clientId,
                    code: code,
                    redirect_uri: CODEX_CONFIG.redirectUri,
                    code_verifier: codeVerifier
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Token exchange failed:`, error.response?.data || error.message);
            throw new Error(`Failed to exchange code for tokens: ${error.response?.data?.error_description || error.message}`);
        }
    }

    /**
     * 刷新 tokens
     * @param {string} refreshToken
     * @returns {Promise<Object>}
     */
    async refreshTokens(refreshToken) {
        console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Refreshing access token...`);

        try {
            const response = await this.httpClient.post(
                CODEX_CONFIG.tokenUrl,
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: CODEX_CONFIG.clientId,
                    refresh_token: refreshToken
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );

            const tokens = response.data;
            const claims = this.parseJWT(tokens.id_token);

            return {
                id_token: tokens.id_token,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || refreshToken,
                account_id: claims['https://api.openai.com/auth']?.chatgpt_account_id || claims.sub,
                last_refresh: new Date().toISOString(),
                email: claims.email,
                type: 'codex',
                expired: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
            };
        } catch (error) {
            console.error(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Token refresh failed:`, error.response?.data || error.message);
            throw new Error(`Failed to refresh tokens: ${error.response?.data?.error_description || error.message}`);
        }
    }

    /**
     * 解析 JWT token
     * @param {string} token
     * @returns {Object}
     */
    parseJWT(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                throw new Error('Invalid JWT token format');
            }

            // 解码 payload (base64url)
            const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
            return JSON.parse(payload);
        } catch (error) {
            console.error(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Failed to parse JWT:`, error.message);
            throw new Error(`Failed to parse JWT token: ${error.message}`);
        }
    }

    /**
     * 保存凭据到文件
     * @param {Object} creds
     * @returns {Promise<void>}
     */
    async saveCredentials(creds) {
        const email = creds.email || this.config.CODEX_EMAIL || 'default';

        // 优先使用配置中指定的路径，否则保存到 configs/codex 目录
        let credsPath;
        if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
            credsPath = this.config.CODEX_OAUTH_CREDS_FILE_PATH;
        } else {
            // 保存到 configs/codex 目录（与其他供应商一致）
            const projectDir = process.cwd();
            const targetDir = path.join(projectDir, 'configs', 'codex');
            await fs.mkdir(targetDir, { recursive: true });
            const timestamp = Date.now();
            const filename = `${timestamp}_codex-${email}.json`;
            credsPath = path.join(targetDir, filename);
        }

        try {
            const credsDir = path.dirname(credsPath);
            await fs.mkdir(credsDir, { recursive: true });
            await fs.writeFile(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });

            const relativePath = path.relative(process.cwd(), credsPath);
            console.log(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Credentials saved to ${relativePath}`);

            // 返回保存路径供后续使用
            return { credsPath, relativePath };
        } catch (error) {
            console.error(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Failed to save credentials:`, error.message);
            throw new Error(`Failed to save credentials: ${error.message}`);
        }
    }

    /**
     * 加载凭据
     * @param {string} email
     * @returns {Promise<Object|null>}
     */
    async loadCredentials(email) {
        // 优先使用配置中指定的路径，否则从 configs/codex 目录加载
        let credsPath;
        if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
            credsPath = this.config.CODEX_OAUTH_CREDS_FILE_PATH;
        } else {
            // 从 configs/codex 目录加载（与其他供应商一致）
            const projectDir = process.cwd();
            const targetDir = path.join(projectDir, 'configs', 'codex');

            // 扫描目录找到匹配的凭据文件
            try {
                const files = await fs.readdir(targetDir);
                const emailPattern = email || 'default';
                const matchingFile = files
                    .filter(f => f.includes(`codex-${emailPattern}`) && f.endsWith('.json'))
                    .sort()
                    .pop(); // 获取最新的文件

                if (matchingFile) {
                    credsPath = path.join(targetDir, matchingFile);
                } else {
                    return null;
                }
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return null;
                }
                throw error;
            }
        }

        try {
            const data = await fs.readFile(credsPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null; // 文件不存在
            }
            throw error;
        }
    }

    /**
     * 检查凭据文件是否存在
     * @param {string} email
     * @returns {Promise<boolean>}
     */
    async credentialsExist(email) {
        // 优先使用配置中指定的路径，否则从 configs/codex 目录检查
        let credsPath;
        if (this.config.CODEX_OAUTH_CREDS_FILE_PATH) {
            credsPath = this.config.CODEX_OAUTH_CREDS_FILE_PATH;
        } else {
            const projectDir = process.cwd();
            const targetDir = path.join(projectDir, 'configs', 'codex');

            try {
                const files = await fs.readdir(targetDir);
                const emailPattern = email || 'default';
                const hasMatch = files.some(f =>
                    f.includes(`codex-${emailPattern}`) && f.endsWith('.json')
                );
                return hasMatch;
            } catch (error) {
                return false;
            }
        }

        try {
            await fs.access(credsPath);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * 带重试的 token 刷新
 * @param {string} refreshToken
 * @param {Object} config
 * @param {number} maxRetries
 * @returns {Promise<Object>}
 */
export async function refreshTokensWithRetry(refreshToken, config = {}, maxRetries = 3) {
    const auth = new CodexAuth(config);
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await auth.refreshTokens(refreshToken);
        } catch (error) {
            lastError = error;
            console.warn(`${CODEX_CONFIG.logPrefix || '[Codex Auth]'} Retry ${i + 1}/${maxRetries} failed:`, error.message);

            if (i < maxRetries - 1) {
                // 指数退避
                const delay = Math.min(1000 * Math.pow(2, i), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}
