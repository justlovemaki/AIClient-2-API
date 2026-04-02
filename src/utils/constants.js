/**
 * 共享常量定义
 * 集中管理各处使用的硬编码值
 */

// 定时健康检查相关常量
export const HEALTH_CHECK = {
    // 最小检查间隔：60秒（60000毫秒）
    MIN_INTERVAL_MS: 60000,
    // 默认检查间隔：10分钟（600000毫秒）
    DEFAULT_INTERVAL_MS: 600000,
    // 最大检查间隔：1小时（3600000毫秒）- 仅用于前端UI限制
    MAX_INTERVAL_MS: 3600000
};

// 密码安全相关常量
export const PASSWORD = {
    // 最小密码长度（最少12位，与现代安全实践一致）
    MIN_LENGTH: 12,
    // PBKDF2迭代次数（OWASP 2023建议 SHA-512 ≥310,000次）
    PBKDF2_ITERATIONS: 310000,
    // PBKDF2密钥长度（字节）
    PBKDF2_KEYLEN: 64,
    // PBKDF2哈希算法
    PBKDF2_DIGEST: 'sha512'
};

// 网络相关常量
export const NETWORK = {
    // 最小端口号
    MIN_PORT: 1,
    // 最大端口号
    MAX_PORT: 65535,
    // 默认服务器端口
    DEFAULT_PORT: 3000
};

// 请求重试相关常量
export const RETRY = {
    // 最大重试次数
    MAX_RETRIES: 100
};
