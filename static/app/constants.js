// 全局变量
let eventSource = null;
let autoScroll = true;
let logs = [];

// 提供商统计全局变量
let providerStats = {
    totalRequests: 0,
    totalErrors: 0,
    activeProviders: 0,
    healthyProviders: 0,
    totalAccounts: 0,
    lastUpdateTime: null,
    providerTypeStats: {} // 详细按类型统计
};

// DOM元素
const elements = {
    serverStatus: document.getElementById('serverStatus'),
    restartBtn: document.getElementById('restartBtn'),
    sections: document.querySelectorAll('.section'),
    navItems: document.querySelectorAll('.nav-item'),
    logsContainer: document.getElementById('logsContainer'),
    clearLogsBtn: document.getElementById('clearLogs'),
    toggleAutoScrollBtn: document.getElementById('toggleAutoScroll'),
    saveConfigBtn: document.getElementById('saveConfig'),
    resetConfigBtn: document.getElementById('resetConfig'),
    toastContainer: document.getElementById('toastContainer'),
    modelProvider: document.getElementById('modelProvider'),
};

// 定期刷新间隔
const REFRESH_INTERVALS = {
    SYSTEM_INFO: 10000
};

// 导出所有常量
export {
    eventSource,
    autoScroll,
    logs,
    providerStats,
    elements,
    REFRESH_INTERVALS
};

// 更新函数
export function setEventSource(source) {
    eventSource = source;
}

export function setAutoScroll(value) {
    autoScroll = value;
}

export function addLog(log) {
    logs.push(log);
}

export function clearLogs() {
    logs = [];
}

export function updateProviderStats(newStats) {
    providerStats = { ...providerStats, ...newStats };
}