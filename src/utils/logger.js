import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 统一日志工具类
 * 支持控制台和文件输出，自动添加请求ID和时间戳
 */
class Logger {
    constructor() {
        this.config = {
            enabled: true,
            outputMode: 'all', // 'console', 'file', 'all', 'none'
            logDir: 'logs',
            logLevel: 'info', // 'debug', 'info', 'warn', 'error'
            includeRequestId: true,
            includeTimestamp: true,
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 10
        };
        this.currentLogFile = null;
        this.logStream = null;
        this.asyncStorage = new AsyncLocalStorage(); // 使用 AsyncLocalStorage 存储请求上下文
        this.requestContext = new Map(); // 存储请求上下文
        this.contextTTL = 5 * 60 * 1000; // 请求上下文 TTL：5 分钟
        this._contextCleanupTimer = null;
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
    }


    /**
     * 初始化日志配置
     * @param {Object} config - 日志配置对象
     */
    initialize(config = {}) {
        this.config = { ...this.config, ...config };
        
        if (this.config.outputMode === 'none') {
            this.config.enabled = false;
            return;
        }

        if (this.config.outputMode === 'file' || this.config.outputMode === 'all') {
            this.initializeFileLogging();
        }
    }

    /**
     * 初始化文件日志
     */
    initializeFileLogging() {
        try {
            // 确保日志目录存在
            if (!fs.existsSync(this.config.logDir)) {
                fs.mkdirSync(this.config.logDir, { recursive: true });
            }

            // 创建日志文件名（按本地日期）
            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            this.currentLogFile = path.join(this.config.logDir, `app-${dateStr}.log`);

            // 创建写入流
            this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
            
            // 监听错误
            this.logStream.on('error', (err) => {
                console.error('[Logger] Failed to write to log file:', err.message);
            });
        } catch (error) {
            console.error('[Logger] Failed to initialize file logging:', error.message);
        }
    }

    /**
     * 在请求上下文中运行
     * @param {string} requestId - 请求ID
     * @param {Function} callback - 回调函数
     * @returns {any}
     */
    runWithContext(requestId, callback) {
        if (!requestId) {
            requestId = randomUUID().substring(0, 8);
        }
        this.requestContext.set(requestId, { _createdAt: Date.now() });
        this._ensureContextCleanup();
        return this.asyncStorage.run(requestId, callback);
    }

    /**
     * 设置请求上下文 (不推荐直接使用，建议使用 runWithContext)
     * @param {string} requestId - 请求ID
     * @param {Object} context - 上下文信息
     */
    setRequestContext(requestId, context = {}) {
        if (!requestId) {
            requestId = randomUUID().substring(0, 8);
        }
        this.asyncStorage.enterWith(requestId);
        this.requestContext.set(requestId, { ...context, _createdAt: Date.now() });
        this._ensureContextCleanup();
        return requestId;
    }

    /**
     * 获取当前请求ID
     * @returns {string} 请求ID
     */
    getCurrentRequestId() {
        // 从 AsyncLocalStorage 中获取当前请求ID
        return this.asyncStorage.getStore();
    }

    /**
     * 获取当前请求上下文
     * @param {string} requestId - 请求ID
     * @returns {Object} 上下文信息
     */
    getRequestContext(requestId) {
        if (!requestId) {
            requestId = this.getCurrentRequestId();
        }
        return this.requestContext.get(requestId) || {};
    }

    /**
     * 清除请求上下文
     * @param {string} requestId - 请求ID
     */
    clearRequestContext(requestId) {
        if (requestId) {
            this.requestContext.delete(requestId);
        }
        // AsyncLocalStorage 不需要手动清除，run() 会在结束时自动处理
        // 如果使用了 enterWith，则没有简单的方法在该异步路径中清除
    }


    /**
     * 启动定期清理过期请求上下文的定时器（防止内存泄漏）
     * 每 60 秒扫描一次，清除超过 contextTTL 的条目
     */
    _ensureContextCleanup() {
        if (this._contextCleanupTimer) return;
        this._contextCleanupTimer = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const [id, ctx] of this.requestContext) {
                if (now - (ctx._createdAt || 0) > this.contextTTL) {
                    this.requestContext.delete(id);
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                this.log('warn', [`[Logger] Cleaned ${cleaned} stale request context(s) (TTL: ${this.contextTTL}ms)`]);
            }
            // 当 Map 为空时停止定时器
            if (this.requestContext.size === 0) {
                clearInterval(this._contextCleanupTimer);
                this._contextCleanupTimer = null;
            }
        }, 60_000);
        // 不阻止进程退出
        if (this._contextCleanupTimer.unref) {
            this._contextCleanupTimer.unref();
        }
    }

    /**
     * 格式化日志消息
     * @param {string} level - 日志级别
     * @param {Array} args - 日志参数
     * @param {string} requestId - 请求ID
     * @returns {string} 格式化后的日志
     */
    formatMessage(level, args, requestId) {
        const parts = [];

        // 添加本地时间戳
        if (this.config.includeTimestamp) {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const ms = String(now.getMilliseconds()).padStart(3, '0');
            const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
            parts.push(`[${timestamp}]`);
        }

        // 添加请求ID
        if (this.config.includeRequestId && requestId) {
            parts.push(`[Req:${requestId}]`);
        }

        // 添加日志级别
        parts.push(`[${level.toUpperCase()}]`);

        // 添加消息内容
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        parts.push(message);

        return parts.join(' ');
    }

    /**
     * 检查是否应该输出该级别的日志
     * @param {string} level - 日志级别
     * @returns {boolean}
     */
    shouldLog(level) {
        if (!this.config.enabled) return false;
        const currentLevel = this.levels[this.config.logLevel] ?? 1;
        const targetLevel = this.levels[level] ?? 1;
        return targetLevel >= currentLevel;
    }

    /**
     * 检查并轮转日志文件
     */
    checkAndRotateLogFile() {
        try {
            if (!this.currentLogFile || !fs.existsSync(this.currentLogFile)) {
                return;
            }

            const stats = fs.statSync(this.currentLogFile);
            if (stats.size >= this.config.maxFileSize) {
                // 关闭当前日志流
                if (this.logStream && !this.logStream.destroyed) {
                    this.logStream.end();
                }

                // 重命名当前日志文件，添加时间戳
                const timestamp = new Date().getTime();
                const ext = path.extname(this.currentLogFile);
                const basename = path.basename(this.currentLogFile, ext);
                const newName = path.join(this.config.logDir, `${basename}-${timestamp}${ext}`);
                fs.renameSync(this.currentLogFile, newName);

                // 重新创建日志流
                this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
                this.logStream.on('error', (err) => {
                    console.error('[Logger] Failed to write to log file:', err.message);
                });

                // 清理旧日志文件
                this.cleanupOldLogs();
            }
        } catch (error) {
            console.error('[Logger] Failed to rotate log file:', error.message);
        }
    }

    /**
     * 输出日志
     * @param {string} level - 日志级别
     * @param {Array} args - 日志参数
     * @param {string} requestId - 请求ID
     */
    log(level, args, requestId = null) {
        if (!this.shouldLog(level)) return;

        const message = this.formatMessage(level, args, requestId);

        // 输出到控制台
        if (this.config.outputMode === 'console' || this.config.outputMode === 'all') {
            const consoleMethod = level === 'error' ? console.error :
                                  level === 'warn' ? console.warn :
                                  level === 'debug' ? console.debug : console.log;
            consoleMethod(message);
        }

        // 输出到文件
        if (this.config.outputMode === 'file' || this.config.outputMode === 'all') {
            if (this.logStream && !this.logStream.destroyed && this.logStream.writable) {
                try {
                    // 检查文件大小并轮转
                    this.checkAndRotateLogFile();
                    this.logStream.write(message + '\n');
                } catch (err) {
                    // 如果写入失败，输出到控制台作为备份
                    console.error('[Logger] Failed to write to log file:', err.message);
                }
            }
        }
    }

    /**
     * Debug 级别日志
     * @param {...any} args - 日志参数
     */
    debug(...args) {
        const requestId = this.getCurrentRequestId();
        this.log('debug', args, requestId);
    }

    /**
     * Info 级别日志
     * @param {...any} args - 日志参数
     */
    info(...args) {
        const requestId = this.getCurrentRequestId();
        this.log('info', args, requestId);
    }

    /**
     * Warn 级别日志
     * @param {...any} args - 日志参数
     */
    warn(...args) {
        const requestId = this.getCurrentRequestId();
        this.log('warn', args, requestId);
    }

    /**
     * Error 级别日志
     * @param {...any} args - 日志参数
     */
    error(...args) {
        const requestId = this.getCurrentRequestId();
        this.log('error', args, requestId);
    }

    /**
     * 创建带请求ID的日志记录器
     * @param {string} requestId - 请求ID
     * @returns {Object} 带请求上下文的日志方法
     */
    withRequest(requestId) {
        if (!requestId) {
            requestId = this.getCurrentRequestId();
        }

        return {
            debug: (...args) => this.log('debug', args, requestId),
            info: (...args) => this.log('info', args, requestId),
            warn: (...args) => this.log('warn', args, requestId),
            error: (...args) => this.log('error', args, requestId)
        };
    }

    /**
     * 关闭日志流
     */
    close() {
        if (this._contextCleanupTimer) {
            clearInterval(this._contextCleanupTimer);
            this._contextCleanupTimer = null;
        }
        if (this.logStream && !this.logStream.destroyed) {
            this.logStream.end();
            this.logStream = null;
        }
    }

    /**
     * 清理旧日志文件
     */
    cleanupOldLogs() {
        try {
            if (!fs.existsSync(this.config.logDir)) {
                return;
            }

            const files = fs.readdirSync(this.config.logDir)
                .filter(file => file.startsWith('app-') && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.config.logDir, file),
                    time: fs.statSync(path.join(this.config.logDir, file)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);

            // 保留最新的 maxFiles 个文件，删除其他的
            if (files.length > this.config.maxFiles) {
                for (let i = this.config.maxFiles; i < files.length; i++) {
                    try {
                        fs.unlinkSync(files[i].path);
                    } catch (err) {
                        console.error('[Logger] Failed to delete old log file:', files[i].name, err.message);
                    }
                }
            }
        } catch (error) {
            console.error('[Logger] Failed to cleanup old logs:', error.message);
        }
    }

    /**
     * 清空当日日志文件
     * @returns {boolean} 是否成功清空
     */
    clearTodayLog() {
        try {
            if (!this.currentLogFile || !fs.existsSync(this.currentLogFile)) {
                console.warn('[Logger] No current log file to clear');
                return false;
            }

            // 关闭当前日志流
            if (this.logStream && !this.logStream.destroyed) {
                this.logStream.end();
            }

            // 清空文件内容
            fs.writeFileSync(this.currentLogFile, '');

            // 重新创建日志流
            this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
            this.logStream.on('error', (err) => {
                console.error('[Logger] Failed to write to log file:', err.message);
            });

            console.log('[Logger] Today\'s log file cleared successfully');
            return true;
        } catch (error) {
            console.error('[Logger] Failed to clear today\'s log file:', error.message);
            return false;
        }
    }
}

// 创建单例实例
const logger = new Logger();

// 导出实例和类
export default logger;
export { Logger };
