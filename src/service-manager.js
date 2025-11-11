import { getServiceAdapter, serviceInstances } from './adapter.js';
import { ProviderPoolManager } from './provider-pool-manager.js';
import deepmerge from 'deepmerge';

// 存储 ProviderPoolManager 实例
let providerPoolManager = null;

/**
 * Initialize API services and provider pool manager
 * @param {Object} config - The server configuration
 * @returns {Promise<Object>} The initialized services
 */
export async function initApiService(config) {
    if (config.providerPools && Object.keys(config.providerPools).length > 0) {
        providerPoolManager = new ProviderPoolManager(config.providerPools, { globalConfig: config });
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
 * @returns {Promise<Object>} The API service adapter
 */
export async function getApiService(config) {
    let serviceConfig = config;
    if (providerPoolManager && config.providerPools && config.providerPools[config.MODEL_PROVIDER]) {
        // 如果有号池管理器，并且当前模型提供者类型有对应的号池，则从号池中选择一个提供者配置
        const selectedProviderConfig = providerPoolManager.selectProvider(config.MODEL_PROVIDER);
        if (selectedProviderConfig) {
            // 合并选中的提供者配置到当前请求的 config 中
            serviceConfig = deepmerge(config, selectedProviderConfig);
            delete serviceConfig.providerPools; // 移除 providerPools 属性
            config.uuid = serviceConfig.uuid;
            console.log(`[API Service] Using pooled configuration for ${config.MODEL_PROVIDER}: ${serviceConfig.uuid}`);
        } else {
            console.warn(`[API Service] No healthy provider found in pool for ${config.MODEL_PROVIDER}. Falling back to main config.`);
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