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
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';

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
        console.log('[Master] Worker process already running, PID:', workerProcess.pid);
        return;
    }

    console.log('[Master] Starting worker process...');
    console.log('[Master] Worker script:', config.workerScript);
    console.log('[Master] Worker args:', config.args.join(' '));

    workerProcess = fork(config.workerScript, config.args, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
            ...process.env,
            IS_WORKER_PROCESS: 'true'
        }
    });

    workerStatus.pid = workerProcess.pid;
    workerStatus.startTime = new Date().toISOString();

    console.log('[Master] Worker process started, PID:', workerProcess.pid);

    // 监听子进程消息
    workerProcess.on('message', (message) => {
        console.log('[Master] Received message from worker:', message);
        handleWorkerMessage(message);
    });

    // 监听子进程退出
    workerProcess.on('exit', (code, signal) => {
        console.log(`[Master] Worker process exited with code ${code}, signal ${signal}`);
        workerProcess = null;
        workerStatus.pid = null;

        // 如果不是主动重启导致的退出，尝试自动重启
        if (!workerStatus.isRestarting && code !== 0) {
            console.log('[Master] Worker crashed, attempting auto-restart...');
            scheduleRestart();
        }
    });

    // 监听子进程错误
    workerProcess.on('error', (error) => {
        console.error('[Master] Worker process error:', error.message);
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
            console.log('[Master] No worker process to stop');
            resolve();
            return;
        }

        console.log('[Master] Stopping worker process, PID:', workerProcess.pid);

        const timeout = setTimeout(() => {
            if (workerProcess) {
                console.log('[Master] Force killing worker process...');
                workerProcess.kill('SIGKILL');
            }
            resolve();
        }, 5000); // 5秒超时后强制杀死

        workerProcess.once('exit', () => {
            clearTimeout(timeout);
            workerProcess = null;
            workerStatus.pid = null;
            console.log('[Master] Worker process stopped');
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
        console.log('[Master] Restart already in progress');
        return { success: false, message: 'Restart already in progress' };
    }

    workerStatus.isRestarting = true;
    workerStatus.restartCount++;
    workerStatus.lastRestartTime = new Date().toISOString();

    console.log('[Master] Restarting worker process...');

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
        console.error('[Master] Failed to restart worker:', error.message);
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
        console.error('[Master] Max restart attempts reached, giving up');
        return;
    }

    const delay = Math.min(config.restartDelay * Math.pow(2, workerStatus.restartCount), 30000);
    console.log(`[Master] Scheduling restart in ${delay}ms...`);

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
            console.log('[Master] Worker is ready');
            break;
        case 'restart_request':
            console.log('[Master] Worker requested restart');
            restartWorker();
            break;
        case 'status':
            console.log('[Master] Worker status:', message.data);
            break;
        default:
            console.log('[Master] Unknown message type:', message.type);
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
            console.log('[Master] Restart requested via API');
            const result = await restartWorker();
            res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        // 停止端点
        if (method === 'POST' && path === '/master/stop') {
            console.log('[Master] Stop requested via API');
            await stopWorker(true);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Worker stopped' }));
            return;
        }

        // 启动端点
        if (method === 'POST' && path === '/master/start') {
            console.log('[Master] Start requested via API');
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
        console.log(`[Master] Management server listening on port ${config.masterPort}`);
        console.log(`[Master] Available endpoints:`);
        console.log(`  GET  /master/status  - Get master and worker status`);
        console.log(`  GET  /master/health  - Health check`);
        console.log(`  POST /master/restart - Restart worker process`);
        console.log(`  POST /master/stop    - Stop worker process`);
        console.log(`  POST /master/start   - Start worker process`);
    });

    return server;
}

/**
 * 处理进程信号
 */
function setupSignalHandlers() {
    // 优雅关闭
    process.on('SIGTERM', async () => {
        console.log('[Master] Received SIGTERM, shutting down...');
        await stopWorker(true);
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('[Master] Received SIGINT, shutting down...');
        await stopWorker(true);
        process.exit(0);
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
        console.error('[Master] Uncaught exception:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Master] Unhandled rejection at:', promise, 'reason:', reason);
    });
}

/**
 * 主函数
 */
async function main() {
    console.log('='.repeat(50));
    console.log('[Master] AIClient2API Master Process');
    console.log('[Master] PID:', process.pid);
    console.log('[Master] Node version:', process.version);
    console.log('[Master] Working directory:', process.cwd());
    console.log('='.repeat(50));

    // 设置信号处理
    setupSignalHandlers();

    // 创建管理服务器
    createMasterServer();

    // 启动子进程
    startWorker();
}

// 启动主进程
main().catch(error => {
    console.error('[Master] Failed to start:', error);
    process.exit(1);
});