/**
 * 主题切换模块
 * 支持亮色/暗黑主题切换，并保存用户偏好到 localStorage
 */

// 主题常量
const THEME_KEY = 'theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

/**
 * 获取当前主题
 * @returns {string} 当前主题 ('light' 或 'dark')
 */
export function getCurrentTheme() {
    // 优先从 localStorage 获取
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        return savedTheme;
    }
    
    // 检查系统偏好
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return THEME_DARK;
    }
    
    return THEME_LIGHT;
}

/**
 * 设置主题
 * @param {string} theme - 主题名称 ('light' 或 'dark')
 */
export function setTheme(theme) {
    const root = document.documentElement;
    
    if (theme === THEME_DARK) {
        root.setAttribute('data-theme', THEME_DARK);
    } else {
        root.removeAttribute('data-theme');
    }
    
    // 保存到 localStorage
    localStorage.setItem(THEME_KEY, theme);
    
    // 更新 meta theme-color
    updateMetaThemeColor(theme);
    
    // 触发自定义事件
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

/**
 * 切换主题
 * @returns {string} 切换后的主题
 */
export function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    setTheme(newTheme);
    return newTheme;
}

/**
 * 更新 meta theme-color
 * @param {string} theme - 主题名称
 */
function updateMetaThemeColor(theme) {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        // 暗黑主题使用深色，亮色主题使用主色调
        metaThemeColor.setAttribute('content', theme === THEME_DARK ? '#1f2937' : '#059669');
    }
}

/**
 * 初始化主题切换器
 * @param {string} [toggleButtonId='themeToggleBtn'] - 切换按钮的 ID
 */
export function initThemeSwitcher(toggleButtonId = 'themeToggleBtn') {
    // 应用保存的主题或系统偏好
    const savedTheme = getCurrentTheme();
    setTheme(savedTheme);
    
    // 绑定切换按钮事件
    const toggleBtn = document.getElementById(toggleButtonId);
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const newTheme = toggleTheme();
            console.log(`主题已切换为: ${newTheme === THEME_DARK ? '暗黑模式' : '亮色模式'}`);
        });
    }
    
    // 监听系统主题变化
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e) => {
            // 只有在用户没有手动设置主题时才跟随系统
            const savedTheme = localStorage.getItem(THEME_KEY);
            if (!savedTheme) {
                setTheme(e.matches ? THEME_DARK : THEME_LIGHT);
            }
        });
    }
    
    console.log(`主题切换器已初始化，当前主题: ${savedTheme === THEME_DARK ? '暗黑模式' : '亮色模式'}`);
}

/**
 * 检查当前是否为暗黑主题
 * @returns {boolean}
 */
export function isDarkTheme() {
    return getCurrentTheme() === THEME_DARK;
}

// 导出常量
export { THEME_LIGHT, THEME_DARK };