/**
 * 主进程 (Master Process)
 * 
 * 负责管理子进程的生命周期，包括：
 * - 启动子进程
 * - 监控子进程状态
 * - 处理子进程重启请求
 * - 提供 IPC 通信
 * 
 * 使用方式：
 * node src/core/master.js [原有的命令行参数]
 */

import { fork } from 'child_process';
import logger from '../utils/logger.js';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { isRetryableNetworkError } from '../utils/common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 子进程实例
let workerProcess = null;

// 子进程状态
let workerStatus = {
    pid: null,
    startTime: null,
    restartCount: 0,
    lastRestartTime: null,
    isRestarting: false
};

// 配置
const config = {
    workerScript: path.join(__dirname, '../services/api-server.js'),
    maxRestartAttempts: 10,
    restartDelay: 1000, // 重启延迟（毫秒）
    masterPort: parseInt(process.env.MASTER_PORT) || 3100, // 主进程管理端口
    args: process.argv.slice(2) // 传递给子进程的参数
};

/**
 * 启动子进程
 */
function startWorker() {
    if (workerProcess) {
        logger.info('[Master] Worker process already running, PID:', workerProcess.pid);
        return;
    }

    logger.info('[Master] Starting worker process...');
    logger.info('[Master] Worker script:', config.workerScript);
    logger.info('[Master] Worker args:', config.args.join(' '));

    workerProcess = fork(config.workerScript, config.args, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
            ...process.env,
            IS_WORKER_PROCESS: 'true'
        }
    });

    workerStatus.pid = workerProcess.pid;
    workerStatus.startTime = new Date().toISOString();

    logger.info('[Master] Worker process started, PID:', workerProcess.pid);

    // 监听子进程消息
    workerProcess.on('message', (message) => {
        logger.info('[Master] Received message from worker:', message);
        handleWorkerMessage(message);
    });

    // 监听子进程退出
    workerProcess.on('exit', (code, signal) => {
        logger.info(`[Master] Worker process exited with code ${code}, signal ${signal}`);
        workerProcess = null;
        workerStatus.pid = null;

        // 如果不是主动重启导致的退出，尝试自动重启
        if (!workerStatus.isRestarting && code !== 0) {
            logger.info('[Master] Worker crashed, attempting auto-restart...');
            scheduleRestart();
        }
    });

    // 监听子进程错误
    workerProcess.on('error', (error) => {
        logger.error('[Master] Worker process error:', error.message);
    });
}

/**
 * 停止子进程
 * @param {boolean} graceful - 是否优雅关闭
 * @returns {Promise<void>}
 */
function stopWorker(graceful = true) {
    return new Promise((resolve) => {
        if (!workerProcess) {
            logger.info('[Master] No worker process to stop');
            resolve();
            return;
        }

        logger.info('[Master] Stopping worker process, PID:', workerProcess.pid);

        const timeout = setTimeout(() => {
            if (workerProcess) {
                logger.info('[Master] Force killing worker process...');
                workerProcess.kill('SIGKILL');
            }
            resolve();
        }, 5000); // 5秒超时后强制杀死

        workerProcess.once('exit', () => {
            clearTimeout(timeout);
            workerProcess = null;
            workerStatus.pid = null;
            logger.info('[Master] Worker process stopped');
            resolve();
        });

        if (graceful) {
            // 发送优雅关闭信号
            workerProcess.send({ type: 'shutdown' });
            workerProcess.kill('SIGTERM');
        } else {
            workerProcess.kill('SIGKILL');
        }
    });
}

/**
 * 重启子进程
 * @returns {Promise<Object>}
 */
async function restartWorker() {
    if (workerStatus.isRestarting) {
        logger.info('[Master] Restart already in progress');
        return { success: false, message: 'Restart already in progress' };
    }

    workerStatus.isRestarting = true;
    workerStatus.restartCount++;
    workerStatus.lastRestartTime = new Date().toISOString();

    logger.info('[Master] Restarting worker process...');

    try {
        await stopWorker(true);
        
        // 等待一小段时间确保端口释放
        await new Promise(resolve => setTimeout(resolve, config.restartDelay));
        
        startWorker();
        workerStatus.isRestarting = false;

        return {
            success: true,
            message: 'Worker restarted successfully',
            pid: workerStatus.pid,
            restartCount: workerStatus.restartCount
        };
    } catch (error) {
        workerStatus.isRestarting = false;
        logger.error('[Master] Failed to restart worker:', error.message);
        return {
            success: false,
            message: 'Failed to restart worker: ' + error.message
        };
    }
}

/**
 * 计划重启（用于崩溃后自动重启）
 */
function scheduleRestart() {
    if (workerStatus.restartCount >= config.maxRestartAttempts) {
        logger.error('[Master] Max restart attempts reached, giving up');
        return;
    }

    const delay = Math.min(config.restartDelay * Math.pow(2, workerStatus.restartCount), 30000);
    logger.info(`[Master] Scheduling restart in ${delay}ms...`);

    setTimeout(() => {
        restartWorker();
    }, delay);
}

/**
 * 处理来自子进程的消息
 * @param {Object} message - 消息对象
 */
function handleWorkerMessage(message) {
    if (!message || !message.type) return;

    switch (message.type) {
        case 'ready':
            logger.info('[Master] Worker is ready');
            break;
        case 'restart_request':
            logger.info('[Master] Worker requested restart');
            restartWorker();
            break;
        case 'status':
            logger.info('[Master] Worker status:', message.data);
            break;
        default:
            logger.info('[Master] Unknown message type:', message.type);
    }
}

/**
 * 获取状态信息
 * @returns {Object}
 */
function getStatus() {
    return {
        master: {
            pid: process.pid,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        },
        worker: {
            pid: workerStatus.pid,
            startTime: workerStatus.startTime,
            restartCount: workerStatus.restartCount,
            lastRestartTime: workerStatus.lastRestartTime,
            isRestarting: workerStatus.isRestarting,
            isRunning: workerProcess !== null
        }
    };
}

/**
 * 创建主进程管理 HTTP 服务器
 */
function createMasterServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;
        const method = req.method;

        // 设置 CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // 状态端点
        if (method === 'GET' && path === '/master/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getStatus()));
            return;
        }

        // 重启端点
        if (method === 'POST' && path === '/master/restart') {
            logger.info('[Master] Restart requested via API');
            const result = await restartWorker();
            res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        // 停止端点
        if (method === 'POST' && path === '/master/stop') {
            logger.info('[Master] Stop requested via API');
            await stopWorker(true);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Worker stopped' }));
            return;
        }

        // 启动端点
        if (method === 'POST' && path === '/master/start') {
            logger.info('[Master] Start requested via API');
            if (workerProcess) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Worker already running' }));
                return;
            }
            startWorker();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Worker started', pid: workerStatus.pid }));
            return;
        }

        // 健康检查
        if (method === 'GET' && path === '/master/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                workerRunning: workerProcess !== null,
                timestamp: new Date().toISOString()
            }));
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(config.masterPort, () => {
        logger.info(`[Master] Management server listening on port ${config.masterPort}`);
        logger.info(`[Master] Available endpoints:`);
        logger.info(`  GET  /master/status  - Get master and worker status`);
        logger.info(`  GET  /master/health  - Health check`);
        logger.info(`  POST /master/restart - Restart worker process`);
        logger.info(`  POST /master/stop    - Stop worker process`);
        logger.info(`  POST /master/start   - Start worker process`);
    });

    return server;
}

/**
 * 处理进程信号
 */
function setupSignalHandlers() {
    // 优雅关闭
    process.on('SIGTERM', async () => {
        logger.info('[Master] Received SIGTERM, shutting down...');
        await stopWorker(true);
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        logger.info('[Master] Received SIGINT, shutting down...');
        await stopWorker(true);
        process.exit(0);
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
        logger.error('[Master] Uncaught exception:', error);
        
        // 检查是否为可重试的网络错误
        if (isRetryableNetworkError(error)) {
            logger.warn('[Master] Network error detected, continuing operation...');
            return; // 不退出程序，继续运行
        }
        
        // 对于其他严重错误，记录但不退出（由主进程管理子进程）
        logger.error('[Master] Fatal error detected in master process');
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('[Master] Unhandled rejection at:', promise, 'reason:', reason);
        
        // 检查是否为可重试的网络错误
        if (reason && isRetryableNetworkError(reason)) {
            logger.warn('[Master] Network error in promise rejection, continuing operation...');
            return; // 不退出程序，继续运行
        }
    });
}

/**
 * 主函数
 */
async function main() {
    logger.info('='.repeat(50));
    logger.info('[Master] AIClient2API Master Process');
    logger.info('[Master] PID:', process.pid);
    logger.info('[Master] Node version:', process.version);
    logger.info('[Master] Working directory:', process.cwd());
    logger.info('='.repeat(50));

    // 设置信号处理
    setupSignalHandlers();

    // 创建管理服务器
    createMasterServer();

    // 启动子进程
    startWorker();
}

// 启动主进程
main().catch(error => {
    logger.error('[Master] Failed to start:', error);
    process.exit(1);
});