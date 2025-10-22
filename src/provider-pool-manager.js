import * as fs from 'fs'; // Import fs module
import { getServiceAdapter } from './adapter.js';
import { MODEL_PROVIDER } from './common.js';

/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.globalConfig = options.globalConfig || {}; // 存储全局配置
        this.providerStatus = {}; // Tracks health and usage for each provider instance
        this.roundRobinIndex = {}; // Tracks the current index for round-robin selection for each provider type
        this.maxErrorCount = options.maxErrorCount || 3; // Default to 1 errors before marking unhealthy
        this.healthCheckInterval = options.healthCheckInterval || 30 * 60 * 1000; // Default to 30 minutes
        
        // 优化1: 添加防抖机制，避免频繁的文件 I/O 操作
        this.saveDebounceTime = options.saveDebounceTime || 1000; // 默认1秒防抖
        this.saveTimer = null;
        this.pendingSaves = new Set(); // 记录待保存的 providerType
        
        this.initializeProviderStatus();
    }

    /**
     * Initializes the status for each provider in the pools.
     * Initially, all providers are considered healthy and have zero usage.
     */
    initializeProviderStatus() {
        for (const providerType in this.providerPools) {
            this.providerStatus[providerType] = [];
            this.roundRobinIndex[providerType] = 0; // Initialize round-robin index for each type
            this.providerPools[providerType].forEach((providerConfig) => {
                // Ensure initial health and usage stats are present in the config
                providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
                providerConfig.lastUsed = providerConfig.lastUsed !== undefined ? providerConfig.lastUsed : null;
                providerConfig.usageCount = providerConfig.usageCount !== undefined ? providerConfig.usageCount : 0;
                providerConfig.errorCount = providerConfig.errorCount !== undefined ? providerConfig.errorCount : 0;
                
                // 优化2: 简化 lastErrorTime 处理逻辑
                providerConfig.lastErrorTime = providerConfig.lastErrorTime instanceof Date
                    ? providerConfig.lastErrorTime.toISOString()
                    : (providerConfig.lastErrorTime || null);

                this.providerStatus[providerType].push({
                    config: providerConfig,
                    uuid: providerConfig.uuid, // Still keep uuid at the top level for easy access
                });
            });
        }
        console.log('[ProviderPoolManager] Initialized provider statuses: ok');
    }

    /**
     * Selects a provider from the pool for a given provider type.
     * Currently uses a simple round-robin for healthy providers.
     * @param {string} providerType - The type of provider to select (e.g., 'gemini-cli', 'openai-custom').
     * @returns {object|null} The selected provider's configuration, or null if no healthy provider is found.
     */
    selectProvider(providerType) {
        const availableProviders = this.providerStatus[providerType] || [];
        const healthyProviders = availableProviders.filter(p => p.config.isHealthy);

        if (healthyProviders.length === 0) {
            console.warn(`[ProviderPoolManager] No healthy providers available for type: ${providerType}`);
            return null;
        }

        // 优化3: 简化轮询逻辑，移除不必要的循环
        const currentIndex = this.roundRobinIndex[providerType] || 0;
        const providerIndex = currentIndex % healthyProviders.length;
        const selected = healthyProviders[providerIndex];
        
        // 更新下次轮询的索引
        this.roundRobinIndex[providerType] = (providerIndex + 1) % healthyProviders.length;
        
        // 更新使用信息
        selected.config.lastUsed = new Date().toISOString();
        selected.config.usageCount++;

        console.log(`[ProviderPoolManager] Selected provider for ${providerType} (round-robin): ${JSON.stringify(selected.config)}`);
        
        // 优化1: 使用防抖保存
        this._debouncedSave(providerType);
        
        return selected.config;
    }

    /**
     * Marks a provider as unhealthy (e.g., after an API error).
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     */
    markProviderUnhealthy(providerType, providerConfig) {
        const pool = this.providerStatus[providerType];
        if (pool) {
            const provider = pool.find(p => p.uuid === providerConfig.uuid);
            if (provider) {
                provider.config.errorCount++;
                provider.config.lastErrorTime = new Date().toISOString(); // Update last error time in config

                if (provider.config.errorCount >= this.maxErrorCount) {
                    provider.config.isHealthy = false;
                    console.warn(`[ProviderPoolManager] Marked provider as unhealthy: ${JSON.stringify(providerConfig)} for type ${providerType}. Total errors: ${provider.config.errorCount}`);
                } else {
                    console.warn(`[ProviderPoolManager] Provider ${JSON.stringify(providerConfig)} for type ${providerType} error count: ${provider.config.errorCount}/${this.maxErrorCount}. Still healthy.`);
                }
                
                // 优化1: 使用防抖保存
                this._debouncedSave(providerType);
            }
        }
    }

    /**
     * Marks a provider as healthy.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     */
    markProviderHealthy(providerType, providerConfig) {
        const pool = this.providerStatus[providerType];
        if (pool) {
            const provider = pool.find(p => p.uuid === providerConfig.uuid);
            if (provider) {
                provider.config.isHealthy = true;
                provider.config.errorCount = 0; // Reset error count on health recovery
                provider.config.lastErrorTime = null; // Reset lastErrorTime when healthy
                console.log(`[ProviderPoolManager] Marked provider as healthy: ${JSON.stringify(providerConfig)} for type ${providerType}`);
                
                // 优化1: 使用防抖保存
                this._debouncedSave(providerType);
            }
        }
    }

    /**
     * Performs health checks on all providers in the pool.
     * This method would typically be called periodically (e.g., via cron job).
     */
    async performHealthChecks() {
        console.log('[ProviderPoolManager] Performing health checks on all providers...');
        const now = new Date();
        for (const providerType in this.providerStatus) {
            for (const providerStatus of this.providerStatus[providerType]) {
                const providerConfig = providerStatus.config;

                // Only attempt to health check unhealthy providers after a certain interval
                if (!providerStatus.config.isHealthy && providerStatus.config.lastErrorTime &&
                    (now.getTime() - new Date(providerStatus.config.lastErrorTime).getTime() < this.healthCheckInterval)) {
                    console.log(`[ProviderPoolManager] Skipping health check for ${JSON.stringify(providerConfig)} (${providerType}). Last error too recent.`);
                    continue;
                }

                try {
                    // Perform actual health check based on provider type
                    const isHealthy = await this._checkProviderHealth(providerType, providerConfig);
                    
                    if (isHealthy) {
                        if (!providerStatus.config.isHealthy) {
                            // Provider was unhealthy but is now healthy
                            this.markProviderHealthy(providerType, providerConfig);
                            console.log(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}): Marked Healthy (actual check)`);
                        } else {
                            // Provider was already healthy and still is
                            console.log(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}): Still Healthy`);
                        }
                    } else {
                        // Provider is not healthy
                        console.warn(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}) failed: Provider is not responding correctly.`);
                        this.markProviderUnhealthy(providerType, providerConfig);
                    }

                } catch (error) {
                    console.error(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}) failed: ${error.message}`);
                    // If a health check fails, mark it unhealthy, which will update error count and lastErrorTime
                    this.markProviderUnhealthy(providerType, providerConfig);
                }
            }
        }
    }

    /**
     * Performs an actual health check for a specific provider.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to check.
     * @returns {Promise<boolean>} - True if the provider is healthy, false otherwise.
     */
    async _checkProviderHealth(providerType, providerConfig) {
        try {
            // Create a temporary service adapter for health check
            // 合并全局配置和 provider 配置
            const tempConfig = {
                // ...this.globalConfig,
                ...providerConfig,
                MODEL_PROVIDER: providerType,
                USE_SYSTEM_PROXY_GEMINI: this.globalConfig.USE_SYSTEM_PROXY_GEMINI,
                USE_SYSTEM_PROXY_OPENAI: this.globalConfig.USE_SYSTEM_PROXY_OPENAI,
                USE_SYSTEM_PROXY_CLAUDE: this.globalConfig.USE_SYSTEM_PROXY_CLAUDE,
                USE_SYSTEM_PROXY_QWEN: this.globalConfig.USE_SYSTEM_PROXY_QWEN,
                USE_SYSTEM_PROXY_KIRO: this.globalConfig.USE_SYSTEM_PROXY_KIRO,
            };
            const serviceAdapter = getServiceAdapter(tempConfig);
            if(!providerConfig.checkHealth){
                return true;
            }
            
            // Determine a suitable model name for health check
            // First, try to get it from the provider configuration
            let modelName = providerConfig.checkModelName;
            
            // If not specified in config, use default model names based on provider type
            if (!modelName) {
                switch (providerType) {
                    case MODEL_PROVIDER.GEMINI_CLI:
                        modelName = 'gemini-2.5-flash'; // Example model name for Gemini
                        break;
                    case MODEL_PROVIDER.OPENAI_CUSTOM:
                        modelName = 'gpt-3.5-turbo'; // Example model name for OpenAI
                        break;
                    case MODEL_PROVIDER.CLAUDE_CUSTOM:
                        modelName = 'claude-3-7-sonnet-20250219'; // Example model name for Claude
                        break;
                    case MODEL_PROVIDER.KIRO_API:
                        modelName = 'claude-3-7-sonnet-20250219'; // Example model name for Kiro API
                        break;
                    case MODEL_PROVIDER.QWEN_API:
                        modelName = 'qwen3-coder-flash'; // Example model name for Qwen
                        break;
                    case MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES:
                        modelName = 'gpt-5-low'; // Example model name for OpenAI Custom Responses
                        break;
                    default:
                        console.warn(`[ProviderPoolManager] Unknown provider type for health check: ${providerType}`);
                        return false;
                }
            }
            
            // Perform a lightweight API call to check health
            const healthCheckRequest = {
                contents: [{
                    role: 'user',
                    parts: [{ text: 'Hello, are you ok?' }]
                }]
            };
            
            if (providerType === MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES) {
                healthCheckRequest.input = [{ role: 'user', content: 'Hello, are you ok?' }];
                healthCheckRequest.model = modelName;
                delete healthCheckRequest.contents;
            }
            
            // For OpenAI and Claude providers, we need a different request format
            if (providerType === MODEL_PROVIDER.OPENAI_CUSTOM || providerType === MODEL_PROVIDER.CLAUDE_CUSTOM || providerType === MODEL_PROVIDER.KIRO_API || providerType === MODEL_PROVIDER.QWEN_API) {
                healthCheckRequest.messages = [{ role: 'user', content: 'Hello, are you ok?' }];
                healthCheckRequest.model = modelName;
                delete healthCheckRequest.contents;
            }
            
            // console.log(`[ProviderPoolManager] Health check request for ${modelName}: ${JSON.stringify(healthCheckRequest)}`);
            await serviceAdapter.generateContent(modelName, healthCheckRequest);
            return true;
        } catch (error) {
            console.error(`[ProviderPoolManager] Health check failed for ${providerType}: ${error.message}`);
            return false;
        }
    }

    /**
     * 优化1: 添加防抖保存方法
     * 延迟保存操作，避免频繁的文件 I/O
     * @private
     */
    _debouncedSave(providerType) {
        // 将待保存的 providerType 添加到集合中
        this.pendingSaves.add(providerType);
        
        // 清除之前的定时器
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // 设置新的定时器
        this.saveTimer = setTimeout(() => {
            this._flushPendingSaves();
        }, this.saveDebounceTime);
    }
    
    /**
     * 优化1: 批量保存所有待保存的 providerType
     * @private
     */
    async _flushPendingSaves() {
        const typesToSave = Array.from(this.pendingSaves);
        this.pendingSaves.clear();
        this.saveTimer = null;
        
        for (const providerType of typesToSave) {
            await this._saveProviderPoolsToJson(providerType);
        }
    }

    /**
     * Saves the current provider pools configuration to the JSON file.
     * @private
     */
    async _saveProviderPoolsToJson(providerTypeToUpdate) {
        try {
            const filePath = 'provider_pools.json';
            let currentPools = {};
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                currentPools = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    console.log('[ProviderPoolManager] provider_pools.json does not exist, creating new file.');
                } else {
                    throw readError;
                }
            }

            if (this.providerStatus[providerTypeToUpdate]) {
                currentPools[providerTypeToUpdate] = this.providerStatus[providerTypeToUpdate].map(p => {
                    // Convert Date objects to ISOString if they exist
                    if (p.config.lastUsed instanceof Date) {
                        p.config.lastUsed = p.config.lastUsed.toISOString();
                    }
                    if (p.config.lastErrorTime instanceof Date) {
                        p.config.lastErrorTime = p.config.lastErrorTime.toISOString();
                    }
                    return p.config;
                });
            } else {
                console.warn(`[ProviderPoolManager] Attempted to save unknown providerType: ${providerTypeToUpdate}`);
            }
            
            await fs.promises.writeFile(filePath, JSON.stringify(currentPools, null, 2), 'utf8');
            console.log(`[ProviderPoolManager] provider_pools.json for ${providerTypeToUpdate} updated successfully.`);
        } catch (error) {
            console.error('[ProviderPoolManager] Failed to write provider_pools.json:', error);
        }
    }

}