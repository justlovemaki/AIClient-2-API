import { t } from './i18n.js';
import { showToast, apiRequest } from './utils.js';

// 插件列表状态
let pluginsList = [];

/**
 * 初始化插件管理器
 */
export function initPluginManager() {
    const refreshBtn = document.getElementById('refreshPluginsBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadPlugins);
    }
    
    // 初始加载
    loadPlugins();
}

/**
 * 加载插件列表
 */
export async function loadPlugins() {
    const loadingEl = document.getElementById('pluginsLoading');
    const emptyEl = document.getElementById('pluginsEmpty');
    const listEl = document.getElementById('pluginsList');
    const totalEl = document.getElementById('totalPlugins');
    const enabledEl = document.getElementById('enabledPlugins');
    const disabledEl = document.getElementById('disabledPlugins');
    
    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '';
    
    try {
        const response = await apiRequest('/api/plugins');
        
        if (response && response.plugins) {
            pluginsList = response.plugins;
            renderPluginsList();
            
            // 更新统计信息
            if (totalEl) totalEl.textContent = pluginsList.length;
            if (enabledEl) enabledEl.textContent = pluginsList.filter(p => p.enabled).length;
            if (disabledEl) disabledEl.textContent = pluginsList.filter(p => !p.enabled).length;
        } else {
            if (emptyEl) emptyEl.style.display = 'flex';
        }
    } catch (error) {
        console.error('Failed to load plugins:', error);
        showToast(t('common.error'), t('plugins.load.failed'), 'error');
        if (emptyEl) emptyEl.style.display = 'flex';
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * 渲染插件列表
 */
function renderPluginsList() {
    const listEl = document.getElementById('pluginsList');
    const emptyEl = document.getElementById('pluginsEmpty');
    
    if (!listEl) return;
    
    if (pluginsList.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    pluginsList.forEach(plugin => {
        const card = document.createElement('div');
        card.className = `plugin-card ${plugin.enabled ? 'enabled' : 'disabled'}`;
        
        // 构建标签 HTML
        let badgesHtml = '';
        if (plugin.hasMiddleware) {
            badgesHtml += `<span class="plugin-badge middleware" title="${t('plugins.badge.middleware.title')}">Middleware</span>`;
        }
        if (plugin.hasRoutes) {
            badgesHtml += `<span class="plugin-badge routes" title="${t('plugins.badge.routes.title')}">Routes</span>`;
        }
        if (plugin.hasHooks) {
            badgesHtml += `<span class="plugin-badge hooks" title="${t('plugins.badge.hooks.title')}">Hooks</span>`;
        }
        
        card.innerHTML = `
            <div class="plugin-header">
                <div class="plugin-title">
                    <h3>${plugin.name}</h3>
                    <span class="plugin-version">v${plugin.version}</span>
                </div>
                <div class="plugin-actions">
                    <label class="toggle-switch">
                        <input type="checkbox" ${plugin.enabled ? 'checked' : ''} onchange="window.togglePlugin('${plugin.name}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
            <div class="plugin-description">${plugin.description || t('plugins.noDescription')}</div>
            <div class="plugin-badges">
                ${badgesHtml}
            </div>
            <div class="plugin-status">
                <i class="fas fa-circle"></i> <span>${plugin.enabled ? t('plugins.status.enabled') : t('plugins.status.disabled')}</span>
            </div>
        `;
        
        listEl.appendChild(card);
    });
}

/**
 * 切换插件启用状态
 * @param {string} pluginName - 插件名称
 * @param {boolean} enabled - 是否启用
 */
export async function togglePlugin(pluginName, enabled) {
    try {
        await apiRequest(`/api/plugins/${encodeURIComponent(pluginName)}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
        
        showToast(t('common.success'), t('plugins.toggle.success', { name: pluginName, status: enabled ? t('common.enabled') : t('common.disabled') }), 'success');
        
        // 重新加载列表以更新状态
        loadPlugins();
        
        // 提示需要重启
        showToast(t('common.info'), t('plugins.restart.required'), 'info');
    } catch (error) {
        console.error(`Failed to toggle plugin ${pluginName}:`, error);
        showToast(t('common.error'), t('plugins.toggle.failed'), 'error');
        // 恢复开关状态
        loadPlugins();
    }
}