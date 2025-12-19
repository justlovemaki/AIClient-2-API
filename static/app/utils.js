// 工具函数

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
 * @param {string} message - 提示消息
 * @param {string} type - 消息类型 (info, success, error)
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
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
        'customName': '自定义名称 (选填)',
        'checkModelName': '检查模型名称 (选填)',
        'checkHealth': '健康检查',
        'OPENAI_API_KEY': 'OpenAI API Key',
        'OPENAI_BASE_URL': 'OpenAI Base URL',
        'CLAUDE_API_KEY': 'Claude API Key',
        'CLAUDE_BASE_URL': 'Claude Base URL',
        'PROJECT_ID': '项目ID',
        'GEMINI_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径',
        'KIRO_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径',
        'QWEN_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径',
        'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径',
        'GEMINI_BASE_URL': 'Gemini Base URL',
        'KIRO_BASE_URL': 'Base URL',
        'KIRO_REFRESH_URL': 'Refresh URL',
        'QWEN_BASE_URL': 'Qwen Base URL',
        'QWEN_OAUTH_BASE_URL': 'OAuth Base URL',
        'ANTIGRAVITY_BASE_URL_DAILY': 'Daily Base URL',
        'ANTIGRAVITY_BASE_URL_AUTOPUSH': 'Autopush Base URL'
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
                label: '项目ID',
                type: 'text',
                placeholder: 'Google Cloud项目ID'
            },
            {
                id: 'GEMINI_OAUTH_CREDS_FILE_PATH',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.gemini/oauth_creds.json'
            },
            {
                id: 'GEMINI_BASE_URL',
                label: 'Gemini Base URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://cloudcode-pa.googleapis.com'
            }
        ],
        'claude-kiro-oauth': [
            {
                id: 'KIRO_OAUTH_CREDS_FILE_PATH',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.aws/sso/cache/kiro-auth-token.json'
            },
            {
                id: 'KIRO_BASE_URL',
                label: 'Base URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse'
            },
            {
                id: 'KIRO_REFRESH_URL',
                label: 'Refresh URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken'
            },
            {
                id: 'KIRO_REFRESH_IDC_URL',
                label: 'Refresh IDC URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://oidc.{{region}}.amazonaws.com/token'
            }
        ],
        'openai-qwen-oauth': [
            {
                id: 'QWEN_OAUTH_CREDS_FILE_PATH',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.qwen/oauth_creds.json'
            },
            {
                id: 'QWEN_BASE_URL',
                label: 'Qwen Base URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://portal.qwen.ai/v1'
            },
            {
                id: 'QWEN_OAUTH_BASE_URL',
                label: 'OAuth Base URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://chat.qwen.ai'
            }
        ],
        'gemini-antigravity': [
            {
                id: 'PROJECT_ID',
                label: '项目ID (选填)',
                type: 'text',
                placeholder: 'Google Cloud项目ID (留空自动发现)'
            },
            {
                id: 'ANTIGRAVITY_OAUTH_CREDS_FILE_PATH',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.antigravity/oauth_creds.json'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_DAILY',
                label: 'Daily Base URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://daily-cloudcode-pa.sandbox.googleapis.com'
            },
            {
                id: 'ANTIGRAVITY_BASE_URL_AUTOPUSH',
                label: 'Autopush Base URL <span class="optional-tag">(选填)</span>',
                type: 'text',
                placeholder: 'https://autopush-cloudcode-pa.sandbox.googleapis.com'
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

// 导出所有工具函数
export {
    formatUptime,
    escapeHtml,
    showToast,
    getFieldLabel,
    getProviderTypeFields,
    getProviderStats
};