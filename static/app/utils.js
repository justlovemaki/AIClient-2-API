// 工具函数
import { t, getCurrentLanguage } from './i18n.js';
import { apiClient } from './auth.js';

/**
 * 格式化运行时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化的时间字符串
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (getCurrentLanguage() === 'en-US') {
        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    }
    return `${days}天 ${hours}小时 ${minutes}分 ${secs}秒`;
}

/**
 * HTML转义
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 显示提示消息
 * @param {string} title - 提示标题 (可选，旧接口为 message)
 * @param {string} message - 提示消息
 * @param {string} type - 消息类型 (info, success, error)
 */
function showToast(title, message, type = 'info') {
    // 兼容旧接口 (message, type)
    if (arguments.length === 2 && (message === 'success' || message === 'error' || message === 'info' || message === 'warning')) {
        type = message;
        message = title;
        title = t(`common.${type}`);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(title)}</div>
        <div>${escapeHtml(message)}</div>
    `;

    // 获取toast容器
    const toastContainer = document.getElementById('toastContainer') || document.querySelector('.toast-container');
    if (toastContainer) {
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

/**
 * 获取字段显示文案
 * @param {string} key - 字段键
 * @returns {string} 显示文案
 */
function getFieldLabel(key) {
    const labelMap = {
        'customName': t('modal.provider.customName') + ' ' + t('config.optional'),
        'checkModelName': t('modal.provider.checkModelName') + ' ' + t('config.optional'),
        'checkHealth': t('modal.provider.healthCheckLabel'),
        'OPENAI_API_KEY': 'OpenAI API Key',
        'OPENAI_BASE_URL': 'OpenAI Base URL',
        'CLAUDE_API_KEY': 'Claude API Key',
        'CLAUDE_BASE_URL': 'Claude Base URL',
        'PROJECT_ID': t('modal.provider.field.projectId'),
        'GEMINI_OAUTH_CREDS_FILE_PATH': t('modal.provider.field.oauthPath'),
        'KIRO_OAUTH_CREDS_FILE_PATH': t('modal.provider.field.oauthPath'),
        'QWEN_OAUTH_CREDS_FILE_PATH': t('modal.provider.field.oauthPath'),
        'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH': t('modal.provider.field.oauthPath'),
        'IFLOW_OAUTH_CREDS_FILE_PATH': t('modal.provider.field.oauthPath'),
        'CODEX_OAUTH_CREDS_FILE_PATH': t('modal.provider.field.oauthPath'),
        'GEMINI_BASE_URL': 'Gemini Base URL',
        'KIRO_BASE_URL': t('modal.provider.field.baseUrl'),
        'KIRO_REFRESH_URL': t('modal.provider.field.refreshUrl'),
        'KIRO_REFRESH_IDC_URL': t('modal.provider.field.refreshIdcUrl'),
        'QWEN_BASE_URL': 'Qwen Base URL',
        'QWEN_OAUTH_BASE_URL': t('modal.provider.field.oauthBaseUrl'),
        'ANTIGRAVITY_BASE_URL_DAILY': t('modal.provider.field.dailyBaseUrl'),
        'ANTIGRAVITY_BASE_URL_AUTOPUSH': t('modal.provider.field.autopushBaseUrl'),
        'IFLOW_BASE_URL': 'iFlow Base URL',
        'FORWARD_API_KEY': 'Forward API Key',
        'FORWARD_BASE_URL': 'Forward Base URL',
        'FORWARD_HEADER_NAME': t('modal.provider.field.headerName'),
        'FORWARD_HEADER_VALUE_PREFIX': t('modal.provider.field.headerPrefix'),
        'USE_SYSTEM_PROXY_FORWARD': t('modal.provider.field.useSystemProxy')
    };
    
    return labelMap[key] || key;
}

/**
 * 获取提供商类型的字段配置
 * @param {string} providerType - 提供商类型
 * @returns {Array} 字段配置数组
 */
function getProviderTypeFields(providerType) {
    const fieldConfigs = {
        'openai-custom': [
            {
                id: 'OPENAI_API_KEY',
                label: t('modal.provider.field.apiKey'),
                type: 'password',
                placeholder: 'sk-...'
            },
            {
                id: 'OPENAI_BASE_URL',
                label: 'OpenAI Base URL',
                type: 'text',
                placeholder: 'https://api.openai.com/v1'
            }
        ],
        'openaiResponses-custom': [
            {
                id: 'OPENAI_API_KEY',
                label: t('modal.provider.field.apiKey'),
                type: 'password',
                placeholder: 'sk-...'
            },
            {
                id: 'OPENAI_BASE_URL',
                label: 'OpenAI Base URL',
                type: 'text',
                placeholder: 'https://api.openai.com/v1'
            }
        ],
        'claude-custom': [
            {
                id: 'CLAUDE_API_KEY',
                label: 'Claude API Key',
                type: 'password',
                placeholder: 'sk-ant-...'
            },
            {
                id: 'CLAUDE_BASE_URL',
                label: 'Claude Base URL',
                type: 'text',
                placeholder: 'https://api.anthropic.com'
            }
        ],
        'gemini-cli-oauth': [
            {
                id: 'PROJECT_ID',
                label: t('modal.provider.field.projectId'),
                type: 'text',
                placeholder: t('modal.provider.field.projectId.placeholder')
            },
            {
                id: 'GEMINI_OAUTH_CREDS_FILE_PATH',
                label: t('modal.provider.field.oauthPath'),
                type: 'text',
                placeholder: t('modal.provider.field.oauthPath.gemini.placeholder')
            },
            {
                id: 'GEMINI_BASE_URL',
                label: `Gemini Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://cloudcode-pa.googleapis.com'
            }
        ],
        'claude-kiro-oauth': [
            {
                id: 'KIRO_OAUTH_CREDS_FILE_PATH',
                label: t('modal.provider.field.oauthPath'),
                type: 'text',
                placeholder: t('modal.provider.field.oauthPath.kiro.placeholder')
            },
            {
                id: 'KIRO_BASE_URL',
                label: `${t('modal.provider.field.baseUrl')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse'
            },
            {
                id: 'KIRO_REFRESH_URL',
                label: `${t('modal.provider.field.refreshUrl')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken'
            },
            {
                id: 'KIRO_REFRESH_IDC_URL',
                label: `${t('modal.provider.field.refreshIdcUrl')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://oidc.{{region}}.amazonaws.com/token'
            }
        ],
        'openai-qwen-oauth': [
            {
                id: 'QWEN_OAUTH_CREDS_FILE_PATH',
                label: t('modal.provider.field.oauthPath'),
                type: 'text',
                placeholder: t('modal.provider.field.oauthPath.qwen.placeholder')
            },
            {
                id: 'QWEN_BASE_URL',
                label: `Qwen Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://portal.qwen.ai/v1'
            },
            {
                id: 'QWEN_OAUTH_BASE_URL',
                label: `${t('modal.provider.field.oauthBaseUrl')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://chat.qwen.ai'
            }
        ],
        'gemini-antigravity': [
            {
                id: 'PROJECT_ID',
                label: `${t('modal.provider.field.projectId')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: t('modal.provider.field.projectId.optional.placeholder')
            },
            {
                id: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH',
                label: t('modal.provider.field.oauthPath'),
                type: 'text',
                placeholder: t('modal.provider.field.oauthPath.antigravity.placeholder')
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_DAILY',
                label: `${t('modal.provider.field.dailyBaseUrl')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://daily-cloudcode-pa.sandbox.googleapis.com'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_AUTOPUSH',
                label: `${t('modal.provider.field.autopushBaseUrl')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://autopush-cloudcode-pa.sandbox.googleapis.com'
            }
        ],
        'openai-iflow': [
            {
                id: 'IFLOW_OAUTH_CREDS_FILE_PATH',
                label: t('modal.provider.field.oauthPath'),
                type: 'text',
                placeholder: t('modal.provider.field.oauthPath.iflow.placeholder')
            },
            {
                id: 'IFLOW_BASE_URL',
                label: `iFlow Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://iflow.cn/api'
            }
        ],
        'openai-codex-oauth': [
            {
                id: 'CODEX_OAUTH_CREDS_FILE_PATH',
                label: t('modal.provider.field.oauthPath'),
                type: 'text',
                placeholder: t('modal.provider.field.oauthPath.codex.placeholder')
            },
            {
                id: 'CODEX_EMAIL',
                label: `${t('modal.provider.field.email')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'email',
                placeholder: t('modal.provider.field.email.placeholder')
            },
            {
                id: 'CODEX_BASE_URL',
                label: `Codex Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://api.openai.com/v1/codex'
            }
        ],
        'forward-api': [
            {
                id: 'FORWARD_API_KEY',
                label: t('modal.provider.field.apiKey'),
                type: 'password',
                placeholder: t('modal.provider.field.apiKey.placeholder')
            },
            {
                id: 'FORWARD_BASE_URL',
                label: t('modal.provider.field.baseUrl'),
                type: 'text',
                placeholder: 'https://api.example.com'
            },
            {
                id: 'FORWARD_HEADER_NAME',
                label: `${t('modal.provider.field.headerName')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'Authorization'
            },
            {
                id: 'FORWARD_HEADER_VALUE_PREFIX',
                label: `${t('modal.provider.field.headerPrefix')} <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'Bearer '
            }
        ]
    };

    return fieldConfigs[providerType] || [];
}

/**
 * 调试函数：获取当前提供商统计信息
 * @param {Object} providerStats - 提供商统计对象
 * @returns {Object} 扩展的统计信息
 */
function getProviderStats(providerStats) {
    return {
        ...providerStats,
        // 添加计算得出的统计信息
        successRate: providerStats.totalRequests > 0 ? 
            ((providerStats.totalRequests - providerStats.totalErrors) / providerStats.totalRequests * 100).toFixed(2) + '%' : '0%',
        avgUsagePerProvider: providerStats.activeProviders > 0 ? 
            Math.round(providerStats.totalRequests / providerStats.activeProviders) : 0,
        healthRatio: providerStats.totalAccounts > 0 ? 
            (providerStats.healthyProviders / providerStats.totalAccounts * 100).toFixed(2) + '%' : '0%'
    };
}

/**
 * 通用 API 请求函数
 * @param {string} url - API 端点 URL
 * @param {Object} options - fetch 选项
 * @returns {Promise<any>} 响应数据
 */
async function apiRequest(url, options = {}) {
    // 如果 URL 以 /api 开头，去掉它（因为 apiClient.request 会自动添加）
    const endpoint = url.startsWith('/api') ? url.slice(4) : url;
    return apiClient.request(endpoint, options);
}

// 导出所有工具函数
export {
    formatUptime,
    escapeHtml,
    showToast,
    getFieldLabel,
    getProviderTypeFields,
    getProviderStats,
    apiRequest
};