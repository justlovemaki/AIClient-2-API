import * as fs from 'fs';
import * as crypto from 'crypto';
import { getServiceAdapter } from './adapter.js';
import logger from '../utils/logger.js';
import { MODEL_PROVIDER, getProtocolPrefix } from '../utils/common.js';
import { getProviderModels } from './provider-models.js';
import axios from 'axios';

/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    // 默认健康检查模型配置
    // 键名必须与 MODEL_PROVIDER 常量值一致
    static DEFAULT_HEALTH_CHECK_MODELS = {
        'gemini-cli-oauth': 'gemini-2.5-flash',
        'gemini-antigravity': 'gemini-2.5-flash',
        'openai-custom': 'gpt-4o-mini',
        'claude-custom': 'claude-3-7-sonnet-20250219',
        'claude-kiro-oauth': 'claude-haiku-4-5',
        'openai-qwen-oauth': 'qwen3-coder-flash',
        'openai-iflow': 'qwen3-coder-plus',
        'openai-codex-oauth': 'gpt-5-codex-mini',
        'openaiResponses-custom': 'gpt-4o-mini',
        'forward-api': 'gpt-4o-mini',
    };

    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.globalConfig = options.globalConfig || {}; // 存储全局配置
        this.providerStatus = {}; // Tracks health and usage for each provider instance
        this.roundRobinIndex = {}; // Tracks the current index for round-robin selection for each provider type
        // 使用 ?? 运算符确保 0 也能被正确设置，而不是被 || 替换为默认值
        this.maxErrorCount = options.maxErrorCount ?? 10; // Default to 10 errors before marking unhealthy
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000; // Default to 10 minutes

            // 日志级别控制
        this.logLevel = options.logLevel || 'info'; // 'debug', 'info', 'warn', 'error'
        
        // 添加防抖机制，避免频繁的文件 I/O 操作
        this.saveDebounceTime = options.saveDebounceTime || 1000; // 默认1秒防抖
        this.saveTimer = null;
        this.pendingSaves = new Set(); // 记录待保存的 providerType
        
        // Fallback 链配置
        this.fallbackChain = options.globalConfig?.providerFallbackChain || {};
        
        // Model Fallback 映射配置
        this.modelFallbackMapping = options.globalConfig?.modelFallbackMapping || {};

        // 并发控制：每个 providerType 的选择锁
        // 用于确保 selectProvider 的排序 and 更新操作是原子的
        this._selectionLocks = {};
        this._isSelecting = {}; // 同步标志位锁

        // --- V2: 读写分离 and 异步刷新队列 ---
        // 刷新并发控制配置
        this.refreshConcurrency = {
            global: options.globalConfig?.REFRESH_CONCURRENCY_GLOBAL ?? 2, // 全局最大并行提供商数
            perProvider: options.globalConfig?.REFRESH_CONCURRENCY_PER_PROVIDER ?? 1 // 每个提供商内部最大并行数
        };
        
        this.activeProviderRefreshes = 0; // 当前正在刷新的提供商类型数量
        this.globalRefreshWaiters = []; // 等待全局并发槽位的任务
        
        this.warmupTarget = options.globalConfig?.WARMUP_TARGET || 0; // 默认预热0个节点
        this.refreshingUuids = new Set(); // 正在刷新的节点 UUID 集合
        
        this.refreshQueues = {}; // 按 providerType 分组的队列
        // 缓冲队列机制：延迟5秒，去重后再执行刷新
        this.refreshBufferQueues = {}; // 按 providerType 分组的缓冲队列
        this.refreshBufferTimers = {}; // 按 providerType 分组的定时器
        this.bufferDelay = options.globalConfig?.REFRESH_BUFFER_DELAY ?? 5000; // 默认5秒缓冲延迟
        
        // 用于并发选点时的原子排序辅助（自增序列）
        this._selectionSequence = 0;
 
        this.initializeProviderStatus();
    }

    /**
     * 检查所有节点的配置文件，如果发现即将过期则触发刷新
     */
    async checkAndRefreshExpiringNodes() {
        this._log('info', 'Checking nodes for approaching expiration dates using provider adapters...');
        
        for (const providerType in this.providerStatus) {
            const providers = this.providerStatus[providerType];
            for (const providerStatus of providers) {
                const config = providerStatus.config;
                
                // 根据 providerType 确定配置文件路径字段名
                let configPath = null;
                if (providerType.startsWith('claude-kiro')) {
                    configPath = config.KIRO_OAUTH_CREDS_FILE_PATH;
                } else if (providerType.startsWith('gemini-cli')) {
                    configPath = config.GEMINI_OAUTH_CREDS_FILE_PATH;
                } else if (providerType.startsWith('gemini-antigravity')) {
                    configPath = config.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH;
                } else if (providerType.startsWith('openai-qwen')) {
                    configPath = config.QWEN_OAUTH_CREDS_FILE_PATH;
                } else if (providerType.startsWith('openai-iflow')) {
                    configPath = config.IFLOW_OAUTH_CREDS_FILE_PATH;
                } else if (providerType.startsWith('openai-codex')) {
                    configPath = config.CODEX_OAUTH_CREDS_FILE_PATH;
                }
                
                // logger.info(`Checking node ${providerStatus.uuid} (${providerType}) expiry date... configPath: ${configPath}`);
                // 排除不健康和禁用的节点
                if (!config.isHealthy || config.isDisabled) continue;

                if (configPath && fs.existsSync(configPath)) {
                    try {
                        if (true) {
                            this._log('warn', `Node ${providerStatus.uuid} (${providerType}) is near expiration. Enqueuing refresh...`);
                            this._enqueueRefresh(providerType, providerStatus);
                        }
                    } catch (err) {
                        this._log('error', `Failed to check expiry for node ${providerStatus.uuid}: ${err.message}`);
                    }
                } else {
                    this._log('debug', `Node ${providerStatus.uuid} (${providerType}) has no valid config file path or file does not exist.`);
                }
            }
        }
    }

    /**
     * 系统预热逻辑：按提供商分组，每组预热 warmupTarget 个节点
     * @returns {Promise<void>}
     */
    async warmupNodes() {
        if (this.warmupTarget <= 0) return;
        this._log('info', `Starting system warmup (Group Target: ${this.warmupTarget} nodes per provider)...`);

        const nodesToWarmup = [];

        for (const type in this.providerStatus) {
            const pool = this.providerStatus[type];
            
            // 挑选当前提供商下需要预热的节点
            const candidates = pool
                .filter(p => p.config.isHealthy && !p.config.isDisabled && !this.refreshingUuids.has(p.uuid))
                .sort((a, b) => {
                    // 优先级 A: 明确标记需要刷新的
                    if (a.config.needsRefresh && !b.config.needsRefresh) return -1;
                    if (!a.config.needsRefresh && b.config.needsRefresh) return 1;

                    // 优先级 B: 按照正常的选择权重排序（最久没用过的优先补）
                    const scoreA = this._calculateNodeScore(a);
                    const scoreB = this._calculateNodeScore(b);
                    return scoreA - scoreB;
                })
                .slice(0, this.warmupTarget);

            candidates.forEach(p => nodesToWarmup.push({ type, status: p }));
        }

        this._log('info', `Warmup: Selected total ${nodesToWarmup.length} nodes across all providers to refresh.`);

        for (const node of nodesToWarmup) {
            this._enqueueRefresh(node.type, node.status, true);
        }

        // 注意：warmupNodes 不等待队列结束，它是异步后台执行的
    }

    /**
     * 将节点放入缓冲队列，延迟5秒后去重并执行刷新
     * @param {string} providerType 
     * @param {object} providerStatus 
     * @param {boolean} force - 是否强制刷新（跳过缓冲队列）
     * @private
     */
    _enqueueRefresh(providerType, providerStatus, force = false) {
        const uuid = providerStatus.uuid;
        
        // 如果已经在刷新中，直接返回
        if (this.refreshingUuids.has(uuid)) {
            this._log('debug', `Node ${uuid} is already in refresh queue.`);
            return;
        }

        // 判断提供商池内的总可用节点数，小于5个时，不等待缓冲，直接加入刷新队列
        const healthyCount = this.getHealthyCount(providerType);
        if (healthyCount < 5) {
            this._log('info', `Provider ${providerType} has only ${healthyCount} healthy nodes. Bypassing buffer and enqueuing refresh for ${uuid} immediately.`);
            this._enqueueRefreshImmediate(providerType, providerStatus, force);
            return;
        }

        // 初始化缓冲队列
        if (!this.refreshBufferQueues[providerType]) {
            this.refreshBufferQueues[providerType] = new Map(); // 使用 Map 自动去重
        }

        const bufferQueue = this.refreshBufferQueues[providerType];
        
        // 检查是否已在缓冲队列中
        const existing = bufferQueue.get(uuid);
        const isNewEntry = !existing;
        
        // 更新或添加节点（保留 force: true 状态）
        bufferQueue.set(uuid, {
            providerStatus,
            force: existing ? (existing.force || force) : force
        });
        
        if (isNewEntry) {
            this._log('debug', `Node ${uuid} added to buffer queue for ${providerType}. Buffer size: ${bufferQueue.size}`);
        } else {
            this._log('debug', `Node ${uuid} already in buffer queue, updated force flag. Buffer size: ${bufferQueue.size}`);
        }

        // 只在新增节点或缓冲队列为空时重置定时器
        // 避免频繁重置导致刷新被无限延迟
        if (isNewEntry || !this.refreshBufferTimers[providerType]) {
            // 清除之前的定时器
            if (this.refreshBufferTimers[providerType]) {
                clearTimeout(this.refreshBufferTimers[providerType]);
            }

            // 设置新的定时器，延迟5秒后处理缓冲队列
            this.refreshBufferTimers[providerType] = setTimeout(() => {
                this._flushRefreshBuffer(providerType);
            }, this.bufferDelay);
        }
    }

    /**
     * 处理缓冲队列，将去重后的节点放入实际刷新队列
     * @param {string} providerType 
     * @private
     */
    _flushRefreshBuffer(providerType) {
        const bufferQueue = this.refreshBufferQueues[providerType];
        if (!bufferQueue || bufferQueue.size === 0) {
            return;
        }

        this._log('info', `Flushing refresh buffer for ${providerType}. Processing ${bufferQueue.size} unique nodes.`);

        // 将缓冲队列中的所有节点放入实际刷新队列
        for (const [uuid, { providerStatus, force }] of bufferQueue.entries()) {
            this._enqueueRefreshImmediate(providerType, providerStatus, force);
        }

        // 清空缓冲队列和定时器
        bufferQueue.clear();
        delete this.refreshBufferTimers[providerType];
    }

    /**
     * 立即将节点放入刷新队列（内部方法，由缓冲队列调用）
     * @param {string} providerType 
     * @param {object} providerStatus 
     * @param {boolean} force 
     * @private
     */
    _enqueueRefreshImmediate(providerType, providerStatus, force = false) {
        const uuid = providerStatus.uuid;
        
        // 再次检查是否已经在刷新中（防止并发问题）
        if (this.refreshingUuids.has(uuid)) {
            this._log('debug', `Node ${uuid} is already in refresh queue (immediate check).`);
            return;
        }

        this.refreshingUuids.add(uuid);

        // 初始化提供商队列
        if (!this.refreshQueues[providerType]) {
            this.refreshQueues[providerType] = {
                activeCount: 0,
                waitingTasks: []
            };
        }

        const queue = this.refreshQueues[providerType];

        const runTask = async () => {
            try {
                await this._refreshNodeToken(providerType, providerStatus, force);
            } catch (err) {
                this._log('error', `Failed to process refresh for node ${uuid}: ${err.message}`);
            } finally {
                this.refreshingUuids.delete(uuid);
                
                // 再次获取当前队列引用
                const currentQueue = this.refreshQueues[providerType];
                if (!currentQueue) return;

                currentQueue.activeCount--;
                
                // 1. 尝试从当前提供商队列中取下一个任务
                if (currentQueue.waitingTasks.length > 0) {
                    const nextTask = currentQueue.waitingTasks.shift();
                    currentQueue.activeCount++;
                    // 使用 Promise.resolve().then 避免过深的递归
                    Promise.resolve().then(nextTask);
                } else if (currentQueue.activeCount === 0) {
                    // 2. 如果当前提供商的所有任务都完成了，释放全局槽位
                    // 只有在确定队列为空且没有新任务时才清理
                    if (currentQueue.waitingTasks.length === 0 &&
                        this.refreshQueues[providerType] === currentQueue) {
                        this.activeProviderRefreshes--;
                        delete this.refreshQueues[providerType]; // 清理空队列
                    }
                    
                    // 3. 尝试启动下一个等待中的提供商队列
                    if (this.globalRefreshWaiters.length > 0) {
                        const nextProviderStart = this.globalRefreshWaiters.shift();
                        Promise.resolve().then(nextProviderStart);
                    }
                }
            }
        };

        const tryStartProviderQueue = () => {
            if (queue.activeCount < this.refreshConcurrency.perProvider) {
                queue.activeCount++;
                runTask();
            } else {
                queue.waitingTasks.push(runTask);
            }
        };

        // 检查全局并发限制（按提供商分组）
        // 情况1: 该提供商已经在运行，直接加入其队列（不占用新的全局槽位）
        if (this.refreshQueues[providerType].activeCount > 0) {
            tryStartProviderQueue();
        }
        // 情况2: 该提供商未运行，需要检查全局槽位
        else if (this.activeProviderRefreshes < this.refreshConcurrency.global) {
            this.activeProviderRefreshes++;
            tryStartProviderQueue();
        }
        // 情况3: 全局槽位已满，进入等待队列
        else {
            this.globalRefreshWaiters.push(() => {
                // 重新获取最新的队列引用
                if (!this.refreshQueues[providerType]) {
                    this.refreshQueues[providerType] = {
                        activeCount: 0,
                        waitingTasks: []
                    };
                }
                // 重要：从等待队列启动时需要增加全局计数
                this.activeProviderRefreshes++;
                tryStartProviderQueue();
            });
        }
    }

    /**
     * 实际执行节点刷新逻辑
     * @private
     */
    async _refreshNodeToken(providerType, providerStatus, force = false) {
        const config = providerStatus.config;
        
        // 检查刷新次数是否已达上限（最大5次）
        const currentRefreshCount = config.refreshCount || 0;
        if (currentRefreshCount >= 5 && !force) {
            this._log('warn', `Node ${providerStatus.uuid} has reached maximum refresh count (3), marking as unhealthy`);
            // 标记为不健康
            this.markProviderUnhealthyImmediately(providerType, config, 'Maximum refresh count (3) reached');
            return;
        }
        
        // 添加5秒内的随机等待时间，避免并发刷新时的冲突
        // const randomDelay = Math.floor(Math.random() * 5000);
        // this._log('info', `Starting token refresh for node ${providerStatus.uuid} (${providerType}) with ${randomDelay}ms delay`);
        // await new Promise(resolve => setTimeout(resolve, randomDelay));

        try {
            // 增加刷新计数
            config.refreshCount = currentRefreshCount + 1;

            // 使用适配器进行刷新
            const tempConfig = {
                ...this.globalConfig,
                ...config,
                MODEL_PROVIDER: providerType
            };
            const serviceAdapter = getServiceAdapter(tempConfig);
            
            // 调用适配器的 refreshToken 方法（内部封装了具体的刷新逻辑）
            if (typeof serviceAdapter.refreshToken === 'function') {
                const startTime = Date.now();
                force ? await serviceAdapter.forceRefreshToken() : await serviceAdapter.refreshToken() 
                const duration = Date.now() - startTime;
                this._log('info', `Token refresh successful for node ${providerStatus.uuid} (Duration: ${duration}ms)`);
            } else {
                throw new Error(`refreshToken method not implemented for ${providerType}`);
            }

        } catch (error) {
            this._log('error', `Token refresh failed for node ${providerStatus.uuid}: ${error.message}`);
            this.markProviderUnhealthyImmediately(providerType, config, `Refresh failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * 计算节点的权重/评分，用于排序
     * 分数越低，优先级越高
     * @private
     */
    _calculateNodeScore(providerStatus, now = Date.now()) {
        const config = providerStatus.config;
        
        // 1. 基础健康分：不健康的排最后
        if (!config.isHealthy || config.isDisabled) return 1e18;
        
        // 2. 预热/刷新分：60秒内刷新过且使用次数极少的节点视为“新鲜”，分数极低（最高优）
        const lastHealthCheckTime = config.lastHealthCheckTime ? new Date(config.lastHealthCheckTime).getTime() : 0;
        const isFresh = lastHealthCheckTime && (now - lastHealthCheckTime < 60000); 
        if (isFresh) return -2e18 + (config.usageCount || 0) * 10000 + (now - lastHealthCheckTime); // 极其优先
 
        // 3. 权重计算逻辑：
        // 改进点：使用 lastUsedTime + usageCount 惩罚 + selectionSequence 惩罚
        // selectionSequence 用于在同一毫秒内彻底打破平局
        
        const lastUsedTime = config.lastUsed ? new Date(config.lastUsed).getTime() : (now - 86400000); // 没用过的视为 24 小时前用过（更旧）
        const usageCount = config.usageCount || 0;
        const lastSelectionSeq = config._lastSelectionSeq || 0;
        
        // 核心目标：选分最小的。
        // - lastUsedTime 越久，分越小。
        // - usageCount 越多，分越大。
        // - lastSelectionSeq 越大（最近选过），分越大。
        
        // usageCount * 10000: 每多用一次，权重增加 10 秒
        // lastSelectionSeq * 1000: 即使毫秒时间相同，序列号也会让分数产生差异（增加 1 秒权重）
        // 这样可以确保在毫秒级并发下，刚被选中的节点会立刻排到队列末尾
        const baseScore = lastUsedTime + (usageCount * 10000);
        const sequenceScore = lastSelectionSeq * 1000;
        
        return baseScore + sequenceScore;
    }

    /**
     * 获取指定类型的健康节点数量
     */
    getHealthyCount(providerType) {
        return (this.providerStatus[providerType] || []).filter(p => p.config.isHealthy && !p.config.isDisabled).length;
    }

    /**
     * 日志输出方法，支持日志级别控制
     * @private
     */
    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            logger[level](`[ProviderPoolManager] ${message}`);
        }
    }

    /**
     * 查找指定的 provider
     * @private
     */
    _findProvider(providerType, uuid) {
        if (!providerType || !uuid) {
            this._log('error', `Invalid parameters: providerType=${providerType}, uuid=${uuid}`);
            return null;
        }
        const pool = this.providerStatus[providerType];
        return pool?.find(p => p.uuid === uuid) || null;
    }

    /**
     * Initializes the status for each provider in the pools.
     * Initially, all providers are considered healthy and have zero usage.
     */
    initializeProviderStatus() {
        for (const providerType in this.providerPools) {
            this.providerStatus[providerType] = [];
            this.roundRobinIndex[providerType] = 0; // Initialize round-robin index for each type
            // 只有在锁不存在时才初始化，避免在运行中被重置导致并发问题
            if (!this._selectionLocks[providerType]) {
                this._selectionLocks[providerType] = Promise.resolve();
            }
            this.providerPools[providerType].forEach((providerConfig) => {
                // Ensure initial health and usage stats are present in the config
                providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
                providerConfig.isDisabled = providerConfig.isDisabled !== undefined ? providerConfig.isDisabled : false;
                providerConfig.lastUsed = providerConfig.lastUsed !== undefined ? providerConfig.lastUsed : null;
                providerConfig.usageCount = providerConfig.usageCount !== undefined ? providerConfig.usageCount : 0;
                providerConfig.errorCount = providerConfig.errorCount !== undefined ? providerConfig.errorCount : 0;
                
                // --- V2: 刷新监控字段 ---
                providerConfig.needsRefresh = providerConfig.needsRefresh !== undefined ? providerConfig.needsRefresh : false;
                providerConfig.refreshCount = providerConfig.refreshCount !== undefined ? providerConfig.refreshCount : 0;
                
                // 优化2: 简化 lastErrorTime 处理逻辑
                providerConfig.lastErrorTime = providerConfig.lastErrorTime instanceof Date
                    ? providerConfig.lastErrorTime.toISOString()
                    : (providerConfig.lastErrorTime || null);
                
                // 健康检测相关字段
                providerConfig.lastHealthCheckTime = providerConfig.lastHealthCheckTime || null;
                providerConfig.lastHealthCheckModel = providerConfig.lastHealthCheckModel || null;
                providerConfig.lastErrorMessage = providerConfig.lastErrorMessage || null;
                providerConfig.customName = providerConfig.customName || null;

                this.providerStatus[providerType].push({
                    config: providerConfig,
                    uuid: providerConfig.uuid, // Still keep uuid at the top level for easy access
                });
            });
        }
        this._log('info', `Initialized provider statuses: ok (maxErrorCount: ${this.maxErrorCount})`);
    }

    /**
     * Selects a provider from the pool for a given provider type.
     * Currently uses a simple round-robin for healthy providers.
     * If requestedModel is provided, providers that don't support the model will be excluded.
     *
     * 注意：此方法现在返回 Promise，使用互斥锁确保并发安全。
     *
     * @param {string} providerType - The type of provider to select (e.g., 'gemini-cli', 'openai-custom').
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @returns {Promise<object|null>} The selected provider's configuration, or null if no healthy provider is found.
     */
    async selectProvider(providerType, requestedModel = null, options = {}) {
        // 参数校验
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return null;
        }
 
        // 使用标志位 + 异步等待实现更强力的互斥锁
        // 这种方式能更好地处理同一微任务循环内的并发
        while (this._isSelecting[providerType]) {
            await new Promise(resolve => setImmediate(resolve));
        }
        
        this._isSelecting[providerType] = true;
        
        try {
            // 在锁内部执行同步选择
            return this._doSelectProvider(providerType, requestedModel, options);
        } finally {
            this._isSelecting[providerType] = false;
        }
    }

    /**
     * 实际执行 provider 选择的内部方法（同步执行，由锁保护）
     * @private
     */
    _doSelectProvider(providerType, requestedModel, options) {
        const availableProviders = this.providerStatus[providerType] || [];
        
        // 检查并恢复已到恢复时间的提供商
        this._checkAndRecoverScheduledProviders(providerType);
        
        // 获取固定时间戳，确保排序过程中一致
        const now = Date.now();
        
        let availableAndHealthyProviders = availableProviders.filter(p =>
            p.config.isHealthy && !p.config.isDisabled && !p.config.needsRefresh
        );

        // 如果指定了模型，则排除不支持该模型的提供商
        if (requestedModel) {
            const modelFilteredProviders = availableAndHealthyProviders.filter(p => {
                // 如果提供商没有配置 notSupportedModels，则认为它支持所有模型
                if (!p.config.notSupportedModels || !Array.isArray(p.config.notSupportedModels)) {
                    return true;
                }
                // 检查 notSupportedModels 数组中是否包含请求的模型，如果包含则排除
                return !p.config.notSupportedModels.includes(requestedModel);
            });

            if (modelFilteredProviders.length === 0) {
                this._log('warn', `No available providers for type: ${providerType} that support model: ${requestedModel}`);
                return null;
            }

            availableAndHealthyProviders = modelFilteredProviders;
            this._log('debug', `Filtered ${modelFilteredProviders.length} providers supporting model: ${requestedModel}`);
        }

        if (availableAndHealthyProviders.length === 0) {
            this._log('warn', `No available and healthy providers for type: ${providerType}`);
            return null;
        }

        // 改进：使用统一的评分策略进行选择
        // 传入当前时间戳 now 确保一致性
        const selected = availableAndHealthyProviders.sort((a, b) => {
            const scoreA = this._calculateNodeScore(a, now);
            const scoreB = this._calculateNodeScore(b, now);
            if (scoreA !== scoreB) return scoreA - scoreB;
            // 如果分值相同，使用 UUID 排序确保确定性
            return a.uuid < b.uuid ? -1 : 1;
        })[0];

        // 始终更新 lastUsed（确保 LRU 策略生效，避免并发请求选到同一个 provider）
        // usageCount 只在请求成功后才增加（由 skipUsageCount 控制）
        selected.config.lastUsed = new Date().toISOString();
        
        // 更新自增序列号，确保即使毫秒级并发，也能在下一轮排序中被区分开
        this._selectionSequence++;
        selected.config._lastSelectionSeq = this._selectionSequence;
        
        // 强制打印选中日志，方便排查并发问题
        this._log('info', `[Concurrency Control] Atomic selection: ${selected.config.uuid} (Seq: ${this._selectionSequence})`);

        if (!options.skipUsageCount) {
            selected.config.usageCount++;
        }
        // 使用防抖保存（文件 I/O 是异步的，但内存已经更新）
        this._debouncedSave(providerType);

        this._log('debug', `Selected provider for ${providerType} (LRU): ${selected.config.uuid}${requestedModel ? ` for model: ${requestedModel}` : ''}${options.skipUsageCount ? ' (skip usage count)' : ''}`);
        
        return selected.config;
    }

    /**
     * Selects a provider from the pool with fallback support.
     * When the primary provider type has no healthy providers, it will try fallback types.
     * @param {string} providerType - The primary type of provider to select.
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @param {Object} [options] - Optional. Additional options.
     * @param {boolean} [options.skipUsageCount] - Optional. If true, skip incrementing usage count.
     * @returns {object|null} An object containing the selected provider's configuration and the actual provider type used, or null if no healthy provider is found.
     */
    /**
     * Selects a provider from the pool with fallback support.
     * When the primary provider type has no healthy providers, it will try fallback types.
     *
     * 注意：此方法现在返回 Promise，因为内部调用的 selectProvider 是异步的。
     *
     * @param {string} providerType - The primary type of provider to select.
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @param {Object} [options] - Optional. Additional options.
     * @param {boolean} [options.skipUsageCount] - Optional. If true, skip incrementing usage count.
     * @returns {Promise<object|null>} An object containing the selected provider's configuration and the actual provider type used, or null if no healthy provider is found.
     */
    async selectProviderWithFallback(providerType, requestedModel = null, options = {}) {
        // 参数校验
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return null;
        }

        // ==========================
        // 优先级 1: Provider Fallback Chain (同协议/兼容协议的回退)
        // ==========================
        
        // 记录尝试过的类型，避免循环
        const triedTypes = new Set();
        const typesToTry = [providerType];
        
        const fallbackTypes = this.fallbackChain[providerType] || [];
        if (Array.isArray(fallbackTypes)) {
            typesToTry.push(...fallbackTypes);
        }

        for (const currentType of typesToTry) {
            // 避免重复尝试
            if (triedTypes.has(currentType)) {
                continue;
            }
            triedTypes.add(currentType);

            // 检查该类型是否有配置的池
            if (!this.providerStatus[currentType] || this.providerStatus[currentType].length === 0) {
                this._log('debug', `No provider pool configured for type: ${currentType}`);
                continue;
            }

            // 如果是 fallback 类型，需要检查模型兼容性
            if (currentType !== providerType && requestedModel) {
                // 检查协议前缀是否兼容
                const primaryProtocol = getProtocolPrefix(providerType);
                const fallbackProtocol = getProtocolPrefix(currentType);
                
                if (primaryProtocol !== fallbackProtocol) {
                    this._log('debug', `Skipping fallback type ${currentType}: protocol mismatch (${primaryProtocol} vs ${fallbackProtocol})`);
                    continue;
                }

                // 检查 fallback 类型是否支持请求的模型
                const supportedModels = getProviderModels(currentType);
                if (supportedModels.length > 0 && !supportedModels.includes(requestedModel)) {
                    this._log('debug', `Skipping fallback type ${currentType}: model ${requestedModel} not supported`);
                    continue;
                }
            }

            // 尝试从当前类型选择提供商（现在是异步的）
            const selectedConfig = await this.selectProvider(currentType, requestedModel, options);
            
            if (selectedConfig) {
                if (currentType !== providerType) {
                    this._log('info', `Fallback activated (Chain): ${providerType} -> ${currentType} (uuid: ${selectedConfig.uuid})`);
                }
                return {
                    config: selectedConfig,
                    actualProviderType: currentType,
                    isFallback: currentType !== providerType
                };
            }
        }

        // ==========================
        // 优先级 2: Model Fallback Mapping (跨协议/特定模型的回退)
        // ==========================

        if (requestedModel && this.modelFallbackMapping && this.modelFallbackMapping[requestedModel]) {
            const mapping = this.modelFallbackMapping[requestedModel];
            const targetProviderType = mapping.targetProviderType;
            const targetModel = mapping.targetModel;

            if (targetProviderType && targetModel) {
                this._log('info', `Trying Model Fallback Mapping for ${requestedModel}: -> ${targetProviderType} (${targetModel})`);
                
                // 递归调用 selectProviderWithFallback，但这次针对目标提供商类型
                // 注意：这里我们直接尝试从目标提供商池中选择，因为如果再次递归可能会导致死循环或逻辑复杂化
                // 简单起见，我们直接尝试选择目标提供商
                
                // 检查目标类型是否有配置的池
                if (this.providerStatus[targetProviderType] && this.providerStatus[targetProviderType].length > 0) {
                    // 尝试从目标类型选择提供商（使用转换后的模型名，现在是异步的）
                    const selectedConfig = await this.selectProvider(targetProviderType, targetModel, options);
                    
                    if (selectedConfig) {
                        this._log('info', `Fallback activated (Model Mapping): ${providerType} (${requestedModel}) -> ${targetProviderType} (${targetModel}) (uuid: ${selectedConfig.uuid})`);
                        return {
                            config: selectedConfig,
                            actualProviderType: targetProviderType,
                            isFallback: true,
                            actualModel: targetModel // 返回实际使用的模型名，供上层进行请求转换
                        };
                    } else {
                        // 如果目标类型的主池也不可用，尝试目标类型的 fallback chain
                        // 例如 claude-kiro-oauth (mapped) -> claude-custom (chain)
                        // 这需要我们小心处理，避免无限递归。
                        // 我们可以手动检查目标类型的 fallback chain
                        
                        const targetFallbackTypes = this.fallbackChain[targetProviderType] || [];
                        for (const fallbackType of targetFallbackTypes) {
                             // 检查协议兼容性 (目标类型 vs 它的 fallback)
                             const targetProtocol = getProtocolPrefix(targetProviderType);
                             const fallbackProtocol = getProtocolPrefix(fallbackType);
                             
                             if (targetProtocol !== fallbackProtocol) continue;
                             
                             // 检查模型支持
                             const supportedModels = getProviderModels(fallbackType);
                             if (supportedModels.length > 0 && !supportedModels.includes(targetModel)) continue;
                             
                             const fallbackSelectedConfig = await this.selectProvider(fallbackType, targetModel, options);
                             if (fallbackSelectedConfig) {
                                 this._log('info', `Fallback activated (Model Mapping -> Chain): ${providerType} (${requestedModel}) -> ${targetProviderType} -> ${fallbackType} (${targetModel}) (uuid: ${fallbackSelectedConfig.uuid})`);
                                 return {
                                     config: fallbackSelectedConfig,
                                     actualProviderType: fallbackType,
                                     isFallback: true,
                                     actualModel: targetModel
                                 };
                             }
                        }
                    }
                } else {
                    this._log('warn', `Model Fallback target provider ${targetProviderType} not configured or empty.`);
                }
            }
        }

        this._log('warn', `None available provider found for ${providerType} (Model: ${requestedModel}) after checking fallback chain and model mapping.`);
        return null;
    }

    /**
     * Gets the fallback chain for a given provider type.
     * @param {string} providerType - The provider type to get fallback chain for.
     * @returns {Array<string>} The fallback chain array, or empty array if not configured.
     */
    getFallbackChain(providerType) {
        return this.fallbackChain[providerType] || [];
    }

    /**
     * Sets or updates the fallback chain for a provider type.
     * @param {string} providerType - The provider type to set fallback chain for.
     * @param {Array<string>} fallbackTypes - Array of fallback provider types.
     */
    setFallbackChain(providerType, fallbackTypes) {
        if (!Array.isArray(fallbackTypes)) {
            this._log('error', `Invalid fallbackTypes: must be an array`);
            return;
        }
        this.fallbackChain[providerType] = fallbackTypes;
        this._log('info', `Updated fallback chain for ${providerType}: ${fallbackTypes.join(' -> ')}`);
    }

    /**
     * Checks if all providers of a given type are unhealthy.
     * @param {string} providerType - The provider type to check.
     * @returns {boolean} True if all providers are unhealthy or disabled.
     */
    isAllProvidersUnhealthy(providerType) {
        const providers = this.providerStatus[providerType] || [];
        if (providers.length === 0) {
            return true;
        }
        return providers.every(p => !p.config.isHealthy || p.config.isDisabled);
    }

    /**
     * Gets statistics about provider health for a given type.
     * @param {string} providerType - The provider type to get stats for.
     * @returns {Object} Statistics object with total, healthy, unhealthy, and disabled counts.
     */
    getProviderStats(providerType) {
        const providers = this.providerStatus[providerType] || [];
        const stats = {
            total: providers.length,
            healthy: 0,
            unhealthy: 0,
            disabled: 0
        };
        
        for (const p of providers) {
            if (p.config.isDisabled) {
                stats.disabled++;
            } else if (p.config.isHealthy) {
                stats.healthy++;
            } else {
                stats.unhealthy++;
            }
        }
        
        return stats;
    }

    /**
     * 标记提供商需要刷新并推入刷新队列
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置（包含 uuid）
     */
    markProviderNeedRefresh(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderNeedRefresh');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.needsRefresh = true;
            this._log('info', `Marked provider ${providerConfig.uuid} as needsRefresh. Enqueuing...`);
            
            // 推入异步刷新队列
            this._enqueueRefresh(providerType, provider, true);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as unhealthy (e.g., after an API error).
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     */
    markProviderUnhealthy(providerType, providerConfig, errorMessage = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            const now = Date.now();
            const lastErrorTime = provider.config.lastErrorTime ? new Date(provider.config.lastErrorTime).getTime() : 0;
            const errorWindowMs = 10000; // 10 秒窗口期

            // 如果距离上次错误超过窗口期，重置错误计数
            if (now - lastErrorTime > errorWindowMs) {
                provider.config.errorCount = 1;
            } else {
                provider.config.errorCount++;
            }

            provider.config.lastErrorTime = new Date().toISOString();
            // 更新 lastUsed 时间，避免因 LRU 策略导致失败节点被重复选中
            provider.config.lastUsed = new Date().toISOString();

            // 保存错误信息
            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            if (this.maxErrorCount > 0 && provider.config.errorCount >= this.maxErrorCount) {
                provider.config.isHealthy = false;
                this._log('warn', `Marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Total errors: ${provider.config.errorCount}`);
            } 

            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as unhealthy immediately (without accumulating error count).
     * Used for definitive authentication errors like 401/403.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     */
    markProviderUnhealthyImmediately(providerType, providerConfig, errorMessage = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthyImmediately');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = false;
            provider.config.errorCount = this.maxErrorCount; // Set to max to indicate definitive failure
            provider.config.lastErrorTime = new Date().toISOString();
            provider.config.lastUsed = new Date().toISOString();

            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            this._log('warn', `Immediately marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Reason: ${errorMessage || 'Authentication error'}`);
           
            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as unhealthy with a scheduled recovery time.
     * Used for quota exhaustion errors (402) where the quota will reset at a specific time.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     * @param {Date|string} [recoveryTime] - Optional recovery time when the provider should be marked healthy again.
     */
    markProviderUnhealthyWithRecoveryTime(providerType, providerConfig, errorMessage = null, recoveryTime = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthyWithRecoveryTime');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = false;
            provider.config.errorCount = this.maxErrorCount; // Set to max to indicate definitive failure
            provider.config.lastErrorTime = new Date().toISOString();
            provider.config.lastUsed = new Date().toISOString();

            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            // Set recovery time if provided
            if (recoveryTime) {
                const recoveryDate = recoveryTime instanceof Date ? recoveryTime : new Date(recoveryTime);
                provider.config.scheduledRecoveryTime = recoveryDate.toISOString();
                this._log('warn', `Marked provider as unhealthy with recovery time: ${providerConfig.uuid} for type ${providerType}. Recovery at: ${recoveryDate.toISOString()}. Reason: ${errorMessage || 'Quota exhausted'}`);
            } else {
                this._log('warn', `Marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Reason: ${errorMessage || 'Quota exhausted'}`);
            }

            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as healthy.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {boolean} resetUsageCount - Whether to reset usage count (optional, default: false).
     * @param {string} [healthCheckModel] - Optional model name used for health check.
     */
    markProviderHealthy(providerType, providerConfig, resetUsageCount = false, healthCheckModel = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderHealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = true;
            provider.config.errorCount = 0;
            provider.config.refreshCount = 0;
            provider.config.needsRefresh = false;
            provider.config.lastErrorTime = null;
            provider.config.lastErrorMessage = null;
            
            // 更新健康检测信息
            if (healthCheckModel) {
                provider.config.lastHealthCheckTime = new Date().toISOString();
                provider.config.lastHealthCheckModel = healthCheckModel;
            }
            
            // 只有在明确要求重置使用计数时才重置
            if (resetUsageCount) {
                provider.config.usageCount = 0;
            }else{
                provider.config.usageCount++;
                provider.config.lastUsed = new Date().toISOString();
            }
            this._log('info', `Marked provider as healthy: ${provider.config.uuid} for type ${providerType}${resetUsageCount ? ' (usage count reset)' : ''}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * 重置提供商的刷新状态（needsRefresh 和 refreshCount）
     * 并将其标记为健康，以便立即投入使用
     * @param {string} providerType - 提供商类型
     * @param {string} uuid - 提供商 UUID
     */
    resetProviderRefreshStatus(providerType, uuid) {
        if (!providerType || !uuid) {
            this._log('error', 'Invalid parameters in resetProviderRefreshStatus');
            return;
        }

        const provider = this._findProvider(providerType, uuid);
        if (provider) {
            provider.config.needsRefresh = false;
            provider.config.refreshCount = 0;
            // 更新为可用
            provider.config.lastHealthCheckTime = new Date().toISOString();
            // 标记为健康，以便立即投入使用
            this._log('info', `Reset refresh status and marked healthy for provider ${uuid} (${providerType})`);

            this._debouncedSave(providerType);
        }
    }

    /**
     * 重置提供商的计数器（错误计数和使用计数）
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     */
    resetProviderCounters(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in resetProviderCounters');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.errorCount = 0;
            provider.config.usageCount = 0;
            this._log('info', `Reset provider counters: ${provider.config.uuid} for type ${providerType}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * 禁用指定提供商
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置
     */
    disableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in disableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = true;
            this._log('info', `Disabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * 启用指定提供商
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置
     */
    enableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in enableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = false;
            this._log('info', `Enabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * 刷新指定提供商的 UUID
     * 用于在认证错误（如 401）时更换 UUID，以便重新尝试
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置（包含当前 uuid）
     * @returns {string|null} 新的 UUID，如果失败则返回 null
     */
    refreshProviderUuid(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in refreshProviderUuid');
            return null;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            const oldUuid = provider.config.uuid;
            // 生成新的 UUID
            const newUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            
            // 更新 provider 的 UUID
            provider.uuid = newUuid;
            provider.config.uuid = newUuid;
            
            // 同时更新 providerPools 中的原始数据
            const poolArray = this.providerPools[providerType];
            if (poolArray) {
                const originalProvider = poolArray.find(p => p.uuid === oldUuid);
                if (originalProvider) {
                    originalProvider.uuid = newUuid;
                }
            }
            
            this._log('info', `Refreshed provider UUID: ${oldUuid} -> ${newUuid} for type ${providerType}`);
            this._debouncedSave(providerType);
            
            return newUuid;
        }
        
        this._log('warn', `Provider not found for UUID refresh: ${providerConfig.uuid} in ${providerType}`);
        return null;
    }

    /**
     * 检查并恢复已到恢复时间的提供商
     * @param {string} [providerType] - 可选，指定要检查的提供商类型。如果不提供，检查所有类型
     * @private
     */
    _checkAndRecoverScheduledProviders(providerType = null) {
        const now = new Date();
        const typesToCheck = providerType ? [providerType] : Object.keys(this.providerStatus);
        
        for (const type of typesToCheck) {
            const providers = this.providerStatus[type] || [];
            for (const providerStatus of providers) {
                const config = providerStatus.config;
                
                // 检查是否有 scheduledRecoveryTime 且已到恢复时间
                if (config.scheduledRecoveryTime && !config.isHealthy) {
                    const recoveryTime = new Date(config.scheduledRecoveryTime);
                    if (now >= recoveryTime) {
                        this._log('info', `Auto-recovering provider ${config.uuid} (${type}). Scheduled recovery time reached: ${recoveryTime.toISOString()}`);
                        
                        // 恢复健康状态
                        config.isHealthy = true;
                        config.errorCount = 0;
                        config.lastErrorTime = null;
                        config.lastErrorMessage = null;
                        config.scheduledRecoveryTime = null; // 清除恢复时间
                        
                        // 保存更改
                        this._debouncedSave(type);
                    }
                }
            }
        }
    }

    /**
     * Performs health checks on all providers in the pool.
     * This method would typically be called periodically (e.g., via cron job).
     */
    async performHealthChecks(isInit = false) {
        this._log('info', 'Performing health checks on all providers...');
        const now = new Date();
        
        // 首先检查并恢复已到恢复时间的提供商
        this._checkAndRecoverScheduledProviders();
        
        for (const providerType in this.providerStatus) {
            for (const providerStatus of this.providerStatus[providerType]) {
                const providerConfig = providerStatus.config;

                // 如果提供商有 scheduledRecoveryTime 且未到恢复时间，跳过健康检查
                if (providerConfig.scheduledRecoveryTime && !providerConfig.isHealthy) {
                    const recoveryTime = new Date(providerConfig.scheduledRecoveryTime);
                    if (now < recoveryTime) {
                        this._log('debug', `Skipping health check for ${providerConfig.uuid} (${providerType}). Waiting for scheduled recovery at ${recoveryTime.toISOString()}`);
                        continue;
                    }
                }

                // Only attempt to health check unhealthy providers after a certain interval
                if (!providerStatus.config.isHealthy && providerStatus.config.lastErrorTime &&
                    (now.getTime() - new Date(providerStatus.config.lastErrorTime).getTime() < this.healthCheckInterval)) {
                    this._log('debug', `Skipping health check for ${providerConfig.uuid} (${providerType}). Last error too recent.`);
                    continue;
                }

                try {
                    // Perform actual health check based on provider type
                    const healthResult = await this._checkProviderHealth(providerType, providerConfig);
                    
                    if (healthResult === null) {
                        this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}) skipped: Check not implemented.`);
                        this.resetProviderCounters(providerType, providerConfig);
                        continue;
                    }
                    
                    if (healthResult.success) {
                        if (!providerStatus.config.isHealthy) {
                            // Provider was unhealthy but is now healthy
                            // 恢复健康时不重置使用计数，保持原有值
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('info', `Health check for ${providerConfig.uuid} (${providerType}): Marked Healthy (actual check)`);
                        } else {
                            // Provider was already healthy and still is
                            // 只在初始化时重置使用计数
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}): Still Healthy`);
                        }
                    } else {
                        // Provider is not healthy
                        this._log('warn', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${healthResult.errorMessage || 'Provider is not responding correctly.'}`);
                        this.markProviderUnhealthy(providerType, providerConfig, healthResult.errorMessage);
                        
                        // 更新健康检测时间和模型（即使失败也记录）
                        providerStatus.config.lastHealthCheckTime = new Date().toISOString();
                        if (healthResult.modelName) {
                            providerStatus.config.lastHealthCheckModel = healthResult.modelName;
                        }
                    }

                } catch (error) {
                    this._log('error', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${error.message}`);
                    // If a health check fails, mark it unhealthy, which will update error count and lastErrorTime
                    this.markProviderUnhealthy(providerType, providerConfig, error.message);
                }
            }
        }
    }

    /**
     * 构建健康检查请求（返回多种格式用于重试）
     * @private
     * @returns {Array} 请求格式数组，按优先级排序
     */
    _buildHealthCheckRequests(providerType, modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        const requests = [];
        
        // Gemini 使用 contents 格式
        if (providerType.startsWith('gemini')) {
            requests.push({
                contents: [{
                    role: 'user',
                    parts: [{ text: baseMessage.content }]
                }]
            });
            return requests;
        }
        
        // Kiro OAuth 只支持 messages 格式
        if (providerType.startsWith('claude-kiro')) {
            requests.push({
                messages: [baseMessage],
                model: modelName,
                max_tokens: 1
            });
            return requests;
        }
        
        // OpenAI Custom Responses 使用特殊格式
        if (providerType === MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES) {
            requests.push({
                input: [baseMessage],
                model: modelName
            });
            return requests;
        }
        
        // 其他提供商（OpenAI、Claude、Qwen）使用标准 messages 格式
        requests.push({
            messages: [baseMessage],
            model: modelName
        });
        
        return requests;
    }

    /**
     * Performs an actual health check for a specific provider.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to check.
     * @param {boolean} forceCheck - If true, ignore checkHealth config and force the check.
     * @returns {Promise<{success: boolean, modelName: string, errorMessage: string}|null>} - Health check result object or null if check not implemented.
     */
    async _checkProviderHealth(providerType, providerConfig, forceCheck = false) {
        // 如果未启用健康检查且不是强制检查，返回 null（提前返回，避免不必要的计算）
        if (!providerConfig.checkHealth && !forceCheck) {
            return null;
        }

        // 确定健康检查使用的模型名称
        const modelName = providerConfig.checkModelName ||
                        ProviderPoolManager.DEFAULT_HEALTH_CHECK_MODELS[providerType];

        if (!modelName) {
            this._log('warn', `Unknown provider type for health check: ${providerType}. Please check DEFAULT_HEALTH_CHECK_MODELS.`);
            return { 
                success: false, 
                modelName: null, 
                errorMessage: `Unknown provider type '${providerType}'. No default health check model configured.` 
            };
        }

        // ========== 实际 API 健康检查（带超时保护）==========
        const tempConfig = {
            ...providerConfig,
            MODEL_PROVIDER: providerType
        };
        const serviceAdapter = getServiceAdapter(tempConfig);

        // 获取所有可能的请求格式
        const healthCheckRequests = this._buildHealthCheckRequests(providerType, modelName);

        // 健康检查超时时间（15秒，避免长时间阻塞）
        const healthCheckTimeout = 15000;
        let lastError = null;

        // 重试机制：尝试不同的请求格式
        for (let i = 0; i < healthCheckRequests.length; i++) {
            const healthCheckRequest = healthCheckRequests[i];
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), healthCheckTimeout);

            try {
                this._log('debug', `Health check attempt ${i + 1}/${healthCheckRequests.length} for ${modelName}: ${JSON.stringify(healthCheckRequest)}`);

                // 尝试将 signal 注入请求体，供支持的适配器使用
                const requestWithSignal = {
                    ...healthCheckRequest,
                    // signal: abortController.signal
                };

                await serviceAdapter.generateContent(modelName, requestWithSignal);
                
                clearTimeout(timeoutId);
                return { success: true, modelName, errorMessage: null };
            } catch (error) {
                clearTimeout(timeoutId);
                lastError = error;
                this._log('debug', `Health check attempt ${i + 1} failed for ${providerType}: ${error.message}`);
            }
        }

        // 所有尝试都失败
        this._log('error', `Health check failed for ${providerType} after ${healthCheckRequests.length} attempts: ${lastError?.message}`);
        return { success: false, modelName, errorMessage: lastError?.message || 'All health check attempts failed' };
    }

    /**
     * 优化1: 添加防抖保存方法
     * 延迟保存操作，避免频繁的文件 I/O
     * @private
     */
    _debouncedSave(providerType) {
        // 将待保存的 providerType 添加到集合中
        this.pendingSaves.add(providerType);
        
        // 清除之前的定时器
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // 设置新的定时器
        this.saveTimer = setTimeout(() => {
            this._flushPendingSaves();
        }, this.saveDebounceTime);
    }
    
    /**
     * 批量保存所有待保存的 providerType（优化为单次文件写入）
     * @private
     */
    async _flushPendingSaves() {
        const typesToSave = Array.from(this.pendingSaves);
        if (typesToSave.length === 0) return;
        
        this.pendingSaves.clear();
        this.saveTimer = null;
        
        try {
            const filePath = this.globalConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
            let currentPools = {};
            
            // 一次性读取文件
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                currentPools = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    this._log('info', 'configs/provider_pools.json does not exist, creating new file.');
                } else {
                    throw readError;
                }
            }

            // 更新所有待保存的 providerType
            for (const providerType of typesToSave) {
                if (this.providerStatus[providerType]) {
                    currentPools[providerType] = this.providerStatus[providerType].map(p => {
                        // Convert Date objects to ISOString if they exist
                        const config = { ...p.config };
                        if (config.lastUsed instanceof Date) {
                            config.lastUsed = config.lastUsed.toISOString();
                        }
                        if (config.lastErrorTime instanceof Date) {
                            config.lastErrorTime = config.lastErrorTime.toISOString();
                        }
                        if (config.lastHealthCheckTime instanceof Date) {
                            config.lastHealthCheckTime = config.lastHealthCheckTime.toISOString();
                        }
                        return config;
                    });
                } else {
                    this._log('warn', `Attempted to save unknown providerType: ${providerType}`);
                }
            }
            
            // 一次性写入文件
            await fs.promises.writeFile(filePath, JSON.stringify(currentPools, null, 2), 'utf8');
            this._log('info', `configs/provider_pools.json updated successfully for types: ${typesToSave.join(', ')}`);
        } catch (error) {
            this._log('error', `Failed to write provider_pools.json: ${error.message}`);
        }
    }

}

