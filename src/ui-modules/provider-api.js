import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import axios from 'axios';
import logger from '../utils/logger.js';
import { getRequestBody } from '../utils/common.js';
import { getAllProviderModels, getProviderModels } from '../providers/provider-models.js';
import { generateUUID, createProviderConfig, formatSystemPath, detectProviderFromPath, addToUsedPaths, isPathUsed, pathsEqual } from '../utils/provider-utils.js';
import { parseProxyUrl, isProxyEnabledForProvider } from '../utils/proxy-utils.js';
import { broadcastEvent } from './event-broadcast.js';

/**
 * 获取提供商池摘要
 */
export async function handleGetProviders(req, res, currentConfig, providerPoolManager) {
    let providerPools = {};
    const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
    try {
        if (providerPoolManager && providerPoolManager.providerPools) {
            providerPools = providerPoolManager.providerPools;
        } else if (filePath && existsSync(filePath)) {
            const poolsData = JSON.parse(readFileSync(filePath, 'utf-8'));
            providerPools = poolsData;
        }
    } catch (error) {
        logger.warn('[UI API] Failed to load provider pools:', error.message);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(providerPools));
    return true;
}

/**
 * 获取特定提供商类型的详细信息
 */
export async function handleGetProviderType(req, res, currentConfig, providerPoolManager, providerType) {
    let providerPools = {};
    const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
    try {
        if (providerPoolManager && providerPoolManager.providerPools) {
            providerPools = providerPoolManager.providerPools;
        } else if (filePath && existsSync(filePath)) {
            const poolsData = JSON.parse(readFileSync(filePath, 'utf-8'));
            providerPools = poolsData;
        }
    } catch (error) {
        logger.warn('[UI API] Failed to load provider pools:', error.message);
    }

    const providers = providerPools[providerType] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        providerType,
        providers,
        totalCount: providers.length,
        healthyCount: providers.filter(p => p.isHealthy).length
    }));
    return true;
}

/**
 * 获取所有提供商的可用模型
 */
export async function handleGetProviderModels(req, res) {
    const allModels = getAllProviderModels();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allModels));
    return true;
}

/**
 * 获取特定提供商类型的可用模型
 */
export async function handleGetProviderTypeModels(req, res, providerType) {
    const models = getProviderModels(providerType);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        providerType,
        models
    }));
    return true;
}

/**
 * 添加新的提供商配置
 */
export async function handleAddProvider(req, res, currentConfig, providerPoolManager) {
    try {
        const body = await getRequestBody(req);
        const { providerType, providerConfig } = body;

        if (!providerType || !providerConfig) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'providerType and providerConfig are required' } }));
            return true;
        }

        // Generate UUID if not provided
        if (!providerConfig.uuid) {
            providerConfig.uuid = generateUUID();
        }

        // Set default values
        providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
        providerConfig.lastUsed = providerConfig.lastUsed || null;
        providerConfig.usageCount = providerConfig.usageCount || 0;
        providerConfig.errorCount = providerConfig.errorCount || 0;
        providerConfig.lastErrorTime = providerConfig.lastErrorTime || null;

        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                logger.warn('[UI API] Failed to read existing provider pools:', readError.message);
            }
        }

        // Add new provider to the appropriate type
        if (!providerPools[providerType]) {
            providerPools[providerType] = [];
        }
        providerPools[providerType].push(providerConfig);

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Added new provider to ${providerType}: ${providerConfig.uuid}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'add',
            filePath: filePath,
            providerType,
            providerConfig,
            timestamp: new Date().toISOString()
        });

        // 广播提供商更新事件
        broadcastEvent('provider_update', {
            action: 'add',
            providerType,
            providerConfig,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Provider added successfully',
            provider: providerConfig,
            providerType
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 更新特定提供商配置
 */
export async function handleUpdateProvider(req, res, currentConfig, providerPoolManager, providerType, providerUuid) {
    try {
        const body = await getRequestBody(req);
        const { providerConfig } = body;

        if (!providerConfig) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'providerConfig is required' } }));
            return true;
        }

        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Find and update the provider
        const providers = providerPools[providerType] || [];
        const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
        
        if (providerIndex === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
            return true;
        }

        // Update provider while preserving certain fields
        const existingProvider = providers[providerIndex];
        const updatedProvider = {
            ...existingProvider,
            ...providerConfig,
            uuid: providerUuid, // Ensure UUID doesn't change
            lastUsed: existingProvider.lastUsed, // Preserve usage stats
            usageCount: existingProvider.usageCount,
            errorCount: existingProvider.errorCount,
            lastErrorTime: existingProvider.lastErrorTime
        };

        providerPools[providerType][providerIndex] = updatedProvider;

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Updated provider ${providerUuid} in ${providerType}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'update',
            filePath: filePath,
            providerType,
            providerConfig: updatedProvider,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Provider updated successfully',
            provider: updatedProvider
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 删除特定提供商配置
 */
export async function handleDeleteProvider(req, res, currentConfig, providerPoolManager, providerType, providerUuid) {
    try {
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Find and remove the provider
        const providers = providerPools[providerType] || [];
        const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
        
        if (providerIndex === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
            return true;
        }

        const deletedProvider = providers[providerIndex];
        providers.splice(providerIndex, 1);

        // Remove the entire provider type if no providers left
        if (providers.length === 0) {
            delete providerPools[providerType];
        }

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Deleted provider ${providerUuid} from ${providerType}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'delete',
            filePath: filePath,
            providerType,
            providerConfig: deletedProvider,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Provider deleted successfully',
            deletedProvider
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 禁用/启用特定提供商配置
 */
export async function handleDisableEnableProvider(req, res, currentConfig, providerPoolManager, providerType, providerUuid, action) {
    try {
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Find and update the provider
        const providers = providerPools[providerType] || [];
        const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
        
        if (providerIndex === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
            return true;
        }

        // Update isDisabled field
        const provider = providers[providerIndex];
        provider.isDisabled = action === 'disable';
        
        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] ${action === 'disable' ? 'Disabled' : 'Enabled'} provider ${providerUuid} in ${providerType}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            
            // Call the appropriate method
            if (action === 'disable') {
                providerPoolManager.disableProvider(providerType, provider);
            } else {
                providerPoolManager.enableProvider(providerType, provider);
            }
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: action,
            filePath: filePath,
            providerType,
            providerConfig: provider,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `Provider ${action}d successfully`,
            provider: provider
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 重置特定提供商类型的所有提供商健康状态
 */
export async function handleResetProviderHealth(req, res, currentConfig, providerPoolManager, providerType) {
    try {
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Reset health status for all providers of this type
        const providers = providerPools[providerType] || [];
        
        if (providers.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'No providers found for this type' } }));
            return true;
        }

        let resetCount = 0;
        providers.forEach(provider => {
            // 统计 isHealthy 从 false 变为 true 的节点数量
            if (!provider.isHealthy) {
                resetCount++;
            }
            // 重置所有节点的状态
            provider.isHealthy = true;
            provider.errorCount = 0;
            provider.refreshCount = 0;
            provider.needsRefresh = false;
            provider.lastErrorTime = null;
        });

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Reset health status for ${resetCount} providers in ${providerType}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'reset_health',
            filePath: filePath,
            providerType,
            resetCount,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `Successfully reset health status for ${resetCount} providers`,
            resetCount,
            totalCount: providers.length
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 删除特定提供商类型的所有不健康节点
 */
export async function handleDeleteUnhealthyProviders(req, res, currentConfig, providerPoolManager, providerType) {
    try {
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Find and remove unhealthy providers
        const providers = providerPools[providerType] || [];
        
        if (providers.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'No providers found for this type' } }));
            return true;
        }

        // Filter out unhealthy providers (keep only healthy ones)
        const unhealthyProviders = providers.filter(p => !p.isHealthy);
        const healthyProviders = providers.filter(p => p.isHealthy);
        
        if (unhealthyProviders.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'No unhealthy providers to delete',
                deletedCount: 0,
                remainingCount: providers.length
            }));
            return true;
        }

        // Update the provider pool with only healthy providers
        if (healthyProviders.length === 0) {
            delete providerPools[providerType];
        } else {
            providerPools[providerType] = healthyProviders;
        }

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Deleted ${unhealthyProviders.length} unhealthy providers from ${providerType}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'delete_unhealthy',
            filePath: filePath,
            providerType,
            deletedCount: unhealthyProviders.length,
            deletedProviders: unhealthyProviders.map(p => ({ uuid: p.uuid, customName: p.customName })),
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `Successfully deleted ${unhealthyProviders.length} unhealthy providers`,
            deletedCount: unhealthyProviders.length,
            remainingCount: healthyProviders.length,
            deletedProviders: unhealthyProviders.map(p => ({ uuid: p.uuid, customName: p.customName }))
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 批量刷新特定提供商类型的所有不健康节点的 UUID
 */
export async function handleRefreshUnhealthyUuids(req, res, currentConfig, providerPoolManager, providerType) {
    try {
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Find unhealthy providers
        const providers = providerPools[providerType] || [];
        
        if (providers.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'No providers found for this type' } }));
            return true;
        }

        // Filter unhealthy providers and refresh their UUIDs
        const refreshedProviders = [];
        for (const provider of providers) {
            if (!provider.isHealthy) {
                const oldUuid = provider.uuid;
                const newUuid = generateUUID();
                provider.uuid = newUuid;
                refreshedProviders.push({
                    oldUuid,
                    newUuid,
                    customName: provider.customName
                });
            }
        }

        if (refreshedProviders.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'No unhealthy providers to refresh',
                refreshedCount: 0,
                totalCount: providers.length
            }));
            return true;
        }

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Refreshed UUIDs for ${refreshedProviders.length} unhealthy providers in ${providerType}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'refresh_unhealthy_uuids',
            filePath: filePath,
            providerType,
            refreshedCount: refreshedProviders.length,
            refreshedProviders,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `Successfully refreshed UUIDs for ${refreshedProviders.length} unhealthy providers`,
            refreshedCount: refreshedProviders.length,
            totalCount: providers.length,
            refreshedProviders
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 对特定提供商类型的所有提供商执行健康检查
 */
export async function handleHealthCheck(req, res, currentConfig, providerPoolManager, providerType) {
    try {
        if (!providerPoolManager) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Provider pool manager not initialized' } }));
            return true;
        }

        const providers = providerPoolManager.providerStatus[providerType] || [];
        
        if (providers.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'No providers found for this type' } }));
            return true;
        }

        // 只检测不健康的节点
        const unhealthyProviders = providers.filter(ps => !ps.config.isHealthy);
        
        if (unhealthyProviders.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'No unhealthy providers to check',
                successCount: 0,
                failCount: 0,
                totalCount: providers.length,
                results: []
            }));
            return true;
        }

        logger.info(`[UI API] Starting health check for ${unhealthyProviders.length} unhealthy providers in ${providerType} (total: ${providers.length})`);

        // 执行健康检测（强制检查，忽略 checkHealth 配置）
        const results = [];
        for (const providerStatus of unhealthyProviders) {
            const providerConfig = providerStatus.config;
            
            // 跳过已禁用的节点
            if (providerConfig.isDisabled) {
                logger.info(`[UI API] Skipping health check for disabled provider: ${providerConfig.uuid}`);
                continue;
            }

            try {
                // 传递 forceCheck = true 强制执行健康检查，忽略 checkHealth 配置
                const healthResult = await providerPoolManager._checkProviderHealth(providerType, providerConfig, true);
                
                if (healthResult === null) {
                    results.push({
                        uuid: providerConfig.uuid,
                        success: null,
                        message: 'Health check not supported for this provider type'
                    });
                    continue;
                }
                
                if (healthResult.success) {
                    providerPoolManager.markProviderHealthy(providerType, providerConfig, false, healthResult.modelName);
                    results.push({
                        uuid: providerConfig.uuid,
                        success: true,
                        modelName: healthResult.modelName,
                        message: 'Healthy'
                    });
                } else {
                    // 检查是否为认证错误（401/403），如果是则立即标记为不健康
                    const errorMessage = healthResult.errorMessage || 'Check failed';
                    const isAuthError = /\b(401|403)\b/.test(errorMessage) ||
                                       /\b(Unauthorized|Forbidden|AccessDenied|InvalidToken|ExpiredToken)\b/i.test(errorMessage);
                    
                    if (isAuthError) {
                        providerPoolManager.markProviderUnhealthyImmediately(providerType, providerConfig, errorMessage);
                        logger.info(`[UI API] Auth error detected for ${providerConfig.uuid}, immediately marked as unhealthy`);
                    } else {
                        providerPoolManager.markProviderUnhealthy(providerType, providerConfig, errorMessage);
                    }
                    
                    providerStatus.config.lastHealthCheckTime = new Date().toISOString();
                    if (healthResult.modelName) {
                        providerStatus.config.lastHealthCheckModel = healthResult.modelName;
                    }
                    results.push({
                        uuid: providerConfig.uuid,
                        success: false,
                        modelName: healthResult.modelName,
                        message: errorMessage,
                        isAuthError: isAuthError
                    });
                }
            } catch (error) {
                const errorMessage = error.message || 'Unknown error';
                // 检查是否为认证错误（401/403），如果是则立即标记为不健康
                const isAuthError = /\b(401|403)\b/.test(errorMessage) ||
                                   /\b(Unauthorized|Forbidden|AccessDenied|InvalidToken|ExpiredToken)\b/i.test(errorMessage);
                
                if (isAuthError) {
                    providerPoolManager.markProviderUnhealthyImmediately(providerType, providerConfig, errorMessage);
                    logger.info(`[UI API] Auth error detected for ${providerConfig.uuid}, immediately marked as unhealthy`);
                } else {
                    providerPoolManager.markProviderUnhealthy(providerType, providerConfig, errorMessage);
                }
                
                results.push({
                    uuid: providerConfig.uuid,
                    success: false,
                    message: errorMessage,
                    isAuthError: isAuthError
                });
            }
        }

        // 保存更新后的状态到文件
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        
        // 从 providerStatus 构建 providerPools 对象并保存
        const providerPools = {};
        for (const pType in providerPoolManager.providerStatus) {
            providerPools[pType] = providerPoolManager.providerStatus[pType].map(ps => ps.config);
        }
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');

        const successCount = results.filter(r => r.success === true).length;
        const failCount = results.filter(r => r.success === false).length;

        logger.info(`[UI API] Health check completed for ${providerType}: ${successCount} recovered, ${failCount} still unhealthy (checked ${unhealthyProviders.length} unhealthy nodes)`);

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'health_check',
            filePath: filePath,
            providerType,
            results,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `Health check completed: ${successCount} healthy, ${failCount} unhealthy`,
            successCount,
            failCount,
            totalCount: providers.length,
            results
        }));
        return true;
    } catch (error) {
        logger.error('[UI API] Health check error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 快速链接配置文件到对应的提供商
 * 支持单个文件路径或文件路径数组
 */
export async function handleQuickLinkProvider(req, res, currentConfig, providerPoolManager) {
    try {
        const body = await getRequestBody(req);
        const { filePath, filePaths } = body;

        // 支持单个文件路径或文件路径数组
        const pathsToLink = filePaths || (filePath ? [filePath] : []);

        if (!pathsToLink || pathsToLink.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'filePath or filePaths is required' } }));
            return true;
        }

        const poolsFilePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        
        // Load existing pools
        let providerPools = {};
        if (existsSync(poolsFilePath)) {
            try {
                const fileContent = readFileSync(poolsFilePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                logger.warn('[UI API] Failed to read existing provider pools:', readError.message);
            }
        }

        const results = [];
        const linkedProviders = [];

        // 处理每个文件路径
        for (const currentFilePath of pathsToLink) {
            const normalizedPath = currentFilePath.replace(/\\/g, '/').toLowerCase();
            
            // 根据文件路径自动识别提供商类型
            const providerMapping = detectProviderFromPath(normalizedPath);
            
            if (!providerMapping) {
                results.push({
                    filePath: currentFilePath,
                    success: false,
                    error: 'Unable to identify provider type for config file'
                });
                continue;
            }

            const { providerType, credPathKey, defaultCheckModel, displayName } = providerMapping;

            // Ensure provider type array exists
            if (!providerPools[providerType]) {
                providerPools[providerType] = [];
            }

            // Check if already linked - 使用标准化路径进行比较
            const normalizedForComparison = currentFilePath.replace(/\\/g, '/');
            const isAlreadyLinked = providerPools[providerType].some(p => {
                const existingPath = p[credPathKey];
                if (!existingPath) return false;
                const normalizedExistingPath = existingPath.replace(/\\/g, '/');
                return normalizedExistingPath === normalizedForComparison ||
                       normalizedExistingPath === './' + normalizedForComparison ||
                       './' + normalizedExistingPath === normalizedForComparison;
            });

            if (isAlreadyLinked) {
                results.push({
                    filePath: currentFilePath,
                    success: false,
                    error: 'This config file is already linked',
                    providerType: providerType
                });
                continue;
            }

            // Create new provider config based on provider type
            const newProvider = createProviderConfig({
                credPathKey,
                credPath: formatSystemPath(currentFilePath),
                defaultCheckModel,
                needsProjectId: providerMapping.needsProjectId
            });

            providerPools[providerType].push(newProvider);
            linkedProviders.push({ providerType, provider: newProvider });

            results.push({
                filePath: currentFilePath,
                success: true,
                providerType: providerType,
                displayName: displayName,
                provider: newProvider
            });

            logger.info(`[UI API] Quick linked config: ${currentFilePath} -> ${providerType}`);
        }

        // Save to file only if there were successful links
        const successCount = results.filter(r => r.success).length;
        if (successCount > 0) {
            writeFileSync(poolsFilePath, JSON.stringify(providerPools, null, 2), 'utf-8');

            // Update provider pool manager if available
            if (providerPoolManager) {
                providerPoolManager.providerPools = providerPools;
                providerPoolManager.initializeProviderStatus();
            }

            // Broadcast update events
            broadcastEvent('config_update', {
                action: 'quick_link_batch',
                filePath: poolsFilePath,
                results: results,
                timestamp: new Date().toISOString()
            });

            for (const { providerType, provider } of linkedProviders) {
                broadcastEvent('provider_update', {
                    action: 'add',
                    providerType,
                    providerConfig: provider,
                    timestamp: new Date().toISOString()
                });
            }
        }

        const failCount = results.filter(r => !r.success).length;
        const message = successCount > 0
            ? `Successfully linked ${successCount} config file(s)${failCount > 0 ? `, ${failCount} failed` : ''}`
            : `Failed to link all ${failCount} config file(s)`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: successCount > 0,
            message: message,
            successCount: successCount,
            failCount: failCount,
            results: results
        }));
        return true;
    } catch (error) {
        logger.error('[UI API] Quick link failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Link failed: ' + error.message
            }
        }));
        return true;
    }
}

/**
 * 刷新特定提供商的UUID
 */
export async function handleRefreshProviderUuid(req, res, currentConfig, providerPoolManager, providerType, providerUuid) {
    try {
        const filePath = currentConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
        let providerPools = {};
        
        // Load existing pools
        if (existsSync(filePath)) {
            try {
                const fileContent = readFileSync(filePath, 'utf-8');
                providerPools = JSON.parse(fileContent);
            } catch (readError) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Provider pools file not found' } }));
                return true;
            }
        }

        // Find the provider
        const providers = providerPools[providerType] || [];
        const providerIndex = providers.findIndex(p => p.uuid === providerUuid);
        
        if (providerIndex === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
            return true;
        }

        // Generate new UUID
        const oldUuid = providerUuid;
        const newUuid = generateUUID();
        
        // Update provider UUID
        providerPools[providerType][providerIndex].uuid = newUuid;

        // Save to file
        writeFileSync(filePath, JSON.stringify(providerPools, null, 2), 'utf-8');
        logger.info(`[UI API] Refreshed UUID for provider in ${providerType}: ${oldUuid} -> ${newUuid}`);

        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = providerPools;
            providerPoolManager.initializeProviderStatus();
        }

        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'refresh_uuid',
            filePath: filePath,
            providerType,
            oldUuid,
            newUuid,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'UUID refreshed successfully',
            oldUuid,
            newUuid,
            provider: providerPools[providerType][providerIndex]
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

function maskSecret(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    if (!raw) return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.length <= 12) {
        return `${trimmed.slice(0, 4)}***`;
    }
    return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function maskProxyUrl(value) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        const protocol = url.protocol || 'http:';
        const host = url.hostname;
        const port = url.port ? `:${url.port}` : '';
        if (!host) return '';
        return `${protocol}//${host}${port}`;
    } catch {
        return '';
    }
}

function redactInlineCredentials(text) {
    const raw = text === undefined || text === null ? '' : String(text);
    if (!raw) return '';
    // Redact any userinfo portion of URLs: scheme://userinfo@host -> scheme://***@host
    return raw.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/]+)@/g, (_m, prefix) => `${prefix}***@`);
}

function resolveAbsoluteConfigPath(candidatePath) {
    const raw = candidatePath === undefined || candidatePath === null ? '' : String(candidatePath).trim();
    if (!raw) return '';
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function getKiroUsageLimitsUrl(region, authMethod, profileArn) {
    const safeRegion = String(region || 'us-east-1').trim() || 'us-east-1';
    const base = `https://q.${safeRegion}.amazonaws.com/getUsageLimits`;
    const params = new URLSearchParams({
        isEmailRequired: 'true',
        origin: 'AI_EDITOR',
        resourceType: 'AGENTIC_REQUEST'
    });
    if (String(authMethod || '').toLowerCase() === 'social' && profileArn) {
        params.append('profileArn', String(profileArn).trim());
    }
    return `${base}?${params.toString()}`;
}

function buildKiroUsageHeaders(accessToken, machineId) {
    const osPlatform = os.platform();
    const osRelease = os.release();
    const nodeVersion = process.version.replace('v', '');

    let osName = osPlatform;
    if (osPlatform === 'win32') osName = `windows#${osRelease}`;
    else if (osPlatform === 'darwin') osName = `macos#${osRelease}`;
    else osName = `${osPlatform}#${osRelease}`;

    const kiroVersion = '0.8.140';
    const safeMachineId = String(machineId || '').trim() || crypto.randomUUID();
    const userAgentSuffix = `KiroIDE-${kiroVersion}-${safeMachineId}`;

    return {
        'Authorization': `Bearer ${accessToken}`,
        'x-amz-user-agent': `aws-sdk-js/1.0.0 ${userAgentSuffix}`,
        'User-Agent': `aws-sdk-js/1.0.0 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererruntime#1.0.0 m/E ${userAgentSuffix}`,
        'amz-sdk-invocation-id': crypto.randomUUID(),
        'amz-sdk-request': 'attempt=1; max=1',
        'Accept': 'application/json',
        'Connection': 'close'
    };
}

function selectProviderConfig(providerPoolManager, providerType, uuid, currentConfig) {
    if (providerPoolManager?.providerPools?.[providerType]) {
        const list = providerPoolManager.providerPools[providerType];
        const found = Array.isArray(list) ? list.find((p) => p && p.uuid === uuid) : null;
        if (found) return found;
    }

    // Fallback: load from file (matches handleGetProviderType behavior)
    const filePath = currentConfig?.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
    if (filePath && existsSync(filePath)) {
        try {
            const pools = JSON.parse(readFileSync(filePath, 'utf-8'));
            const list = pools?.[providerType];
            const found = Array.isArray(list) ? list.find((p) => p && p.uuid === uuid) : null;
            if (found) return found;
        } catch {}
    }
    return null;
}

function resolveNodeProxyUrl(providerConfig, currentConfig, providerType) {
    const hasNodeOverride = providerConfig && Object.prototype.hasOwnProperty.call(providerConfig, 'PROXY_URL');
    if (hasNodeOverride) {
        // Explicit override semantics: '' disables proxy inheritance.
        return providerConfig.PROXY_URL;
    }
    if (isProxyEnabledForProvider(currentConfig, providerType)) {
        return currentConfig?.PROXY_URL;
    }
    return undefined;
}

/**
 * Provider inspection endpoint (safe metadata only; never returns raw tokens).
 * Today this is implemented for claude-kiro-oauth to mirror Kiro-account-manager visibility.
 */
export async function handleInspectProvider(req, res, currentConfig, providerPoolManager, providerType, providerUuid) {
    try {
        if (providerType !== 'claude-kiro-oauth') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: `Inspect is only supported for claude-kiro-oauth (got ${providerType})` }
            }));
            return true;
        }

        const providerConfig = selectProviderConfig(providerPoolManager, providerType, providerUuid, currentConfig);
        if (!providerConfig) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Provider not found' } }));
            return true;
        }

        const credsPathRaw = providerConfig.KIRO_OAUTH_CREDS_FILE_PATH || '';
        const credsPathAbs = resolveAbsoluteConfigPath(credsPathRaw);
        if (!credsPathAbs) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: 'No KIRO_OAUTH_CREDS_FILE_PATH bound to this provider node.' }
            }));
            return true;
        }
        if (!existsSync(credsPathAbs)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: `Credential file not found: ${credsPathRaw}` }
            }));
            return true;
        }

        let credentials = null;
        try {
            credentials = JSON.parse(readFileSync(credsPathAbs, 'utf-8'));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: `Failed to parse credential file: ${e.message}` }
            }));
            return true;
        }

        const accessToken = credentials?.accessToken || '';
        const refreshToken = credentials?.refreshToken || '';
        const clientId = credentials?.clientId || '';
        const profileArn = credentials?.profileArn || '';
        const authMethod = credentials?.authMethod || providerConfig.authMethod || '';
        const idcRegion = credentials?.idcRegion || credentials?.region || providerConfig.idcRegion || providerConfig.region || 'us-east-1';
        const startUrl = credentials?.startUrl || providerConfig.startUrl || '';

        const machineId =
            providerConfig.machineId ||
            providerConfig.KIRO_MACHINE_ID ||
            credentials?.machineId ||
            credentials?.KIRO_MACHINE_ID ||
            providerUuid;

        const nodeProxyUrl = resolveNodeProxyUrl(providerConfig, currentConfig, providerType);
        const proxyMasked = maskProxyUrl(nodeProxyUrl);

        const expiresAt = credentials?.expiresAt || '';
        const expiresAtMs = expiresAt ? Date.parse(String(expiresAt)) : NaN;
        const now = Date.now();
        const expiresInMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - now) : null;

        const result = {
            providerType,
            uuid: providerUuid,
            node: {
                uuid: providerConfig.uuid,
                customName: providerConfig.customName || '',
                accountId: providerConfig.accountId || providerConfig.KIRO_ACCOUNT_ID || credentials?.accountId || credentials?.accountID || '',
                authMethod: providerConfig.authMethod || '',
                isHealthy: providerConfig.isHealthy !== false,
                needsRefresh: providerConfig.needsRefresh === true,
                isDisabled: providerConfig.isDisabled === true,
                lastError: providerConfig.lastError
                    ? redactInlineCredentials(String(providerConfig.lastError)).slice(0, 240)
                    : '',
                proxy: proxyMasked || '',
                machineId: machineId ? maskSecret(machineId) : ''
            },
            credentials: {
                path: credsPathRaw,
                authMethod: authMethod ? String(authMethod) : '',
                region: idcRegion ? String(idcRegion) : '',
                startUrl: startUrl ? String(startUrl) : '',
                profileArn: profileArn ? maskSecret(profileArn) : '',
                clientId: clientId ? maskSecret(clientId) : '',
                accessToken: accessToken ? maskSecret(accessToken) : '',
                refreshToken: refreshToken ? maskSecret(refreshToken) : '',
                expiresAt: expiresAt ? String(expiresAt) : '',
                expiresInMs
            },
            usageLimits: {
                ok: false,
                statusCode: null,
                error: null,
                userInfo: null,
                usedCount: null,
                limitCount: null,
                nextDateReset: null
            }
        };

        // Enrich with usage limits/user info (best-effort, never fails the endpoint).
        if (accessToken) {
            try {
                const url = getKiroUsageLimitsUrl(idcRegion, authMethod, profileArn);
                const headers = buildKiroUsageHeaders(accessToken, machineId);

                const proxyCandidate = nodeProxyUrl === undefined ? '' : String(nodeProxyUrl || '').trim();
                const proxyConfig = proxyCandidate ? parseProxyUrl(proxyCandidate) : null;
                const axiosConfig = {
                    timeout: 15000,
                    headers,
                    proxy: false
                };
                if (proxyConfig) {
                    axiosConfig.httpAgent = proxyConfig.httpAgent;
                    axiosConfig.httpsAgent = proxyConfig.httpsAgent;
                }

                const response = await axios.get(url, axiosConfig);
                const data = response?.data || {};
                result.usageLimits.ok = true;
                result.usageLimits.statusCode = response?.status || 200;
                result.usageLimits.userInfo = data?.userInfo
                    ? {
                        email: data.userInfo.email || '',
                        userId: data.userInfo.userId || '',
                        status: data.userInfo.status || ''
                    }
                    : null;
                result.usageLimits.usedCount = data?.usedCount ?? null;
                result.usageLimits.limitCount = data?.limitCount ?? null;
                result.usageLimits.nextDateReset = data?.nextDateReset ?? null;
            } catch (e) {
                const statusCode = e?.response?.status ?? null;
                const msg = e?.message ? String(e.message) : 'Usage limits request failed';
                result.usageLimits.ok = false;
                result.usageLimits.statusCode = statusCode;
                result.usageLimits.error = msg.slice(0, 240);
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return true;
    } catch (error) {
        logger.error('[UI API] Provider inspect failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}
