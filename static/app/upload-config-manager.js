// 上传配置管理功能模块

import { showToast } from './utils.js';

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
        container.innerHTML = '<div class="no-configs"><p>未找到匹配的配置文件</p></div>';
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
    const statusText = config.isUsed ? '已关联' : '未关联';

    const typeIcon = config.type === 'oauth' ? 'fa-key' :
                    config.type === 'api-key' ? 'fa-lock' :
                    config.type === 'provider-pool' ? 'fa-network-wired' :
                    config.type === 'system-prompt' ? 'fa-file-text' : 'fa-cog';

    // 生成关联详情HTML
    const usageInfoHtml = generateUsageInfoHtml(config);
    
    // 判断是否可以一键关联（未关联且路径包含 configs/kiro/）
    const canQuickLink = !config.isUsed && config.path.toLowerCase().includes('configs/kiro/');
    const quickLinkBtnHtml = canQuickLink ? 
        `<button class="btn-quick-link" data-path="${config.path}" title="一键关联到 claude-kiro-oauth">
            <i class="fas fa-link"></i> kiro-oauth
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
                ${statusText}
                ${quickLinkBtnHtml}
            </div>
        </div>
        <div class="config-item-details">
            <div class="config-details-grid">
                <div class="config-detail-item">
                    <div class="config-detail-label">文件路径</div>
                    <div class="config-detail-value">${config.path}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label">文件大小</div>
                    <div class="config-detail-value">${formatFileSize(config.size)}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label">最后修改</div>
                    <div class="config-detail-value">${formatDate(config.modified)}</div>
                </div>
                <div class="config-detail-item">
                    <div class="config-detail-label">关联状态</div>
                    <div class="config-detail-value">${statusText}</div>
                </div>
            </div>
            ${usageInfoHtml}
            <div class="config-item-actions">
                <button class="btn-small btn-view" data-path="${config.path}">
                    <i class="fas fa-eye"></i> 查看
                </button>
                <button class="btn-small btn-delete-small" data-path="${config.path}">
                    <i class="fas fa-trash"></i> 删除
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
            quickLinkKiroConfig(config.path);
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
        'main_config': '主要配置',
        'provider_pool': '提供商池',
        'multiple': '多种用途'
    };

    const typeLabel = typeLabels[usageType] || '未知用途';

    let detailsHtml = '';
    usageDetails.forEach(detail => {
        const icon = detail.type === '主要配置' ? 'fa-cog' : 'fa-network-wired';
        const usageTypeKey = detail.type === '主要配置' ? 'main_config' : 'provider_pool';
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
                <span class="usage-info-title">关联详情 (${typeLabel})</span>
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

    if (totalEl) totalEl.textContent = `共 ${totalCount} 个配置文件`;
    if (usedEl) usedEl.textContent = `已关联: ${usedCount}`;
    if (unusedEl) unusedEl.textContent = `未关联: ${unusedCount}`;
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
        // showToast('配置文件列表已刷新', 'success');
    } catch (error) {
        console.error('加载配置列表失败:', error);
        showToast('加载配置列表失败: ' + error.message, 'error');
        
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
            path: './provider_pools.json',
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
            path: './config.json',
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
            path: './input_system_prompt.txt',
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
        showToast('查看配置失败: ' + error.message, 'error');
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
                <h3>配置文件: ${fileData.name}</h3>
                <button class="modal-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="config-modal-body">
                <div class="config-file-info">
                    <div class="file-info-item">
                        <span class="info-label">文件路径:</span>
                        <span class="info-value">${fileData.path}</span>
                    </div>
                    <div class="file-info-item">
                        <span class="info-label">文件大小:</span>
                        <span class="info-value">${formatFileSize(fileData.size)}</span>
                    </div>
                    <div class="file-info-item">
                        <span class="info-label">最后修改:</span>
                        <span class="info-value">${formatDate(fileData.modified)}</span>
                    </div>
                </div>
                <div class="config-content">
                    <label>文件内容:</label>
                    <pre class="config-content-display">${escapeHtml(fileData.content)}</pre>
                </div>
            </div>
            <div class="config-modal-footer">
                <button class="btn btn-secondary btn-close-modal">关闭</button>
                <button class="btn btn-primary btn-copy-content" data-path="${fileData.path}">
                    <i class="fas fa-copy"></i> 复制内容
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
            showToast('内容已复制到剪贴板', 'success');
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
                    showToast('内容已复制到剪贴板', 'success');
                } else {
                    showToast('复制失败，请手动复制', 'error');
                }
            } catch (err) {
                console.error('复制失败:', err);
                showToast('复制失败，请手动复制', 'error');
            } finally {
                document.body.removeChild(textarea);
            }
        }
    } catch (error) {
        console.error('复制失败:', error);
        showToast('复制失败: ' + error.message, 'error');
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
    const title = isUsed ? '删除已关联配置' : '删除配置文件';
    const icon = isUsed ? 'fas fa-exclamation-triangle' : 'fas fa-trash';
    const buttonClass = isUsed ? 'btn btn-danger' : 'btn btn-warning';
    
    const modal = document.createElement('div');
    modal.className = modalClass;
    
    modal.innerHTML = `
        <div class="delete-modal-content">
            <div class="delete-modal-header">
                <h3><i class="${icon}"></i> ${title}</h3>
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
                            '<h4>⚠️ 此配置已被系统使用</h4><p>删除已关联的配置文件可能会影响系统正常运行。请确保您了解删除的后果。</p>' :
                            '<h4>🗑️ 确认删除配置文件</h4><p>此操作将永久删除配置文件，且无法撤销。</p>'
                        }
                    </div>
                </div>
                
                <div class="config-info">
                    <div class="config-info-item">
                        <span class="info-label">文件名:</span>
                        <span class="info-value">${config.name}</span>
                    </div>
                    <div class="config-info-item">
                        <span class="info-label">文件路径:</span>
                        <span class="info-value">${config.path}</span>
                    </div>
                    <div class="config-info-item">
                        <span class="info-label">文件大小:</span>
                        <span class="info-value">${formatFileSize(config.size)}</span>
                    </div>
                    <div class="config-info-item">
                        <span class="info-label">关联状态:</span>
                        <span class="info-value status-${isUsed ? 'used' : 'unused'}">
                            ${isUsed ? '已关联' : '未关联'}
                        </span>
                    </div>
                </div>
                
                ${isUsed ? `
                    <div class="usage-alert">
                        <div class="alert-icon">
                            <i class="fas fa-info-circle"></i>
                        </div>
                        <div class="alert-content">
                            <h5>关联详情</h5>
                            <p>此配置文件正在被系统使用，删除后可能会导致:</p>
                            <ul>
                                <li>相关的AI服务无法正常工作</li>
                                <li>配置管理中的设置失效</li>
                                <li>提供商池配置丢失</li>
                            </ul>
                            <p><strong>建议：</strong>请先在配置管理中解除文件引用后再删除。</p>
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="delete-modal-footer">
                <button class="btn btn-secondary btn-cancel-delete">取消</button>
                <button class="${buttonClass} btn-confirm-delete" data-path="${config.path}">
                    <i class="fas fa-${isUsed ? 'exclamation-triangle' : 'trash'}"></i>
                    ${isUsed ? '强制删除' : '确认删除'}
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
        showToast(result.message, 'success');
        
        // 从本地列表中移除
        allConfigs = allConfigs.filter(c => c.path !== path);
        filteredConfigs = filteredConfigs.filter(c => c.path !== path);
        renderConfigList();
        updateStats();
    } catch (error) {
        console.error('删除配置失败:', error);
        showToast('删除配置失败: ' + error.message, 'error');
    }
}

/**
 * 删除配置
 * @param {string} path - 文件路径
 */
async function deleteConfig(path) {
    const config = filteredConfigs.find(c => c.path === path) || allConfigs.find(c => c.path === path);
    if (!config) {
        showToast('配置文件不存在', 'error');
        return;
    }
    
    // 显示删除确认模态框
    showDeleteConfirmModal(config);
}

/**
 * 初始化上传配置管理页面
 */
function initUploadConfigManager() {
    // 绑定搜索事件
    const searchInput = document.getElementById('configSearch');
    const searchBtn = document.getElementById('searchConfigBtn');
    const statusFilter = document.getElementById('configStatusFilter');
    const refreshBtn = document.getElementById('refreshConfigList');

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

    // 批量关联 kiro 配置按钮
    const batchLinkKiroBtn = document.getElementById('batchLinkKiroBtn');
    if (batchLinkKiroBtn) {
        batchLinkKiroBtn.addEventListener('click', batchLinkKiroConfigs);
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
        showToast(result.message, 'success');
        
        // 重新加载配置列表以反映最新的关联状态
        await loadConfigList();
        
        // 注意：不再发送 configReloaded 事件，避免重复调用
        // window.dispatchEvent(new CustomEvent('configReloaded', {
        //     detail: result.details
        // }));
        
    } catch (error) {
        console.error('重载配置失败:', error);
        showToast('重载配置失败: ' + error.message, 'error');
    }
}

/**
 * 一键关联 Kiro 配置到 claude-kiro-oauth
 * @param {string} filePath - 配置文件路径
 */
async function quickLinkKiroConfig(filePath) {
    try {
        showToast('正在关联配置...', 'info');
        
        const result = await window.apiClient.post('/quick-link-kiro', {
            filePath: filePath
        });
        
        showToast(result.message || '配置关联成功', 'success');
        
        // 刷新配置列表
        await loadConfigList();
    } catch (error) {
        console.error('一键关联失败:', error);
        showToast('关联失败: ' + error.message, 'error');
    }
}

/**
 * 批量关联 configs/kiro/ 下的未关联配置到 kiro-oauth
 */
async function batchLinkKiroConfigs() {
    // 筛选出 configs/kiro/ 下的未关联配置
    const kiroUnlinkedConfigs = allConfigs.filter(config => 
        !config.isUsed && config.path.toLowerCase().includes('configs/kiro/')
    );
    
    if (kiroUnlinkedConfigs.length === 0) {
        showToast('没有需要关联的 configs/kiro/ 配置', 'info');
        return;
    }
    
    const confirmMsg = `确定要批量关联 ${kiroUnlinkedConfigs.length} 个 configs/kiro/ 下的配置吗？`;
    if (!confirm(confirmMsg)) {
        return;
    }
    
    showToast(`正在批量关联 ${kiroUnlinkedConfigs.length} 个配置...`, 'info');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const config of kiroUnlinkedConfigs) {
        try {
            await window.apiClient.post('/quick-link-kiro', {
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
        showToast(`成功关联 ${successCount} 个配置`, 'success');
    } else {
        showToast(`关联完成: 成功 ${successCount} 个, 失败 ${failCount} 个`, 'warning');
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