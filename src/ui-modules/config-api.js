import { existsSync, readFileSync, writeFileSync } from 'fs';
import logger from '../utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../core/config-manager.js';
import { serviceInstances } from '../providers/adapter.js';
import { initApiService } from '../services/service-manager.js';
import { getRequestBody } from '../utils/common.js';
import { broadcastEvent } from '../ui-modules/event-broadcast.js';

/**
 * 重载配置文件
 * 动态导入config-manager并重新初始化配置
 * @returns {Promise<Object>} 返回重载后的配置对象
 */
export async function reloadConfig(providerPoolManager) {
    try {
        // Import config manager dynamically
        const { initializeConfig } = await import('../core/config-manager.js');
        
        // Reload main config
        const newConfig = await initializeConfig(process.argv.slice(2), 'configs/config.json');
        // Update provider pool manager if available
        if (providerPoolManager) {
            providerPoolManager.providerPools = newConfig.providerPools;
            providerPoolManager.initializeProviderStatus();
        }
        
        // Update global CONFIG
        Object.assign(CONFIG, newConfig);
        logger.info('[UI API] Configuration reloaded:');

        // Update initApiService - 清空并重新初始化服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);
        initApiService(CONFIG);
        
        logger.info('[UI API] Configuration reloaded successfully');
        
        return newConfig;
    } catch (error) {
        logger.error('[UI API] Failed to reload configuration:', error);
        throw error;
    }
}

/**
 * 获取配置
 */
export async function handleGetConfig(req, res, currentConfig) {
    let systemPrompt = '';

    if (currentConfig.SYSTEM_PROMPT_FILE_PATH && existsSync(currentConfig.SYSTEM_PROMPT_FILE_PATH)) {
        try {
            systemPrompt = readFileSync(currentConfig.SYSTEM_PROMPT_FILE_PATH, 'utf-8');
        } catch (e) {
            logger.warn('[UI API] Failed to read system prompt file:', e.message);
        }
    }

    // 白名单过滤：只返回前端需要的字段，避免泄露凭据路径、内部状态等敏感信息
    const safeConfig = {
        HOST: currentConfig.HOST,
        SERVER_PORT: currentConfig.SERVER_PORT,
        MODEL_PROVIDER: currentConfig.MODEL_PROVIDER,
        SYSTEM_PROMPT_FILE_PATH: currentConfig.SYSTEM_PROMPT_FILE_PATH,
        SYSTEM_PROMPT_MODE: currentConfig.SYSTEM_PROMPT_MODE,
        PROMPT_LOG_BASE_NAME: currentConfig.PROMPT_LOG_BASE_NAME,
        PROMPT_LOG_MODE: currentConfig.PROMPT_LOG_MODE,
        REQUEST_MAX_RETRIES: currentConfig.REQUEST_MAX_RETRIES,
        REQUEST_BASE_DELAY: currentConfig.REQUEST_BASE_DELAY,
        CREDENTIAL_SWITCH_MAX_RETRIES: currentConfig.CREDENTIAL_SWITCH_MAX_RETRIES,
        CRON_NEAR_MINUTES: currentConfig.CRON_NEAR_MINUTES,
        CRON_REFRESH_TOKEN: currentConfig.CRON_REFRESH_TOKEN,
        LOGIN_EXPIRY: currentConfig.LOGIN_EXPIRY,
        PROVIDER_POOLS_FILE_PATH: currentConfig.PROVIDER_POOLS_FILE_PATH,
        MAX_ERROR_COUNT: currentConfig.MAX_ERROR_COUNT,
        WARMUP_TARGET: currentConfig.WARMUP_TARGET,
        REFRESH_CONCURRENCY_PER_PROVIDER: currentConfig.REFRESH_CONCURRENCY_PER_PROVIDER,
        providerFallbackChain: currentConfig.providerFallbackChain,
        modelFallbackMapping: currentConfig.modelFallbackMapping,
        PROXY_URL: currentConfig.PROXY_URL,
        PROXY_ENABLED_PROVIDERS: currentConfig.PROXY_ENABLED_PROVIDERS,
        TLS_SIDECAR_ENABLED: currentConfig.TLS_SIDECAR_ENABLED,
        TLS_SIDECAR_ENABLED_PROVIDERS: currentConfig.TLS_SIDECAR_ENABLED_PROVIDERS,
        TLS_SIDECAR_PORT: currentConfig.TLS_SIDECAR_PORT,
        TLS_SIDECAR_PROXY_URL: currentConfig.TLS_SIDECAR_PROXY_URL,
        LOG_ENABLED: currentConfig.LOG_ENABLED,
        LOG_OUTPUT_MODE: currentConfig.LOG_OUTPUT_MODE,
        LOG_LEVEL: currentConfig.LOG_LEVEL,
        LOG_DIR: currentConfig.LOG_DIR,
        LOG_INCLUDE_REQUEST_ID: currentConfig.LOG_INCLUDE_REQUEST_ID,
        LOG_INCLUDE_TIMESTAMP: currentConfig.LOG_INCLUDE_TIMESTAMP,
        LOG_MAX_FILE_SIZE: currentConfig.LOG_MAX_FILE_SIZE,
        LOG_MAX_FILES: currentConfig.LOG_MAX_FILES,
        SCHEDULED_HEALTH_CHECK: currentConfig.SCHEDULED_HEALTH_CHECK,
        // 脱敏：只返回是否设置了 API Key，不返回原文
        REQUIRED_API_KEY: currentConfig.REQUIRED_API_KEY ? '******' : '',
        systemPrompt,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(safeConfig));
    return true;
}

/**
 * 更新配置
 */
export async function handleUpdateConfig(req, res, currentConfig) {
    try {
        const body = await getRequestBody(req);
        const newConfig = body;

        // Update config values in memory（含类型校验）
        if (newConfig.REQUIRED_API_KEY !== undefined) {
            if (typeof newConfig.REQUIRED_API_KEY === 'string') currentConfig.REQUIRED_API_KEY = newConfig.REQUIRED_API_KEY;
        }
        if (newConfig.HOST !== undefined) {
            if (typeof newConfig.HOST === 'string' && newConfig.HOST.length > 0) currentConfig.HOST = newConfig.HOST;
        }
        if (newConfig.SERVER_PORT !== undefined) {
            const port = Number(newConfig.SERVER_PORT);
            if (Number.isInteger(port) && port > 0 && port < 65536) currentConfig.SERVER_PORT = port;
        }
        if (newConfig.MODEL_PROVIDER !== undefined) currentConfig.MODEL_PROVIDER = newConfig.MODEL_PROVIDER;
        if (newConfig.SYSTEM_PROMPT_FILE_PATH !== undefined) {
            const p = String(newConfig.SYSTEM_PROMPT_FILE_PATH);
            // 防止路径遍历：只允许相对路径或限定目录
            if (!p.includes('..')) currentConfig.SYSTEM_PROMPT_FILE_PATH = p;
        }
        if (newConfig.SYSTEM_PROMPT_MODE !== undefined) currentConfig.SYSTEM_PROMPT_MODE = newConfig.SYSTEM_PROMPT_MODE;
        if (newConfig.PROMPT_LOG_BASE_NAME !== undefined) currentConfig.PROMPT_LOG_BASE_NAME = newConfig.PROMPT_LOG_BASE_NAME;
        if (newConfig.PROMPT_LOG_MODE !== undefined) currentConfig.PROMPT_LOG_MODE = newConfig.PROMPT_LOG_MODE;
        if (newConfig.REQUEST_MAX_RETRIES !== undefined) {
            const v = Number(newConfig.REQUEST_MAX_RETRIES);
            if (Number.isInteger(v) && v >= 0 && v <= 100) currentConfig.REQUEST_MAX_RETRIES = v;
        }
        if (newConfig.REQUEST_BASE_DELAY !== undefined) currentConfig.REQUEST_BASE_DELAY = newConfig.REQUEST_BASE_DELAY;
        if (newConfig.CREDENTIAL_SWITCH_MAX_RETRIES !== undefined) currentConfig.CREDENTIAL_SWITCH_MAX_RETRIES = newConfig.CREDENTIAL_SWITCH_MAX_RETRIES;
        if (newConfig.CRON_NEAR_MINUTES !== undefined) currentConfig.CRON_NEAR_MINUTES = newConfig.CRON_NEAR_MINUTES;
        if (newConfig.CRON_REFRESH_TOKEN !== undefined) currentConfig.CRON_REFRESH_TOKEN = newConfig.CRON_REFRESH_TOKEN;
        if (newConfig.LOGIN_EXPIRY !== undefined) currentConfig.LOGIN_EXPIRY = newConfig.LOGIN_EXPIRY;
        if (newConfig.PROVIDER_POOLS_FILE_PATH !== undefined) currentConfig.PROVIDER_POOLS_FILE_PATH = newConfig.PROVIDER_POOLS_FILE_PATH;
        if (newConfig.MAX_ERROR_COUNT !== undefined) currentConfig.MAX_ERROR_COUNT = newConfig.MAX_ERROR_COUNT;
        if (newConfig.WARMUP_TARGET !== undefined) currentConfig.WARMUP_TARGET = newConfig.WARMUP_TARGET;
        if (newConfig.REFRESH_CONCURRENCY_PER_PROVIDER !== undefined) currentConfig.REFRESH_CONCURRENCY_PER_PROVIDER = newConfig.REFRESH_CONCURRENCY_PER_PROVIDER;
        if (newConfig.providerFallbackChain !== undefined) currentConfig.providerFallbackChain = newConfig.providerFallbackChain;
        if (newConfig.modelFallbackMapping !== undefined) currentConfig.modelFallbackMapping = newConfig.modelFallbackMapping;
        
        // Proxy settings
        if (newConfig.PROXY_URL !== undefined) currentConfig.PROXY_URL = newConfig.PROXY_URL;
        if (newConfig.PROXY_ENABLED_PROVIDERS !== undefined) currentConfig.PROXY_ENABLED_PROVIDERS = newConfig.PROXY_ENABLED_PROVIDERS;

        // TLS Sidecar settings
        if (newConfig.TLS_SIDECAR_ENABLED !== undefined) currentConfig.TLS_SIDECAR_ENABLED = newConfig.TLS_SIDECAR_ENABLED;
        if (newConfig.TLS_SIDECAR_ENABLED_PROVIDERS !== undefined) currentConfig.TLS_SIDECAR_ENABLED_PROVIDERS = newConfig.TLS_SIDECAR_ENABLED_PROVIDERS;
        if (newConfig.TLS_SIDECAR_PORT !== undefined) currentConfig.TLS_SIDECAR_PORT = newConfig.TLS_SIDECAR_PORT;
        if (newConfig.TLS_SIDECAR_PROXY_URL !== undefined) currentConfig.TLS_SIDECAR_PROXY_URL = newConfig.TLS_SIDECAR_PROXY_URL;

        // Log settings
        if (newConfig.LOG_ENABLED !== undefined) currentConfig.LOG_ENABLED = newConfig.LOG_ENABLED;
        if (newConfig.LOG_OUTPUT_MODE !== undefined) currentConfig.LOG_OUTPUT_MODE = newConfig.LOG_OUTPUT_MODE;
        if (newConfig.LOG_LEVEL !== undefined) currentConfig.LOG_LEVEL = newConfig.LOG_LEVEL;
        if (newConfig.LOG_DIR !== undefined) currentConfig.LOG_DIR = newConfig.LOG_DIR;
        if (newConfig.LOG_INCLUDE_REQUEST_ID !== undefined) currentConfig.LOG_INCLUDE_REQUEST_ID = newConfig.LOG_INCLUDE_REQUEST_ID;
        if (newConfig.LOG_INCLUDE_TIMESTAMP !== undefined) currentConfig.LOG_INCLUDE_TIMESTAMP = newConfig.LOG_INCLUDE_TIMESTAMP;
        if (newConfig.LOG_MAX_FILE_SIZE !== undefined) currentConfig.LOG_MAX_FILE_SIZE = newConfig.LOG_MAX_FILE_SIZE;
        if (newConfig.LOG_MAX_FILES !== undefined) currentConfig.LOG_MAX_FILES = newConfig.LOG_MAX_FILES;

        // Scheduled Health Check settings
        if (newConfig.SCHEDULED_HEALTH_CHECK !== undefined) {
             const incoming = newConfig.SCHEDULED_HEALTH_CHECK;
             const newInterval = (() => {
                 const val = Number(incoming?.interval);
                 return isNaN(val) ? 600000 : Math.max(60000, val);
             })();
             currentConfig.SCHEDULED_HEALTH_CHECK = {
                 enabled: incoming?.enabled === true,
                 startupRun: incoming?.startupRun !== false,
                 interval: newInterval,
                 providerTypes: Array.isArray(incoming?.providerTypes) ? incoming.providerTypes : []
             };
             
             // 如果定时器已存在且 enabled，仅在 interval 实际变化时重新加载 timer
             const previousInterval = currentConfig.SCHEDULED_HEALTH_CHECK._activeInterval;
             if (globalThis.reloadHealthCheckTimer && currentConfig.SCHEDULED_HEALTH_CHECK.enabled && newInterval !== previousInterval) {
                 currentConfig.SCHEDULED_HEALTH_CHECK._activeInterval = newInterval;
                 globalThis.reloadHealthCheckTimer(newInterval);
             }
        }

        // Handle system prompt update
        if (newConfig.systemPrompt !== undefined) {
            const promptPath = currentConfig.SYSTEM_PROMPT_FILE_PATH || 'configs/input_system_prompt.txt';
            try {
                const relativePath = path.relative(process.cwd(), promptPath);
                writeFileSync(promptPath, newConfig.systemPrompt, 'utf-8');

                // 广播更新事件
                broadcastEvent('config_update', {
                    action: 'update',
                    filePath: relativePath,
                    type: 'system_prompt',
                    timestamp: new Date().toISOString()
                });
                
                logger.info('[UI API] System prompt updated');
            } catch (e) {
                logger.warn('[UI API] Failed to write system prompt:', e.message);
            }
        }

        // Update config.json file
        try {
            const configPath = 'configs/config.json';
            
            // Create a clean config object for saving (exclude runtime-only properties)
            const configToSave = {
                REQUIRED_API_KEY: currentConfig.REQUIRED_API_KEY,
                SERVER_PORT: currentConfig.SERVER_PORT,
                HOST: currentConfig.HOST,
                MODEL_PROVIDER: currentConfig.MODEL_PROVIDER,
                SYSTEM_PROMPT_FILE_PATH: currentConfig.SYSTEM_PROMPT_FILE_PATH,
                SYSTEM_PROMPT_MODE: currentConfig.SYSTEM_PROMPT_MODE,
                PROMPT_LOG_BASE_NAME: currentConfig.PROMPT_LOG_BASE_NAME,
                PROMPT_LOG_MODE: currentConfig.PROMPT_LOG_MODE,
                REQUEST_MAX_RETRIES: currentConfig.REQUEST_MAX_RETRIES,
                REQUEST_BASE_DELAY: currentConfig.REQUEST_BASE_DELAY,
                CREDENTIAL_SWITCH_MAX_RETRIES: currentConfig.CREDENTIAL_SWITCH_MAX_RETRIES,
                CRON_NEAR_MINUTES: currentConfig.CRON_NEAR_MINUTES,
                CRON_REFRESH_TOKEN: currentConfig.CRON_REFRESH_TOKEN,
                LOGIN_EXPIRY: currentConfig.LOGIN_EXPIRY,
                PROVIDER_POOLS_FILE_PATH: currentConfig.PROVIDER_POOLS_FILE_PATH,
                MAX_ERROR_COUNT: currentConfig.MAX_ERROR_COUNT,
                WARMUP_TARGET: currentConfig.WARMUP_TARGET,
                REFRESH_CONCURRENCY_PER_PROVIDER: currentConfig.REFRESH_CONCURRENCY_PER_PROVIDER,
                providerFallbackChain: currentConfig.providerFallbackChain,
                modelFallbackMapping: currentConfig.modelFallbackMapping,
                PROXY_URL: currentConfig.PROXY_URL,
                PROXY_ENABLED_PROVIDERS: currentConfig.PROXY_ENABLED_PROVIDERS,
                LOG_ENABLED: currentConfig.LOG_ENABLED,
                LOG_OUTPUT_MODE: currentConfig.LOG_OUTPUT_MODE,
                LOG_LEVEL: currentConfig.LOG_LEVEL,
                LOG_DIR: currentConfig.LOG_DIR,
                LOG_INCLUDE_REQUEST_ID: currentConfig.LOG_INCLUDE_REQUEST_ID,
                LOG_INCLUDE_TIMESTAMP: currentConfig.LOG_INCLUDE_TIMESTAMP,
                LOG_MAX_FILE_SIZE: currentConfig.LOG_MAX_FILE_SIZE,
                LOG_MAX_FILES: currentConfig.LOG_MAX_FILES,
                TLS_SIDECAR_ENABLED: currentConfig.TLS_SIDECAR_ENABLED,
                TLS_SIDECAR_ENABLED_PROVIDERS: currentConfig.TLS_SIDECAR_ENABLED_PROVIDERS,
                TLS_SIDECAR_PORT: currentConfig.TLS_SIDECAR_PORT,
                TLS_SIDECAR_PROXY_URL: currentConfig.TLS_SIDECAR_PROXY_URL,
                SCHEDULED_HEALTH_CHECK: currentConfig.SCHEDULED_HEALTH_CHECK
            };

            writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
            logger.info('[UI API] Configuration saved to configs/config.json');
            
            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'update',
                filePath: 'configs/config.json',
                type: 'main_config',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[UI API] Failed to save configuration to file:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Failed to save configuration to file: ' + error.message,
                    partial: true  // Indicate that memory config was updated but not saved
                }
            }));
            return true;
        }

        // Update the global CONFIG object to reflect changes immediately
        Object.assign(CONFIG, currentConfig);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Configuration updated successfully',
            details: 'Configuration has been updated in both memory and config.json file'
        }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 重载配置文件
 */
export async function handleReloadConfig(req, res, providerPoolManager) {
    try {
        // 调用重载配置函数
        const newConfig = await reloadConfig(providerPoolManager);
        
        // 广播更新事件
        broadcastEvent('config_update', {
            action: 'reload',
            filePath: 'configs/config.json',
            providerPoolsPath: newConfig.PROVIDER_POOLS_FILE_PATH || null,
            timestamp: new Date().toISOString()
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Configuration files reloaded successfully',
            details: {
                configReloaded: true,
                configPath: 'configs/config.json',
                providerPoolsPath: newConfig.PROVIDER_POOLS_FILE_PATH || null
            }
        }));
        return true;
    } catch (error) {
        logger.error('[UI API] Failed to reload config files:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to reload configuration files: ' + error.message
            }
        }));
        return true;
    }
}

/**
 * 更新管理员密码
 */
export async function handleUpdateAdminPassword(req, res) {
    try {
        const body = await getRequestBody(req);
        const { password } = body;

        if (!password || password.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Password cannot be empty' } }));
            return true;
        }

        if (password.trim().length < 8) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Password must be at least 8 characters' } }));
            return true;
        }

        // 使用 PBKDF2 哈希存储密码，避免明文写入文件
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password.trim(), salt, 100000, 64, 'sha512').toString('hex');
        const stored = `pbkdf2:${salt}:${hash}`;

        const pwdFilePath = path.join(process.cwd(), 'configs', 'pwd');
        await fs.writeFile(pwdFilePath, stored, 'utf-8');
        
        logger.info('[UI API] Admin password updated successfully');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Admin password updated successfully'
        }));
        return true;
    } catch (error) {
        logger.error('[UI API] Failed to update admin password:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to update password: ' + error.message
            }
        }));
        return true;
    }
}