/**
 * Kiro IDC Token Refresh Tool
 * 通过 refreshToken + clientId + clientSecret 获取 accessToken (基于 AWS OIDC/IDC)
 *
 * 使用方法:
 *   1. 位置参数模式:
 *      node src/kiro-idc-token-refresh.js <refreshToken> <clientId> <clientSecret> [authMethod] [provider]
 *   2. JSON 文件模式:
 *      node src/kiro-idc-token-refresh.js ./config.json
 *   3. JSON 字符串模式:
 *      node src/kiro-idc-token-refresh.js '{"refreshToken": "...", "clientId": "...", "clientSecret": "..."}'
 *
 * 参数:
 *   refreshToken - Kiro 的 refresh token
 *   clientId     - AWS OIDC client ID
 *   clientSecret - AWS OIDC client secret
 *   authMethod   - 认证方法 (可选，默认: IdC)
 *   provider     - 提供商 (可选，默认: BuilderId)
 *
 * 输出格式:
 * {
 *   "accessToken": "aoaAAAA",
 *   "refreshToken": "aorAAAAAGnTpTMP_mR",
 *   "expiresAt": "2026-01-06T14:22:16.130Z",
 *   "authMethod": "IdC",
 *   "provider": "BuilderId",
 *   "clientId": "e8pqSrALVjvbqaW",
 *   "clientSecret": "eyJraWQiOiJrZXktMTU2NDAy",
 *   "region": "us-east-1"
 * }
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前脚本所在目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KIRO_IDC_CONSTANTS = {
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    CONTENT_TYPE_JSON: 'application/json',
    DEFAULT_AUTH_METHOD: 'IdC',
    DEFAULT_PROVIDER: 'BuilderId',
    DEFAULT_REGION: 'us-east-1',
    AXIOS_TIMEOUT: 30000, // 30 seconds timeout
};

/**
 * 通过 IDC (AWS OIDC) 刷新 token
 * @param {string} refreshToken - Kiro 的 refresh token
 * @param {string} clientId - AWS OIDC client ID
 * @param {string} clientSecret - AWS OIDC client secret
 * @param {Object} options - 可选参数
 * @param {string} options.authMethod - 认证方法 (默认: IdC)
 * @param {string} options.provider - 提供商 (默认: BuilderId)
 * @param {string} options.region - AWS 区域 (默认: us-east-1)
 * @returns {Promise<Object>} 包含 accessToken 等信息的对象
 */
async function refreshKiroIdcToken(refreshToken, clientId, clientSecret, options = {}) {
    const authMethod = options.authMethod || KIRO_IDC_CONSTANTS.DEFAULT_AUTH_METHOD;
    const provider = options.provider || KIRO_IDC_CONSTANTS.DEFAULT_PROVIDER;
    const region = options.region || KIRO_IDC_CONSTANTS.DEFAULT_REGION;
    
    const refreshUrl = KIRO_IDC_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', region);
    
    // IDC/OIDC 使用 form-urlencoded 格式
    const requestBody = {
        grantType: 'refresh_token',
        refreshToken: refreshToken,
        clientId: clientId,
        clientSecret: clientSecret,
    };

    const axiosConfig = {
        timeout: KIRO_IDC_CONSTANTS.AXIOS_TIMEOUT,
        headers: {
            'Content-Type': KIRO_IDC_CONSTANTS.CONTENT_TYPE_JSON,
            'User-Agent': 'KiroIDE'
        },
    };

    try {
        console.log(`[Kiro IDC Token Refresh] 正在请求: ${refreshUrl}`);
        const response = await axios.post(refreshUrl, requestBody, axiosConfig);
        
        // AWS OIDC 返回格式: { access_token, refresh_token, expires_in, token_type }
        if (response.data && response.data.accessToken) {
            const expiresIn = response.data.expiresIn;
            const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
            
            const result = {
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken || refreshToken,
                expiresAt: expiresAt,
                authMethod: authMethod,
                provider: provider,
                clientId: clientId,
                clientSecret: clientSecret,
                region: region,
            };
            
            return result;
        } else {
            throw new Error('Invalid refresh response: Missing access_token');
        }
    } catch (error) {
        if (error.response) {
            console.error(`[Kiro IDC Token Refresh] 请求失败: HTTP ${error.response.status}`);
            console.error(`[Kiro IDC Token Refresh] 响应内容:`, error.response.data);
        } else if (error.request) {
            console.error(`[Kiro IDC Token Refresh] 请求失败: 无响应`);
        } else {
            console.error(`[Kiro IDC Token Refresh] 请求失败:`, error.message);
        }
        throw error;
    }
}

/**
 * 主函数 - 命令行入口
 */
async function main() {
    const args = process.argv.slice(2);

    let refreshToken, clientId, clientSecret, authMethod, provider;

    // 1. 尝试解析第一个参数为 JSON 文件路径
    if (args.length === 1 && args[0].toLowerCase().endsWith('.json')) {
        try {
            const jsonPath = path.isAbsolute(args[0]) ? args[0] : path.resolve(process.cwd(), args[0]);
            if (fs.existsSync(jsonPath)) {
                console.log(`[Kiro IDC Token Refresh] 正在从文件读取配置: ${jsonPath}`);
                const fileContent = fs.readFileSync(jsonPath, 'utf-8');
                const parsed = JSON.parse(fileContent);
                refreshToken = parsed.refreshToken;
                clientId = parsed.clientId;
                clientSecret = parsed.clientSecret;
                authMethod = parsed.authMethod;
                provider = parsed.provider;
            } else {
                console.error(`错误: 找不到文件 ${jsonPath}`);
                process.exit(1);
            }
        } catch (e) {
            console.error(`错误: 读取或解析 JSON 文件失败: ${e.message}`);
            process.exit(1);
        }
    }
    // 2. 尝试解析第一个参数为 JSON 字符串
    else if (args.length === 1 && args[0].trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(args[0]);
            refreshToken = parsed.refreshToken;
            clientId = parsed.clientId;
            clientSecret = parsed.clientSecret;
            authMethod = parsed.authMethod;
            provider = parsed.provider;
        } catch (e) {
            // JSON 解析失败，将回退到位置参数处理
        }
    }

    // 如果没有通过 JSON 成功获取参数，则尝试位置参数
    if (!refreshToken) {
        if (args.length === 0 || args.length < 3) {
            console.log('Kiro IDC Token Refresh Tool');
            console.log('============================');
            console.log('');
            console.log('使用方法:');
            console.log('  1. 位置参数模式:');
            console.log('     node src/kiro-idc-token-refresh.js <refreshToken> <clientId> <clientSecret> [authMethod] [provider]');
            console.log('  2. JSON 文件模式:');
            console.log('     node src/kiro-idc-token-refresh.js ./config.json');
            console.log('  3. JSON 字符串模式:');
            console.log('     node src/kiro-idc-token-refresh.js \'{"refreshToken": "...", "clientId": "...", "clientSecret": "...", "authMethod": "...", "provider": "..."}\'');
            console.log('');
            console.log('参数:');
            console.log('  refreshToken - Kiro 的 refresh token (必需)');
            console.log('  clientId     - AWS OIDC client ID (必需)');
            console.log('  clientSecret - AWS OIDC client secret (必需)');
            console.log('  authMethod   - 认证方法 (可选，默认: IdC)');
            console.log('  provider     - 提供商 (可选，默认: BuilderId)');
            console.log('');
            console.log('示例:');
            console.log('  node src/kiro-idc-token-refresh.js aorAxxxxxxxx e8pqSrALVjvbqaW eyJraWQiOiJrZXktMTU2NDAy');
            console.log('  node src/kiro-idc-token-refresh.js aorAxxxxxxxx e8pqSrALVjvbqaW eyJraWQiOiJrZXktMTU2NDAy IdC Enterprise');
            console.log('');
            console.log('输出格式:');
            console.log(JSON.stringify({
                accessToken: "aoaAAAA...",
                refreshToken: "aorAAAAAGnTpTMP_mR...",
                expiresAt: "2026-01-06T14:22:16.130Z",
                authMethod: "IdC",
                provider: "BuilderId",
                clientId: "e8pqSrALVjvbqaW",
                clientSecret: "eyJraWQiOiJrZXktMTU2NDAy",
                region: "us-east-1"
            }, null, 2));
            process.exit(0);
        }

        refreshToken = args[0];
        clientId = args[1];
        clientSecret = args[2];
        authMethod = args[3];
        provider = args[4];
    }

    // 设置默认值
    authMethod = authMethod || KIRO_IDC_CONSTANTS.DEFAULT_AUTH_METHOD;
    provider = provider || KIRO_IDC_CONSTANTS.DEFAULT_PROVIDER;
    
    if (!refreshToken) {
        console.error('错误: 请提供 refreshToken');
        process.exit(1);
    }
    
    if (!clientId) {
        console.error('错误: 请提供 clientId');
        process.exit(1);
    }
    
    if (!clientSecret) {
        console.error('错误: 请提供 clientSecret');
        process.exit(1);
    }
    
    try {
        console.log(`[Kiro IDC Token Refresh] 开始刷新 token...`);
        console.log(`[Kiro IDC Token Refresh] 认证方法: ${authMethod}`);
        console.log(`[Kiro IDC Token Refresh] 提供商: ${provider}`);
        console.log(`[Kiro IDC Token Refresh] Client ID: ${clientId.substring(0, 8)}...`);
        
        const result = await refreshKiroIdcToken(refreshToken, clientId, clientSecret, {
            authMethod,
            provider,
            region: KIRO_IDC_CONSTANTS.DEFAULT_REGION
        });
        
        console.log('');
        console.log('=== Token 刷新成功 ===');
        console.log('');
        console.log(JSON.stringify(result, null, 2));
        
        // 输出过期时间信息
        const expiresDate = new Date(result.expiresAt);
        const now = new Date();
        const diffMs = expiresDate - now;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        
        console.log('');
        console.log(`[Kiro IDC Token Refresh] Token 将在 ${diffHours} 小时 ${diffMins % 60} 分钟后过期`);
        console.log(`[Kiro IDC Token Refresh] 过期时间: ${result.expiresAt}`);
        
        // 写入 JSON 文件到脚本执行目录
        const timestamp = Date.now();
        const outputFileName = `kiro-idc-${timestamp}-auth-token.json`;
        const outputFilePath = path.join(__dirname, outputFileName);
        
        fs.writeFileSync(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');
        
        console.log('');
        console.log(`[Kiro IDC Token Refresh] Token 已保存到文件: ${outputFilePath}`);
        
    } catch (error) {
        console.error('');
        console.error('=== Token 刷新失败 ===');
        console.error(`错误: ${error.message}`);
        process.exit(1);
    }
}

// 导出函数供其他模块使用
export { refreshKiroIdcToken };

// 如果直接运行此脚本，执行主函数
main();