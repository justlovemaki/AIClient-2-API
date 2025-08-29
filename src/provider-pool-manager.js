/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.providerStatus = {}; // Tracks health and usage for each provider instance
        this.roundRobinIndex = {}; // Tracks the current index for round-robin selection for each provider type
        this.maxErrorCount = options.maxErrorCount || 1; // Default to 1 errors before marking unhealthy
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
            this.providerPools[providerType].forEach((providerConfig, index) => {
                this.providerStatus[providerType].push({
                    config: providerConfig,
                    uuid: providerConfig.uuid,
                    isHealthy: true,
                    lastUsed: null,
                    usageCount: 0,
                    errorCount: 0,
                    lastErrorTime: null, // New: Timestamp of the last error
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
        const healthyProviders = availableProviders.filter(p => p.isHealthy);

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
            selected.lastUsed = new Date();
            selected.usageCount++; // Increment usage count
            console.log(`[ProviderPoolManager] Selected provider for ${providerType} (round-robin): ${JSON.stringify(selected.config)}`);
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
                provider.errorCount++;
                provider.lastErrorTime = new Date(); // Update last error time

                if (provider.errorCount >= this.maxErrorCount) {
                    provider.isHealthy = false;
                    console.warn(`[ProviderPoolManager] Marked provider as unhealthy: ${JSON.stringify(providerConfig)} for type ${providerType}. Total errors: ${provider.errorCount}`);
                } else {
                    console.warn(`[ProviderPoolManager] Provider ${JSON.stringify(providerConfig)} for type ${providerType} error count: ${provider.errorCount}/${this.maxErrorCount}. Still healthy.`);
                }
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
            const provider = pool.find(p => p.uuid === providerConfig.uuid);a
            if (provider) {
                provider.isHealthy = true;
                provider.errorCount = 0; // Reset error count on health recovery
                console.log(`[ProviderPoolManager] Marked provider as healthy: ${JSON.stringify(providerConfig)} for type ${providerType}`);
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
                if (!providerStatus.isHealthy && providerStatus.lastErrorTime &&
                    (now.getTime() - providerStatus.lastErrorTime.getTime() < this.healthCheckInterval)) {
                    console.log(`[ProviderPoolManager] Skipping health check for ${JSON.stringify(providerConfig)} (${providerType}). Last error too recent.`);
                    continue;
                }

                try {
                    // TODO: Implement actual health check logic for each provider type
                    // For now, if a provider was unhealthy and enough time has passed,
                    // we optimistically mark it healthy and reset error count.
                    // A more robust system would involve actual API calls or pings here.
                    if (!providerStatus.isHealthy) {
                         // Only reset and mark healthy if it was unhealthy and we are attempting a check after interval
                        this.markProviderHealthy(providerType, providerConfig);
                        console.log(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}): Marked Healthy (re-evaluation)`);
                    } else {
                        // For already healthy providers, just log or perform a lighter check if needed
                        console.log(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}): Still Healthy`);
                    }

                } catch (error) {
                    console.error(`[ProviderPoolManager] Health check for ${JSON.stringify(providerConfig)} (${providerType}) failed: ${error.message}`);
                    // If a health check fails, mark it unhealthy, which will update error count and lastErrorTime
                    this.markProviderUnhealthy(providerType, providerConfig);
                }
            }
        }
    }
}