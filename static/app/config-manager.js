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
        if (modelProviderEl) modelProviderEl.value = data.MODEL_PROVIDER || 'gemini-cli-oauth';
        if (systemPromptEl) systemPromptEl.value = data.systemPrompt || '';
        
        // Gemini CLI OAuth
        const projectIdEl = document.getElementById('projectId');
        const geminiOauthCredsBase64El = document.getElementById('geminiOauthCredsBase64');
        const geminiOauthCredsFilePathEl = document.getElementById('geminiOauthCredsFilePath');
        
        if (projectIdEl) projectIdEl.value = data.PROJECT_ID || '';
        if (geminiOauthCredsBase64El) geminiOauthCredsBase64El.value = data.GEMINI_OAUTH_CREDS_BASE64 || '';
        if (geminiOauthCredsFilePathEl) geminiOauthCredsFilePathEl.value = data.GEMINI_OAUTH_CREDS_FILE_PATH || '';
        const geminiBaseUrlEl = document.getElementById('geminiBaseUrl');
        if (geminiBaseUrlEl) geminiBaseUrlEl.value = data.GEMINI_BASE_URL || '';
        const antigravityBaseUrlDailyEl = document.getElementById('antigravityBaseUrlDaily');
        if (antigravityBaseUrlDailyEl) antigravityBaseUrlDailyEl.value = data.ANTIGRAVITY_BASE_URL_DAILY || '';
        const antigravityBaseUrlAutopushEl = document.getElementById('antigravityBaseUrlAutopush');
        if (antigravityBaseUrlAutopushEl) antigravityBaseUrlAutopushEl.value = data.ANTIGRAVITY_BASE_URL_AUTOPUSH || '';
        
        // OpenAI Custom
        const openaiApiKeyEl = document.getElementById('openaiApiKey');
        const openaiBaseUrlEl = document.getElementById('openaiBaseUrl');
        
        if (openaiApiKeyEl) openaiApiKeyEl.value = data.OPENAI_API_KEY || '';
        if (openaiBaseUrlEl) openaiBaseUrlEl.value = data.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        
        // Claude Custom
        const claudeApiKeyEl = document.getElementById('claudeApiKey');
        const claudeBaseUrlEl = document.getElementById('claudeBaseUrl');
        
        if (claudeApiKeyEl) claudeApiKeyEl.value = data.CLAUDE_API_KEY || '';
        if (claudeBaseUrlEl) claudeBaseUrlEl.value = data.CLAUDE_BASE_URL || 'https://api.anthropic.com';
        
        // Claude Kiro OAuth
        const kiroOauthCredsBase64El = document.getElementById('kiroOauthCredsBase64');
        const kiroOauthCredsFilePathEl = document.getElementById('kiroOauthCredsFilePath');
        
        if (kiroOauthCredsBase64El) kiroOauthCredsBase64El.value = data.KIRO_OAUTH_CREDS_BASE64 || '';
        if (kiroOauthCredsFilePathEl) kiroOauthCredsFilePathEl.value = data.KIRO_OAUTH_CREDS_FILE_PATH || '';
        const kiroBaseUrlEl = document.getElementById('kiroBaseUrl');
        if (kiroBaseUrlEl) kiroBaseUrlEl.value = data.KIRO_BASE_URL || '';
        const kiroRefreshUrlEl = document.getElementById('kiroRefreshUrl');
        if (kiroRefreshUrlEl) kiroRefreshUrlEl.value = data.KIRO_REFRESH_URL || '';
        const kiroRefreshIdcUrlEl = document.getElementById('kiroRefreshIdcUrl');
        if (kiroRefreshIdcUrlEl) kiroRefreshIdcUrlEl.value = data.KIRO_REFRESH_IDC_URL || '';
        
        // Qwen OAuth
        const qwenOauthCredsFilePathEl = document.getElementById('qwenOauthCredsFilePath');
        if (qwenOauthCredsFilePathEl) qwenOauthCredsFilePathEl.value = data.QWEN_OAUTH_CREDS_FILE_PATH || '';
        const qwenBaseUrlEl = document.getElementById('qwenBaseUrl');
        if (qwenBaseUrlEl) qwenBaseUrlEl.value = data.QWEN_BASE_URL || '';
        const qwenOauthBaseUrlEl = document.getElementById('qwenOauthBaseUrl');
        if (qwenOauthBaseUrlEl) qwenOauthBaseUrlEl.value = data.QWEN_OAUTH_BASE_URL || '';
        
        // OpenAI Responses
        const openaiResponsesApiKeyEl = document.getElementById('openaiResponsesApiKey');
        const openaiResponsesBaseUrlEl = document.getElementById('openaiResponsesBaseUrl');
        
        if (openaiResponsesApiKeyEl) openaiResponsesApiKeyEl.value = data.OPENAI_API_KEY || '';
        if (openaiResponsesBaseUrlEl) openaiResponsesBaseUrlEl.value = data.OPENAI_BASE_URL || 'https://api.openai.com/v1';

        // 高级配置参数
        const systemPromptFilePathEl = document.getElementById('systemPromptFilePath');
        const systemPromptModeEl = document.getElementById('systemPromptMode');
        const promptLogBaseNameEl = document.getElementById('promptLogBaseName');
        const promptLogModeEl = document.getElementById('promptLogMode');
        const requestMaxRetriesEl = document.getElementById('requestMaxRetries');
        const requestBaseDelayEl = document.getElementById('requestBaseDelay');
        const cronNearMinutesEl = document.getElementById('cronNearMinutes');
        const cronRefreshTokenEl = document.getElementById('cronRefreshToken');
        const providerPoolsFilePathEl = document.getElementById('providerPoolsFilePath');
        const maxErrorCountEl = document.getElementById('maxErrorCount');
        const providerFallbackChainEl = document.getElementById('providerFallbackChain');

        if (systemPromptFilePathEl) systemPromptFilePathEl.value = data.SYSTEM_PROMPT_FILE_PATH || 'input_system_prompt.txt';
        if (systemPromptModeEl) systemPromptModeEl.value = data.SYSTEM_PROMPT_MODE || 'append';
        if (promptLogBaseNameEl) promptLogBaseNameEl.value = data.PROMPT_LOG_BASE_NAME || 'prompt_log';
        if (promptLogModeEl) promptLogModeEl.value = data.PROMPT_LOG_MODE || 'none';
        if (requestMaxRetriesEl) requestMaxRetriesEl.value = data.REQUEST_MAX_RETRIES || 3;
        if (requestBaseDelayEl) requestBaseDelayEl.value = data.REQUEST_BASE_DELAY || 1000;
        if (cronNearMinutesEl) cronNearMinutesEl.value = data.CRON_NEAR_MINUTES || 1;
        if (cronRefreshTokenEl) cronRefreshTokenEl.checked = data.CRON_REFRESH_TOKEN || false;
        if (providerPoolsFilePathEl) providerPoolsFilePathEl.value = data.PROVIDER_POOLS_FILE_PATH;
        if (maxErrorCountEl) maxErrorCountEl.value = data.MAX_ERROR_COUNT || 3;
        
        // 加载 Fallback 链配置
        if (providerFallbackChainEl) {
            if (data.providerFallbackChain && typeof data.providerFallbackChain === 'object') {
                providerFallbackChainEl.value = JSON.stringify(data.providerFallbackChain, null, 2);
            } else {
                providerFallbackChainEl.value = '';
            }
        }

        // 触发提供商配置显示
        handleProviderChange();
        
        // 根据Gemini凭据类型设置显示
        const geminiCredsType = data.GEMINI_OAUTH_CREDS_BASE64 ? 'base64' : 'file';
        const geminiRadio = document.querySelector(`input[name="geminiCredsType"][value="${geminiCredsType}"]`);
        if (geminiRadio) {
            geminiRadio.checked = true;
            handleGeminiCredsTypeChange({ target: geminiRadio });
        }
        
        // 根据Kiro凭据类型设置显示
        const kiroCredsType = data.KIRO_OAUTH_CREDS_BASE64 ? 'base64' : 'file';
        const kiroRadio = document.querySelector(`input[name="kiroCredsType"][value="${kiroCredsType}"]`);
        if (kiroRadio) {
            kiroRadio.checked = true;
            handleKiroCredsTypeChange({ target: kiroRadio });
        }
        
        // 检查并设置提供商池菜单显示状态
        // const providerPoolsFilePath = data.PROVIDER_POOLS_FILE_PATH;
        // const providersMenuItem = document.querySelector('.nav-item[data-section="providers"]');
        // if (providerPoolsFilePath && providerPoolsFilePath.trim() !== '') {
        //     if (providersMenuItem) providersMenuItem.style.display = 'flex';
        // } else {
        //     if (providersMenuItem) providersMenuItem.style.display = 'none';
        // }
        
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

/**
 * 保存配置
 */
async function saveConfiguration() {
    const config = {
        REQUIRED_API_KEY: document.getElementById('apiKey')?.value || '',
        HOST: document.getElementById('host')?.value || '127.0.0.1',
        SERVER_PORT: parseInt(document.getElementById('port')?.value || 3000),
        MODEL_PROVIDER: document.getElementById('modelProvider')?.value || 'gemini-cli-oauth',
        systemPrompt: document.getElementById('systemPrompt')?.value || '',
    };

    // 获取后台登录密码（如果有输入）
    const adminPassword = document.getElementById('adminPassword')?.value || '';

    // 根据不同提供商保存不同的配置
    const provider = document.getElementById('modelProvider')?.value;
    
    switch (provider) {
        case 'gemini-cli-oauth':
            config.PROJECT_ID = document.getElementById('projectId')?.value || '';
            const geminiCredsType = document.querySelector('input[name="geminiCredsType"]:checked')?.value;
            if (geminiCredsType === 'base64') {
                config.GEMINI_OAUTH_CREDS_BASE64 = document.getElementById('geminiOauthCredsBase64')?.value || '';
                config.GEMINI_OAUTH_CREDS_FILE_PATH = null;
            } else {
                config.GEMINI_OAUTH_CREDS_BASE64 = null;
                config.GEMINI_OAUTH_CREDS_FILE_PATH = document.getElementById('geminiOauthCredsFilePath')?.value || '';
            }
            config.GEMINI_BASE_URL = document.getElementById('geminiBaseUrl')?.value || null;
            break;

        case 'gemini-antigravity':
            config.ANTIGRAVITY_BASE_URL_DAILY = document.getElementById('antigravityBaseUrlDaily')?.value || null;
            config.ANTIGRAVITY_BASE_URL_AUTOPUSH = document.getElementById('antigravityBaseUrlAutopush')?.value || null;
            config.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH = document.getElementById('antigravityOauthCredsFilePath')?.value || '';
            break;
            
        case 'openai-custom':
            config.OPENAI_API_KEY = document.getElementById('openaiApiKey')?.value || '';
            config.OPENAI_BASE_URL = document.getElementById('openaiBaseUrl')?.value || '';
            break;
            
        case 'claude-custom':
            config.CLAUDE_API_KEY = document.getElementById('claudeApiKey')?.value || '';
            config.CLAUDE_BASE_URL = document.getElementById('claudeBaseUrl')?.value || '';
            break;
            
        case 'claude-kiro-oauth':
            const kiroCredsType = document.querySelector('input[name="kiroCredsType"]:checked')?.value;
            if (kiroCredsType === 'base64') {
                config.KIRO_OAUTH_CREDS_BASE64 = document.getElementById('kiroOauthCredsBase64')?.value || '';
                config.KIRO_OAUTH_CREDS_FILE_PATH = null;
            } else {
                config.KIRO_OAUTH_CREDS_BASE64 = null;
                config.KIRO_OAUTH_CREDS_FILE_PATH = document.getElementById('kiroOauthCredsFilePath')?.value || '';
            }
            config.KIRO_BASE_URL = document.getElementById('kiroBaseUrl')?.value || null;
            config.KIRO_REFRESH_URL = document.getElementById('kiroRefreshUrl')?.value || null;
            config.KIRO_REFRESH_IDC_URL = document.getElementById('kiroRefreshIdcUrl')?.value || null;
            break;
            
        case 'openai-qwen-oauth':
            config.QWEN_OAUTH_CREDS_FILE_PATH = document.getElementById('qwenOauthCredsFilePath')?.value || '';
            config.QWEN_BASE_URL = document.getElementById('qwenBaseUrl')?.value || null;
            config.QWEN_OAUTH_BASE_URL = document.getElementById('qwenOauthBaseUrl')?.value || null;
            break;
            
        case 'openaiResponses-custom':
            config.OPENAI_API_KEY = document.getElementById('openaiResponsesApiKey')?.value || '';
            config.OPENAI_BASE_URL = document.getElementById('openaiResponsesBaseUrl')?.value || '';
            break;
    }

    // 保存高级配置参数
    config.SYSTEM_PROMPT_FILE_PATH = document.getElementById('systemPromptFilePath')?.value || 'input_system_prompt.txt';
    config.SYSTEM_PROMPT_MODE = document.getElementById('systemPromptMode')?.value || 'append';
    config.PROMPT_LOG_BASE_NAME = document.getElementById('promptLogBaseName')?.value || '';
    config.PROMPT_LOG_MODE = document.getElementById('promptLogMode')?.value || '';
    config.REQUEST_MAX_RETRIES = parseInt(document.getElementById('requestMaxRetries')?.value || 3);
    config.REQUEST_BASE_DELAY = parseInt(document.getElementById('requestBaseDelay')?.value || 1000);
    config.CRON_NEAR_MINUTES = parseInt(document.getElementById('cronNearMinutes')?.value || 1);
    config.CRON_REFRESH_TOKEN = document.getElementById('cronRefreshToken')?.checked || false;
    config.PROVIDER_POOLS_FILE_PATH = document.getElementById('providerPoolsFilePath')?.value || '';
    config.MAX_ERROR_COUNT = parseInt(document.getElementById('maxErrorCount')?.value || 3);
    
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