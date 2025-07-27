<div align="center">

# Gemini-CLI-2-API 🚀

**A powerful proxy that unifies multiple large model APIs (Gemini, OpenAI, Claude...) into a local OpenAI-compatible interface.**

</div>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)

[**中文**](./README.md) | [**English**](./README-EN.md)

</div>

> `GeminiCli2API` is a versatile and lightweight API proxy designed for maximum flexibility and ease of use. It uses a Node.js HTTP server to transform various backend APIs, such as Google Gemini (CLI authorized), OpenAI, and Claude, into a standard OpenAI format interface. The project is ready to use out-of-the-box—simply run `npm install` and it's good to go, no complex setup required. By easily switching the model provider in the configuration file, you can enable any OpenAI-compatible client or application to seamlessly use different large model capabilities through a single API address, completely eliminating the hassle of maintaining multiple configurations and dealing with incompatible interfaces.

---

## 💡 Core Advantages

*   ✅ **Unified Access to Multiple Models**: One interface for Gemini, OpenAI, Claude, and other models. Freely switch between different model service providers with simple startup parameters or request headers.
*   ✅ **Break Through Official Limits**: By supporting authorization via the Gemini CLI's OAuth method, it effectively bypasses the rate and quota limits of the official free API, allowing you to enjoy higher request quotas and usage frequency.
*   ✅ **Break Through Client Limits**: Kiro API mode supports free use of Claude Sonnet 4 model.
*   ✅ **Seamless OpenAI Compatibility**: Provides an interface fully compatible with the OpenAI API, allowing your existing toolchains and clients (like LobeChat, NextChat, etc.) to access all supported models at zero cost.
*   ✅ **Enhanced Controllability**: With powerful logging features, you can capture and record all request prompts, which is convenient for auditing, debugging, and building private datasets.
*   ✅ **Extremely Easy to Extend**: Thanks to the new modular and strategy pattern design, adding a new model service provider has never been easier.
*   ✅ **Complete Test Coverage**: Provides comprehensive integration and unit tests to ensure the stability and reliability of all API endpoints and functions.

---

## 📝 Project Architecture

Leaving behind the simple structure of the past, we have introduced a more professional and extensible design pattern to completely transform the project:

*   **`src/api-server.js`**: 🚀 **Project Startup Entry**
    *   As the project's commander-in-chief, it is responsible for starting and managing the entire HTTP service, parsing command-line arguments, and loading all configurations.

*   **`src/adapter.js`**: 🔌 **Service Adapter**
    *   Adopts the classic adapter pattern to create a unified interface for each AI service (Gemini, OpenAI, Claude). No matter how the backend service changes, the calling method remains consistent for the main service.

*   **`src/provider-strategies.js`**: 🎯 **Provider Strategy Pattern**
    *   We have defined a set of strategies for each API protocol (such as OpenAI, Gemini, Claude). This set of strategies accurately handles all the details under that protocol, such as request parsing, response formatting, and model name extraction, ensuring perfect conversion between protocols.

*   **`src/convert.js`**: 🔄 **Format Conversion Center**
    *   This is the core of the magic that makes "everything OpenAI-compatible." It is responsible for accurate and lossless data conversion between different API protocol formats.

*   **`src/common.js`**: 🛠️ **Common Utility Library**
    *   Stores shared constants, utility functions, and common handlers for the project, making the code cleaner and more efficient.

*   **`src/gemini/`, `src/openai/`, `src/claude/`**: 📦 **Provider Implementation Directories**
    *   Each directory contains the core logic, API calls, and strategy implementations for the corresponding service provider, with a clear structure that makes it easy for you to add more new service providers in the future. Among them, `src/openai/openai-kiro.js` provides a special implementation for the Kiro API.

*   **`tests/`**: 🧪 **Test Directory**
    *   Contains a complete integration test suite covering all API endpoints, authentication methods, and error handling scenarios to ensure project stability and reliability.

---

### ⚠️ Current Limitations

*   The built-in command functions of the original Gemini CLI are not available. The same effect can be achieved by combining with other clients' MCP capabilities.
*   Using Kiro API requires downloading the Kiro client and using authorized login to generate kiro-auth-token.json. [Download Kiro client](https://aibook.ren/archives/kiro-install).
*   Multimodal capabilities (like image input) are still in the development plan (TODO).

---

## 🛠️ Key Features

#### General Features
*   🔐 **Smart Authentication & Token Renewal**: For services that require OAuth (like `gemini-cli-oauth`), the first run will guide you through browser authorization and can automatically refresh the token.
*   🛡️ **Unified API Key Authentication**: All services are authenticated through the unified `Authorization: Bearer <key>` method, which is simple and convenient.
*   ⚙️ **Highly Configurable**: Flexibly configure the listening address, port, API key, model provider, and log mode via the `config.json` file or command-line arguments.
*   📜 **Fully Controllable Logging System**: Can output timestamped prompt logs to the console or a file, and display the remaining token validity period.

#### OpenAI Compatible Interface (`/v1/...`)
*   🌍 **Perfect Compatibility**: Implements the core `/v1/models` and `/v1/chat/completions` endpoints.
*   🔄 **Automatic Format Conversion**: Internally and seamlessly converts requests/responses between different model formats and the OpenAI format.
*   💨 **Streaming Support**: Fully supports OpenAI's streaming responses (`"stream": true`), providing a typewriter-like real-time experience.

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
    This will automatically install all necessary dependencies.

---

## 🚀 Quick Start

### 1. Configuration File (`config.json`)

We recommend using the `config.json` file to manage your configurations, which is clearer than lengthy command-line arguments.

First, manually create a `config.json` file and fill in your configuration information.

```json
{
    "REQUIRED_API_KEY": "123456",
    "SERVER_PORT": 3000,
    "HOST": "localhost",
    "MODEL_PROVIDER": "gemini-cli-oauth",
    "OPENAI_API_KEY": "sk-your-openai-key",
    "OPENAI_BASE_URL": "https://api.openai.com/v1",
    "CLAUDE_API_KEY": "sk-ant-your-claude-key",
    "CLAUDE_BASE_URL": "https://api.anthropic.com/v1",
    "PROJECT_ID": "your-gcp-project-id",
    "PROMPT_LOG_MODE": "console"
}
```

### 2. Configuration Parameter Details

The following are all the supported parameters in the `config.json` file and their detailed descriptions:

| Parameter Name | Type | Description | Default/Optional Values |
| --- | --- | --- | --- |
| `REQUIRED_API_KEY` | string | The key used to protect your API service. Clients must provide this key when making requests. | Any string, defaults to `"123456"` |
| `SERVER_PORT` | number | The port number the server listens on. | Any valid port number, defaults to `3000` |
| `HOST` | string | The host address the server listens on. `localhost` only allows local access, `0.0.0.0` allows LAN or public network access. | Defaults to `"localhost"` |
| `MODEL_PROVIDER` | string | Specifies the backend model service provider to use. This is a core configuration that determines which platform API requests will be forwarded to. | Optional values: `"gemini-cli-oauth"`, `"openai-custom"`, `"claude-custom"`, `"openai-kiro-oauth"` |
| `OPENAI_API_KEY` | string | When `MODEL_PROVIDER` is `openai-custom`, you need to provide your OpenAI API key. | `null` |
| `OPENAI_BASE_URL` | string | When `MODEL_PROVIDER` is `openai-custom`, you can specify an OpenAI-compatible API address. | Defaults to `"https://api.openai.com/v1"` |
| `CLAUDE_API_KEY` | string | When `MODEL_PROVIDER` is `claude-custom`, you need to provide your Claude API key. | `null` |
| `CLAUDE_BASE_URL` | string | When `MODEL_PROVIDER` is `claude-custom`, you can specify a Claude-compatible API address. | Defaults to `"https://api.anthropic.com/v1"` |
| `KIRO_OAUTH_CREDS_BASE64` | string | (Kiro API mode) The Base64 encoded string of your Kiro OAuth credentials. | `null` |
| `KIRO_OAUTH_CREDS_FILE_PATH` | string | (Kiro API mode) The path to your Kiro OAuth credentials JSON file. | `null` |
| `GEMINI_OAUTH_CREDS_BASE64` | string | (Gemini-CLI mode) The Base64 encoded string of your Google OAuth credentials. | `null` |
| `GEMINI_OAUTH_CREDS_FILE_PATH` | string | (Gemini-CLI mode) The path to your Google OAuth credentials JSON file. | `null` |
| `PROJECT_ID` | string | (Gemini-CLI mode) Your Google Cloud project ID. | `null` |
| `SYSTEM_PROMPT_FILE_PATH` | string | The path to an external file for loading system prompts. | Defaults to `"input_system_prompt.txt"` |
| `SYSTEM_PROMPT_MODE` | string | The application mode for system prompts. `overwrite` will override the client's prompt, `append` will append to the end of the client's prompt. | Optional values: `"overwrite"`, `"append"` |
| `PROMPT_LOG_MODE` | string | The logging mode for requests and responses. `none` does not log, `console` prints to the console, `file` saves to a log file. | Optional values: `"none"`, `"console"`, `"file"` |
| `PROMPT_LOG_BASE_NAME` | string | When `PROMPT_LOG_MODE` is `file`, the base name for the generated log files. | Defaults to `"prompt_log"` |
| `REQUEST_MAX_RETRIES` | number | The maximum number of times to automatically retry when an API request fails. | Defaults to `3` |
| `REQUEST_BASE_DELAY` | number | The base delay time (in milliseconds) between automatic retries. The delay will increase after each retry. | Defaults to `1000` |

### 3. Start the Service

*   **Start with `config.json`** (recommended)
    ```bash
    node src/api-server.js
    ```
*   **Start with command-line arguments** (will override same-name configurations in `config.json`)
    *   **Start OpenAI proxy**:
        ```bash
        node src/api-server.js --model-provider openai-custom --openai-api-key sk-xxx
        ```
    *   **Start Claude proxy**:
        ```bash
        node src/api-server.js --model-provider claude-custom --claude-api-key sk-ant-xxx
        ```
    *   **Start Kiro API proxy**:
        ```bash
        node src/api-server.js --model-provider openai-kiro-oauth
        ```
    *   **Listen on all network interfaces and specify port and key** (for Docker or LAN access)
        ```bash
        node src/api-server.js --host 0.0.0.0 --port 8000 --api-key your_secret_key
        ```

*For more startup parameters, please refer to the comments at the top of the `src/api-server.js` file.*

---

### 4. Call the API

> **Hint**: If you are using this in an environment where you cannot directly access Google/OpenAI/Claude services, please set up a global HTTP/HTTPS proxy for your terminal first.

All requests use the standard OpenAI format.

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
        "model": "gemini-2.5-flash",
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
        "model": "claude-3-opus-20240229",
        "messages": [
          {"role": "user", "content": "Write a five-line poem about the universe"}
        ],
        "stream": true
      }'
    ```

---

## 🌟 Special Usage & Advanced Tips

*   **🔌 Connect to Any OpenAI Client**: This is the basic feature of this project. Point the API address of any application that supports OpenAI (like LobeChat, NextChat, VS Code extensions, etc.) to this service (`http://localhost:3000`) to seamlessly use all configured models.

*   **🔍 Centralized Request Monitoring & Auditing**: Set `"PROMPT_LOG_MODE": "file"` in `config.json` to capture all requests and responses and save them to a local log file. This is crucial for analyzing, debugging, and optimizing prompts, and even for building private datasets.

*   **💡 Dynamic System Prompts**:
    *   By setting `SYSTEM_PROMPT_FILE_PATH` and `SYSTEM_PROMPT_MODE` in `config.json`, you can control the behavior of system prompts more flexibly.
    *   **Supported Modes**:
        *   `override`: Completely ignores the client's system prompt and forces the use of the content from the file.
        *   `append`: Appends the content of the file to the end of the client's system prompt to supplement rules.
    *   This allows you to set unified base instructions for different clients while allowing individual applications for personalized extensions.

*   **🛠️ Foundation for Secondary Development**:
    *   **Add New Models**: Simply create a new provider directory under `src`, implement the `ApiServiceAdapter` interface and the corresponding strategies, and then register it in `adapter.js` and `common.js`.
    *   **Response Caching**: Add caching logic for frequently repeated questions to reduce API calls and improve response speed.
    *   **Custom Content Filtering**: Add keyword filtering or content review logic before requests are sent or returned to meet compliance requirements.

---

## 📄 License

This project is licensed under the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0). For details, please see the `LICENSE` file in the root directory.

## 🙏 Acknowledgements

The development of this project was greatly inspired by the official Google Gemini CLI, and referenced some code implementations from Cline 3.18.0's `gemini-cli.ts`. I would like to express my sincere gratitude to the official Google team and the Cline development team for their excellent work!
