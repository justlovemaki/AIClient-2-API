// 主应用入口文件 - 模块化版本

// 导入所有模块
import {
    providerStats,
    REFRESH_INTERVALS
} from './constants.js';

import {
    showToast,
    getProviderStats
} from './utils.js';

import { t } from './i18n.js';

import {
    initFileUpload,
    fileUploadHandler
} from './file-upload.js';

import { 
    initNavigation 
} from './navigation.js';

import {
    initEventListeners,
    setDataLoaders,
    setReloadConfig
} from './event-handlers.js';

import {
    initEventStream,
    setProviderLoaders,
    setConfigLoaders
} from './event-stream.js';

import {
    loadSystemInfo,
    updateTimeDisplay,
    loadProviders,
    openProviderManager,
    showAuthModal,
    executeGenerateAuthUrl
} from './provider-manager.js';

import {
    loadConfiguration,
    saveConfiguration
} from './config-manager.js';

import {
    showProviderManagerModal,
    refreshProviderConfig
} from './modal.js';

import {
    initRoutingExamples
} from './routing-examples.js';

import {
    initUploadConfigManager,
    loadConfigList,
    viewConfig,
    deleteConfig,
    closeConfigModal,
    copyConfigContent,
    reloadConfig
} from './upload-config-manager.js';

import {
    initUsageManager,
    refreshUsage
} from './usage-manager.js';

import {
    initImageZoom
} from './image-zoom.js';

import {
    initPluginManager,
    togglePlugin
} from './plugin-manager.js';

/**
 * 加载初始数据
 */
function loadInitialData() {
    loadSystemInfo();
    loadProviders();
    loadConfiguration();
    // showToast('数据已刷新', 'success');
}

/**
 * 初始化应用
 */
function initApp() {
    // 设置数据加载器
    setDataLoaders(loadInitialData, saveConfiguration);
    
    // 设置reloadConfig函数
    setReloadConfig(reloadConfig);
    
    // 设置提供商加载器
    setProviderLoaders(loadProviders, refreshProviderConfig);
    
    // 设置配置加载器
    setConfigLoaders(loadConfigList);
    
    // 初始化各个模块
    initNavigation();
    initEventListeners();
    initEventStream();
    initFileUpload(); // 初始化文件上传功能
    initRoutingExamples(); // 初始化路径路由示例功能
    initUploadConfigManager(); // 初始化配置管理功能
    initUsageManager(); // 初始化用量管理功能
    initImageZoom(); // 初始化图片放大功能
    initPluginManager(); // 初始化插件管理功能
    loadInitialData();
    
    // 显示欢迎消息
    showToast(t('common.success'), t('common.welcome'), 'success');
    
    // 每5秒更新服务器时间和运行时间显示
    setInterval(() => {
        updateTimeDisplay();
    }, 5000);
    
    // 定期刷新系统信息
    setInterval(() => {
        loadProviders();

        if (providerStats.activeProviders > 0) {
            const stats = getProviderStats(providerStats);
            console.log('=== 提供商统计报告 ===');
            console.log(`活跃提供商: ${stats.activeProviders}`);
            console.log(`健康提供商: ${stats.healthyProviders} (${stats.healthRatio})`);
            console.log(`总账户数: ${stats.totalAccounts}`);
            console.log(`总请求数: ${stats.totalRequests}`);
            console.log(`总错误数: ${stats.totalErrors}`);
            console.log(`成功率: ${stats.successRate}`);
            console.log(`平均每提供商请求数: ${stats.avgUsagePerProvider}`);
            console.log('========================');
        }
    }, REFRESH_INTERVALS.SYSTEM_INFO);

}

// DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', initApp);

// 导出全局函数供其他模块使用
window.loadProviders = loadProviders;
window.openProviderManager = openProviderManager;
window.showProviderManagerModal = showProviderManagerModal;
window.refreshProviderConfig = refreshProviderConfig;
window.fileUploadHandler = fileUploadHandler;
window.showAuthModal = showAuthModal;
window.executeGenerateAuthUrl = executeGenerateAuthUrl;

// 配置管理相关全局函数
window.viewConfig = viewConfig;
window.deleteConfig = deleteConfig;
window.loadConfigList = loadConfigList;
window.closeConfigModal = closeConfigModal;
window.copyConfigContent = copyConfigContent;
window.reloadConfig = reloadConfig;

// 用量管理相关全局函数
window.refreshUsage = refreshUsage;

// 插件管理相关全局函数
window.togglePlugin = togglePlugin;

// 导出调试函数
window.getProviderStats = () => getProviderStats(providerStats);

console.log('AIClient2API 管理控制台已加载 - 模块化版本');
