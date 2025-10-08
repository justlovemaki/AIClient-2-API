<div align="center">

![logo](src/img/logo-min.webp)

# AIClient-2-API 🚀

**一个能将多种仅客户端内使用的大模型 API（Gemini CLI, Qwen Code Plus, Kiro Claude...），模拟请求，统一封装为本地 OpenAI 兼容接口的强大代理。**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![docker](https://img.shields.io/badge/docker-≥20.0.0-green.svg)](https://aiproxy.justlikemaki.vip/zh/docs/installation/docker-deployment.html)


[**中文**](./README.md) | [**English**](./README-EN.md) | [**日本語**](./README-JA.md) | [**更详细文档**](https://aiproxy.justlikemaki.vip/)

</div>

`AIClient2API` 是一个专为开发者打造的多功能、轻量化 API 代理，旨在提供大量免费的 API 请求额度，全面支持 Gemini、Qwen Code、Claude 等主流大模型。通过一个 Node.js HTTP 服务器，它将多种后端 API 统一转换为标准的 OpenAI 格式接口。项目采用现代化的模块化架构，支持策略模式和适配器模式，具备完整的测试覆盖和健康检查机制，开箱即用，`npm install` 后即可直接运行。您只需在配置文件中轻松切换模型服务商，就能让任何兼容 OpenAI 的客户端或应用，通过同一个 API 地址，无缝地使用不同的大模型能力，彻底摆脱为不同服务维护多套配置和处理接口不兼容问题的烦恼。

> [!NOTE]
> 感谢阮一峰老师在[周刊359期](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html)的推荐。
>
> 8.29 新增账号池模式，可支持所有provider配置多个账号，自带轮询，故障转移（需要客户端重试）和配置降级。需要在 config 新增配置 PROVIDER_POOLS_FILE_PATH ， 详见配置文件：provider_pools.json
>
> 9.1  偷摸的新增 Qwen Code CLI 支持，可使用 qwen3-coder-plus 模型

---

## 💡 核心优势

*   ✅ **多模型统一接入**：一个接口，通吃 Gemini、OpenAI、Claude、Kimi K2、GLM-4.5、Qwen Code 等多种最新模型。通过简单的启动参数或请求头，即可在不同模型服务商之间自由切换。
*   ✅ **突破官方限制**：通过支持 Gemini CLI 的 OAuth 授权方式，有效绕过官方免费 API 的速率和配额限制，让您享受更高的请求额度和使用频率。
*   ✅ **突破客户端限制**：Kiro API 模式下支持免费使用Claude Sonnet 4 模型。
*   ✅ **无缝兼容 OpenAI**：提供与 OpenAI API 完全兼容的接口，让您现有的工具链和客户端（如 LobeChat, NextChat 等）可以零成本接入所有支持的模型。
*   ✅ **账号池智能管理**：支持多账号轮询、故障转移和配置降级，确保服务高可用性，有效避免单一账号的限制问题。
*   ✅ **增强的可控性**：通过强大的日志功能，可以捕获并记录所有请求的提示词（Prompts），便于审计、调试和构建私有数据集。
*   ✅ **极易扩展**：得益于全新的模块化和策略模式设计，添加一个新的模型服务商变得前所未有的简单。
*   ✅ **完整测试覆盖**：提供全面的集成测试和单元测试，确保各个API端点和功能的稳定性和可靠性。
*   ✅ **Docker支持**：提供完整的Docker容器化支持，支持快速部署和环境隔离。

---

## 📑 快速导航

- [🐳 Docker 部署](https://aiproxy.justlikemaki.vip/zh/docs/installation/docker-deployment.html)
- [🎨 模型协议与提供商关系图](#-模型协议与提供商关系图)
- [🔧 使用说明](#-使用说明)
- [💻 代理设置](#-代理设置)
- [🌟 特殊用法与进阶技巧](#-特殊用法与进阶技巧)
- [🚀 项目启动参数](#-项目启动参数)
- [📄 开源许可](#-开源许可)
- [🙏 致谢](#-致谢)
- [⚠️ 免责声明](#-免责声明)

---

## 🎨 模型协议与提供商关系图


- OpenAI 协议 (P_OPENAI): 支持所有 MODEL_PROVIDER，包括 openai-custom、gemini-cli-oauth、claude-custom、
claude-kiro-oauth 和 openai-qwen-oauth。
- Claude 协议 (P_CLAUDE): 支持 claude-custom、claude-kiro-oauth、gemini-cli-oauth、openai-custom和 openai-qwen-oauth。
- Gemini 协议 (P_GEMINI): 支持 gemini-cli-oauth。


  ```mermaid
  
   graph TD
       subgraph Core_Protocols["核心协议"]
           P_OPENAI[OpenAI Protocol]
           P_GEMINI[Gemini Protocol]
           P_CLAUDE[Claude Protocol]
       end
   
       subgraph Supported_Model_Providers["支持的模型提供商"]
           MP_OPENAI[openai-custom]
           MP_GEMINI[gemini-cli-oauth]
           MP_CLAUDE_C[claude-custom]
           MP_CLAUDE_K[claude-kiro-oauth]
           MP_QWEN[openai-qwen-oauth]
       end
   
       P_OPENAI ---|支持| MP_OPENAI
       P_OPENAI ---|支持| MP_QWEN
       P_OPENAI ---|支持| MP_GEMINI
       P_OPENAI ---|支持| MP_CLAUDE_C
       P_OPENAI ---|支持| MP_CLAUDE_K
   
       P_GEMINI ---|支持| MP_GEMINI
   
       P_CLAUDE ---|支持| MP_CLAUDE_C
       P_CLAUDE ---|支持| MP_CLAUDE_K
       P_CLAUDE ---|支持| MP_GEMINI
       P_CLAUDE ---|支持| MP_OPENAI
       P_CLAUDE ---|支持| MP_QWEN
   
       style P_OPENAI fill:#f9f,stroke:#333,stroke-width:2px
       style P_GEMINI fill:#ccf,stroke:#333,stroke-width:2px
       style P_CLAUDE fill:#cfc,stroke:#333,stroke-width:2px

  ```

---

## 🔧 使用说明

*   **MCP 支持**: 虽然原版 Gemini CLI 的内置命令功能不可用，但本项目完美支持 MCP (Model Context Protocol)，可配合支持 MCP 的客户端实现更强大的功能扩展。
*   **多模态能力**: 支持图片、文档等多模态输入，为您提供更丰富的交互体验。
*   **最新模型支持**: 支持最新的 **Kimi K2**、**GLM-4.5** 和 **Qwen Code** 模型，只需在 `config.json` 中配置相应的 OpenAI 或 Claude 兼容接口即可使用。
*   **Qwen Code 支持**: 使用 Qwen Code 会自动在浏览器打开授权页面，完成授权后会在 `~/.qwen` 目录下生成 `oauth_creds.json` 文件。请使用官方默认参数 temperature=0 ， top_p=1。
*   **Kiro API**: 使用 Kiro API 需要[下载kiro客户端](https://aibook.ren/archives/kiro-install)并完成授权登录生成 kiro-auth-token.json。**推荐配合 Claude Code 使用以获得最佳体验**。注意：Kiro服务政策已调整，具体使用限制请查看官方公告。
*   **Claude Code 中使用不同供应商**: 通过 Path 路由或环境变量，您可以在 Claude 相关的 API 调用中使用不同的供应商：
    *   `http://localhost:3000/claude-custom` - 使用配置文件中定义的 Claude API 供应商
    *   `http://localhost:3000/claude-kiro-oauth` - 使用 Kiro OAuth 认证方式访问 Claude API
    *   `http://localhost:3000/openai-custom` - 使用 OpenAI 自定义供应商处理 Claude 请求
    *   `http://localhost:3000/gemini-cli-oauth` - 使用 Gemini CLI OAuth 供应商处理 Claude 请求
    *   `http://localhost:3000/openai-qwen-oauth` - 使用 Qwen OAuth 供应商处理 Claude 请求
    *   每个供应商可以配置不同的 API 密钥、基础 URL 和其他参数，实现灵活的供应商切换

    这些 Path 路由不仅可以在直接 API 调用中使用，也可以在 Cline、Kilo 等编程 agent 中使用，通过指定不同的路径来调用相应的模型。例如，在编程 agent 中配置 API 端点时，可以使用 `http://localhost:3000/claude-kiro-oauth` 来调用通过 Kiro OAuth 认证的 Claude 模型，或使用 `http://localhost:3000/gemini-cli-oauth` 来调用 Gemini 模型。

    除了通过 Path 路由切换供应商外，您还可以通过设置环境变量来配置 Claude 参数。可以通过以下环境变量进行配置：

    *   `ANTHROPIC_BASE_URL`: 设置 Claude API 的基础 URL 路径
    *   `ANTHROPIC_AUTH_TOKEN`: 设置 Claude 服务的认证密钥
    *   `ANTHROPIC_MODEL`: 设置需要使用的 Claude 模型

    #### 不同系统中的环境变量设置方法

    当使用 `http://localhost:3000/claude-custom` 路径时，可以通过以下方式设置环境变量：

    ##### Linux / macOS
    ```bash
    export ANTHROPIC_BASE_URL="http://localhost:3000/claude-custom"
    export ANTHROPIC_AUTH_TOKEN="your-auth-token-here"
    export ANTHROPIC_MODEL="your-model-name"
    ```

    ##### Windows (CMD)
    ```cmd
    set ANTHROPIC_BASE_URL=http://localhost:3000/claude-custom
    set ANTHROPIC_AUTH_TOKEN=your-auth-token-here
    set ANTHROPIC_MODEL=your-model-name
    ```

    ##### Windows (PowerShell)
    ```powershell
    $env:ANTHROPIC_BASE_URL="http://localhost:3000/claude-custom"
    $env:ANTHROPIC_AUTH_TOKEN="your-auth-token-here"
    $env:ANTHROPIC_MODEL="your-model-name"
    ```

### 授权文件默认路径

以下是各服务授权文件的默认存储路径：

*   **Gemini**: `~/.gemini/oauth_creds.json`
*   **Kiro**: `~/.aws/sso/cache/kiro-auth-token.json`
*   **Qwen**: `~/.qwen/oauth_creds.json`

其中 `~` 代表用户主目录。如果需要自定义路径，可以通过配置文件或环境变量进行设置。

---


## 💻 代理设置

> **提示**: 如果您在无法直接访问 Google/OpenAI/Claude/Kiro 服务的环境中使用，请先为您的终端设置 HTTP代理，不要设置 HTTPS代理。

### 不同终端环境下的 HTTP 代理设置命令

为了确保 `AIClient2API` 能够正常访问外部 AI 服务（如 Google、OpenAI、Claude、Kiro 等），您可能需要在您的终端环境中设置 HTTP 代理。以下是针对不同操作系统的代理设置命令：

#### Linux / macOS
```bash
export HTTP_PROXY="http://your_proxy_address:port"
# 如果代理需要认证
# export HTTP_PROXY="http://username:password@your_proxy_address:port"
```
要使这些设置永久生效，您可以将它们添加到您的 shell 配置文件中（例如 `~/.bashrc`, `~/.zshrc` 或 `~/.profile`）。

#### Windows (CMD)
```cmd
set HTTP_PROXY=http://your_proxy_address:port
:: 如果代理需要认证
:: set HTTP_PROXY=http://username:password@your_proxy_address:port
```
这些设置只对当前 CMD 会话有效。如需永久设置，您可以通过系统环境变量进行配置。

#### Windows (PowerShell)
```powershell
$env:HTTP_PROXY="http://your_proxy_address:port"
# 如果代理需要认证
# $env:HTTP_PROXY="http://username:password@your_proxy_address:port"
```
这些设置只对当前 PowerShell 会话有效。如需永久设置，您可以将它们添加到您的 PowerShell 配置文件中 (`$PROFILE`) 或通过系统环境变量进行配置。

**请务必将 `your_proxy_address` 和 `port` 替换为您的实际代理地址和端口。**

---

## 🌟 特殊用法与进阶技巧

*   **🔌 对接任意 OpenAI 客户端**: 这是本项目的基本功能。将任何支持 OpenAI 的应用（如 LobeChat, NextChat, VS Code 插件等）的 API 地址指向本服务 (`http://localhost:3000`)，即可无缝使用所有已配置的模型。

*   **🔍 中心化请求监控与审计**: 在 `config.json` 中设置 `"PROMPT_LOG_MODE": "file"` 来捕获所有请求和响应，并保存到本地日志文件。这对于分析、调试和优化提示词，甚至构建私有数据集都至关重要。

*   **💡 动态系统提示词**:
    *   通过在 `config.json` 中设置 `SYSTEM_PROMPT_FILE_PATH` 和 `SYSTEM_PROMPT_MODE`，您可以更灵活地控制系统提示词的行为。
    *   **支持的模式**:
        *   `override`: 完全忽略客户端的系统提示词，强制使用文件中的内容。
        *   `append`: 在客户端系统提示词的末尾追加文件中的内容，实现规则的补充。
    *   这使得您可以为不同的客户端设置统一的基础指令，同时允许单个应用进行个性化扩展。

*   **🛠️ 作为二次开发基石**:
    *   **添加新模型**: 只需在 `src` 目录下创建一个新的提供商目录，实现 `ApiServiceAdapter` 接口和相应的策略，然后在 `adapter.js` 和 `common.js` 中注册即可。
    *   **响应缓存**: 对高频重复问题添加缓存逻辑，降低 API 调用，提升响应速度。
    *   **自定义内容过滤**: 在请求发送或返回前增加关键词过滤或内容审查逻辑，满足合规要求。

*   **🎯 账号池高级配置**:
    *   **多账号管理**: 通过配置 `provider_pools.json` 文件，可以为每个提供商配置多个账号，实现智能轮询。
    *   **故障转移**: 当某个账号失效时，系统会自动切换到下一个可用账号，确保服务连续性。
    *   **配置降级**: 支持根据账号状态动态调整配置参数，优化资源使用效率。
    *   **使用示例**: 参考项目中的 `provider_pools.json` 配置文件，轻松设置多账号环境。

---

## 🚀 项目启动参数

本项目支持丰富的命令行参数配置，可以根据需要灵活调整服务行为。以下是对所有启动参数的详细说明，按功能分组展示：

### 🔧 服务器配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--host` | string | localhost | 服务器监听地址 |
| `--port` | number | 3000 | 服务器监听端口 |
| `--api-key` | string | 123456 | 身份验证所需的 API 密钥 |

### 🤖 模型提供商配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--model-provider` | string | gemini-cli-oauth | AI 模型提供商，可选值：openai-custom, claude-custom, gemini-cli-oauth, claude-kiro-oauth, openai-qwen-oauth |

### 🧠 OpenAI 兼容提供商参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--openai-api-key` | string | null | OpenAI API 密钥 (用于 openai-custom 提供商) |
| `--openai-base-url` | string | null | OpenAI API 基础 URL (用于 openai-custom 提供商) |

### 🖥️ Claude 兼容提供商参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--claude-api-key` | string | null | Claude API 密钥 (用于 claude-custom 提供商) |
| `--claude-base-url` | string | null | Claude API 基础 URL (用于 claude-custom 提供商) |

### 🔐 Gemini OAuth 认证参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--gemini-oauth-creds-base64` | string | null | Gemini OAuth 凭据的 Base64 字符串 |
| `--gemini-oauth-creds-file` | string | null | Gemini OAuth 凭据 JSON 文件路径 |
| `--project-id` | string | null | Google Cloud 项目 ID (用于 gemini-cli 提供商) |

### 🎮 Kiro OAuth 认证参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--kiro-oauth-creds-base64` | string | null | Kiro OAuth 凭据的 Base64 字符串 |
| `--kiro-oauth-creds-file` | string | null | Kiro OAuth 凭据 JSON 文件路径 |

### 🐼 Qwen OAuth 认证参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--qwen-oauth-creds-file` | string | null | Qwen OAuth 凭据 JSON 文件路径 |

### 📝 系统提示配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--system-prompt-file` | string | input_system_prompt.txt | 系统提示文件路径 |
| `--system-prompt-mode` | string | overwrite | 系统提示模式，可选值：overwrite（覆盖）, append（追加） |

### 📊 日志配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--log-prompts` | string | none | 提示日志模式，可选值：console（控制台）, file（文件）, none（无） |
| `--prompt-log-base-name` | string | prompt_log | 提示日志文件基础名称 |

### 🔄 重试机制参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--request-max-retries` | number | 3 | API 请求失败时，自动重试的最大次数 |
| `--request-base-delay` | number | 1000 | 自动重试之间的基础延迟时间（毫秒），每次重试后延迟会增加 |

### ⏰ 定时任务参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--cron-near-minutes` | number | 15 | OAuth 令牌刷新任务计划的间隔时间（分钟） |
| `--cron-refresh-token` | boolean | true | 是否开启 OAuth 令牌自动刷新任务 |

### 🎯 号池配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--provider-pools-file` | string | null | 提供商号池配置文件路径 |

### 使用示例

```bash
# 基本用法
node src/api-server.js

# 指定端口和API密钥
node src/api-server.js --port 8080 --api-key my-secret-key

# 使用OpenAI提供商
node src/api-server.js --model-provider openai-custom --openai-api-key sk-xxx --openai-base-url https://api.openai.com/v1

# 使用Claude提供商
node src/api-server.js --model-provider claude-custom --claude-api-key sk-ant-xxx --claude-base-url https://api.anthropic.com

# 使用Gemini提供商（Base64凭据）
node src/api-server.js --model-provider gemini-cli-oauth --gemini-oauth-creds-base64 eyJ0eXBlIjoi... --project-id your-project-id

# 使用Gemini提供商（凭据文件）
node src/api-server.js --model-provider gemini-cli-oauth --gemini-oauth-creds-file /path/to/credentials.json --project-id your-project-id

# 配置系统提示
node src/api-server.js --system-prompt-file custom-prompt.txt --system-prompt-mode append

# 配置日志
node src/api-server.js --log-prompts console
node src/api-server.js --log-prompts file --prompt-log-base-name my-logs

# 完整示例
node src/api-server.js \
  --host 0.0.0.0 \
  --port 3000 \
  --api-key my-secret-key \
  --model-provider gemini-cli-oauth \
  --project-id my-gcp-project \
  --gemini-oauth-creds-file ./credentials.json \
  --system-prompt-file ./custom-system-prompt.txt \
  --system-prompt-mode overwrite \
  --log-prompts file \
  --prompt-log-base-name api-logs
```
---

## 📄 开源许可

本项目遵循 [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) 开源许可。详情请查看根目录下的 `LICENSE` 文件。

## 🙏 致谢

本项目的开发受到了官方 Google Gemini CLI 的极大启发，并参考了Cline 3.18.0 版本 `gemini-cli.ts` 的部分代码实现。在此对 Google 官方团队和 Cline 开发团队的卓越工作表示衷心的感谢！

## 🌟 Star History

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
