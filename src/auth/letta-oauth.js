import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { broadcastEvent } from '../services/ui-manager.js';
import { autoLinkProviderConfigs } from '../services/service-manager.js';
import { CONFIG } from '../core/config-manager.js';
import { getProxyConfigForProvider } from '../utils/proxy-utils.js';

/**
 * Letta OAuth Configuration
 */
const LETTA_OAUTH_CONFIG = {
    authServiceEndpoint: 'https://api.letta.com', // Base URL for Letta API
    callbackPort: 19876,
    authTimeout: 5 * 60 * 1000,
    credentialsDir: 'letta',
    logPrefix: '[Letta Auth]'
};

/**
 * 活动的 Letta 回调服务器管理
 */
let activeLettaServer = null;

/**
 * Helper for fetch with proxy
 */
async function fetchWithProxy(url, options = {}, providerType = 'openai-letta') {
    const proxyConfig = getProxyConfigForProvider(CONFIG, providerType);
    const axiosConfig = {
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        data: options.body,
        timeout: 30000,
    };

    if (proxyConfig) {
        axiosConfig.httpAgent = proxyConfig.httpAgent;
        axiosConfig.httpsAgent = proxyConfig.httpsAgent;
        axiosConfig.proxy = false;
    }

    try {
        const response = await axios(axiosConfig);
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            json: async () => response.data,
            text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        };
    } catch (error) {
        if (error.response) {
            return {
                ok: false,
                status: error.response.status,
                json: async () => error.response.data,
                text: async () => JSON.stringify(error.response.data),
            };
        }
        throw error;
    }
}

/**
 * Handle Letta OAuth flow
 */
export async function handleLettaOAuth(currentConfig, options = {}) {
    const state = crypto.randomBytes(16).toString('hex');
    const port = LETTA_OAUTH_CONFIG.callbackPort;
    
    // In a real OAuth flow, we would redirect to a login page.
    // Since the task implies implementing token logic similar to tt/oauth.ts,
    // we'll simulate the URL generation.
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    
    // For Letta, if it's a standard OAuth2 flow:
    const authUrl = `${LETTA_OAUTH_CONFIG.authServiceEndpoint}/auth/authorize?` +
        `response_type=code&` +
        `client_id=${process.env.LETTA_CLIENT_ID || 'letta-code'}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}&` +
        `scope=read:agents write:messages`;

    // Start local server to wait for callback
    await startLettaCallbackServer(state, options);

    return {
        authUrl,
        authInfo: {
            provider: 'openai-letta',
            port: port,
            state: state,
            ...options
        }
    };
}

async function startLettaCallbackServer(expectedState, options = {}) {
    if (activeLettaServer) {
        activeLettaServer.close();
    }

    const server = (await import('http')).createServer(async (req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${LETTA_OAUTH_CONFIG.callbackPort}`);
        
        if (url.pathname === '/callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');

            if (state !== expectedState) {
                res.writeHead(400);
                res.end('Invalid state');
                return;
            }

            try {
                // Exchange code for token
                const tokenResponse = await fetchWithProxy(`${LETTA_OAUTH_CONFIG.authServiceEndpoint}/auth/token`, {
                    method: 'POST',
                    body: {
                        grant_type: 'authorization_code',
                        code,
                        client_id: process.env.LETTA_CLIENT_ID || 'letta-code',
                        redirect_uri: `http://127.0.0.1:${LETTA_OAUTH_CONFIG.callbackPort}/callback`
                    }
                });

                if (!tokenResponse.ok) throw new Error('Token exchange failed');
                
                const tokenData = await tokenResponse.json();
                await saveLettaToken(tokenData, options);

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Authorization Successful!</h1><p>You can close this window.</p>');
                
                server.close();
                activeLettaServer = null;
            } catch (err) {
                res.writeHead(500);
                res.end(`Error: ${err.message}`);
            }
        }
    });

    server.listen(LETTA_OAUTH_CONFIG.callbackPort);
    activeLettaServer = server;

    setTimeout(() => {
        if (activeLettaServer === server) {
            server.close();
            activeLettaServer = null;
        }
    }, LETTA_OAUTH_CONFIG.authTimeout);
}

async function saveLettaToken(tokenData, options) {
    const timestamp = Date.now();
    const folderName = `${timestamp}_letta-token`;
    const targetDir = path.join(process.cwd(), 'configs', 'letta', folderName);
    await fs.promises.mkdir(targetDir, { recursive: true });
    
    const credPath = path.join(targetDir, `token.json`);
    
    // 使用用户提供的接口返回结构：
    // env.LETTA_API_KEY, refreshToken, tokenExpiresAt, lastAgent
    const saveData = {
        LETTA_API_KEY: tokenData.env?.LETTA_API_KEY || tokenData.access_token,
        refreshToken: tokenData.refreshToken || tokenData.refresh_token,
        expiresAt: tokenData.tokenExpiresAt ? new Date(tokenData.tokenExpiresAt).toISOString() : new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        LETTA_BASE_URL: LETTA_OAUTH_CONFIG.authServiceEndpoint,
        LETTA_AGENT_ID: tokenData.lastAgent || tokenData.agentId || options.agentId
    };
    
    await fs.promises.writeFile(credPath, JSON.stringify(saveData, null, 2));
    
    broadcastEvent('oauth_success', {
        provider: 'openai-letta',
        credPath,
        relativePath: path.relative(process.cwd(), credPath),
        timestamp: new Date().toISOString()
    });
    
    await autoLinkProviderConfigs(CONFIG);
}

/**
 * Refresh Letta Token
 */
export async function refreshLettaToken(refreshToken) {
    console.log(`${LETTA_OAUTH_CONFIG.logPrefix} Refreshing token...`);
    const response = await fetchWithProxy(`${LETTA_OAUTH_CONFIG.authServiceEndpoint}/auth/token`, {
        method: 'POST',
        body: {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: process.env.LETTA_CLIENT_ID || 'letta-code'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to refresh Letta token: ${response.status}`);
    }

    const data = await response.json();
    
    // 映射返回字段
    return {
        accessToken: data.env?.LETTA_API_KEY || data.access_token,
        refreshToken: data.refreshToken || data.refresh_token || refreshToken,
        expiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt).toISOString() : new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
        agentId: data.lastAgent || data.agentId
    };
}
