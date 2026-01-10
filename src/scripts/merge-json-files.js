/**
 * JSON File Merger Tool
 * 解析当前或指定目录的 .json 文件，合并为一个 JSON 对象，并保存到执行脚本的目录下。
 *
 * 功能:
 * 1. 扫描目录下的所有 .json 文件。
 * 2. 读取并解析每个文件。
 * 3. 过滤掉非对象 JSON 内容。
 * 4. 将所有对象属性合并到一个大对象中。
 * 5. 特殊处理: 如果合并后的对象中包含 clientSecret 字段，则移除 expiresAt 字段。
 * 6. 输出文件名为: merge-kiro-<时间戳>-auth-token.json
 * 
 * 使用方法:
 *   node src/merge-json-files.js [directory]
 * 
 * 参数:
 *   directory - 要扫描的目录路径 (可选，默认: 当前脚本执行目录)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前脚本所在目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 主函数
 */
async function main() {
    // 获取命令行参数中的目录，如果未提供则使用当前工作目录 (process.cwd())
    // 注意：用户需求是"解析当前或指定目录"，这里的"当前"通常指用户运行命令时的目录
    const args = process.argv.slice(2);
    const targetDir = args[0] ? path.resolve(process.cwd(), args[0]) : process.cwd();

    console.log(`[JSON Merger] 扫描目录: ${targetDir}`);

    if (!fs.existsSync(targetDir)) {
        console.error(`错误: 目录不存在 ${targetDir}`);
        process.exit(1);
    }

    try {
        const files = fs.readdirSync(targetDir);
        const jsonFiles = files.filter(file => file.toLowerCase().endsWith('.json'));
        
        if (jsonFiles.length === 0) {
            console.log('[JSON Merger] 未找到 JSON 文件。');
            process.exit(0);
        }

        console.log(`[JSON Merger] 找到 ${jsonFiles.length} 个 JSON 文件`);
        
        let mergedData = {};
        let successCount = 0;
        let skipCount = 0;

        for (const file of jsonFiles) {
            const filePath = path.join(targetDir, file);
            
            // 跳过自身生成的合并文件，防止递归合并垃圾数据 (简单的名字检查)
            if (file.startsWith('merge-kiro-') && file.endsWith('-auth-token.json')) {
                console.log(`[JSON Merger] 跳过之前的合并文件: ${file}`);
                skipCount++;
                continue;
            }

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const jsonData = JSON.parse(content);

                // 处理逻辑:
                // 仅处理对象类型，如果是数组则跳过或尝试合并数组中的对象（通常合并对象意味着所有字段平铺到一个对象中）
                // 鉴于用户要求合并为一个 JSON 对象，假设所有文件内容都是部分配置，需要合并到一起。
                
                if (typeof jsonData === 'object' && jsonData !== null && !Array.isArray(jsonData)) {
                     Object.assign(mergedData, jsonData);
                     successCount++;
                } else {
                    console.log(`[JSON Merger] 文件 ${file} 内容格式不符合要求 (非纯对象)，跳过`);
                    skipCount++;
                    continue;
                }

            } catch (error) {
                console.warn(`[JSON Merger] 解析文件 ${file} 失败: ${error.message}`);
                skipCount++;
            }
        }
        
        // 特殊处理: 如果包含 clientSecret，移除 expiresAt
        // 注意：这是在合并后的对象上进行处理，因为 clientSecret 和 expiresAt 可能来自不同文件，或者合并后才决定
        if (mergedData.clientSecret && mergedData.expiresAt) {
            delete mergedData.expiresAt;
        }

        if (Object.keys(mergedData).length === 0) {
            console.log('[JSON Merger] 没有有效的数据需要合并。');
            process.exit(0);
        }

        // 生成输出文件名
        const timestamp = Date.now();
        const outputFileName = `merge-kiro-${timestamp}-auth-token.json`;
        // 用户需求: "保存到执行脚本的目录下" -> 即 __dirname
        const outputFilePath = path.join(__dirname, outputFileName);

        fs.writeFileSync(outputFilePath, JSON.stringify(mergedData, null, 2), 'utf-8');

        console.log('');
        console.log('=== 合并完成 ===');
        console.log(`扫描文件数: ${jsonFiles.length}`);
        console.log(`成功处理: ${successCount}`);
        console.log(`跳过/失败: ${skipCount}`);
        console.log(`合并字段数: ${Object.keys(mergedData).length}`);
        console.log(`输出文件: ${outputFilePath}`);

    } catch (error) {
        console.error(`[JSON Merger] 处理过程中发生错误: ${error.message}`);
        process.exit(1);
    }
}

main();