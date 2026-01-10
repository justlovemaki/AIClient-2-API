/**
 * Kiro Token Refresh Tool
 * 通过 refreshToken 获取 accessToken 并转换为指定格式
 * 
 * 使用方法:
 *   node src/kiro-token-refresh.js <refreshToken> [region]
 * 
 * 参数:
 *   refreshToken - Kiro 的 refresh token
 *   region - AWS 区域 (可选，默认: us-east-1)
 * 
 * 输出格式:
 * {
 *   "accessToken": "aoaAAAAAGlfTyA8C4c",
 *   "refreshToken": "aorA",
 *   "profileArn": "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
 *   "expiresAt": "2026-01-08T06:30:59.065Z",
 *   "authMethod": "social",
 *   "provider": "Google"
 * }
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前脚本所在目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    CONTENT_TYPE_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    DEFAULT_PROVIDER: 'Google',
    AXIOS_TIMEOUT: 30000, // 30 seconds timeout
};

/**
 * 通过 refreshToken 获取 accessToken
 * @param {string} refreshToken - Kiro 的 refresh token
 * @param {string} region - AWS 区域 (默认: us-east-1)
 * @returns {Promise<Object>} 包含 accessToken 等信息的对象
 */
async function refreshKiroToken(refreshToken, region = 'us-east-1') {
    const refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
    
    const requestBody = {
        refreshToken: refreshToken,
    };

    const axiosConfig = {
        timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        headers: {
            'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
        },
    };

    try {
        console.log(`[Kiro Token Refresh] 正在请求: ${refreshUrl}`);
        const response = await axios.post(refreshUrl, requestBody, axiosConfig);
        
        if (response.data && response.data.accessToken) {
            const expiresIn = response.data.expiresIn;
            const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
            
            const result = {
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken || refreshToken,
                profileArn: response.data.profileArn || '',
                expiresAt: expiresAt,
                authMethod: KIRO_CONSTANTS.AUTH_METHOD_SOCIAL,
                provider: KIRO_CONSTANTS.DEFAULT_PROVIDER,
            };
            
            // 如果响应中包含 region 信息，添加到结果中
            if (region) {
                result.region = region;
            }
            
            return result;
        } else {
            throw new Error('Invalid refresh response: Missing accessToken');
        }
    } catch (error) {
        if (error.response) {
            console.error(`[Kiro Token Refresh] 请求失败: HTTP ${error.response.status}`);
            console.error(`[Kiro Token Refresh] 响应内容:`, error.response.data);
        } else if (error.request) {
            console.error(`[Kiro Token Refresh] 请求失败: 无响应`);
        } else {
            console.error(`[Kiro Token Refresh] 请求失败:`, error.message);
        }
        throw error;
    }
}

/**
 * 主函数 - 命令行入口
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Kiro Token Refresh Tool');
        console.log('========================');
        console.log('');
        console.log('使用方法:');
        console.log('  node src/kiro-token-refresh.js <refreshToken> [region]');
        console.log('');
        console.log('参数:');
        console.log('  refreshToken - Kiro 的 refresh token (必需)');
        console.log('  region       - AWS 区域 (可选，默认: us-east-1)');
        console.log('');
        console.log('示例:');
        console.log('  node src/kiro-token-refresh.js aorAxxxxxxxx');
        console.log('  node src/kiro-token-refresh.js aorAxxxxxxxx us-west-2');
        console.log('');
        console.log('输出格式:');
        console.log(JSON.stringify({
            accessToken: "aoaAAAAAGlfTyA8C4c...",
            refreshToken: "aorA...",
            profileArn: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
            expiresAt: "2026-01-08T06:30:59.065Z",
            authMethod: "social",
            provider: "Google"
        }, null, 2));
        process.exit(0);
    }
    
    const refreshToken = args[0];
    const region = args[1] || 'us-east-1';
    
    if (!refreshToken) {
        console.error('错误: 请提供 refreshToken');
        process.exit(1);
    }
    
    try {
        console.log(`[Kiro Token Refresh] 开始刷新 token...`);
        console.log(`[Kiro Token Refresh] 区域: ${region}`);
        
        const result = await refreshKiroToken(refreshToken, region);
        
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
        console.log(`[Kiro Token Refresh] Token 将在 ${diffHours} 小时 ${diffMins % 60} 分钟后过期`);
        console.log(`[Kiro Token Refresh] 过期时间: ${result.expiresAt}`);
        
        // 写入 JSON 文件到脚本执行目录
        const timestamp = Date.now();
        const outputFileName = `kiro-${timestamp}-auth-token.json`;
        const outputFilePath = path.join(__dirname, outputFileName);
        
        fs.writeFileSync(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');
        
        console.log('');
        console.log(`[Kiro Token Refresh] Token 已保存到文件: ${outputFilePath}`);
        
    } catch (error) {
        console.error('');
        console.error('=== Token 刷新失败 ===');
        console.error(`错误: ${error.message}`);
        process.exit(1);
    }
}

// 导出函数供其他模块使用
export { refreshKiroToken };

// 如果直接运行此脚本，执行主函数
main();