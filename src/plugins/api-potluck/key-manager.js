/**
 * API 大锅饭 - Key 管理模块
 * 使用内存缓存 + 写锁 + 定期持久化，解决并发安全问题
 */

import { promises as fs } from 'fs';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

// 配置常量
const KEYS_STORE_FILE = path.join(process.cwd(), 'configs', 'api-potluck-keys.json');
const KEY_PREFIX = 'maki_';

// 默认配置（会被 user-data-manager 的配置覆盖）
const DEFAULT_CONFIG = {
    defaultDailyLimit: 500,
    persistInterval: 5000
};

// 配置获取函数（由外部注入）
let configGetter = null;

/**
 * 设置配置获取函数
 * @param {Function} getter - 返回配置对象的函数
 */
export function setConfigGetter(getter) {
    configGetter = getter;
}

/**
 * 获取当前配置
 */
function getConfig() {
    if (configGetter) {
        return configGetter();
    }
    return DEFAULT_CONFIG;
}

// 内存缓存
let keyStore = null;
let isDirty = false;
let isWriting = false;
let persistTimer = null;
let currentPersistInterval = DEFAULT_CONFIG.persistInterval;

/**
 * 初始化：从文件加载数据到内存
 */
function ensureLoaded() {
    if (keyStore !== null) return;
    try {
        if (existsSync(KEYS_STORE_FILE)) {
            const content = readFileSync(KEYS_STORE_FILE, 'utf8');
            keyStore = JSON.parse(content);
            // 兼容历史数据：为旧 Key 添加 bonusRemaining 字段
            let needsMigration = false;
            for (const keyData of Object.values(keyStore.keys)) {
                if (keyData.bonusRemaining === undefined) {
                    keyData.bonusRemaining = 0;
                    needsMigration = true;
                }
            }
            if (needsMigration) {
                console.log('[API Potluck] Migrated legacy keys: added bonusRemaining field');
                markDirty();
            }
        } else {
            keyStore = { keys: {} };
            syncWriteToFile();
        }
    } catch (error) {
        console.error('[API Potluck] Failed to load key store:', error.message);
        keyStore = { keys: {} };
    }
    
    // 获取配置的持久化间隔
    const config = getConfig();
    currentPersistInterval = config.persistInterval || DEFAULT_CONFIG.persistInterval;
    
    // 启动定期持久化
    if (!persistTimer) {
        persistTimer = setInterval(persistIfDirty, currentPersistInterval);
        // 进程退出时保存
        process.on('beforeExit', () => persistIfDirty());
        process.on('SIGINT', () => { persistIfDirty(); process.exit(0); });
        process.on('SIGTERM', () => { persistIfDirty(); process.exit(0); });
    }
}

/**
 * 同步写入文件（仅初始化时使用）
 */
function syncWriteToFile() {
    try {
        const dir = path.dirname(KEYS_STORE_FILE);
        if (!existsSync(dir)) {
            require('fs').mkdirSync(dir, { recursive: true });
        }
        writeFileSync(KEYS_STORE_FILE, JSON.stringify(keyStore, null, 2), 'utf8');
    } catch (error) {
        console.error('[API Potluck] Sync write failed:', error.message);
    }
}

/**
 * 异步持久化（带写锁）
 */
async function persistIfDirty() {
    if (!isDirty || isWriting || keyStore === null) return;
    isWriting = true;
    try {
        const dir = path.dirname(KEYS_STORE_FILE);
        if (!existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        // 写入临时文件再重命名，防止写入中断导致文件损坏
        const tempFile = KEYS_STORE_FILE + '.tmp';
        await fs.writeFile(tempFile, JSON.stringify(keyStore, null, 2), 'utf8');
        await fs.rename(tempFile, KEYS_STORE_FILE);
        isDirty = false;
    } catch (error) {
        console.error('[API Potluck] Persist failed:', error.message);
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
 * 生成随机 API Key（确保不重复）
 */
function generateApiKey() {
    ensureLoaded();
    let apiKey;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
        apiKey = `${KEY_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
        attempts++;
        if (attempts >= maxAttempts) {
            throw new Error('Failed to generate unique API key after multiple attempts');
        }
    } while (keyStore.keys[apiKey]);
    
    return apiKey;
}

/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 */
function getTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 检查并重置过期的每日计数
 */
function checkAndResetDailyCount(keyData) {
    const today = getTodayDateString();
    if (keyData.lastResetDate !== today) {
        keyData.todayUsage = 0;
        keyData.lastResetDate = today;
    }
    return keyData;
}

/**
 * 创建新的 API Key
 * @param {string} name - Key 名称
 * @param {number} [dailyLimit] - 每日限额，不传则使用配置的默认值
 */
export async function createKey(name = '', dailyLimit = null) {
    ensureLoaded();
    const config = getConfig();
    const actualDailyLimit = dailyLimit ?? config.defaultDailyLimit ?? DEFAULT_CONFIG.defaultDailyLimit;
    
    const apiKey = generateApiKey();
    const now = new Date().toISOString();
    const today = getTodayDateString();

    const keyData = {
        id: apiKey,
        name: name || `Key-${Object.keys(keyStore.keys).length + 1}`,
        createdAt: now,
        dailyLimit: actualDailyLimit,
        todayUsage: 0,
        totalUsage: 0,
        lastResetDate: today,
        lastUsedAt: null,
        enabled: true,
        bonusRemaining: 0           // 剩余资源包总次数（由同步检查更新）
    };

    keyStore.keys[apiKey] = keyData;
    markDirty();
    await persistIfDirty(); // 创建操作立即持久化

    console.log(`[API Potluck] Created key: ${apiKey.substring(0, 12)}...`);
    return keyData;
}

/**
 * 获取所有 Key 列表
 */
export async function listKeys() {
    ensureLoaded();
    const keys = [];
    for (const [keyId, keyData] of Object.entries(keyStore.keys)) {
        const updated = checkAndResetDailyCount({ ...keyData });
        keys.push({
            ...updated,
            maskedKey: `${keyId.substring(0, 12)}...${keyId.substring(keyId.length - 4)}`
        });
    }
    return keys;
}

/**
 * 获取单个 Key 详情
 */
export async function getKey(keyId) {
    ensureLoaded();
    const keyData = keyStore.keys[keyId];
    if (!keyData) return null;
    return checkAndResetDailyCount({ ...keyData });
}

/**
 * 删除 Key
 */
export async function deleteKey(keyId) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return false;
    delete keyStore.keys[keyId];
    markDirty();
    await persistIfDirty(); // 删除操作立即持久化
    console.log(`[API Potluck] Deleted key: ${keyId.substring(0, 12)}...`);
    return true;
}

/**
 * 更新 Key 的每日限额
 */
export async function updateKeyLimit(keyId, newLimit) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].dailyLimit = newLimit;
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 重置 Key 的当天调用次数
 */
export async function resetKeyUsage(keyId) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].todayUsage = 0;
    keyStore.keys[keyId].lastResetDate = getTodayDateString();
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 切换 Key 的启用/禁用状态
 */
export async function toggleKey(keyId) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].enabled = !keyStore.keys[keyId].enabled;
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 更新 Key 名称
 */
export async function updateKeyName(keyId, newName) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].name = newName;
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 重新生成 API Key（保留原有数据，更换 Key ID）
 * @param {string} oldKeyId - 原 Key ID
 * @returns {Promise<{oldKey: string, newKey: string, keyData: Object}|null>}
 */
export async function regenerateKey(oldKeyId) {
    ensureLoaded();
    const oldKeyData = keyStore.keys[oldKeyId];
    if (!oldKeyData) return null;
    
    // 生成新的唯一 Key
    const newKeyId = generateApiKey();
    
    // 复制数据到新 Key
    const newKeyData = {
        ...oldKeyData,
        id: newKeyId,
        regeneratedAt: new Date().toISOString(),
        regeneratedFrom: oldKeyId.substring(0, 12) + '...'
    };
    
    // 删除旧 Key，添加新 Key
    delete keyStore.keys[oldKeyId];
    keyStore.keys[newKeyId] = newKeyData;
    
    markDirty();
    await persistIfDirty(); // 立即持久化
    
    console.log(`[API Potluck] Regenerated key: ${oldKeyId.substring(0, 12)}... -> ${newKeyId.substring(0, 12)}...`);
    
    return {
        oldKey: oldKeyId,
        newKey: newKeyId,
        keyData: newKeyData
    };
}

/**
 * 验证 API Key 是否有效且有配额（每日限额 + 资源包）
 */
export async function validateKey(apiKey) {
    ensureLoaded();
    if (!apiKey || !apiKey.startsWith(KEY_PREFIX)) {
        return { valid: false, reason: 'invalid_format' };
    }
    const keyData = keyStore.keys[apiKey];
    if (!keyData) return { valid: false, reason: 'not_found' };
    if (!keyData.enabled) return { valid: false, reason: 'disabled' };

    // 直接在内存中检查和重置
    checkAndResetDailyCount(keyData);
    
    // 检查每日限额
    if (keyData.todayUsage < keyData.dailyLimit) {
        return { valid: true, keyData, useBonus: false };
    }
    
    // 每日限额用尽，检查资源包
    const bonusRemaining = keyData.bonusRemaining || 0;
    if (bonusRemaining > 0) {
        return { valid: true, keyData, useBonus: true, bonusRemaining };
    }
    
    return { valid: false, reason: 'quota_exceeded', keyData };
}

/**
 * 增加 Key 的使用次数（原子操作，直接修改内存）
 * 优先消耗每日限额，用尽后消耗资源包
 * @param {string} apiKey - API Key
 * @param {Function} [onBonusUsed] - 资源包消耗回调，用于更新 data 中的 usedCount
 */
export async function incrementUsage(apiKey, onBonusUsed = null) {
    ensureLoaded();
    const keyData = keyStore.keys[apiKey];
    if (!keyData) return null;

    checkAndResetDailyCount(keyData);
    
    let usedBonus = false;
    
    // 优先消耗每日限额
    if (keyData.todayUsage < keyData.dailyLimit) {
        keyData.todayUsage += 1;
    } else {
        // 每日限额用尽，消耗资源包
        const bonusRemaining = keyData.bonusRemaining || 0;
        
        if (bonusRemaining > 0) {
            keyData.bonusRemaining = bonusRemaining - 1;
            usedBonus = true;
            
            // 触发回调更新 data 中的 usedCount
            if (onBonusUsed) {
                await onBonusUsed(apiKey);
            }
        } else {
            // 无可用配额
            return null;
        }
    }
    
    keyData.totalUsage += 1;
    keyData.lastUsedAt = new Date().toISOString();
    markDirty();
    
    return {
        ...keyData,
        usedBonus
    };
}

/**
 * 获取统计信息
 */
export async function getStats() {
    ensureLoaded();
    const keys = Object.values(keyStore.keys);
    let enabledKeys = 0, todayTotalUsage = 0, totalUsage = 0;

    for (const key of keys) {
        checkAndResetDailyCount(key);
        if (key.enabled) enabledKeys++;
        todayTotalUsage += key.todayUsage;
        totalUsage += key.totalUsage;
    }

    return {
        totalKeys: keys.length,
        enabledKeys,
        disabledKeys: keys.length - enabledKeys,
        todayTotalUsage,
        totalUsage
    };
}

// ============ 凭证资源包管理 ============

/**
 * 更新 Key 的剩余资源包次数（由同步检查调用）
 * @param {string} keyId - Key ID
 * @param {number} bonusRemaining - 剩余资源包总次数
 * @returns {Promise<boolean>}
 */
export async function updateBonusRemaining(keyId, bonusRemaining) {
    ensureLoaded();
    const keyData = keyStore.keys[keyId];
    if (!keyData) return false;
    
    keyData.bonusRemaining = Math.max(0, bonusRemaining);
    markDirty();
    return true;
}

/**
 * 获取 Key 的资源包信息
 * @param {string} keyId - Key ID
 * @param {Function} getConfigFn - 获取配置的函数（从 user-data-manager 传入）
 * @returns {Promise<Object|null>}
 */
export async function getBonusInfo(keyId, getConfigFn = null) {
    ensureLoaded();
    const keyData = keyStore.keys[keyId];
    if (!keyData) return null;
    
    // 从 user-data-manager 获取配置
    const config = getConfigFn ? getConfigFn() : { bonusPerCredential: 300, bonusValidityDays: 30 };
    
    return {
        bonusRemaining: keyData.bonusRemaining || 0,
        bonusPerCredential: config.bonusPerCredential,
        validityDays: config.bonusValidityDays
    };
}

/**
 * 批量更新所有 Key 的每日限额
 * @param {number} newLimit - 新的每日限额
 * @returns {Promise<{total: number, updated: number}>}
 */
export async function applyDailyLimitToAllKeys(newLimit) {
    ensureLoaded();
    const keys = Object.values(keyStore.keys);
    let updated = 0;
    
    for (const keyData of keys) {
        if (keyData.dailyLimit !== newLimit) {
            keyData.dailyLimit = newLimit;
            updated++;
        }
    }
    
    if (updated > 0) {
        markDirty();
        await persistIfDirty();
    }
    
    console.log(`[API Potluck] Applied daily limit ${newLimit} to ${updated}/${keys.length} keys`);
    return { total: keys.length, updated };
}

/**
 * 获取所有 Key ID 列表
 * @returns {string[]}
 */
export function getAllKeyIds() {
    ensureLoaded();
    return Object.keys(keyStore.keys);
}

// 导出常量
export { KEY_PREFIX };
