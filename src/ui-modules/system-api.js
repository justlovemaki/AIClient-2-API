import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { getCpuUsagePercent } from './system-monitor.js';

/**
 * 获取系统信息
 */
export async function handleGetSystem(req, res) {
    const memUsage = process.memoryUsage();
    
    // 读取版本号
    let appVersion = 'unknown';
    try {
        const versionFilePath = path.join(process.cwd(), 'VERSION');
        if (existsSync(versionFilePath)) {
            appVersion = readFileSync(versionFilePath, 'utf8').trim();
        }
    } catch (error) {
        console.warn('[UI API] Failed to read VERSION file:', error.message);
    }
    
    // 计算 CPU 使用率
    const cpuUsage = getCpuUsagePercent();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        appVersion: appVersion,
        nodeVersion: process.version,
        serverTime: new Date().toLocaleString(),
        memoryUsage: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
        cpuUsage: cpuUsage,
        uptime: process.uptime()
    }));
    return true;
}

/**
 * 健康检查接口（用于前端token验证）
 */
export async function handleHealthCheck(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return true;
}

/**
 * 获取服务模式信息
 */
export async function handleGetServiceMode(req, res) {
    const IS_WORKER_PROCESS = process.env.IS_WORKER_PROCESS === 'true';
    const masterPort = process.env.MASTER_PORT || 3100;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        mode: IS_WORKER_PROCESS ? 'worker' : 'standalone',
        pid: process.pid,
        ppid: process.ppid,
        uptime: process.uptime(),
        canAutoRestart: IS_WORKER_PROCESS && !!process.send,
        masterPort: IS_WORKER_PROCESS ? masterPort : null,
        nodeVersion: process.version,
        platform: process.platform
    }));
    return true;
}

/**
 * 重启服务端点 - 支持主进程-子进程架构
 */
export async function handleRestartService(req, res) {
    try {
        const IS_WORKER_PROCESS = process.env.IS_WORKER_PROCESS === 'true';
        
        if (IS_WORKER_PROCESS && process.send) {
            // 作为子进程运行，通知主进程重启
            console.log('[UI API] Requesting restart from master process...');
            process.send({ type: 'restart_request' });
            
            // 广播重启事件
            const { broadcastEvent } = await import('./event-broadcast.js');
            broadcastEvent('service_restart', {
                action: 'restart_requested',
                timestamp: new Date().toISOString(),
                message: 'Service restart requested, worker will be restarted by master process'
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Restart request sent to master process',
                mode: 'worker',
                details: {
                    workerPid: process.pid,
                    restartMethod: 'master_controlled'
                }
            }));
        } else {
            // 独立运行模式，无法自动重启
            console.log('[UI API] Service is running in standalone mode, cannot auto-restart');
            
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'Service is running in standalone mode. Please use master.js to enable auto-restart feature.',
                mode: 'standalone',
                hint: 'Start the service with: node src/core/master.js [args]'
            }));
        }
        return true;
    } catch (error) {
        console.error('[UI API] Failed to restart service:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to restart service: ' + error.message
            }
        }));
        return true;
    }
}