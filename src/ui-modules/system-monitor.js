import os from 'os';
import { execSync } from 'child_process';

// CPU 使用率计算相关变量
let previousCpuInfo = null;

// 进程 CPU 使用率计算相关变量 (PID -> info)
const processCpuInfoMap = new Map();

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
        const isWindows = process.platform === 'win32';
        let cpuPercent = 0;

        if (isWindows) {
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
        } else {
            // Linux/macOS 使用 ps 命令直接获取
            const output = execSync(`ps -p ${pid} -o %cpu`, { encoding: 'utf8' });
            const lines = output.trim().split('\n');
            if (lines.length >= 2) {
                cpuPercent = parseFloat(lines[1].trim());
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
