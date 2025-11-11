// 导航功能模块

import { elements } from './constants.js';

/**
 * 初始化导航功能
 */
function initNavigation() {
    if (!elements.navItems || !elements.sections) {
        console.warn('导航元素未找到');
        return;
    }

    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = item.dataset.section;

            // 更新导航状态
            elements.navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // 显示对应章节
            elements.sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === sectionId) {
                    section.classList.add('active');
                }
            });
        });
    });
}

/**
 * 切换到指定章节
 * @param {string} sectionId - 章节ID
 */
function switchToSection(sectionId) {
    // 更新导航状态
    elements.navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.dataset.section === sectionId) {
            nav.classList.add('active');
        }
    });

    // 显示对应章节
    elements.sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === sectionId) {
            section.classList.add('active');
        }
    });
}

/**
 * 切换到仪表盘页面
 */
function switchToDashboard() {
    switchToSection('dashboard');
}

/**
 * 切换到提供商页面
 */
function switchToProviders() {
    switchToSection('providers');
}

export {
    initNavigation,
    switchToSection,
    switchToDashboard,
    switchToProviders
};