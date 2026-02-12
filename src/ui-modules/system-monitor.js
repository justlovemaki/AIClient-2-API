import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';

// CPU 使用率计算相关变量
let previousCpuInfo = null;

// 进程 CPU 使用率计算相关变量 (PID -> info)
const processCpuInfoMap = new Map();

let cachedClockTicksPerSecond = null;

function getClockTicksPerSecond() {
    if (cachedClockTicksPerSecond) return cachedClockTicksPerSecond;

    // Best-effort: try getconf; fallback to 100 (common Linux USER_HZ).
    try {
        const output = execSync('getconf CLK_TCK', { encoding: 'utf8' }).trim();
        const value = Number.parseInt(output, 10);
        if (Number.isFinite(value) && value > 0) {
            cachedClockTicksPerSecond = value;
            return cachedClockTicksPerSecond;
        }
    } catch {}

    cachedClockTicksPerSecond = 100;
    return cachedClockTicksPerSecond;
}

function readLinuxProcessTotalTicks(pid) {
    try {
        const content = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const end = content.lastIndexOf(')');
        if (end < 0) return null;

        // After the "(comm)" field, the rest are space-delimited fields.
        // utime/stime are fields 14/15; in the post-comm slice they are indices 11/12.
        const fields = content.slice(end + 1).trim().split(/\s+/);
        if (fields.length < 13) return null;

        const utime = Number(fields[11]);
        const stime = Number(fields[12]);
        if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
        return utime + stime;
    } catch {
        return null;
    }
}

/**
 * 获取系统 CPU 使用率百分比
 * @returns {string} CPU 使用率字符串，如 "25.5%"
 */
export function getSystemCpuUsagePercent() {
    const cpus = os.cpus();
    
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    }
    
    const currentCpuInfo = {
        idle: totalIdle,
        total: totalTick
    };
    
    let cpuPercent = 0;
    
    if (previousCpuInfo) {
        const idleDiff = currentCpuInfo.idle - previousCpuInfo.idle;
        const totalDiff = currentCpuInfo.total - previousCpuInfo.total;
        
        if (totalDiff > 0) {
            cpuPercent = 100 - (100 * idleDiff / totalDiff);
        }
    }
    
    previousCpuInfo = currentCpuInfo;
    
    return `${cpuPercent.toFixed(1)}%`;
}

/**
 * 获取特定进程的 CPU 使用率百分比
 * @param {number} pid - 进程 ID
 * @returns {string} CPU 使用率字符串，如 "5.2%"
 */
export function getProcessCpuUsagePercent(pid) {
    if (!pid) return '0.0%';

    try {
        const platform = process.platform;
        let cpuPercent = 0;

        if (platform === 'win32') {
            // Windows 下使用 PowerShell 获取进程的 CPU 使用率
            // CPU = (Process.TotalProcessorTime / ElapsedTime) / ProcessorCount
            const command = `powershell -Command "Get-Process -Id ${pid} | Select-Object -ExpandProperty TotalProcessorTime | ForEach-Object { $_.TotalSeconds }"`;
            const output = execSync(command, { encoding: 'utf8' }).trim();
            const totalProcessorSeconds = parseFloat(output);
            const timestamp = Date.now();

            if (!isNaN(totalProcessorSeconds)) {
                const prevInfo = processCpuInfoMap.get(pid);
                if (prevInfo) {
                    const timeDiff = (timestamp - prevInfo.timestamp) / 1000; // 转换为秒
                    const processTimeDiff = totalProcessorSeconds - prevInfo.totalProcessorSeconds;
                    
                    if (timeDiff > 0) {
                        const cpuCount = os.cpus().length;
                        cpuPercent = (processTimeDiff / timeDiff) * 100;
                        // 归一化到系统总 CPU 的百分比 (0-100%)
                        cpuPercent = cpuPercent / cpuCount;
                    }
                }

                processCpuInfoMap.set(pid, {
                    totalProcessorSeconds,
                    timestamp
                });
            }
        } else if (platform === 'linux') {
            // Alpine containers use BusyBox ps which lacks -p; read /proc instead.
            const totalTicks = readLinuxProcessTotalTicks(pid);
            const timestamp = Date.now();

            if (Number.isFinite(totalTicks)) {
                const prevInfo = processCpuInfoMap.get(pid);
                if (prevInfo && Number.isFinite(prevInfo.totalTicks)) {
                    const timeDiff = (timestamp - prevInfo.timestamp) / 1000;
                    const ticksDiff = totalTicks - prevInfo.totalTicks;

                    if (timeDiff > 0 && ticksDiff >= 0) {
                        const clockTicks = getClockTicksPerSecond();
                        const processSecondsDiff = ticksDiff / clockTicks;
                        const cpuCount = os.cpus().length;

                        cpuPercent = (processSecondsDiff / timeDiff) * 100;
                        cpuPercent = cpuCount > 0 ? cpuPercent / cpuCount : cpuPercent;
                    }
                }

                processCpuInfoMap.set(pid, {
                    totalTicks,
                    timestamp
                });
            }
        } else {
            // macOS / other Unix: use ps directly (no BusyBox limitation).
            const output = execSync(`ps -p ${pid} -o %cpu=`, { encoding: 'utf8' }).trim();
            const parsed = parseFloat(output);
            if (!Number.isNaN(parsed)) {
                cpuPercent = parsed;
            }
        }

        return `${Math.max(0, cpuPercent).toFixed(1)}%`;
    } catch (error) {
        // 忽略进程不存在等错误
        return '0.0%';
    }
}

/**
 * 获取 CPU 使用率百分比 (保持向后兼容)
 * @param {number} [pid] - 可选的进程 ID，如果提供则统计该进程，否则统计系统整体
 * @returns {string} CPU 使用率字符串
 */
export function getCpuUsagePercent(pid) {
    if (pid) {
        return getProcessCpuUsagePercent(pid);
    }
    return getSystemCpuUsagePercent();
}
