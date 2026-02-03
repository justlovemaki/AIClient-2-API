// 用量管理模块

import { showToast } from './utils.js';
import { getAuthHeaders } from './auth.js';
import { t, getCurrentLanguage } from './i18n.js';

/**
 * 不支持显示用量数据的提供商列表
 * 这些提供商只显示模型名称和重置时间，不显示用量数字和进度条
 */
const PROVIDERS_WITHOUT_USAGE_DISPLAY = [
    'gemini-antigravity'
];

/**
 * 检查提供商是否支持显示用量
 * @param {string} providerType - 提供商类型
 * @returns {boolean} 是否支持显示用量
 */
function shouldShowUsage(providerType) {
    return !PROVIDERS_WITHOUT_USAGE_DISPLAY.includes(providerType);
}

/**
 * 初始化用量管理功能
 */
export function initUsageManager() {
    const refreshBtn = document.getElementById('refreshUsageBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshUsage);
    }
    
    // 初始化时自动加载缓存数据
    loadUsage();
    loadSupportedProviders();
}

/**
 * 加载支持用量查询的提供商列表
 */
async function loadSupportedProviders() {
    const listEl = document.getElementById('supportedProvidersList');
    if (!listEl) return;

    try {
        const response = await fetch('/api/usage/supported-providers', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const providers = await response.json();
        
        listEl.innerHTML = '';
        providers.forEach(provider => {
            const tag = document.createElement('span');
            tag.className = 'provider-tag';
            tag.textContent = getProviderDisplayName(provider);
            tag.title = t('usage.doubleClickToRefresh') || '双击刷新该提供商用量';
            tag.setAttribute('data-i18n-title', 'usage.doubleClickToRefresh');
            
            // 添加双击事件
            tag.addEventListener('dblclick', () => {
                refreshProviderUsage(provider);
            });
            
            listEl.appendChild(tag);
        });
    } catch (error) {
        console.error('获取支持的提供商列表失败:', error);
        listEl.innerHTML = `<span class="error-text" data-i18n="usage.failedToLoad">${t('usage.failedToLoad')}</span>`;
    }
}

/**
 * 加载用量数据（优先从缓存读取）
 */
export async function loadUsage() {
    const loadingEl = document.getElementById('usageLoading');
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
        // 不带 refresh 参数，优先读取缓存
        const response = await fetch('/api/usage', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // 隐藏加载状态
        if (loadingEl) loadingEl.style.display = 'none';
        
        // 渲染用量数据
        renderUsageData(data, contentEl);
        
        // 更新服务端系统时间
        if (data.serverTime) {
            const serverTimeEl = document.getElementById('serverTimeValue');
            if (serverTimeEl) {
                serverTimeEl.textContent = new Date(data.serverTime).toLocaleString(getCurrentLanguage());
            }
        }
        
        // 更新最后更新时间
        if (lastUpdateEl) {
            const timeStr = new Date(data.timestamp || Date.now()).toLocaleString(getCurrentLanguage());
            if (data.fromCache && data.timestamp) {
                lastUpdateEl.textContent = t('usage.lastUpdateCache', { time: timeStr });
                lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdateCache');
                lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
            } else {
                lastUpdateEl.textContent = t('usage.lastUpdate', { time: timeStr });
                lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdate');
                lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
            }
        }
    } catch (error) {
        console.error('获取用量数据失败:', error);
        
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || (t('usage.title') + t('common.refresh.failed'));
            }
        }
    }
}

/**
 * 刷新用量数据（强制从服务器获取最新数据）
 */
export async function refreshUsage() {
    const loadingEl = document.getElementById('usageLoading');
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');
    const refreshBtn = document.getElementById('refreshUsageBtn');

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        // 带 refresh=true 参数，强制刷新
        const response = await fetch('/api/usage?refresh=true', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // 隐藏加载状态
        if (loadingEl) loadingEl.style.display = 'none';
        
        // 渲染用量数据
        renderUsageData(data, contentEl);
        
        // 更新服务端系统时间
        if (data.serverTime) {
            const serverTimeEl = document.getElementById('serverTimeValue');
            if (serverTimeEl) {
                serverTimeEl.textContent = new Date(data.serverTime).toLocaleString(getCurrentLanguage());
            }
        }
        
        // 更新最后更新时间
        if (lastUpdateEl) {
            const timeStr = new Date().toLocaleString(getCurrentLanguage());
            lastUpdateEl.textContent = t('usage.lastUpdate', { time: timeStr });
            lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdate');
            lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
        }

        showToast(t('common.success'), t('common.refresh.success'), 'success');
    } catch (error) {
        console.error('获取用量数据失败:', error);
        
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || (t('usage.title') + t('common.refresh.failed'));
            }
        }
        
        showToast(t('common.error'), t('common.refresh.failed') + ': ' + error.message, 'error');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

/**
 * 渲染用量数据
 * @param {Object} data - 用量数据
 * @param {HTMLElement} container - 容器元素
 */
function renderUsageData(data, container) {
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    if (!data || !data.providers || Object.keys(data.providers).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p data-i18n="usage.noData">${t('usage.noData')}</p>
            </div>
        `;
        return;
    }

    // 按提供商分组收集已初始化且未禁用的实例
    const groupedInstances = {};
    
    for (const [providerType, providerData] of Object.entries(data.providers)) {
        if (providerData.instances && providerData.instances.length > 0) {
            const validInstances = [];
            for (const instance of providerData.instances) {
                // 过滤掉服务实例未初始化的
                if (instance.error === '服务实例未初始化' || instance.error === 'Service instance not initialized') {
                    continue;
                }
                // 过滤掉已禁用的提供商
                if (instance.isDisabled) {
                    continue;
                }
                validInstances.push(instance);
            }
            if (validInstances.length > 0) {
                groupedInstances[providerType] = validInstances;
            }
        }
    }

    if (Object.keys(groupedInstances).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p data-i18n="usage.noInstances">${t('usage.noInstances')}</p>
            </div>
        `;
        return;
    }

    // 按提供商分组渲染
    for (const [providerType, instances] of Object.entries(groupedInstances)) {
        const groupContainer = createProviderGroup(providerType, instances);
        container.appendChild(groupContainer);
    }
}

/**
 * 刷新特定提供商类型的用量数据
 * @param {string} providerType - 提供商类型
 */
export async function refreshProviderUsage(providerType) {
    const loadingEl = document.getElementById('usageLoading');
    const refreshBtn = document.getElementById('refreshUsageBtn');
    const contentEl = document.getElementById('usageContent');

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = 'block';
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        const providerName = getProviderDisplayName(providerType);
        showToast(t('common.info'), t('usage.refreshingProvider', { name: providerName }), 'info');

        // 调用按提供商刷新的 API
        const response = await fetch(`/api/usage/${providerType}?refresh=true`, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const providerData = await response.json();
        
        // 获取当前完整数据并更新其中一个提供商的数据
        // 注意：这里为了保持页面一致性，我们重新获取一次完整数据（走缓存）来重新渲染
        // 或者手动在当前 DOM 中更新该提供商的部分。
        // 为了简单可靠，我们重新 loadUsage()，它会读取刚刚更新过的后端缓存
        await loadUsage();

        showToast(t('common.success'), t('common.refresh.success'), 'success');
    } catch (error) {
        console.error(`刷新提供商 ${providerType} 失败:`, error);
        showToast(t('common.error'), t('common.refresh.failed') + ': ' + error.message, 'error');
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

/**
 * 创建提供商分组容器
 * @param {string} providerType - 提供商类型
 * @param {Array} instances - 实例数组
 * @returns {HTMLElement} 分组容器元素
 */
function createProviderGroup(providerType, instances) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'usage-provider-group collapsed';
    
    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);
    const instanceCount = instances.length;
    const successCount = instances.filter(i => i.success).length;
    
    // 分组头部（可点击折叠）
    const header = document.createElement('div');
    header.className = 'usage-group-header';
    header.innerHTML = `
        <div class="usage-group-title">
            <i class="fas fa-chevron-right toggle-icon"></i>
            <i class="${providerIcon} provider-icon"></i>
            <span class="provider-name">${providerDisplayName}</span>
            <span class="instance-count" data-i18n="usage.group.instances" data-i18n-params='{"count":"${instanceCount}"}'>${t('usage.group.instances', { count: instanceCount })}</span>
            <span class="success-count ${successCount === instanceCount ? 'all-success' : ''}" data-i18n="usage.group.success" data-i18n-params='{"count":"${successCount}","total":"${instanceCount}"}'>${t('usage.group.success', { count: successCount, total: instanceCount })}</span>
        </div>
        <div class="usage-group-actions">
            <button class="btn-toggle-cards" title="${t('usage.group.expandAll')}">
                <i class="fas fa-expand-alt"></i>
            </button>
        </div>
    `;
    
    // 点击头部切换分组折叠状态
    const titleDiv = header.querySelector('.usage-group-title');
    titleDiv.addEventListener('click', () => {
        groupContainer.classList.toggle('collapsed');
    });
    
    groupContainer.appendChild(header);
    
    // 展开/折叠所有卡片按钮事件
    const toggleCardsBtn = header.querySelector('.btn-toggle-cards');
    toggleCardsBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡到分组头部
        
        const cards = groupContainer.querySelectorAll('.usage-instance-card');
        const allCollapsed = Array.from(cards).every(card => card.classList.contains('collapsed'));
        
        // 如果全部折叠，则全部展开；否则全部折叠
        cards.forEach(card => {
            if (allCollapsed) {
                card.classList.remove('collapsed');
            } else {
                card.classList.add('collapsed');
            }
        });
        
        // 更新按钮图标和提示文本
        const icon = toggleCardsBtn.querySelector('i');
        if (allCollapsed) {
            icon.className = 'fas fa-compress-alt';
            toggleCardsBtn.title = t('usage.group.collapseAll');
        } else {
            icon.className = 'fas fa-expand-alt';
            toggleCardsBtn.title = t('usage.group.expandAll');
        }
    });
    
    // 分组内容（卡片网格）
    const content = document.createElement('div');
    content.className = 'usage-group-content';
    
    const gridContainer = document.createElement('div');
    gridContainer.className = 'usage-cards-grid';
    
    for (const instance of instances) {
        const instanceCard = createInstanceUsageCard(instance, providerType);
        gridContainer.appendChild(instanceCard);
    }
    
    content.appendChild(gridContainer);
    groupContainer.appendChild(content);
    
    return groupContainer;
}

/**
 * 创建实例用量卡片
 * @param {Object} instance - 实例数据
 * @param {string} providerType - 提供商类型
 * @returns {HTMLElement} 卡片元素
 */
function createInstanceUsageCard(instance, providerType) {
    const card = document.createElement('div');
    card.className = `usage-instance-card ${instance.success ? 'success' : 'error'} collapsed`;

    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);

    // 检查是否应该显示用量信息
    const showUsage = shouldShowUsage(providerType);

    // 计算总用量（用于折叠摘要显示）
    const totalUsage = instance.usage ? calculateTotalUsage(instance.usage.usageBreakdown) : { hasData: false, percent: 0 };
    const progressClass = totalUsage.percent >= 90 ? 'danger' : (totalUsage.percent >= 70 ? 'warning' : 'normal');

    // 折叠摘要 - 两行显示
    const collapsedSummary = document.createElement('div');
    collapsedSummary.className = 'usage-card-collapsed-summary';
    
    const statusIcon = instance.success
        ? '<i class="fas fa-check-circle status-success"></i>'
        : '<i class="fas fa-times-circle status-error"></i>';
    
    // 显示名称：优先自定义名称，其次 uuid
    const displayName = instance.name || instance.uuid;

    const displayUsageText = totalUsage.isCodex 
        ? `${totalUsage.percent.toFixed(1)}%`
        : `${formatNumber(totalUsage.used)} / ${formatNumber(totalUsage.limit)}`;
    
    collapsedSummary.innerHTML = `
        <div class="collapsed-summary-row collapsed-summary-name-row">
            <i class="fas fa-chevron-right usage-toggle-icon"></i>
            <span class="collapsed-name" title="${displayName}">${displayName}</span>
            ${statusIcon}
        </div>
        ${showUsage ? `
        <div class="collapsed-summary-row collapsed-summary-usage-row">
            ${totalUsage.hasData ? `
                <div class="collapsed-progress-bar ${progressClass}">
                    <div class="progress-fill" style="width: ${totalUsage.percent}%"></div>
                </div>
                <span class="collapsed-percent">${totalUsage.percent.toFixed(1)}%</span>
                <span class="collapsed-usage-text">${displayUsageText}</span>
            ` : (instance.error ? `<span class="collapsed-error" data-i18n="common.error">${t('common.error')}</span>` : '')}
        </div>
        ` : ''}
    `;
    
    // 点击折叠摘要切换展开状态
    collapsedSummary.addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.toggle('collapsed');
    });
    
    card.appendChild(collapsedSummary);

    // 展开内容区域
    const expandedContent = document.createElement('div');
    expandedContent.className = 'usage-card-expanded-content';

    // 实例头部 - 整合用户信息
    const header = document.createElement('div');
    header.className = 'usage-instance-header';
    
    const healthBadge = instance.isDisabled
        ? `<span class="badge badge-disabled" data-i18n="usage.card.status.disabled">${t('usage.card.status.disabled')}</span>`
        : (instance.isHealthy
            ? `<span class="badge badge-healthy" data-i18n="usage.card.status.healthy">${t('usage.card.status.healthy')}</span>`
            : `<span class="badge badge-unhealthy" data-i18n="usage.card.status.unhealthy">${t('usage.card.status.unhealthy')}</span>`);

    // 获取用户邮箱和订阅信息
    const userEmail = instance.usage?.user?.email || '';
    const subscriptionTitle = instance.usage?.subscription?.title || '';
    
    // 用户信息行
    const userInfoHTML = userEmail ? `
        <div class="instance-user-info">
            <span class="user-email" title="${userEmail}"><i class="fas fa-envelope"></i> ${userEmail}</span>
            ${subscriptionTitle ? `<span class="user-subscription">${subscriptionTitle}</span>` : ''}
        </div>
    ` : '';

    header.innerHTML = `
        <div class="instance-header-top">
            <div class="instance-provider-type">
                <i class="${providerIcon}"></i>
                <span>${providerDisplayName}</span>
            </div>
            <div class="instance-status-badges">
                ${statusIcon}
                ${healthBadge}
            </div>
        </div>
        <div class="instance-name">
            <span class="instance-name-text" title="${instance.name || instance.uuid}">${instance.name || instance.uuid}</span>
        </div>
        ${userInfoHTML}
    `;
    expandedContent.appendChild(header);

    // 实例内容 - 只显示用量和到期时间
    const content = document.createElement('div');
    content.className = 'usage-instance-content';

    if (instance.error) {
        content.innerHTML = `
            <div class="usage-error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${instance.error}</span>
            </div>
        `;
    } else if (instance.usage) {
        content.appendChild(renderUsageDetails(instance.usage, providerType));
    }

    expandedContent.appendChild(content);
    card.appendChild(expandedContent);
    
    return card;
}

/**
 * 渲染用量详情 - 显示总用量、用量明细和到期时间
 * @param {Object} usage - 用量数据
 * @param {string} providerType - 提供商类型
 * @returns {HTMLElement} 详情元素
 */
function renderUsageDetails(usage, providerType) {
    const container = document.createElement('div');
    container.className = 'usage-details';

    // 检查是否应该显示用量信息
    const showUsage = shouldShowUsage(providerType);
    
    // 计算总用量
    const totalUsage = calculateTotalUsage(usage.usageBreakdown);
    
    // 总用量进度条（不支持显示用量的提供商不显示）
    if (totalUsage.hasData && showUsage) {
        const totalSection = document.createElement('div');
        totalSection.className = 'usage-section total-usage';
        
        const progressClass = totalUsage.percent >= 90 ? 'danger' : (totalUsage.percent >= 70 ? 'warning' : 'normal');
        
        // 提取第一个有重置时间的条目（通常是总配额）
        let resetTimeHTML = '';
        if (totalUsage.isCodex && totalUsage.resetAfterSeconds !== undefined) {
            const resetTimeText = formatTimeRemaining(totalUsage.resetAfterSeconds);
            resetTimeHTML = `
                <div class="total-reset-info" data-i18n="usage.resetInfo" data-i18n-params='{"time":"${resetTimeText}"}'>
                    <i class="fas fa-history"></i> ${t('usage.resetInfo', { time: resetTimeText })}
                </div>
            `;
        } else {
            const resetTimeEntry = usage.usageBreakdown.find(b => b.resetTime && b.resetTime !== '--');
            if (resetTimeEntry) {
                const formattedResetTime = formatDate(resetTimeEntry.resetTime);
                resetTimeHTML = `
                    <div class="total-reset-info" data-i18n="usage.card.resetAt" data-i18n-params='{"time":"${formattedResetTime}"}'>
                        <i class="fas fa-history"></i> ${t('usage.card.resetAt', { time: formattedResetTime })}
                    </div>
                `;
            }
        }

        const displayValue = totalUsage.isCodex 
            ? `${totalUsage.percent.toFixed(1)}%`
            : `${formatNumber(totalUsage.used)} / ${formatNumber(totalUsage.limit)}`;

        totalSection.innerHTML = `
            <div class="total-usage-header">
                <span class="total-label">
                    <i class="fas fa-chart-pie"></i>
                    <span data-i18n="usage.card.totalUsage">${t('usage.card.totalUsage')}</span>
                </span>
                <span class="total-value">${displayValue}</span>
            </div>
            <div class="progress-bar ${progressClass}">
                <div class="progress-fill" style="width: ${totalUsage.percent}%"></div>
            </div>
            <div class="total-footer">
                <div class="total-percent">${totalUsage.percent.toFixed(2)}%</div>
                ${resetTimeHTML}
            </div>
        `;
        
        container.appendChild(totalSection);
    }

    // 用量明细（包含免费试用和奖励信息）
    if (usage.usageBreakdown && usage.usageBreakdown.length > 0) {
        const breakdownSection = document.createElement('div');
        breakdownSection.className = 'usage-section usage-breakdown-compact';
        
        let breakdownHTML = '';
        
        for (const breakdown of usage.usageBreakdown) {
            breakdownHTML += createUsageBreakdownHTML(breakdown, providerType);
        }
        
        breakdownSection.innerHTML = breakdownHTML;
        container.appendChild(breakdownSection);
    }

    return container;
}

/**
 * 创建用量明细 HTML（紧凑版）
 * @param {Object} breakdown - 用量明细数据
 * @param {string} providerType - 提供商类型
 * @returns {string} HTML 字符串
 */
function createUsageBreakdownHTML(breakdown, providerType) {
    // 特殊处理 Codex
    if (breakdown.rateLimit && breakdown.rateLimit.primary_window) {
        return createCodexUsageBreakdownHTML(breakdown);
    }

    // 检查是否应该显示用量信息
    const showUsage = shouldShowUsage(providerType);

    const usagePercent = breakdown.usageLimit > 0
        ? Math.min(100, (breakdown.currentUsage / breakdown.usageLimit) * 100)
        : 0;
    
    const progressClass = usagePercent >= 90 ? 'danger' : (usagePercent >= 70 ? 'warning' : 'normal');

    let html = `
        <div class="breakdown-item-compact">
            <div class="breakdown-header-compact">
                <span class="breakdown-name">${breakdown.displayName || breakdown.resourceType}</span>
                ${showUsage ? `<span class="breakdown-usage">${formatNumber(breakdown.currentUsage)} / ${formatNumber(breakdown.usageLimit)}</span>` : ''}
            </div>
            ${showUsage ? `
            <div class="progress-bar-small ${progressClass}">
                <div class="progress-fill" style="width: ${usagePercent}%"></div>
            </div>
            ` : ''}
    `;

    // 如果有重置时间，则显示
    if (breakdown.resetTime && breakdown.resetTime !== '--') {
        const formattedResetTime = formatDate(breakdown.resetTime);
        const resetText = t('usage.card.resetAt', { time: formattedResetTime });
        html += `
            <div class="extra-usage-info reset-time">
                <span class="extra-label">
                    <i class="fas fa-history"></i> 
                    <span data-i18n="usage.card.resetAt" data-i18n-params='${JSON.stringify({ time: formattedResetTime })}'>${resetText}</span>
                </span>
            </div>
        `;
    }

    // 免费试用信息
    if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
        html += `
            <div class="extra-usage-info free-trial">
                <span class="extra-label"><i class="fas fa-gift"></i> <span data-i18n="usage.card.freeTrial">${t('usage.card.freeTrial')}</span></span>
                <span class="extra-value">${formatNumber(breakdown.freeTrial.currentUsage)} / ${formatNumber(breakdown.freeTrial.usageLimit)}</span>
                <span class="extra-expires" data-i18n="usage.card.expires" data-i18n-params='{"time":"${formatDate(breakdown.freeTrial.expiresAt)}"}'>${t('usage.card.expires', { time: formatDate(breakdown.freeTrial.expiresAt) })}</span>
            </div>
        `;
    }

    // 奖励信息
    if (breakdown.bonuses && breakdown.bonuses.length > 0) {
        for (const bonus of breakdown.bonuses) {
            if (bonus.status === 'ACTIVE') {
                html += `
                    <div class="extra-usage-info bonus">
                        <span class="extra-label"><i class="fas fa-star"></i> ${bonus.displayName || bonus.code}</span>
                        <span class="extra-value">${formatNumber(bonus.currentUsage)} / ${formatNumber(bonus.usageLimit)}</span>
                        <span class="extra-expires" data-i18n="usage.card.expires" data-i18n-params='{"time":"${formatDate(bonus.expiresAt)}"}'>${t('usage.card.expires', { time: formatDate(bonus.expiresAt) })}</span>
                    </div>
                `;
            }
        }
    }

    html += '</div>';
    return html;
}

/**
 * 创建 Codex 专用的用量明细 HTML
 * @param {Object} breakdown - 包含 rateLimit 的用量明细
 * @returns {string} HTML 字符串
 */
function createCodexUsageBreakdownHTML(breakdown) {
    const rl = breakdown.rateLimit;
    const secondary = rl.secondary_window;
    
    if (!secondary) return '';

    const secondaryPercent = secondary.used_percent || 0;
    const secondaryProgressClass = secondaryPercent >= 90 ? 'danger' : (secondaryPercent >= 70 ? 'warning' : 'normal');
    const secondaryResetText = formatTimeRemaining(secondary.reset_after_seconds);

    return `
        <div class="breakdown-item-compact codex-usage-item">
            <div class="breakdown-header-compact">
                <span class="breakdown-name" data-i18n="usage.weeklyLimit"><i class="fas fa-calendar-alt"></i> ${t('usage.weeklyLimit')}</span>
                <span class="breakdown-usage">${secondaryPercent}%</span>
            </div>
            <div class="progress-bar-small ${secondaryProgressClass}">
                <div class="progress-fill" style="width: ${secondaryPercent}%"></div>
            </div>
            <div class="codex-reset-info" data-i18n="usage.resetInfo" data-i18n-params='{"time":"${secondaryResetText}"}'>
                <i class="fas fa-history"></i> ${t('usage.resetInfo', { time: secondaryResetText })}
            </div>
        </div>
    `;
}

/**
 * 格式化剩余时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间
 */
function formatTimeRemaining(seconds) {
    if (seconds <= 0) return t('usage.time.soon');
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return t('usage.time.days', { days, hours });
    if (hours > 0) return t('usage.time.hours', { hours, minutes });
    return t('usage.time.minutes', { minutes });
}

/**
 * 计算总用量（包含基础用量、免费试用和奖励）
 * @param {Array} usageBreakdown - 用量明细数组
 * @returns {Object} 总用量信息
 */
function calculateTotalUsage(usageBreakdown) {
    if (!usageBreakdown || usageBreakdown.length === 0) {
        return { hasData: false, used: 0, limit: 0, percent: 0 };
    }

    // 特殊处理 Codex
    const codexEntry = usageBreakdown.find(b => b.rateLimit && b.rateLimit.secondary_window);
    if (codexEntry) {
        const secondary = codexEntry.rateLimit.secondary_window;
        const secondaryPercent = secondary.used_percent || 0;
        
        // 只有当周限制达到 100% 时，总用量才显示 100%
        // 否则按正常逻辑计算（或者这里可以理解为非 100% 时不改变原有的总用量逻辑，
        // 但根据用户反馈，Codex 应该主要关注周限制）
        // 重新审视需求：达到周限制时，总用量直接100%，重置时间设置为周限制时间
        
        if (secondaryPercent >= 100) {
            return {
                hasData: true,
                used: 100,
                limit: 100,
                percent: 100,
                isCodex: true,
                resetAfterSeconds: secondary.reset_after_seconds
            };
        }
        // 如果未达到 100%，则继续执行下面的常规计算逻辑
    }

    let totalUsed = 0;
    let totalLimit = 0;

    for (const breakdown of usageBreakdown) {
        // 基础用量
        totalUsed += breakdown.currentUsage || 0;
        totalLimit += breakdown.usageLimit || 0;
        
        // 免费试用用量
        if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
            totalUsed += breakdown.freeTrial.currentUsage || 0;
            totalLimit += breakdown.freeTrial.usageLimit || 0;
        }
        
        // 奖励用量
        if (breakdown.bonuses && breakdown.bonuses.length > 0) {
            for (const bonus of breakdown.bonuses) {
                if (bonus.status === 'ACTIVE') {
                    totalUsed += bonus.currentUsage || 0;
                    totalLimit += bonus.usageLimit || 0;
                }
            }
        }
    }

    const percent = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;

    return {
        hasData: true,
        used: totalUsed,
        limit: totalLimit,
        percent: percent
    };
}

/**
 * 获取提供商显示名称
 * @param {string} providerType - 提供商类型
 * @returns {string} 显示名称
 */
function getProviderDisplayName(providerType) {
    const names = {
        'claude-kiro-oauth': 'Claude Kiro OAuth',
        'gemini-cli-oauth': 'Gemini CLI OAuth',
        'gemini-antigravity': 'Gemini Antigravity',
        'openai-codex-oauth': 'Codex OAuth',
        'openai-qwen-oauth': 'Qwen OAuth'
    };
    return names[providerType] || providerType;
}

/**
 * 获取提供商图标
 * @param {string} providerType - 提供商类型
 * @returns {string} 图标类名
 */
function getProviderIcon(providerType) {
    const icons = {
        'claude-kiro-oauth': 'fas fa-robot',
        'gemini-cli-oauth': 'fas fa-gem',
        'gemini-antigravity': 'fas fa-rocket',
        'openai-codex-oauth': 'fas fa-terminal',
        'openai-qwen-oauth': 'fas fa-code'
    };
    return icons[providerType] || 'fas fa-server';
}


/**
 * 格式化数字（向上取整保留两位小数）
 * @param {number} num - 数字
 * @returns {string} 格式化后的数字
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0.00';
    // 向上取整到两位小数
    const rounded = Math.ceil(num * 100) / 100;
    return rounded.toFixed(2);
}

/**
 * 格式化日期
 * @param {string} dateStr - ISO 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString(getCurrentLanguage(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}