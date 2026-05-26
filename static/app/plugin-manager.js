import { t } from './i18n.js';
import { showToast, apiRequest, bindOnce } from './utils.js';

// 插件列表状态
let pluginsList = [];
// 插件市场状态
let marketPluginsList = [];
let currentSystemVersion = '0.0.0';
let currentPayingPlugin = null;

/**
 * 初始化插件管理器
 */
export function initPluginManager() {
    const refreshBtn = document.getElementById('refreshPluginsBtn');
    bindOnce(refreshBtn, 'click', loadPlugins, 'refreshPlugins');

    const refreshMarketBtn = document.getElementById('refreshMarketBtn');
    if (refreshMarketBtn) {
        bindOnce(refreshMarketBtn, 'click', loadMarketPlugins, 'refreshMarket');
    }

    // 获取系统版本用于兼容性检查
    fetchSystemVersion();

    // 初始化标签页切换
    const tabs = document.querySelectorAll('.tab-item');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            
            // 切换标签状态
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // 切换内容显隐
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById(`${target}Tab`);
            if (content) content.classList.add('active');
            
            // 切换到市场时自动加载
            if (target === 'market' && marketPluginsList.length === 0) {
                loadMarketPlugins();
            }
        });
    });

    // 支付弹窗逻辑
    const paymentModal = document.getElementById('paymentModal');
    const closePaymentModal = document.getElementById('closePaymentModal');
    if (closePaymentModal) {
        closePaymentModal.addEventListener('click', () => paymentModal.classList.remove('show'));
    }

    // 上传逻辑
    const triggerUploadBtn = document.getElementById('triggerUploadBtn');
    const pluginFileInput = document.getElementById('pluginFileInput');
    if (triggerUploadBtn && pluginFileInput) {
        triggerUploadBtn.addEventListener('click', () => pluginFileInput.click());
        pluginFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadAndInstallPlugin(e.target.files[0]);
                e.target.value = ''; // 重置
            }
        });
    }

    // 暴露函数到全局
    window.installPlugin = installPlugin;
    window.showPayment = showPayment;
    window.togglePlugin = togglePlugin;
    window.uninstallPlugin = uninstallPlugin;
}

/**
 * 获取系统版本
 */
async function fetchSystemVersion() {
    try {
        const response = await apiRequest('/api/system');
        if (response && response.appVersion) {
            currentSystemVersion = response.appVersion;
        }
    } catch (e) {
        console.warn('Failed to fetch system version:', e);
    }
}

/**
 * 比较版本号
 * @returns {number} 1: v1 > v2, -1: v1 < v2, 0: v1 == v2
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
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
    listEl.innerHTML = '';
    
    if (pluginsList.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    pluginsList.forEach(plugin => {
        const card = document.createElement('div');
        card.className = `plugin-card ${plugin.enabled ? 'enabled' : 'disabled'}`;
        
        let badgesHtml = '';
        if (plugin.hasMiddleware) badgesHtml += `<span class="plugin-badge middleware" title="${t('plugins.badge.middleware.title')}">Middleware</span>`;
        if (plugin.hasRoutes) badgesHtml += `<span class="plugin-badge routes" title="${t('plugins.badge.routes.title')}">Routes</span>`;
        if (plugin.hasHooks) badgesHtml += `<span class="plugin-badge hooks" title="${t('plugins.badge.hooks.title')}">Hooks</span>`;
        
        card.innerHTML = `
            <div class="plugin-header">
                <div class="plugin-title">
                    <h3>${plugin.name}</h3>
                    <span class="plugin-version">v${plugin.version}</span>
                </div>
                <div class="plugin-actions" style="display: flex; align-items: center; gap: 10px;">
                    ${!plugin.isBuiltin ? `<button class="btn-uninstall-icon" title="卸载插件" onclick="window.uninstallPlugin('${plugin.name}')" style="background: none; border: none; color: var(--danger-color); cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 1rem;"><i class="fas fa-trash-alt"></i></button>` : ''}
                    <label class="toggle-switch">
                        <input type="checkbox" ${plugin.enabled ? 'checked' : ''} onchange="window.togglePlugin('${plugin.name}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
            <div class="plugin-description">${plugin.description || t('plugins.noDescription')}</div>
            <div class="plugin-badges">${badgesHtml}</div>
            <div class="plugin-status">
                <i class="fas fa-circle"></i> <span>${plugin.enabled ? t('plugins.status.enabled') : t('plugins.status.disabled')}</span>
            </div>
        `;
        listEl.appendChild(card);
    });
}

/**
 * 加载市场插件列表
 */
export async function loadMarketPlugins() {
    const loadingEl = document.getElementById('marketLoading');
    const emptyEl = document.getElementById('marketEmpty');
    const listEl = document.getElementById('marketList');
    const urlInput = document.getElementById('marketUrlInput');
    
    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '';
    
    try {
        // 确保已获取系统版本
        if (currentSystemVersion === '0.0.0') {
            await fetchSystemVersion();
        }

        const updateUrl = urlInput ? urlInput.value.trim() : '';
        const endpoint = updateUrl ? `/api/plugins/market?url=${encodeURIComponent(updateUrl)}` : '/api/plugins/market';
        const response = await apiRequest(endpoint);
        
        if (response && response.plugins) {
            marketPluginsList = response.plugins;
            renderMarketList();
            if (updateUrl) showToast(t('common.success'), '市场索引已从远程更新', 'success');
        } else {
            if (emptyEl) emptyEl.style.display = 'flex';
        }
    } catch (error) {
        console.error('Failed to load market plugins:', error);
        showToast(t('common.error'), '加载市场失败: ' + error.message, 'error');
        if (emptyEl) emptyEl.style.display = 'flex';
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * 渲染市场列表
 */
function renderMarketList() {
    const listEl = document.getElementById('marketList');
    const emptyEl = document.getElementById('marketEmpty');
    
    if (!listEl) return;
    listEl.innerHTML = '';
    
    if (marketPluginsList.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    marketPluginsList.forEach(plugin => {
        const installedPlugin = pluginsList.find(p => p.name === plugin.id);
        const isInstalled = !!installedPlugin;
        const hasUpdate = isInstalled && compareVersions(plugin.version, installedPlugin.version) > 0;
        const isIncompatible = plugin.minSystemVersion && compareVersions(currentSystemVersion, plugin.minSystemVersion) < 0;
        
        const card = document.createElement('div');
        card.className = `plugin-card ${plugin.isPaid ? 'paid' : ''} ${isIncompatible ? 'incompatible' : ''}`;
        card.id = `market-card-${plugin.id}`;
        
        let actionButton = '';
        if (isInstalled && !hasUpdate) {
            actionButton = `<button class="btn btn-secondary btn-install" disabled><i class="fas fa-check"></i> ${t('plugins.market.installed') || '已安装'}</button>`;
        } else if (hasUpdate) {
            if (plugin.isPaid) {
                actionButton = `<button class="btn btn-primary btn-install" style="background: var(--warning-color); border-color: var(--warning-color)" onclick="window.showPayment('${plugin.id}')"><i class="fas fa-sync-alt"></i> 更新到 v${plugin.version}</button>`;
            } else {
                actionButton = `<button class="btn btn-primary btn-install" onclick="window.installPlugin('${plugin.id}')"><i class="fas fa-sync-alt"></i> 更新到 v${plugin.version}</button>`;
            }
        } else if (isIncompatible) {
            actionButton = `<button class="btn btn-secondary btn-install" disabled title="${t('plugins.market.versionIncompatible', { version: plugin.minSystemVersion })}"><i class="fas fa-exclamation-triangle"></i> ${t('plugins.market.incompatible') || '版本不兼容'}</button>`;
        } else if (plugin.isPaid) {
            actionButton = `<button class="btn btn-primary btn-install" style="background: var(--warning-color); border-color: var(--warning-color)" onclick="window.showPayment('${plugin.id}')"><i class="fas fa-shopping-cart"></i> ${t('plugins.market.buy') || '购买并安装'}</button>`;
        } else {
            actionButton = `<button class="btn btn-primary btn-install" onclick="window.installPlugin('${plugin.id}')"><i class="fas fa-download"></i> 安装</button>`;
        }

        const minVersionTag = plugin.minSystemVersion ? 
            `<span class="plugin-version" style="background:var(--bg-tertiary); color:${isIncompatible ? 'var(--danger-color)' : 'var(--text-tertiary)'}">
                ${t('plugins.market.minVersion', { version: plugin.minSystemVersion })}
            </span>` : '';

        card.innerHTML = `
            <div class="plugin-header">
                <div class="plugin-title">
                    <h3>${plugin.name}</h3>
                    <div style="display:flex; gap:5px; align-items:center; margin-top:4px">
                        <span class="plugin-version">v${plugin.version}</span>
                        ${minVersionTag}
                    </div>
                    ${plugin.isPaid ? `<span class="plugin-badge" style="background: var(--warning-bg); color: var(--warning-text); margin-top: 5px">${plugin.price || '付费'}</span>` : ''}
                </div>
            </div>
            <div class="plugin-description">${plugin.description || t('plugins.noDescription')}</div>
            <div class="plugin-footer" style="margin-top:auto; padding-top:1rem; border-top: 1px solid var(--border-color)">
                ${actionButton}
            </div>
        `;
        listEl.appendChild(card);
    });
}

/**
 * 展示支付弹窗
 */
export function showPayment(pluginId) {
    const plugin = marketPluginsList.find(p => p.id === pluginId);
    if (!plugin) return;

    currentPayingPlugin = plugin;
    
    document.getElementById('paymentTitle').textContent = `购买插件: ${plugin.name}`;
    document.getElementById('paymentPrice').textContent = plugin.price || '付费插件';
    document.getElementById('paymentDesc').textContent = plugin.description;
    
    const paymentQREl = document.getElementById('paymentQR');
    const paymentQRHintEl = document.getElementById('paymentQRHint');
    if (plugin.qrCode) {
        paymentQREl.src = plugin.qrCode;
        paymentQREl.style.display = 'block';
        if (paymentQRHintEl) paymentQRHintEl.style.display = 'block';
    } else {
        paymentQREl.src = '';
        paymentQREl.style.display = 'none';
        if (paymentQRHintEl) paymentQRHintEl.style.display = 'none';
    }
    
    document.getElementById('paymentLink').href = plugin.paymentUrl || '#';
    
    document.getElementById('paymentModal').classList.add('show');
}

/**
 * 安装插件
 */
export async function installPlugin(pluginId) {
    const plugin = marketPluginsList.find(p => p.id === pluginId);
    if (!plugin) return;

    const card = document.getElementById(`market-card-${pluginId}`);
    
    // 显示安装状态
    card.style.position = 'relative';
    const overlay = document.createElement('div');
    overlay.className = 'installing-overlay';
    overlay.innerHTML = `<i class="fas fa-spinner fa-spin" style="font-size: 2rem"></i><span>正在安装...</span>`;
    card.appendChild(overlay);

    try {
        const response = await apiRequest('/api/plugins/install', {
            method: 'POST',
            body: JSON.stringify({ plugin })
        });
        
        if (response.success) {
            showToast(t('common.success'), `插件 ${plugin.name} 安装成功`, 'success');
            await loadPlugins();
            renderMarketList();
        }
    } catch (error) {
        console.error('Failed to install plugin:', error);
        showToast(t('common.error'), '安装失败: ' + error.message, 'error');
        overlay.remove();
    }
}

/**
 * 上传并安装插件
 */
async function uploadAndInstallPlugin(file) {
    const formData = new FormData();
    formData.append('file', file);
    if (currentPayingPlugin) {
        formData.append('pluginId', currentPayingPlugin.id);
    }

    showToast(t('common.info'), t('plugins.payment.uploading') || '正在上传并安装插件...', 'info');

    try {
        const response = await fetch('/api/plugins/upload', {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        const result = await response.json();
        if (result.success) {
            showToast(t('common.success'), t('plugins.payment.success') || '插件安装成功', 'success');
            document.getElementById('paymentModal').classList.remove('show');
            await loadPlugins();
            renderMarketList();
        } else {
            throw new Error(result.error?.message || '安装失败');
        }
    } catch (error) {
        console.error('Upload failed:', error);
        showToast(t('common.error'), error.message, 'error');
    }
}

/**
 * 切换插件启用状态
 */
export async function togglePlugin(pluginName, enabled) {
    try {
        await apiRequest(`/api/plugins/${encodeURIComponent(pluginName)}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
        showToast(t('common.success'), t('plugins.toggle.success', { name: pluginName, status: enabled ? t('common.enabled') : t('common.disabled') }), 'success');
        loadPlugins();
        if (typeof renderMarketList === 'function') {
            renderMarketList();
        } else {
            loadMarketPlugins();
        }
        showToast(t('common.info'), t('plugins.restart.required'), 'info');
    } catch (error) {
        console.error(`Failed to toggle plugin ${pluginName}:`, error);
        showToast(t('common.error'), t('plugins.toggle.failed'), 'error');
        loadPlugins();
        if (typeof renderMarketList === 'function') {
            renderMarketList();
        } else {
            loadMarketPlugins();
        }
    }
}

/**
 * 卸载插件
 */
export async function uninstallPlugin(pluginName) {
    const confirmed = confirm(`确定要卸载插件 "${pluginName}" 吗？\n警告：此操作将永久删除插件目录和所有配置，请提前备份插件数据！`);
    if (!confirmed) return;

    try {
        const response = await apiRequest(`/api/plugins/${encodeURIComponent(pluginName)}`, {
            method: 'DELETE'
        });

        if (response && response.success) {
            showToast(t('common.success') || '成功', `插件 ${pluginName} 卸载成功`, 'success');
            await loadPlugins();
            if (typeof renderMarketList === 'function') {
                renderMarketList();
            } else {
                loadMarketPlugins();
            }
            showToast(t('common.info') || '提示', '请重启服务以使更改生效', 'info');
        } else {
            throw new Error(response?.error?.message || '卸载失败');
        }
    } catch (error) {
        console.error(`Failed to uninstall plugin ${pluginName}:`, error);
        showToast(t('common.error') || '错误', '卸载失败: ' + error.message, 'error');
    }
}
