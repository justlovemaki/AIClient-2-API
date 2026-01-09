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
    const isEn = getCurrentLanguage() === 'en-US';
    const labelMap = {
        'customName': t('modal.provider.customName') + ' ' + t('config.optional'),
        'checkModelName': t('modal.provider.checkModelName') + ' ' + t('config.optional'),
        'checkHealth': t('modal.provider.healthCheckLabel'),
        'OPENAI_API_KEY': 'OpenAI API Key',
        'OPENAI_BASE_URL': 'OpenAI Base URL',
        'CLAUDE_API_KEY': 'Claude API Key',
        'CLAUDE_BASE_URL': 'Claude Base URL',
        'PROJECT_ID': isEn ? 'Project ID' : '项目ID',
        'GEMINI_OAUTH_CREDS_FILE_PATH': isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
        'KIRO_OAUTH_CREDS_FILE_PATH': isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
        'QWEN_OAUTH_CREDS_FILE_PATH': isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
        'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH': isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
        'IFLOW_OAUTH_CREDS_FILE_PATH': isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
        'GEMINI_BASE_URL': 'Gemini Base URL',
        'KIRO_BASE_URL': 'Base URL',
        'KIRO_REFRESH_URL': 'Refresh URL',
        'KIRO_REFRESH_IDC_URL': 'Refresh IDC URL',
        'QWEN_BASE_URL': 'Qwen Base URL',
        'QWEN_OAUTH_BASE_URL': 'OAuth Base URL',
        'ANTIGRAVITY_BASE_URL_DAILY': 'Daily Base URL',
        'ANTIGRAVITY_BASE_URL_AUTOPUSH': 'Autopush Base URL',
        'IFLOW_BASE_URL': 'iFlow Base URL'
    };
    
    return labelMap[key] || key;
}

/**
 * 获取提供商类型的字段配置
 * @param {string} providerType - 提供商类型
 * @returns {Array} 字段配置数组
 */
function getProviderTypeFields(providerType) {
    const isEn = getCurrentLanguage() === 'en-US';
    const fieldConfigs = {
        'openai-custom': [
            {
                id: 'OPENAI_API_KEY',
                label: 'OpenAI API Key',
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
                label: 'OpenAI API Key',
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
                label: isEn ? 'Project ID' : '项目ID',
                type: 'text',
                placeholder: isEn ? 'Google Cloud Project ID' : 'Google Cloud项目ID'
            },
            {
                id: 'GEMINI_OAUTH_CREDS_FILE_PATH',
                label: isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
                type: 'text',
                placeholder: isEn ? 'e.g.: ~/.gemini/oauth_creds.json' : '例如: ~/.gemini/oauth_creds.json'
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
                label: isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
                type: 'text',
                placeholder: isEn ? 'e.g.: ~/.aws/sso/cache/kiro-auth-token.json' : '例如: ~/.aws/sso/cache/kiro-auth-token.json'
            },
            {
                id: 'KIRO_BASE_URL',
                label: `Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse'
            },
            {
                id: 'KIRO_REFRESH_URL',
                label: `Refresh URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken'
            },
            {
                id: 'KIRO_REFRESH_IDC_URL',
                label: `Refresh IDC URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://oidc.{{region}}.amazonaws.com/token'
            }
        ],
        'openai-qwen-oauth': [
            {
                id: 'QWEN_OAUTH_CREDS_FILE_PATH',
                label: isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
                type: 'text',
                placeholder: isEn ? 'e.g.: ~/.qwen/oauth_creds.json' : '例如: ~/.qwen/oauth_creds.json'
            },
            {
                id: 'QWEN_BASE_URL',
                label: `Qwen Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://portal.qwen.ai/v1'
            },
            {
                id: 'QWEN_OAUTH_BASE_URL',
                label: `OAuth Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://chat.qwen.ai'
            }
        ],
        'gemini-antigravity': [
            {
                id: 'PROJECT_ID',
                label: isEn ? 'Project ID (Optional)' : '项目ID (选填)',
                type: 'text',
                placeholder: isEn ? 'Google Cloud Project ID (Leave blank for discovery)' : 'Google Cloud项目ID (留空自动发现)'
            },
            {
                id: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH',
                label: isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
                type: 'text',
                placeholder: isEn ? 'e.g.: ~/.antigravity/oauth_creds.json' : '例如: ~/.antigravity/oauth_creds.json'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_DAILY',
                label: `Daily Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://daily-cloudcode-pa.sandbox.googleapis.com'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_AUTOPUSH',
                label: `Autopush Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://autopush-cloudcode-pa.sandbox.googleapis.com'
            }
        ],
        'openai-iflow': [
            {
                id: 'IFLOW_OAUTH_CREDS_FILE_PATH',
                label: isEn ? 'OAuth Credentials File Path' : 'OAuth凭据文件路径',
                type: 'text',
                placeholder: isEn ? 'e.g.: configs/iflow/oauth_creds.json' : '例如: configs/iflow/oauth_creds.json'
            },
            {
                id: 'IFLOW_BASE_URL',
                label: `iFlow Base URL <span class="optional-tag">${t('config.optional')}</span>`,
                type: 'text',
                placeholder: 'https://iflow.cn/api'
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