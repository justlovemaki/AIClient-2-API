import { existsSync, readFileSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
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
        console.log('[UI API] Configuration reloaded:');

        // Update initApiService - 清空并重新初始化服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);
        initApiService(CONFIG);
        
        console.log('[UI API] Configuration reloaded successfully');
        
        return newConfig;
    } catch (error) {
        console.error('[UI API] Failed to reload configuration:', error);
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
            console.warn('[UI API] Failed to read system prompt file:', e.message);
        }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        ...currentConfig,
        systemPrompt
    }));
    return true;
}

/**
 * 更新配置
 */
export async function handleUpdateConfig(req, res, currentConfig) {
    try {
        const body = await getRequestBody(req);
        const newConfig = body;

        // Update config values in memory
        if (newConfig.REQUIRED_API_KEY !== undefined) currentConfig.REQUIRED_API_KEY = newConfig.REQUIRED_API_KEY;
        if (newConfig.HOST !== undefined) currentConfig.HOST = newConfig.HOST;
        if (newConfig.SERVER_PORT !== undefined) currentConfig.SERVER_PORT = newConfig.SERVER_PORT;
        if (newConfig.MODEL_PROVIDER !== undefined) currentConfig.MODEL_PROVIDER = newConfig.MODEL_PROVIDER;
        if (newConfig.SYSTEM_PROMPT_FILE_PATH !== undefined) currentConfig.SYSTEM_PROMPT_FILE_PATH = newConfig.SYSTEM_PROMPT_FILE_PATH;
        if (newConfig.SYSTEM_PROMPT_MODE !== undefined) currentConfig.SYSTEM_PROMPT_MODE = newConfig.SYSTEM_PROMPT_MODE;
        if (newConfig.PROMPT_LOG_BASE_NAME !== undefined) currentConfig.PROMPT_LOG_BASE_NAME = newConfig.PROMPT_LOG_BASE_NAME;
        if (newConfig.PROMPT_LOG_MODE !== undefined) currentConfig.PROMPT_LOG_MODE = newConfig.PROMPT_LOG_MODE;
        if (newConfig.REQUEST_MAX_RETRIES !== undefined) currentConfig.REQUEST_MAX_RETRIES = newConfig.REQUEST_MAX_RETRIES;
        if (newConfig.REQUEST_BASE_DELAY !== undefined) currentConfig.REQUEST_BASE_DELAY = newConfig.REQUEST_BASE_DELAY;
        if (newConfig.CREDENTIAL_SWITCH_MAX_RETRIES !== undefined) currentConfig.CREDENTIAL_SWITCH_MAX_RETRIES = newConfig.CREDENTIAL_SWITCH_MAX_RETRIES;
        if (newConfig.CRON_NEAR_MINUTES !== undefined) currentConfig.CRON_NEAR_MINUTES = newConfig.CRON_NEAR_MINUTES;
        if (newConfig.CRON_REFRESH_TOKEN !== undefined) currentConfig.CRON_REFRESH_TOKEN = newConfig.CRON_REFRESH_TOKEN;
        if (newConfig.PROVIDER_POOLS_FILE_PATH !== undefined) currentConfig.PROVIDER_POOLS_FILE_PATH = newConfig.PROVIDER_POOLS_FILE_PATH;
        if (newConfig.MAX_ERROR_COUNT !== undefined) currentConfig.MAX_ERROR_COUNT = newConfig.MAX_ERROR_COUNT;
        if (newConfig.providerFallbackChain !== undefined) currentConfig.providerFallbackChain = newConfig.providerFallbackChain;
        if (newConfig.modelFallbackMapping !== undefined) currentConfig.modelFallbackMapping = newConfig.modelFallbackMapping;
        
        // Proxy settings
        if (newConfig.PROXY_URL !== undefined) currentConfig.PROXY_URL = newConfig.PROXY_URL;
        if (newConfig.PROXY_ENABLED_PROVIDERS !== undefined) currentConfig.PROXY_ENABLED_PROVIDERS = newConfig.PROXY_ENABLED_PROVIDERS;

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
                
                console.log('[UI API] System prompt updated');
            } catch (e) {
                console.warn('[UI API] Failed to write system prompt:', e.message);
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
                PROVIDER_POOLS_FILE_PATH: currentConfig.PROVIDER_POOLS_FILE_PATH,
                MAX_ERROR_COUNT: currentConfig.MAX_ERROR_COUNT,
                providerFallbackChain: currentConfig.providerFallbackChain,
                modelFallbackMapping: currentConfig.modelFallbackMapping,
                PROXY_URL: currentConfig.PROXY_URL,
                PROXY_ENABLED_PROVIDERS: currentConfig.PROXY_ENABLED_PROVIDERS
            };

            writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
            console.log('[UI API] Configuration saved to configs/config.json');
            
            // 广播更新事件
            broadcastEvent('config_update', {
                action: 'update',
                filePath: 'configs/config.json',
                type: 'main_config',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[UI API] Failed to save configuration to file:', error.message);
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
        console.error('[UI API] Failed to reload config files:', error);
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
            res.end(JSON.stringify({
                error: {
                    message: 'Password cannot be empty'
                }
            }));
            return true;
        }

        // 写入密码到 pwd 文件
        const pwdFilePath = path.join(process.cwd(), 'configs', 'pwd');
        await fs.writeFile(pwdFilePath, password.trim(), 'utf-8');
        
        console.log('[UI API] Admin password updated successfully');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Admin password updated successfully'
        }));
        return true;
    } catch (error) {
        console.error('[UI API] Failed to update admin password:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to update password: ' + error.message
            }
        }));
        return true;
    }
}