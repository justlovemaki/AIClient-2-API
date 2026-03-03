// 教程管理模块
import { getProviderConfigs } from './utils.js';

// 提供商配置缓存
let currentProviderConfigs = null;

/**
 * 初始化教程功能
 */
function initTutorialManager() {
    renderOauthPaths();
    
    // 监听语言切换事件
    window.addEventListener('languageChanged', () => {
        renderOauthPaths(currentProviderConfigs);
    });
}

/**
 * 更新提供商配置
 * @param {Array} configs - 提供商配置列表
 */
function updateTutorialProviderConfigs(configs) {
    currentProviderConfigs = configs;
    renderOauthPaths(configs);
}

/**
 * 渲染 OAuth 授权路径列表
 * @param {Array} configs - 提供商配置列表（可选）
 */
function renderOauthPaths(configs = null) {
    const oauthPathList = document.getElementById('oauthPathList');
    if (!oauthPathList) return;

    // 获取所有提供商配置
    const providers = configs || getProviderConfigs([]);
    
    // 过滤出有默认路径配置的提供商（即 OAuth 类提供商）且可见的
    const oauthProviders = providers.filter(p => p.defaultPath && p.visible !== false);

    oauthPathList.innerHTML = oauthProviders.map(p => `
        <div class="oauth-path-item">
            <div class="path-header">
                <i class="fas ${p.icon || 'fa-key'}"></i>
                <span class="path-provider">${p.name}</span>
            </div>
            <code class="path-value">${p.defaultPath}</code>
        </div>
    `).join('');
}

export {
    initTutorialManager,
    renderOauthPaths,
    updateTutorialProviderConfigs
};
