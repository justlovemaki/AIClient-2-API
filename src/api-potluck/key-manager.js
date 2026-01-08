/**
 * API 大锅饭 - Key 管理模块
 * 使用内存缓存 + 写锁 + 定期持久化，解决并发安全问题
 */

import { promises as fs } from 'fs';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

// 配置
const KEYS_STORE_FILE = path.join(process.cwd(), 'configs', 'api-potluck-keys.json');
const KEY_PREFIX = 'maki_';
const DEFAULT_DAILY_LIMIT = 1000;
const PERSIST_INTERVAL = 5000; // 5秒持久化一次

// 内存缓存
let keyStore = null;
let isDirty = false;
let isWriting = false;
let persistTimer = null;

/**
 * 初始化：从文件加载数据到内存
 */
function ensureLoaded() {
    if (keyStore !== null) return;
    try {
        if (existsSync(KEYS_STORE_FILE)) {
            const content = readFileSync(KEYS_STORE_FILE, 'utf8');
            keyStore = JSON.parse(content);
        } else {
            keyStore = { keys: {} };
            syncWriteToFile();
        }
    } catch (error) {
        console.error('[API Potluck] Failed to load key store:', error.message);
        keyStore = { keys: {} };
    }
    // 启动定期持久化
    if (!persistTimer) {
        persistTimer = setInterval(persistIfDirty, PERSIST_INTERVAL);
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
 * 生成随机 API Key
 */
function generateApiKey() {
    return `${KEY_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
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
 */
export async function createKey(name = '', dailyLimit = DEFAULT_DAILY_LIMIT) {
    ensureLoaded();
    const apiKey = generateApiKey();
    const now = new Date().toISOString();
    const today = getTodayDateString();

    const keyData = {
        id: apiKey,
        name: name || `Key-${Object.keys(keyStore.keys).length + 1}`,
        createdAt: now,
        dailyLimit,
        todayUsage: 0,
        totalUsage: 0,
        lastResetDate: today,
        lastUsedAt: null,
        enabled: true
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
 * 验证 API Key 是否有效且有配额
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
    if (keyData.todayUsage >= keyData.dailyLimit) {
        return { valid: false, reason: 'quota_exceeded', keyData };
    }
    return { valid: true, keyData };
}

/**
 * 增加 Key 的使用次数（原子操作，直接修改内存）
 */
export async function incrementUsage(apiKey) {
    ensureLoaded();
    const keyData = keyStore.keys[apiKey];
    if (!keyData) return null;

    checkAndResetDailyCount(keyData);
    keyData.todayUsage += 1;
    keyData.totalUsage += 1;
    keyData.lastUsedAt = new Date().toISOString();
    markDirty();
    // 不立即持久化，由定时器批量写入
    return keyData;
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

// 导出常量
export { KEY_PREFIX, DEFAULT_DAILY_LIMIT };
