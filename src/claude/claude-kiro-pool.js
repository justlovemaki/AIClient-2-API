import { KiroApiService } from './claude-kiro.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Kiro API Pool Service - 支持多账号负载均衡的Kiro API服务
 * 提供轮询、随机、最少使用等负载均衡策略
 */
export class KiroApiPoolService {
    constructor(config = {}) {
        this.config = config;
        this.accounts = [];
        this.currentIndex = 0;
        this.requestCounts = new Map(); // 记录每个账号的请求次数
        this.failureCounts = new Map(); // 记录每个账号的失败次数
        this.lastUsedTimes = new Map(); // 记录每个账号的最后使用时间
        this.isInitialized = false;

        // 负载均衡策略: 'round-robin', 'random', 'least-used', 'least-failures'
        this.loadBalanceStrategy = config.KIRO_POOL_STRATEGY || 'round-robin';

        // 故障转移配置
        this.maxFailures = config.KIRO_POOL_MAX_FAILURES || 3; // 最大失败次数
        this.failureResetTime = config.KIRO_POOL_FAILURE_RESET_TIME || 300000; // 5分钟后重置失败计数

        this.initializeAccounts();
    }

    /**
     * 初始化账号池
     */
    initializeAccounts() {
        const poolConfig = this.config.KIRO_POOL_CONFIG;
        if (!poolConfig || !Array.isArray(poolConfig)) {
            throw new Error('KIRO_POOL_CONFIG must be an array of account configurations');
        }

        this.accounts = poolConfig.map((accountConfig, index) => {
            const accountId = accountConfig.name || `kiro-account-${index}`;

            // 为每个账号创建独立的配置
            const individualConfig = {
                ...this.config,
                KIRO_OAUTH_CREDS_BASE64: accountConfig.base64Credential,
                KIRO_OAUTH_CREDS_FILE_PATH: accountConfig.credentialFilePath,
            };

            const service = new KiroApiService(individualConfig);

            // 初始化统计信息
            this.requestCounts.set(accountId, 0);
            this.failureCounts.set(accountId, 0);
            this.lastUsedTimes.set(accountId, 0);

            return {
                id: accountId,
                name: accountConfig.name,
                service: service,
                isHealthy: true,
                lastHealthCheck: Date.now()
            };
        });

        console.log(`[Kiro Pool] Initialized ${this.accounts.length} accounts with strategy: ${this.loadBalanceStrategy}`);
    }

    /**
     * 初始化所有账号
     */
    async initialize() {
        if (this.isInitialized) return;

        console.log('[Kiro Pool] Initializing all accounts...');
        const initPromises = this.accounts.map(async (account) => {
            try {
                // 检查服务是否已初始化，避免重复初始化
                if (!account.service.isInitialized) {
                    await account.service.initialize();
                }
                account.isHealthy = true;
                console.log(`[Kiro Pool] Account ${account.id} initialized successfully`);
            } catch (error) {
                console.error(`[Kiro Pool] Failed to initialize account ${account.id}:`, error.message);
                account.isHealthy = false;
                this.failureCounts.set(account.id, this.failureCounts.get(account.id) + 1);
            }
        });

        await Promise.allSettled(initPromises);
        this.isInitialized = true;

        const healthyCount = this.accounts.filter(acc => acc.isHealthy).length;
        console.log(`[Kiro Pool] Initialization complete. ${healthyCount}/${this.accounts.length} accounts healthy`);
    }

    /**
     * 获取第二天0点的时间戳
     */
    getNextDayTimestamp() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow.getTime();
    }

    /**
     * 执行流式操作的重试逻辑
     */
    async * executeStreamWithRetry(operation, context = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        let lastError;
        const triedAccounts = new Set();
        let hasYieldedContent = false;

        while (true) {
            const account = this.selectAccount(triedAccounts);
            
            if (!account) {
                lastError = new Error('No healthy Kiro accounts available');
                break;
            }
            
            try {
                triedAccounts.add(account.id);
                
                // 执行流式操作
                const stream = await operation(account, context);
                
                // 逐 chunk 消费，抛错就 catch
                for await (const chunk of stream) {
                    hasYieldedContent = true;
                    yield chunk;
                }

                this.recordResult(account.id, true);
                return; // 正常结束
            } catch (error) {
                lastError = error;

                // 如果已经输出了内容，就不能再故障转移了
                if (hasYieldedContent) {
                    console.error(`[Kiro Pool] Stream failed after yielding content, cannot failover:`, error.message);
                    this.recordResult(account.id, false);
                    return;
                }

                // 使用公共错误处理逻辑
                await this.handleAccountError(account, error, triedAccounts);
            }
        }

        console.error('[Kiro Pool] All Kiro pool attempts failed. Last error:', lastError);

        // 只有在没有输出任何内容的情况下才输出错误信息
        if (!hasYieldedContent) {
            const { KiroApiService } = await import('./claude-kiro.js');
            for (const chunkJson of KiroApiService.buildClaudeResponse(`Error: ${lastError?.message}`, true, 'assistant', context.model, null)) {
                yield chunkJson;
            }
        }
    }

    /**
     * 执行操作的通用重试逻辑
     */
    async executeWithRetry(operation, context = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        let lastError;
        const triedAccounts = new Set();

        while (true) {
            const account = this.selectAccount(triedAccounts);
            
            if (!account) {
                lastError = new Error('No healthy Kiro accounts available');
                break;
            }
            
            try {
                triedAccounts.add(account.id);
                
                const result = await operation(account, context);
                
                // 记录成功
                this.recordResult(account.id, true);
                return result;
            } catch (error) {
                lastError = error;
                // 使用公共错误处理逻辑
                await this.handleAccountError(account, error, triedAccounts);
            }
        }

        throw new Error(`All Kiro pool attempts failed. Last error: ${lastError?.message}`);
    }

    /**
     * 处理账号错误的公共逻辑
     */
    async handleAccountError(account, error, triedAccounts) {
        this.recordResult(account.id, false);
        console.warn(`[Kiro Pool] Account ${account.id} failed:`, error.message);

        // 处理特定错误类型
        if (error.response?.status === 403) {
            // 认证错误，尝试刷新token
            try {
                console.log(`[Kiro Pool] Attempting to refresh token for account ${account.id}`);
                await account.service.initializeAuth(true);
                account.isHealthy = true;
                // 刷新成功后，从已尝试列表中移除，允许重试
                triedAccounts.delete(account.id);
                return true; // 表示可以重试
            } catch (refreshError) {
                console.error(`[Kiro Pool] Token refresh failed for account ${account.id}:`, refreshError.message);
                account.isHealthy = false;
                return false;
            }
        } else if (error.response?.status === 429) {
            // 429错误，说明账号当天配额已用完，标记为不健康直到第二天
            console.warn(`[Kiro Pool] Account ${account.id} hit daily rate limit (429), marking as unhealthy until tomorrow`);
            account.isHealthy = false;
            
            // 记录429错误时间，用于第二天恢复
            account.rateLimitResetTime = this.getNextDayTimestamp();
            
            // 429不计入失败次数，因为这不是账号问题而是配额问题
            this.failureCounts.set(account.id, Math.max(0, (this.failureCounts.get(account.id) || 0) - 1));
            return false;
        } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.message?.includes('certificate')) {
            // 证书错误，标记为不健康但不增加失败计数
            console.warn(`[Kiro Pool] Account ${account.id} has certificate verification error, marking as unhealthy`);
            account.isHealthy = false;
            // 不记录为失败，因为这是环境问题
            this.failureCounts.set(account.id, Math.max(0, (this.failureCounts.get(account.id) || 0) - 1));
            return false;
        }
        
        return false; // 其他错误不重试
    }

    /**
     * 检查账号是否可用
     */
    isAccountAvailable(account) {
        // 检查429限流是否已经过期
        if (account.rateLimitResetTime && Date.now() >= account.rateLimitResetTime) {
            // 429限流已过期，恢复账号健康状态
            account.isHealthy = true;
            account.rateLimitResetTime = null;
            console.log(`[Kiro Pool] Account ${account.id} daily rate limit reset, marked as healthy`);
        }

        const failures = this.failureCounts.get(account.id) || 0;
        const lastFailureTime = this.lastUsedTimes.get(account.id) || 0;

        // 如果失败次数超过阈值，检查是否已过重置时间
        if (failures >= this.maxFailures) {
            if (Date.now() - lastFailureTime > this.failureResetTime) {
                // 重置失败计数
                this.failureCounts.set(account.id, 0);
                account.isHealthy = true;
                console.log(`[Kiro Pool] Reset failure count for account ${account.id}`);
                return true;
            }
            return false;
        }

        return account.isHealthy;
    }

    /**
     * 获取可用的账号列表
     */
    getAvailableAccounts() {
        return this.accounts.filter(account => this.isAccountAvailable(account));
    }

    /**
     * 根据负载均衡策略选择账号
     */
    selectAccount(excludeAccountIds = new Set()) {
        const availableAccounts = this.getAvailableAccounts().filter(acc => !excludeAccountIds.has(acc.id));

        if (availableAccounts.length === 0) {
            throw new Error('No healthy Kiro accounts available');
        }

        let selectedAccount;

        switch (this.loadBalanceStrategy) {
            case 'random':
                selectedAccount = availableAccounts[Math.floor(Math.random() * availableAccounts.length)];
                break;

            case 'least-used':
                selectedAccount = availableAccounts.reduce((least, current) => {
                    const leastCount = this.requestCounts.get(least.id) || 0;
                    const currentCount = this.requestCounts.get(current.id) || 0;
                    return currentCount < leastCount ? current : least;
                });
                break;

            case 'least-failures':
                selectedAccount = availableAccounts.reduce((least, current) => {
                    const leastFailures = this.failureCounts.get(least.id) || 0;
                    const currentFailures = this.failureCounts.get(current.id) || 0;
                    return currentFailures < leastFailures ? current : least;
                });
                break;

            case 'round-robin':
            default:
                // 真正的轮询策略：每次选择下一个可用账号
                let attempts = 0;
                while (attempts < this.accounts.length) {
                    this.currentIndex = (this.currentIndex + 1) % this.accounts.length;
                    const account = this.accounts[this.currentIndex];

                    if (this.isAccountAvailable(account) && !excludeAccountIds.has(account.id)) {
                        selectedAccount = account;
                        break;
                    }
                    attempts++;
                }

                if (!selectedAccount) {
                    selectedAccount = availableAccounts[0]; // 回退到第一个可用账号
                }
                break;
        }

        // 更新使用统计
        this.requestCounts.set(selectedAccount.id, (this.requestCounts.get(selectedAccount.id) || 0) + 1);
        this.lastUsedTimes.set(selectedAccount.id, Date.now());

        console.debug(`[Kiro Pool] Selected account ${selectedAccount.id} (strategy: ${this.loadBalanceStrategy})`);
        return selectedAccount;
    }

    /**
     * 记录账号操作结果
     */
    recordResult(accountId, success) {
        if (success) {
            // 成功时重置失败计数
            this.failureCounts.set(accountId, 0);
        } else {
            // 失败时增加失败计数
            const failures = (this.failureCounts.get(accountId) || 0) + 1;
            this.failureCounts.set(accountId, failures);

            // 如果失败次数达到阈值，标记为不健康
            if (failures >= this.maxFailures) {
                const account = this.accounts.find(acc => acc.id === accountId);
                if (account) {
                    account.isHealthy = false;
                    console.warn(`[Kiro Pool] Account ${accountId} marked as unhealthy after ${failures} failures`);
                }
            }
        }
    }

    /**
     * 执行API调用，带有故障转移
     */
    async executeWithFailover(operation) {
        return this.executeWithRetry(async (account) => {
            return await operation(account.service);
        });
    }

    /**
     * 生成内容
     */
    async generateContent(model, requestBody) {
        return this.executeWithFailover(async (service) => {
            return await service.generateContentNoRetry(model, requestBody);
        });
    }

    /**
     * 流式生成内容
     */
    async * generateContentStream(model, requestBody) {
        yield* this.executeStreamWithRetry(async (account, context) => {
            return account.service.generateContentStreamNoCatch(context.model, context.requestBody);
        }, { model, requestBody });
    }

    /**
     * 列出可用模型
     */
    async listModels() {
        return this.executeWithFailover(async (service) => {
            return await service.listModels();
        });
    }

    /**
     * 刷新所有账号的令牌
     */
    async refreshToken() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const refreshPromises = this.accounts.map(async (account) => {
            try {
                if (account.service.isExpiryDateNear()) {
                    console.log(`[Kiro Pool] Refreshing token for account ${account.id}...`);
                    await account.service.initializeAuth(true);
                    // 同步更新池级别的状态
                    account.isHealthy = true;
                    this.failureCounts.set(account.id, 0); // 重置失败计数
                    this.recordResult(account.id, true);
                    console.log(`[Kiro Pool] Token refreshed successfully for account ${account.id}`);
                }
            } catch (error) {
                console.error(`[Kiro Pool] Failed to refresh token for account ${account.id}:`, error.message);
                account.isHealthy = false;
                this.recordResult(account.id, false);
            }
        });

        const results = await Promise.allSettled(refreshPromises);
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        console.log(`[Kiro Pool] Token refresh completed. ${successCount}/${this.accounts.length} accounts refreshed successfully`);
    }

    /**
     * 检查是否有账号的令牌即将过期
     */
    isExpiryDateNear() {
        return this.accounts.some(account =>
            account.isHealthy && account.service.isExpiryDateNear()
        );
    }

    /**
     * 获取池状态信息
     */
    getPoolStatus() {
        const status = {
            totalAccounts: this.accounts.length,
            healthyAccounts: this.accounts.filter(acc => acc.isHealthy).length,
            strategy: this.loadBalanceStrategy,
            accounts: this.accounts.map(account => ({
                id: account.id,
                name: account.name,
                isHealthy: account.isHealthy,
                requestCount: this.requestCounts.get(account.id) || 0,
                failureCount: this.failureCounts.get(account.id) || 0,
                lastUsed: this.lastUsedTimes.get(account.id) || 0,
                rateLimitResetTime: account.rateLimitResetTime || null,
                isRateLimited: account.rateLimitResetTime && Date.now() < account.rateLimitResetTime
            }))
        };

        return status;
    }

    /**
     * 重置所有统计信息
     */
    resetStats() {
        this.requestCounts.clear();
        this.failureCounts.clear();
        this.lastUsedTimes.clear();

        this.accounts.forEach(account => {
            account.isHealthy = true;
            this.requestCounts.set(account.id, 0);
            this.failureCounts.set(account.id, 0);
            this.lastUsedTimes.set(account.id, 0);
        });

        console.log('[Kiro Pool] All statistics reset');
    }
}