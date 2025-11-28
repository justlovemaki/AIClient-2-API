# AIClient2API 可视化管理控制台

## 概述

AIClient2API 现在包含一个功能完整的可视化 Web UI 管理控制台，允许您通过浏览器轻松管理配置、监控提供商池状态、查看实时日志、配置AI模型提供商等。

## 功能特性

### 🎨 现代化界面
- 响应式设计，支持桌面和移动设备
- 直观的仪表盘展示系统统计信息
- 侧边栏导航，方便快速切换功能模块
- 协议标签切换（OpenAI协议/Claude协议）

### 📊 实时监控
- **仪表盘**：显示运行时间、系统信息、Node.js版本、服务器时间、内存使用
- **提供商池管理**：查看各提供商账户状态、使用统计、错误率
- **活动统计**：活动连接、活跃提供商、健康提供商数量

### ⚙️ 配置管理
- 在线修改 API 密钥、监听地址、端口
- 支持多种模型提供商：
  - **Gemini CLI OAuth** - 支持突破限制的Gemini访问
  - **OpenAI Custom** - 自定义OpenAI API配置
  - **Claude Custom** - 自定义Claude API配置
  - **Claude Kiro OAuth** - 突破限制/免费使用的Claude服务
  - **Qwen OAuth** - 通义千问OAuth认证
  - **OpenAI Responses** - OpenAI新版本API
- 编辑系统提示词
- 高级配置选项：
  - 系统提示文件路径和模式
  - 提示日志配置
  - 请求重试机制（最大重试次数、基础延迟）
  - OAuth令牌自动刷新设置
  - 提供商池配置文件路径

### 🔧 上传配置管理
- 搜索配置文件功能
- 按关联状态过滤（已关联/未关联）
- 配置文件列表展示
- 配置统计信息（总数、已关联数、未关联数）
- 实时刷新配置列表

### 🛣️ 路径路由调用示例
- **即时切换**：通过修改URL路径即可切换不同的AI模型提供商
- **跨协议调用**：支持OpenAI协议调用Claude模型，或Claude协议调用OpenAI模型
- **客户端配置指导**：为Cherry-Studio、NextChat、Cline等客户端提供配置示例
- 提供完整的curl使用示例
- 一键复制端点路径功能

支持的路由路径示例：
- `/gemini-cli-oauth/v1/chat/completions` - Gemini CLI OAuth (OpenAI协议)
- `/gemini-cli-oauth/v1/messages` - Gemini CLI OAuth (Claude协议)
- `/openai-qwen-oauth/v1/chat/completions` - Qwen OAuth (OpenAI协议)
- `/openai-qwen-oauth/v1/messages` - Qwen OAuth (Claude协议)
- `/claude-custom/v1/chat/completions` - Claude Custom (OpenAI协议)
- `/claude-custom/v1/messages` - Claude Custom (Claude协议)
- `/claude-kiro-oauth/v1/chat/completions` - Claude Kiro OAuth (OpenAI协议)
- `/claude-kiro-oauth/v1/messages` - Claude Kiro OAuth (Claude协议)
- `/openai-custom/v1/chat/completions` - OpenAI Custom (OpenAI协议)
- `/openai-custom/v1/messages` - OpenAI Custom (Claude协议)

### 📜 实时日志
- 实时显示服务器输出日志
- 清空日志功能
- 自动滚动和手动滚动切换
- 日志缓冲区管理

### 🔔 通知系统
- 操作成功/失败提示
- 优雅的 Toast 通知
- 3秒自动消失

## 快速开始

### 启动服务器

服务器启动时会自动打开浏览器到管理控制台：

```bash
node src/api-server.js --port 3000 --api-key 123456
```

访问地址：http://127.0.0.1:3000/

### 界面导航

1. **仪表盘** - 系统概览、统计信息和路径路由示例
2. **配置管理** - 修改服务器配置和提供商设置
3. **提供商池管理** - 管理多个API提供商账户
4. **上传配置管理** - 管理配置文件和搜索过滤
5. **实时日志** - 查看服务器运行日志

## API 端点

管理控制台使用以下 RESTful API 端点：

### 配置管理
- `GET /api/config` - 获取当前配置
- `POST /api/config` - 更新配置
- `GET /api/configs` - 获取配置文件列表
- `POST /api/configs/search` - 搜索配置文件

### 系统信息
- `GET /api/system` - 获取系统信息
- `GET /api/providers` - 获取提供商池信息

### 实时数据
- `GET /api/events` - Server-Sent Events 流，用于实时更新

### 静态文件
- `GET /` - 主页面
- `GET /index.html` - HTML页面
- `GET /app/styles.css` - 样式文件
- `GET /app/mobile.css` - 移动端样式
- `GET /app/app.js` - JavaScript主逻辑
- `GET /app/utils.js` - 工具函数
- `GET /app/config-manager.js` - 配置管理
- `GET /app/provider-manager.js` - 提供商管理
- `GET /app/event-stream.js` - 事件流处理
- `GET /app/event-handlers.js` - 事件处理器
- `GET /app/navigation.js` - 导航逻辑
- `GET /app/modal.js` - 模态框组件
- `GET /app/file-upload.js` - 文件上传
- `GET /app/upload-config-manager.js` - 上传配置管理
- `GET /app/routing-examples.js` - 路由示例
- `GET /app/constants.js` - 常量定义

## 技术实现

### 前端技术栈
- **HTML5** - 语义化结构，支持无障碍访问
- **CSS3** - 现代化样式（CSS Variables、Flexbox、Grid）
- **JavaScript (ES6+)** - 模块化交互逻辑
- **Server-Sent Events** - 实时数据推送
- **Font Awesome 6.4.0** - 图标库

### 后端集成
- 集成到现有 `api-server.js` 中
- 零额外依赖
- ES 模块语法
- 异步处理

### 实时通信
使用 Server-Sent Events 实现实时双向通信：
- 自动广播日志到所有连接的客户端
- 每5秒发送统计更新
- 轻量级实现，无需 WebSocket

## 文件结构

```
static/
├── index.html              # 主页面
└── app/
    ├── styles.css          # 主样式文件
    ├── mobile.css          # 移动端样式
    ├── app.js              # 主应用逻辑
    ├── constants.js        # 常量定义
    ├── utils.js            # 工具函数
    ├── config-manager.js   # 配置管理
    ├── provider-manager.js # 提供商管理
    ├── upload-config-manager.js # 上传配置管理
    ├── event-stream.js     # 事件流处理
    ├── event-handlers.js   # 事件处理器
    ├── navigation.js       # 导航逻辑
    ├── modal.js           # 模态框组件
    ├── file-upload.js     # 文件上传
    └── routing-examples.js # 路由示例
```

## 支持的提供商

### 突破限制类型
- **Gemini CLI OAuth** - 通过OAuth突破Gemini API限制
- **Claude Kiro OAuth** - 免费使用的Claude服务
- **Qwen OAuth** - 通义千问OAuth认证

### 官方API/三方类型
- **OpenAI Custom** - 自定义OpenAI API端点
- **Claude Custom** - 自定义Claude API端点
- **OpenAI Responses** - OpenAI最新版本API

## 浏览器兼容性

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## 常见问题

### Q: 服务器启动后浏览器没有自动打开？
A: 检查是否使用 localhost 或 127.0.0.1 启动服务器。自动打开仅在本地部署时启用。

### Q: 如何使用路径路由功能？
A: 在仪表盘的"路径路由调用示例"中，查看不同提供商的使用示例。修改客户端的API端点URL即可切换不同的AI模型。

### Q: 如何配置OAuth提供商？
A: 在配置管理页面选择对应的OAuth提供商，填写项目ID和OAuth凭据（支持文件路径或Base64编码）。

### Q: 上传配置文件有什么作用？
A: 上传配置文件可以将本地配置文件上传到服务器，方便管理和在不同环境间同步配置。

### Q: 如何查看更详细的提供商信息？
A: 在"提供商池"页面可以看到每个提供商的使用次数、错误次数、最后使用时间等详细信息。

### Q: 配置修改后需要重启服务器吗？
A: 大部分配置（如系统提示、API密钥）会立即生效，但网络端口等更改需要重启服务器。

### Q: 支持哪些客户端配置？
A: 支持Cherry-Studio、NextChat、Cline等主流AI客户端，只需将API端点设置为对应的路由路径即可。

## 路由使用指南

### 1. 选择提供商
根据需要访问的AI模型选择对应的提供商路径。

### 2. 选择协议格式
- **OpenAI协议**：使用 `/v1/chat/completions` 端点
- **Claude协议**：使用 `/v1/messages` 端点

### 3. 配置客户端
在AI客户端中设置：
- **API端点**：`http://localhost:3000/{提供商路径}/{协议路径}`
- **API密钥**：对应提供商的密钥
- **模型名称**：使用提供商支持的具体模型

### 4. 发送请求
使用对应的协议格式发送请求，可以实现跨协议调用。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个管理控制台！

## 许可证

本项目使用与主项目相同的许可证。
