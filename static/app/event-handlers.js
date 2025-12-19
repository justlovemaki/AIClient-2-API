// 事件监听器模块

import { elements, autoScroll, setAutoScroll, clearLogs } from './constants.js';
import { showToast } from './utils.js';
import { fileUploadHandler } from './file-upload.js';

/**
 * 初始化所有事件监听器
 */
function initEventListeners() {
    // 刷新按钮
    if (elements.refreshBtn) {
        elements.refreshBtn.addEventListener('click', handleRefresh);
    }

    // 清空日志
    if (elements.clearLogsBtn) {
        elements.clearLogsBtn.addEventListener('click', () => {
            clearLogs();
            if (elements.logsContainer) {
                elements.logsContainer.innerHTML = '';
            }
            showToast('日志已清空', 'success');
        });
    }

    // 自动滚动切换
    if (elements.toggleAutoScrollBtn) {
        elements.toggleAutoScrollBtn.addEventListener('click', () => {
            const newAutoScroll = !autoScroll;
            setAutoScroll(newAutoScroll);
            elements.toggleAutoScrollBtn.dataset.enabled = newAutoScroll;
            elements.toggleAutoScrollBtn.innerHTML = `
                <i class="fas fa-arrow-down"></i>
                自动滚动: ${newAutoScroll ? '开' : '关'}
            `;
        });
    }

    // 保存配置
    if (elements.saveConfigBtn) {
        elements.saveConfigBtn.addEventListener('click', saveConfiguration);
    }

    // 重置配置
    if (elements.resetConfigBtn) {
        elements.resetConfigBtn.addEventListener('click', loadInitialData);
    }

    // 模型提供商切换
    if (elements.modelProvider) {
        elements.modelProvider.addEventListener('change', handleProviderChange);
    }

    // Gemini凭据类型切换
    document.querySelectorAll('input[name="geminiCredsType"]').forEach(radio => {
        radio.addEventListener('change', handleGeminiCredsTypeChange);
    });

    // Kiro凭据类型切换
    document.querySelectorAll('input[name="kiroCredsType"]').forEach(radio => {
        radio.addEventListener('change', handleKiroCredsTypeChange);
    });

    // 密码显示/隐藏切换
    document.querySelectorAll('.password-toggle').forEach(button => {
        button.addEventListener('click', handlePasswordToggle);
    });

    // 生成凭据按钮监听
    document.querySelectorAll('.generate-creds-btn').forEach(button => {
        button.addEventListener('click', handleGenerateCreds);
    });

    // 提供商池配置监听
    // const providerPoolsInput = document.getElementById('providerPoolsFilePath');
    // if (providerPoolsInput) {
    //     providerPoolsInput.addEventListener('input', handleProviderPoolsConfigChange);
    // }

    // 日志容器滚动
    if (elements.logsContainer) {
        elements.logsContainer.addEventListener('scroll', () => {
            if (autoScroll) {
                const isAtBottom = elements.logsContainer.scrollTop + elements.logsContainer.clientHeight
                    >= elements.logsContainer.scrollHeight - 5;
                if (!isAtBottom) {
                    setAutoScroll(false);
                    elements.toggleAutoScrollBtn.dataset.enabled = false;
                    elements.toggleAutoScrollBtn.innerHTML = `
                        <i class="fas fa-arrow-down"></i>
                        自动滚动: 关
                    `;
                }
            }
        });
    }
}

/**
 * 提供商配置切换处理
 */
function handleProviderChange() {
    const selectedProvider = elements.modelProvider?.value;
    if (!selectedProvider) return;

    const allProviderConfigs = document.querySelectorAll('.provider-config');
    
    // 隐藏所有提供商配置
    allProviderConfigs.forEach(config => {
        config.style.display = 'none';
    });
    
    // 显示当前选中的提供商配置
    const targetConfig = document.querySelector(`[data-provider="${selectedProvider}"]`);
    if (targetConfig) {
        targetConfig.style.display = 'block';
    }
}

/**
 * Gemini凭据类型切换
 * @param {Event} event - 事件对象
 */
function handleGeminiCredsTypeChange(event) {
    const selectedType = event.target.value;
    const base64Group = document.getElementById('geminiCredsBase64Group');
    const fileGroup = document.getElementById('geminiCredsFileGroup');
    
    if (selectedType === 'base64') {
        if (base64Group) base64Group.style.display = 'block';
        if (fileGroup) fileGroup.style.display = 'none';
    } else {
        if (base64Group) base64Group.style.display = 'none';
        if (fileGroup) fileGroup.style.display = 'block';
    }
}

/**
 * Kiro凭据类型切换
 * @param {Event} event - 事件对象
 */
function handleKiroCredsTypeChange(event) {
    const selectedType = event.target.value;
    const base64Group = document.getElementById('kiroCredsBase64Group');
    const fileGroup = document.getElementById('kiroCredsFileGroup');
    
    if (selectedType === 'base64') {
        if (base64Group) base64Group.style.display = 'block';
        if (fileGroup) fileGroup.style.display = 'none';
    } else {
        if (base64Group) base64Group.style.display = 'none';
        if (fileGroup) fileGroup.style.display = 'block';
    }
}

/**
 * 密码显示/隐藏切换处理
 * @param {Event} event - 事件对象
 */
function handlePasswordToggle(event) {
    const button = event.target.closest('.password-toggle');
    if (!button) return;
    
    const targetId = button.getAttribute('data-target');
    const input = document.getElementById(targetId);
    const icon = button.querySelector('i');
    
    if (!input || !icon) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

/**
 * 处理生成凭据逻辑
 * @param {Event} event - 事件对象
 */
async function handleGenerateCreds(event) {
    const button = event.target.closest('.generate-creds-btn');
    if (!button) return;

    const providerType = button.getAttribute('data-provider');
    const targetInputId = button.getAttribute('data-target');

    try {
        showToast('正在初始化凭据生成...', 'info');
        
        // 使用 fileUploadHandler 中的 getProviderKey 获取目录名称
        const providerDir = fileUploadHandler.getProviderKey(providerType);

        const response = await window.apiClient.post(
            `/providers/${encodeURIComponent(providerType)}/generate-auth-url`,
            {
                saveToConfigs: true,
                providerDir: providerDir
            }
        );

        if (response.success && response.authUrl) {
            // 使用自定义事件监听授权成功，以便自动填充路径
            const handleSuccess = (e) => {
                const data = e.detail;
                if (data.provider === providerType && data.relativePath) {
                    const input = document.getElementById(targetInputId);
                    if (input) {
                        input.value = data.relativePath;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        showToast('凭据已生成并自动填充路径', 'success');
                    }
                    window.removeEventListener('oauth_success_event', handleSuccess);
                }
            };
            window.addEventListener('oauth_success_event', handleSuccess);
            
            // 调用 provider-manager.js 中的 showAuthModal (假设已在全局作用域或通过某种方式可用)
            // 如果不可用，我们需要在 app.js 中导出它
            if (window.showAuthModal) {
                window.showAuthModal(response.authUrl, response.authInfo);
            } else {
                // 降级处理：如果在 app.js 中没导出，尝试直接打开
                window.open(response.authUrl, '_blank');
                showToast('请在打开的窗口中完成授权', 'info');
            }
        } else {
            showToast('初始化凭据生成失败', 'error');
        }
    } catch (error) {
        console.error('生成凭据失败:', error);
        showToast(`生成凭据失败: ${error.message}`, 'error');
    }
}

/**
 * 提供商池配置变化处理
 * @param {Event} event - 事件对象
 */
function handleProviderPoolsConfigChange(event) {
    const filePath = event.target.value.trim();
    const providersMenuItem = document.querySelector('.nav-item[data-section="providers"]');
    
    if (filePath) {
        // 显示提供商池菜单
        if (providersMenuItem) providersMenuItem.style.display = 'flex';
    } else {
        // 隐藏提供商池菜单
        if (providersMenuItem) providersMenuItem.style.display = 'none';
        
        // 如果当前在提供商池页面，切换到仪表盘
        if (providersMenuItem && providersMenuItem.classList.contains('active')) {
            const dashboardItem = document.querySelector('.nav-item[data-section="dashboard"]');
            const dashboardSection = document.getElementById('dashboard');
            
            // 更新导航状态
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
            
            if (dashboardItem) dashboardItem.classList.add('active');
            if (dashboardSection) dashboardSection.classList.add('active');
        }
    }
}

/**
 * 密码显示/隐藏切换处理（用于模态框中的密码输入框）
 * @param {HTMLElement} button - 按钮元素
 */
function handleProviderPasswordToggle(button) {
    const targetKey = button.getAttribute('data-target');
    const input = button.parentNode.querySelector(`input[data-config-key="${targetKey}"]`);
    const icon = button.querySelector('i');
    
    if (!input || !icon) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// 数据加载函数（需要从主模块导入）
let loadInitialData;
let saveConfiguration;
let reloadConfig;

// 刷新处理函数
async function handleRefresh() {
    try {
        // 先刷新基础数据
        if (loadInitialData) {
            loadInitialData();
        }
        
        // 如果reloadConfig函数可用，则也刷新配置
        if (reloadConfig) {
            await reloadConfig();
        }
    } catch (error) {
        console.error('刷新失败:', error);
        showToast('刷新失败: ' + error.message, 'error');
    }
}

export function setDataLoaders(dataLoader, configSaver) {
    loadInitialData = dataLoader;
    saveConfiguration = configSaver;
}

export function setReloadConfig(configReloader) {
    reloadConfig = configReloader;
}

export {
    initEventListeners,
    handleProviderChange,
    handleGeminiCredsTypeChange,
    handleKiroCredsTypeChange,
    handlePasswordToggle,
    handleProviderPoolsConfigChange,
    handleProviderPasswordToggle
};