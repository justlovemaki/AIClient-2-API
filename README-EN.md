<div align="center">

# GeminiCli2API 🚀

**A powerful proxy that wraps the Google Gemini CLI into a local API, providing an OpenAI-compatible interface.**

</div>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)

[**中文**](./README.md) | [**English**](./README-EN.md)

</div>

> `GeminiCli2API` is a powerful proxy that wraps the Google Gemini CLI into a local API. Through a unified Node.js HTTP server, it provides support for both the native Gemini API and an OpenAI-compatible API. This allows you to break free from the constraints of a terminal interface and easily integrate Gemini's powerful capabilities into any of your favorite clients or applications via an API.

---

## 📝 Project Overview

This project consists of two core files, each with its own role:

*   `gemini-api-server.js`: 💎 **Unified Gemini & OpenAI Proxy Service**
    *   A standalone Node.js HTTP server that acts as a local proxy for the Google Cloud Code Assist API.
    *   It handles requests for both the native Gemini API (path: `/v1beta/...`) and the OpenAI-compatible API (path: `/v1/...`).
    *   Designed to be robust and flexible, it features a comprehensive and controllable logging system for easy monitoring and debugging.

*   `gemini-core.js`: ⚙️ **Core Logic**
    *   This is the heart of the server, containing all core functionalities such as authentication, API calls, request/response format conversion, and logging.

---

## 💡 Core Advantages

*   ✅ **Break Through Official Limits**: Solves the problem of tight quotas on the official free Gemini API. With this project, you can use your Gemini CLI account authorization to enjoy higher daily request limits.
*   ✅ **Seamless OpenAI Compatibility**: Provides an interface fully compatible with the OpenAI API, allowing your existing toolchains and clients (like LobeChat, NextChat, etc.) to access Gemini at zero cost.
*   ✅ **Enhanced Controllability**: With powerful logging features, you can capture and record all request prompts, which is convenient for auditing, debugging, and building private datasets.
*   ✅ **Easy to Extend**: The code structure is clear, making it convenient for you to perform secondary development to implement custom features like unified prefix prompts, response caching, and content filtering.

### ⚠️ Current Limitations

*   The built-in command functions of the original Gemini CLI are not yet implemented. This can be achieved by integrating with other clients' MCP capabilities.
*   Multimodal capabilities (like image input) are still in the development plan (TODO).

---

## 🛠️ Key Features

### 💎 Unified API Server (`gemini-api-server.js`)

#### General Features
*   🔐 **Automatic Authentication & Token Renewal**: The first run will guide you through Google account authorization via a browser. The obtained OAuth token will be securely stored locally and automatically refreshed before expiration, ensuring uninterrupted service.
*   🔗 **Simplified Authorization Flow**: If authentication is required, the terminal will provide an authorization URL. You can complete the authentication by authorizing in your browser.
*   🛡️ **Multiple API Key Authentication Methods**: Supports unified API key validation via `Authorization: Bearer <key>` (OpenAI style), URL query parameters (`?key=...`), and the `x-goog-api-key` request header.
*   ⚙️ **Highly Configurable**: Flexibly configure listening address, port, API key, and log mode via command-line arguments.
*   📜 **Fully Controllable Logging System**: Can output timestamped prompt logs to the console or a file, and display the remaining token validity period.

#### OpenAI Compatible Interface (`/v1/...`)
*   🌍 **Perfect Compatibility**: Implements the core `/v1/models` and `/v1/chat/completions` endpoints.
*   🔄 **Automatic Format Conversion**: Internally and seamlessly converts requests/responses between OpenAI and Gemini formats.
*   💨 **Streaming Support**: Fully supports OpenAI's streaming responses (`"stream": true`), providing a typewriter-like real-time experience.

#### Gemini Native Interface (`/v1beta/...`)
*   🌐 **Full Endpoint Support**: Fully implements `listModels`, `generateContent`, and `streamGenerateContent`.
*   🤖 **Fixed Model List**: Defaults to providing and using the `gemini-2.5-pro` and `gemini-2.5-flash` models.

---

## 📦 Installation Guide

1.  **Prerequisites**:
    *   Please ensure you have [Node.js](https://nodejs.org/) installed (recommended version >= 20.0.0).
    *   This project already includes `package.json` and sets `{"type": "module"}`, so you don't need to create it manually.

2.  **Install Dependencies**:
    After cloning this repository, execute the following in the project root directory:
    ```bash
    npm install
    ```
    This will automatically install necessary dependencies like `google-auth-library` and `uuid`.

---

## 🚀 Quick Start

### ▶️ Start the Service

*   **Default Start** (listens on `localhost:3000`, API Key is `123456`)
    ```bash
    node gemini-api-server.js
    ```
*   **Listen on All Network Interfaces & Specify Port and Key** (for Docker or LAN access)
    ```bash
    node gemini-api-server.js 0.0.0.0 --port 8000 --api-key your_secret_key
    ```
*   **Log Prompts to a File**
    ```bash
    node gemini-api-server.js --log-prompts file
    ```
*   **Start with a Specified Project ID**
    ```bash
    node gemini-api-server.js --project-id your-gcp-project-id
    ```

*For more startup parameters, such as starting with base64 credentials or a file path, please refer to the comments at the top of the `gemini-api-server.js` file.*

---

### 💻 Call the API

> **Hint**: If you are using this in an environment where you cannot directly access Google services, please set up a global HTTP/HTTPS proxy for your terminal first.

#### 1. Using the OpenAI Compatible Interface (`/v1/...`)

*   **List Models**
    ```bash
    curl http://localhost:3000/v1/models \
      -H "Authorization: Bearer 123456"
    ```
*   **Generate Content (Non-streaming)**
    ```bash
    curl http://localhost:3000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{
        "model": "gemini-2.5-pro",
        "messages": [
          {"role": "system", "content": "You are a cat named Neko."},
          {"role": "user", "content": "Hello, what is your name?"}
        ]
      }'
    ```
*   **Stream Generate Content**
    ```bash
    curl http://localhost:3000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{
        "model": "gemini-2.5-flash",
        "messages": [
          {"role": "user", "content": "Write a five-line poem about the universe"}
        ],
        "stream": true
      }'
    ```

#### 2. Using the Gemini Native Interface (`/v1beta/...`)

*   **List Models**
    ```bash
    curl "http://localhost:3000/v1beta/models?key=123456"
    ```
*   **Generate Content (with system prompt)**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{
        "system_instruction": { "parts": [{ "text": "You are a cat named Neko." }] },
        "contents": [{ "parts": [{ "text": "Hello, what is your name?" }] }]
      }'
    ```
*   **Stream Generate Content**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=123456" \
      -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"Write a five-line poem about the universe"}]}]}'
    ```

---

## 🌟 Special Usage & Advanced Tips

*   **🔌 Connect to Any OpenAI Client**: This is the killer feature of this project. Point the API address of any application that supports OpenAI (like LobeChat, NextChat, VS Code extensions, etc.) to this service (`http://localhost:3000`) to use Gemini seamlessly.

*   **🔍 Centralized Request Monitoring & Auditing**: Use the `--log-prompts file` parameter to capture all system prompts and user requests sent by clients and save them locally. This is crucial for analyzing, debugging, and optimizing prompts, and even for building private datasets.

*   **💡 Dynamic System Prompts**:
    *   With the `--system-prompt-mode` parameter, you can control the behavior of system prompts more flexibly. This feature works in conjunction with the `fetch_system_prompt.txt` file.
    *   **Usage**: `node gemini-api-server.js --system-prompt-mode [mode]`
    *   **Supported Modes**:
        *   `override`: Completely ignores the client's system prompt and forces the use of the content from `fetch_system_prompt.txt`.
        *   `append`: Appends the content of `fetch_system_prompt.txt` to the end of the client's system prompt to supplement rules.
    *   This allows you to set unified base instructions for different clients while allowing individual applications for personalized extensions.

*   **🛠️ Foundation for Secondary Development**:
    *   **Response Caching**: Add caching logic for frequently repeated questions to reduce API calls and improve response speed.
    *   **Custom Content Filtering**: Add keyword filtering or content review logic before requests are sent or returned to meet compliance requirements.
    *   **Other**: You can customize the code as needed to add more features, such as dynamically adjusting system prompts, supporting more models, or adding permission validation.

---

## 📄 License

This project is licensed under the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0). For details, please see the `LICENSE` file in the root directory.

## 🙏 Acknowledgements

The development of this project was greatly inspired by the official Google Gemini CLI, and referenced some code implementations from Cline 3.18.0's `gemini-cli.ts`. I would like to express my sincere gratitude to the official Google team and the Cline development team for their excellent work!
