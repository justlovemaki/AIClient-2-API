<div align="center">

<img src="src/img/logo-mid.webp" alt="logo"  style="width: 128px; height: 128px;margin-bottom: 3px;">

# AIClient-2-API 🚀

**一个能将多种仅客户端内使用的大模型 API（Gemini CLI, Antigravity, Qwen Code, Kiro ...），模拟请求，统一封装为本地 OpenAI 兼容接口的强大代理。**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-≥20.0.0-blue.svg)](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
[![GitHub stars](https://img.shields.io/github/stars/justlovemaki/AIClient-2-API.svg?style=flat&label=Star)](https://github.com/justlovemaki/AIClient-2-API/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/justlovemaki/AIClient-2-API.svg)](https://github.com/justlovemaki/AIClient-2-API/issues)

[**🔧 OpenClaw 配置**](./docs/OPENCLAW_CONFIG_GUIDE-ZH.md) | [**👉 中文**](./README-ZH.md) | [English](./README.md) | [日本語](./README-JA.md) | [**📚 完整文档**](https://aiproxy.justlikemaki.vip/zh/)

</div>

`AIClient2API` 是一个突破客户端限制的 API 代理服务，将 Gemini、Antigravity、Qwen Code、Kiro 等原本仅限客户端内使用的免费大模型，转换为可供任何应用调用的标准 OpenAI 兼容接口。基于 Node.js 构建，支持 OpenAI、Claude、Gemini 三大协议的智能互转，让 Cherry-Studio、NextChat、Cline 等工具能够免费大量使用 Claude Opus 4.5、Gemini 3.0 Pro、Qwen3 Coder Plus 等高级模型。项目采用策略模式和适配器模式的模块化架构，内置账号池管理、智能轮询、自动故障转移和健康检查机制，确保 99.9% 的服务可用性。

> [!NOTE]
> **🎉 重要里程碑**
>
> - 感谢阮一峰老师在 [周刊 359 期](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html) 的推荐
>
> **📅 版本更新日志**
>
> <details>
> <summary>点击展开查看详细版本历史</summary>
>
> - **2026.01.26** - 新增 Codex 协议支持：支持 OpenAI Codex OAuth 授权接入
> - **2026.01.25** - 增强 AI 监控插件：支持监控 AI 协议转换前后的请求参数和响应。优化日志管理：统一日志格式，可视化配置
> - **2026.01.15** - 优化提供商池管理器：新增异步刷新队列机制、缓冲队列去重、全局并发控制，支持节点预热和自动过期检测
> - **2026.01.07** - 新增 iFlow 协议支持，通过 OAuth 认证方式访问 Qwen、Kimi、DeepSeek 和 GLM 系列模型，支持自动 token 刷新功能
> - **2026.01.03** - 新增主题切换功能并优化提供商池初始化，移除使用提供商默认配置的降级策略
> - **2025.12.30** - 添加主进程管理和自动更新功能
> - **2025.12.25** - 配置文件统一管理：所有配置集中到 `configs/` 目录，Docker 用户需更新挂载路径为 `-v "本地路径:/app/configs"`
> - **2025.12.11** - Docker 镜像自动构建并发布到 Docker Hub: [justlikemaki/aiclient-2-api](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
> - **2025.11.30** - 新增 Antigravity 协议支持，支持通过 Google 内部接口访问 Gemini 3 Pro、Claude Sonnet 4.5 等模型
> - **2025.11.16** - 新增 Ollama 协议支持，统一接口访问所有支持的模型（Claude、Gemini、Qwen、OpenAI等）
> - **2025.11.11** - 新增 Web UI 管理控制台，支持实时配置管理和健康状态监控
> - **2025.11.06** - 新增对 Gemini 3 预览版的支持，增强模型兼容性和性能优化
> - **2025.10.18** - Kiro 开放注册，新用户赠送 500 额度，已完整支持 Claude Sonnet 4.5
> - **2025.09.01** - 集成 Qwen Code CLI，新增 `qwen3-coder-plus` 模型支持
> - **2025.08.29** - 发布账号池管理功能，支持多账号轮询、智能故障转移和自动降级策略
>   - 配置方式：在 `configs/config.json` 中添加 `PROVIDER_POOLS_FILE_PATH` 参数
>   - 参考配置：[provider_pools.json](./configs/provider_pools.json.example)
> - **历史已开发**
>   - 支持 Gemini CLI、Kiro 等客户端2API
>   - OpenAI ,Claude ,Gemini 三协议互转，自动智能切换
> </details>
---

## 💡 核心优势

### 🎯 统一接入，一站式管理
*   **多模型统一接口**：通过标准 OpenAI 兼容协议，一次配置即可接入 Gemini、Claude、Qwen Code、Kimi K2、MiniMax M2 等主流大模型
*   **灵活切换机制**：Path 路由、支持通过启动参数、环境变量三种方式动态切换模型，满足不同场景需求
*   **零成本迁移**：完全兼容 OpenAI API 规范，Cherry-Studio、NextChat、Cline 等工具无需修改即可使用
*   **多协议智能转换**：支持 OpenAI、Claude、Gemini 三大协议间的智能转换，实现跨协议模型调用

### 🚀 突破限制，提升效率
*   **绕过官方限制**：利用 OAuth 授权机制，有效突破 Gemini, Antigravity 等服务的免费 API 速率和配额限制
*   **免费高级模型**：通过 Kiro API 模式免费使用 Claude Opus 4.5，通过 Qwen OAuth 模式使用 Qwen3 Coder Plus，降低使用成本
*   **账号池智能调度**：支持多账号轮询、自动故障转移和配置降级，确保 99.9% 服务可用性

### 🛡️ 安全可控，数据透明
*   **全链路日志记录**：捕获所有请求和响应数据，支持审计、调试
*   **私有数据集构建**：基于日志数据快速构建专属训练数据集
*   **系统提示词管理**：支持覆盖和追加两种模式，实现统一基础指令与个性化扩展的完美结合

### 🔧 开发友好，易于扩展
*   **Web UI 管理控制台**：实时配置管理、健康状态监控、API 测试和日志查看
*   **模块化架构**：基于策略模式和适配器模式，新增模型提供商仅需 3 步
*   **完整测试保障**：集成测试和单元测试覆盖率 90%+，确保代码质量
*   **容器化部署**：提供 Docker 支持，一键部署，跨平台运行

---

## 📑 快速导航

- [💡 核心优势](#-核心优势)
- [🚀 快速启动](#-快速启动)
  - [🐳 Docker 部署](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
  - [📋 核心功能](#-核心功能)
- [🔐 授权配置指南](#-授权配置指南)
- [📁 授权文件存储路径](#-授权文件存储路径)
- [🦙 Ollama 协议使用示例](#-ollama-协议使用示例)
- [⚙️ 高级配置](#高级配置)
- [❓ 常见问题](#-常见问题)
- [📄 开源许可](#-开源许可)
- [🙏 致谢](#-致谢)
- [⚠️ 免责声明](#️-免责声明)

---

## 🔧 使用说明

### 🚀 快速启动

使用 AIClient-2-API 最推荐的方式是通过自动化脚本启动，并直接在 **Web UI 控制台** 进行可视化配置。

#### 🐳 Docker 快捷启动 (推荐)

```bash
docker run -d -p 3000:3000 -p 8085-8087:8085-8087 -p 1455:1455 -p 19876-19880:19876-19880 --restart=always -v "指定路径:/app/configs" --name aiclient2api justlikemaki/aiclient-2-api
```

**参数说明**：
- `-d`：后台运行容器
- `-p 3000:3000 ...`：端口映射。3000 为 Web UI，其余为 OAuth 回调端口（Gemini: 8085, Antigravity: 8086, iFlow: 8087, Codex: 1455, Kiro: 19876-19880）
- `--restart=always`：容器自动重启策略
- `-v "指定路径:/app/configs"`：挂载配置目录（请将"指定路径"替换为实际路径，如 `/home/user/aiclient-configs`）
- `--name aiclient2api`：容器名称

#### 🐳 Docker Compose 部署

你也可以使用 Docker Compose 进行部署。首先，进入 `docker` 目录：

```bash
cd docker
mkdir -p configs
docker compose up -d
```

如需从源码构建而非使用预构建镜像，请编辑 `docker-compose.yml`：
1. 注释掉 `image: justlikemaki/aiclient-2-api:latest` 行
2. 取消 `build:` 部分的注释
3. 运行 `docker compose up -d --build`

#### 1. 运行启动脚本
*   **Linux/macOS**: `chmod +x install-and-run.sh && ./install-and-run.sh`
*   **Windows**: 双击运行 `install-and-run.bat`

#### 2. 访问控制台
服务器启动后，打开浏览器访问：
👉 [**http://localhost:3000**](http://localhost:3000)

> **默认密码**: `admin123` (登录后可在控制台或修改 `pwd` 文件变更)

#### 3. 可视化配置 (推荐)
进入 **"配置管理"** 页面，您可以直接：
*   ✅ 填入各提供商的 API Key 或上传 OAuth 凭据文件
*   ✅ 实时切换默认模型提供商
*   ✅ 监控健康状态和实时请求日志

#### 脚本执行示例
```
========================================
  AI Client 2 API 快速安装启动脚本
========================================

[检查] 正在检查Node.js是否已安装...
✅ Node.js已安装，版本: v20.10.0
✅ 找到package.json文件
✅ node_modules目录已存在
✅ 项目文件检查完成

========================================
  启动AI Client 2 API服务器...
========================================

🌐 服务器将在 http://localhost:3000 启动
📖 访问 http://localhost:3000 查看管理界面
⏹️  按 Ctrl+C 停止服务器
```

> **💡 提示**：脚本会自动安装依赖并启动服务器。如果遇到任何问题，脚本会提供清晰的错误信息和解决建议。

---

### 📋 核心功能

#### Web UI 管理控制台

![Web UI](src/img/zh.png)

功能完善的 Web 管理界面，包含：

**📊 仪表盘**：系统概览、交互式路由示例、客户端配置指南

**⚙️ 配置管理**：实时参数修改，支持所有提供商（Gemini、Antigravity、OpenAI、Claude、Kiro、Qwen），包含高级设置和文件上传

**🔗 提供商池**：监控活动连接、提供商健康统计、启用/禁用管理

**📁 配置文件**：OAuth 凭据集中管理，支持搜索过滤和文件操作

**📜 实时日志**：系统日志和请求日志实时显示，带管理控制

**🔐 登录验证**：默认密码 `admin123`，可通过 `pwd` 文件修改

访问：`http://localhost:3000` → 登录 → 侧边栏导航 → 立即生效

#### 多模态输入能力
支持图片、文档等多种类型的输入，为您提供更丰富的交互体验和更强大的应用场景。

#### 最新模型支持
无缝支持以下最新大模型，仅需在 Web UI 或 [`configs/config.json`](./configs/config.json) 中配置相应的端点：
*   **Claude 4.5 Opus** - Anthropic 史上最强模型，现已通过 Kiro, Antigravity 支持
*   **Gemini 3 Pro** - Google 下一代架构预览版，现已通过 Gemini, Antigravity 支持
*   **Qwen3 Coder Plus** - 阿里通义千问最新代码专用模型，现已通过Qwen Code 支持
*   **Kimi K2 / MiniMax M2** - 国内顶级旗舰模型同步支持，现已通过自定义OpenAI，Claude 支持

---

### 🔐 授权配置指南

<details>
<summary>点击展开查看各提供商授权配置详细步骤</summary>

> **💡 提示**：为了获得最佳体验，建议通过 **Web UI 控制台** 进行可视化授权管理。

#### 🌐 Web UI 快捷授权 (推荐)
在 Web UI 管理界面中，您可以极速完成授权配置：
1. **生成授权**：在 **“提供商池”** 页面或**“配置管理”** 页面，点击对应提供商（如 Gemini, Qwen）右上角的 **“生成授权”** 按钮。
2. **扫码/登录**：系统将弹出授权对话框，您可以点击 **“在浏览器中打开”** 进行登录验证。对于 Qwen，只需完成网页登录；对于 Gemini，Antigravity 需完成 Google 账号授权。
3. **自动保存**：授权成功后，系统会自动获取凭据并保存至 `configs/` 对应目录下，您可以在 **“配置文件”** 页面看到新生成的凭据。
4. **可视化管理**：您可以随时在 Web UI 中上传、删除凭据，或通过 **“快速关联”** 功能将已有的凭据文件一键绑定到提供商。

#### Gemini CLI OAuth 配置
1. **获取OAuth凭据**：访问 [Google Cloud Console](https://console.cloud.google.com/) 创建项目，启用Gemini API
2. **项目配置**：可能需要提供有效的Google Cloud项目ID，可通过启动参数 `--project-id` 指定
3. **确保项目ID**：在 Web UI 中配置时，确保输入的项目ID与 Google Cloud Console 和 Gemini CLI 中显示的项目ID一致。

#### Antigravity OAuth 配置
1. **个人账号**：个人账号需要单独授权，已关闭申请渠道。
2. **Pro会员**：Antigravity 暂时对 Pro 会员开放，需要先购买 Pro 会员。
3. **组织账号**：组织账号需要单独授权，联系管理员获取授权。

#### Qwen Code OAuth 配置
1. **首次授权**：配置Qwen服务后，系统会自动在浏览器中打开授权页面
2. **推荐参数**：使用官方默认参数以获得最佳效果
   ```json
   {
     "temperature": 0,
     "top_p": 1
   }
   ```

#### Kiro API 配置
1. **环境准备**：[下载并安装 Kiro 客户端](https://kiro.dev/pricing/)
2. **完成授权**：在客户端中登录账号，生成 `kiro-auth-token.json` 凭据文件
3. **最佳实践**：推荐配合 **Claude Code** 使用，可获得最优体验
4. **重要提示**：Kiro 服务使用政策已更新，请访问官方网站查看最新使用限制和条款

#### Kiro 扩展思考 (Claude 模型)
AIClient-2-API 在使用路由到 `claude-kiro-oauth` 的 Claude 兼容请求 (`/v1/messages`) 或 OpenAI 兼容请求 (`/v1/chat/completions`) 时支持 Kiro 扩展思考。

**Claude 兼容接口 (`/v1/messages`)**:
```bash
curl http://localhost:3000/claude-kiro-oauth/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "thinking": { "type": "enabled", "budget_tokens": 10000 },
    "messages": [{ "role": "user", "content": "逐步解决这个问题。" }]
  }'
```

**OpenAI 兼容接口 (`/v1/chat/completions`)**:
```bash
curl http://localhost:3000/claude-kiro-oauth/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [{ "role": "user", "content": "逐步解决这个问题。" }],
    "extra_body": {
      "anthropic": {
        "thinking": { "type": "enabled", "budget_tokens": 10000 }
      }
    }
  }'
```

**自适应模式**:
- Claude: `"thinking": { "type": "adaptive", "effort": "high" }`
- OpenAI: `"extra_body.anthropic.thinking": { "type": "adaptive", "effort": "high" }`

注意：
- `budget_tokens` 被限制在 `[1024, 24576]` 之间（如果省略或无效，默认值为 `20000`）。
- Token 获取/刷新/池轮换机制保持不变。

#### iFlow OAuth 配置
1. **首次授权**：在 Web UI 的"配置管理"或"提供商池"页面，点击 iFlow 的"生成授权"按钮
2. **手机登录**：系统将打开 iFlow 授权页面，使用手机号完成登录验证
3. **自动保存**：授权成功后，系统会自动获取 API Key 并保存凭据
4. **支持模型**：Qwen3 系列、Kimi K2、DeepSeek V3/R1、GLM-4.6/4.7 等
5. **自动刷新**：系统会在 Token 即将过期时自动刷新，无需手动干预

#### Codex OAuth 配置
1. **生成授权**：在 Web UI 的"提供商池"或"配置管理"页面，点击 Codex 的"生成授权"按钮
2. **浏览器登录**：系统将打开 OpenAI Codex 授权页面，完成 OAuth 登录
3. **自动保存**：授权成功后，系统会自动保存 Codex 的 OAuth 凭据文件
4. **回调端口**：确保 OAuth 回调端口 `1455` 未被占用

#### 账号池管理配置
1. **创建号池配置文件**：参考 [provider_pools.json.example](./configs/provider_pools.json.example) 创建配置文件
2. **配置号池参数**：在 `configs/config.json` 中设置 `PROVIDER_POOLS_FILE_PATH` 指向号池配置文件
3. **启动参数配置**：使用 `--provider-pools-file <path>` 参数指定号池配置文件路径
4. **健康检查**：系统会定期自动执行健康检查，不使用不健康的提供商

</details>

### 📁 授权文件存储路径

<details>
<summary>点击展开查看各服务授权凭据的默认存储位置</summary>

各服务的授权凭据文件默认存储位置：

| 服务 | 默认路径 | 说明 |
|------|---------|------|
| **Gemini** | `~/.gemini/oauth_creds.json` | OAuth 认证凭据 |
| **Kiro** | `~/.aws/sso/cache/kiro-auth-token.json` | Kiro 认证令牌 |
| **Qwen** | `~/.qwen/oauth_creds.json` | Qwen OAuth 凭据 |
| **Antigravity** | `~/.antigravity/oauth_creds.json` | Antigravity OAuth 凭据 (支持 Claude 4.5 Opus) |
| **iFlow** | `~/.iflow/oauth_creds.json` | iFlow OAuth 凭据 (支持 Qwen、Kimi、DeepSeek、GLM) |
| **Codex** | `~/.codex/oauth_creds.json` | Codex OAuth 凭据 |

> **说明**：`~` 表示用户主目录（Windows: `C:\Users\用户名`，Linux/macOS: `/home/用户名` 或 `/Users/用户名`）

> **自定义路径**：可通过配置文件中的相关参数或环境变量指定自定义存储位置

</details>

---

### 🦙 Ollama 协议使用示例

本项目支持 Ollama 协议，可以通过统一接口访问所有支持的模型。Ollama 端点提供 `/api/tags`、`/api/chat`、`/api/generate` 等标准接口。

**Ollama API 调用示例**：

1. **列出所有可用模型**：
```bash
curl http://localhost:3000/ollama/api/tags \
  -H "Authorization: Bearer your-api-key"
```

2. **聊天接口**：
```bash
curl http://localhost:3000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "[Claude] claude-sonnet-4.5",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

3. **使用模型前缀指定提供商**：
- `[Kiro]` - 使用 Kiro API 访问 Claude 模型
- `[Claude]` - 使用 Claude 官方 API
- `[Gemini CLI]` - 通过 Gemini CLI OAuth 访问
- `[OpenAI]` - 使用 OpenAI 官方 API
- `[Qwen CLI]` - 通过 Qwen OAuth 访问

---

### 高级配置

<details>
<summary>点击展开查看代理配置、模型过滤及 Fallback 等高级设置</summary>

#### 1. 代理配置

本项目支持灵活的代理配置，可以为不同的提供商配置统一代理或使用提供商自带的已代理端点。

**配置方式**：

1. **Web UI 配置**（推荐）：便捷的配置管理

  在 Web UI 的"配置管理"页面中，可以可视化配置所有代理选项：
  - **统一代理**：在"代理设置"区域填入代理地址，勾选需要使用代理的提供商
  - **提供商端点**：在各提供商配置区域，直接修改 Base URL 为已代理的端点
  - **点击"保存配置"**：即可生效，无需重启服务

2. **统一代理配置**：配置全局代理，并指定哪些提供商使用该代理

   - **Web UI 配置**：在"配置管理"页面的"代理设置"区域填入代理地址，勾选需要使用代理的提供商
   - **配置文件**：在 `configs/config.json` 中配置
   ```json
   {
     "PROXY_URL": "http://127.0.0.1:7890",
     "PROXY_ENABLED_PROVIDERS": [
       "gemini-cli-oauth",
       "gemini-antigravity",
       "claude-kiro-oauth"
     ]
   }
   ```

3. **提供商自带代理端点**：某些提供商（如 OpenAI、Claude）支持配置已代理的 API 端点

   - **Web UI 配置**：在"配置管理"页面的各提供商配置区域，修改对应的 Base URL
   - **配置文件**：在 `configs/config.json` 中配置
   ```json
   {
     "OPENAI_BASE_URL": "https://your-proxy-endpoint.com/v1",
     "CLAUDE_BASE_URL": "https://your-proxy-endpoint.com"
   }
   ```

**代理类型支持**：
- **HTTP 代理**：`http://127.0.0.1:7890`
- **HTTPS 代理**：`https://127.0.0.1:7890`
- **SOCKS5 代理**：`socks5://127.0.0.1:1080`

**使用场景**：
- **网络受限环境**：在无法直接访问 Google、OpenAI 等服务的网络环境中使用
- **混合配置**：部分提供商使用统一代理，部分使用自带的已代理端点
- **灵活切换**：可以随时在 Web UI 中启用/禁用特定提供商的代理

**注意事项**：
- 代理配置优先级：统一代理配置 > 提供商自带端点 > 直接连接
- 确保代理服务稳定可用，否则可能影响服务质量
- SOCKS5 代理通常比 HTTP 代理性能更好

#### 2. 模型过滤配置

支持通过 `notSupportedModels` 配置排除不支持的模型，系统会自动跳过这些提供商。

**配置方式**：在 `configs/provider_pools.json` 中为提供商添加 `notSupportedModels` 字段：

```json
{
  "gemini-cli-oauth": [
    {
      "uuid": "provider-1",
      "notSupportedModels": ["gemini-3.0-pro", "gemini-3.5-flash"],
      "checkHealth": true
    }
  ]
}
```

**工作原理**：
- 当请求特定模型时，系统会自动过滤掉配置了该模型为不支持的提供商
- 只有支持该模型的提供商才会被选中处理请求

**使用场景**：
- 某些账号因配额或权限限制无法访问特定模型
- 需要为不同账号分配不同的模型访问权限

#### 3. 提供商优先级配置

支持通过 `provider_pools.json` 中每个节点的 `priority` 字段实现确定的账号排序。

**配置方式**（数字越小，优先级越高）：

```json
{
  "claude-kiro-oauth": [
    {
      "uuid": "primary-node-uuid",
      "priority": 1,
      "checkHealth": true
    },
    {
      "uuid": "backup-node-uuid",
      "priority": 2,
      "checkHealth": true
    }
  ]
}
```

**工作原理**：
- 池管理器首先按最低 `priority` 值过滤健康/可用的节点
- 只有处于该最高优先级层级的节点才会参与基于 LRU/评分的负载均衡
- 如果整个最高优先级层级不可用，系统将自动使用下一个优先级层级
- 如果省略 `priority` 或其无效，将应用默认值 `100`（向后兼容行为）

#### 4. 跨类型 Fallback 配置

当某一 Provider Type（如 `gemini-cli-oauth`）下的所有账号都因 429 配额耗尽或被标记为 unhealthy 时，系统能够自动 fallback 到另一个兼容的 Provider Type（如 `gemini-antigravity`），而不是直接返回错误。

**配置方式**：在 `configs/config.json` 中添加 `providerFallbackChain` 配置：

```json
{
  "providerFallbackChain": {
    "gemini-cli-oauth": ["gemini-antigravity"],
    "gemini-antigravity": ["gemini-cli-oauth"],
    "claude-kiro-oauth": ["claude-custom"],
    "claude-custom": ["claude-kiro-oauth"]
  }
}
```

**工作原理**：
1. 尝试从主 Provider Type 池选取 healthy 账号
2. 如果该类型所有账号都 unhealthy：
   - 查找配置的 fallback 类型
   - 检查 fallback 类型是否支持当前请求的模型（协议兼容性检查）
   - 从 fallback 类型的池中选取 healthy 账号
3. 支持多级降级链：`gemini-cli-oauth → gemini-antigravity → openai-custom`
4. 如果所有 fallback 类型也不可用，才返回错误

**使用场景**：
- 批量任务场景下，单一 Provider Type 的免费 RPD 配额容易在短时间内耗尽
- 通过跨类型 Fallback，可以充分利用多种 Provider 的独立配额，提高整体可用性和吞吐量

**注意事项**：
- Fallback 只会在协议兼容的类型之间进行（如 `gemini-*` 之间、`claude-*` 之间）
- 系统会自动检查目标 Provider Type 是否支持当前请求的模型

</details>

---

## ❓ 常见问题

<details>
<summary>点击展开查看常见问题及解决方案（端口占用、Docker 启动、429 错误等）</summary>

### 1. OAuth 授权失败

**问题描述**：点击"生成授权"后，浏览器打开授权页面但授权失败或无法完成。

**解决方案**：
- **检查网络连接**：确保能够正常访问 Google、阿里云等服务
- **检查端口占用**：OAuth 回调需要特定端口（Gemini: 8085, Antigravity: 8086, iFlow: 8087, Codex: 1455, Kiro: 19876-19880），确保这些端口未被占用
- **清除浏览器缓存**：尝试使用无痕模式或清除浏览器缓存后重试
- **检查防火墙设置**：确保防火墙允许本地回调端口的访问
- **Docker 用户**：确保已正确映射所有 OAuth 回调端口

### 2. 端口被占用

**问题描述**：启动服务时提示端口已被占用（如 `EADDRINUSE`）。

**解决方案**：
```bash
# Windows - 查找占用端口的进程
netstat -ano | findstr :3000
# 然后使用任务管理器结束对应 PID 的进程

# Linux/macOS - 查找并结束占用端口的进程
lsof -i :3000
kill -9 <PID>
```

或者修改 `configs/config.json` 中的端口配置使用其他端口。

### 3. Docker 容器无法启动

**问题描述**：Docker 容器启动失败或立即退出。

**解决方案**：
- **检查日志**：`docker logs aiclient2api` 查看错误信息
- **检查挂载路径**：确保 `-v` 参数中的本地路径存在且有读写权限
- **检查端口冲突**：确保所有映射的端口在宿主机上未被占用
- **重新拉取镜像**：`docker pull justlikemaki/aiclient-2-api:latest`

### 4. 凭据文件无法识别

**问题描述**：上传或配置凭据文件后，系统提示无法识别或格式错误。

**解决方案**：
- **检查文件格式**：确保凭据文件是有效的 JSON 格式
- **检查文件路径**：确保文件路径正确，Docker 用户需确保文件在挂载目录内
- **检查文件权限**：确保服务有权限读取凭据文件
- **重新生成凭据**：如果凭据已过期，尝试重新进行 OAuth 授权

### 5. 请求返回 429 错误

**问题描述**：API 请求频繁返回 429 Too Many Requests 错误。

**解决方案**：
- **配置账号池**：添加多个账号到 `provider_pools.json`，启用轮询机制
- **配置 Fallback**：在 `config.json` 中配置 `providerFallbackChain`，实现跨类型降级
- **降低请求频率**：适当增加请求间隔，避免触发速率限制
- **等待配额重置**：免费配额通常每日或每分钟重置

### 6. 模型不可用或返回错误

**问题描述**：请求特定模型时返回错误或提示模型不可用。

**解决方案**：
- **检查模型名称**：确保使用正确的模型名称（区分大小写）
- **检查提供商支持**：确认当前配置的提供商支持该模型
- **检查账号权限**：某些高级模型可能需要特定账号权限
- **配置模型过滤**：使用 `notSupportedModels` 排除不支持的模型

### 7. Web UI 无法访问

**问题描述**：浏览器无法打开 `http://localhost:3000`。

**解决方案**：
- **检查服务状态**：确认服务已成功启动，查看终端输出
- **检查端口映射**：Docker 用户确保 `-p 3000:3000` 参数正确
- **尝试其他地址**：尝试访问 `http://127.0.0.1:3000`
- **检查防火墙**：确保防火墙允许 3000 端口的访问

### 8. 流式响应中断

**问题描述**：使用流式输出时，响应中途中断或不完整。

**解决方案**：
- **检查网络稳定性**：确保网络连接稳定
- **增加超时时间**：在客户端配置中增加请求超时时间
- **检查代理设置**：如使用代理，确保代理支持长连接
- **查看服务日志**：检查是否有错误信息

### 9. 配置修改不生效

**问题描述**：在 Web UI 中修改配置后，服务行为未改变。

**解决方案**：
- **刷新页面**：修改后刷新 Web UI 页面
- **检查保存状态**：确认配置已成功保存（查看提示信息）
- **重启服务**：某些配置可能需要重启服务才能生效
- **检查配置文件**：直接查看 `configs/config.json` 确认修改已写入

### 10. 访问接口返回 404

**问题描述**：调用 API 接口时返回 404 Not Found 错误。

**解决方案**：
- **检查接口路径**：确保使用正确的接口路径，如 `/v1/chat/completions`、`/ollama/api/chat` 等
- **检查客户端自动补全**：某些客户端（如 Cherry-Studio、NextChat）会自动在 Base URL 后追加路径（如 `/v1/chat/completions`），导致路径重复。请查看控制台中的实际请求 URL，移除多余的路径部分
- **检查服务状态**：确认服务已正常启动，访问 `http://localhost:3000` 查看 Web UI
- **检查端口配置**：确保请求发送到正确的端口（默认 3000）
- **查看可用路由**：在 Web UI 仪表盘页面查看"交互式路由示例"了解所有可用接口

### 11. Unauthorized: API key is invalid or missing

**问题描述**：调用 API 接口时返回 `Unauthorized: API key is invalid or missing.` 错误。

**解决方案**：
- **检查 API Key 配置**：确保在 `configs/config.json` 或 Web UI 中正确配置API Key
- **检查请求头格式**：确保请求中包含正确格式的 Authorization 头，如 `Authorization: Bearer your-api-key`
- **查看服务日志**：在 Web UI 的"实时日志"页面查看详细错误信息，定位具体原因

### 12. No available and healthy providers for type

**问题描述**：调用 API 时返回 `No available and healthy providers for type xxx` 错误。

**解决方案**：
- **检查提供商状态**：在 Web UI 的"提供商池"页面查看对应类型的提供商是否处于健康状态
- **检查凭据有效性**：确认 OAuth 凭据未过期，如已过期需重新生成授权
- **检查配额限制**：某些提供商可能已达到免费配额上限，等待配额重置或添加更多账号
- **启用 Fallback**：在 `config.json` 中配置 `providerFallbackChain`，当主提供商不可用时自动切换到备用提供商
- **查看详细日志**：在 Web UI 的"实时日志"页面查看具体的健康检查失败原因

### 13. 请求返回 403 Forbidden 错误

**问题描述**：API 请求返回 403 Forbidden 错误。

**解决方案**：
- **检查节点状态**：如果在 Web UI 的"提供商池"页面中看到节点状态正常（健康检查通过），则可以忽略此报错，系统会自动处理
- **检查账号权限**：确认使用的账号有权限访问请求的模型或服务
- **检查 API Key 权限**：某些提供商的 API Key 可能有访问范围限制，确保 Key 有足够权限
- **检查地区限制**：部分服务可能有地区访问限制，尝试使用代理或 VPN
- **检查凭据状态**：OAuth 凭据可能已被撤销或失效，尝试重新生成授权
- **检查请求频率**：某些提供商对请求频率有严格限制，降低请求频率后重试
- **查看提供商文档**：访问对应提供商的官方文档，了解具体的访问限制和要求

</details>

---

## 📄 开源许可

本项目遵循 [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) 开源许可。详情请查看根目录下的 `LICENSE` 文件。
## 🙏 致谢

本项目的开发受到了官方 Google Gemini CLI 的极大启发，并参考了Cline 3.18.0 版本 `gemini-cli.ts` 的部分代码实现。在此对 Google 官方团队和 Cline 开发团队的卓越工作表示衷心的感谢！
### 贡献者列表

感谢以下所有为 AIClient-2-API 项目做出贡献的开发者：

[![Contributors](https://contrib.rocks/image?repo=justlovemaki/AIClient-2-API)](https://github.com/justlovemaki/AIClient-2-API/graphs/contributors)


### 🌟 Star History


[![Star History Chart](https://api.star-history.com/svg?repos=justlovemaki/AIClient-2-API&type=Timeline)](https://www.star-history.com/#justlovemaki/AIClient-2-API&Timeline)

---

## ⚠️ 免责声明

### 使用风险提示
本项目（AIClient-2-API）仅供学习和研究使用。用户在使用本项目时，应自行承担所有风险。作者不对因使用本项目而导致的任何直接、间接或 consequential 损失承担责任。

### 第三方服务责任说明
本项目是一个API代理工具，不提供任何AI模型服务。所有AI模型服务由相应的第三方提供商（如Google、OpenAI、Anthropic等）提供。用户在使用本项目访问这些第三方服务时，应遵守各第三方服务的使用条款和政策。作者不对第三方服务的可用性、质量、安全性或合法性承担责任。

### 数据隐私说明
本项目在本地运行，不会收集或上传用户的任何数据。但用户在使用本项目时，应注意保护自己的API密钥和其他敏感信息。建议用户定期检查和更新自己的API密钥，并避免在不安全的网络环境中使用本项目。

### 法律合规提醒
用户在使用本项目时，应遵守所在国家/地区的法律法规。严禁将本项目用于任何非法用途。如因用户违反法律法规而导致的任何后果，由用户自行承担全部责任。
