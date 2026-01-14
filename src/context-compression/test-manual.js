/**
 * 手动压缩功能测试
 *
 * 运行方式: node src/context-compression/test-manual.js
 *
 * 环境变量：
 * - KIRO_API_KEY: API 密钥（如果需要认证）
 * - KIRO_API_ENDPOINT: API 端点（默认 http://localhost:3060/claude-kiro-oauth/v1/messages）
 *
 * 注意：需要确保 Kiro API 服务正在运行
 */

import { ManualCompressor } from './ManualCompressor.js';

// 模拟长对话消息
const mockMessages = [
  { role: 'user', content: '请帮我分析 src/index.js 文件的代码结构' },

  { role: 'assistant', content: '好的，我来读取并分析这个文件。' },

  { role: 'assistant', content: `我已经读取了文件，这是一个 Express 服务器入口文件。

文件结构分析：
1. 导入部分：使用 ES Module 导入 express
2. 应用初始化：创建 express 实例
3. 路由定义：定义了根路由 '/'
4. 服务器启动：监听 3000 端口

代码质量评估：
- 结构清晰
- 缺少错误处理
- 建议添加中间件` },

  { role: 'user', content: '再帮我看看 src/utils/logger.js' },

  { role: 'assistant', content: '好的，我来读取 logger.js 文件。' },

  { role: 'assistant', content: `logger.js 文件分析：

这是一个日志工具模块，包含以下功能：
1. info() - 输出信息日志
2. warn() - 输出警告日志
3. error() - 输出错误日志
4. debug() - 输出调试日志

使用了 console 作为底层输出，建议升级到 winston 或 pino。` },

  { role: 'user', content: '搜索所有包含 error 的文件' },

  { role: 'assistant', content: '我来搜索包含 error 的文件。' },

  { role: 'assistant', content: `搜索结果：
- src/utils/logger.js:15: console.error('Error occurred');
- src/handlers/error.js:8: function handleError(err) {
- src/handlers/error.js:12: throw new Error('Unknown error');
- src/middleware/errorHandler.js:3: export function errorHandler(err, req, res, next)

共找到 4 处匹配。` },

  { role: 'user', content: '执行测试' },

  { role: 'assistant', content: '好的，我来运行测试。' },

  { role: 'assistant', content: `测试执行失败：

Error: Command failed with exit code 1
npm ERR! Test failed.

失败的测试用例：
1. test/api.test.js - API 端点测试失败
2. test/utils.test.js - 工具函数测试失败

错误原因分析：
- api.test.js: 期望返回 200，实际返回 404
- utils.test.js: formatDate 函数返回格式不正确` },

  { role: 'user', content: '修复 API 测试问题' },

  { role: 'assistant', content: `我来分析并修复 API 测试问题。

问题定位：
测试期望访问 /api/users 端点，但该端点未定义。

修复方案：
在 src/routes/api.js 中添加 /users 路由。

已完成修复，请重新运行测试。` },

  { role: 'user', content: '再次运行测试' },

  { role: 'assistant', content: '好的，重新运行测试。' },

  { role: 'assistant', content: `测试结果：

✓ test/api.test.js (3 passed)
✓ test/utils.test.js (5 passed)

所有测试通过！
总计：8 个测试，0 个失败` },

  { role: 'user', content: '总结一下今天做了什么' },

  { role: 'assistant', content: `今日工作总结：

1. 代码分析
   - 分析了 src/index.js（Express 入口文件）
   - 分析了 src/utils/logger.js（日志工具）

2. 代码搜索
   - 搜索了包含 error 的文件，找到 4 处匹配

3. 测试修复
   - 发试失败问题
   - 定位到 /api/users 端点缺失
   - 修复了路由配置
   - 所有测试现已通过

建议后续工作：
- 升级日志库到 winston
- 添加更多错误处理中间件
- 完善 API 文档` }
];

// 测试函数
async function runTest() {
  console.log('='.repeat(60));
  console.log('手动压缩功能测试（调用 Kiro API）');
  console.log('='.repeat(60));
  console.log();

  console.log(`原始消息数: ${mockMessages.length}`);
  console.log(`原始大小: ${JSON.stringify(mockMessages).length} 字符`);
  console.log();

  // 从环境变量读取配置
  const apiKey = process.env.KIRO_API_KEY || null;
  const apiEndpoint = process.env.KIRO_API_ENDPOINT || 'http://localhost:3060/claude-kiro-oauth/v1/messages';

  console.log(`API 端点: ${apiEndpoint}`);
  console.log(`API 密钥: ${apiKey ? '已配置' : '未配置'}`);
  console.log();

  // 创建压缩器
  const compressor = new ManualCompressor({
    apiEndpoint,
    apiKey,
    maxTokens: 8000
  });

  console.log('正在调用 Kiro API 进行压缩...');
  console.log('-'.repeat(40));

  try {
    const result = await compressor.compress(mockMessages);

    if (result.success) {
      console.log('\n压缩成功！');
      console.log('-'.repeat(40));
      console.log(`压缩后消息数: ${result.statistics.finalCount}`);
      console.log(`压缩后大小: ${result.statistics.finalSize} 字符`);
      console.log(`压缩率: ${result.statistics.compressionRatio}%`);
      console.log(`处理时间: ${result.statistics.processingTime}ms`);

      if (result.statistics.apiTokensUsed) {
        console.log(`API Token 使用: ${JSON.stringify(result.statistics.apiTokensUsed)}`);
      }

      console.log('\n压缩后的消息:');
      console.log('-'.repeat(40));
      result.messages.forEach((msg, i) => {
        console.log(`[${i + 1}] ${msg.role.toUpperCase()}:`);
        console.log(msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : ''));
        console.log();
      });
    } else {
      console.log('\n压缩失败！');
      console.log(`错误: ${result.error}`);
      console.log(`详情: ${JSON.stringify(result.statistics.errorDetails, null, 2)}`);
    }
  } catch (error) {
    console.error('\n发生异常:');
    console.error(error.message);

    if (error.code === 'ECONNREFUSED') {
      console.log('\n提示: 请确保 Kiro API 服务正在运行');
      console.log('API 端点: http://localhost:3060/claude-kiro-oauth/v1/messages');
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('测试完成');
  console.log('='.repeat(60));
}

// 运行测试
runTest();
