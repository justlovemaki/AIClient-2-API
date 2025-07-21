<div align="center">

# GeminiCli2API 🚀

**A powerful proxy that wraps the Google Gemini CLI into a local API, providing an OpenAI-compatible interface.**

</div>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-green.svg)](https://nodejs.org/)

[**中文**](./README.md) | [**English**](./README-EN.md)

</div>

> `GeminiCli2API` includes two independent Node.js HTTP servers that act as local proxies for the Google Cloud Code Assist API. One of these servers also provides an interface fully compatible with the OpenAI API. This allows you to break free from the terminal interface and easily integrate Gemini&#39;s powerful capabilities into any of your favorite clients or applications in API form.

---

## 📝 Project Overview

This project consists of three core files, each with its own specific function:

*   `gemini-api-server.js`: 💎 **Native Gemini Proxy Service**
    *   An independent Node.js HTTP server that acts as a local proxy for the Google Cloud Code Assist API.
    *   It provides all core functionalities and bug fixes, designed to be robust, flexible, and equipped with a fully controllable logging system for easy monitoring and debugging.

*   `openai-api-server.js`: 🔄 **OpenAI Compatible Proxy Service**
    *   Built on top of `gemini-api-server.js`, it also acts as a proxy for the Google API.
    *   Crucially, it exposes an interface compatible with the OpenAI API. This means any client that supports the OpenAI API can switch to use it seamlessly without any code modification.

*   `gemini-core.js`: ⚙️ **Core Shared Logic**
    *   This is the heart shared by both servers, containing core functionalities such as authentication, API calls, request/response handling, and logging.

---

## 💡 Core Advantages

*   ✅ **Break Through Official Limits**: Solves the problem of tight quotas on the official free Gemini API. With this project, you can use your Gemini CLI account authorization to enjoy higher daily request limits.
*   ✅ **Seamless OpenAI Compatibility**: Provides an interface fully compatible with the OpenAI API, allowing your existing toolchains and clients (like LobeChat, NextChat, etc.) to access Gemini at zero cost.
*   ✅ **Enhanced Controllability**: With powerful logging features, you can capture and record all request prompts, which is convenient for auditing, debugging, and building private datasets.
*   ✅ **Easy to Extend**: The code structure is clear, making it convenient for you to perform secondary development to implement custom features like unified prefix prompts, response caching, content filtering, etc.

### ⚠️ Current Limitations

*   Some built-in command functions of the original Gemini CLI have not yet been implemented.
*   Multimodal capabilities (like image input) are still in the development plan (TODO).

---

## 🛠️ Key Features

### 💎 Gemini API Server (`gemini-api-server.js`)

*   🔐 **Automatic Authentication & Token Renewal**: The first run will guide you through Google account authorization via a browser. The obtained OAuth token will be securely stored locally and automatically refreshed before expiration, ensuring uninterrupted service.
*   🔗 **Simplified Manual Authorization Flow**:
    1.  **Copy Authorization Link**: The terminal will output a Google authorization URL.
    2.  **Browser Authorization**: Open the URL in a browser on any device with a GUI, log in, and grant permissions.
    3.  **Paste Redirect URL**: After authorization, the browser will attempt to redirect to a `localhost` address. Paste it back into the terminal to complete authentication.
    > Credential file will be stored at:
    > *   **Windows**: `C:\Users\USERNAME\.gemini\oauth_creds.json`
    > *   **macOS/Linux**: `~/.gemini/oauth_creds.json`
*   🔑 **Flexible API Key Validation**: Supports providing API keys via URL query parameters (`?key=...`) or the `x-goog-api-key` request header.
*   🔧 **Role Normalization Fix**: Automatically adds the necessary &#39;user&#39;/&#39;model&#39; roles to the request body and correctly handles `systemInstruction`.
*   🤖 **Fixed Model List**: Defaults to providing and using the `gemini-2.5-pro` and `gemini-2.5-flash` models.
*   🌐 **Full Gemini API Endpoint Support**: Fully implements `listModels`, `generateContent`, and `streamGenerateContent`.
*   📜 **Fully Controllable Logging System**: Can output timestamped prompt logs to the console or a file, and display the remaining token validity period.

### 🔄 OpenAI Compatible API Server (`openai-api-server.js`)

*   🌍 **OpenAI API Compatibility**: Perfectly implements the core `/v1/models` and `/v1/chat/completions` endpoints.
*   🔄 **Automatic Format Conversion**: Automatically and seamlessly converts requests/responses between OpenAI format and Gemini format internally.
*   💨 **Streaming Support**: Fully supports OpenAI&#39;s streaming responses (`"stream": true`), providing a typewriter-like real-time experience.
*   🛡️ **Multiple Authentication Methods**: Supports API key validation via `Authorization: Bearer <key>`, URL query parameters (`?key=...`), and the `x-goog-api-key` request header.
*   ⚙️ **Highly Configurable**: Flexibly configure listening address, port, API key, and log mode via command-line arguments.
*   ♻️ **Reuses Core Logic**: Shares `gemini-core.js` with the Gemini API Server at its core, ensuring stability and consistency.

---

## 📦 Installation Guide

1.  **Prerequisites**:
    *   Please ensure you have [Node.js](https://nodejs.org/) installed (recommended version >= 18.0.0).
    *   This project already includes `package.json` and sets `{"type": "module"}`, so you don&#39;t need to create it manually.

2.  **Install Dependencies**:
    After cloning this repository, execute the following in the project root directory:
    ```bash
    npm install
    ```
    This will automatically install necessary dependencies like `google-auth-library` and `uuid`.

---

## 🚀 Quick Start

### 1. Gemini API Server (`gemini-api-server.js`)

#### ▶️ Start the Service
*   **Default Start** (listens on `localhost:3000`)
    ```bash
    node gemini-api-server.js
    ```
*   **Listen on All Network Interfaces** (for Docker or LAN access)
    ```bash
    node gemini-api-server.js 0.0.0.0
    ```
*   **Print Prompts to Console**
    ```bash
    node gemini-api-server.js --log-prompts console
    ```
*   **Combine Parameters** (specify IP, port, API Key, and log to a file)
    ```bash
    node gemini-api-server.js 0.0.0.0 --port 3001 --api-key your_secret_key --log-prompts file
    ```
*   **Start with Base64 Encoded Credentials** (e.g., for Docker or CI/CD environments)
    ```bash
    node gemini-api-server.js --oauth-creds-base64 "YOUR_BASE64_ENCODED_OAUTH_CREDS_JSON"
    ```
*   **Start with Specified Credential File Path** (e.g., for custom credential location)
    ```bash
    node gemini-api-server.js --oauth-creds-file "/path/to/your/oauth_creds.json"
    ```
*   **Start with Specified Project ID** (e.g., for multi-project environments)
    ```bash
    node gemini-api-server.js --project-id your-gcp-project-id
    ```

#### 💻 Call the API (Default API Key: `123456`)
> **Hint**: If you are in an environment where you cannot directly access Google services, please set up a global HTTP/HTTPS proxy for your terminal first.
> 
> - **Windows (CMD):**
>   ```cmd
>   set http_proxy=http://127.0.0.1:7890
>   set https_proxy=http://127.0.0.1:7890
>   ```
> - **Windows (PowerShell):**
>   ```powershell
>   $env:http_proxy="http://127.0.0.1:7890"
>   $env:https_proxy="http://127.0.0.1:7890"
>   ```
> - **macOS/Linux (Bash/Zsh):**
>   ```bash
>   export http_proxy=http://127.0.0.1:7890
>   export https_proxy=http://127.0.0.1:7890
>   ```
*   **List Models**
    ```bash
    curl "http://localhost:3000/v1beta/models?key=123456"
    ```
*   **Generate Content (with system prompt)**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d &#39;{
        "system_instruction": { "parts": [{ "text": "You are a cat named Neko." }] },
        "contents": [{ "parts": [{ "text": "Hello, what is your name?" }] }]
      }&#39;
    ```
*   **Stream Generate Content**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=123456" \
      -H "Content-Type: application/json" \
      -d &#39;{"contents":[{"parts":[{"text":"Write a five-line poem about the universe"}]}]}&#39;
    ```

### 2. OpenAI Compatible API Server (`openai-api-server.js`)

#### ▶️ Start the Service
*Startup parameters are identical to `gemini-api-server.js`.*

*   **Example** (listens on `localhost:8000`, API Key is `sk-your-key`)
    ```bash
    node openai-api-server.js --port 8000 --api-key sk-your-key
    ```

#### 💻 Call the API (as an OpenAI client)

*   **List Models**
    ```bash
    curl http://localhost:8000/v1/models \
      -H "Authorization: Bearer sk-your-key"
    ```
*   **Generate Content (non-streaming)**
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer sk-your-key" \
      -d &#39;{
        "model": "gemini-2.5-pro",
        "messages": [
          {"role": "system", "content": "You are a cat named Neko."},
          {"role": "user", "content": "Hello, what is your name?"}
        ]
      }&#39;
    ```
*   **Stream Generate Content**
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer sk-your-key" \
      -d &#39;{
        "model": "gemini-2.5-flash",
        "messages": [
          {"role": "user", "content": "Write a five-line poem about the universe"}
        ],
        "stream": true
      }&#39;
    ```

---

## 🌟 Special Usage & Advanced Tips

*   **🔌 Connect to Any OpenAI Client**: This is the killer feature of this project. Through `openai-api-server.js`, you can point the API address of any application that supports OpenAI (like LobeChat, NextChat, VS Code extensions, etc.) to this service to use Gemini seamlessly.

*   **🔍 Centralized Request Monitoring & Auditing**: Use the `--log-prompts` parameter to capture all system prompts and user requests sent by clients. This is crucial for analyzing, debugging, and optimizing prompts, and even for building private datasets.

*   **🛠️ Foundation for Secondary Development**:
    *   **Unified System Prompt**: Modify `gemini-core.js` to enforce a unified, invisible system prompt for all requests, ensuring AI responses follow a specific role or format.
    *   **Response Caching**: Add caching logic for frequently repeated questions to reduce API calls and improve response speed.
    *   **Custom Content Filtering**: Add keyword filtering or content review logic before requests are sent or returned to meet compliance requirements.

---

## 📄 License

This project is licensed under the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0). For details, please see the `LICENSE` file in the root directory.

## 🙏 Acknowledgements

The development of this project was greatly inspired by the official Google Gemini CLI, and referenced some code implementations of Cline 3.18.0 version `gemini-cli.ts`. I would like to express my sincere gratitude to the Google official team and the Cline development team for their excellent work!
