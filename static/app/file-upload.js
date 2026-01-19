// 文件上传功能模块

import { showToast } from './utils.js';
import { t } from './i18n.js';

/**
 * 文件上传处理器类
 */
class FileUploadHandler {
    constructor() {
        this.currentProvider = 'gemini'; // 默认提供商
        this.initEventListeners();
    }

    /**
     * 初始化事件监听器
     */
    initEventListeners() {
        // 监听所有上传按钮的点击事件
        document.addEventListener('click', (event) => {
            if (event.target.closest('.upload-btn')) {
                const button = event.target.closest('.upload-btn');
                const targetInputId = button.getAttribute('data-target');
                if (targetInputId) {
                    // 尝试从模态框获取 providerType
                    const modal = button.closest('.provider-modal');
                    const providerType = modal ? modal.getAttribute('data-provider-type') : null;
                    this.handleFileUpload(button, targetInputId, providerType);
                }
            }
        });

        // 监听提供商切换事件
        const modelProvider = document.getElementById('modelProvider');
        if (modelProvider) {
            modelProvider.addEventListener('change', (event) => {
                this.updateCurrentProvider(event.target.value);
            });
        }
    }

    /**
     * 更新当前提供商
     * @param {string} provider - 选择的提供商
     */
    updateCurrentProvider(provider) {
        this.currentProvider = this.getProviderKey(provider);
    }

    /**
     * 获取提供商对应的键名
     * @param {string} provider - 提供商名称
     * @returns {string} - 提供商标识
     */
    getProviderKey(provider) {
        const providerMap = {
            'gemini-cli-oauth': 'gemini',
            'gemini-antigravity': 'antigravity',
            'claude-kiro-oauth': 'kiro',
            'openai-qwen-oauth': 'qwen',
            'openai-iflow': 'iflow'
        };
        return providerMap[provider] || 'gemini';
    }

    /**
     * 处理文件上传
     * @param {HTMLElement} button - 上传按钮元素
     * @param {string} targetInputId - 目标输入框ID
     * @param {string} providerType - 提供商类型
     */
    async handleFileUpload(button, targetInputId, providerType) {
        // 创建隐藏的文件输入元素
        const fileInput = this.createFileInput();
        
        // 设置文件选择回调
        fileInput.onchange = async (event) => {
            const file = event.target.files[0];
            
            if (file) {
                // 只有文件被实际选择后才显示加载状态并上传
                this.setButtonLoading(button, true);
                await this.uploadFile(file, targetInputId, button, providerType);
            }
            
            // 清理临时文件输入元素
            fileInput.remove();
        };

        // 触发文件选择
        fileInput.click();
    }

    /**
     * 创建文件输入元素
     * @returns {HTMLInputElement} - 文件输入元素
     */
    createFileInput() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,.txt,.key,.pem,.p12,.pfx';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        return fileInput;
    }

    /**
     * 上传文件到服务器
     * @param {File} file - 要上传的文件
     * @param {string} targetInputId - 目标输入框ID
     * @param {HTMLElement} button - 上传按钮
     * @param {string} providerType - 提供商类型
     */
    async uploadFile(file, targetInputId, button, providerType) {
        try {
            // 验证文件类型
            if (!this.validateFileType(file)) {
                showToast(t('common.error'), t('common.fileType'), 'error');
                this.setButtonLoading(button, false);
                return;
            }

            // 验证文件大小 (5MB 限制)
            if (file.size > 5 * 1024 * 1024) {
                showToast(t('common.error'), t('common.fileSize'), 'error');
                this.setButtonLoading(button, false);
                return;
            }

            // 使用传入的 providerType 或回退到 currentProvider
            const provider = providerType ? this.getProviderKey(providerType) : this.currentProvider;

            // 创建 FormData
            const formData = new FormData();
            formData.append('file', file);
            formData.append('provider', provider);
            formData.append('targetInputId', targetInputId);

            // 使用封装接口发送上传请求
            const result = await window.apiClient.upload('/upload-oauth-credentials', formData);
            
            // 成功上传，设置文件路径到输入框
            this.setFilePathToInput(targetInputId, result.filePath);
            showToast(t('common.success'), t('common.uploadSuccess'), 'success');

        } catch (error) {
            console.error('文件上传错误:', error);
            showToast(t('common.error'), t('common.uploadFailed') + ': ' + error.message, 'error');
        } finally {
            this.setButtonLoading(button, false);
        }
    }

    /**
     * 验证文件类型
     * @param {File} file - 要验证的文件
     * @returns {boolean} - 是否为有效文件类型
     */
    validateFileType(file) {
        const allowedExtensions = ['.json', '.txt', '.key', '.pem', '.p12', '.pfx'];
        const fileName = file.name.toLowerCase();
        return allowedExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * 设置按钮加载状态
     * @param {HTMLElement} button - 按钮元素
     * @param {boolean} isLoading - 是否加载中
     */
    setButtonLoading(button, isLoading) {
        const icon = button.querySelector('i');
        if (isLoading) {
            button.disabled = true;
            icon.className = 'fas fa-spinner fa-spin';
        } else {
            button.disabled = false;
            icon.className = 'fas fa-upload';
        }
    }

    /**
     * 设置文件路径到输入框
     * @param {string} inputId - 输入框ID
     * @param {string} filePath - 文件路径
     */
    setFilePathToInput(inputId, filePath) {
        // console.log('设置文件路径到输入框:', inputId, filePath);
        let input = document.getElementById(inputId);
        if (input) {
            // console.log('输入框元素存在，设置文件路径:', filePath);
            input.value = filePath;
            // 同时更新data-config-value属性（用于编辑模式）
            if (input.hasAttribute('data-config-value')) {
                input.setAttribute('data-config-value', filePath);
                console.log('更新data-config-value属性:', filePath);
            }
            // 触发输入事件，通知其他监听器
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            console.error('无法找到输入框:', inputId);
        }
    }
}

/**
 * 初始化文件上传功能
 */
function initFileUpload() {
    // 文件上传功能是自初始化的单例
    console.log('文件上传功能已初始化');
}

// 导出单例实例
const fileUploadHandler = new FileUploadHandler();

export {
    fileUploadHandler,
    FileUploadHandler,
    initFileUpload
};