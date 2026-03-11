// 配置管理功能模块

import { showToast } from './utils.js';
import { t } from './i18n.js';

let allConfigs = []; // 存储所有配置数据
let filteredConfigs = []; // 存储过滤后的配置数据
let isLoadingConfigs = false; // 防止重复加载配置

/**
 * 搜索配置
 * @param {string} searchTerm - 搜索关键词
 * @param {string} statusFilter - 状态过滤
 */
function searchConfigs(searchTerm = '', statusFilter = '', providerFilter = '') {
    // 确保 searchTerm 是字符串，防止事件对象等非字符串被传入
    if (typeof searchTerm !== 'string') {
        searchTerm = '';
    }

    if (!allConfigs.length) {
        console.log('没有配置数据可搜索');
        return;
    }

    filteredConfigs = allConfigs.filter(config => {
        // 搜索过滤
        const matchesSearch = !searchTerm ||
            config.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            config.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (config.content && config.content.toLowerCase().includes(searchTerm.toLowerCase()));

        // 状态过滤 - 从布尔值 isUsed 转换为状态字符串
        const configStatus = config.isUsed ? 'used' : 'unused';
        const matchesStatus = !statusFilter || configStatus === statusFilter;

        // 提供商类型过滤
        let matchesProvider = true;
        if (providerFilter) {
            const providerInfo = detectProviderFromPath(config.path);
            if (providerFilter === 'other') {
                // "其他/未识别" 选项：匹配没有识别到提供商的配置
                matchesProvider = providerInfo === null;
            } else {
                // 匹配特定提供商类型
                matchesProvider = providerInfo !== null && providerInfo.providerType === providerFilter;
            }
        }

        return matchesSearch && matchesStatus && matchesProvider;
    });

    renderConfigList();
    updateStats();
}

/**
 * 渲染配置列表
 */
function renderConfigList() {
    const container = document.getElementById('configList');
    if (!container) return;

    container.innerHTML = '';

    if (!filteredConfigs.length) {
        container.innerHTML = `<div class="no-configs"><p data-i18n="upload.noConfigs">${t('upload.noConfigs')}</p></div>`;
        return;
    }

    filteredConfigs.forEach((config, index) => {
        const configItem = createConfigItemElement(config, index);
        container.appendChild(configItem);
    });
}

/**
 * 创建配置项元素
 * @param {Object} config - 配置数据
 * @param {number} index - 索引
 * @returns {HTMLElement} 配置项元素
 */
function createConfigItemElement(config, index) {
    // 从布尔值 isUsed 转换为状态字符串用于显示
    const configStatus = config.isUsed ? 'used' : 'unused';
    const item = document.createElement('div');
    item.className = `config-item-manager ${configStatus}`;
    item.dataset.index = index;

    const statusIcon = config.isUsed ? 'fa-check-circle' : 'fa-circle-question';
    const statusText = config.isUsed ? t('upload.statusFilter.used') : t('upload.statusFilter.unused');

    const typeIcon = config.type === 'oauth' ? 'fa-key' :
                    config.type === 'api-key' ? 'fa-lock' :
                    config.type === 'provider-pool' ? 'fa-network-wired' :
                    config.type === 'system-prompt' ? 'fa-file-text' :
                    config.type === 'plugins' ? 'fa-plug' :
                    config.type === 'usage' ? 'fa-chart-line' :
                    config.type === 'config' ? 'fa-cog' :
                    config.type === 'database' ? 'fa-database' : 'fa-file-code';

    // 检测提供商信息
    const providerInfo = detectProviderFromPath(config.path);
    const providerBadge = providerInfo ? 
        `<span class="provider-type-tag tag-${providerInfo.shortName}">
            <i class="fas fa-robot"></i> ${providerInfo.displayName}
        </span>` : '';

    // 生成关联详情HTML
    const usageInfoHtml = generateUsageInfoHtml(config);
    
    // 获取关联的节点简要信息
    let linkedNodesInfo = '';
    if (config.isUsed && config.usageInfo && config.usageInfo.usageDetails) {
        const details = config.usageInfo.usageDetails;
        
        // 收集节点信息及其状态
        const nodes = details.map(d => {
            let name = '';
            let isPool = false;
            if (d.type === 'Provider Pool' || d.type === '提供商池') {
                isPool = true;
                if (d.nodeName) name = d.nodeName;
                else if (d.uuid) name = d.uuid.substring(0, 8);
                else name = d.location;
            } else if (d.type === 'Main Config' || d.type === '主要配置') {
                name = t('upload.usage.mainConfig');
            }
            
            if (!name) return null;
            
            return {
                name,
                isPool,
                isHealthy: d.isHealthy,
                isDisabled: d.isDisabled
            };
        }).filter(Boolean);
        
        if (nodes.length > 0) {
            // 去重，但保留状态信息（如果有多个相同名称的节点，状态可能不同，这里按名称去重以节省空间，取第一个）
            const uniqueNodes = [];
            const seenNames = new Set();
            for (const node of nodes) {
                if (!seenNames.has(node.name)) {
                    uniqueNodes.push(node);
                    seenNames.add(node.name);
                }
            }

            linkedNodesInfo = `<div class="linked-nodes-tags">
                ${uniqueNodes.map(node => {
                    let statusClass = '';
                    let statusIcon = 'fa-link';
                    
                    if (node.isPool) {
                        if (node.isDisabled) {
                            statusClass = 'status-disabled';
                            statusIcon = 'fa-ban';
                        } else if (!node.isHealthy) {
                            statusClass = 'status-unhealthy';
                            statusIcon = 'fa-exclamation-circle';
                        } else {
                            statusClass = 'status-healthy';
                            statusIcon = 'fa-check-circle';
                        }
                    }
                    
                    return `<span class="node-tag ${statusClass}" title="${node.name}"><i class="fas ${statusIcon}"></i> ${node.name}</span>`;
                }).join('')}
            </div>`;
        }
    }

    // 判断是否可以一键关联（未关联且路径包含支持的提供商目录）
    const canQuickLink = !config.isUsed && providerInfo !== null;
    const quickLinkBtnHtml = canQuickLink ?
        `<button class="btn-quick-link-main" data-path="${config.path}" title="一键关联到 ${providerInfo.displayName}">
            <i class="fas fa-link"></i> ${t('upload.action.quickLink')}
        </button>` : '';

    item.innerHTML = `
        <div class="config-item-main-row">
            <div class="config-item-left">
                <div class="config-item-icon-wrapper ${config.type || 'other'}">
                    <i class="fas ${typeIcon}"></i>
                </div>
                <div class="config-item-title-area">
                    <div class="config-item-name-line">
                        <span class="config-item-display-name">${config.name}</span>
                        ${providerBadge}
                    </div>
                    <div class="config-item-path-line" title="${config.path}">
                        <i class="fas fa-folder-open"></i> ${config.path}
                    </div>
                </div>
            </div>
            
            <div class="config-item-middle">
                <div class="config-meta-info">
                    <span class="meta-item" title="文件大小">
                        <i class="fas fa-weight-hanging"></i> ${formatFileSize(config.size)}
                    </span>
                    <span class="meta-item" title="最后修改时间">
                        <i class="fas fa-calendar-alt"></i> ${formatDate(config.modified)}
                    </span>
                </div>
            </div>

            <div class="config-item-right">
                <div class="config-status-col">
                    <div class="config-status-indicator ${configStatus}">
                        <i class="fas ${statusIcon}"></i>
                        <span data-i18n="${config.isUsed ? 'upload.statusFilter.used' : 'upload.statusFilter.unused'}">${statusText}</span>
                    </div>
                    ${linkedNodesInfo}
                    ${quickLinkBtnHtml}
                </div>
                <div class="config-item-chevron">
                    <i class="fas fa-chevron-right"></i>
                </div>
            </div>
        </div>

        <div class="config-item-details">
            <div class="config-details-grid">
                <div class="config-detail-item path-item">
                    <div class="config-detail-label" data-i18n="upload.detail.path">文件完整路径</div>
                    <div class="config-detail-value">${config.path}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.size">文件大小</div>
                    <div class="config-detail-value">${formatFileSize(config.size)}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.modified">最后修改时间</div>
                    <div class="config-detail-value">${formatDate(config.modified)}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.status">当前关联状态</div>
                    <div class="config-detail-value status-text-${configStatus}" data-i18n="${config.isUsed ? 'upload.statusFilter.used' : 'upload.statusFilter.unused'}">${statusText}</div>
                </div>
            </div>
            ${usageInfoHtml}
            <div class="config-item-actions">
                <button class="btn-small btn-view" data-path="${config.path}">
                    <i class="fas fa-eye"></i> <span data-i18n="upload.action.view">${t('upload.action.view')}</span>
                </button>
                <button class="btn-small btn-download" data-path="${config.path}">
                    <i class="fas fa-download"></i> <span data-i18n="upload.action.download">${t('upload.action.download')}</span>
                </button>
                <button class="btn-small btn-delete-small" data-path="${config.path}">
                    <i class="fas fa-trash"></i> <span data-i18n="upload.action.delete">${t('upload.action.delete')}</span>
                </button>
            </div>
        </div>
    `;

    // 添加按钮事件监听器
    const viewBtn = item.querySelector('.btn-view');
    const downloadBtn = item.querySelector('.btn-download');
    const deleteBtn = item.querySelector('.btn-delete-small');
    
    if (viewBtn) {
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewConfig(config.path);
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadSingleConfig(config.path);
        });
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConfig(config.path);
        });
    }

    // 一键关联按钮事件
    const quickLinkBtn = item.querySelector('.btn-quick-link-main');
    if (quickLinkBtn) {
        quickLinkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quickLinkProviderConfig(config.path);
        });
    }

    // 添加点击事件展开/折叠详情
    item.addEventListener('click', (e) => {
        if (!e.target.closest('.config-item-actions') && !e.target.closest('.config-detail-value')) {
            item.classList.toggle('expanded');
        }
    });

    // 点击路径复制
    const pathValueEl = item.querySelector('.path-item .config-detail-value');
    if (pathValueEl) {
        pathValueEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            const textToCopy = config.path;
            
            // 优先使用 Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(textToCopy);
                    showToast(t('common.success'), t('common.copy.success'), 'success');
                } catch (err) {
                    console.error('Clipboard API failed:', err);
                    fallbackCopyTextToClipboard(textToCopy);
                }
            } else {
                fallbackCopyTextToClipboard(textToCopy);
            }
        });
        pathValueEl.title = t('models.clickToCopy') || '点击复制';
    }

    return item;
}

/**
 * 降级复制方案
 * @param {string} text - 要复制的文本
 */
function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // 确保不可见且不影响布局
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast(t('common.success'), t('common.copy.success'), 'success');
        } else {
            showToast(t('common.error'), t('common.copy.failed'), 'error');
        }
    } catch (err) {
        console.error('Fallback copy failed:', err);
        showToast(t('common.error'), t('common.copy.failed'), 'error');
    }

    document.body.removeChild(textArea);
}

/**
 * 生成关联详情HTML
 * @param {Object} config - 配置数据
 * @returns {string} HTML字符串
 */
function generateUsageInfoHtml(config) {
    if (!config.usageInfo || !config.usageInfo.isUsed) {
        return '';
    }

    const { usageType, usageDetails } = config.usageInfo;
    
    if (!usageDetails || usageDetails.length === 0) {
        return '';
    }

    const typeLabels = {
        'main_config': t('upload.usage.mainConfig'),
        'provider_pool': t('upload.usage.providerPool'),
        'multiple': t('upload.usage.multiple')
    };

    const typeLabel = typeLabels[usageType] || (t('common.info') === 'Info' ? 'Unknown' : '未知用途');

    let detailsHtml = '';
    usageDetails.forEach(detail => {
        const isMain = detail.type === '主要配置' || detail.type === 'Main Config';
        const icon = isMain ? 'fa-cog' : 'fa-network-wired';
        const usageTypeKey = isMain ? 'main_config' : 'provider_pool';
        
        // 严格遵循显示优先级：自定义名称 > UUID > 默认位置描述
        let displayTitle = '';
        let subtitle = '';
        
        if (detail.nodeName) {
            displayTitle = detail.nodeName;
            subtitle = detail.providerType ? `${detail.providerType} - ${detail.location}` : detail.location;
        } else if (detail.uuid) {
            displayTitle = detail.uuid;
            subtitle = detail.providerType ? `${detail.providerType} - ${detail.location}` : detail.location;
        } else {
            displayTitle = detail.location;
            subtitle = detail.providerType || '';
        }

        // 生成节点状态标签
        let statusTag = '';
        if (detail.type === 'Provider Pool' || detail.type === '提供商池') {
            if (detail.isDisabled) {
                statusTag = `<span class="node-status-tag disabled" data-i18n="modal.provider.status.disabled">${t('modal.provider.status.disabled')}</span>`;
            } else if (!detail.isHealthy) {
                statusTag = `<span class="node-status-tag unhealthy" data-i18n="modal.provider.status.unhealthy">${t('modal.provider.status.unhealthy')}</span>`;
            } else {
                statusTag = `<span class="node-status-tag healthy" data-i18n="modal.provider.status.healthy">${t('modal.provider.status.healthy')}</span>`;
            }
        }

        detailsHtml += `
            <div class="usage-detail-item" data-usage-type="${usageTypeKey}">
                <i class="fas ${icon}"></i>
                <div class="usage-detail-content">
                    <div class="usage-detail-top">
                        <span class="usage-detail-type">${detail.type}</span>
                        <span class="usage-detail-location">${displayTitle}</span>
                        ${statusTag}
                    </div>
                    ${subtitle ? `<div class="usage-detail-subtitle">${subtitle}</div>` : ''}
                </div>
            </div>
        `;
    });

    return `
        <div class="config-usage-info">
            <div class="usage-info-header">
                <i class="fas fa-link"></i>
                <span class="usage-info-title" data-i18n="upload.usage.title" data-i18n-params='{"type":"${typeLabel}"}'>关联详情 (${typeLabel})</span>
            </div>
            <div class="usage-details-list">
                ${detailsHtml}
            </div>
        </div>
    `;
}

/**
 * 对配置列表进行排序
 * 规则：未关联的排在前面，然后按修改时间倒序排列
 * @param {Array} configs - 配置列表
 * @returns {Array} 排序后的列表
 */
function sortConfigs(configs) {
    if (!configs || !configs.length) return [];
    
    return configs.sort((a, b) => {
        // 1. 未关联优先 (isUsed 为 false 的排在前面)
        if (a.isUsed !== b.isUsed) {
            return a.isUsed ? 1 : -1;
        }
        
        // 2. 时间倒序 (最新的排在前面)
        const dateA = new Date(a.modified);
        const dateB = new Date(b.modified);
        return dateB - dateA;
    });
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化日期
 * @param {string} dateString - 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 更新统计信息
 */
function updateStats() {
    const totalCount = filteredConfigs.length;
    const usedCount = filteredConfigs.filter(config => config.isUsed).length;
    const unusedCount = filteredConfigs.filter(config => !config.isUsed).length;

    const totalEl = document.getElementById('configCount');
    const usedEl = document.getElementById('usedConfigCount');
    const unusedEl = document.getElementById('unusedConfigCount');

    if (totalEl) {
        totalEl.textContent = t('upload.count', { count: totalCount });
        totalEl.setAttribute('data-i18n-params', JSON.stringify({ count: totalCount.toString() }));
    }
    if (usedEl) {
        usedEl.textContent = t('upload.usedCount', { count: usedCount });
        usedEl.setAttribute('data-i18n-params', JSON.stringify({ count: usedCount.toString() }));
    }
    if (unusedEl) {
        unusedEl.textContent = t('upload.unusedCount', { count: unusedCount });
        unusedEl.setAttribute('data-i18n-params', JSON.stringify({ count: unusedCount.toString() }));
    }
}

/**
 * 加载配置文件列表
 * @param {string} searchTerm - 搜索关键词
 * @param {string} statusFilter - 状态过滤
 * @param {string} providerFilter - 提供商过滤
 */
async function loadConfigList(searchTerm = '', statusFilter = '', providerFilter = '') {
    // 确保 searchTerm 是字符串，处理事件监听器直接调用的情况
    if (typeof searchTerm !== 'string') {
        searchTerm = '';
    }

    // 防止重复加载
    if (isLoadingConfigs) {
        console.log('正在加载配置列表，跳过重复调用');
        return;
    }

    isLoadingConfigs = true;
    console.log('开始加载配置列表...');
    
    try {
        const result = await window.apiClient.get('/upload-configs');
        allConfigs = sortConfigs(result);
        
        // 如果提供了过滤参数，则执行搜索过滤，否则显示全部
        if (searchTerm || statusFilter || providerFilter) {
            searchConfigs(searchTerm, statusFilter, providerFilter);
        } else {
            filteredConfigs = [...allConfigs];
            renderConfigList();
            updateStats();
        }
        
        console.log('配置列表加载成功，共', allConfigs.length, '个项目');
    } catch (error) {
        console.error('加载配置列表失败:', error);
        showToast(t('common.error'), t('common.error') + ': ' + error.message, 'error');
        allConfigs = [];
        filteredConfigs = [];
        renderConfigList();
        updateStats();
    } finally {
        isLoadingConfigs = false;
        console.log('配置列表加载完成');
    }
}

/**
 * 下载单个配置文件
 * @param {string} filePath - 文件路径
 */
async function downloadSingleConfig(filePath) {
    if (!filePath) return;
    
    try {
        const fileName = filePath.split(/[/\\]/).pop();
        
        const token = localStorage.getItem('authToken');
        const headers = {
            'Authorization': token ? `Bearer ${token}` : ''
        };

        const response = await fetch(`/api/upload-configs/download/${encodeURIComponent(filePath)}`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        showToast(t('common.success'), t('usage.card.downloadSuccess') || '文件下载成功', 'success');
    } catch (error) {
        console.error('下载配置文件失败:', error);
        showToast(t('common.error'), (t('usage.card.downloadFailed') || '下载配置文件失败') + ': ' + error.message, 'error');
    }
}

/**
 * 查看配置
 * @param {string} path - 文件路径
 */
async function viewConfig(path) {
    try {
        const fileData = await window.apiClient.get(`/upload-configs/view/${encodeURIComponent(path)}`);
        showConfigModal(fileData);
    } catch (error) {
        console.error('查看配置失败:', error);
        showToast(t('common.error'), t('upload.action.view.failed') + ': ' + error.message, 'error');
    }
}

/**
 * 显示配置模态框
 * @param {Object} fileData - 文件数据
 */
function showConfigModal(fileData) {
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'config-view-modal';
    modal.innerHTML = `
        <div class="config-modal-content">
            <div class="config-modal-header">
                <h3><span data-i18n="nav.config">${t('nav.config')}</span>: ${fileData.name}</h3>
                <button class="modal-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="config-modal-body">
                <div class="config-file-info">
                    <div class="file-info-item">
                        <span class="info-label" data-i18n="upload.detail.path">${t('upload.detail.path')}:</span>
                        <span class="info-value">${fileData.path}</span>
                    </div>
                    <div class="file-info-item">
                        <span class="info-label" data-i18n="upload.detail.size">${t('upload.detail.size')}:</span>
                        <span class="info-value">${formatFileSize(fileData.size)}</span>
                    </div>
                    <div class="file-info-item">
                        <span class="info-label" data-i18n="upload.detail.modified">${t('upload.detail.modified')}:</span>
                        <span class="info-value">${formatDate(fileData.modified)}</span>
                    </div>
                </div>
                <div class="config-content">
                    <label data-i18n="common.info">文件内容:</label>
                    <pre class="config-content-display">${escapeHtml(fileData.content)}</pre>
                </div>
            </div>
            <div class="config-modal-footer">
                <button class="btn btn-secondary btn-close-modal" data-i18n="modal.provider.cancel">${t('modal.provider.cancel')}</button>
                <button class="btn btn-primary btn-copy-content" data-path="${fileData.path}">
                    <i class="fas fa-copy"></i> <span data-i18n="oauth.modal.copyTitle">${t('oauth.modal.copyTitle')}</span>
                </button>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    
    // 添加按钮事件监听器
    const closeBtn = modal.querySelector('.btn-close-modal');
    const copyBtn = modal.querySelector('.btn-copy-content');
    const modalCloseBtn = modal.querySelector('.modal-close');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeConfigModal();
        });
    }
    
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const path = copyBtn.dataset.path;
            copyConfigContent(path);
        });
    }
    
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => {
            closeConfigModal();
        });
    }
    
    // 显示模态框
    setTimeout(() => modal.classList.add('show'), 10);
}

/**
 * 关闭配置模态框
 */
function closeConfigModal() {
    const modal = document.querySelector('.config-view-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

/**
 * 复制配置内容
 * @param {string} path - 文件路径
 */
async function copyConfigContent(path) {
    try {
        const fileData = await window.apiClient.get(`/upload-configs/view/${encodeURIComponent(path)}`);
        const textToCopy = fileData.content;

        // 优先使用 Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(textToCopy);
                showToast(t('common.success'), t('common.copy.success'), 'success');
            } catch (err) {
                console.error('Clipboard API failed:', err);
                fallbackCopyTextToClipboard(textToCopy);
            }
        } else {
            fallbackCopyTextToClipboard(textToCopy);
        }
    } catch (error) {
        console.error('复制失败:', error);
        showToast(t('common.error'), t('common.copy.failed') + ': ' + error.message, 'error');
    }
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
 * 显示删除确认模态框
 * @param {Object} config - 配置数据
 */
function showDeleteConfirmModal(config) {
    const isUsed = config.isUsed;
    const modalClass = isUsed ? 'delete-confirm-modal used' : 'delete-confirm-modal unused';
    const title = isUsed ? t('upload.delete.confirmTitleUsed') : t('upload.delete.confirmTitle');
    const icon = isUsed ? 'fas fa-exclamation-triangle' : 'fas fa-trash';
    const buttonClass = isUsed ? 'btn btn-danger' : 'btn btn-warning';
    
    const modal = document.createElement('div');
    modal.className = modalClass;
    
    modal.innerHTML = `
        <div class="delete-modal-content">
            <div class="delete-modal-header">
                <h3 data-i18n="${isUsed ? 'upload.delete.confirmTitleUsed' : 'upload.delete.confirmTitle'}"><i class="${icon}"></i> ${title}</h3>
                <button class="modal-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="delete-modal-body">
                <div class="delete-warning ${isUsed ? 'warning-used' : 'warning-unused'}">
                    <div class="warning-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div class="warning-content">
                        ${isUsed ?
                            `<h4 data-i18n="upload.delete.warningUsedTitle">${t('upload.delete.warningUsedTitle')}</h4><p data-i18n="upload.delete.warningUsedDesc">${t('upload.delete.warningUsedDesc')}</p>` :
                            `<h4 data-i18n="upload.delete.warningUnusedTitle">${t('upload.delete.warningUnusedTitle')}</h4><p data-i18n="upload.delete.warningUnusedDesc">${t('upload.delete.warningUnusedDesc')}</p>`
                        }
                    </div>
                </div>
                
                <div class="config-info">
                    <div class="config-info-item">
                        <span class="info-label" data-i18n="upload.delete.fileName">文件名:</span>
                        <span class="info-value">${config.name}</span>
                    </div>
                    <div class="config-info-item">
                        <span class="info-label" data-i18n="upload.detail.path">文件路径:</span>
                        <span class="info-value">${config.path}</span>
                    </div>
                    <div class="config-info-item">
                        <span class="info-label" data-i18n="upload.detail.size">文件大小:</span>
                        <span class="info-value">${formatFileSize(config.size)}</span>
                    </div>
                    <div class="config-info-item">
                        <span class="info-label" data-i18n="upload.detail.status">关联状态:</span>
                        <span class="info-value status-${isUsed ? 'used' : 'unused'}" data-i18n="${isUsed ? 'upload.statusFilter.used' : 'upload.statusFilter.unused'}">
                            ${isUsed ? t('upload.statusFilter.used') : t('upload.statusFilter.unused')}
                        </span>
                    </div>
                </div>
                
                ${isUsed ? `
                    <div class="usage-alert">
                        <div class="alert-icon">
                            <i class="fas fa-info-circle"></i>
                        </div>
                        <div class="alert-content">
                            <h5 data-i18n="upload.delete.usageAlertTitle">${t('upload.delete.usageAlertTitle')}</h5>
                            <p data-i18n="upload.delete.usageAlertDesc">${t('upload.delete.usageAlertDesc')}</p>
                            <ul>
                                <li data-i18n="upload.delete.usageAlertItem1">${t('upload.delete.usageAlertItem1')}</li>
                                <li data-i18n="upload.delete.usageAlertItem2">${t('upload.delete.usageAlertItem2')}</li>
                                <li data-i18n="upload.delete.usageAlertItem3">${t('upload.delete.usageAlertItem3')}</li>
                            </ul>
                            <p data-i18n-html="upload.delete.usageAlertAdvice">${t('upload.delete.usageAlertAdvice')}</p>
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="delete-modal-footer">
                <button class="btn btn-secondary btn-cancel-delete" data-i18n="modal.provider.cancel">${t('modal.provider.cancel')}</button>
                <button class="${buttonClass} btn-confirm-delete" data-path="${config.path}">
                    <i class="fas fa-${isUsed ? 'exclamation-triangle' : 'trash'}"></i>
                    <span data-i18n="${isUsed ? 'upload.delete.forceDelete' : 'upload.delete.confirmDelete'}">${isUsed ? t('upload.delete.forceDelete') : t('upload.delete.confirmDelete')}</span>
                </button>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    
    // 添加事件监听器
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.btn-cancel-delete');
    const confirmBtn = modal.querySelector('.btn-confirm-delete');
    
    const closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    };
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeModal);
    }
    
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const path = confirmBtn.dataset.path;
            performDelete(path);
            closeModal();
        });
    }
    
    // 点击外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // ESC键关闭
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
    
    // 显示模态框
    setTimeout(() => modal.classList.add('show'), 10);
}

/**
 * 执行删除操作
 * @param {string} path - 文件路径
 */
async function performDelete(path) {
    try {
        const result = await window.apiClient.delete(`/upload-configs/delete/${encodeURIComponent(path)}`);
        showToast(t('common.success'), result.message, 'success');
        
        // 从本地列表中移除
        allConfigs = allConfigs.filter(c => c.path !== path);
        filteredConfigs = filteredConfigs.filter(c => c.path !== path);
        renderConfigList();
        updateStats();
    } catch (error) {
        console.error('删除配置失败:', error);
        showToast(t('common.error'), t('upload.action.delete.failed') + ': ' + error.message, 'error');
    }
}

/**
 * 删除配置
 * @param {string} path - 文件路径
 */
async function deleteConfig(path) {
    const config = filteredConfigs.find(c => c.path === path) || allConfigs.find(c => c.path === path);
    if (!config) {
        showToast(t('common.error'), t('upload.config.notExist'), 'error');
        return;
    }
    
    // 显示删除确认模态框
    showDeleteConfirmModal(config);
}

/**
 * 初始化配置管理页面
 */
function initUploadConfigManager() {
    // 绑定搜索事件
    const searchInput = document.getElementById('configSearch');
    const searchBtn = document.getElementById('searchConfigBtn');
    const statusFilter = document.getElementById('configStatusFilter');
    const providerFilter = document.getElementById('configProviderFilter');
    const refreshBtn = document.getElementById('refreshConfigList');
    const downloadAllBtn = document.getElementById('downloadAllConfigs');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            const searchTerm = searchInput.value.trim();
            const currentStatusFilter = statusFilter?.value || '';
            const currentProviderFilter = providerFilter?.value || '';
            searchConfigs(searchTerm, currentStatusFilter, currentProviderFilter);
        }, 300));
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const searchTerm = searchInput?.value.trim() || '';
            const currentStatusFilter = statusFilter?.value || '';
            const currentProviderFilter = providerFilter?.value || '';
            // 点击搜索按钮时，调接口刷新数据
            loadConfigList(searchTerm, currentStatusFilter, currentProviderFilter);
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            const searchTerm = searchInput?.value.trim() || '';
            const currentStatusFilter = statusFilter.value;
            const currentProviderFilter = providerFilter?.value || '';
            searchConfigs(searchTerm, currentStatusFilter, currentProviderFilter);
        });
    }

    if (providerFilter) {
        providerFilter.addEventListener('change', () => {
            const searchTerm = searchInput?.value.trim() || '';
            const currentStatusFilter = statusFilter?.value || '';
            const currentProviderFilter = providerFilter.value;
            searchConfigs(searchTerm, currentStatusFilter, currentProviderFilter);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadConfigList());
    }

    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', downloadAllConfigs);
    }

    // 批量关联配置按钮
    const batchLinkBtn = document.getElementById('batchLinkKiroBtn') || document.getElementById('batchLinkProviderBtn');
    if (batchLinkBtn) {
        batchLinkBtn.addEventListener('click', batchLinkProviderConfigs);
    }

    // 删除未绑定配置按钮
    const deleteUnboundBtn = document.getElementById('deleteUnboundBtn');
    if (deleteUnboundBtn) {
        deleteUnboundBtn.addEventListener('click', deleteUnboundConfigs);
    }

    // 初始加载配置列表
    loadConfigList();
}

/**
 * 重新加载配置文件
 */
async function reloadConfig() {
    // 防止重复重载
    if (isLoadingConfigs) {
        console.log('正在重载配置，跳过重复调用');
        return;
    }

    try {
        const result = await window.apiClient.post('/reload-config');
        showToast(t('common.success'), result.message, 'success');
        
        // 重新加载配置列表以反映最新的关联状态
        await loadConfigList();
        
        // 注意：不再发送 configReloaded 事件，避免重复调用
        // window.dispatchEvent(new CustomEvent('configReloaded', {
        //     detail: result.details
        // }));
        
    } catch (error) {
        console.error('重载配置失败:', error);
        showToast(t('common.error'), t('common.refresh.failed') + ': ' + error.message, 'error');
    }
}

/**
 * 根据文件路径检测对应的提供商类型
 * @param {string} filePath - 文件路径
 * @returns {Object|null} 提供商信息对象或null
 */
function detectProviderFromPath(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    
    // 定义目录到提供商的映射关系
    const providerMappings = [
        {
            patterns: ['configs/kiro/', '/kiro/'],
            providerType: 'claude-kiro-oauth',
            displayName: 'Claude Kiro OAuth',
            shortName: 'kiro-oauth'
        },
        {
            patterns: ['configs/gemini/', '/gemini/', 'configs/gemini-cli/'],
            providerType: 'gemini-cli-oauth',
            displayName: 'Gemini CLI OAuth',
            shortName: 'gemini-oauth'
        },
        {
            patterns: ['configs/qwen/', '/qwen/'],
            providerType: 'openai-qwen-oauth',
            displayName: 'Qwen OAuth',
            shortName: 'qwen-oauth'
        },
        {
            patterns: ['configs/antigravity/', '/antigravity/'],
            providerType: 'gemini-antigravity',
            displayName: 'Gemini Antigravity',
            shortName: 'antigravity'
        },
        {
            patterns: ['configs/codex/', '/codex/'],
            providerType: 'openai-codex-oauth',
            displayName: 'OpenAI Codex OAuth',
            shortName: 'codex-oauth'
        },
        {
            patterns: ['configs/iflow/', '/iflow/'],
            providerType: 'openai-iflow',
            displayName: 'OpenAI iFlow OAuth',
            shortName: 'iflow-oauth'
        }
    ];

    // 遍历映射关系，查找匹配的提供商
    for (const mapping of providerMappings) {
        for (const pattern of mapping.patterns) {
            if (normalizedPath.includes(pattern)) {
                return {
                    providerType: mapping.providerType,
                    displayName: mapping.displayName,
                    shortName: mapping.shortName
                };
            }
        }
    }

    return null;
}

/**
 * 一键关联配置到对应的提供商
 * @param {string} filePath - 配置文件路径
 */
async function quickLinkProviderConfig(filePath) {
    try {
        const providerInfo = detectProviderFromPath(filePath);
        if (!providerInfo) {
            showToast(t('common.error'), t('upload.link.failed.identify'), 'error');
            return;
        }
        
        showToast(t('common.info'), t('upload.link.processing', { name: providerInfo.displayName }), 'info');
        
        const result = await window.apiClient.post('/quick-link-provider', {
            filePath: filePath
        });
        
        showToast(t('common.success'), result.message || t('upload.link.success'), 'success');
        
        // 刷新配置列表
        await loadConfigList();
    } catch (error) {
        console.error('一键关联失败:', error);
        showToast(t('common.error'), t('upload.link.failed') + ': ' + error.message, 'error');
    }
}

/**
 * 批量关联所有支持的提供商目录下的未关联配置
 */
async function batchLinkProviderConfigs() {
    // 筛选出所有支持的提供商目录下的未关联配置
    const unlinkedConfigs = allConfigs.filter(config => {
        if (config.isUsed) return false;
        const providerInfo = detectProviderFromPath(config.path);
        return providerInfo !== null;
    });
    
    if (unlinkedConfigs.length === 0) {
        showToast(t('common.info'), t('upload.batchLink.none'), 'info');
        return;
    }
    
    // 按提供商类型分组统计
    const groupedByProvider = {};
    unlinkedConfigs.forEach(config => {
        const providerInfo = detectProviderFromPath(config.path);
        if (providerInfo) {
            if (!groupedByProvider[providerInfo.displayName]) {
                groupedByProvider[providerInfo.displayName] = 0;
            }
            groupedByProvider[providerInfo.displayName]++;
        }
    });
    
    const providerSummary = Object.entries(groupedByProvider)
        .map(([name, count]) => `${name}: ${count}个`)
        .join(', ');
    
    const confirmMsg = t('upload.batchLink.confirm', { count: unlinkedConfigs.length, summary: providerSummary });
    if (!confirm(confirmMsg)) {
        return;
    }
    
    showToast(t('common.info'), t('upload.batchLink.processing', { count: unlinkedConfigs.length }), 'info');
    
    try {
        // 一次性传递所有文件路径进行批量关联
        const filePaths = unlinkedConfigs.map(config => config.path);
        const result = await window.apiClient.post('/quick-link-provider', {
            filePaths: filePaths
        });
        
        // 刷新配置列表
        await loadConfigList();
        
        if (result.failCount === 0) {
            showToast(t('common.success'), t('upload.batchLink.success', { count: result.successCount }), 'success');
        } else {
            showToast(t('common.warning'), t('upload.batchLink.partial', { success: result.successCount, fail: result.failCount }), 'warning');
        }
    } catch (error) {
        console.error('批量关联失败:', error);
        showToast(t('common.error'), t('upload.batchLink.failed') + ': ' + error.message, 'error');
        
        // 即使失败也刷新列表，可能部分成功
        await loadConfigList();
    }
}

/**
 * 删除所有未绑定的配置文件
 * 只删除 configs/xxx/ 子目录下的未绑定配置文件
 */
async function deleteUnboundConfigs() {
    // 统计未绑定的配置数量，并且必须在 configs/xxx/ 子目录下
    const unboundConfigs = allConfigs.filter(config => {
        if (config.isUsed) return false;
        
        // 检查路径是否在 configs/xxx/ 子目录下
        const normalizedPath = config.path.replace(/\\/g, '/');
        const pathParts = normalizedPath.split('/');
        
        // 路径至少需要3部分：configs/子目录/文件名
        // 例如：configs/kiro/xxx.json 或 configs/gemini/xxx.json
        if (pathParts.length >= 3 && pathParts[0] === 'configs') {
            return true;
        }
        
        return false;
    });
    
    if (unboundConfigs.length === 0) {
        showToast(t('common.info'), t('upload.deleteUnbound.none'), 'info');
        return;
    }
    
    // 显示确认对话框
    const confirmMsg = t('upload.deleteUnbound.confirm', { count: unboundConfigs.length });
    if (!confirm(confirmMsg)) {
        return;
    }
    
    try {
        showToast(t('common.info'), t('upload.deleteUnbound.processing'), 'info');
        
        const result = await window.apiClient.delete('/upload-configs/delete-unbound');
        
        if (result.deletedCount > 0) {
            showToast(t('common.success'), t('upload.deleteUnbound.success', { count: result.deletedCount }), 'success');
            
            // 刷新配置列表
            await loadConfigList();
        } else {
            showToast(t('common.info'), t('upload.deleteUnbound.none'), 'info');
        }
        
        // 如果有失败的文件，显示警告
        if (result.failedCount > 0) {
            console.warn('部分文件删除失败:', result.failedFiles);
            showToast(t('common.warning'), t('upload.deleteUnbound.partial', {
                success: result.deletedCount,
                fail: result.failedCount
            }), 'warning');
        }
    } catch (error) {
        console.error('删除未绑定配置失败:', error);
        showToast(t('common.error'), t('upload.deleteUnbound.failed') + ': ' + error.message, 'error');
    }
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 打包下载所有配置文件
 */
async function downloadAllConfigs() {
    try {
        showToast(t('common.info'), t('common.loading'), 'info');
        
        // 使用 window.apiClient.get 获取 Blob 数据
        // 由于 apiClient 默认可能是处理 JSON 的，我们需要直接调用 fetch 或者确保 apiClient 支持返回原始响应
        const token = localStorage.getItem('authToken');
        const headers = {
            'Authorization': token ? `Bearer ${token}` : ''
        };

        const response = await fetch('/api/upload-configs/download-all', { headers });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || '下载失败');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // 从 Content-Disposition 中提取文件名，或者使用默认名
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `configs_backup_${new Date().toISOString().slice(0, 10)}.zip`;
        if (contentDisposition && contentDisposition.indexOf('filename=') !== -1) {
            const matches = /filename="([^"]+)"/.exec(contentDisposition);
            if (matches && matches[1]) filename = matches[1];
        }
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        showToast(t('common.success'), t('common.success'), 'success');
    } catch (error) {
        console.error('打包下载失败:', error);
        showToast(t('common.error'), t('common.error') + ': ' + error.message, 'error');
    }
}

/**
 * 动态更新提供商筛选下拉框选项
 * @param {Array} providerConfigs - 提供商配置列表
 */
function updateProviderFilterOptions(providerConfigs) {
    const filterSelect = document.getElementById('configProviderFilter');
    if (!filterSelect) return;

    // 保存当前选中的值
    const currentValue = filterSelect.value;

    // 清空现有选项（保留第一个"全部提供商"）
    const firstOption = filterSelect.options[0];
    filterSelect.innerHTML = '';
    if (firstOption) {
        filterSelect.appendChild(firstOption);
    } else {
        const option = document.createElement('option');
        option.value = '';
        option.setAttribute('data-i18n', 'upload.providerFilter.all');
        option.textContent = t('upload.providerFilter.all');
        filterSelect.appendChild(option);
    }

    // 添加动态选项
    providerConfigs.forEach(config => {
        // 根据是否有 defaultPath 来过滤，这意味着该提供商支持 OAuth 凭据文件管理
        if (config.visible !== false && config.defaultPath) {
            const option = document.createElement('option');
            option.value = config.id;
            option.textContent = config.name;
            filterSelect.appendChild(option);
        }
    });

    // 添加"其他"选项
    const otherOption = document.createElement('option');
    otherOption.value = 'other';
    otherOption.setAttribute('data-i18n', 'upload.providerFilter.other');
    otherOption.textContent = t('upload.providerFilter.other');
    filterSelect.appendChild(otherOption);

    // 恢复选中的值（如果还存在）
    filterSelect.value = currentValue;
}

// 导出函数
export {
    initUploadConfigManager,
    searchConfigs,
    loadConfigList,
    viewConfig,
    deleteConfig,
    closeConfigModal,
    copyConfigContent,
    reloadConfig,
    deleteUnboundConfigs,
    updateProviderFilterOptions
};
