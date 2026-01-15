import * as fs from 'fs'; // Import fs module
import { getServiceAdapter } from './adapter.js';
import { MODEL_PROVIDER, getProtocolPrefix } from '../utils/common.js';
import { getProviderModels } from './provider-models.js';
import { CredentialCacheManager } from '../utils/credential-cache-manager.js';
import axios from 'axios';

/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    // 默认健康检查模型配置
    // 键名必须与 MODEL_PROVIDER 常量值一致
    static DEFAULT_HEALTH_CHECK_MODELS = {
        'gemini-cli-oauth': 'gemini-2.5-flash',
        'gemini-antigravity': 'gemini-2.5-flash',
        'openai-custom': 'gpt-3.5-turbo',
        'claude-custom': 'claude-3-7-sonnet-20250219',
        'claude-kiro-oauth': 'claude-haiku-4-5',
        'openai-qwen-oauth': 'qwen3-coder-flash',
        'openaiResponses-custom': 'gpt-4o-mini'
    };

    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.globalConfig = options.globalConfig || {}; // 存储全局配置
        this.providerStatus = {}; // Tracks health and usage for each provider instance
        this.roundRobinIndex = {}; // Tracks the current index for round-robin selection for each provider type
        // 使用 ?? 运算符确保 0 也能被正确设置，而不是被 || 替换为默认值
        this.maxErrorCount = options.maxErrorCount ?? 3; // Default to 3 errors before marking unhealthy
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000; // Default to 10 minutes
        
        // 日志级别控制
        this.logLevel = options.logLevel || 'info'; // 'debug', 'info', 'warn', 'error'
        
        // 添加防抖机制，避免频繁的文件 I/O 操作
        this.saveDebounceTime = options.saveDebounceTime || 1000; // 默认1秒防抖
        this.saveTimer = null;
        this.pendingSaves = new Set(); // 记录待保存的 providerType
        
        // Fallback 链配置
        this.fallbackChain = options.globalConfig?.providerFallbackChain || {};
        
        // Model Fallback 映射配置
        this.modelFallbackMapping = options.globalConfig?.modelFallbackMapping || {};

        // 并发控制：每个 providerType 的选择锁
        // 用于确保 selectProvider 的排序和更新操作是原子的
        this._selectionLocks = {};

        this.initializeProviderStatus();
    }

    /**
     * 日志输出方法，支持日志级别控制
     * @private
     */
    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            const logMethod = level === 'debug' ? 'log' : level;
            console[logMethod](`[ProviderPoolManager] ${message}`);
        }
    }

    /**
     * 查找指定的 provider
     * @private
     */
    _findProvider(providerType, uuid) {
        if (!providerType || !uuid) {
            this._log('error', `Invalid parameters: providerType=${providerType}, uuid=${uuid}`);
            return null;
        }
        const pool = this.providerStatus[providerType];
        return pool?.find(p => p.uuid === uuid) || null;
    }

    /**
     * Initializes the status for each provider in the pools.
     * Initially, all providers are considered healthy and have zero usage.
     */
    initializeProviderStatus() {
        for (const providerType in this.providerPools) {
            this.providerStatus[providerType] = [];
            this.roundRobinIndex[providerType] = 0; // Initialize round-robin index for each type
            this._selectionLocks[providerType] = Promise.resolve(); // 初始化选择锁
            this.providerPools[providerType].forEach((providerConfig) => {
                // Ensure initial health and usage stats are present in the config
                providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
                providerConfig.isDisabled = providerConfig.isDisabled !== undefined ? providerConfig.isDisabled : false;
                providerConfig.lastUsed = providerConfig.lastUsed !== undefined ? providerConfig.lastUsed : null;
                providerConfig.usageCount = providerConfig.usageCount !== undefined ? providerConfig.usageCount : 0;
                providerConfig.errorCount = providerConfig.errorCount !== undefined ? providerConfig.errorCount : 0;
                
                // 优化2: 简化 lastErrorTime 处理逻辑
                providerConfig.lastErrorTime = providerConfig.lastErrorTime instanceof Date
                    ? providerConfig.lastErrorTime.toISOString()
                    : (providerConfig.lastErrorTime || null);
                
                // 健康检测相关字段
                providerConfig.lastHealthCheckTime = providerConfig.lastHealthCheckTime || null;
                providerConfig.lastHealthCheckModel = providerConfig.lastHealthCheckModel || null;
                providerConfig.lastErrorMessage = providerConfig.lastErrorMessage || null;
                providerConfig.customName = providerConfig.customName || null;

                this.providerStatus[providerType].push({
                    config: providerConfig,
                    uuid: providerConfig.uuid, // Still keep uuid at the top level for easy access
                });
            });
        }
        this._log('info', `Initialized provider statuses: ok (maxErrorCount: ${this.maxErrorCount})`);
    }

    /**
     * Selects a provider from the pool for a given provider type.
     * Currently uses a simple round-robin for healthy providers.
     * If requestedModel is provided, providers that don't support the model will be excluded.
     *
     * 注意：此方法现在返回 Promise，使用链式锁确保并发安全。
     *
     * @param {string} providerType - The type of provider to select (e.g., 'gemini-cli', 'openai-custom').
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @returns {Promise<object|null>} The selected provider's configuration, or null if no healthy provider is found.
     */
    selectProvider(providerType, requestedModel = null, options = {}) {
        // 参数校验
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return Promise.resolve(null);
        }

        // 使用链式锁确保同一 providerType 的选择操作串行执行
        // 这样可以避免并发场景下多个请求选择到同一个 provider
        const currentLock = this._selectionLocks[providerType] || Promise.resolve();
        
        const selectionPromise = currentLock.then(() => {
            return this._doSelectProvider(providerType, requestedModel, options);
        });
        
        // 更新锁，确保下一个请求等待当前请求完成
        // 使用 catch 确保即使出错也不会阻塞后续请求
        this._selectionLocks[providerType] = selectionPromise.catch(() => {});
        
        return selectionPromise;
    }

    /**
     * 实际执行 provider 选择的内部方法（同步执行，由锁保护）
     * @private
     */
    _doSelectProvider(providerType, requestedModel, options) {
        const availableProviders = this.providerStatus[providerType] || [];
        
        // 检查并恢复已到恢复时间的提供商
        this._checkAndRecoverScheduledProviders(providerType);
        
        let availableAndHealthyProviders = availableProviders.filter(p =>
            p.config.isHealthy && !p.config.isDisabled
        );

        // 如果指定了模型，则排除不支持该模型的提供商
        if (requestedModel) {
            const modelFilteredProviders = availableAndHealthyProviders.filter(p => {
                // 如果提供商没有配置 notSupportedModels，则认为它支持所有模型
                if (!p.config.notSupportedModels || !Array.isArray(p.config.notSupportedModels)) {
                    return true;
                }
                // 检查 notSupportedModels 数组中是否包含请求的模型，如果包含则排除
                return !p.config.notSupportedModels.includes(requestedModel);
            });

            if (modelFilteredProviders.length === 0) {
                this._log('warn', `No available providers for type: ${providerType} that support model: ${requestedModel}`);
                return null;
            }

            availableAndHealthyProviders = modelFilteredProviders;
            this._log('debug', `Filtered ${modelFilteredProviders.length} providers supporting model: ${requestedModel}`);
        }

        if (availableAndHealthyProviders.length === 0) {
            this._log('warn', `No available and healthy providers for type: ${providerType}`);
            return null;
        }

        // 改进：使用"最久未被使用"策略（LRU）代替取模轮询
        // 这样即使可用列表长度动态变化，也能确保每个账号被平均轮到
        const selected = availableAndHealthyProviders.sort((a, b) => {
            const timeA = a.config.lastUsed ? new Date(a.config.lastUsed).getTime() : 0;
            const timeB = b.config.lastUsed ? new Date(b.config.lastUsed).getTime() : 0;
            // 优先选择从未用过的，或者最久没用的
            if (timeA !== timeB) return timeA - timeB;
            // 如果时间相同，使用使用次数辅助判断
            return (a.config.usageCount || 0) - (b.config.usageCount || 0);
        })[0];

        // 始终更新 lastUsed（确保 LRU 策略生效，避免并发请求选到同一个 provider）
        // usageCount 只在请求成功后才增加（由 skipUsageCount 控制）
        selected.config.lastUsed = new Date().toISOString();
        if (!options.skipUsageCount) {
            selected.config.usageCount++;
        }
        // 使用防抖保存（文件 I/O 是异步的，但内存已经更新）
        this._debouncedSave(providerType);

        this._log('debug', `Selected provider for ${providerType} (LRU): ${selected.config.uuid}${requestedModel ? ` for model: ${requestedModel}` : ''}${options.skipUsageCount ? ' (skip usage count)' : ''}`);
        
        return selected.config;
    }

    /**
     * Selects a provider from the pool with fallback support.
     * When the primary provider type has no healthy providers, it will try fallback types.
     * @param {string} providerType - The primary type of provider to select.
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @param {Object} [options] - Optional. Additional options.
     * @param {boolean} [options.skipUsageCount] - Optional. If true, skip incrementing usage count.
     * @returns {object|null} An object containing the selected provider's configuration and the actual provider type used, or null if no healthy provider is found.
     */
    /**
     * Selects a provider from the pool with fallback support.
     * When the primary provider type has no healthy providers, it will try fallback types.
     *
     * 注意：此方法现在返回 Promise，因为内部调用的 selectProvider 是异步的。
     *
     * @param {string} providerType - The primary type of provider to select.
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @param {Object} [options] - Optional. Additional options.
     * @param {boolean} [options.skipUsageCount] - Optional. If true, skip incrementing usage count.
     * @returns {Promise<object|null>} An object containing the selected provider's configuration and the actual provider type used, or null if no healthy provider is found.
     */
    async selectProviderWithFallback(providerType, requestedModel = null, options = {}) {
        // 参数校验
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return null;
        }

        // ==========================
        // 优先级 1: Provider Fallback Chain (同协议/兼容协议的回退)
        // ==========================
        
        // 记录尝试过的类型，避免循环
        const triedTypes = new Set();
        const typesToTry = [providerType];
        
        const fallbackTypes = this.fallbackChain[providerType] || [];
        if (Array.isArray(fallbackTypes)) {
            typesToTry.push(...fallbackTypes);
        }

        for (const currentType of typesToTry) {
            // 避免重复尝试
            if (triedTypes.has(currentType)) {
                continue;
            }
            triedTypes.add(currentType);

            // 检查该类型是否有配置的池
            if (!this.providerStatus[currentType] || this.providerStatus[currentType].length === 0) {
                this._log('debug', `No provider pool configured for type: ${currentType}`);
                continue;
            }

            // 如果是 fallback 类型，需要检查模型兼容性
            if (currentType !== providerType && requestedModel) {
                // 检查协议前缀是否兼容
                const primaryProtocol = getProtocolPrefix(providerType);
                const fallbackProtocol = getProtocolPrefix(currentType);
                
                if (primaryProtocol !== fallbackProtocol) {
                    this._log('debug', `Skipping fallback type ${currentType}: protocol mismatch (${primaryProtocol} vs ${fallbackProtocol})`);
                    continue;
                }

                // 检查 fallback 类型是否支持请求的模型
                const supportedModels = getProviderModels(currentType);
                if (supportedModels.length > 0 && !supportedModels.includes(requestedModel)) {
                    this._log('debug', `Skipping fallback type ${currentType}: model ${requestedModel} not supported`);
                    continue;
                }
            }

            // 尝试从当前类型选择提供商（现在是异步的）
            const selectedConfig = await this.selectProvider(currentType, requestedModel, options);
            
            if (selectedConfig) {
                if (currentType !== providerType) {
                    this._log('info', `Fallback activated (Chain): ${providerType} -> ${currentType} (uuid: ${selectedConfig.uuid})`);
                }
                return {
                    config: selectedConfig,
                    actualProviderType: currentType,
                    isFallback: currentType !== providerType
                };
            }
        }

        // ==========================
        // 优先级 2: Model Fallback Mapping (跨协议/特定模型的回退)
        // ==========================

        if (requestedModel && this.modelFallbackMapping && this.modelFallbackMapping[requestedModel]) {
            const mapping = this.modelFallbackMapping[requestedModel];
            const targetProviderType = mapping.targetProviderType;
            const targetModel = mapping.targetModel;

            if (targetProviderType && targetModel) {
                this._log('info', `Trying Model Fallback Mapping for ${requestedModel}: -> ${targetProviderType} (${targetModel})`);
                
                // 递归调用 selectProviderWithFallback，但这次针对目标提供商类型
                // 注意：这里我们直接尝试从目标提供商池中选择，因为如果再次递归可能会导致死循环或逻辑复杂化
                // 简单起见，我们直接尝试选择目标提供商
                
                // 检查目标类型是否有配置的池
                if (this.providerStatus[targetProviderType] && this.providerStatus[targetProviderType].length > 0) {
                    // 尝试从目标类型选择提供商（使用转换后的模型名，现在是异步的）
                    const selectedConfig = await this.selectProvider(targetProviderType, targetModel, options);
                    
                    if (selectedConfig) {
                        this._log('info', `Fallback activated (Model Mapping): ${providerType} (${requestedModel}) -> ${targetProviderType} (${targetModel}) (uuid: ${selectedConfig.uuid})`);
                        return {
                            config: selectedConfig,
                            actualProviderType: targetProviderType,
                            isFallback: true,
                            actualModel: targetModel // 返回实际使用的模型名，供上层进行请求转换
                        };
                    } else {
                        // 如果目标类型的主池也不可用，尝试目标类型的 fallback chain
                        // 例如 claude-kiro-oauth (mapped) -> claude-custom (chain)
                        // 这需要我们小心处理，避免无限递归。
                        // 我们可以手动检查目标类型的 fallback chain
                        
                        const targetFallbackTypes = this.fallbackChain[targetProviderType] || [];
                        for (const fallbackType of targetFallbackTypes) {
                             // 检查协议兼容性 (目标类型 vs 它的 fallback)
                             const targetProtocol = getProtocolPrefix(targetProviderType);
                             const fallbackProtocol = getProtocolPrefix(fallbackType);
                             
                             if (targetProtocol !== fallbackProtocol) continue;
                             
                             // 检查模型支持
                             const supportedModels = getProviderModels(fallbackType);
                             if (supportedModels.length > 0 && !supportedModels.includes(targetModel)) continue;
                             
                             const fallbackSelectedConfig = await this.selectProvider(fallbackType, targetModel, options);
                             if (fallbackSelectedConfig) {
                                 this._log('info', `Fallback activated (Model Mapping -> Chain): ${providerType} (${requestedModel}) -> ${targetProviderType} -> ${fallbackType} (${targetModel}) (uuid: ${fallbackSelectedConfig.uuid})`);
                                 return {
                                     config: fallbackSelectedConfig,
                                     actualProviderType: fallbackType,
                                     isFallback: true,
                                     actualModel: targetModel
                                 };
                             }
                        }
                    }
                } else {
                    this._log('warn', `Model Fallback target provider ${targetProviderType} not configured or empty.`);
                }
            }
        }

        this._log('warn', `None available provider found for ${providerType} (Model: ${requestedModel}) after checking fallback chain and model mapping.`);
        return null;
    }

    /**
     * Gets the fallback chain for a given provider type.
     * @param {string} providerType - The provider type to get fallback chain for.
     * @returns {Array<string>} The fallback chain array, or empty array if not configured.
     */
    getFallbackChain(providerType) {
        return this.fallbackChain[providerType] || [];
    }

    /**
     * Sets or updates the fallback chain for a provider type.
     * @param {string} providerType - The provider type to set fallback chain for.
     * @param {Array<string>} fallbackTypes - Array of fallback provider types.
     */
    setFallbackChain(providerType, fallbackTypes) {
        if (!Array.isArray(fallbackTypes)) {
            this._log('error', `Invalid fallbackTypes: must be an array`);
            return;
        }
        this.fallbackChain[providerType] = fallbackTypes;
        this._log('info', `Updated fallback chain for ${providerType}: ${fallbackTypes.join(' -> ')}`);
    }

    /**
     * Checks if all providers of a given type are unhealthy.
     * @param {string} providerType - The provider type to check.
     * @returns {boolean} True if all providers are unhealthy or disabled.
     */
    isAllProvidersUnhealthy(providerType) {
        const providers = this.providerStatus[providerType] || [];
        if (providers.length === 0) {
            return true;
        }
        return providers.every(p => !p.config.isHealthy || p.config.isDisabled);
    }

    /**
     * Gets statistics about provider health for a given type.
     * @param {string} providerType - The provider type to get stats for.
     * @returns {Object} Statistics object with total, healthy, unhealthy, and disabled counts.
     */
    getProviderStats(providerType) {
        const providers = this.providerStatus[providerType] || [];
        const stats = {
            total: providers.length,
            healthy: 0,
            unhealthy: 0,
            disabled: 0
        };
        
        for (const p of providers) {
            if (p.config.isDisabled) {
                stats.disabled++;
            } else if (p.config.isHealthy) {
                stats.healthy++;
            } else {
                stats.unhealthy++;
            }
        }
        
        return stats;
    }

    /**
     * Marks a provider as unhealthy (e.g., after an API error).
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     */
    markProviderUnhealthy(providerType, providerConfig, errorMessage = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            const now = Date.now();
            const lastErrorTime = provider.config.lastErrorTime ? new Date(provider.config.lastErrorTime).getTime() : 0;
            const errorWindowMs = 10000; // 10 秒窗口期

            // 如果距离上次错误超过窗口期，重置错误计数
            if (now - lastErrorTime > errorWindowMs) {
                provider.config.errorCount = 1;
            } else {
                provider.config.errorCount++;
            }

            provider.config.lastErrorTime = new Date().toISOString();
            // 更新 lastUsed 时间，避免因 LRU 策略导致失败节点被重复选中
            provider.config.lastUsed = new Date().toISOString();

            // 保存错误信息
            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            if (provider.config.errorCount >= this.maxErrorCount) {
                provider.config.isHealthy = false;
                this._log('warn', `Marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Total errors: ${provider.config.errorCount}`);
            } else {
                this._log('warn', `Provider ${providerConfig.uuid} for type ${providerType} error count: ${provider.config.errorCount}/${this.maxErrorCount}. Still healthy.`);
            }

            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as unhealthy immediately (without accumulating error count).
     * Used for definitive authentication errors like 401/403.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     */
    markProviderUnhealthyImmediately(providerType, providerConfig, errorMessage = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthyImmediately');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = false;
            provider.config.errorCount = this.maxErrorCount; // Set to max to indicate definitive failure
            provider.config.lastErrorTime = new Date().toISOString();
            provider.config.lastUsed = new Date().toISOString();

            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            this._log('warn', `Immediately marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Reason: ${errorMessage || 'Authentication error'}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as unhealthy with a scheduled recovery time.
     * Used for quota exhaustion errors (402) where the quota will reset at a specific time.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     * @param {Date|string} [recoveryTime] - Optional recovery time when the provider should be marked healthy again.
     */
    markProviderUnhealthyWithRecoveryTime(providerType, providerConfig, errorMessage = null, recoveryTime = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthyWithRecoveryTime');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = false;
            provider.config.errorCount = this.maxErrorCount; // Set to max to indicate definitive failure
            provider.config.lastErrorTime = new Date().toISOString();
            provider.config.lastUsed = new Date().toISOString();

            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            // Set recovery time if provided
            if (recoveryTime) {
                const recoveryDate = recoveryTime instanceof Date ? recoveryTime : new Date(recoveryTime);
                provider.config.scheduledRecoveryTime = recoveryDate.toISOString();
                this._log('warn', `Marked provider as unhealthy with recovery time: ${providerConfig.uuid} for type ${providerType}. Recovery at: ${recoveryDate.toISOString()}. Reason: ${errorMessage || 'Quota exhausted'}`);
            } else {
                this._log('warn', `Marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Reason: ${errorMessage || 'Quota exhausted'}`);
            }

            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as healthy.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {boolean} resetUsageCount - Whether to reset usage count (optional, default: false).
     * @param {string} [healthCheckModel] - Optional model name used for health check.
     */
    markProviderHealthy(providerType, providerConfig, resetUsageCount = false, healthCheckModel = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderHealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = true;
            provider.config.errorCount = 0;
            provider.config.lastErrorTime = null;
            provider.config.lastErrorMessage = null;
            
            // 更新健康检测信息
            provider.config.lastHealthCheckTime = new Date().toISOString();
            if (healthCheckModel) {
                provider.config.lastHealthCheckModel = healthCheckModel;
            }
            
            // 只有在明确要求重置使用计数时才重置
            if (resetUsageCount) {
                provider.config.usageCount = 0;
            }else{
                provider.config.usageCount++;
                provider.config.lastUsed = new Date().toISOString();
            }
            this._log('info', `Marked provider as healthy: ${provider.config.uuid} for type ${providerType}${resetUsageCount ? ' (usage count reset)' : ''}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * 重置提供商的计数器（错误计数和使用计数）
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     */
    resetProviderCounters(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in resetProviderCounters');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.errorCount = 0;
            provider.config.usageCount = 0;
            this._log('info', `Reset provider counters: ${provider.config.uuid} for type ${providerType}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * 禁用指定提供商
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置
     */
    disableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in disableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = true;
            this._log('info', `Disabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * 启用指定提供商
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置
     */
    enableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in enableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = false;
            this._log('info', `Enabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * 刷新指定提供商的 UUID
     * 用于在认证错误（如 401）时更换 UUID，以便重新尝试
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置（包含当前 uuid）
     * @returns {string|null} 新的 UUID，如果失败则返回 null
     */
    refreshProviderUuid(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in refreshProviderUuid');
            return null;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            const oldUuid = provider.config.uuid;
            // 生成新的 UUID
            const newUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            
            // 更新 provider 的 UUID
            provider.uuid = newUuid;
            provider.config.uuid = newUuid;
            
            // 同时更新 providerPools 中的原始数据
            const poolArray = this.providerPools[providerType];
            if (poolArray) {
                const originalProvider = poolArray.find(p => p.uuid === oldUuid);
                if (originalProvider) {
                    originalProvider.uuid = newUuid;
                }
            }
            
            this._log('info', `Refreshed provider UUID: ${oldUuid} -> ${newUuid} for type ${providerType}`);
            this._debouncedSave(providerType);
            
            return newUuid;
        }
        
        this._log('warn', `Provider not found for UUID refresh: ${providerConfig.uuid} in ${providerType}`);
        return null;
    }

    /**
     * 检查并恢复已到恢复时间的提供商
     * @param {string} [providerType] - 可选，指定要检查的提供商类型。如果不提供，检查所有类型
     * @private
     */
    _checkAndRecoverScheduledProviders(providerType = null) {
        const now = new Date();
        const typesToCheck = providerType ? [providerType] : Object.keys(this.providerStatus);
        
        for (const type of typesToCheck) {
            const providers = this.providerStatus[type] || [];
            for (const providerStatus of providers) {
                const config = providerStatus.config;
                
                // 检查是否有 scheduledRecoveryTime 且已到恢复时间
                if (config.scheduledRecoveryTime && !config.isHealthy) {
                    const recoveryTime = new Date(config.scheduledRecoveryTime);
                    if (now >= recoveryTime) {
                        this._log('info', `Auto-recovering provider ${config.uuid} (${type}). Scheduled recovery time reached: ${recoveryTime.toISOString()}`);
                        
                        // 恢复健康状态
                        config.isHealthy = true;
                        config.errorCount = 0;
                        config.lastErrorTime = null;
                        config.lastErrorMessage = null;
                        config.scheduledRecoveryTime = null; // 清除恢复时间
                        
                        // 保存更改
                        this._debouncedSave(type);
                    }
                }
            }
        }
    }

    /**
     * Performs health checks on all providers in the pool.
     * This method would typically be called periodically (e.g., via cron job).
     */
    async performHealthChecks(isInit = false) {
        this._log('info', 'Performing health checks on all providers...');
        const now = new Date();
        
        // 首先检查并恢复已到恢复时间的提供商
        this._checkAndRecoverScheduledProviders();
        
        for (const providerType in this.providerStatus) {
            for (const providerStatus of this.providerStatus[providerType]) {
                const providerConfig = providerStatus.config;

                // 如果提供商有 scheduledRecoveryTime 且未到恢复时间，跳过健康检查
                if (providerConfig.scheduledRecoveryTime && !providerConfig.isHealthy) {
                    const recoveryTime = new Date(providerConfig.scheduledRecoveryTime);
                    if (now < recoveryTime) {
                        this._log('debug', `Skipping health check for ${providerConfig.uuid} (${providerType}). Waiting for scheduled recovery at ${recoveryTime.toISOString()}`);
                        continue;
                    }
                }

                // Only attempt to health check unhealthy providers after a certain interval
                if (!providerStatus.config.isHealthy && providerStatus.config.lastErrorTime &&
                    (now.getTime() - new Date(providerStatus.config.lastErrorTime).getTime() < this.healthCheckInterval)) {
                    this._log('debug', `Skipping health check for ${providerConfig.uuid} (${providerType}). Last error too recent.`);
                    continue;
                }

                try {
                    // Perform actual health check based on provider type
                    const healthResult = await this._checkProviderHealth(providerType, providerConfig);
                    
                    if (healthResult === null) {
                        this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}) skipped: Check not implemented.`);
                        this.resetProviderCounters(providerType, providerConfig);
                        continue;
                    }
                    
                    if (healthResult.success) {
                        if (!providerStatus.config.isHealthy) {
                            // Provider was unhealthy but is now healthy
                            // 恢复健康时不重置使用计数，保持原有值
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('info', `Health check for ${providerConfig.uuid} (${providerType}): Marked Healthy (actual check)`);
                        } else {
                            // Provider was already healthy and still is
                            // 只在初始化时重置使用计数
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}): Still Healthy`);
                        }
                    } else {
                        // Provider is not healthy
                        this._log('warn', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${healthResult.errorMessage || 'Provider is not responding correctly.'}`);
                        this.markProviderUnhealthy(providerType, providerConfig, healthResult.errorMessage);
                        
                        // 更新健康检测时间和模型（即使失败也记录）
                        providerStatus.config.lastHealthCheckTime = new Date().toISOString();
                        if (healthResult.modelName) {
                            providerStatus.config.lastHealthCheckModel = healthResult.modelName;
                        }
                    }

                } catch (error) {
                    this._log('error', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${error.message}`);
                    // If a health check fails, mark it unhealthy, which will update error count and lastErrorTime
                    this.markProviderUnhealthy(providerType, providerConfig, error.message);
                }
            }
        }
    }

    /**
     * 构建健康检查请求（返回多种格式用于重试）
     * @private
     * @returns {Array} 请求格式数组，按优先级排序
     */
    _buildHealthCheckRequests(providerType, modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        const requests = [];
        
        // Gemini 使用 contents 格式
        if (providerType.startsWith('gemini')) {
            requests.push({
                contents: [{
                    role: 'user',
                    parts: [{ text: baseMessage.content }]
                }]
            });
            return requests;
        }
        
        // Kiro OAuth 只支持 messages 格式
        if (providerType.startsWith('claude-kiro')) {
            requests.push({
                messages: [baseMessage],
                model: modelName,
                max_tokens: 1
            });
            return requests;
        }
        
        // OpenAI Custom Responses 使用特殊格式
        if (providerType === MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES) {
            requests.push({
                input: [baseMessage],
                model: modelName
            });
            return requests;
        }
        
        // 其他提供商（OpenAI、Claude、Qwen）使用标准 messages 格式
        requests.push({
            messages: [baseMessage],
            model: modelName
        });
        
        return requests;
    }

    /**
     * Performs an actual health check for a specific provider.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to check.
     * @param {boolean} forceCheck - If true, ignore checkHealth config and force the check.
     * @returns {Promise<{success: boolean, modelName: string, errorMessage: string}|null>} - Health check result object or null if check not implemented.
     */
    async _checkProviderHealth(providerType, providerConfig, forceCheck = false) {
        // 确定健康检查使用的模型名称
        const modelName = providerConfig.checkModelName ||
                        ProviderPoolManager.DEFAULT_HEALTH_CHECK_MODELS[providerType];

        // 如果未启用健康检查且不是强制检查，返回 null
        if (!providerConfig.checkHealth && !forceCheck) {
            return null;
        }

        if (!modelName) {
            this._log('warn', `Unknown provider type for health check: ${providerType}`);
            return { success: false, modelName: null, errorMessage: 'Unknown provider type for health check' };
        }

        // ========== 快速预检：从内存缓存检查 OAuth 凭证状态 ==========
        // 对于 OAuth 类型的 provider，先检查 token 是否过期，避免阻塞
        const oauthProviderTypes = ['claude-kiro-oauth', 'gemini-cli-oauth', 'gemini-antigravity', 'openai-qwen-oauth', 'openai-iflow-oauth', 'claude-orchids-oauth'];
        if (oauthProviderTypes.includes(providerType) && providerConfig.uuid) {
            const credentialCache = CredentialCacheManager.getInstance();
            const cachedEntry = credentialCache.getCredentials(providerType, providerConfig.uuid);

            if (cachedEntry && cachedEntry.credentials) {
                const { expiresAt, accessToken } = cachedEntry.credentials;

                // 检查 token 是否存在
                if (!accessToken) {
                    this._log('warn', `Health check fast-fail for ${providerConfig.uuid}: No access token in cache`);
                    return { success: false, modelName, errorMessage: 'No access token available' };
                }

                // 检查 token 是否已过期（30秒缓冲）
                if (expiresAt) {
                    const expirationTime = new Date(expiresAt).getTime();
                    const now = Date.now();
                    const bufferMs = 30 * 1000;

                    if (expirationTime <= now + bufferMs) {
                        this._log('warn', `Health check fast-fail for ${providerConfig.uuid}: Token expired`);
                        return { success: false, modelName, errorMessage: 'Token expired' };
                    }
                }

                this._log('debug', `Health check pre-check passed for ${providerConfig.uuid}: Token valid in cache`);
            }
            // 注意：如果缓存中没有凭证，不要直接返回失败
            // 让后续的实际健康检查去尝试初始化和加载凭证
            // 这样可以支持刚重置健康状态或新添加的 provider
        }

        // ========== 实际 API 健康检查（带超时保护）==========
        const proxyKeys = ['GEMINI', 'OPENAI', 'CLAUDE', 'QWEN', 'KIRO'];
        const tempConfig = {
            ...providerConfig,
            MODEL_PROVIDER: providerType
        };

        proxyKeys.forEach(key => {
            const proxyKey = `USE_SYSTEM_PROXY_${key}`;
            if (this.globalConfig[proxyKey] !== undefined) {
                tempConfig[proxyKey] = this.globalConfig[proxyKey];
            }
        });

        const serviceAdapter = getServiceAdapter(tempConfig);

        // 获取所有可能的请求格式
        const healthCheckRequests = this._buildHealthCheckRequests(providerType, modelName);

        // 健康检查超时时间（15秒，避免长时间阻塞）
        const healthCheckTimeout = 15000;

        // 重试机制：尝试不同的请求格式
        const maxRetries = healthCheckRequests.length;
        let lastError = null;

        for (let i = 0; i < maxRetries; i++) {
            const healthCheckRequest = healthCheckRequests[i];
            try {
                this._log('debug', `Health check attempt ${i + 1}/${maxRetries} for ${modelName}: ${JSON.stringify(healthCheckRequest)}`);

                // 带超时的健康检查
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Health check timeout')), healthCheckTimeout)
                );

                await Promise.race([
                    serviceAdapter.generateContent(modelName, healthCheckRequest),
                    timeoutPromise
                ]);

                return { success: true, modelName, errorMessage: null };
            } catch (error) {
                lastError = error;
                this._log('debug', `Health check attempt ${i + 1} failed for ${providerType}: ${error.message}`);
                // 继续尝试下一个格式
            }
        }

        // 所有尝试都失败
        this._log('error', `Health check failed for ${providerType} after ${maxRetries} attempts: ${lastError?.message}`);
        return { success: false, modelName, errorMessage: lastError?.message || 'All health check attempts failed' };
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
     * 批量保存所有待保存的 providerType（优化为单次文件写入）
     * @private
     */
    async _flushPendingSaves() {
        const typesToSave = Array.from(this.pendingSaves);
        if (typesToSave.length === 0) return;
        
        this.pendingSaves.clear();
        this.saveTimer = null;
        
        try {
            const filePath = this.globalConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let currentPools = {};
            
            // 一次性读取文件
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                currentPools = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    this._log('info', 'configs/provider_pools.json does not exist, creating new file.');
                } else {
                    throw readError;
                }
            }

            // 更新所有待保存的 providerType
            for (const providerType of typesToSave) {
                if (this.providerStatus[providerType]) {
                    currentPools[providerType] = this.providerStatus[providerType].map(p => {
                        // Convert Date objects to ISOString if they exist
                        const config = { ...p.config };
                        if (config.lastUsed instanceof Date) {
                            config.lastUsed = config.lastUsed.toISOString();
                        }
                        if (config.lastErrorTime instanceof Date) {
                            config.lastErrorTime = config.lastErrorTime.toISOString();
                        }
                        if (config.lastHealthCheckTime instanceof Date) {
                            config.lastHealthCheckTime = config.lastHealthCheckTime.toISOString();
                        }
                        return config;
                    });
                } else {
                    this._log('warn', `Attempted to save unknown providerType: ${providerType}`);
                }
            }
            
            // 一次性写入文件
            await fs.promises.writeFile(filePath, JSON.stringify(currentPools, null, 2), 'utf8');
            this._log('info', `configs/provider_pools.json updated successfully for types: ${typesToSave.join(', ')}`);
        } catch (error) {
            this._log('error', `Failed to write provider_pools.json: ${error.message}`);
        }
    }

}
