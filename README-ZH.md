<div align="center">

<img src="src/img/logo-min.webp" alt="logo"  style="width: 128px; height: 128px;margin-bottom: 3px;">

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

[**👉 中文**](./README-ZH.md) | [English](./README.md) | [日本語](./README-JA.md) | [**📚 完整文档**](https://aiproxy.justlikemaki.vip/zh/)

</div>

`AIClient2API` 是一个突破客户端限制的 API 代理服务，将 Gemini、Antigravity、Qwen Code、Kiro 等原本仅限客户端内使用的免费大模型，转换为可供任何应用调用的标准 OpenAI 兼容接口。基于 Node.js 构建，支持 OpenAI、Claude、Gemini 三大协议的智能互转，让 Cherry-Studio、NextChat、Cline 等工具能够免费大量使用 Claude Opus 4.5、Gemini 3.0 Pro、Qwen3 Coder Plus 等高级模型。项目采用策略模式和适配器模式的模块化架构，内置账号池管理、智能轮询、自动故障转移和健康检查机制，确保 99.9% 的服务可用性。

> [!NOTE]
> **🎉 重要里程碑**
>
> - 感谢阮一峰老师在 [周刊 359 期](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html) 的推荐
>
> **📅 版本更新日志**
>
> - **2025.12.11** - Docker 镜像自动构建并发布到 Docker Hub: [justlikemaki/aiclient-2-api](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
> - **2025.11.30** - 新增 Antigravity 协议支持，支持通过 Google 内部接口访问 Gemini 3 Pro、Claude Sonnet 4.5 等模型
> - **2025.11.16** - 新增 Ollama 协议支持，统一接口访问所有支持的模型（Claude、Gemini、Qwen、OpenAI等）
> - **2025.11.11** - 新增 Web UI 管理控制台，支持实时配置管理和健康状态监控
> - **2025.11.06** - 新增对 Gemini 3 预览版的支持，增强模型兼容性和性能优化
> - **2025.10.18** - Kiro 开放注册，新用户赠送 500 额度，已完整支持 Claude Sonnet 4.5
> - **2025.09.01** - 集成 Qwen Code CLI，新增 `qwen3-coder-plus` 模型支持
> - **2025.08.29** - 发布账号池管理功能，支持多账号轮询、智能故障转移和自动降级策略
>   - 配置方式：在 config.json 中添加 `PROVIDER_POOLS_FILE_PATH` 参数
>   - 参考配置：[provider_pools.json](./provider_pools.json.example)
> - **历史已开发**
>   - 支持 Gemini CLI、Kiro 等客户端2API
>   - OpenAI ,Claude ,Gemini 三协议互转，自动智能切换
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

- [🐳 Docker 部署](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
- [🔧 使用说明](#-使用说明)
- [📄 开源许可](#-开源许可)
- [🙏 致谢](#-致谢)
- [⚠️ 免责声明](#-免责声明)

---

## 🔧 使用说明

### 🚀 快速启动

使用 AIClient-2-API 最推荐的方式是通过自动化脚本启动，并直接在 **Web UI 控制台** 进行可视化配置。

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

![Web UI](src/img/web.png)

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
无缝支持以下最新大模型，仅需在 Web UI 或 [`config.json`](./config.json) 中配置相应的端点：
*   **Claude 4.5 Opus** - Anthropic 史上最强模型，现已通过 Kiro, Antigravity 支持
*   **Gemini 3 Pro** - Google 下一代架构预览版，现已通过 Gemini, Antigravity 支持
*   **Qwen3 Coder Plus** - 阿里通义千问最新代码专用模型，现已通过Qwen Code 支持
*   **Kimi K2 / MiniMax M2** - 国内顶级旗舰模型同步支持，现已通过自定义OpenAI，Claude 支持

---

### 🔐 授权配置指南

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

#### 账号池管理配置
1. **创建号池配置文件**：参考 [provider_pools.json.example](./provider_pools.json.example) 创建配置文件
2. **配置号池参数**：在 config.json 中设置 `PROVIDER_POOLS_FILE_PATH` 指向号池配置文件
3. **启动参数配置**：使用 `--provider-pools-file <path>` 参数指定号池配置文件路径
4. **健康检查**：系统会定期自动执行健康检查，不使用不健康的提供商

---

### 📁 授权文件存储路径

各服务的授权凭据文件默认存储位置：

| 服务 | 默认路径 | 说明 |
|------|---------|------|
| **Gemini** | `~/.gemini/oauth_creds.json` | OAuth 认证凭据 |
| **Kiro** | `~/.aws/sso/cache/kiro-auth-token.json` | Kiro 认证令牌 |
| **Qwen** | `~/.qwen/oauth_creds.json` | Qwen OAuth 凭据 |
| **Antigravity** | `~/.antigravity/oauth_creds.json` | Antigravity OAuth 凭据 (支持 Claude 4.5 Opus) |

> **说明**：`~` 表示用户主目录（Windows: `C:\Users\用户名`，Linux/macOS: `/home/用户名` 或 `/Users/用户名`）
>
> **自定义路径**：可通过配置文件中的相关参数或环境变量指定自定义存储位置

---

### 🦙 Ollama 协议使用示例

本项目支持 Ollama 协议，可以通过统一接口访问所有支持的模型。Ollama 端点提供 `/api/tags`、`/api/chat`、`/api/generate` 等标准接口。

**Ollama API 调用示例**：

1. **列出所有可用模型**：
```bash
curl http://localhost:3000/ollama/api/tags
```

2. **聊天接口**：
```bash
curl http://localhost:3000/ollama/api/chat \
  -H "Content-Type: application/json" \
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
