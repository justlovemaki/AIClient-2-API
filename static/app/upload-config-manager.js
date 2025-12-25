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
function searchConfigs(searchTerm = '', statusFilter = '') {
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

        return matchesSearch && matchesStatus;
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

    const statusIcon = config.isUsed ? 'fa-check-circle' : 'fa-circle';
    const statusText = config.isUsed ? t('upload.statusFilter.used') : t('upload.statusFilter.unused');

    const typeIcon = config.type === 'oauth' ? 'fa-key' :
                    config.type === 'api-key' ? 'fa-lock' :
                    config.type === 'provider-pool' ? 'fa-network-wired' :
                    config.type === 'system-prompt' ? 'fa-file-text' : 'fa-cog';

    // 生成关联详情HTML
    const usageInfoHtml = generateUsageInfoHtml(config);
    
    // 判断是否可以一键关联（未关联且路径包含支持的提供商目录）
    const providerInfo = detectProviderFromPath(config.path);
    const canQuickLink = !config.isUsed && providerInfo !== null;
    const quickLinkBtnHtml = canQuickLink ?
        `<button class="btn-quick-link" data-path="${config.path}" title="一键关联到 ${providerInfo.displayName}">
            <i class="fas fa-link"></i> ${providerInfo.shortName}
        </button>` : '';

    item.innerHTML = `
        <div class="config-item-header">
            <div class="config-item-name">${config.name}</div>
            <div class="config-item-path" title="${config.path}">${config.path}</div>
        </div>
        <div class="config-item-meta">
            <div class="config-item-size">${formatFileSize(config.size)}</div>
            <div class="config-item-modified">${formatDate(config.modified)}</div>
            <div class="config-item-status">
                <i class="fas ${statusIcon}"></i>
                <span data-i18n="${config.isUsed ? 'upload.statusFilter.used' : 'upload.statusFilter.unused'}">${statusText}</span>
                ${quickLinkBtnHtml}
            </div>
        </div>
        <div class="config-item-details">
            <div class="config-details-grid">
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.path">文件路径</div>
                    <div class="config-detail-value">${config.path}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.size">文件大小</div>
                    <div class="config-detail-value">${formatFileSize(config.size)}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.modified">最后修改</div>
                    <div class="config-detail-value">${formatDate(config.modified)}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label" data-i18n="upload.detail.status">关联状态</div>
                    <div class="config-detail-value" data-i18n="${config.isUsed ? 'upload.statusFilter.used' : 'upload.statusFilter.unused'}">${statusText}</div>
                </div>
            </div>
            ${usageInfoHtml}
            <div class="config-item-actions">
                <button class="btn-small btn-view" data-path="${config.path}">
                    <i class="fas fa-eye"></i> <span data-i18n="upload.action.view">${t('upload.action.view')}</span>
                </button>
                <button class="btn-small btn-delete-small" data-path="${config.path}">
                    <i class="fas fa-trash"></i> <span data-i18n="upload.action.delete">${t('upload.action.delete')}</span>
                </button>
            </div>
        </div>
    `;

    // 添加按钮事件监听器
    const viewBtn = item.querySelector('.btn-view');
    const deleteBtn = item.querySelector('.btn-delete-small');
    
    if (viewBtn) {
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewConfig(config.path);
        });
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConfig(config.path);
        });
    }

    // 一键关联按钮事件
    const quickLinkBtn = item.querySelector('.btn-quick-link');
    if (quickLinkBtn) {
        quickLinkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quickLinkProviderConfig(config.path);
        });
    }

    // 添加点击事件展开/折叠详情
    item.addEventListener('click', (e) => {
        if (!e.target.closest('.config-item-actions')) {
            item.classList.toggle('expanded');
        }
    });

    return item;
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
        detailsHtml += `
            <div class="usage-detail-item" data-usage-type="${usageTypeKey}">
                <i class="fas ${icon}"></i>
                <span class="usage-detail-type">${detail.type}</span>
                <span class="usage-detail-location">${detail.location}</span>
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
 */
async function loadConfigList() {
    // 防止重复加载
    if (isLoadingConfigs) {
        console.log('正在加载配置列表，跳过重复调用');
        return;
    }

    isLoadingConfigs = true;
    console.log('开始加载配置列表...');
    
    try {
        const result = await window.apiClient.get('/upload-configs');
        allConfigs = result;
        filteredConfigs = [...allConfigs];
        renderConfigList();
        updateStats();
        console.log('配置列表加载成功，共', allConfigs.length, '个项目');
        // showToast(t('common.success'), t('upload.refresh') + '成功', 'success');
    } catch (error) {
        console.error('加载配置列表失败:', error);
        showToast(t('common.error'), t('common.error') + ': ' + error.message, 'error');
        
        // 使用模拟数据作为示例
        allConfigs = generateMockConfigData();
        filteredConfigs = [...allConfigs];
        renderConfigList();
        updateStats();
    } finally {
        isLoadingConfigs = false;
        console.log('配置列表加载完成');
    }
}

/**
 * 生成模拟配置数据（用于演示）
 * @returns {Array} 模拟配置数据
 */
function generateMockConfigData() {
    return [
        {
            name: 'provider_pools.json',
            path: './configs/provider_pools.json',
            type: 'provider-pool',
            size: 2048,
            modified: '2025-11-11T04:30:00.000Z',
            isUsed: true,
            content: JSON.stringify({
                "gemini-cli-oauth": [
                    {
                        "GEMINI_OAUTH_CREDS_FILE_PATH": "~/.gemini/oauth/creds.json",
                        "PROJECT_ID": "test-project"
                    }
                ]
            }, null, 2)
        },
        {
            name: 'config.json',
            path: './configs/config.json',
            type: 'other',
            size: 1024,
            modified: '2025-11-10T12:00:00.000Z',
            isUsed: true,
            content: JSON.stringify({
                "REQUIRED_API_KEY": "123456",
                "SERVER_PORT": 3000
            }, null, 2)
        },
        {
            name: 'oauth_creds.json',
            path: '~/.gemini/oauth/creds.json',
            type: 'oauth',
            size: 512,
            modified: '2025-11-09T08:30:00.000Z',
            isUsed: false,
            content: '{"client_id": "test", "client_secret": "test"}'
        },
        {
            name: 'input_system_prompt.txt',
            path: './configs/input_system_prompt.txt',
            type: 'system-prompt',
            size: 256,
            modified: '2025-11-08T15:20:00.000Z',
            isUsed: true,
            content: '你是一个有用的AI助手...'
        },
        {
            name: 'invalid_config.json',
            path: './invalid_config.json',
            type: 'other',
            size: 128,
            modified: '2025-11-07T10:15:00.000Z',
            isUsed: false,
            content: '{"invalid": json}'
        }
    ];
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
        
        // 尝试使用现代 Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(fileData.content);
            showToast(t('common.success'), t('oauth.success.msg'), 'success');
        } else {
            // 降级方案：使用传统的 document.execCommand
            const textarea = document.createElement('textarea');
            textarea.value = fileData.content;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showToast(t('common.copy.success'), 'success');
                } else {
                    showToast(t('common.copy.failed'), 'error');
                }
            } catch (err) {
                console.error('复制失败:', err);
                showToast(t('common.copy.failed'), 'error');
            } finally {
                document.body.removeChild(textarea);
            }
        }
    } catch (error) {
        console.error('复制失败:', error);
        showToast(t('common.copy.failed') + ': ' + error.message, 'error');
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
    const refreshBtn = document.getElementById('refreshConfigList');
    const downloadAllBtn = document.getElementById('downloadAllConfigs');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            const searchTerm = searchInput.value.trim();
            const currentStatusFilter = statusFilter?.value || '';
            searchConfigs(searchTerm, currentStatusFilter);
        }, 300));
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const searchTerm = searchInput?.value.trim() || '';
            const currentStatusFilter = statusFilter?.value || '';
            searchConfigs(searchTerm, currentStatusFilter);
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            const searchTerm = searchInput?.value.trim() || '';
            const currentStatusFilter = statusFilter.value;
            searchConfigs(searchTerm, currentStatusFilter);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadConfigList);
    }

    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', downloadAllConfigs);
    }

    // 批量关联配置按钮
    const batchLinkBtn = document.getElementById('batchLinkKiroBtn') || document.getElementById('batchLinkProviderBtn');
    if (batchLinkBtn) {
        batchLinkBtn.addEventListener('click', batchLinkProviderConfigs);
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
    
    let successCount = 0;
    let failCount = 0;
    
    for (const config of unlinkedConfigs) {
        try {
            await window.apiClient.post('/quick-link-provider', {
                filePath: config.path
            });
            successCount++;
        } catch (error) {
            console.error(`关联失败: ${config.path}`, error);
            failCount++;
        }
    }
    
    // 刷新配置列表
    await loadConfigList();
    
    if (failCount === 0) {
        showToast(t('common.success'), t('upload.batchLink.success', { count: successCount }), 'success');
    } else {
        showToast(t('common.warning'), t('upload.batchLink.partial', { success: successCount, fail: failCount }), 'warning');
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

// 导出函数
export {
    initUploadConfigManager,
    searchConfigs,
    loadConfigList,
    viewConfig,
    deleteConfig,
    closeConfigModal,
    copyConfigContent,
    reloadConfig
};