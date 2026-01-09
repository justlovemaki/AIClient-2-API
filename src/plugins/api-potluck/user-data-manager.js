/**
 * API 大锅饭 - 用户数据管理模块
 * 管理用户关联的凭据文件路径和资源包
 * 使用 Mutex 解决并发问题
 */

import { promises as fs } from 'fs';
import { existsSync, readFileSync, writeFileSync, watch } from 'fs';
import path from 'path';

// 配置文件路径
const USER_DATA_FILE = path.join(process.cwd(), 'configs', 'api-potluck-data.json');

// 默认配置值
const DEFAULT_CONFIG = {
    defaultDailyLimit: 500,
    bonusPerCredential: 300,
    bonusValidityDays: 30,
    persistInterval: 5000
};

// 内存缓存
let userDataStore = null;
let isDirty = false;
let isWriting = false;
let persistTimer = null;
let fileWatcher = null;
let currentPersistInterval = DEFAULT_CONFIG.persistInterval;

// ============ 简易 Mutex 实现 ============
class SimpleMutex {
    constructor() {
        this._locked = false;
        this._waiting = [];
    }
    
    async acquire() {
        return new Promise((resolve) => {
            if (!this._locked) {
                this._locked = true;
                resolve();
            } else {
                this._waiting.push(resolve);
            }
        });
    }
    
    release() {
        if (this._waiting.length > 0) {
            const next = this._waiting.shift();
            next();
        } else {
            this._locked = false;
        }
    }
    
    async runExclusive(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// 全局锁：用于资源包消耗操作
const bonusMutex = new SimpleMutex();

// ============ 配置管理 ============

/**
 * 获取完整配置（支持热更新）
 */
function getFullConfig() {
    ensureLoaded();
    const config = userDataStore.config || {};
    return {
        defaultDailyLimit: config.defaultDailyLimit ?? DEFAULT_CONFIG.defaultDailyLimit,
        bonusPerCredential: config.bonusPerCredential ?? DEFAULT_CONFIG.bonusPerCredential,
        bonusValidityDays: config.bonusValidityDays ?? DEFAULT_CONFIG.bonusValidityDays,
        persistInterval: config.persistInterval ?? DEFAULT_CONFIG.persistInterval
    };
}

/**
 * 获取资源包配置（兼容旧接口）
 */
function getBonusConfig() {
    const config = getFullConfig();
    return {
        bonusPerCredential: config.bonusPerCredential,
        bonusValidityDays: config.bonusValidityDays
    };
}

/**
 * 更新配置
 * @param {Object} newConfig - 新配置
 * @returns {Object} 更新后的完整配置
 */
export async function updateConfig(newConfig) {
    ensureLoaded();
    
    if (!userDataStore.config) {
        userDataStore.config = {};
    }
    
    // 验证并更新各配置项
    if (typeof newConfig.defaultDailyLimit === 'number' && newConfig.defaultDailyLimit > 0) {
        userDataStore.config.defaultDailyLimit = newConfig.defaultDailyLimit;
    }
    if (typeof newConfig.bonusPerCredential === 'number' && newConfig.bonusPerCredential >= 0) {
        userDataStore.config.bonusPerCredential = newConfig.bonusPerCredential;
    }
    if (typeof newConfig.bonusValidityDays === 'number' && newConfig.bonusValidityDays > 0) {
        userDataStore.config.bonusValidityDays = newConfig.bonusValidityDays;
    }
    if (typeof newConfig.persistInterval === 'number' && newConfig.persistInterval >= 1000) {
        userDataStore.config.persistInterval = newConfig.persistInterval;
        // 更新持久化定时器
        updatePersistTimer(newConfig.persistInterval);
    }
    
    markDirty();
    await persistIfDirty();
    
    const updatedConfig = getFullConfig();
    console.log(`[API Potluck UserData] Config updated:`, updatedConfig);
    return updatedConfig;
}

/**
 * 更新持久化定时器间隔
 */
function updatePersistTimer(newInterval) {
    if (newInterval === currentPersistInterval) return;
    
    currentPersistInterval = newInterval;
    if (persistTimer) {
        clearInterval(persistTimer);
        persistTimer = setInterval(persistIfDirty, currentPersistInterval);
        console.log(`[API Potluck UserData] Persist interval updated to ${currentPersistInterval}ms`);
    }
}

/**
 * 获取当前配置（对外暴露）
 */
export function getConfig() {
    return getFullConfig();
}

/**
 * 兼容旧接口：更新资源包配置
 */
export async function updateBonusConfig(newConfig) {
    return updateConfig(newConfig);
}

/**
 * 初始化：从文件加载数据到内存
 */
function ensureLoaded() {
    if (userDataStore !== null) return;
    try {
        if (existsSync(USER_DATA_FILE)) {
            const content = readFileSync(USER_DATA_FILE, 'utf8');
            userDataStore = JSON.parse(content);
            // 兼容旧数据：确保 config 和 users 存在
            if (!userDataStore.config) {
                userDataStore.config = {};
            }
            if (!userDataStore.users) {
                userDataStore.users = {};
            }
        } else {
            userDataStore = { config: {}, users: {} };
            syncWriteToFile();
        }
    } catch (error) {
        console.error('[API Potluck UserData] Failed to load user data:', error.message);
        userDataStore = { config: {}, users: {} };
    }
    
    // 获取配置的持久化间隔
    const config = userDataStore.config || {};
    currentPersistInterval = config.persistInterval ?? DEFAULT_CONFIG.persistInterval;
    
    // 启动定期持久化
    if (!persistTimer) {
        persistTimer = setInterval(persistIfDirty, currentPersistInterval);
    }
    // 启动文件监听（热更新）
    startFileWatcher();
}

/**
 * 同步写入文件（仅初始化时使用）
 */
function syncWriteToFile() {
    try {
        const dir = path.dirname(USER_DATA_FILE);
        if (!existsSync(dir)) {
            require('fs').mkdirSync(dir, { recursive: true });
        }
        writeFileSync(USER_DATA_FILE, JSON.stringify(userDataStore, null, 2), 'utf8');
    } catch (error) {
        console.error('[API Potluck UserData] Sync write failed:', error.message);
    }
}

/**
 * 异步持久化（带写锁）
 */
async function persistIfDirty() {
    if (!isDirty || isWriting || userDataStore === null) return;
    isWriting = true;
    try {
        const dir = path.dirname(USER_DATA_FILE);
        if (!existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        const tempFile = USER_DATA_FILE + '.tmp';
        await fs.writeFile(tempFile, JSON.stringify(userDataStore, null, 2), 'utf8');
        await fs.rename(tempFile, USER_DATA_FILE);
        isDirty = false;
    } catch (error) {
        console.error('[API Potluck UserData] Persist failed:', error.message);
    } finally {
        isWriting = false;
    }
}

/**
 * 标记数据已修改
 */
function markDirty() {
    isDirty = true;
}

/**
 * 启动文件监听（热更新配置）
 */
let lastReloadTime = 0;
function startFileWatcher() {
    if (fileWatcher) return;
    
    try {
        fileWatcher = watch(USER_DATA_FILE, { persistent: false }, (eventType) => {
            if (eventType !== 'change') return;
            
            // 防抖：忽略自己写入触发的事件
            const now = Date.now();
            if (now - lastReloadTime < 1000 || isWriting) return;
            lastReloadTime = now;
            
            // 重新加载配置部分
            try {
                const content = readFileSync(USER_DATA_FILE, 'utf8');
                const newData = JSON.parse(content);
                
                // 只热更新 config 部分，不覆盖内存中的 users 数据
                if (newData.config) {
                    const oldConfig = userDataStore.config || {};
                    const newConfig = newData.config;
                    
                    // 检查配置是否有变化
                    if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
                        userDataStore.config = newConfig;
                        console.log('[API Potluck UserData] Config hot-reloaded:', getBonusConfig());
                    }
                }
            } catch (error) {
                console.error('[API Potluck UserData] Hot-reload failed:', error.message);
            }
        });
        
        console.log('[API Potluck UserData] File watcher started for config hot-reload');
    } catch (error) {
        console.error('[API Potluck UserData] Failed to start file watcher:', error.message);
    }
}

/**
 * 停止文件监听
 */
export function stopFileWatcher() {
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
    }
}

/**
 * 获取用户数据
 * @param {string} apiKey - 用户的 API Key
 * @returns {Object|null}
 */
export function getUserData(apiKey) {
    ensureLoaded();
    return userDataStore.users[apiKey] || null;
}

/**
 * 初始化用户数据（如果不存在）
 * @param {string} apiKey - 用户的 API Key
 * @returns {Object}
 */
export function ensureUserData(apiKey) {
    ensureLoaded();
    if (!userDataStore.users[apiKey]) {
        userDataStore.users[apiKey] = {
            credentials: [],
            credentialBonuses: [],
            createdAt: new Date().toISOString()
        };
        markDirty();
    }
    // 兼容旧数据：添加 credentialBonuses 数组
    if (!userDataStore.users[apiKey].credentialBonuses) {
        userDataStore.users[apiKey].credentialBonuses = [];
        markDirty();
    }
    return userDataStore.users[apiKey];
}

/**
 * 添加凭据路径到用户
 * @param {string} apiKey - 用户的 API Key
 * @param {Object} credentialInfo - 凭据信息
 * @param {string} credentialInfo.path - 凭据文件路径
 * @param {string} credentialInfo.provider - 提供商类型 (如 'claude-kiro-oauth')
 * @param {string} [credentialInfo.authMethod] - 认证方式 (如 'builder-id', 'google', 'github')
 * @returns {Object} 添加的凭据信息
 */
export async function addUserCredential(apiKey, credentialInfo) {
    ensureLoaded();
    const userData = ensureUserData(apiKey);
    
    // 检查是否已存在相同路径
    const existingIndex = userData.credentials.findIndex(c => c.path === credentialInfo.path);
    
    // 只保留核心字段，健康状态从主服务实时获取
    const credential = {
        id: `cred_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        path: credentialInfo.path,
        provider: credentialInfo.provider || 'claude-kiro-oauth',
        authMethod: credentialInfo.authMethod || 'unknown',
        addedAt: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
        // 更新已存在的凭据，保留原有 id 和 addedAt
        credential.id = userData.credentials[existingIndex].id;
        credential.addedAt = userData.credentials[existingIndex].addedAt;
        userData.credentials[existingIndex] = credential;
    } else {
        userData.credentials.push(credential);
    }
    
    markDirty();
    await persistIfDirty();
    
    return credential;
}

/**
 * 移除用户凭据
 * @param {string} apiKey - 用户的 API Key
 * @param {string} credentialId - 凭据 ID
 * @returns {boolean}
 */
export async function removeUserCredential(apiKey, credentialId) {
    ensureLoaded();
    const userData = userDataStore.users[apiKey];
    if (!userData) return false;
    
    const index = userData.credentials.findIndex(c => c.id === credentialId);
    if (index === -1) return false;
    
    userData.credentials.splice(index, 1);
    markDirty();
    await persistIfDirty();
    
    return true;
}

/**
 * 获取用户的所有凭据
 * @param {string} apiKey - 用户的 API Key
 * @returns {Array}
 */
export function getUserCredentials(apiKey) {
    ensureLoaded();
    const userData = userDataStore.users[apiKey];
    return userData ? userData.credentials : [];
}

/**
 * 通过路径查找凭据
 * @param {string} apiKey - 用户的 API Key
 * @param {string} credPath - 凭据文件路径
 * @returns {Object|null}
 */
export function findCredentialByPath(apiKey, credPath) {
    ensureLoaded();
    const userData = userDataStore.users[apiKey];
    if (!userData) return null;
    
    return userData.credentials.find(c => c.path === credPath) || null;
}

/**
 * 检查凭据路径是否已被任何用户使用
 * @param {string} credPath - 凭据文件路径
 * @returns {{exists: boolean, apiKey?: string}}
 */
export function isCredentialPathUsed(credPath) {
    ensureLoaded();
    for (const [apiKey, userData] of Object.entries(userDataStore.users)) {
        const found = userData.credentials.find(c => c.path === credPath);
        if (found) {
            return { exists: true, apiKey };
        }
    }
    return { exists: false };
}

/**
 * 迁移用户凭据到新 Key（用于 Key 重置时）
 * @param {string} oldApiKey - 旧 API Key
 * @param {string} newApiKey - 新 API Key
 * @returns {Promise<boolean>}
 */
export async function migrateUserCredentials(oldApiKey, newApiKey) {
    ensureLoaded();
    const oldUserData = userDataStore.users[oldApiKey];
    if (!oldUserData) return false;
    
    // 将旧用户数据迁移到新 Key
    userDataStore.users[newApiKey] = {
        ...oldUserData,
        migratedFrom: oldApiKey.substring(0, 12) + '...',
        migratedAt: new Date().toISOString()
    };
    
    // 删除旧用户数据
    delete userDataStore.users[oldApiKey];
    
    markDirty();
    await persistIfDirty();
    
    console.log(`[API Potluck UserData] Migrated credentials from ${oldApiKey.substring(0, 12)}... to ${newApiKey.substring(0, 12)}...`);
    return true;
}

/**
 * 获取所有用户及其凭据（用于批量健康检查）
 * @returns {Array<{apiKey: string, credentials: Array}>}
 */
export function getAllUsersCredentials() {
    ensureLoaded();
    const result = [];
    for (const [apiKey, userData] of Object.entries(userDataStore.users)) {
        if (userData.credentials && userData.credentials.length > 0) {
            result.push({
                apiKey,
                credentials: userData.credentials
            });
        }
    }
    return result;
}

// ============ 凭证资源包管理 ============

/**
 * 计算资源包过期时间（使用动态配置）
 * @param {string} grantedAt - 授予时间
 * @returns {Date}
 */
function calculateExpiresAt(grantedAt) {
    const { bonusValidityDays } = getBonusConfig();
    const granted = new Date(grantedAt);
    return new Date(granted.getTime() + bonusValidityDays * 24 * 60 * 60 * 1000);
}

/**
 * 检查资源包是否过期
 * @param {Object} bonus - 资源包对象
 * @returns {boolean}
 */
function isBonusExpired(bonus) {
    const expiresAt = calculateExpiresAt(bonus.grantedAt);
    return new Date() > expiresAt;
}

/**
 * 为凭证添加资源包（凭证健康时调用）
 * @param {string} apiKey - 用户的 API Key
 * @param {string} credentialId - 凭证 ID
 * @returns {Object|null} 添加的资源包信息
 */
export async function addCredentialBonus(apiKey, credentialId) {
    ensureLoaded();
    const userData = ensureUserData(apiKey);
    
    // 检查是否已存在
    const existing = userData.credentialBonuses.find(b => b.credentialId === credentialId);
    if (existing) {
        return existing;
    }
    
    const bonus = {
        credentialId,
        grantedAt: new Date().toISOString(),
        usedCount: 0
    };
    
    userData.credentialBonuses.push(bonus);
    markDirty();
    
    console.log(`[API Potluck UserData] Added bonus for credential: ${credentialId}`);
    return bonus;
}

/**
 * 移除凭证资源包（凭证失效时调用）
 * @param {string} apiKey - 用户的 API Key
 * @param {string} credentialId - 凭证 ID
 * @returns {boolean}
 */
export async function removeCredentialBonus(apiKey, credentialId) {
    ensureLoaded();
    const userData = userDataStore.users[apiKey];
    if (!userData || !userData.credentialBonuses) return false;
    
    const index = userData.credentialBonuses.findIndex(b => b.credentialId === credentialId);
    if (index === -1) return false;
    
    userData.credentialBonuses.splice(index, 1);
    markDirty();
    
    console.log(`[API Potluck UserData] Removed bonus for credential: ${credentialId}`);
    return true;
}

/**
 * 消耗资源包次数（FIFO 顺序，使用 Mutex 保证并发安全）
 * @param {string} apiKey - 用户的 API Key
 * @returns {boolean} 是否成功消耗
 */
export async function consumeBonus(apiKey) {
    // 使用 Mutex 保证并发安全
    return bonusMutex.runExclusive(async () => {
        ensureLoaded();
        const userData = userDataStore.users[apiKey];
        if (!userData || !userData.credentialBonuses) return false;
        
        const { bonusPerCredential } = getBonusConfig();
        
        // 按 grantedAt 排序（FIFO）
        const sortedBonuses = userData.credentialBonuses
            .filter(b => !isBonusExpired(b))
            .sort((a, b) => new Date(a.grantedAt) - new Date(b.grantedAt));
        
        // 找到第一个有剩余次数的资源包
        for (const bonus of sortedBonuses) {
            const remaining = bonusPerCredential - bonus.usedCount;
            if (remaining > 0) {
                bonus.usedCount += 1;
                markDirty();
                return true;
            }
        }
        
        return false;
    });
}

/**
 * 计算用户的剩余资源包总次数
 * @param {string} apiKey - 用户的 API Key
 * @param {Set<string>} [healthyCredentialIds] - 健康凭证 ID 集合（可选，用于过滤）
 * @returns {number}
 */
export function calculateBonusRemaining(apiKey, healthyCredentialIds = null) {
    ensureLoaded();
    const userData = userDataStore.users[apiKey];
    if (!userData || !userData.credentialBonuses) return 0;
    
    const { bonusPerCredential } = getBonusConfig();
    
    let total = 0;
    for (const bonus of userData.credentialBonuses) {
        // 检查是否过期
        if (isBonusExpired(bonus)) continue;
        
        // 如果提供了健康凭证集合，检查凭证是否健康
        if (healthyCredentialIds && !healthyCredentialIds.has(bonus.credentialId)) continue;
        
        const remaining = bonusPerCredential - bonus.usedCount;
        if (remaining > 0) {
            total += remaining;
        }
    }
    
    return total;
}

/**
 * 同步资源包状态（根据健康凭证列表）
 * 兼容历史数据：为已有健康凭证创建资源包，使用凭证的 addedAt 作为 grantedAt
 * @param {string} apiKey - 用户的 API Key
 * @param {Array<{id: string, isHealthy: boolean, addedAt?: string}>} credentialsWithHealth - 带健康状态的凭证列表
 * @returns {{added: number, removed: number, bonusRemaining: number}}
 */
export async function syncCredentialBonuses(apiKey, credentialsWithHealth) {
    ensureLoaded();
    const userData = ensureUserData(apiKey);
    
    let added = 0, removed = 0;
    
    // 获取健康凭证 ID 集合
    const healthyIds = new Set(
        credentialsWithHealth
            .filter(c => c.isHealthy === true)
            .map(c => c.id)
    );
    
    // 为新的健康凭证添加资源包
    for (const cred of credentialsWithHealth) {
        if (cred.isHealthy !== true) continue;
        
        const exists = userData.credentialBonuses.some(b => b.credentialId === cred.id);
        if (!exists) {
            // 使用凭证的 addedAt 作为资源包授予时间（兼容历史数据）
            const grantedAt = cred.addedAt || new Date().toISOString();
            userData.credentialBonuses.push({
                credentialId: cred.id,
                grantedAt: grantedAt,
                usedCount: 0
            });
            added++;
            console.log(`[API Potluck UserData] Created bonus for credential ${cred.id}, grantedAt: ${grantedAt}`);
        }
    }
    
    // 移除失效凭证的资源包
    const toRemove = userData.credentialBonuses.filter(b => !healthyIds.has(b.credentialId));
    for (const bonus of toRemove) {
        const idx = userData.credentialBonuses.indexOf(bonus);
        if (idx !== -1) {
            userData.credentialBonuses.splice(idx, 1);
            removed++;
        }
    }
    
    // 清理过期资源包
    const expiredCount = userData.credentialBonuses.filter(b => isBonusExpired(b)).length;
    userData.credentialBonuses = userData.credentialBonuses.filter(b => !isBonusExpired(b));
    
    if (added > 0 || removed > 0 || expiredCount > 0) {
        markDirty();
    }
    
    // 计算剩余资源包次数
    const bonusRemaining = calculateBonusRemaining(apiKey, healthyIds);
    
    return { added, removed, bonusRemaining };
}

/**
 * 获取用户的资源包详情
 * @param {string} apiKey - 用户的 API Key
 * @returns {Object}
 */
export function getBonusDetails(apiKey) {
    ensureLoaded();
    const { bonusPerCredential, bonusValidityDays } = getBonusConfig();
    const userData = userDataStore.users[apiKey];
    if (!userData) {
        return {
            bonuses: [],
            totalRemaining: 0,
            bonusPerCredential,
            validityDays: bonusValidityDays
        };
    }
    
    const bonuses = (userData.credentialBonuses || [])
        .filter(b => !isBonusExpired(b))
        .map(b => ({
            credentialId: b.credentialId,
            grantedAt: b.grantedAt,
            expiresAt: calculateExpiresAt(b.grantedAt).toISOString(),
            usedCount: b.usedCount,
            remaining: bonusPerCredential - b.usedCount
        }));
    
    const totalRemaining = bonuses.reduce((sum, b) => sum + Math.max(0, b.remaining), 0);
    
    return {
        bonuses,
        totalRemaining,
        bonusPerCredential,
        validityDays: bonusValidityDays
    };
}

/**
 * 获取所有用户的 API Key 列表
 * @returns {string[]}
 */
export function getAllUserApiKeys() {
    ensureLoaded();
    return Object.keys(userDataStore.users);
}

export { USER_DATA_FILE };
