import * as path from 'path';

/**
 * 文件锁管理器 - 防止并发写入导致文件损坏
 *
 * 使用场景：
 * - 多个异步操作同时读写同一文件
 * - 防止读-改-写竞争条件（Race Condition）
 * - 防止写入交错导致文件内容损坏
 *
 * 注意：这是进程内锁，只能防止同一 Node.js 进程内的并发。
 * 如果需要跨进程文件锁，请使用 proper-lockfile 等库。
 */

// 存储每个文件的锁队列（Promise 链）
// 每个文件对应一个 Promise，新的锁请求会链接到当前 Promise 之后
const fileLockQueues = new Map();

// 存储去重锁的进行中 Promise
// 用于合并相同 key 的并发请求，只执行一次操作
const dedupePromises = new Map();

/**
 * 获取文件锁，确保同一时间只有一个操作可以访问特定文件
 *
 * 实现原理：使用 Promise 链实现队列机制
 * - 每个文件维护一个 Promise 链
 * - 新的锁请求会等待当前链完成，然后创建新的链节点
 * - 这确保了锁的获取是严格串行的，避免竞态条件
 *
 * @param {string} filePath - 文件路径
 * @returns {Promise<() => void>} 释放锁的函数
 *
 * @example
 * const releaseLock = await acquireFileLock('/path/to/file.json');
 * try {
 *     // 读取、修改、写入文件
 *     const data = await fs.readFile(filePath, 'utf8');
 *     const modified = JSON.parse(data);
 *     modified.key = 'new value';
 *     await fs.writeFile(filePath, JSON.stringify(modified, null, 2));
 * } finally {
 *     releaseLock(); // 确保锁被释放
 * }
 */
export async function acquireFileLock(filePath) {
    const normalizedPath = path.resolve(filePath);
    
    // 获取当前队列中的最后一个 Promise（如果存在）
    const currentLock = fileLockQueues.get(normalizedPath) || Promise.resolve();
    
    // 创建释放锁的 resolver
    let releaseLock;
    const newLockPromise = new Promise(resolve => {
        releaseLock = resolve;
    });
    
    // 立即将新的 Promise 加入队列（在 await 之前！）
    // 这是关键：确保后续请求会等待这个新的 Promise
    fileLockQueues.set(normalizedPath, newLockPromise);
    
    // 等待前一个锁释放
    await currentLock;
    
    // 返回释放锁的函数
    return () => {
        // 只有当当前锁仍是队列中的最后一个时才清理
        // 否则保留队列让后续请求继续等待
        if (fileLockQueues.get(normalizedPath) === newLockPromise) {
            fileLockQueues.delete(normalizedPath);
        }
        releaseLock();
    };
}

/**
 * 使用文件锁执行操作的便捷函数
 * @param {string} filePath - 文件路径
 * @param {Function} operation - 要执行的异步操作
 * @returns {Promise<any>} 操作的返回值
 * 
 * @example
 * const result = await withFileLock('/path/to/file.json', async () => {
 *     const data = await fs.readFile(filePath, 'utf8');
 *     const modified = JSON.parse(data);
 *     modified.key = 'new value';
 *     await fs.writeFile(filePath, JSON.stringify(modified, null, 2));
 *     return modified;
 * });
 */
export async function withFileLock(filePath, operation) {
    const releaseLock = await acquireFileLock(filePath);
    try {
        return await operation();
    } finally {
        releaseLock();
    }
}

/**
 * 检查文件是否被锁定（有等待中的锁队列）
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否被锁定
 */
export function isFileLocked(filePath) {
    const normalizedPath = path.resolve(filePath);
    return fileLockQueues.has(normalizedPath);
}

/**
 * 获取当前被锁定的文件数量（用于调试）
 * @returns {number} 被锁定的文件数量
 */
export function getLockedFileCount() {
    return fileLockQueues.size;
}

/**
 * 去重执行 - 合并相同 key 的并发请求，只执行一次操作
 *
 * 与 withFileLock 的区别：
 * - withFileLock（队列锁）：10个并发请求 → 排队执行10次
 * - withDeduplication（去重锁）：10个并发请求 → 只执行1次，共享结果
 *
 * 使用场景：
 * - Token 刷新：多个请求同时发现 token 过期，只需刷新一次
 * - 缓存填充：多个请求同时 cache miss，只需加载一次
 * - 任何"结果可共享"的昂贵操作
 *
 * @param {string} key - 去重的唯一标识符
 * @param {Function} operation - 要执行的异步操作
 * @returns {Promise<any>} 操作的返回值（所有等待者共享同一结果）
 *
 * @example
 * // 多个并发调用只会执行一次 refreshToken
 * const newToken = await withDeduplication('token-refresh', async () => {
 *     const response = await fetch('/refresh');
 *     return response.json();
 * });
 */
export async function withDeduplication(key, operation) {
    // 如果已有相同 key 的操作在进行中，直接等待它的结果
    if (dedupePromises.has(key)) {
        return dedupePromises.get(key);
    }
    
    // 创建新的操作 Promise
    const operationPromise = (async () => {
        try {
            return await operation();
        } finally {
            // 操作完成后清理
            dedupePromises.delete(key);
        }
    })();
    
    // 存入 Map，让后续请求可以共享
    dedupePromises.set(key, operationPromise);
    
    return operationPromise;
}

/**
 * 组合去重锁和文件锁 - 先去重再加文件锁
 *
 * 典型场景：Token 刷新
 * 1. 去重层：10个并发刷新请求 → 合并为1次刷新操作
 * 2. 文件锁层：保护那1次刷新操作的文件写入不与其他操作冲突
 *
 * @param {string} dedupeKey - 去重的唯一标识符
 * @param {string} filePath - 需要保护的文件路径
 * @param {Function} operation - 要执行的异步操作
 * @returns {Promise<any>} 操作的返回值
 *
 * @example
 * // Token 刷新场景
 * const newToken = await withDeduplicationAndFileLock(
 *     'token-refresh-' + credentialId,
 *     '/path/to/token.json',
 *     async () => {
 *         const response = await fetch('/refresh');
 *         const data = await response.json();
 *         await fs.writeFile('/path/to/token.json', JSON.stringify(data));
 *         return data;
 *     }
 * );
 */
export async function withDeduplicationAndFileLock(dedupeKey, filePath, operation) {
    return withDeduplication(dedupeKey, async () => {
        return withFileLock(filePath, operation);
    });
}

/**
 * 检查是否有去重操作正在进行
 * @param {string} key - 去重的唯一标识符
 * @returns {boolean} 是否有操作在进行中
 */
export function isDedupeInProgress(key) {
    return dedupePromises.has(key);
}

/**
 * 获取当前进行中的去重操作数量（用于调试）
 * @returns {number} 进行中的去重操作数量
 */
export function getDedupeCount() {
    return dedupePromises.size;
}

export default {
    acquireFileLock,
    withFileLock,
    isFileLocked,
    getLockedFileCount,
    withDeduplication,
    withDeduplicationAndFileLock,
    isDedupeInProgress,
    getDedupeCount
};