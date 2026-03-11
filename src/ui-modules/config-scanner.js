import { existsSync } from 'fs';
import logger from '../utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';
import { addToUsedPaths, isPathUsed, pathsEqual } from '../utils/provider-utils.js';

/**
 * 扫描和分析配置文件
 * @param {Object} currentConfig - The current configuration object
 * @param {Object} providerPoolManager - Provider pool manager instance
 * @returns {Promise<Array>} Array of configuration file objects
 */
export async function scanConfigFiles(currentConfig, providerPoolManager) {
    const configFiles = [];
    
    // 只扫描configs目录
    const configsPath = path.join(process.cwd(), 'configs');
    
    if (!existsSync(configsPath)) {
        // logger.info('[Config Scanner] configs directory not found, creating empty result');
        return configFiles;
    }

    const usedPaths = new Set(); // 存储已使用的路径，用于判断关联状态

    // 从配置中提取所有OAuth凭据文件路径 - 标准化路径格式
    addToUsedPaths(usedPaths, currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.IFLOW_TOKEN_FILE_PATH);
    addToUsedPaths(usedPaths, currentConfig.CODEX_OAUTH_CREDS_FILE_PATH);

    // 使用最新的提供商池数据
    let providerPools = currentConfig.providerPools;
    if (providerPoolManager && providerPoolManager.providerPools) {
        providerPools = providerPoolManager.providerPools;
    }

    // 检查提供商池文件中的所有OAuth凭据路径 - 标准化路径格式
    if (providerPools) {
        for (const [providerType, providers] of Object.entries(providerPools)) {
            for (const provider of providers) {
                addToUsedPaths(usedPaths, provider.GEMINI_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.KIRO_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.QWEN_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH);
                addToUsedPaths(usedPaths, provider.IFLOW_TOKEN_FILE_PATH);
                addToUsedPaths(usedPaths, provider.CODEX_OAUTH_CREDS_FILE_PATH);
            }
        }
    }

    try {
        // 扫描configs目录下的所有子目录和文件
        const configsFiles = await scanOAuthDirectory(configsPath, usedPaths, currentConfig);
        configFiles.push(...configsFiles);
    } catch (error) {
        logger.warn(`[Config Scanner] Failed to scan configs directory:`, error.message);
    }

    return configFiles;
}

/**
 * 分析 OAuth 配置文件并返回元数据
 * @param {string} filePath - Full path to the file
 * @param {Set} usedPaths - Set of paths currently in use
 * @returns {Promise<Object|null>} OAuth file information object
 */
async function analyzeOAuthFile(filePath, usedPaths, currentConfig) {
    try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const filename = path.basename(filePath);
        const relativePath = path.relative(process.cwd(), filePath);
        
        // 读取文件内容进行分析
        let content = '';
        let type = 'oauth'; // 默认为 oauth 类型
        let isValid = true;
        let errorMessage = '';
        let oauthProvider = 'unknown';
        let usageInfo = getFileUsageInfo(relativePath, filename, usedPaths, currentConfig);
        
        // 从路径预检测提供商
        const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase();
        if (normalizedPath.includes('/kiro/')) oauthProvider = 'kiro';
        else if (normalizedPath.includes('/gemini/')) oauthProvider = 'gemini';
        else if (normalizedPath.includes('/qwen/')) oauthProvider = 'qwen';
        else if (normalizedPath.includes('/antigravity/')) oauthProvider = 'antigravity';
        else if (normalizedPath.includes('/codex/')) oauthProvider = 'codex';
        else if (normalizedPath.includes('/iflow/')) oauthProvider = 'iflow';

        try {
            content = await fs.readFile(filePath, 'utf8');
            
            // 1. 首先尝试根据文件名识别特定类型的配置 (最高优先级)
            const lowerFilename = filename.toLowerCase();
            if (lowerFilename === 'provider_pools.json' || lowerFilename === 'provider-pools.json') {
                type = 'provider-pool';
            } else if (lowerFilename.includes('system_prompt') || lowerFilename.includes('system-prompt')) {
                type = 'system-prompt';
            } else if (lowerFilename === 'plugins.json') {
                type = 'plugins';
            } else if (lowerFilename === 'usage-cache.json') {
                type = 'usage';
            } else if (lowerFilename === 'config.json') {
                type = 'config';
            } else if (lowerFilename.includes('potluck-keys')) {
                type = 'api-key';
            } else if (lowerFilename.includes('potluck-data')) {
                type = 'database';
            } else if (lowerFilename === 'token-store.json') {
                type = 'oauth';
            }

            // 2. 根据内容进一步识别和完善信息
            if (ext === '.json') {
                try {
                    const jsonData = JSON.parse(content);
                    
                    // 如果文件名没识别出类型，尝试从内容识别
                    if (type === 'oauth') {
                        if (jsonData.providerPools || jsonData.provider_pools) {
                            type = 'provider-pool';
                        } else if (jsonData.apiKey || jsonData.api_key) {
                            type = 'api-key';
                        }
                    }

                    // 识别具体的提供商/认证方式
                    if (jsonData.client_id || jsonData.client_secret) {
                        if (oauthProvider === 'unknown') oauthProvider = 'oauth2';
                    } else if (jsonData.access_token || jsonData.refresh_token) {
                        if (oauthProvider === 'unknown') oauthProvider = 'token_based';
                    } else if (jsonData.credentials) {
                        if (oauthProvider === 'unknown') oauthProvider = 'service_account';
                    } else if (jsonData.apiKey || jsonData.api_key) {
                        if (oauthProvider === 'unknown') oauthProvider = 'api_key';
                    }
                    
                    if (jsonData.base_url || jsonData.endpoint) {
                        const baseUrl = (jsonData.base_url || jsonData.endpoint).toLowerCase();
                        if (baseUrl.includes('openai.com')) {
                            oauthProvider = 'openai';
                        } else if (baseUrl.includes('anthropic.com')) {
                            oauthProvider = 'claude';
                        } else if (baseUrl.includes('googleapis.com')) {
                            oauthProvider = 'gemini';
                        }
                    }
                } catch (jsonErr) {
                    isValid = false;
                    errorMessage = `JSON Parse Error: ${jsonErr.message}`;
                }
            } else {
                // 处理非 JSON 文件
                if (ext === '.key' || ext === '.pem') {
                    if (content.includes('-----BEGIN') && content.includes('PRIVATE KEY-----')) {
                        oauthProvider = 'private_key';
                    }
                } else if (ext === '.txt') {
                    if (content.includes('api_key') || content.includes('apikey')) {
                        if (type === 'oauth') type = 'api-key';
                        if (oauthProvider === 'unknown') oauthProvider = 'api_key';
                    }
                } else if (ext === '.oauth' || ext === '.creds') {
                    if (oauthProvider === 'unknown') oauthProvider = 'oauth_credentials';
                }
            }
        } catch (readError) {
            isValid = false;
            errorMessage = `Unable to read file: ${readError.message}`;
        }
        
        return {
            name: filename,
            path: relativePath,
            size: stats.size,
            type: type, // 用于前端图标显示的关键字段
            provider: oauthProvider,
            extension: ext,
            modified: stats.mtime.toISOString(),
            isValid: isValid,
            errorMessage: errorMessage,
            isUsed: isPathUsed(relativePath, filename, usedPaths),
            usageInfo: usageInfo,
            preview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
        };
    } catch (error) {
        logger.warn(`[OAuth Analyzer] Failed to analyze file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Get detailed usage information for a file
 * @param {string} relativePath - Relative file path
 * @param {string} fileName - File name
 * @param {Set} usedPaths - Set of used paths
 * @param {Object} currentConfig - Current configuration
 * @returns {Object} Usage information object
 */
function getFileUsageInfo(relativePath, fileName, usedPaths, currentConfig) {
    const usageInfo = {
        isUsed: false,
        usageType: null,
        usageDetails: []
    };

    // 检查是否被使用
    const isUsed = isPathUsed(relativePath, fileName, usedPaths);
    if (!isUsed) {
        return usageInfo;
    }

    usageInfo.isUsed = true;

    // 检查主要配置中的使用情况
    if (currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.GEMINI_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Gemini OAuth credentials file path',
            configKey: 'GEMINI_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.KIRO_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Kiro OAuth credentials file path',
            configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.QWEN_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Qwen OAuth credentials file path',
            configKey: 'QWEN_OAUTH_CREDS_FILE_PATH'
        });
    }

    if (currentConfig.IFLOW_TOKEN_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.IFLOW_TOKEN_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.IFLOW_TOKEN_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'iFlow Token file path',
            configKey: 'IFLOW_TOKEN_FILE_PATH'
        });
    }

    if (currentConfig.CODEX_OAUTH_CREDS_FILE_PATH &&
        (pathsEqual(relativePath, currentConfig.CODEX_OAUTH_CREDS_FILE_PATH) ||
         pathsEqual(relativePath, currentConfig.CODEX_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
        usageInfo.usageType = 'main_config';
        usageInfo.usageDetails.push({
            type: 'Main Config',
            location: 'Codex OAuth credentials file path',
            configKey: 'CODEX_OAUTH_CREDS_FILE_PATH'
        });
    }

    // 检查提供商池中的使用情况
    if (currentConfig.providerPools) {
        // 使用 flatMap 将双重循环优化为单层循环 O(n)
        const allProviders = Object.entries(currentConfig.providerPools).flatMap(
            ([providerType, providers]) =>
                providers.map((provider, index) => ({ provider, providerType, index }))
        );

        for (const { provider, providerType, index } of allProviders) {
            const providerUsages = [];

            if (provider.GEMINI_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.GEMINI_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.GEMINI_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Gemini OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    nodeName: provider.customName,
                    uuid: provider.uuid,
                    isHealthy: provider.isHealthy !== false,
                    isDisabled: provider.isDisabled === true,
                    configKey: 'GEMINI_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.KIRO_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Kiro OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    nodeName: provider.customName,
                    uuid: provider.uuid,
                    isHealthy: provider.isHealthy !== false,
                    isDisabled: provider.isDisabled === true,
                    configKey: 'KIRO_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.QWEN_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.QWEN_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.QWEN_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Qwen OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    nodeName: provider.customName,
                    uuid: provider.uuid,
                    isHealthy: provider.isHealthy !== false,
                    isDisabled: provider.isDisabled === true,
                    configKey: 'QWEN_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Antigravity OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    nodeName: provider.customName,
                    uuid: provider.uuid,
                    isHealthy: provider.isHealthy !== false,
                    isDisabled: provider.isDisabled === true,
                    configKey: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH'
                });
            }

            if (provider.IFLOW_TOKEN_FILE_PATH &&
                (pathsEqual(relativePath, provider.IFLOW_TOKEN_FILE_PATH) ||
                 pathsEqual(relativePath, provider.IFLOW_TOKEN_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `iFlow Token (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    nodeName: provider.customName,
                    uuid: provider.uuid,
                    isHealthy: provider.isHealthy !== false,
                    isDisabled: provider.isDisabled === true,
                    configKey: 'IFLOW_TOKEN_FILE_PATH'
                });
            }

            if (provider.CODEX_OAUTH_CREDS_FILE_PATH &&
                (pathsEqual(relativePath, provider.CODEX_OAUTH_CREDS_FILE_PATH) ||
                 pathsEqual(relativePath, provider.CODEX_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/')))) {
                providerUsages.push({
                    type: 'Provider Pool',
                    location: `Codex OAuth credentials (node ${index + 1})`,
                    providerType: providerType,
                    providerIndex: index,
                    nodeName: provider.customName,
                    uuid: provider.uuid,
                    isHealthy: provider.isHealthy !== false,
                    isDisabled: provider.isDisabled === true,
                    configKey: 'CODEX_OAUTH_CREDS_FILE_PATH'
                });
            }
            
            if (providerUsages.length > 0) {
                usageInfo.usageType = 'provider_pool';
                usageInfo.usageDetails.push(...providerUsages);
            }
        }
    }

    // 如果有多个使用位置，标记为多种用途
    if (usageInfo.usageDetails.length > 1) {
        usageInfo.usageType = 'multiple';
    }

    return usageInfo;
}

/**
 * Scan OAuth directory for credential files
 * @param {string} dirPath - Directory path to scan
 * @param {Set} usedPaths - Set of used paths
 * @param {Object} currentConfig - Current configuration
 * @returns {Promise<Array>} Array of OAuth configuration file objects
 */
async function scanOAuthDirectory(dirPath, usedPaths, currentConfig) {
    const oauthFiles = [];
    
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isFile()) {
                const ext = path.extname(file.name).toLowerCase();
                // 只关注OAuth相关的文件类型
                if (['.json', '.oauth', '.creds', '.key', '.pem', '.txt'].includes(ext)) {
                    const fileInfo = await analyzeOAuthFile(fullPath, usedPaths, currentConfig);
                    if (fileInfo) {
                        oauthFiles.push(fileInfo);
                    }
                }
            } else if (file.isDirectory()) {
                // 递归扫描子目录（限制深度）
                const relativePath = path.relative(process.cwd(), fullPath);
                // 最大深度4层，以支持 configs/kiro/{subfolder}/file.json 这样的结构
                if (relativePath.split(path.sep).length < 4) {
                    const subFiles = await scanOAuthDirectory(fullPath, usedPaths, currentConfig);
                    oauthFiles.push(...subFiles);
                }
            }
        }
    } catch (error) {
        logger.warn(`[OAuth Scanner] Failed to scan directory ${dirPath}:`, error.message);
    }
    
    return oauthFiles;
}