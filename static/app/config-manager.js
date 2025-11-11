// 配置管理模块

import { showToast, formatUptime } from './utils.js';
import { handleProviderChange, handleGeminiCredsTypeChange, handleKiroCredsTypeChange } from './event-handlers.js';

/**
 * 加载配置
 */
async function loadConfiguration() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();

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
        
        // Qwen OAuth
        const qwenOauthCredsFilePathEl = document.getElementById('qwenOauthCredsFilePath');
        if (qwenOauthCredsFilePathEl) qwenOauthCredsFilePathEl.value = data.QWEN_OAUTH_CREDS_FILE_PATH || '';
        
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

        if (systemPromptFilePathEl) systemPromptFilePathEl.value = data.SYSTEM_PROMPT_FILE_PATH || 'input_system_prompt.txt';
        if (systemPromptModeEl) systemPromptModeEl.value = data.SYSTEM_PROMPT_MODE || 'overwrite';
        if (promptLogBaseNameEl) promptLogBaseNameEl.value = data.PROMPT_LOG_BASE_NAME || 'prompt_log';
        if (promptLogModeEl) promptLogModeEl.value = data.PROMPT_LOG_MODE || 'none';
        if (requestMaxRetriesEl) requestMaxRetriesEl.value = data.REQUEST_MAX_RETRIES || 3;
        if (requestBaseDelayEl) requestBaseDelayEl.value = data.REQUEST_BASE_DELAY || 1000;
        if (cronNearMinutesEl) cronNearMinutesEl.value = data.CRON_NEAR_MINUTES || 1;
        if (cronRefreshTokenEl) cronRefreshTokenEl.checked = data.CRON_REFRESH_TOKEN || false;
        if (providerPoolsFilePathEl) providerPoolsFilePathEl.value = data.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';

        // 触发供应商配置显示
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
        
        // 检查并设置供应商池菜单显示状态
        const providerPoolsFilePath = data.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
        const providersMenuItem = document.querySelector('.nav-item[data-section="providers"]');
        if (providerPoolsFilePath && providerPoolsFilePath.trim() !== '') {
            if (providersMenuItem) providersMenuItem.style.display = 'flex';
        } else {
            if (providersMenuItem) providersMenuItem.style.display = 'none';
        }
        
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

    // 根据不同供应商保存不同的配置
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
            break;
            
        case 'openai-qwen-oauth':
            config.QWEN_OAUTH_CREDS_FILE_PATH = document.getElementById('qwenOauthCredsFilePath')?.value || '';
            break;
            
        case 'openaiResponses-custom':
            config.OPENAI_API_KEY = document.getElementById('openaiResponsesApiKey')?.value || '';
            config.OPENAI_BASE_URL = document.getElementById('openaiResponsesBaseUrl')?.value || '';
            break;
    }

    // 保存高级配置参数
    config.SYSTEM_PROMPT_FILE_PATH = document.getElementById('systemPromptFilePath')?.value || '';
    config.SYSTEM_PROMPT_MODE = document.getElementById('systemPromptMode')?.value || '';
    config.PROMPT_LOG_BASE_NAME = document.getElementById('promptLogBaseName')?.value || '';
    config.PROMPT_LOG_MODE = document.getElementById('promptLogMode')?.value || '';
    config.REQUEST_MAX_RETRIES = parseInt(document.getElementById('requestMaxRetries')?.value || 3);
    config.REQUEST_BASE_DELAY = parseInt(document.getElementById('requestBaseDelay')?.value || 1000);
    config.CRON_NEAR_MINUTES = parseInt(document.getElementById('cronNearMinutes')?.value || 1);
    config.CRON_REFRESH_TOKEN = document.getElementById('cronRefreshToken')?.checked || false;
    config.PROVIDER_POOLS_FILE_PATH = document.getElementById('providerPoolsFilePath')?.value || '';

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config),
        });

        if (response.ok) {
            showToast('配置已保存', 'success');
        } else {
            showToast('保存配置失败', 'error');
        }
    } catch (error) {
        console.error('Failed to save configuration:', error);
        showToast('保存配置失败: ' + error.message, 'error');
    }
}

export {
    loadConfiguration,
    saveConfiguration
};