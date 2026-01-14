/**
 * 上下文压缩模块测试
 *
 * 运行方式: node src/context-compression/test.js
 */

import { ContextCompressor, MessageClassifier, MessageCategory } from './index.js';

// 模拟消息数据
const mockMessages = [
  // 用户指令
  { role: 'user', content: '请帮我读取 src/index.js 文件' },

  // assistant 调用 Read 工具
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '我来读取这个文件。' },
      { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'src/index.js' } }
    ]
  },

  // Read 工具结果
  {
    role: 'tool',
    tool_name: 'Read',
    content: `// src/index.js
import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3000);
// 这是一个很长的文件内容...
${'// 更多代码...\n'.repeat(100)}`
  },

  // assistant 回复
  { role: 'assistant', content: '文件已读取，这是一个 Express 服务器入口文件。' },

  // 用户再次请求
  { role: 'user', content: '再读一次这个文件' },

  // assistant 再次调用 Read（重复）
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '好的，我再读取一次。' },
      { type: 'tool_use', id: 'tool_2', name: 'Read', input: { file_path: 'src/index.js' } }
    ]
  },

  // 重复的 Read 结果
  {
    role: 'tool',
    tool_name: 'Read',
    content: `// src/index.js
import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3000);
// 这是一个很长的文件内容...
${'// 更多代码...\n'.repeat(100)}`
  },

  // assistant 回复
  { role: 'assistant', content: '文件内容与之前相同。' },

  // 用户请求搜索
  { role: 'user', content: '搜索所有包含 error 的文件' },

  // assistant 调用 Grep
  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tool_3', name: 'Grep', input: { pattern: 'error', path: 'src/' } }
    ]
  },

  // Grep 结果
  {
    role: 'tool',
    tool_name: 'Grep',
    content: `src/utils/logger.js:15: console.error('Error occurred');
src/handlers/error.js:8: function handleError(err) {
src/handlers/error.js:12: throw new Error('Unknown error');`
  },

  // 失败的操作
  { role: 'user', content: '执行 npm test' },

  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tool_4', name: 'Bash', input: { command: 'npm test' } }
    ]
  },

  // 失败结果
  {
    role: 'tool',
    tool_name: 'Bash',
    content: `Error: Command failed with exit code 1
npm ERR! Test failed. See above for more details.
npm ERR! Failed at the test script.`
  },

  // assistant 分析错误
  { role: 'assistant', content: '测试失败了，让我分析一下错误原因...\n\n看起来是某个测试用例没有通过。' },

  // 用户请求修改文件
  { role: 'user', content: '修改 src/index.js，添加错误处理' },

  // assistant 调用 Edit
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '我来添加错误处理。' },
      { type: 'tool_use', id: 'tool_5', name: 'Edit', input: { file_path: 'src/index.js', old_string: "app.listen(3000);", new_string: "app.listen(3000, () => console.log('Server started'));" } }
    ]
  },

  // Edit 结果
  {
    role: 'tool',
    tool_name: 'Edit',
    content: 'File updated successfully.'
  },

  // 再次读取（文件已修改）
  { role: 'user', content: '再读一次 src/index.js' },

  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tool_6', name: 'Read', input: { file_path: 'src/index.js' } }
    ]
  },

  // 修改后的文件内容
  {
    role: 'tool',
    tool_name: 'Read',
    content: `// src/index.js
import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3000, () => console.log('Server started'));
// 这是一个很长的文件内容...
${'// 更多代码...\n'.repeat(100)}`
  },

  { role: 'assistant', content: '文件已更新，现在包含了启动日志。' }
];

// 测试函数
function runTests() {
  console.log('='.repeat(60));
  console.log('上下文压缩模块测试');
  console.log('='.repeat(60));
  console.log();

  // 测试1：消息分类
  console.log('【测试1】消息分类');
  console.log('-'.repeat(40));
  const classifier = new MessageClassifier();
  const classified = classifier.classifyAll(mockMessages);

  const categoryCount = {};
  for (const item of classified) {
    const cat = item.classification.category;
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  console.log('分类结果:');
  for (const [category, count] of Object.entries(categoryCount)) {
    console.log(`  ${category}: ${count} 条`);
  }
  console.log();

  // 测试2：完整压缩
  console.log('【测试2】完整压缩');
  console.log('-'.repeat(40));
  const compressor = new ContextCompressor();
  const result = compressor.compress(mockMessages);

  console.log('压缩统计:');
  console.log(`  原始消息数: ${result.statistics.originalCount}`);
  console.log(`  压缩后消息数: ${result.statistics.finalCount}`);
  console.log(`  移除消息数: ${result.statistics.messagesRemoved}`);
  console.log(`  原始大小: ${result.statistics.originalSize} 字符`);
  console.log(`  压缩后大小: ${result.statistics.finalSize} 字符`);
  console.log(`  压缩率: ${result.statistics.compressionRatio}%`);
  console.log(`  处理时间: ${result.statistics.processingTime}ms`);
  console.log();

  // 显示各阶段统计
  console.log('各阶段统计:');
  for (const stage of result.statistics.stages) {
    console.log(`  [${stage.name}]`);
    if (stage.name === 'deduplication') {
      console.log(`    发现重复: ${stage.duplicatesFound} 处`);
      console.log(`    去重压缩率: ${stage.compressionRatio}%`);
    } else if (stage.name === 'classification') {
      console.log(`    分布: ${JSON.stringify(stage.distribution)}`);
    } else if (stage.name === 'scoring') {
      console.log(`    平均分: ${stage.stats.averageScore}`);
      console.log(`    保留: ${stage.stats.keep}, 轻压缩: ${stage.stats.lightCompress}, 重压缩: ${stage.stats.heavyCompress}, 丢弃: ${stage.stats.discard}`);
    }
  }
  console.log();

  // 测试3：快速去重
  console.log('【测试3】快速去重（仅去重，不压缩）');
  console.log('-'.repeat(40));
  const quickResult = compressor.quickCompress(mockMessages);
  console.log(`  原始: ${quickResult.statistics.originalCount} -> 去重后: ${quickResult.statistics.finalCount}`);
  console.log(`  压缩率: ${quickResult.statistics.compressionRatio}%`);
  console.log();

  // 测试4：激进压缩
  console.log('【测试4】激进压缩');
  console.log('-'.repeat(40));
  const aggressiveResult = compressor.aggressiveCompress(mockMessages, 0.6);
  console.log(`  原始: ${aggressiveResult.statistics.originalCount} -> 压缩后: ${aggressiveResult.statistics.finalCount}`);
  console.log(`  压缩率: ${aggressiveResult.statistics.compressionRatio}%`);
  console.log();

  console.log('='.repeat(60));
  console.log('测试完成！');
  console.log('='.repeat(60));
}

// 运行测试
runTests();
