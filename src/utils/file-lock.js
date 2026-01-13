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

export default {
    acquireFileLock,
    withFileLock,
    isFileLocked,
    getLockedFileCount
};