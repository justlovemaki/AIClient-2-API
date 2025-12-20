// 路径路由示例功能模块

import { showToast } from './utils.js';
import { t } from './i18n.js';

/**
 * 初始化路径路由示例功能
 */
function initRoutingExamples() {
    // 延迟初始化，确保所有DOM都加载完成
    setTimeout(() => {
        initProtocolTabs();
        initCopyButtons();
        initCardInteractions();
    }, 100);
}

/**
 * 初始化协议标签切换功能
 */
function initProtocolTabs() {
    // 使用事件委托方式绑定点击事件
    document.addEventListener('click', function(e) {
        // 检查点击的是不是协议标签或者其子元素
        const tab = e.target.classList.contains('protocol-tab') ? e.target : e.target.closest('.protocol-tab');
        
        if (tab) {
            e.preventDefault();
            e.stopPropagation();
            
            const targetProtocol = tab.dataset.protocol;
            const card = tab.closest('.routing-example-card');
            
            if (!card) {
                return;
            }
            
            // 移除当前卡片中所有标签和内容的活动状态
            const cardTabs = card.querySelectorAll('.protocol-tab');
            const cardContents = card.querySelectorAll('.protocol-content');
            
            cardTabs.forEach(t => t.classList.remove('active'));
            cardContents.forEach(c => c.classList.remove('active'));
            
            // 为当前标签和对应内容添加活动状态
            tab.classList.add('active');
            
            // 使用更精确的选择器来查找对应的内容
            const targetContent = card.querySelector(`.protocol-content[data-protocol="${targetProtocol}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        }
    });
}

/**
 * 初始化复制按钮功能
 */
function initCopyButtons() {
    document.addEventListener('click', async function(e) {
        if (e.target.closest('.copy-btn')) {
            e.stopPropagation();
            
            const button = e.target.closest('.copy-btn');
            const path = button.dataset.path;
            if (!path) return;
            
            try {
                await navigator.clipboard.writeText(path);
                showToast(t('common.success'), `${t('common.success')}: ${path}`, 'success');
                
                // 临时更改按钮图标
                const icon = button.querySelector('i');
                if (icon) {
                    const originalClass = icon.className;
                    icon.className = 'fas fa-check';
                    button.style.color = 'var(--success-color)';
                    
                    setTimeout(() => {
                        icon.className = originalClass;
                        button.style.color = '';
                    }, 2000);
                }
                
            } catch (error) {
                console.error('Failed to copy to clipboard:', error);
                showToast(t('common.error'), t('common.error'), 'error');
            }
        }
    });
}

/**
 * 初始化卡片交互功能
 */
function initCardInteractions() {
    const routingCards = document.querySelectorAll('.routing-example-card');
    
    routingCards.forEach(card => {
        // 添加悬停效果
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-4px)';
            card.style.boxShadow = 'var(--shadow-lg)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.boxShadow = '';
        });
        
    });
}

/**
 * 获取所有可用的路由端点
 * @returns {Array} 路由端点数组
 */
function getAvailableRoutes() {
    return [
        {
            provider: 'claude-custom',
            name: 'Claude Custom',
            paths: {
                openai: '/claude-custom/v1/chat/completions',
                claude: '/claude-custom/v1/messages'
            },
            description: t('dashboard.routing.official'),
            badge: t('dashboard.routing.official'),
            badgeClass: 'official'
        },
        {
            provider: 'claude-kiro-oauth',
            name: 'Claude Kiro OAuth',
            paths: {
                openai: '/claude-kiro-oauth/v1/chat/completions',
                claude: '/claude-kiro-oauth/v1/messages'
            },
            description: t('dashboard.routing.free'),
            badge: t('dashboard.routing.free'),
            badgeClass: 'oauth'
        },
        {
            provider: 'openai-custom',
            name: 'OpenAI Custom',
            paths: {
                openai: '/openai-custom/v1/chat/completions',
                claude: '/openai-custom/v1/messages'
            },
            description: t('dashboard.routing.official'),
            badge: t('dashboard.routing.official'),
            badgeClass: 'official'
        },
        {
            provider: 'gemini-cli-oauth',
            name: 'Gemini CLI OAuth',
            paths: {
                openai: '/gemini-cli-oauth/v1/chat/completions',
                claude: '/gemini-cli-oauth/v1/messages'
            },
            description: t('dashboard.routing.oauth'),
            badge: t('dashboard.routing.oauth'),
            badgeClass: 'oauth'
        },
        {
            provider: 'openai-qwen-oauth',
            name: 'Qwen OAuth',
            paths: {
                openai: '/openai-qwen-oauth/v1/chat/completions',
                claude: '/openai-qwen-oauth/v1/messages'
            },
            description: 'Qwen Code Plus',
            badge: t('dashboard.routing.oauth'),
            badgeClass: 'oauth'
        },
        {
            provider: 'openaiResponses-custom',
            name: 'OpenAI Responses',
            paths: {
                openai: '/openaiResponses-custom/v1/responses',
                claude: '/openaiResponses-custom/v1/messages'
            },
            description: '结构化对话API',
            badge: 'Responses',
            badgeClass: 'responses'
        }
    ];
}

/**
 * 高亮显示特定提供商路由
 * @param {string} provider - 提供商标识
 */
function highlightProviderRoute(provider) {
    const card = document.querySelector(`[data-provider="${provider}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.borderColor = 'var(--success-color)';
        card.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.1)';
        
        setTimeout(() => {
            card.style.borderColor = '';
            card.style.boxShadow = '';
        }, 3000);
        
        showToast(t('common.success'), t('common.success') + `: ${provider}`, 'success');
    }
}

/**
 * 复制curl命令示例
 * @param {string} provider - 提供商标识
 * @param {Object} options - 选项参数
 */
async function copyCurlExample(provider, options = {}) {
    const routes = getAvailableRoutes();
    const route = routes.find(r => r.provider === provider);
    
    if (!route) {
        showToast(t('common.error'), t('common.error'), 'error');
        return;
    }
    
    const { protocol = 'openai', model = 'default-model', message = 'Hello!' } = options;
    const path = route.paths[protocol];
    
    if (!path) {
        showToast(t('common.error'), t('common.error'), 'error');
        return;
    }
    
    let curlCommand = '';
    
    // 根据不同提供商和协议生成对应的curl命令
    switch (provider) {
        case 'claude-custom':
        case 'claude-kiro-oauth':
            if (protocol === 'openai') {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "${message}"}],
    "max_tokens": 1000
  }'`;
            } else {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "${message}"}]
  }'`;
            }
            break;
            
        case 'openai-custom':
        case 'openai-qwen-oauth':
            if (protocol === 'openai') {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "${message}"}],
    "max_tokens": 1000
  }'`;
            } else {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "${message}"}]
  }'`;
            }
            break;
            
        case 'gemini-cli-oauth':
            if (protocol === 'openai') {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "${message}"}],
    "max_tokens": 1000
  }'`;
            } else {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.0-flash-exp",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "${message}"}]
  }'`;
            }
            break;
            
        case 'openaiResponses-custom':
            if (protocol === 'openai') {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "${model}",
    "input": "${message}",
    "max_output_tokens": 1000
  }'`;
            } else {
                curlCommand = `curl http://localhost:3000${path} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "${message}"}]
  }'`;
            }
            break;
    }
    
    try {
        await navigator.clipboard.writeText(curlCommand);
        showToast(t('common.success'), t('oauth.success.msg'), 'success');
    } catch (error) {
        console.error('Failed to copy curl command:', error);
        showToast(t('common.error'), t('common.error'), 'error');
    }
}

export {
    initRoutingExamples,
    getAvailableRoutes,
    highlightProviderRoute,
    copyCurlExample
};