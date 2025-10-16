import * as fs from 'fs'; // Import fs module
import { getServiceAdapter } from './adapter.js';
import { MODEL_PROVIDER } from './common.js';

/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.providerStatus = {}; // Tracks health and usage for each provider instance
        this.roundRobinIndex = {}; // Tracks the current index for round-robin selection for each provider type
        this.maxErrorCount = options.maxErrorCount || 3; // Default to 1 errors before marking unhealthy
        this.healthCheckInterval = options.healthCheckInterval || 30 * 60 * 1000; // Default to 30 minutes
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
                if (providerConfig.lastErrorTime && typeof providerConfig.lastErrorTime === 'string') {
                    // Keep as string (ISOString)
                    providerConfig.lastErrorTime = providerConfig.lastErrorTime;
                } else if (providerConfig.lastErrorTime === undefined) {
                    providerConfig.lastErrorTime = null;
                } else if (providerConfig.lastErrorTime instanceof Date) {
                    providerConfig.lastErrorTime = providerConfig.lastErrorTime.toISOString();
                }

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

        let currentIndex = this.roundRobinIndex[providerType] || 0;
        let selected = null;

        // Iterate through healthy providers starting from the current index
        for (let i = 0; i < healthyProviders.length; i++) {
            const providerIndex = (currentIndex + i) % healthyProviders.length;
            const potentialProvider = healthyProviders[providerIndex];

            // For now, we simply select the next healthy provider in a round-robin fashion.
            // More advanced logic (e.g., considering usage, recent errors, etc.) can be added here.
            selected = potentialProvider;
            this.roundRobinIndex[providerType] = (providerIndex + 1) % healthyProviders.length; // Update the index for the next call
            break; // Found a provider, break the loop
        }
        
        if (selected) {
            selected.config.lastUsed = new Date().toISOString();
            selected.config.usageCount++; // Increment usage count

            console.log(`[ProviderPoolManager] Selected provider for ${providerType} (round-robin): ${JSON.stringify(selected.config)}`);
            this._saveProviderPoolsToJson(providerType); // Persist changes
            return selected.config;
        }

        return null;
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
                this._saveProviderPoolsToJson(providerType); // Persist changes
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
                this._saveProviderPoolsToJson(providerType); // Persist changes
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
            const tempConfig = { ...providerConfig, MODEL_PROVIDER: providerType };
            const serviceAdapter = getServiceAdapter(tempConfig);
            
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