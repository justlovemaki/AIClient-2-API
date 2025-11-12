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
        'checkModelName': '检查模型名称 (选填)',
        'checkHealth': '健康检查',
        'OPENAI_API_KEY': 'OpenAI API Key',
        'OPENAI_BASE_URL': 'OpenAI Base URL',
        'CLAUDE_API_KEY': 'Claude API Key',
        'CLAUDE_BASE_URL': 'Claude Base URL',
        'PROJECT_ID': '项目ID',
        'GEMINI_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径',
        'KIRO_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径',
        'QWEN_OAUTH_CREDS_FILE_PATH': 'OAuth凭据文件路径'
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
                id: 'OpenaiApiKey',
                label: 'OpenAI API Key',
                type: 'password',
                placeholder: 'sk-...'
            },
            {
                id: 'OpenaiBaseUrl',
                label: 'OpenAI Base URL',
                type: 'text',
                value: 'https://api.openai.com/v1'
            }
        ],
        'openaiResponses-custom': [
            {
                id: 'OpenaiApiKey',
                label: 'OpenAI API Key',
                type: 'password',
                placeholder: 'sk-...'
            },
            {
                id: 'OpenaiBaseUrl',
                label: 'OpenAI Base URL',
                type: 'text',
                value: 'https://api.openai.com/v1'
            }
        ],
        'claude-custom': [
            {
                id: 'ClaudeApiKey',
                label: 'Claude API Key',
                type: 'password',
                placeholder: 'sk-ant-...'
            },
            {
                id: 'ClaudeBaseUrl',
                label: 'Claude Base URL',
                type: 'text',
                value: 'https://api.anthropic.com'
            }
        ],
        'gemini-cli-oauth': [
            {
                id: 'ProjectId',
                label: '项目ID',
                type: 'text',
                placeholder: 'Google Cloud项目ID'
            },
            {
                id: 'GeminiOauthCredsFilePath',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.gemini/oauth_creds.json'
            }
        ],
        'claude-kiro-oauth': [
            {
                id: 'KiroOauthCredsFilePath',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.aws/sso/cache/kiro-auth-token.json'
            }
        ],
        'openai-qwen-oauth': [
            {
                id: 'QwenOauthCredsFilePath',
                label: 'OAuth凭据文件路径',
                type: 'text',
                placeholder: '例如: ~/.qwen/oauth_creds.json'
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