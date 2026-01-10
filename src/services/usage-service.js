/**
 * 用量查询服务
 * 用于处理各个提供商的授权文件用量查询
 */

import { getProviderPoolManager } from './service-manager.js';
import { serviceInstances } from '../providers/adapter.js';
import { MODEL_PROVIDER } from '../utils/common.js';

/**
 * 用量查询服务类
 * 提供统一的接口来查询各提供商的用量信息
 */
export class UsageService {
    constructor() {
        this.providerHandlers = {
            [MODEL_PROVIDER.KIRO_API]: this.getKiroUsage.bind(this),
            [MODEL_PROVIDER.GEMINI_CLI]: this.getGeminiUsage.bind(this),
            [MODEL_PROVIDER.ANTIGRAVITY]: this.getAntigravityUsage.bind(this),
        };
    }

    /**
     * 获取指定提供商的用量信息
     * @param {string} providerType - 提供商类型
     * @param {string} [uuid] - 可选的提供商实例 UUID
     * @returns {Promise<Object>} 用量信息
     */
    async getUsage(providerType, uuid = null) {
        const handler = this.providerHandlers[providerType];
        if (!handler) {
            throw new Error(`不支持的提供商类型: ${providerType}`);
        }
        return handler(uuid);
    }

    /**
     * 获取所有提供商的用量信息
     * @returns {Promise<Object>} 所有提供商的用量信息
     */
    async getAllUsage() {
        const results = {};
        const poolManager = getProviderPoolManager();
        
        for (const [providerType, handler] of Object.entries(this.providerHandlers)) {
            try {
                // 检查是否有号池配置
                if (poolManager) {
                    const pools = poolManager.getProviderPools(providerType);
                    if (pools && pools.length > 0) {
                        results[providerType] = [];
                        for (const pool of pools) {
                            try {
                                const usage = await handler(pool.uuid);
                                results[providerType].push({
                                    uuid: pool.uuid,
                                    usage
                                });
                            } catch (error) {
                                results[providerType].push({
                                    uuid: pool.uuid,
                                    error: error.message
                                });
                            }
                        }
                    }
                }
                
                // 如果没有号池配置，尝试获取单个实例的用量
                if (!results[providerType] || results[providerType].length === 0) {
                    const usage = await handler(null);
                    results[providerType] = [{ uuid: 'default', usage }];
                }
            } catch (error) {
                results[providerType] = [{ uuid: 'default', error: error.message }];
            }
        }
        
        return results;
    }

    /**
     * 获取 Kiro 提供商的用量信息
     * @param {string} [uuid] - 可选的提供商实例 UUID
     * @returns {Promise<Object>} Kiro 用量信息
     */
    async getKiroUsage(uuid = null) {
        const providerKey = uuid ? MODEL_PROVIDER.KIRO_API + uuid : MODEL_PROVIDER.KIRO_API;
        const adapter = serviceInstances[providerKey];
        
        if (!adapter) {
            throw new Error(`Kiro 服务实例未找到: ${providerKey}`);
        }
        
        // 使用适配器的 getUsageLimits 方法
        if (typeof adapter.getUsageLimits === 'function') {
            return adapter.getUsageLimits();
        }
        
        // 兼容直接访问 kiroApiService 的情况
        if (adapter.kiroApiService && typeof adapter.kiroApiService.getUsageLimits === 'function') {
            return adapter.kiroApiService.getUsageLimits();
        }
        
        throw new Error(`Kiro 服务实例不支持用量查询: ${providerKey}`);
    }

    /**
     * 获取 Gemini CLI 提供商的用量信息
     * @param {string} [uuid] - 可选的提供商实例 UUID
     * @returns {Promise<Object>} Gemini 用量信息
     */
    async getGeminiUsage(uuid = null) {
        const providerKey = uuid ? MODEL_PROVIDER.GEMINI_CLI + uuid : MODEL_PROVIDER.GEMINI_CLI;
        const adapter = serviceInstances[providerKey];
        
        if (!adapter) {
            throw new Error(`Gemini CLI 服务实例未找到: ${providerKey}`);
        }
        
        // 使用适配器的 getUsageLimits 方法
        if (typeof adapter.getUsageLimits === 'function') {
            return adapter.getUsageLimits();
        }
        
        // 兼容直接访问 geminiApiService 的情况
        if (adapter.geminiApiService && typeof adapter.geminiApiService.getUsageLimits === 'function') {
            return adapter.geminiApiService.getUsageLimits();
        }
        
        throw new Error(`Gemini CLI 服务实例不支持用量查询: ${providerKey}`);
    }

    /**
     * 获取 Antigravity 提供商的用量信息
     * @param {string} [uuid] - 可选的提供商实例 UUID
     * @returns {Promise<Object>} Antigravity 用量信息
     */
    async getAntigravityUsage(uuid = null) {
        const providerKey = uuid ? MODEL_PROVIDER.ANTIGRAVITY + uuid : MODEL_PROVIDER.ANTIGRAVITY;
        const adapter = serviceInstances[providerKey];
        
        if (!adapter) {
            throw new Error(`Antigravity 服务实例未找到: ${providerKey}`);
        }
        
        // 使用适配器的 getUsageLimits 方法
        if (typeof adapter.getUsageLimits === 'function') {
            return adapter.getUsageLimits();
        }
        
        // 兼容直接访问 antigravityApiService 的情况
        if (adapter.antigravityApiService && typeof adapter.antigravityApiService.getUsageLimits === 'function') {
            return adapter.antigravityApiService.getUsageLimits();
        }
        
        throw new Error(`Antigravity 服务实例不支持用量查询: ${providerKey}`);
    }

    /**
     * 获取支持用量查询的提供商列表
     * @returns {Array<string>} 支持的提供商类型列表
     */
    getSupportedProviders() {
        return Object.keys(this.providerHandlers);
    }
}

// 导出单例实例
export const usageService = new UsageService();

/**
 * 格式化 Kiro 用量信息为易读格式
 * @param {Object} usageData - 原始用量数据
 * @returns {Object} 格式化后的用量信息
 */
export function formatKiroUsage(usageData) {
    if (!usageData) {
        return null;
    }

    const result = {
        // 基本信息
        daysUntilReset: usageData.daysUntilReset,
        nextDateReset: usageData.nextDateReset ? new Date(usageData.nextDateReset * 1000).toISOString() : null,
        
        // 订阅信息
        subscription: null,
        
        // 用户信息
        user: null,
        
        // 用量明细
        usageBreakdown: []
    };

    // 解析订阅信息
    if (usageData.subscriptionInfo) {
        result.subscription = {
            title: usageData.subscriptionInfo.subscriptionTitle,
            type: usageData.subscriptionInfo.type,
            upgradeCapability: usageData.subscriptionInfo.upgradeCapability,
            overageCapability: usageData.subscriptionInfo.overageCapability
        };
    }

    // 解析用户信息
    if (usageData.userInfo) {
        result.user = {
            email: usageData.userInfo.email,
            userId: usageData.userInfo.userId
        };
    }

    // 解析用量明细
    if (usageData.usageBreakdownList && Array.isArray(usageData.usageBreakdownList)) {
        for (const breakdown of usageData.usageBreakdownList) {
            const item = {
                resourceType: breakdown.resourceType,
                displayName: breakdown.displayName,
                displayNamePlural: breakdown.displayNamePlural,
                unit: breakdown.unit,
                currency: breakdown.currency,
                
                // 当前用量
                currentUsage: breakdown.currentUsageWithPrecision ?? breakdown.currentUsage,
                usageLimit: breakdown.usageLimitWithPrecision ?? breakdown.usageLimit,
                
                // 超额信息
                currentOverages: breakdown.currentOveragesWithPrecision ?? breakdown.currentOverages,
                overageCap: breakdown.overageCapWithPrecision ?? breakdown.overageCap,
                overageRate: breakdown.overageRate,
                overageCharges: breakdown.overageCharges,
                
                // 下次重置时间
                nextDateReset: breakdown.nextDateReset ? new Date(breakdown.nextDateReset * 1000).toISOString() : null,
                
                // 免费试用信息
                freeTrial: null,
                
                // 奖励信息
                bonuses: []
            };

            // 解析免费试用信息
            if (breakdown.freeTrialInfo) {
                item.freeTrial = {
                    status: breakdown.freeTrialInfo.freeTrialStatus,
                    currentUsage: breakdown.freeTrialInfo.currentUsageWithPrecision ?? breakdown.freeTrialInfo.currentUsage,
                    usageLimit: breakdown.freeTrialInfo.usageLimitWithPrecision ?? breakdown.freeTrialInfo.usageLimit,
                    expiresAt: breakdown.freeTrialInfo.freeTrialExpiry 
                        ? new Date(breakdown.freeTrialInfo.freeTrialExpiry * 1000).toISOString() 
                        : null
                };
            }

            // 解析奖励信息
            if (breakdown.bonuses && Array.isArray(breakdown.bonuses)) {
                for (const bonus of breakdown.bonuses) {
                    item.bonuses.push({
                        code: bonus.bonusCode,
                        displayName: bonus.displayName,
                        description: bonus.description,
                        status: bonus.status,
                        currentUsage: bonus.currentUsage,
                        usageLimit: bonus.usageLimit,
                        redeemedAt: bonus.redeemedAt ? new Date(bonus.redeemedAt * 1000).toISOString() : null,
                        expiresAt: bonus.expiresAt ? new Date(bonus.expiresAt * 1000).toISOString() : null
                    });
                }
            }

            result.usageBreakdown.push(item);
        }
    }

    return result;
}

/**
 * 格式化 Gemini 用量信息为易读格式（映射到 Kiro 数据结构）
 * @param {Object} usageData - 原始用量数据
 * @returns {Object} 格式化后的用量信息
 */
export function formatGeminiUsage(usageData) {
    if (!usageData) {
        return null;
    }

    const TZ_OFFSET = 8 * 60 * 60 * 1000; // Beijing timezone offset

    /**
     * 将 UTC 时间转换为北京时间
     * @param {string} utcString - UTC 时间字符串
     * @returns {string} 北京时间字符串
     */
    function utcToBeijing(utcString) {
        try {
            if (!utcString) return '--';
            const utcDate = new Date(utcString);
            const beijingTime = new Date(utcDate.getTime() + TZ_OFFSET);
            return beijingTime
                .toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })
                .replace(/\//g, '-');
        } catch (e) {
            return '--';
        }
    }

    const result = {
        // 基本信息 - 映射到 Kiro 结构
        daysUntilReset: null,
        nextDateReset: null,
        
        // 订阅信息
        subscription: {
            title: 'Gemini CLI OAuth',
            type: 'gemini-cli-oauth',
            upgradeCapability: null,
            overageCapability: null
        },
        
        // 用户信息
        user: {
            email: null,
            userId: null
        },
        
        // 用量明细
        usageBreakdown: []
    };

    // 解析配额信息
    if (usageData.quotaInfo) {
        result.subscription.title = usageData.quotaInfo.currentTier || 'Gemini CLI OAuth';
        if (usageData.quotaInfo.quotaResetTime) {
            result.nextDateReset = usageData.quotaInfo.quotaResetTime;
            // 计算距离重置的天数
            const resetDate = new Date(usageData.quotaInfo.quotaResetTime);
            const now = new Date();
            const diffTime = resetDate.getTime() - now.getTime();
            result.daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
    }

    // 解析模型配额信息
    if (usageData.models && typeof usageData.models === 'object') {
        for (const [modelName, modelInfo] of Object.entries(usageData.models)) {
            // Gemini 返回的数据结构：{ remaining, resetTime, resetTimeRaw }
            // remaining 是 0-1 之间的比例值，表示剩余配额百分比
            const remainingPercent = typeof modelInfo.remaining === 'number' ? modelInfo.remaining : 1;
            const usedPercent = 1 - remainingPercent;
            
            const item = {
                resourceType: 'MODEL_USAGE',
                displayName: modelInfo.displayName || modelName,
                displayNamePlural: modelInfo.displayName || modelName,
                unit: 'quota',
                currency: null,
                
                // 当前用量 - Gemini 返回的是剩余比例，转换为已用比例（百分比形式）
                currentUsage: Math.round(usedPercent * 100),
                usageLimit: 100, // 以百分比表示，总量为 100%
                
                // 超额信息
                currentOverages: 0,
                overageCap: 0,
                overageRate: null,
                overageCharges: 0,
                
                // 下次重置时间
                nextDateReset: modelInfo.resetTimeRaw ? new Date(modelInfo.resetTimeRaw).toISOString() :
                               (modelInfo.resetTime ? new Date(modelInfo.resetTime).toISOString() : null),
                
                // 免费试用信息
                freeTrial: null,
                
                // 奖励信息
                bonuses: [],

                // 额外的 Gemini 特有信息
                modelName: modelName,
                inputTokenLimit: modelInfo.inputTokenLimit || 0,
                outputTokenLimit: modelInfo.outputTokenLimit || 0,
                remaining: remainingPercent,
                remainingPercent: Math.round(remainingPercent * 100), // 剩余百分比
                resetTime: (modelInfo.resetTimeRaw || modelInfo.resetTime) ?
                           utcToBeijing(modelInfo.resetTimeRaw || modelInfo.resetTime) : '--',
                resetTimeRaw: modelInfo.resetTimeRaw || modelInfo.resetTime || null
            };

            result.usageBreakdown.push(item);
        }
    }

    return result;
}

/**
 * 格式化 Antigravity 用量信息为易读格式（映射到 Kiro 数据结构）
 * @param {Object} usageData - 原始用量数据
 * @returns {Object} 格式化后的用量信息
 */
export function formatAntigravityUsage(usageData) {
    if (!usageData) {
        return null;
    }

    const TZ_OFFSET = 8 * 60 * 60 * 1000; // Beijing timezone offset

    /**
     * 将 UTC 时间转换为北京时间
     * @param {string} utcString - UTC 时间字符串
     * @returns {string} 北京时间字符串
     */
    function utcToBeijing(utcString) {
        try {
            if (!utcString) return '--';
            const utcDate = new Date(utcString);
            const beijingTime = new Date(utcDate.getTime() + TZ_OFFSET);
            return beijingTime
                .toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })
                .replace(/\//g, '-');
        } catch (e) {
            return '--';
        }
    }

    const result = {
        // 基本信息 - 映射到 Kiro 结构
        daysUntilReset: null,
        nextDateReset: null,
        
        // 订阅信息
        subscription: {
            title: 'Gemini Antigravity',
            type: 'gemini-antigravity',
            upgradeCapability: null,
            overageCapability: null
        },
        
        // 用户信息
        user: {
            email: null,
            userId: null
        },
        
        // 用量明细
        usageBreakdown: []
    };

    // 解析配额信息
    if (usageData.quotaInfo) {
        result.subscription.title = usageData.quotaInfo.currentTier || 'Gemini Antigravity';
        if (usageData.quotaInfo.quotaResetTime) {
            result.nextDateReset = usageData.quotaInfo.quotaResetTime;
            // 计算距离重置的天数
            const resetDate = new Date(usageData.quotaInfo.quotaResetTime);
            const now = new Date();
            const diffTime = resetDate.getTime() - now.getTime();
            result.daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
    }

    // 解析模型配额信息
    if (usageData.models && typeof usageData.models === 'object') {
        for (const [modelName, modelInfo] of Object.entries(usageData.models)) {
            // Antigravity 返回的数据结构：{ remaining, resetTime, resetTimeRaw }
            // remaining 是 0-1 之间的比例值，表示剩余配额百分比
            const remainingPercent = typeof modelInfo.remaining === 'number' ? modelInfo.remaining : 1;
            const usedPercent = 1 - remainingPercent;
            
            const item = {
                resourceType: 'MODEL_USAGE',
                displayName: modelInfo.displayName || modelName,
                displayNamePlural: modelInfo.displayName || modelName,
                unit: 'quota',
                currency: null,
                
                // 当前用量 - Antigravity 返回的是剩余比例，转换为已用比例（百分比形式）
                currentUsage: usedPercent * 100,
                usageLimit: 100, // 以百分比表示，总量为 100%
                
                // 超额信息
                currentOverages: 0,
                overageCap: 0,
                overageRate: null,
                overageCharges: 0,
                
                // 下次重置时间
                nextDateReset: modelInfo.resetTimeRaw ? new Date(modelInfo.resetTimeRaw).toISOString() :
                               (modelInfo.resetTime ? new Date(modelInfo.resetTime).toISOString() : null),
                
                // 免费试用信息
                freeTrial: null,
                
                // 奖励信息
                bonuses: [],

                // 额外的 Antigravity 特有信息
                modelName: modelName,
                inputTokenLimit: modelInfo.inputTokenLimit || 0,
                outputTokenLimit: modelInfo.outputTokenLimit || 0,
                remaining: remainingPercent,
                remainingPercent: remainingPercent * 100, // 剩余百分比
                resetTime: (modelInfo.resetTimeRaw || modelInfo.resetTime) ?
                           utcToBeijing(modelInfo.resetTimeRaw || modelInfo.resetTime) : '--',
                resetTimeRaw: modelInfo.resetTimeRaw || modelInfo.resetTime || null
            };

            result.usageBreakdown.push(item);
        }
    }

    return result;
}