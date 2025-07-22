<div align="center">

# GeminiCli2API 🚀

**一个将 Google Gemini CLI 封装为本地 API 的强大代理，并提供 OpenAI 兼容接口。**

</div>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)

[**中文**](./README.md) | [**English**](./README-EN.md)

</div>

> `GeminiCli2API` 是一个将 Google Gemini CLI 封装为本地 API 的强大代理，它通过一个统一的 Node.js HTTP 服务器，同时提供了对原生 Gemini API 和 OpenAI 兼容 API 的支持。这让您可以摆脱终端界面的束缚，将 Gemini 的强大能力以 API 的形式轻松接入到任何您喜爱的客户端或应用中。

---

## 📝 项目概述

本项目由两个核心文件构成，各司其职：

*   `gemini-api-server.js`: 💎 **统一的 Gemini & OpenAI 代理服务**
    *   一个独立的 Node.js HTTP 服务器，作为 Google Cloud Code Assist API 的本地代理。
    *   它同时处理原生 Gemini API (路径: `/v1beta/...`) 和 OpenAI 兼容 API (路径: `/v1/...`) 的请求。
    *   设计稳健、灵活，并配备了全面可控的日志系统，方便监控和调试。

*   `gemini-core.js`: ⚙️ **核心逻辑**
    *   这是服务器的心脏，包含了认证、API 调用、请求/响应格式转换、以及日志记录等所有核心功能。

---

## 💡 核心优势

*   ✅ **突破官方限制**：解决了 Gemini 官方免费 API 额度紧张的问题。通过本项目，您可以使用 Gemini CLI 的账号授权，享受更高的每日请求限额。
*   ✅ **无缝兼容 OpenAI**：提供了与 OpenAI API 完全兼容的接口，让您现有的工具链和客户端（如 LobeChat, NextChat 等）可以零成本接入 Gemini。
*   ✅ **增强的可控性**：通过强大的日志功能，可以捕获并记录所有请求的提示词（Prompts），便于审计、调试和构建私有数据集。
*   ✅ **易于扩展**：代码结构清晰，方便您进行二次开发，实现如统一前置提示词、响应缓存、内容过滤等自定义功能。

### ⚠️ 目前的局限

*   暂未实现原版 Gemini CLI 的内置命令功能。配合其他客户端的mcp能力可实现相同效果。
*   多模态能力（如图片输入）尚在开发计划中 (TODO)。

---

## 🛠️ 主要功能

### 💎 统一 API 服务器 (`gemini-api-server.js`)

#### 通用功能
*   🔐 **自动认证与令牌续期**: 首次运行将引导您通过浏览器完成 Google 账号授权。获取的 OAuth 令牌会安全存储在本地，并在过期前自动刷新，确保服务不间断。
*   🔗 **简化的授权流程**: 如果需要认证，终端会提供一个授权URL，您在浏览器中授权后，即可完成认证。
*   🛡️ **多样的APIKEY认证方式**: 支持通过 `Authorization: Bearer <key>` (OpenAI 方式), URL 查询参数 (`?key=...`) 和 `x-goog-api-key` 请求头进行统一的 API 密钥校验。
*   ⚙️ **高度可配置**: 可通过命令行参数灵活配置监听地址、端口、API 密钥和日志模式。
*   📜 **全面可控的日志系统**: 可将带时间戳的提示词日志输出到控制台或文件，并显示令牌剩余有效期。

#### OpenAI 兼容接口 (`/v1/...`)
*   🌍 **完美兼容**: 实现了 `/v1/models` 和 `/v1/chat/completions` 核心端点。
*   🔄 **自动格式转换**: 在内部自动将 OpenAI 格式的请求/响应与 Gemini 格式进行无缝转换。
*   💨 **流式传输支持**: 完全支持 OpenAI 的流式响应 (`"stream": true`)，提供打字机般的实时体验。

#### Gemini 原生接口 (`/v1beta/...`)
*   🌐 **完整的端点支持**: 完整实现了 `listModels`, `generateContent`, 和 `streamGenerateContent`。
*   🤖 **固定的模型列表**: 默认提供并使用 `gemini-2.5-pro` 和 `gemini-2.5-flash` 模型。

---

## 📦 安装指南

1.  **环境准备**:
    *   请确保您已安装 [Node.js](https://nodejs.org/) (建议版本 >= 20.0.0)。
    *   本项目已包含 `package.json` 并设置 `{"type": "module"}`，您无需手动创建。

2.  **安装依赖**:
    克隆本仓库后，在项目根目录下执行：
    ```bash
    npm install
    ```
    这将自动安装 `google-auth-library` 和 `uuid` 等必要依赖。

---

## 🚀 快速开始

### ▶️ 启动服务

*   **默认启动** (监听 `localhost:3000`, API Key 为 `123456`)
    ```bash
    node gemini-api-server.js
    ```
*   **监听所有网络接口并指定端口和Key** (用于 Docker 或局域网访问)
    ```bash
    node gemini-api-server.js 0.0.0.0 --port 8000 --api-key your_secret_key
    ```
*   **记录提示词到文件**
    ```bash
    node gemini-api-server.js --log-prompts file
    ```
*   **通过指定项目ID启动**
    ```bash
    node gemini-api-server.js --project-id your-gcp-project-id
    ```

*更多启动参数，如通过 base64 凭证或文件路径启动，请参考 `gemini-api-server.js` 文件顶部的注释。*

---

### 💻 调用 API

> **提示**: 如果您在无法直接访问 Google 服务的环境中使用，请先为您的终端设置全局 HTTP/HTTPS 代理。

#### 1. 使用 OpenAI 兼容接口 (`/v1/...`)

*   **列出模型**
    ```bash
    curl http://localhost:3000/v1/models \
      -H "Authorization: Bearer 123456"
    ```
*   **生成内容 (非流式)**
    ```bash
    curl http://localhost:3000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{
        "model": "gemini-2.5-pro",
        "messages": [
          {"role": "system", "content": "你是一只名叫 Neko 的猫。"},
          {"role": "user", "content": "你好，你叫什么名字？"}
        ]
      }'
    ```
*   **流式生成内容**
    ```bash
    curl http://localhost:3000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{
        "model": "gemini-2.5-flash",
        "messages": [
          {"role": "user", "content": "写一首关于宇宙的五行短诗"}
        ],
        "stream": true
      }'
    ```

#### 2. 使用 Gemini 原生接口 (`/v1beta/...`)

*   **列出模型**
    ```bash
    curl "http://localhost:3000/v1beta/models?key=123456"
    ```
*   **生成内容 (带系统提示)**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{
        "system_instruction": { "parts": [{ "text": "你是一只名叫 Neko 的猫。" }] },
        "contents": [{ "parts": [{ "text": "你好，你叫什么名字？" }] }]
      }'
    ```
*   **流式生成内容**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=123456" \
      -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"写一首关于宇宙的五行短诗"}]}]}'
    ```

---

## 🌟 特殊用法与进阶技巧

*   **🔌 对接任意 OpenAI 客户端**: 这是本项目的杀手级功能。将任何支持 OpenAI 的应用（如 LobeChat, NextChat, VS Code 插件等）的 API 地址指向本服务 (`http://localhost:3000`)，即可无缝使用 Gemini。

*   **🔍 中心化请求监控与审计**: 使用 `--log-prompts file` 参数捕获所有客户端发送的系统提示词和用户请求保存到本地。这对于分析、调试和优化提示词，甚至构建私有数据集都至关重要。

*   **💡 动态系统提示词**:
    *   通过 `--system-prompt-mode` 参数，您可以更灵活地控制系统提示词的行为。此功能与 `fetch_system_prompt.txt` 文件配合使用。
    *   **用法**: `node gemini-api-server.js --system-prompt-mode [mode]`
    *   **支持的模式**:
        *   `override`: 完全忽略客户端的系统提示词，强制使用 `fetch_system_prompt.txt` 的内容。
        *   `append`: 在客户端系统提示词的末尾追加 `fetch_system_prompt.txt` 的内容，实现规则的补充。
    *   这使得您可以为不同的客户端设置统一的基础指令，同时允许单个应用进行个性化扩展。

*   **🛠️ 作为二次开发基石**:
    *   **响应缓存**: 对高频重复问题添加缓存逻辑，降低 API 调用，提升响应速度。
    *   **自定义内容过滤**: 在请求发送或返回前增加关键词过滤或内容审查逻辑，满足合规要求。
    *   **其它**: 您可以根据需要自定义代码，添加更多功能，如动态调整系统提示词、支持更多模型、增加权限验证等。


---

## 📄 开源许可

本项目遵循 [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) 开源许可。详情请查看根目录下的 `LICENSE` 文件。

## 🙏 致谢

本项目的开发受到了官方 Google Gemini CLI 的极大启发，并参考了Cline 3.18.0 版本 `gemini-cli.ts` 的部分代码实现。在此对 Google 官方团队和 Cline 开发团队的卓越工作表示衷心的感谢！
