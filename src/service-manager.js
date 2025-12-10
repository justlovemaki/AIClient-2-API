import { getServiceAdapter, serviceInstances } from './adapter.js';
import { ProviderPoolManager } from './provider-pool-manager.js';
import deepmerge from 'deepmerge';
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as path from 'path';

// 存储 ProviderPoolManager 实例
let providerPoolManager = null;

/**
 * 生成 UUID
 * @returns {string} UUID 字符串
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 扫描 configs/kiro 目录并自动关联未关联的配置文件到 claude-kiro-oauth 提供商
 * @param {Object} config - 服务器配置对象
 * @returns {Promise<Object>} 更新后的 providerPools 对象
 */
async function autoLinkKiroConfigs(config) {
    const kiroConfigsPath = path.join(process.cwd(), 'configs', 'kiro');
    const providerType = 'claude-kiro-oauth';
    const defaultCheckModel = 'claude-haiku-4-5';
    
    // 确保 providerPools 对象存在
    if (!config.providerPools) {
        config.providerPools = {};
    }
    
    // 确保 claude-kiro-oauth 数组存在
    if (!config.providerPools[providerType]) {
        config.providerPools[providerType] = [];
    }
    
    // 检查 configs/kiro 目录是否存在
    if (!fs.existsSync(kiroConfigsPath)) {
        console.log('[Auto-Link] configs/kiro directory not found, skipping auto-link');
        return config.providerPools;
    }
    
    // 获取已关联的配置文件路径集合
    const linkedPaths = new Set();
    for (const provider of config.providerPools[providerType]) {
        if (provider.KIRO_OAUTH_CREDS_FILE_PATH) {
            // 标准化路径以便比较
            const normalizedPath = provider.KIRO_OAUTH_CREDS_FILE_PATH.replace(/\\/g, '/');
            linkedPaths.add(normalizedPath);
            linkedPaths.add(normalizedPath.replace(/^\.\//, ''));
            if (!normalizedPath.startsWith('./')) {
                linkedPaths.add('./' + normalizedPath);
            }
        }
    }
    
    // 递归扫描 configs/kiro 目录
    const newProviders = [];
    await scanKiroDirectory(kiroConfigsPath, linkedPaths, newProviders, defaultCheckModel);
    
    // 如果有新的配置文件需要关联
    if (newProviders.length > 0) {
        config.providerPools[providerType].push(...newProviders);
        
        // 保存更新后的 provider_pools.json
        const filePath = config.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
        try {
            await pfs.writeFile(filePath, JSON.stringify(config.providerPools, null, 2), 'utf8');
            console.log(`[Auto-Link] Added ${newProviders.length} new Kiro config(s) to ${providerType}`);
            newProviders.forEach(p => {
                console.log(`  - ${p.KIRO_OAUTH_CREDS_FILE_PATH}`);
            });
        } catch (error) {
            console.error(`[Auto-Link] Failed to save provider_pools.json: ${error.message}`);
        }
    } else {
        console.log('[Auto-Link] No new Kiro configs to link');
    }
    
    return config.providerPools;
}

/**
 * 递归扫描 Kiro 配置目录
 * @param {string} dirPath - 目录路径
 * @param {Set} linkedPaths - 已关联的路径集合
 * @param {Array} newProviders - 新提供商配置数组
 * @param {string} defaultCheckModel - 默认检测模型
 */
async function scanKiroDirectory(dirPath, linkedPaths, newProviders, defaultCheckModel) {
    try {
        const files = await pfs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isFile()) {
                const ext = path.extname(file.name).toLowerCase();
                // 只处理 JSON 文件
                if (ext === '.json') {
                    const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
                    
                    // 检查是否已关联
                    const isLinked = linkedPaths.has(relativePath) ||
                                    linkedPaths.has('./' + relativePath) ||
                                    linkedPaths.has(relativePath.replace(/^\.\//, ''));
                    
                    if (!isLinked) {
                        // 验证是否是有效的 OAuth 凭据文件
                        const isValid = await isValidKiroCredentials(fullPath);
                        if (isValid) {
                            // 创建新的提供商配置
                            const newProvider = {
                                KIRO_OAUTH_CREDS_FILE_PATH: './' + relativePath,
                                uuid: generateUUID(),
                                checkModelName: defaultCheckModel,
                                checkHealth: true,
                                isHealthy: true,
                                isDisabled: false,
                                lastUsed: null,
                                usageCount: 0,
                                errorCount: 0,
                                lastErrorTime: null,
                                lastHealthCheckTime: null,
                                lastHealthCheckModel: null,
                                lastErrorMessage: null
                            };
                            newProviders.push(newProvider);
                        }
                    }
                }
            } else if (file.isDirectory()) {
                // 递归扫描子目录（限制深度为 3 层）
                const relativePath = path.relative(process.cwd(), fullPath);
                const depth = relativePath.split(path.sep).length;
                if (depth < 5) { // configs/kiro/subfolder/subsubfolder
                    await scanKiroDirectory(fullPath, linkedPaths, newProviders, defaultCheckModel);
                }
            }
        }
    } catch (error) {
        console.warn(`[Auto-Link] Failed to scan directory ${dirPath}: ${error.message}`);
    }
}

/**
 * 验证文件是否是有效的 Kiro OAuth 凭据文件
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>} 是否有效
 */
async function isValidKiroCredentials(filePath) {
    try {
        const content = await pfs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(content);
        
        // 检查是否包含 OAuth 相关字段
        // Kiro 凭据通常包含 access_token, refresh_token, client_id 等字段
        if (jsonData.access_token || jsonData.refresh_token || 
            jsonData.client_id || jsonData.client_secret ||
            jsonData.token || jsonData.credentials) {
            return true;
        }
        
        // 也可能是包含嵌套结构的凭据文件
        if (jsonData.installed || jsonData.web) {
            return true;
        }
        
        return false;
    } catch (error) {
        // 如果无法解析，认为不是有效的凭据文件
        return false;
    }
}

/**
 * Initialize API services and provider pool manager
 * @param {Object} config - The server configuration
 * @returns {Promise<Object>} The initialized services
 */
export async function initApiService(config) {
    // 自动关联 configs/kiro 目录中的配置文件
    console.log('[Initialization] Checking for unlinked Kiro configs...');
    await autoLinkKiroConfigs(config);
    
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
        const selectedProviderConfig = providerPoolManager.selectProvider(config.MODEL_PROVIDER, requestedModel, options);
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