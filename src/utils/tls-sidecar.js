/**
 * TLS Sidecar Manager
 * 
 * 管理 Go uTLS sidecar 进程的生命周期：
 * - 启动/停止 sidecar 二进制
 * - 健康检查 & 自动重启
 * - 为 axios 提供 sidecar 代理配置
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 9090;
const HEALTH_CHECK_INTERVAL = 30000; // 30s
const HEALTH_CHECK_TIMEOUT = 3000;   // 3s
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY = 2000;          // 2s

class TLSSidecar {
    constructor() {
        this.process = null;
        this.port = DEFAULT_PORT;
        this.baseUrl = null;
        this.healthCheckTimer = null;
        this.restartCount = 0;
        this.isShuttingDown = false;
        this.ready = false;
    }

    /**
     * 启动 sidecar 进程
     * @param {Object} options
     * @param {number} [options.port] - 监听端口
     * @param {string} [options.binaryPath] - 自定义二进制路径
     * @returns {Promise<boolean>}
     */
    async start(options = {}) {
        if (this.process) {
            logger.info('[TLS-Sidecar] Already running');
            return true;
        }

        this.port = options.port || parseInt(process.env.TLS_SIDECAR_PORT) || DEFAULT_PORT;
        this.baseUrl = `http://127.0.0.1:${this.port}`;

        // 查找二进制文件
        const binaryPath = options.binaryPath || this._findBinary();
        if (!binaryPath) {
            logger.error('[TLS-Sidecar] Binary not found. Build it with: cd tls-sidecar && go build -o tls-sidecar');
            return false;
        }

        logger.info(`[TLS-Sidecar] Starting: ${binaryPath} on port ${this.port}`);

        try {
            // 确保 Linux/macOS 下有执行权限
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(binaryPath, 0o755);
                } catch (e) {
                    logger.warn(`[TLS-Sidecar] Failed to chmod binary: ${e.message}`);
                }
            }

            this.process = spawn(binaryPath, [], {
                env: {
                    ...process.env,
                    TLS_SIDECAR_PORT: String(this.port),
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            // 转发 sidecar 日志
            this.process.stdout.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) logger.info(`[TLS-Sidecar] ${msg}`);
            });

            this.process.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) logger.error(`[TLS-Sidecar] ${msg}`);
            });

            this.process.on('exit', (code, signal) => {
                logger.warn(`[TLS-Sidecar] Process exited (code=${code}, signal=${signal})`);
                this.process = null;
                this.ready = false;

                if (!this.isShuttingDown && this.restartCount < MAX_RESTART_ATTEMPTS) {
                    this.restartCount++;
                    logger.info(`[TLS-Sidecar] Auto-restart attempt ${this.restartCount}/${MAX_RESTART_ATTEMPTS}`);
                    setTimeout(() => this.start(options), RESTART_DELAY);
                }
            });

            this.process.on('error', (err) => {
                logger.error(`[TLS-Sidecar] Spawn error: ${err.message}`);
                this.process = null;
                this.ready = false;
            });

            // 等待 sidecar 就绪
            const ok = await this._waitForReady();
            if (ok) {
                this.ready = true;
                this.restartCount = 0;
                this._startHealthCheck();
                logger.info(`[TLS-Sidecar] Ready at ${this.baseUrl}`);
            }
            return ok;

        } catch (err) {
            logger.error(`[TLS-Sidecar] Failed to start: ${err.message}`);
            return false;
        }
    }

    /**
     * 停止 sidecar 进程
     */
    async stop() {
        this.isShuttingDown = true;
        this._stopHealthCheck();

        if (this.process) {
            logger.info('[TLS-Sidecar] Stopping...');
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    if (this.process) {
                        logger.warn('[TLS-Sidecar] Force killing');
                        this.process.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);

                this.process.once('exit', () => {
                    clearTimeout(timeout);
                    this.process = null;
                    this.ready = false;
                    logger.info('[TLS-Sidecar] Stopped');
                    resolve();
                });

                this.process.kill('SIGTERM');
            });
        }
    }

    /**
     * 检查 sidecar 是否正在运行且健康
     * @returns {boolean}
     */
    isReady() {
        return this.ready && this.process !== null;
    }

    /**
     * 获取 sidecar base URL
     * @returns {string|null}
     */
    getBaseUrl() {
        return this.isReady() ? this.baseUrl : null;
    }

    /**
     * 为 axios 配置 sidecar 代理
     * 将目标 URL 改为 sidecar 地址，原始目标通过 header 传递
     * 
     * @param {Object} axiosConfig - axios 配置对象
     * @param {string} [proxyUrl] - 上游代理 URL（可选）
     * @returns {Object} 修改后的 axios 配置
     */
    wrapAxiosConfig(axiosConfig, proxyUrl) {
        if (!this.isReady()) {
            return axiosConfig; // sidecar 不可用，原样返回
        }

        const targetUrl = axiosConfig.url;

        // 将请求指向 sidecar
        axiosConfig.url = this.baseUrl;

        // 通过 header 传递目标和代理信息
        axiosConfig.headers = axiosConfig.headers || {};
        axiosConfig.headers['X-Target-Url'] = targetUrl;
        if (proxyUrl) {
            axiosConfig.headers['X-Proxy-Url'] = proxyUrl;
        }

        // 走 sidecar 不需要 Node.js 侧的 TLS agent
        delete axiosConfig.httpAgent;
        delete axiosConfig.httpsAgent;
        // 确保 axios 不使用自己的代理
        axiosConfig.proxy = false;

        return axiosConfig;
    }

    // ──── 内部方法 ────

    _findBinary() {
        const projectRoot = path.resolve(__dirname, '..', '..');
        const isWin = process.platform === 'win32';
        const ext = isWin ? '.exe' : '';

        const candidates = [
            path.join(projectRoot, 'tls-sidecar', `tls-sidecar${ext}`),
            path.join(projectRoot, `tls-sidecar${ext}`),
            path.join('/usr', 'local', 'bin', `tls-sidecar${ext}`),
            path.join('/app', 'tls-sidecar', `tls-sidecar${ext}`),
            path.join('/app', `tls-sidecar${ext}`),
        ];

        for (const p of candidates) {
            try {
                if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                    return p;
                }
            } catch { /* ignore */ }
        }
        return null;
    }

    async _waitForReady(timeoutMs = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const ok = await this._healthCheck();
                if (ok) return true;
            } catch { /* retry */ }
            await sleep(500);
        }
        logger.error('[TLS-Sidecar] Timed out waiting for sidecar to become ready');
        return false;
    }

    _healthCheck() {
        return new Promise((resolve) => {
            const req = http.get(`${this.baseUrl}/health`, { timeout: HEALTH_CHECK_TIMEOUT }, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    resolve(res.statusCode === 200);
                });
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    _startHealthCheck() {
        this._stopHealthCheck();
        this.healthCheckTimer = setInterval(async () => {
            const ok = await this._healthCheck();
            if (!ok && this.ready) {
                logger.warn('[TLS-Sidecar] Health check failed');
                this.ready = false;
            } else if (ok && !this.ready) {
                logger.info('[TLS-Sidecar] Recovered');
                this.ready = true;
            }
        }, HEALTH_CHECK_INTERVAL);
    }

    _stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 单例
let instance = null;

export function getTLSSidecar() {
    if (!instance) {
        instance = new TLSSidecar();
    }
    return instance;
}

export default TLSSidecar;
