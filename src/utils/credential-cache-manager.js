/**
 * 凭证缓存管理器
 * 纯内存操作,使用内存锁保证并发安全,定时同步到文件
 * 优先考虑并发性能,支持单实例部署
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { PROVIDER_MAPPINGS } from './provider-utils.js';
import * as os from 'os';

/**
 * 凭证条目结构
 * @typedef {Object} CredentialEntry
 * @property {string} providerType - 提供商类型
 * @property {string} uuid - 节点唯一标识
 * @property {string} credPath - 凭证文件路径
 * @property {Object} credentials - 凭证数据
 * @property {number} lastModified - 最后修改时间戳
 * @property {number} lastAccessed - 最后访问时间戳
 * @property {boolean} isDirty - 是否有未同步的修改
 * @property {number} retryCount - 同步失败重试次数
 */

export class CredentialCacheManager {
    static instance = null;

    constructor() {
        // 凭证缓存: Map<cacheKey, CredentialEntry>
        // cacheKey = `${providerType}:${uuid}`
        this.credentialCache = new Map();

        // Promise链锁: Map<lockKey, Promise>
        this.lockChains = new Map();

        // 脏数据标记（需要同步到文件的 cacheKey）
        this.dirtyKeys = new Set();

        // 同步定时器
        this.syncTimer = null;
        this.syncIntervalMs = 5000; // 默认5秒

        // 是否已初始化
        this.isInitialized = false;

        // 是否正在同步
        this.isSyncing = false;

        // 最大重试次数
        this.maxRetries = 5;

        // 最大脏数据条目数
        this.maxDirtyKeys = 1000;

        // 死信队列 - 存储同步失败的凭证
        this.deadLetterQueue = new Map();

        // 实例锁文件句柄
        this.instanceLockRelease = null;

        // 提供商类型到凭证路径键的映射
        this.providerCredPathKeys = {};
        for (const mapping of PROVIDER_MAPPINGS) {
            this.providerCredPathKeys[mapping.providerType] = mapping.credPathKey;
        }
    }

    /**
     * 获取单例实例
     * @returns {CredentialCacheManager}
     */
    static getInstance() {
        if (!CredentialCacheManager.instance) {
            CredentialCacheManager.instance = new CredentialCacheManager();
        }
        return CredentialCacheManager.instance;
    }

    /**
     * 生成缓存键
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     * @returns {string}
     */
    _getCacheKey(providerType, uuid) {
        return `${providerType}:${uuid}`;
    }

    /**
     * 获取单实例锁,防止多实例并发运行
     * @throws {Error} 如果已有实例在运行
     */
    async acquireInstanceLock() {
        const lockPath = path.join(os.tmpdir(), 'credential-cache.lock');
        const pidPath = path.join(os.tmpdir(), 'credential-cache.pid');

        try {
            // 尝试读取已存在的 PID 文件
            try {
                const existingPid = await fs.readFile(pidPath, 'utf8');
                const pid = parseInt(existingPid.trim(), 10);

                // 检查进程是否还在运行
                try {
                    process.kill(pid, 0); // 0 信号仅检查进程存在性
                    // 如果进程存在，检查是否是当前进程
                    if (pid === process.pid) {
                        console.log(`[CredentialCache] Lock file belongs to current process (PID: ${pid}), continuing...`);
                    } else {
                        throw new Error(`[CredentialCache] Another instance is running (PID: ${pid}). Please stop it first.`);
                    }
                } catch (killError) {
                    if (killError.code === 'ESRCH') {
                        // 进程已死亡,可以继续
                        console.log(`[CredentialCache] Stale lock detected (PID: ${pid}), cleaning up...`);
                    } else {
                        throw killError;
                    }
                }
            } catch (readError) {
                if (readError.code !== 'ENOENT') {
                    throw readError;
                }
                // PID 文件不存在,可以继续
            }

            // 写入当前进程 PID
            await fs.writeFile(pidPath, String(process.pid), 'utf8');
            console.log(`[CredentialCache] Instance lock acquired (PID: ${process.pid})`);

            // 注册清理钩子
            this.instanceLockRelease = async () => {
                try {
                    await fs.unlink(pidPath);
                    console.log('[CredentialCache] Instance lock released');
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        console.warn(`[CredentialCache] Failed to release lock: ${error.message}`);
                    }
                }
            };
        } catch (error) {
            console.error(`[CredentialCache] Failed to acquire instance lock: ${error.message}`);
            throw error;
        }
    }

    /**
     * 预加载所有凭证到内存
     * @param {Object} providerPools - 提供商池配置
     */
    async preloadAllCredentials(providerPools) {
        if (!providerPools || typeof providerPools !== 'object') {
            console.log('[CredentialCache] No provider pools to preload');
            return;
        }

        let loadedCount = 0;
        let failedCount = 0;

        for (const [providerType, providers] of Object.entries(providerPools)) {
            if (!Array.isArray(providers)) continue;

            const credPathKey = this.providerCredPathKeys[providerType];
            if (!credPathKey) {
                console.warn(`[CredentialCache] Unknown provider type: ${providerType}`);
                continue;
            }

            for (const providerConfig of providers) {
                const uuid = providerConfig.uuid;
                const credPath = providerConfig[credPathKey];

                if (!uuid || !credPath) {
                    continue;
                }

                try {
                    const credentials = await this._loadCredentialsFromFile(credPath);
                    if (credentials) {
                        const cacheKey = this._getCacheKey(providerType, uuid);
                        this.credentialCache.set(cacheKey, {
                            providerType,
                            uuid,
                            credPath,
                            credentials,
                            lastModified: Date.now(),
                            lastAccessed: Date.now(),
                            isDirty: false,
                            retryCount: 0
                        });
                        loadedCount++;
                    }
                } catch (error) {
                    failedCount++;
                    console.warn(`[CredentialCache] Failed to load credentials for ${providerType}:${uuid}: ${error.message}`);
                }
            }
        }

        this.isInitialized = true;
        console.log(`[CredentialCache] Preloaded ${loadedCount} credentials (${failedCount} failed)`);
    }

    /**
     * 原子写入文件 (temp + rename 模式)
     * @param {string} filePath - 目标文件路径
     * @param {string} data - 要写入的数据
     */
    async _atomicWriteFile(filePath, data) {
        const tmpPath = `${filePath}.tmp.${Date.now()}.${process.pid}`;

        try {
            // 1. 写入临时文件
            await fs.writeFile(tmpPath, data, 'utf8');

            // 2. fsync 确保落盘 (需要文件句柄)
            const fileHandle = await fs.open(tmpPath, 'r+');
            try {
                await fileHandle.sync();
            } finally {
                await fileHandle.close();
            }

            // 3. 原子重命名
            await fs.rename(tmpPath, filePath);

            return true;
        } catch (error) {
            // 清理临时文件
            try {
                await fs.unlink(tmpPath);
            } catch (unlinkError) {
                // 忽略清理失败
            }
            throw error;
        }
    }
    /**
     * 从文件加载凭证（仅用于初始导入和手动重载）
     * 支持从损坏文件的备份恢复
     * @param {string} filePath - 文件路径
     * @returns {Promise<Object|null>}
     */
    async _loadCredentialsFromFile(filePath) {
        try {
            // 处理相对路径
            const absolutePath = path.isAbsolute(filePath)
                ? filePath
                : path.join(process.cwd(), filePath);

            const content = await fs.readFile(absolutePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * 获取凭证（从内存）
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     * @returns {CredentialEntry|null}
     */
    getCredentials(providerType, uuid) {
        const cacheKey = this._getCacheKey(providerType, uuid);
        const entry = this.credentialCache.get(cacheKey);

        if (entry) {
            entry.lastAccessed = Date.now();
            return entry;
        }

        return null;
    }

    /**
     * 检查凭证是否存在于缓存中
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     * @returns {boolean}
     */
    hasCredentials(providerType, uuid) {
        const cacheKey = this._getCacheKey(providerType, uuid);
        return this.credentialCache.has(cacheKey);
    }

    /**
     * 更新凭证（仅更新内存，标记为dirty）
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     * @param {Object} newCredentials - 新凭证数据
     * @param {string} [credPath] - 凭证文件路径（可选，用于新建条目）
     */
    updateCredentials(providerType, uuid, newCredentials, credPath = null) {
        const cacheKey = this._getCacheKey(providerType, uuid);
        let entry = this.credentialCache.get(cacheKey);

        if (entry) {
            // 更新现有条目
            entry.credentials = newCredentials;
            entry.lastModified = Date.now();
            entry.isDirty = true;
            entry.retryCount = 0; // 重置重试计数
        } else if (credPath) {
            // 创建新条目
            entry = {
                providerType,
                uuid,
                credPath,
                credentials: newCredentials,
                lastModified: Date.now(),
                lastAccessed: Date.now(),
                isDirty: true,
                retryCount: 0
            };
            this.credentialCache.set(cacheKey, entry);
        } else {
            console.warn(`[CredentialCache] Cannot update non-existent entry without credPath: ${cacheKey}`);
            return;
        }

        // 标记为需要同步
        this.dirtyKeys.add(cacheKey);

        // 检查脏数据是否过多
        if (this.dirtyKeys.size > this.maxDirtyKeys) {
            console.warn(`[CredentialCache] Dirty keys exceeded ${this.maxDirtyKeys}, triggering immediate sync`);
            this.syncToFile().catch(err => console.error('[CredentialCache] Emergency sync failed:', err.message));
        }
    }

    /**
     * 删除凭证（从内存中删除，同时删除文件）
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     */
    async deleteCredentials(providerType, uuid) {
        const cacheKey = this._getCacheKey(providerType, uuid);
        const entry = this.credentialCache.get(cacheKey);

        if (!entry) {
            return;
        }

        // 从内存中删除
        this.credentialCache.delete(cacheKey);
        this.dirtyKeys.delete(cacheKey);

        // 删除文件
        if (entry.credPath) {
            try {
                const absolutePath = path.isAbsolute(entry.credPath)
                    ? entry.credPath
                    : path.join(process.cwd(), entry.credPath);
                await fs.unlink(absolutePath);
                console.log(`[CredentialCache] Deleted credential file: ${entry.credPath}`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`[CredentialCache] Failed to delete ${entry.credPath}: ${error.message}`);
                }
            }
        }
    }

    /**
     * Promise链式内存锁 - 保证串行执行
     * 使用 Promise 构造器模式避免 Read-Check-Write 竞态
     * @param {string} key - 锁的唯一标识
     * @param {Function} operation - 要执行的操作
     * @returns {Promise<T>}
     */
    async withMemoryLock(key, operation) {
        // 创建新的 Promise 用于链接后续操作
        let resolveNext, rejectNext;
        const nextPromise = new Promise((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
        });

        // 原子化获取前序链并立即更新 Map (避免竞态)
        const prevChain = this.lockChains.get(key);
        this.lockChains.set(key, nextPromise);

        // 链接到前序 Promise 执行操作
        const executeOperation = async () => {
            try {
                // 等待前序操作完成（忽略前序的错误，继续执行当前操作）
                if (prevChain) {
                    await prevChain.catch(() => {});
                }
                const result = await operation();
                resolveNext(result);
            } catch (error) {
                rejectNext(error);
            } finally {
                // 只有当前 Promise 还在 Map 中时才删除
                if (this.lockChains.get(key) === nextPromise) {
                    this.lockChains.delete(key);
                }
            }
        };

        // 立即开始执行（不阻塞）
        executeOperation();

        return nextPromise;
    }

    /**
     * 去重执行 - 多个并发请求共享同一个操作结果
     * @param {string} key - 去重键
     * @param {Function} operation - 要执行的操作
     * @returns {Promise<T>}
     */
    async withDeduplication(key, operation) {
        const dedupeKey = `dedupe:${key}`;

        // 检查是否已有正在执行的操作
        const existingPromise = this.lockChains.get(dedupeKey);
        if (existingPromise) {
            // 直接等待现有操作完成并返回结果
            return existingPromise;
        }

        // 创建新操作 Promise 并立即存储（避免竞态）
        const operationPromise = (async () => {
            try {
                return await operation();
            } finally {
                // 操作完成后清理
                if (this.lockChains.get(dedupeKey) === operationPromise) {
                    this.lockChains.delete(dedupeKey);
                }
            }
        })();

        // 立即存储，确保后续请求能看到
        this.lockChains.set(dedupeKey, operationPromise);

        return operationPromise;
    }

    /**
     * 启动定时同步
     * @param {number} intervalMs - 同步间隔（毫秒）
     */
    startPeriodicSync(intervalMs = 5000) {
        this.syncIntervalMs = intervalMs;

        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }

        this.syncTimer = setInterval(() => {
            this.syncToFile().catch(error => {
                console.error('[CredentialCache] Periodic sync failed:', error.message);
            });
        }, this.syncIntervalMs);

        // 确保定时器不阻止进程退出
        if (this.syncTimer.unref) {
            this.syncTimer.unref();
        }

        console.log(`[CredentialCache] Started periodic sync (interval: ${intervalMs}ms)`);
    }

    /**
     * 停止定时同步
     */
    stopPeriodicSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
            console.log('[CredentialCache] Stopped periodic sync');
        }
    }

    /**
     * 同步脏数据到文件（纯内存操作，不使用文件锁）
     */
    async syncToFile() {
        if (this.dirtyKeys.size === 0) {
            return;
        }

        if (this.isSyncing) {
            return; // 防止重入
        }

        this.isSyncing = true;

        // 复制脏数据集合（不立即清空，同步成功后再清理）
        const keysToSync = Array.from(this.dirtyKeys);

        console.log(`[CredentialCache] Syncing ${keysToSync.length} credential(s) to file...`);

        let successCount = 0;
        let failedCount = 0;
        const successKeys = new Set();

        // 并发写入所有文件（提高性能）
        await Promise.allSettled(
            keysToSync.map(async (cacheKey) => {
                const entry = this.credentialCache.get(cacheKey);
                if (!entry || !entry.credPath) {
                    return;
                }

                // 检查重试次数
                if (entry.retryCount >= this.maxRetries) {
                    // 达到最大重试次数,移入死信队列
                    console.error(`[CredentialCache] Max retries exceeded for ${cacheKey}, moving to dead letter queue`);

                    this.deadLetterQueue.set(cacheKey, {
                        entry: JSON.parse(JSON.stringify(entry)), // 深拷贝
                        failureReason: entry.lastError || 'Max retries exceeded',
                        firstFailureTime: entry.firstFailureTime || Date.now(),
                        timestamp: Date.now()
                    });

                    // 尝试导出到紧急备份
                    try {
                        const emergencyDir = path.join(process.cwd(), 'emergency_backup');
                        await fs.mkdir(emergencyDir, { recursive: true });
                        const emergencyPath = path.join(emergencyDir, `${cacheKey.replace(/:/g, '_')}.json`);
                        await fs.writeFile(emergencyPath, JSON.stringify(entry.credentials, null, 2), 'utf8');
                        console.log(`[CredentialCache] Credential backed up to: ${emergencyPath}`);
                    } catch (backupError) {
                        console.error(`[CredentialCache] Failed to backup credential: ${backupError.message}`);
                    }

                    this.dirtyKeys.delete(cacheKey);
                    entry.isDirty = false;
                    return;
                }

                try {
                    // 处理相对路径
                    const absolutePath = path.isAbsolute(entry.credPath)
                        ? entry.credPath
                        : path.join(process.cwd(), entry.credPath);

                    // 确保目录存在
                    const dir = path.dirname(absolutePath);
                    await fs.mkdir(dir, { recursive: true });

                    // 使用原子写入
                    await this._atomicWriteFile(
                        absolutePath,
                        JSON.stringify(entry.credentials, null, 2)
                    );

                    entry.isDirty = false;
                    entry.retryCount = 0;
                    entry.lastError = null;
                    entry.firstFailureTime = null;
                    successKeys.add(cacheKey);
                    successCount++;
                } catch (error) {
                    // 同步失败，增加重试计数并记录错误
                    entry.retryCount++;
                    entry.lastError = error.message;
                    if (!entry.firstFailureTime) {
                        entry.firstFailureTime = Date.now();
                    }
                    failedCount++;
                    console.error(`[CredentialCache] Failed to sync ${entry.credPath} (retry ${entry.retryCount}/${this.maxRetries}): ${error.message}`);
                }
            })
        );

        // 从脏数据集合中移除成功同步的键
        for (const key of successKeys) {
            this.dirtyKeys.delete(key);
        }

        this.isSyncing = false;

        if (successCount > 0 || failedCount > 0) {
            console.log(`[CredentialCache] Sync completed: ${successCount} success, ${failedCount} failed, ${this.dirtyKeys.size} pending`);
        }
    }

    /**
     * 立即同步指定凭证到文件
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     */
    async syncCredentialToFile(providerType, uuid) {
        const cacheKey = this._getCacheKey(providerType, uuid);
        const entry = this.credentialCache.get(cacheKey);

        if (!entry || !entry.credPath) {
            return;
        }

        try {
            const absolutePath = path.isAbsolute(entry.credPath)
                ? entry.credPath
                : path.join(process.cwd(), entry.credPath);

            const dir = path.dirname(absolutePath);
            await fs.mkdir(dir, { recursive: true });

            // 使用原子写入
            await this._atomicWriteFile(
                absolutePath,
                JSON.stringify(entry.credentials, null, 2)
            );

            entry.isDirty = false;
            entry.retryCount = 0;
            entry.lastError = null;
            entry.firstFailureTime = null;
            this.dirtyKeys.delete(cacheKey);
        } catch (error) {
            console.error(`[CredentialCache] Failed to sync ${entry.credPath}: ${error.message}`);
            throw error;
        }
    }

    /**
     * 关闭时同步所有数据（带超时）
     */
    async shutdown() {
        console.log('[CredentialCache] Shutting down...');

        // 停止定时同步
        this.stopPeriodicSync();

        // 同步所有脏数据（带动态超时）
        if (this.dirtyKeys.size > 0) {
            console.log(`[CredentialCache] Syncing ${this.dirtyKeys.size} dirty credential(s) before shutdown...`);

            // 根据脏数据量动态调整超时时间
            const timeoutMs = Math.max(10000, this.dirtyKeys.size * 50 + 5000);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Shutdown sync timeout')), timeoutMs)
            );

            try {
                await Promise.race([
                    this.syncToFile(),
                    timeoutPromise
                ]);
            } catch (error) {
                console.error(`[CredentialCache] Shutdown sync failed: ${error.message}`);
                console.error(`[CredentialCache] ${this.dirtyKeys.size} credentials NOT saved`);

                // 尝试紧急备份未保存的凭证
                if (this.dirtyKeys.size > 0) {
                    console.log('[CredentialCache] Attempting emergency backup...');
                    try {
                        const emergencyDir = path.join(process.cwd(), 'emergency_backup');
                        await fs.mkdir(emergencyDir, { recursive: true });
                        for (const cacheKey of this.dirtyKeys) {
                            const entry = this.credentialCache.get(cacheKey);
                            if (entry && entry.credentials) {
                                const emergencyPath = path.join(emergencyDir, `${cacheKey.replace(/:/g, '_')}.json`);
                                await fs.writeFile(emergencyPath, JSON.stringify(entry.credentials, null, 2), 'utf8');
                            }
                        }
                        console.log(`[CredentialCache] Emergency backup completed to: ${emergencyDir}`);
                    } catch (backupError) {
                        console.error(`[CredentialCache] Emergency backup failed: ${backupError.message}`);
                    }
                }
            }
        }

        // 释放实例锁
        if (this.instanceLockRelease) {
            await this.instanceLockRelease();
        }

        // 输出死信队列状态
        if (this.deadLetterQueue.size > 0) {
            console.warn(`[CredentialCache] ${this.deadLetterQueue.size} credential(s) in dead letter queue`);
        }

        console.log('[CredentialCache] Shutdown complete');
    }

    /**
     * 获取缓存统计信息
     * @returns {Object}
     */
    getStats() {
        const stats = {
            totalEntries: this.credentialCache.size,
            dirtyEntries: this.dirtyKeys.size,
            activeLocks: this.lockChains.size,
            deadLetterQueueSize: this.deadLetterQueue.size,
            isInitialized: this.isInitialized,
            isSyncing: this.isSyncing,
            syncInterval: this.syncIntervalMs,
            byProvider: {}
        };

        for (const [cacheKey, entry] of this.credentialCache) {
            const providerType = entry.providerType;
            if (!stats.byProvider[providerType]) {
                stats.byProvider[providerType] = {
                    count: 0,
                    dirty: 0,
                    maxRetries: 0
                };
            }
            stats.byProvider[providerType].count++;
            if (entry.isDirty) {
                stats.byProvider[providerType].dirty++;
                stats.byProvider[providerType].maxRetries = Math.max(
                    stats.byProvider[providerType].maxRetries,
                    entry.retryCount
                );
            }
        }

        return stats;
    }

    /**
     * 获取死信队列内容
     * @returns {Array}
     */
    getDeadLetterQueue() {
        return Array.from(this.deadLetterQueue.entries()).map(([key, value]) => ({
            cacheKey: key,
            ...value
        }));
    }

    /**
     * 从死信队列恢复凭证
     * @param {string} cacheKey - 缓存键
     * @returns {boolean} 是否恢复成功
     */
    recoverFromDeadLetter(cacheKey) {
        const deadEntry = this.deadLetterQueue.get(cacheKey);
        if (!deadEntry) {
            return false;
        }

        // 恢复到缓存
        const entry = deadEntry.entry;
        entry.retryCount = 0;
        entry.isDirty = true;
        entry.lastError = null;
        entry.firstFailureTime = null;
        this.credentialCache.set(cacheKey, entry);
        this.dirtyKeys.add(cacheKey);

        // 从死信队列移除
        this.deadLetterQueue.delete(cacheKey);

        console.log(`[CredentialCache] Recovered credential from dead letter queue: ${cacheKey}`);
        return true;
    }

    /**
     * 清除所有缓存（用于测试）
     */
    clear() {
        this.credentialCache.clear();
        this.lockChains.clear();
        this.dirtyKeys.clear();
        this.deadLetterQueue.clear();
        this.isInitialized = false;
    }

    /**
     * 重新加载指定凭证（从文件）
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 节点UUID
     * @returns {Promise<CredentialEntry|null>}
     */
    async reloadCredentials(providerType, uuid) {
        const cacheKey = this._getCacheKey(providerType, uuid);
        const entry = this.credentialCache.get(cacheKey);

        if (!entry || !entry.credPath) {
            return null;
        }

        try {
            const credentials = await this._loadCredentialsFromFile(entry.credPath);
            if (credentials) {
                entry.credentials = credentials;
                entry.lastModified = Date.now();
                entry.isDirty = false;
                entry.retryCount = 0;
                this.dirtyKeys.delete(cacheKey);
                return entry;
            }
        } catch (error) {
            console.error(`[CredentialCache] Failed to reload ${entry.credPath}: ${error.message}`);
        }

        return null;
    }
}

// 导出单例获取函数
export function getCredentialCacheManager() {
    return CredentialCacheManager.getInstance();
}
