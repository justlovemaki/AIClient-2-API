# GeminiCli2API
<div align="center">
该项目包含两个 Node.js HTTP 服务器。它们作为 Google Cloud Code Assist API 的本地代理。其中一个服务器还提供了与 OpenAI API 兼容的接口。可以抛弃终端界面，通过API的形式接入到任意客户端。

[中文](./README.md) / [English](./README-EN.md)
</div>

## 项目概述

-   `gemini-api-server.js`: 这是一个独立的 Node.js HTTP 服务器。它作为 Google Cloud Code Assist API 的本地代理。该服务器提供所有功能和错误修复。它的设计稳健、灵活。通过全面可控的日志系统，可以方便地进行监控。
-   `openai-api-server.js`: 这个脚本基于 `gemini-api-server.js`。它创建了一个独立的 Node.js HTTP 服务器。此服务器也是 Google Cloud Code Assist API 的本地代理。但是，它对外提供了与 OpenAI API 兼容的接口。因此，任何支持 OpenAI API 的客户端可以直接使用它。
-   `gemini-core.js`: 这个文件包含两个服务器共享的核心逻辑。例如，认证、API 调用、请求/响应处理以及日志记录功能。

## 功能说明

### 解决的问题

-   解决了 Gemini 官方免费额度减少的问题。现在，用户可以使用 Gemini CLI 账号授权，每天进行 1000 次请求。
-   提供了与 OpenAI API 的兼容性，方便现有 OpenAI 客户端使用。

### 目前的局限

-   不能使用原版 Gemini CLI 的内置功能。
-   不支持多模态能力。(todo)

## 主要功能

### Gemini API Server (`gemini-api-server.js`)

-   **自动认证与令牌续期**: 首次运行，脚本会引导用户通过浏览器完成 Google 账号手动授权。它将获取 OAuth 令牌。此令牌会安全地存储在本地，并在过期前自动刷新。这确保了服务的持续运行，无需手动干预。
-   **手动授权流程**:
    1.  **复制授权链接**: 终端会输出一个 Google 授权 URL。请复制此 URL。
    2.  **在浏览器中打开链接**: 在任何有图形界面的设备上 (例如你的本地电脑) 的浏览器中打开该 URL。
    3.  **完成授权**: 登录你的 Google 账号并授予权限。
    4.  **复制重定向后的 URL**: 授权后，浏览器会尝试重定向到一个URL，提取授权码，完成认证，并正常启动服务。
-   **灵活的 API 密钥校验**: 用户可以在 URL 查询参数 (`?key=...`) 或 `x-goog-api-key` 请求头中提供密钥。只要密钥正确，请求即可通过授权。密钥可以通过 `--api-key` 启动参数设置。
-   **角色规范化修复**: 服务器会自动为请求体添加必要的 'user'/'model' 角色。同时，它会正确保留 `systemInstruction` (或 `system_instruction`)。
-   **固定的模型列表**: 服务器专门提供并使用 `gemini-2.5-pro` 和 `gemini-2.5-flash` 模型。
-   **完整的 Gemini API 端点支持**: 实现了 `listModels`, `generateContent`, `streamGenerateContent`。
-   **全面可控的日志系统**: 包括令牌剩余有效期。它可以输出到控制台或文件的带时间戳的提示词日志。支持日志打印。

### OpenAI 兼容 API Server (`openai-api-server.js`)

-   **OpenAI API 兼容性**: 实现了 `/v1/models` 和 `/v1/chat/completions` 端点。
-   **格式转换**: 自动将 OpenAI 格式的请求/响应与内部 Gemini 格式进行转换。
-   **流式传输支持**: 完全支持 OpenAI 的流式响应 (`"stream": true`)。
-   **灵活的认证**: 支持通过 `Authorization: Bearer <key>` 请求头、URL 查询参数 (`?key=...`) 或 `x-goog-api-key` 请求头进行 API 密钥校验。
-   **可配置性**: 可以通过命令行参数配置监听地址、端口、API 密钥和提示词日志模式。
-   **重用核心逻辑**: 底层仍使用 `gemini-core.js` 与 Google 服务通信。

## 安装

1.  **环境设置**:
    在项目根目录创建一个 `package.json` 文件，内容为: `{"type": "module"}`。这是为了避免模块类型警告。
    (本项目已提供 `package.json` 文件，无需手动创建)

2.  **安装依赖**:
    ```bash
    npm install
    ```
    这将安装 `google-auth-library` 和 `uuid`。

## 使用说明 与 命令行示例

### 1. Gemini API Server (`gemini-api-server.js`)

**启动服务** (可以组合使用以下参数):

-   **默认启动**: 监听 `localhost:3000`，不打印提示词
    ```bash
    node gemini-api-server.js
    ```
-   **指定监听 IP**: 监听所有网络接口 (例如，用于 Docker 或局域网访问)
    ```bash
    node gemini-api-server.js 0.0.0.0
    ```
-   **打印提示词到控制台**: 监听 `localhost`，并在控制台输出提示词详情
    ```bash
    node gemini-api-server.js --log-prompts console
    ```
-   **打印提示词到文件**: 监听 `localhost`，并将提示词详情保存到一个带启动时间戳的新文件中 (例如: `prompts-20231027-153055.log`)
    ```bash
    node gemini-api-server.js --log-prompts file
    ```
-   **组合使用参数** (参数顺序无关):
    -   在指定 IP 上运行，并打印提示词到控制台
        ```bash
        node gemini-api-server.js 192.168.1.100 --log-prompts console
        ```
    -   在所有网络接口上运行，并打印提示词到文件
        ```bash
        node gemini-api-server.js --log-prompts file 0.0.0.0
        ```
    -   指定 API Key 和端口
        ```bash
        node gemini-api-server.js --api-key your_secret_key --port 3001
        ```

**调用 API 接口** (默认 API Key: `123456`):

-   **a) 列出可用模型** (GET 请求，密钥在 URL 参数中)
    ```bash
    curl "http://localhost:3000/v1beta/models?key=123456"
    ```
-   **b) 生成内容 - 单轮对话** (POST 请求，密钥在请求头中)
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{"contents":[{"parts":[{"text":"用一句话解释什么是代理服务器"}]}]}'
    ```
-   **c) 生成内容 - 带系统提示词** (POST 请求，密钥在请求头中，注意 `system_instruction`)
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{
        "system_instruction": { "parts": [{ "text": "你是一只名叫 Neko 的猫。" }] },
        "contents": [{ "parts": [{ "text": "你好，你叫什么名字？" }] }]
      }'
    ```
-   **d) 流式生成内容** (POST 请求，密钥在 URL 参数中)
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=123456" \
      -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"写一首关于宇宙的五行短诗"}]}]}'
    ```

### 2. OpenAI 兼容 API Server (`openai-api-server.js`)

**启动服务** :

-   **同Gemini API Server 保持一致**:


**调用 API 接口** (假设 API Key: `your_secret_key`, 服务运行在 `localhost:8000`):

-   **a) 列出可用模型**:
    ```bash
    curl http://localhost:8000/v1/models \
      -H "Authorization: Bearer your_secret_key"
    ```
-   **b) 生成内容 - 带系统提示词 (非流式)**:
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer your_secret_key" \
      -d '{
        "model": "gemini-2.5-pro",
        "messages": [
          {"role": "system", "content": "你是一只名叫 Neko 的猫。"},
          {"role": "user", "content": "你好，你叫什么名字？"}
        ]
      }'
    ```
-   **c) 生成内容 - 流式**:
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer your_secret_key" \
      -d '{
        "model": "gemini-2.5-flash",
        "messages": [
          {"role": "user", "content": "写一首关于宇宙的五行短诗"}
        ],
        "stream": true
      }'
