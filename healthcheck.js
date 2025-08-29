/**
 * Docker健康检查脚本
 * 用于检查API服务器是否正常运行
 */

import http from 'http';

// 从环境变量获取主机和端口，如果没有设置则使用默认值
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.SERVER_PORT || 3000;

// 发送HTTP请求到健康检查端点
const options = {
  hostname: HOST,
  port: PORT,
  path: '/health',
  method: 'GET',
  timeout: 2000 // 2秒超时
};

const req = http.request(options, (res) => {
  // 如果状态码是200，表示服务健康
  if (res.statusCode === 200) {
    console.log('Health check passed');
    process.exit(0);
  } else {
    console.log(`Health check failed with status code: ${res.statusCode}`);
    process.exit(1);
  }
});

// 处理请求错误
req.on('error', (e) => {
  console.error(`Health check failed: ${e.message}`);
  process.exit(1);
});

// 设置超时处理
req.on('timeout', () => {
  console.error('Health check timed out');
  req.destroy();
  process.exit(1);
});

// 结束请求
req.end();