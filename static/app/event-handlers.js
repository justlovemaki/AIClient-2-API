// 事件监听器模块

import { elements, autoScroll, setAutoScroll, clearLogs } from './constants.js';
import { showToast } from './utils.js';
import { fileUploadHandler } from './file-upload.js';
import { t } from './i18n.js';
import { checkUpdate, performUpdate } from './provider-manager.js';

/**
 * 初始化所有事件监听器
 */
function initEventListeners() {
    // 重启按钮
    if (elements.restartBtn) {
        elements.restartBtn.addEventListener('click', handleRestart);
    }

    // 清空日志
    if (elements.clearLogsBtn) {
        elements.clearLogsBtn.addEventListener('click', () => {
            clearLogs();
            if (elements.logsContainer) {
                elements.logsContainer.innerHTML = '';
            }
            showToast(t('common.success'), t('common.refresh.success'), 'success');
        });
    }

    // 自动滚动切换
    if (elements.toggleAutoScrollBtn) {
        elements.toggleAutoScrollBtn.addEventListener('click', () => {
            const newAutoScroll = !autoScroll;
            setAutoScroll(newAutoScroll);
            elements.toggleAutoScrollBtn.dataset.enabled = newAutoScroll;
            const statusText = newAutoScroll ? t('logs.autoScroll.on') : t('logs.autoScroll.off');
            elements.toggleAutoScrollBtn.innerHTML = `
                <i class="fas fa-arrow-down"></i>
                <span data-i18n="${newAutoScroll ? 'logs.autoScroll.on' : 'logs.autoScroll.off'}">${statusText}</span>
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

    // 检查更新按钮
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', () => checkUpdate(false));
    }

    // 执行更新按钮
    const performUpdateBtn = document.getElementById('performUpdateBtn');
    if (performUpdateBtn) {
        performUpdateBtn.addEventListener('click', performUpdate);
    }

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
                        <span data-i18n="logs.autoScroll.off">${t('logs.autoScroll.off')}</span>
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
        // 如果是 Kiro OAuth，先显示认证方式选择对话框
        if (providerType === 'claude-kiro-oauth') {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <div class="modal-header">
                        <h3><i class="fas fa-key"></i> <span data-i18n="oauth.kiro.selectMethod">${t('oauth.kiro.selectMethod')}</span></h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="auth-method-options" style="display: flex; flex-direction: column; gap: 12px;">
                            <!--<button class="auth-method-btn" data-method="google" style="display: flex; align-items: center; gap: 12px; padding: 16px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer; transition: all 0.2s;">
                                <i class="fab fa-google" style="font-size: 24px; color: #4285f4;"></i>
                                <div style="text-align: left;">
                                    <div style="font-weight: 600; color: #333;" data-i18n="oauth.kiro.google">${t('oauth.kiro.google')}</div>
                                    <div style="font-size: 12px; color: #666;" data-i18n="oauth.kiro.googleDesc">${t('oauth.kiro.googleDesc')}</div>
                                </div>
                            </button>
                            <button class="auth-method-btn" data-method="github" style="display: flex; align-items: center; gap: 12px; padding: 16px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer; transition: all 0.2s;">
                                <i class="fab fa-github" style="font-size: 24px; color: #333;"></i>
                                <div style="text-align: left;">
                                    <div style="font-weight: 600; color: #333;" data-i18n="oauth.kiro.github">${t('oauth.kiro.github')}</div>
                                    <div style="font-size: 12px; color: #666;" data-i18n="oauth.kiro.githubDesc">${t('oauth.kiro.githubDesc')}</div>
                                </div>
                            </button> -->
                            <button class="auth-method-btn" data-method="builder-id" style="display: flex; align-items: center; gap: 12px; padding: 16px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer; transition: all 0.2s;">
                                <i class="fab fa-aws" style="font-size: 24px; color: #ff9900;"></i>
                                <div style="text-align: left;">
                                    <div style="font-weight: 600; color: #333;" data-i18n="oauth.kiro.awsBuilder">${t('oauth.kiro.awsBuilder')}</div>
                                    <div style="font-size: 12px; color: #666;" data-i18n="oauth.kiro.awsBuilderDesc">${t('oauth.kiro.awsBuilderDesc')}</div>
                                </div>
                            </button>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="modal-cancel" data-i18n="modal.provider.cancel">${t('modal.provider.cancel')}</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const closeModal = () => modal.remove();
            modal.querySelector('.modal-close').onclick = closeModal;
            modal.querySelector('.modal-cancel').onclick = closeModal;
            
            modal.querySelectorAll('.auth-method-btn').forEach(btn => {
                btn.onclick = async () => {
                    const method = btn.dataset.method;
                    closeModal();
                    await proceedWithAuth(providerType, targetInputId, { method });
                };
            });
            return;
        }

        await proceedWithAuth(providerType, targetInputId, {});
    } catch (error) {
        console.error('生成凭据失败:', error);
        showToast(t('common.error'), t('modal.provider.auth.failed') + `: ${error.message}`, 'error');
    }
}

/**
 * 实际执行授权逻辑
 */
async function proceedWithAuth(providerType, targetInputId, extraOptions = {}) {
    if (window.executeGenerateAuthUrl) {
        await window.executeGenerateAuthUrl(providerType, {
            targetInputId,
            ...extraOptions
        });
    } else {
        console.error('executeGenerateAuthUrl not found');
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

// 当前服务模式（由 provider-manager.js 设置）
let currentServiceMode = 'worker';

/**
 * 设置当前服务模式
 * @param {string} mode - 服务模式 ('worker' 或 'standalone')
 */
export function setServiceMode(mode) {
    currentServiceMode = mode;
}

/**
 * 获取当前服务模式
 * @returns {string} 当前服务模式
 */
export function getServiceMode() {
    return currentServiceMode;
}

// 重启/重载服务处理函数
async function handleRestart() {
    try {
        // 根据服务模式执行不同操作
        if (currentServiceMode === 'standalone') {
            // 独立模式：执行重载配置
            await handleReloadConfig();
        } else {
            // 子进程模式：执行重启服务
            await handleRestartService();
        }
    } catch (error) {
        console.error('Operation failed:', error);
        const errorKey = currentServiceMode === 'standalone' ? 'header.reload.failed' : 'header.restart.failed';
        showToast(t('common.error'), t(errorKey) + ': ' + error.message, 'error');
    }
}

/**
 * 重载配置（独立模式）
 */
async function handleReloadConfig() {
    // 确认重载操作
    if (!confirm(t('header.reload.confirm'))) {
        return;
    }
    
    showToast(t('common.info'), t('header.reload.requesting'), 'info');
    
    // 先刷新基础数据
    if (loadInitialData) {
        loadInitialData();
    }
    
    // 如果reloadConfig函数可用，则也刷新配置
    if (reloadConfig) {
        await reloadConfig();
    }
}

/**
 * 重启服务（子进程模式）
 */
async function handleRestartService() {
    // 确认重启操作
    if (!confirm(t('header.restart.confirm'))) {
        return;
    }
    
    showToast(t('common.info'), t('header.restart.requesting'), 'info');
    
    const result = await window.apiClient.post('/restart-service');
    
    if (result.success) {
        showToast(t('common.success'), result.message || t('header.restart.success'), 'success');
        
        // 如果是 worker 模式，服务会自动重启，等待几秒后刷新页面
        if (result.mode === 'worker') {
            setTimeout(() => {
                showToast(t('common.info'), t('header.restart.reconnecting'), 'info');
                // 等待服务重启后刷新页面
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            }, 2000);
        }
    } else {
        // 显示错误信息
        const errorMsg = result.message || result.error?.message || t('header.restart.failed');
        showToast(t('common.error'), errorMsg, 'error');
        
        // 如果是独立模式，显示提示
        if (result.mode === 'standalone') {
            showToast(t('common.info'), result.hint, 'warning');
        }
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