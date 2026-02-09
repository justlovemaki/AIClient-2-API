// 配置管理模块

import { showToast, formatUptime } from './utils.js';
import { handleProviderChange, handleGeminiCredsTypeChange, handleKiroCredsTypeChange } from './event-handlers.js';
import { loadProviders } from './provider-manager.js';
import { t } from './i18n.js';

/**
 * 加载配置
 */
async function loadConfiguration() {
    try {
        const data = await window.apiClient.get('/config');

        // 基础配置
        const apiKeyEl = document.getElementById('apiKey');
        const hostEl = document.getElementById('host');
        const portEl = document.getElementById('port');
        const modelProviderEl = document.getElementById('modelProvider');
        const systemPromptEl = document.getElementById('systemPrompt');

        if (apiKeyEl) apiKeyEl.value = data.REQUIRED_API_KEY || '';
        if (hostEl) hostEl.value = data.HOST || '127.0.0.1';
        if (portEl) portEl.value = data.SERVER_PORT || 3000;
        
        if (modelProviderEl) {
            // 处理多选 MODEL_PROVIDER (标签按钮)
            const providers = Array.isArray(data.DEFAULT_MODEL_PROVIDERS)
                ? data.DEFAULT_MODEL_PROVIDERS
                : (typeof data.MODEL_PROVIDER === 'string' ? data.MODEL_PROVIDER.split(',') : []);
            
            const tags = modelProviderEl.querySelectorAll('.provider-tag');
            tags.forEach(tag => {
                const value = tag.getAttribute('data-value');
                if (providers.includes(value)) {
                    tag.classList.add('selected');
                } else {
                    tag.classList.remove('selected');
                }
            });
            
            // 如果没有任何选中的，默认选中第一个（保持兼容性）
            const anySelected = Array.from(tags).some(tag => tag.classList.contains('selected'));
            if (!anySelected && tags.length > 0) {
                tags[0].classList.add('selected');
            }

            // 为标签按钮添加点击事件监听
            tags.forEach(tag => {
                // 移除旧的监听器（通过克隆节点）
                const newTag = tag.cloneNode(true);
                tag.parentNode.replaceChild(newTag, tag);
                
                newTag.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isSelected = newTag.classList.contains('selected');
                    const selectedCount = modelProviderEl.querySelectorAll('.provider-tag.selected').length;
                    
                    // 如果当前是选中状态且只剩一个选中的，不允许取消
                    if (isSelected && selectedCount === 1) {
                        showToast(t('common.warning'), t('config.modelProviderRequired'), 'warning');
                        return;
                    }
                    
                    // 切换选中状态
                    newTag.classList.toggle('selected');
                });
            });
        }
        
        if (systemPromptEl) systemPromptEl.value = data.systemPrompt || '';

        // 高级配置参数
        const systemPromptFilePathEl = document.getElementById('systemPromptFilePath');
        const systemPromptModeEl = document.getElementById('systemPromptMode');
        const promptLogBaseNameEl = document.getElementById('promptLogBaseName');
        const promptLogModeEl = document.getElementById('promptLogMode');
        const requestMaxRetriesEl = document.getElementById('requestMaxRetries');
        const requestBaseDelayEl = document.getElementById('requestBaseDelay');
        const cronNearMinutesEl = document.getElementById('cronNearMinutes');
        const cronRefreshTokenEl = document.getElementById('cronRefreshToken');
        const loginExpiryEl = document.getElementById('loginExpiry');
        const providerPoolsFilePathEl = document.getElementById('providerPoolsFilePath');

        const maxErrorCountEl = document.getElementById('maxErrorCount');
        const warmupTargetEl = document.getElementById('warmupTarget');
        const refreshConcurrencyPerProviderEl = document.getElementById('refreshConcurrencyPerProvider');
        const providerFallbackChainEl = document.getElementById('providerFallbackChain');
        const modelFallbackMappingEl = document.getElementById('modelFallbackMapping');

        if (systemPromptFilePathEl) systemPromptFilePathEl.value = data.SYSTEM_PROMPT_FILE_PATH || 'configs/input_system_prompt.txt';
        if (systemPromptModeEl) systemPromptModeEl.value = data.SYSTEM_PROMPT_MODE || 'append';
        if (promptLogBaseNameEl) promptLogBaseNameEl.value = data.PROMPT_LOG_BASE_NAME || 'prompt_log';
        if (promptLogModeEl) promptLogModeEl.value = data.PROMPT_LOG_MODE || 'none';
        if (requestMaxRetriesEl) requestMaxRetriesEl.value = data.REQUEST_MAX_RETRIES || 3;
        if (requestBaseDelayEl) requestBaseDelayEl.value = data.REQUEST_BASE_DELAY || 1000;
        
        // 坏凭证切换最大重试次数
        const credentialSwitchMaxRetriesEl = document.getElementById('credentialSwitchMaxRetries');
        if (credentialSwitchMaxRetriesEl) credentialSwitchMaxRetriesEl.value = data.CREDENTIAL_SWITCH_MAX_RETRIES || 5;
        
        if (cronNearMinutesEl) cronNearMinutesEl.value = data.CRON_NEAR_MINUTES || 1;
        if (cronRefreshTokenEl) cronRefreshTokenEl.checked = data.CRON_REFRESH_TOKEN || false;
        if (loginExpiryEl) loginExpiryEl.value = data.LOGIN_EXPIRY || 3600;
        if (providerPoolsFilePathEl) providerPoolsFilePathEl.value = data.PROVIDER_POOLS_FILE_PATH;
        if (maxErrorCountEl) maxErrorCountEl.value = data.MAX_ERROR_COUNT || 10;
        if (warmupTargetEl) warmupTargetEl.value = data.WARMUP_TARGET || 0;
        if (refreshConcurrencyPerProviderEl) refreshConcurrencyPerProviderEl.value = data.REFRESH_CONCURRENCY_PER_PROVIDER || 1;
        
        // 加载 Fallback 链配置
        if (providerFallbackChainEl) {
            if (data.providerFallbackChain && typeof data.providerFallbackChain === 'object') {
                providerFallbackChainEl.value = JSON.stringify(data.providerFallbackChain, null, 2);
            } else {
                providerFallbackChainEl.value = '';
            }
        }

        // 加载 Model Fallback 映射配置
        if (modelFallbackMappingEl) {
            if (data.modelFallbackMapping && typeof data.modelFallbackMapping === 'object') {
                modelFallbackMappingEl.value = JSON.stringify(data.modelFallbackMapping, null, 2);
            } else {
                modelFallbackMappingEl.value = '';
            }
        }
        
        // 加载代理配置
        const proxyUrlEl = document.getElementById('proxyUrl');
        if (proxyUrlEl) proxyUrlEl.value = data.PROXY_URL || '';
        
        // 加载启用代理的提供商 (标签按钮)
        const proxyProvidersEl = document.getElementById('proxyProviders');
        if (proxyProvidersEl) {
            const enabledProviders = data.PROXY_ENABLED_PROVIDERS || [];
            const proxyTags = proxyProvidersEl.querySelectorAll('.provider-tag');
            
            proxyTags.forEach(tag => {
                const value = tag.getAttribute('data-value');
                if (enabledProviders.includes(value)) {
                    tag.classList.add('selected');
                } else {
                    tag.classList.remove('selected');
                }
            });
            
            // 为代理提供商标签按钮添加点击事件监听
            proxyTags.forEach(tag => {
                // 移除旧的监听器（通过克隆节点）
                const newTag = tag.cloneNode(true);
                tag.parentNode.replaceChild(newTag, tag);
                
                newTag.addEventListener('click', (e) => {
                    e.preventDefault();
                    // 代理提供商可以全部取消选择，所以不需要检查最少选择数量
                    newTag.classList.toggle('selected');
                });
            });
        }
        
        // 加载日志配置
        const logEnabledEl = document.getElementById('logEnabled');
        const logOutputModeEl = document.getElementById('logOutputMode');
        const logLevelEl = document.getElementById('logLevel');
        const logDirEl = document.getElementById('logDir');
        const logIncludeRequestIdEl = document.getElementById('logIncludeRequestId');
        const logIncludeTimestampEl = document.getElementById('logIncludeTimestamp');
        const logMaxFileSizeEl = document.getElementById('logMaxFileSize');
        const logMaxFilesEl = document.getElementById('logMaxFiles');
        
        if (logEnabledEl) logEnabledEl.checked = data.LOG_ENABLED !== false;
        if (logOutputModeEl) logOutputModeEl.value = data.LOG_OUTPUT_MODE || 'all';
        if (logLevelEl) logLevelEl.value = data.LOG_LEVEL || 'info';
        if (logDirEl) logDirEl.value = data.LOG_DIR || 'logs';
        if (logIncludeRequestIdEl) logIncludeRequestIdEl.checked = data.LOG_INCLUDE_REQUEST_ID !== false;
        if (logIncludeTimestampEl) logIncludeTimestampEl.checked = data.LOG_INCLUDE_TIMESTAMP !== false;
        if (logMaxFileSizeEl) logMaxFileSizeEl.value = data.LOG_MAX_FILE_SIZE || 10485760;
        if (logMaxFilesEl) logMaxFilesEl.value = data.LOG_MAX_FILES || 10;
        
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

/**
 * 保存配置
 */
async function saveConfiguration() {
    const modelProviderEl = document.getElementById('modelProvider');
    let selectedProviders = [];
    if (modelProviderEl) {
        // 从标签按钮中获取选中的提供商
        selectedProviders = Array.from(modelProviderEl.querySelectorAll('.provider-tag.selected'))
            .map(tag => tag.getAttribute('data-value'));
    }

    // 校验：必须至少勾选一个
    if (selectedProviders.length === 0) {
        showToast(t('common.error'), t('config.modelProviderRequired'), 'error');
        return;
    }

    const config = {
        REQUIRED_API_KEY: document.getElementById('apiKey')?.value || '',
        HOST: document.getElementById('host')?.value || '127.0.0.1',
        SERVER_PORT: parseInt(document.getElementById('port')?.value || 3000),
        MODEL_PROVIDER: selectedProviders.length > 0 ? selectedProviders.join(',') : 'gemini-cli-oauth',
        systemPrompt: document.getElementById('systemPrompt')?.value || '',
    };

    // 获取后台登录密码（如果有输入）
    const adminPassword = document.getElementById('adminPassword')?.value || '';

    // 保存高级配置参数
    config.SYSTEM_PROMPT_FILE_PATH = document.getElementById('systemPromptFilePath')?.value || 'configs/input_system_prompt.txt';
    config.SYSTEM_PROMPT_MODE = document.getElementById('systemPromptMode')?.value || 'append';
    config.PROMPT_LOG_BASE_NAME = document.getElementById('promptLogBaseName')?.value || '';
    config.PROMPT_LOG_MODE = document.getElementById('promptLogMode')?.value || '';
    config.REQUEST_MAX_RETRIES = parseInt(document.getElementById('requestMaxRetries')?.value || 3);
    config.REQUEST_BASE_DELAY = parseInt(document.getElementById('requestBaseDelay')?.value || 1000);
    config.CREDENTIAL_SWITCH_MAX_RETRIES = parseInt(document.getElementById('credentialSwitchMaxRetries')?.value || 5);
    config.CRON_NEAR_MINUTES = parseInt(document.getElementById('cronNearMinutes')?.value || 1);
    config.CRON_REFRESH_TOKEN = document.getElementById('cronRefreshToken')?.checked || false;
    config.LOGIN_EXPIRY = parseInt(document.getElementById('loginExpiry')?.value || 3600);
    config.PROVIDER_POOLS_FILE_PATH = document.getElementById('providerPoolsFilePath')?.value || '';
    config.MAX_ERROR_COUNT = parseInt(document.getElementById('maxErrorCount')?.value || 10);
    config.WARMUP_TARGET = parseInt(document.getElementById('warmupTarget')?.value || 0);
    config.REFRESH_CONCURRENCY_PER_PROVIDER = parseInt(document.getElementById('refreshConcurrencyPerProvider')?.value || 1);
    
    // 保存 Fallback 链配置
    const fallbackChainValue = document.getElementById('providerFallbackChain')?.value?.trim() || '';
    if (fallbackChainValue) {
        try {
            config.providerFallbackChain = JSON.parse(fallbackChainValue);
        } catch (e) {
            showToast(t('common.error'), t('config.advanced.fallbackChainInvalid') || 'Fallback 链配置格式无效，请输入有效的 JSON', 'error');
            return;
        }
    } else {
        config.providerFallbackChain = {};
    }

    // 保存 Model Fallback 映射配置
    const modelFallbackMappingValue = document.getElementById('modelFallbackMapping')?.value?.trim() || '';
    if (modelFallbackMappingValue) {
        try {
            config.modelFallbackMapping = JSON.parse(modelFallbackMappingValue);
        } catch (e) {
            showToast(t('common.error'), t('config.advanced.modelFallbackMappingInvalid') || 'Model Fallback 映射配置格式无效，请输入有效的 JSON', 'error');
            return;
        }
    } else {
        config.modelFallbackMapping = {};
    }
    
    // 保存代理配置
    config.PROXY_URL = document.getElementById('proxyUrl')?.value?.trim() || null;
    
    // 获取启用代理的提供商列表 (从标签按钮)
    const proxyProvidersEl = document.getElementById('proxyProviders');
    if (proxyProvidersEl) {
        config.PROXY_ENABLED_PROVIDERS = Array.from(proxyProvidersEl.querySelectorAll('.provider-tag.selected'))
            .map(tag => tag.getAttribute('data-value'));
    } else {
        config.PROXY_ENABLED_PROVIDERS = [];
    }
    
    // 保存日志配置
    config.LOG_ENABLED = document.getElementById('logEnabled')?.checked !== false;
    config.LOG_OUTPUT_MODE = document.getElementById('logOutputMode')?.value || 'all';
    config.LOG_LEVEL = document.getElementById('logLevel')?.value || 'info';
    config.LOG_DIR = document.getElementById('logDir')?.value || 'logs';
    config.LOG_INCLUDE_REQUEST_ID = document.getElementById('logIncludeRequestId')?.checked !== false;
    config.LOG_INCLUDE_TIMESTAMP = document.getElementById('logIncludeTimestamp')?.checked !== false;
    config.LOG_MAX_FILE_SIZE = parseInt(document.getElementById('logMaxFileSize')?.value || 10485760);
    config.LOG_MAX_FILES = parseInt(document.getElementById('logMaxFiles')?.value || 10);

    try {
        await window.apiClient.post('/config', config);
        
        // 如果输入了新密码，单独保存密码
        if (adminPassword) {
            try {
                await window.apiClient.post('/admin-password', { password: adminPassword });
                // 清空密码输入框
                const adminPasswordEl = document.getElementById('adminPassword');
                if (adminPasswordEl) adminPasswordEl.value = '';
                showToast(t('common.success'), t('common.passwordUpdated'), 'success');
            } catch (pwdError) {
                console.error('Failed to save admin password:', pwdError);
                showToast(t('common.error'), t('common.error') + ': ' + pwdError.message, 'error');
            }
        }
        
        await window.apiClient.post('/reload-config');
        showToast(t('common.success'), t('common.configSaved'), 'success');
        
        // 检查当前是否在提供商池管理页面，如果是则刷新数据
        const providersSection = document.getElementById('providers');
        if (providersSection && providersSection.classList.contains('active')) {
            // 当前在提供商池页面，刷新数据
            await loadProviders();
            showToast(t('common.success'), t('common.providerPoolRefreshed'), 'success');
        }
    } catch (error) {
        console.error('Failed to save configuration:', error);
        showToast(t('common.error'), t('common.error') + ': ' + error.message, 'error');
    }
}

export {
    loadConfiguration,
    saveConfiguration
};
