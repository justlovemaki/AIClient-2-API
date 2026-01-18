import fs from 'fs';
import path from 'path';
import { broadcastEvent } from '../services/ui-manager.js';
import { autoLinkProviderConfigs } from '../services/service-manager.js';
import { CONFIG } from '../core/config-manager.js';

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