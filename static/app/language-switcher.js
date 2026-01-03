// 语言切换器组件
import { setLanguage, getCurrentLanguage, t } from './i18n.js';

// 创建语言切换器 HTML
export function createLanguageSwitcher() {
    const currentLang = getCurrentLanguage();
    
    const switcher = document.createElement('div');
    switcher.className = 'language-switcher';
    switcher.innerHTML = `
        <button class="language-btn" id="languageBtn" aria-label="切换语言">
            <i class="fas fa-globe"></i>
            <span class="current-lang">${currentLang === 'zh-CN' ? '中文' : 'EN'}</span>
        </button>
        <div class="language-dropdown" id="languageDropdown">
            <button class="language-option ${currentLang === 'zh-CN' ? 'active' : ''}" data-lang="zh-CN">
                <i class="fas fa-check"></i>
                <span>简体中文</span>
            </button>
            <button class="language-option ${currentLang === 'en-US' ? 'active' : ''}" data-lang="en-US">
                <i class="fas fa-check"></i>
                <span>English</span>
            </button>
        </div>
    `;
    
    return switcher;
}

// 初始化语言切换器
export function initLanguageSwitcher() {
    // 创建并添加语言切换器到 header
    const headerControls = document.querySelector('.header-controls');
    if (headerControls) {
        const switcher = createLanguageSwitcher();
        // 追加到最后位置（最右边）
        headerControls.appendChild(switcher);
        
        // 绑定事件
        bindLanguageSwitcherEvents();
    }
}

// 绑定语言切换器事件
function bindLanguageSwitcherEvents() {
    const languageBtn = document.getElementById('languageBtn');
    const languageDropdown = document.getElementById('languageDropdown');
    const languageOptions = document.querySelectorAll('.language-option');
    
    if (!languageBtn || !languageDropdown) return;
    
    // 切换下拉菜单显示/隐藏
    languageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        languageDropdown.classList.toggle('show');
    });
    
    // 点击语言选项
    languageOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const lang = option.getAttribute('data-lang');
            
            // 切换语言
            setLanguage(lang);
            
            // 更新按钮文本
            const currentLangSpan = languageBtn.querySelector('.current-lang');
            if (currentLangSpan) {
                currentLangSpan.textContent = lang === 'zh-CN' ? '中文' : 'EN';
            }
            
            // 更新选中状态
            languageOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            // 隐藏下拉菜单
            languageDropdown.classList.remove('show');
            
            // 显示提示
            showToast(t('common.success'), lang === 'zh-CN' ? '已切换到简体中文' : 'Switched to English', 'success');
        });
    });
    
    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', () => {
        languageDropdown.classList.remove('show');
    });
}

// 显示提示消息（使用现有的 toast 系统）
function showToast(title, message, type = 'info') {
    // 检查是否有 showToast 函数
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, type);
    } else {
        // 如果没有，使用简单的 alert
        console.log(`${title}: ${message}`);
    }
}

export default {
    createLanguageSwitcher,
    initLanguageSwitcher
};