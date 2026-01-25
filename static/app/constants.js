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

// DOM元素 - 使用 getter 延迟获取，以支持动态加载的组件
const elements = {
    get serverStatus() { return document.getElementById('serverStatus'); },
    get restartBtn() { return document.getElementById('restartBtn'); },
    get sections() { return document.querySelectorAll('.section'); },
    get navItems() { return document.querySelectorAll('.nav-item'); },
    get logsContainer() { return document.getElementById('logsContainer'); },
    get clearLogsBtn() { return document.getElementById('clearLogs'); },
    get downloadLogsBtn() { return document.getElementById('downloadLogs'); },
    get toggleAutoScrollBtn() { return document.getElementById('toggleAutoScroll'); },
    get saveConfigBtn() { return document.getElementById('saveConfig'); },
    get resetConfigBtn() { return document.getElementById('resetConfig'); },
    get toastContainer() { return document.getElementById('toastContainer'); },
    get modelProvider() { return document.getElementById('modelProvider'); },
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