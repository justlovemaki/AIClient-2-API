// 提供商管理功能模块

import { providerStats, updateProviderStats } from './constants.js';
import { showToast, formatUptime } from './utils.js';
import { fileUploadHandler } from './file-upload.js';
import { t, getCurrentLanguage } from './i18n.js';

// 保存初始服务器时间和运行时间
let initialServerTime = null;
let initialUptime = null;
let initialLoadTime = null;

/**
 * 加载系统信息
 */
async function loadSystemInfo() {
    try {
        const data = await window.apiClient.get('/system');

        const nodeVersionEl = document.getElementById('nodeVersion');
        const serverTimeEl = document.getElementById('serverTime');
        const memoryUsageEl = document.getElementById('memoryUsage');
        const uptimeEl = document.getElementById('uptime');

        if (nodeVersionEl) nodeVersionEl.textContent = data.nodeVersion || '--';
        if (memoryUsageEl) memoryUsageEl.textContent = data.memoryUsage || '--';
        
        // 保存初始时间用于本地计算
        if (data.serverTime && data.uptime !== undefined) {
            initialServerTime = new Date(data.serverTime);
            initialUptime = data.uptime;
            initialLoadTime = Date.now();
        }
        
        // 初始显示
        if (serverTimeEl) serverTimeEl.textContent = data.serverTime || '--';
        if (uptimeEl) uptimeEl.textContent = data.uptime ? formatUptime(data.uptime) : '--';

    } catch (error) {
        console.error('Failed to load system info:', error);
    }
}

/**
 * 更新服务器时间和运行时间显示（本地计算）
 */
function updateTimeDisplay() {
    if (!initialServerTime || initialUptime === null || !initialLoadTime) {
        return;
    }

    const serverTimeEl = document.getElementById('serverTime');
    const uptimeEl = document.getElementById('uptime');

    // 计算经过的秒数
    const elapsedSeconds = Math.floor((Date.now() - initialLoadTime) / 1000);

    // 更新服务器时间
    if (serverTimeEl) {
        const currentServerTime = new Date(initialServerTime.getTime() + elapsedSeconds * 1000);
        serverTimeEl.textContent = currentServerTime.toLocaleString(getCurrentLanguage(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    // 更新运行时间
    if (uptimeEl) {
        const currentUptime = initialUptime + elapsedSeconds;
        uptimeEl.textContent = formatUptime(currentUptime);
    }
}

/**
 * 加载提供商列表
 */
async function loadProviders() {
    try {
        const data = await window.apiClient.get('/providers');
        renderProviders(data);
    } catch (error) {
        console.error('Failed to load providers:', error);
    }
}

/**
 * 渲染提供商列表
 * @param {Object} providers - 提供商数据
 */
function renderProviders(providers) {
    const container = document.getElementById('providersList');
    if (!container) return;
    
    container.innerHTML = '';

    // 检查是否有提供商池数据
    const hasProviders = Object.keys(providers).length > 0;
    const statsGrid = document.querySelector('#providers .stats-grid');
    
    // 始终显示统计卡片
    if (statsGrid) statsGrid.style.display = 'grid';
    
    // 定义所有支持的提供商显示顺序
    const providerDisplayOrder = [
        'gemini-cli-oauth',
        'gemini-antigravity',
        'openai-custom',
        'claude-custom',
        'claude-kiro-oauth',
        'openai-qwen-oauth',
        'openaiResponses-custom'
    ];
    
    // 获取所有提供商类型并按指定顺序排序
    // 优先显示预定义的所有提供商类型，即使某些提供商没有数据也要显示
    let allProviderTypes;
    if (hasProviders) {
        // 合并预定义类型和实际存在的类型，确保显示所有预定义提供商
        const actualProviderTypes = Object.keys(providers);
        allProviderTypes = [...new Set([...providerDisplayOrder, ...actualProviderTypes])];
    } else {
        allProviderTypes = providerDisplayOrder;
    }
    const sortedProviderTypes = providerDisplayOrder.filter(type => allProviderTypes.includes(type))
        .concat(allProviderTypes.filter(type => !providerDisplayOrder.includes(type)));
    
    // 计算总统计
    let totalAccounts = 0;
    let totalHealthy = 0;
    
    // 按照排序后的提供商类型渲染
    sortedProviderTypes.forEach((providerType) => {
        const accounts = hasProviders ? providers[providerType] || [] : [];
        const providerDiv = document.createElement('div');
        providerDiv.className = 'provider-item';
        providerDiv.dataset.providerType = providerType;
        providerDiv.style.cursor = 'pointer';

        const healthyCount = accounts.filter(acc => acc.isHealthy).length;
        const totalCount = accounts.length;
        const usageCount = accounts.reduce((sum, acc) => sum + (acc.usageCount || 0), 0);
        const errorCount = accounts.reduce((sum, acc) => sum + (acc.errorCount || 0), 0);
        
        totalAccounts += totalCount;
        totalHealthy += healthyCount;

        // 更新全局统计变量
        if (!providerStats.providerTypeStats[providerType]) {
            providerStats.providerTypeStats[providerType] = {
                totalAccounts: 0,
                healthyAccounts: 0,
                totalUsage: 0,
                totalErrors: 0,
                lastUpdate: null
            };
        }
        
        const typeStats = providerStats.providerTypeStats[providerType];
        typeStats.totalAccounts = totalCount;
        typeStats.healthyAccounts = healthyCount;
        typeStats.totalUsage = usageCount;
        typeStats.totalErrors = errorCount;
        typeStats.lastUpdate = new Date().toISOString();

        // 为无数据状态设置特殊样式
        const isEmptyState = !hasProviders || totalCount === 0;
        const statusClass = isEmptyState ? 'status-empty' : (healthyCount === totalCount ? 'status-healthy' : 'status-unhealthy');
        const statusIcon = isEmptyState ? 'fa-info-circle' : (healthyCount === totalCount ? 'fa-check-circle' : 'fa-exclamation-triangle');
        const statusText = isEmptyState ? t('providers.status.empty') : t('providers.status.healthy', { healthy: healthyCount, total: totalCount });

        providerDiv.innerHTML = `
            <div class="provider-header">
                <div class="provider-name">
                    <span class="provider-type-text">${providerType}</span>
                </div>
                <div class="provider-header-right">
                    ${generateAuthButton(providerType)}
                    <div class="provider-status ${statusClass}">
                        <i class="fas fa-${statusIcon}"></i>
                        <span>${statusText}</span>
                    </div>
                </div>
            </div>
            <div class="provider-stats">
                <div class="provider-stat">
                    <span class="provider-stat-label" data-i18n="providers.stat.totalAccounts">${t('providers.stat.totalAccounts')}</span>
                    <span class="provider-stat-value">${totalCount}</span>
                </div>
                <div class="provider-stat">
                    <span class="provider-stat-label" data-i18n="providers.stat.healthyAccounts">${t('providers.stat.healthyAccounts')}</span>
                    <span class="provider-stat-value">${healthyCount}</span>
                </div>
                <div class="provider-stat">
                    <span class="provider-stat-label" data-i18n="providers.stat.usageCount">${t('providers.stat.usageCount')}</span>
                    <span class="provider-stat-value">${usageCount}</span>
                </div>
                <div class="provider-stat">
                    <span class="provider-stat-label" data-i18n="providers.stat.errorCount">${t('providers.stat.errorCount')}</span>
                    <span class="provider-stat-value">${errorCount}</span>
                </div>
            </div>
        `;

        // 如果是空状态，添加特殊样式
        if (isEmptyState) {
            providerDiv.classList.add('empty-provider');
        }

        // 添加点击事件 - 整个提供商组都可以点击
        providerDiv.addEventListener('click', (e) => {
            e.preventDefault();
            openProviderManager(providerType);
        });

        container.appendChild(providerDiv);
        
        // 为授权按钮添加事件监听
        const authBtn = providerDiv.querySelector('.generate-auth-btn');
        if (authBtn) {
            authBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡到父元素
                handleGenerateAuthUrl(providerType);
            });
        }
    });
    
    // 更新统计卡片数据
    const activeProviders = hasProviders ? Object.keys(providers).length : 0;
    updateProviderStatsDisplay(activeProviders, totalHealthy, totalAccounts);
}

/**
 * 更新提供商统计信息
 * @param {number} activeProviders - 活跃提供商数
 * @param {number} healthyProviders - 健康提供商数
 * @param {number} totalAccounts - 总账户数
 */
function updateProviderStatsDisplay(activeProviders, healthyProviders, totalAccounts) {
    // 更新全局统计变量
    const newStats = {
        activeProviders,
        healthyProviders,
        totalAccounts,
        lastUpdateTime: new Date().toISOString()
    };
    
    updateProviderStats(newStats);
    
    // 计算总请求数和错误数
    let totalUsage = 0;
    let totalErrors = 0;
    Object.values(providerStats.providerTypeStats).forEach(typeStats => {
        totalUsage += typeStats.totalUsage || 0;
        totalErrors += typeStats.totalErrors || 0;
    });
    
    const finalStats = {
        ...newStats,
        totalRequests: totalUsage,
        totalErrors: totalErrors
    };
    
    updateProviderStats(finalStats);
    
    // 修改：根据使用次数统计"活跃提供商"和"活动连接"
    // "活跃提供商"：统计有使用次数(usageCount > 0)的提供商类型数量
    let activeProvidersByUsage = 0;
    Object.entries(providerStats.providerTypeStats).forEach(([providerType, typeStats]) => {
        if (typeStats.totalUsage > 0) {
            activeProvidersByUsage++;
        }
    });
    
    // "活动连接"：统计所有提供商账户的使用次数总和
    const activeConnections = totalUsage;
    
    // 更新页面显示
    const activeProvidersEl = document.getElementById('activeProviders');
    const healthyProvidersEl = document.getElementById('healthyProviders');
    const activeConnectionsEl = document.getElementById('activeConnections');
    
    if (activeProvidersEl) activeProvidersEl.textContent = activeProvidersByUsage;
    if (healthyProvidersEl) healthyProvidersEl.textContent = healthyProviders;
    if (activeConnectionsEl) activeConnectionsEl.textContent = activeConnections;
    
    // 打印调试信息到控制台
    console.log('Provider Stats Updated:', {
        activeProviders,
        activeProvidersByUsage,
        healthyProviders,
        totalAccounts,
        totalUsage,
        totalErrors,
        providerTypeStats: providerStats.providerTypeStats
    });
}

/**
 * 打开提供商管理模态框
 * @param {string} providerType - 提供商类型
 */
async function openProviderManager(providerType) {
    try {
        const data = await window.apiClient.get(`/providers/${encodeURIComponent(providerType)}`);
        
        showProviderManagerModal(data);
    } catch (error) {
        console.error('Failed to load provider details:', error);
        showToast(t('common.error'), t('modal.provider.load.failed'), 'error');
    }
}

/**
 * 生成授权按钮HTML
 * @param {string} providerType - 提供商类型
 * @returns {string} 授权按钮HTML
 */
function generateAuthButton(providerType) {
    // 只为支持OAuth的提供商显示授权按钮
    const oauthProviders = ['gemini-cli-oauth', 'gemini-antigravity', 'openai-qwen-oauth', 'claude-kiro-oauth'];
    
    if (!oauthProviders.includes(providerType)) {
        return '';
    }
    
    return `
        <button class="generate-auth-btn" title="生成OAuth授权链接">
            <i class="fas fa-key"></i>
            <span data-i18n="providers.auth.generate">${t('providers.auth.generate')}</span>
        </button>
    `;
}

/**
 * 处理生成授权链接
 * @param {string} providerType - 提供商类型
 */
async function handleGenerateAuthUrl(providerType) {
    // 如果是 Kiro OAuth，先显示认证方式选择对话框
    if (providerType === 'claude-kiro-oauth') {
        showKiroAuthMethodSelector(providerType);
        return;
    }
    
    await executeGenerateAuthUrl(providerType, {});
}

/**
 * 显示 Kiro OAuth 认证方式选择对话框
 * @param {string} providerType - 提供商类型
 */
function showKiroAuthMethodSelector(providerType) {
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
                    <!-- <button class="auth-method-btn" data-method="google" style="display: flex; align-items: center; gap: 12px; padding: 16px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer; transition: all 0.2s;">
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
    
    // 关闭按钮事件
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.modal-cancel');
    [closeBtn, cancelBtn].forEach(btn => {
        btn.addEventListener('click', () => {
            modal.remove();
        });
    });
    
    // 认证方式选择按钮事件
    const methodBtns = modal.querySelectorAll('.auth-method-btn');
    methodBtns.forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.borderColor = '#00a67e';
            btn.style.background = '#f8fffe';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.borderColor = '#e0e0e0';
            btn.style.background = 'white';
        });
        btn.addEventListener('click', async () => {
            const method = btn.dataset.method;
            modal.remove();
            await executeGenerateAuthUrl(providerType, { method });
        });
    });
}

/**
 * 执行生成授权链接
 * @param {string} providerType - 提供商类型
 * @param {Object} extraOptions - 额外选项
 */
async function executeGenerateAuthUrl(providerType, extraOptions = {}) {
    try {
        showToast(t('common.info'), t('modal.provider.auth.initializing'), 'info');
        
        // 使用 fileUploadHandler 中的 getProviderKey 获取目录名称
        const providerDir = fileUploadHandler.getProviderKey(providerType);

        const response = await window.apiClient.post(
            `/providers/${encodeURIComponent(providerType)}/generate-auth-url`,
            {
                saveToConfigs: true,
                providerDir: providerDir,
                ...extraOptions
            }
        );
        
        if (response.success && response.authUrl) {
            // 显示授权信息模态框
            showAuthModal(response.authUrl, response.authInfo);
        } else {
            showToast(t('common.error'), t('modal.provider.auth.failed'), 'error');
        }
    } catch (error) {
        console.error('生成授权链接失败:', error);
        showToast(t('common.error'), t('modal.provider.auth.failed') + `: ${error.message}`, 'error');
    }
}

/**
 * 获取提供商的授权文件路径
 * @param {string} provider - 提供商类型
 * @returns {string} 授权文件路径
 */
function getAuthFilePath(provider) {
    const authFilePaths = {
        'gemini-cli-oauth': '~/.gemini/oauth_creds.json',
        'gemini-antigravity': '~/.antigravity/oauth_creds.json',
        'openai-qwen-oauth': '~/.qwen/oauth_creds.json',
        'claude-kiro-oauth': '~/.aws/sso/cache/kiro-auth-token.json'
    };
    return authFilePaths[provider] || (getCurrentLanguage() === 'en-US' ? 'Unknown Path' : '未知路径');
}

/**
 * 显示授权信息模态框
 * @param {string} authUrl - 授权URL
 * @param {Object} authInfo - 授权信息
 */
function showAuthModal(authUrl, authInfo) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    
    // 获取授权文件路径
    const authFilePath = getAuthFilePath(authInfo.provider);
    
    let instructionsHtml = '';
    if (authInfo.provider === 'openai-qwen-oauth') {
        instructionsHtml = `
            <div class="auth-instructions">
                <h4 data-i18n="oauth.modal.steps">${t('oauth.modal.steps')}</h4>
                <ol>
                    <li data-i18n="oauth.modal.step1">${t('oauth.modal.step1')}</li>
                    <li data-i18n="oauth.modal.step2.qwen">${t('oauth.modal.step2.qwen')}</li>
                    <li data-i18n="oauth.modal.step3">${t('oauth.modal.step3')}</li>
                    <li data-i18n="oauth.modal.step4.qwen" data-i18n-params='{"min":"${Math.floor(authInfo.expiresIn / 60)}"}'>${t('oauth.modal.step4.qwen', { min: Math.floor(authInfo.expiresIn / 60) })}</li>
                </ol>
            </div>
        `;
    } else if (authInfo.provider === 'claude-kiro-oauth') {
        const methodDisplay = authInfo.authMethod === 'builder-id' ? 'AWS Builder ID' : `Social (${authInfo.socialProvider || 'Google'})`;
        const methodAccount = authInfo.authMethod === 'builder-id' ? 'AWS Builder ID' : authInfo.socialProvider || 'Google';
        instructionsHtml = `
            <div class="auth-instructions">
                <h4 data-i18n="oauth.modal.steps">${t('oauth.modal.steps')}</h4>
                <p><strong data-i18n="oauth.kiro.authMethodLabel">${t('oauth.kiro.authMethodLabel')}</strong> ${methodDisplay}</p>
                <ol>
                    <li data-i18n="oauth.kiro.step1">${t('oauth.kiro.step1')}</li>
                    <li data-i18n="oauth.kiro.step2" data-i18n-params='{"method":"${methodAccount}"}'>${t('oauth.kiro.step2', { method: methodAccount })}</li>
                    <li data-i18n="oauth.kiro.step3">${t('oauth.kiro.step3')}</li>
                    <li data-i18n="oauth.kiro.step4">${t('oauth.kiro.step4')}</li>
                </ol>
            </div>
        `;
    } else {
        instructionsHtml = `
            <div class="auth-instructions">
                <h4 data-i18n="oauth.modal.steps">${t('oauth.modal.steps')}</h4>
                <ol>
                    <li data-i18n="oauth.modal.step1">${t('oauth.modal.step1')}</li>
                    <li data-i18n="oauth.modal.step2.google">${t('oauth.modal.step2.google')}</li>
                    <li data-i18n="oauth.modal.step4.google">${t('oauth.modal.step4.google')}</li>
                    <li data-i18n="oauth.modal.step3">${t('oauth.modal.step3')}</li>
                </ol>
            </div>
        `;
    }
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3><i class="fas fa-key"></i> <span data-i18n="oauth.modal.title">${t('oauth.modal.title')}</span></h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="auth-info">
                    <p><strong data-i18n="oauth.modal.provider">${t('oauth.modal.provider')}</strong> ${authInfo.provider}</p>
                    ${instructionsHtml}
                    <div class="auth-url-section">
                        <label data-i18n="oauth.modal.urlLabel">${t('oauth.modal.urlLabel')}</label>
                        <div class="auth-url-container">
                            <input type="text" readonly value="${authUrl}" class="auth-url-input">
                            <button class="copy-btn" data-i18n="oauth.modal.copyTitle" title="复制链接">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-cancel" data-i18n="modal.provider.cancel">${t('modal.provider.cancel')}</button>
                <button class="open-auth-btn">
                    <i class="fas fa-external-link-alt"></i>
                    <span data-i18n="oauth.modal.openInBrowser">${t('oauth.modal.openInBrowser')}</span>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 关闭按钮事件
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.modal-cancel');
    [closeBtn, cancelBtn].forEach(btn => {
        btn.addEventListener('click', () => {
            modal.remove();
        });
    });
    
    // 复制链接按钮
    const copyBtn = modal.querySelector('.copy-btn');
    copyBtn.addEventListener('click', () => {
        const input = modal.querySelector('.auth-url-input');
        input.select();
        document.execCommand('copy');
        showToast(t('common.success'), t('oauth.success.msg'), 'success');
    });
    
    // 在浏览器中打开按钮
    const openBtn = modal.querySelector('.open-auth-btn');
    openBtn.addEventListener('click', () => {
        // 使用子窗口打开，以便监听 URL 变化
        const width = 600;
        const height = 700;
        const left = (window.screen.width - width) / 2 + 600;
        const top = (window.screen.height - height) / 2;
        
        const authWindow = window.open(
            authUrl,
            'OAuthAuthWindow',
            `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`
        );
        
        // 监听 OAuth 成功事件，自动关闭窗口和模态框
        const handleOAuthSuccess = () => {
            if (authWindow && !authWindow.closed) {
                authWindow.close();
            }
            modal.remove();
            window.removeEventListener('oauth_success_event', handleOAuthSuccess);
        };
        window.addEventListener('oauth_success_event', handleOAuthSuccess);
        
        if (authWindow) {
            showToast(t('common.info'), t('oauth.window.opened'), 'info');
            
            // 添加手动输入回调 URL 的 UI
            const urlSection = modal.querySelector('.auth-url-section');
            if (urlSection && !modal.querySelector('.manual-callback-section')) {
            const manualInputHtml = `
                <div class="manual-callback-section" style="margin-top: 20px; padding: 15px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px;">
                    <h4 style="color: #92400e; margin-bottom: 8px;"><i class="fas fa-exclamation-circle"></i> <span data-i18n="oauth.manual.title">${t('oauth.manual.title')}</span></h4>
                    <p style="font-size: 0.875rem; color: #b45309; margin-bottom: 10px;" data-i18n-html="oauth.manual.desc">${t('oauth.manual.desc')}</p>
                    <div class="auth-url-container" style="display: flex; gap: 5px;">
                        <input type="text" class="manual-callback-input" data-i18n="oauth.manual.placeholder" placeholder="粘贴回调 URL (包含 code=...)" style="flex: 1; padding: 8px; border: 1px solid #fcd34d; border-radius: 4px; background: white; color: black;">
                        <button class="btn btn-success apply-callback-btn" style="padding: 8px 15px; white-space: nowrap; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-check"></i> <span data-i18n="oauth.manual.submit">${t('oauth.manual.submit')}</span>
                        </button>
                    </div>
                </div>
            `;
            urlSection.insertAdjacentHTML('afterend', manualInputHtml);
            }

            const manualInput = modal.querySelector('.manual-callback-input');
            const applyBtn = modal.querySelector('.apply-callback-btn');

            // 处理回调 URL 的核心逻辑
            const processCallback = (urlStr) => {
                try {
                    // 尝试清理 URL（有些用户可能会复制多余的文字）
                    const cleanUrlStr = urlStr.trim().match(/https?:\/\/[^\s]+/)?.[0] || urlStr.trim();
                    const url = new URL(cleanUrlStr);
                    
                    if (url.searchParams.has('code') || url.searchParams.has('token')) {
                        clearInterval(pollTimer);
                        // 构造本地可处理的 URL，只修改 hostname，保持原始 URL 的端口号不变
                        const localUrl = new URL(url.href);
                        localUrl.hostname = window.location.hostname;
                        localUrl.protocol = window.location.protocol;
                        
                        showToast(t('common.info'), t('oauth.processing'), 'info');
                        
                        // 优先在子窗口中跳转（如果没关）
                        if (authWindow && !authWindow.closed) {
                            authWindow.location.href = localUrl.href;
                        } else {
                            // 备选方案：通过隐藏 iframe 或者是 fetch
                            const img = new Image();
                            img.src = localUrl.href;
                        }
                        
                    } else {
                        showToast(t('common.warning'), t('oauth.invalid.url'), 'warning');
                    }
                } catch (err) {
                    console.error('处理回调失败:', err);
                    showToast(t('common.error'), t('oauth.error.format'), 'error');
                }
            };

            applyBtn.addEventListener('click', () => {
                processCallback(manualInput.value);
            });

            // 启动定时器轮询子窗口 URL
            const pollTimer = setInterval(() => {
                try {
                    if (authWindow.closed) {
                        clearInterval(pollTimer);
                        return;
                    }
                    // 如果能读到说明回到了同域
                    const currentUrl = authWindow.location.href;
                    if (currentUrl && (currentUrl.includes('code=') || currentUrl.includes('token='))) {
                        processCallback(currentUrl);
                    }
                } catch (e) {
                    // 跨域受限是正常的
                }
            }, 1000);
        } else {
            showToast(t('common.error'), t('oauth.window.blocked'), 'error');
        }
    });
    
}

export {
    loadSystemInfo,
    updateTimeDisplay,
    loadProviders,
    renderProviders,
    updateProviderStatsDisplay,
    openProviderManager,
    showAuthModal
};