import { getServiceAdapter, serviceInstances } from './adapter.js';
import { ProviderPoolManager } from './provider-pool-manager.js';
import deepmerge from 'deepmerge';
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as path from 'path';
import {
    PROVIDER_MAPPINGS,
    createProviderConfig,
    addToUsedPaths,
    isPathUsed,
    getFileName,
    formatSystemPath
} from './provider-utils.js';

// 存储 ProviderPoolManager 实例
let providerPoolManager = null;

/**
 * 扫描 configs 目录并自动关联未关联的配置文件到对应的提供商
 * @param {Object} config - 服务器配置对象
 * @returns {Promise<Object>} 更新后的 providerPools 对象
 */
async function autoLinkProviderConfigs(config) {
    // 确保 providerPools 对象存在
    if (!config.providerPools) {
        config.providerPools = {};
    }
    
    let totalNewProviders = 0;
    const allNewProviders = {};
    
    // 遍历所有提供商映射
    for (const mapping of PROVIDER_MAPPINGS) {
        const configsPath = path.join(process.cwd(), 'configs', mapping.dirName);
        const { providerType, credPathKey, defaultCheckModel, displayName, needsProjectId } = mapping;
        
        // 确保提供商类型数组存在
        if (!config.providerPools[providerType]) {
            config.providerPools[providerType] = [];
        }
        
        // 检查目录是否存在
        if (!fs.existsSync(configsPath)) {
            continue;
        }
        
        // 获取已关联的配置文件路径集合
        const linkedPaths = new Set();
        for (const provider of config.providerPools[providerType]) {
            if (provider[credPathKey]) {
                // 使用公共方法添加路径的所有变体格式
                addToUsedPaths(linkedPaths, provider[credPathKey]);
            }
        }
        
        // 递归扫描目录
        const newProviders = [];
        await scanProviderDirectory(configsPath, linkedPaths, newProviders, {
            credPathKey,
            defaultCheckModel,
            needsProjectId
        });
        
        // 如果有新的配置文件需要关联
        if (newProviders.length > 0) {
            config.providerPools[providerType].push(...newProviders);
            totalNewProviders += newProviders.length;
            allNewProviders[displayName] = newProviders;
        }
    }
    
    // 如果有新的配置文件需要关联，保存更新后的 provider_pools.json
    if (totalNewProviders > 0) {
        const filePath = config.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
        try {
            await pfs.writeFile(filePath, JSON.stringify(config.providerPools, null, 2), 'utf8');
            console.log(`[Auto-Link] Added ${totalNewProviders} new config(s) to provider pools:`);
            for (const [displayName, providers] of Object.entries(allNewProviders)) {
                console.log(`  ${displayName}: ${providers.length} config(s)`);
                providers.forEach(p => {
                    // 获取凭据路径键
                    const credKey = Object.keys(p).find(k => k.endsWith('_CREDS_FILE_PATH'));
                    if (credKey) {
                        console.log(`    - ${p[credKey]}`);
                    }
                });
            }
        } catch (error) {
            console.error(`[Auto-Link] Failed to save provider_pools.json: ${error.message}`);
        }
    } else {
        console.log('[Auto-Link] No new configs to link');
    }
    
    return config.providerPools;
}

/**
 * 递归扫描提供商配置目录
 * @param {string} dirPath - 目录路径
 * @param {Set} linkedPaths - 已关联的路径集合
 * @param {Array} newProviders - 新提供商配置数组
 * @param {Object} options - 配置选项
 * @param {string} options.credPathKey - 凭据路径键名
 * @param {string} options.defaultCheckModel - 默认检测模型
 * @param {boolean} options.needsProjectId - 是否需要 PROJECT_ID
 */
async function scanProviderDirectory(dirPath, linkedPaths, newProviders, options) {
    const { credPathKey, defaultCheckModel, needsProjectId } = options;
    
    try {
        const files = await pfs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isFile()) {
                const ext = path.extname(file.name).toLowerCase();
                // 只处理 JSON 文件
                if (ext === '.json') {
                    const relativePath = path.relative(process.cwd(), fullPath);
                    const fileName = getFileName(fullPath);
                    
                    // 使用与 ui-manager.js 相同的 isPathUsed 函数检查是否已关联
                    const isLinked = isPathUsed(relativePath, fileName, linkedPaths);
                    
                    if (!isLinked) {
                        // 使用公共方法创建新的提供商配置
                        const newProvider = createProviderConfig({
                            credPathKey,
                            credPath: formatSystemPath(relativePath),
                            defaultCheckModel,
                            needsProjectId
                        });
                        
                        newProviders.push(newProvider);
                    }
                }
            } else if (file.isDirectory()) {
                // 递归扫描子目录（限制深度为 3 层）
                const relativePath = path.relative(process.cwd(), fullPath);
                const depth = relativePath.split(path.sep).length;
                if (depth < 5) { // configs/{provider}/subfolder/subsubfolder
                    await scanProviderDirectory(fullPath, linkedPaths, newProviders, options);
                }
            }
        }
    } catch (error) {
        console.warn(`[Auto-Link] Failed to scan directory ${dirPath}: ${error.message}`);
    }
}

// 注意：isValidOAuthCredentials 已移至 provider-utils.js 公共模块

/**
 * Initialize API services and provider pool manager
 * @param {Object} config - The server configuration
 * @returns {Promise<Object>} The initialized services
 */
export async function initApiService(config) {
    // 自动关联 configs 目录中的配置文件到对应的提供商
    console.log('[Initialization] Checking for unlinked provider configs...');
    await autoLinkProviderConfigs(config);
    
    if (config.providerPools && Object.keys(config.providerPools).length > 0) {
        providerPoolManager = new ProviderPoolManager(config.providerPools, {
            globalConfig: config,
            maxErrorCount: config.MAX_ERROR_COUNT ?? 3
        });
        console.log('[Initialization] ProviderPoolManager initialized with configured pools.');
        // 健康检查将在服务器完全启动后执行
    } else {
        console.log('[Initialization] No provider pools configured. Using single provider mode.');
    }

    // Initialize configured service adapters at startup
    // 对于未纳入号池的提供者，提前初始化以避免首个请求的额外延迟
    const providersToInit = new Set();
    if (Array.isArray(config.DEFAULT_MODEL_PROVIDERS)) {
        config.DEFAULT_MODEL_PROVIDERS.forEach((provider) => providersToInit.add(provider));
    }
    if (config.providerPools) {
        Object.keys(config.providerPools).forEach((provider) => providersToInit.add(provider));
    }
    if (providersToInit.size === 0) {
        const { ALL_MODEL_PROVIDERS } = await import('./config-manager.js');
        ALL_MODEL_PROVIDERS.forEach((provider) => providersToInit.add(provider));
    }

    for (const provider of providersToInit) {
        const { ALL_MODEL_PROVIDERS } = await import('./config-manager.js');
        if (!ALL_MODEL_PROVIDERS.includes(provider)) {
            console.warn(`[Initialization Warning] Skipping unknown model provider '${provider}' during adapter initialization.`);
            continue;
        }
        if (config.providerPools && config.providerPools[provider] && config.providerPools[provider].length > 0) {
            // 由号池管理器负责按需初始化
            continue;
        }
        try {
            console.log(`[Initialization] Initializing single service adapter for ${provider}...`);
            getServiceAdapter({ ...config, MODEL_PROVIDER: provider });
        } catch (error) {
            console.warn(`[Initialization Warning] Failed to initialize single service adapter for ${provider}: ${error.message}`);
        }
    }
    return serviceInstances; // Return the collection of initialized service instances
}

/**
 * Get API service adapter, considering provider pools
 * @param {Object} config - The current request configuration
 * @param {string} [requestedModel] - Optional. The model name to filter providers by.
 * @param {Object} [options] - Optional. Additional options.
 * @param {boolean} [options.skipUsageCount] - Optional. If true, skip incrementing usage count.
 * @returns {Promise<Object>} The API service adapter
 */
export async function getApiService(config, requestedModel = null, options = {}) {
    let serviceConfig = config;
    if (providerPoolManager && config.providerPools && config.providerPools[config.MODEL_PROVIDER]) {
        // 如果有号池管理器，并且当前模型提供者类型有对应的号池，则从号池中选择一个提供者配置
        const selectedProviderConfig = providerPoolManager.selectProvider(config.MODEL_PROVIDER, requestedModel, { skipUsageCount: true });
        if (selectedProviderConfig) {
            // 合并选中的提供者配置到当前请求的 config 中
            serviceConfig = deepmerge(config, selectedProviderConfig);
            delete serviceConfig.providerPools; // 移除 providerPools 属性
            config.uuid = serviceConfig.uuid;
            console.log(`[API Service] Using pooled configuration for ${config.MODEL_PROVIDER}: ${serviceConfig.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}`);
        } else {
            console.warn(`[API Service] No healthy provider found in pool for ${config.MODEL_PROVIDER}${requestedModel ? ` supporting model: ${requestedModel}` : ''}. Falling back to main config.`);
        }
    }
    return getServiceAdapter(serviceConfig);
}

/**
 * Get the provider pool manager instance
 * @returns {Object} The provider pool manager
 */
export function getProviderPoolManager() {
    return providerPoolManager;
}

/**
 * Mark provider as unhealthy
 * @param {string} provider - The model provider
 * @param {Object} providerInfo - Provider information including uuid
 */
export function markProviderUnhealthy(provider, providerInfo) {
    if (providerPoolManager) {
        providerPoolManager.markProviderUnhealthy(provider, providerInfo);
    }
}