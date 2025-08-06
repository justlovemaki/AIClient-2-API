<div align="center">

![logo](src/img/logo-min.webp)

# AIClient-2-API 🚀

**A powerful proxy that unifies multiple large model APIs (Gemini, OpenAI, Claude...) into a local OpenAI-compatible interface.**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)

[**中文**](./README.md) | [**English**](./README-EN.md)

</div>

> `AIClient2API` is a versatile and lightweight API proxy designed for ultimate flexibility and ease of use. It transforms various backend APIs, such as Google Gemini CLI OAuth, OpenAI, Claude, and Kiro, into a standard OpenAI format interface via a Node.js HTTP server. The project features a modern, modular architecture, supporting strategy and adapter patterns, complete with comprehensive test coverage and health check mechanisms. It's ready to use out-of-the-box: simply `npm install` and run. You can easily switch between model providers in the configuration file, allowing any OpenAI-compatible client or application to seamlessly use different large model capabilities through the same API address, eliminating the hassle of maintaining multiple configurations and dealing with incompatible interfaces for different services.

---

## 💡 Core Advantages

*   ✅ **Unified Access to Multiple Models**: One interface to access Gemini, OpenAI, Claude, Kimi K2, GLM-4.5, and other cutting-edge models. Freely switch between different model providers using simple startup parameters or request headers.
*   ✅ **Bypass Official Restrictions**: By supporting Gemini CLI's OAuth authorization method, it effectively circumvents the rate and quota limits of official free APIs, granting you higher request quotas and usage frequency.
*   ✅ **Bypass Client Restrictions**: Kiro API mode supports free usage of the Claude Sonnet 4 model.
*   ✅ **Seamless OpenAI Compatibility**: Provides an interface fully compatible with the OpenAI API, enabling your existing toolchains and clients (e.g., LobeChat, NextChat) to integrate all supported models at zero cost.
*   ✅ **Enhanced Controllability**: Powerful logging features allow you to capture and record all request prompts, facilitating auditing, debugging, and building private datasets.
*   ✅ **Extremely Easy to Extend**: Thanks to the new modular and strategy pattern design, adding a new model provider has never been simpler.
*   ✅ **Comprehensive Test Coverage**: Provides extensive integration and unit tests, ensuring the stability and reliability of all API endpoints and features.

---

## 📝 Project Architecture

Moving beyond a simple structure, we've implemented a more professional and extensible design, completely transforming the project:

*   **`src/api-server.js`**: 🚀 **Project Entry Point**
    *   As the project's central orchestrator, it's responsible for launching and managing the entire HTTP service, parsing command-line arguments, and loading all configurations.

*   **`src/adapter.js`**: 🔌 **Service Adapter**
    *   Adopts the classic adapter pattern, creating a unified interface for each AI service (Gemini, OpenAI, Claude, Kiro). Regardless of backend service variations, the main service interacts with them consistently.

*   **`src/provider-strategies.js`**: 🎯 **Provider Strategy Factory**
    *   Implements the strategy factory pattern, offering unified strategy interfaces for each API protocol (e.g., OpenAI, Gemini, Claude). These strategies precisely handle request parsing, response formatting, model name extraction, and all other protocol-specific details, ensuring seamless conversion between protocols.

*   **`src/provider-strategy.js`**: 🎯 **Strategy Base Class**
    *   Defines the foundational interface and common methods for all provider strategies, including core functionalities like system prompt management and content extraction.

*   **`src/convert.js`**: 🔄 **Format Conversion Hub**
    *   This is the core magic enabling "everything OpenAI-compatible." It precisely and losslessly converts data between different API protocol formats.

*   **`src/common.js`**: 🛠️ **Common Utility Library**
    *   Contains shared constants, utility functions, and common handlers for the project, leading to cleaner and more efficient code.

*   **`src/gemini/`, `src/openai/`, `src/claude/`**: 📦 **Provider Implementation Directories**
    *   Each directory encapsulates the core logic, API calls, and strategy implementations for its respective service provider, offering a clear structure that simplifies adding new service providers in the future. `src/claude/claude-kiro.js` specifically provides the Kiro API implementation.

*   **`tests/`**: 🧪 **Test Directory**
    *   Comprises a comprehensive integration test suite covering all API endpoints, authentication methods, and error handling scenarios, guaranteeing project stability and reliability. It supports independent testing for different providers and full HTTP integration tests.

### 🏗️ Architecture Design Patterns

The project leverages various modern design patterns to ensure code maintainability and extensibility:

*   **Adapter Pattern**: `src/adapter.js` provides a unified interface for diverse AI services.
*   **Strategy Pattern**: `src/provider-strategies.js` manages request/response conversion for different protocols.
*   **Factory Pattern**: Dynamically creates and manages service adapter instances.
*   **Singleton Pattern**: Caches and reuses service adapter instances.

### 🔄 Data Flow Processing

1.  **Request Reception**: The HTTP server receives client requests.
2.  **Authentication Validation**: Unified validation for multiple authentication methods.
3.  **Protocol Identification**: Recognizes the client protocol based on the endpoint and request headers.
4.  **Format Conversion**: Converts the request to the target provider's format.
5.  **Service Invocation**: Calls the specific AI service via the adapter.
6.  **Response Conversion**: Converts the service response back to the client's expected format.
7.  **Streaming Processing**: Supports real-time streaming response transmission.

### 🎨 Model Protocol and Provider Relationship Diagram


- OpenAI Protocol (P_OPENAI): Supports all MODEL_PROVIDERs, including openai-custom, gemini-cli-oauth, claude-custom, and
 claude-kiro-oauth.
- Claude Protocol (P_CLAUDE): Supports claude-custom, claude-kiro-oauth, and gemini-cli-oauth.
- Gemini Protocol (P_GEMINI): Supports gemini-cli-oauth.


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
       end
   
       P_OPENAI ---|支持| MP_OPENAI
       P_OPENAI ---|支持| MP_GEMINI
       P_OPENAI ---|支持| MP_CLAUDE_C
       P_OPENAI ---|支持| MP_CLAUDE_K
   
       P_GEMINI ---|支持| MP_GEMINI
   
       P_CLAUDE ---|支持| MP_CLAUDE_C
       P_CLAUDE ---|支持| MP_CLAUDE_K
       P_CLAUDE ---|支持| MP_GEMINI
   
       style P_OPENAI fill:#f9f,stroke:#333,stroke-width:2px
       style P_GEMINI fill:#ccf,stroke:#333,stroke-width:2px
       style P_CLAUDE fill:#cfc,stroke:#333,stroke-width:2px

  ```

---

### 🔧 Usage Instructions

*   **MCP Support**: While the built-in command functions of the original Gemini CLI are unavailable, this project fully supports MCP (Model Context Protocol), enabling powerful functional extensions when paired with MCP-compatible clients.
*   **Multimodal Capabilities**: Supports multimodal inputs like images and documents, offering a richer interactive experience.
*   **Latest Model Support**: Supports the latest **Kimi K2** and **GLM-4.5** models. Simply configure the corresponding OpenAI or Claude compatible interfaces in `config.json` for use.
*   **Kiro API**: Using the Kiro API requires [downloading the Kiro client](https://aibook.ren/archives/kiro-install) and completing authorized login to generate `kiro-auth-token.json`. **Recommended for optimal experience with Claude Code**.

---

## 🛠️ Key Features

#### General Features
*   🔐 **Smart Authentication & Token Renewal**: For services requiring OAuth (e.g., `gemini-cli-oauth`), the initial run guides you through browser authorization and automatically refreshes tokens.
*   🛡️ **Multiple Authentication Methods**: Supports `Authorization: Bearer <key>`, `x-goog-api-key`, `x-api-key` request headers, and URL query parameters for authentication.
*   ⚙️ **Highly Configurable**: Flexibly configure listening addresses, ports, API keys, model providers, and logging modes via `config.json` or command-line arguments.
*   📜 **Fully Controllable Logging System**: Can output timestamped prompt logs to the console or a file, and display remaining token validity.
*   🏥 **Health Check Mechanism**: Provides a `/health` endpoint for service status monitoring, returning service health and current configuration.

#### OpenAI Compatible Interface (`/v1/...`)
*   🌍 **Perfect Compatibility**: Implements the core `/v1/models` and `/v1/chat/completions` endpoints.
*   🔄 **Automatic Format Conversion**: Seamlessly converts requests/responses between different model formats and OpenAI format internally, supporting multimodal content.
*   💨 **Streaming Support**: Fully supports OpenAI's streaming responses (`"stream": true`), delivering a typewriter-like real-time experience.

#### Gemini Native Interface (`/v1beta/...`)
*   🎯 **Native Support**: Full support for Gemini API's native format and features.
*   🔧 **Advanced Features**: Supports system instructions, tool calls, multimodal input, and other advanced functionalities.
*   📊 **Detailed Statistics**: Provides comprehensive token usage statistics and model information.

#### Claude Native Interface (`/v1/messages`)
*   🤖 **Claude Dedicated**: Full support for Claude Messages API format.
*   🛠️ **Tool Integration**: Supports Claude's tool usage and function calling features.
*   🎨 **Multimodal**: Supports images, audio, and other input formats.

---

## 📦 Installation Guide

1.  **Environment Preparation**:
    *   Please ensure [Node.js](https://nodejs.org/) is installed (recommended version >= 20.0.0).
    *   This project already includes `package.json` and sets `{"type": "module"}`, eliminating manual creation.

2.  **Install Dependencies**:
    After cloning this repository, execute the following in the project root directory:
    ```bash
    npm install
    ```
    This will automatically install all necessary dependencies.

---

## 🚀 Quick Start

### 1. Configuration File (`config.json`)

We recommend using the `config.json` file for configuration management, offering greater clarity than lengthy command-line arguments.

First, manually create a `config.json` file and populate it with your configuration details.

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

The following table details all supported parameters in `config.json`:

| Parameter Name | Type | Description | Default/Optional Values |
| --- | --- | --- | --- |
| `REQUIRED_API_KEY` | string | Key to protect your API service. Clients must provide this key with requests. | Any string, defaults to `"123456"` |
| `SERVER_PORT` | number | Port number the server listens on. | Any valid port, defaults to `3000` |
| `HOST` | string | Host address the server listens on. `localhost` for local access, `0.0.0.0` for LAN/public access. | Defaults to `"localhost"` |
| `MODEL_PROVIDER` | string | Specifies backend model service provider. Core config determining API request forwarding. | Options: `"gemini-cli-oauth"`, `"openai-custom"`, `"claude-custom"`, `"claude-kiro-oauth"` |
| `OPENAI_API_KEY` | string | Required OpenAI API key when `MODEL_PROVIDER` is `openai-custom`. | `null` |
| `OPENAI_BASE_URL` | string | Optional OpenAI-compatible API address when `MODEL_PROVIDER` is `openai-custom`. | Defaults to `"https://api.openai.com/v1"` |
| `CLAUDE_API_KEY` | string | Required Claude API key when `MODEL_PROVIDER` is `claude-custom`. | `null` |
| `CLAUDE_BASE_URL` | string | Optional Claude-compatible API address when `MODEL_PROVIDER` is `claude-custom`. | Defaults to `"https://api.anthropic.com/v1"` |
| `KIRO_OAUTH_CREDS_BASE64` | string | (Kiro API Mode) Base64 encoded Kiro OAuth credentials string. | `null` |
| `KIRO_OAUTH_CREDS_FILE_PATH` | string | (Kiro API Mode) Path to your Kiro OAuth credentials JSON file. | `null` |
| `GEMINI_OAUTH_CREDS_BASE64` | string | (Gemini-CLI Mode) Base64 encoded Google OAuth credentials string. | `null` |
| `GEMINI_OAUTH_CREDS_FILE_PATH` | string | (Gemini-CLI Mode) Path to your Google OAuth credentials JSON file. | `null` |
| `PROJECT_ID` | string | (Gemini-CLI Mode) Your Google Cloud project ID. | `null` |
| `SYSTEM_PROMPT_FILE_PATH` | string | External file path for loading system prompts. | Defaults to `"input_system_prompt.txt"` |
| `SYSTEM_PROMPT_MODE` | string | System prompt application mode. `overwrite` overrides client prompt, `append` appends. | Options: `"overwrite"`, `"append"` |
| `PROMPT_LOG_MODE` | string | Logging mode for requests/responses. `none` (no log), `console` (to console), `file` (to log file). | Options: `"none"`, `"console"`, `"file"` |
| `PROMPT_LOG_BASE_NAME` | string | Base name for log files when `PROMPT_LOG_MODE` is `file`. | Defaults to `"prompt_log"` |
| `REQUEST_MAX_RETRIES` | number | Maximum number of automatic retries for failed API requests. | Defaults to `3` |
| `REQUEST_BASE_DELAY` | number | Base delay (milliseconds) between automatic retries. Delay increases with each retry. | Defaults to `1000` |

### 3. Start the Service

*   **Using `config.json`** (Recommended)
    ```bash
    node src/api-server.js
    ```
*   **Via Command-Line Arguments** (Overrides same-name settings in `config.json`)
    *   **Start OpenAI Proxy**:
        ```bash
        node src/api-server.js --model-provider openai-custom --openai-api-key sk-xxx
        ```
    *   **Start Claude Proxy**:
        ```bash
        node src/api-server.js --model-provider claude-custom --claude-api-key sk-ant-xxx
        ```
    *   **Start Kiro API Proxy**:
        ```bash
        node src/api-server.js --model-provider claude-kiro-oauth
        ```
    *   **Listen on all network interfaces, specify port and key** (for Docker or LAN access)
        ```bash
        node src/api-server.js --host 0.0.0.0 --port 8000 --api-key your_secret_key
        ```

*For more startup parameters, refer to the comments at the top of the `src/api-server.js` file.*

---

### 4. Call the API

> **Hint**: If you are using this in an environment where direct access to Google/OpenAI/Claude/Kiro services is unavailable, please set up a global HTTP/HTTPS proxy for your terminal first.

### HTTP Proxy Setup Commands for Different Terminal Environments

To ensure `AIClient2API` can access external AI services (e.g., Google, OpenAI, Claude, Kiro), you might need to configure an HTTP proxy in your terminal environment. Here are the proxy setup commands for various operating systems:

#### Linux / macOS
```bash
export HTTP_PROXY="http://your_proxy_address:port"
# If authentication is required for the proxy
# export HTTP_PROXY="http://username:password@your_proxy_address:port"
```
To make these settings permanent, add them to your shell configuration file (e.g., `~/.bashrc`, `~/.zshrc`, or `~/.profile`).

#### Windows (CMD)
```cmd
set HTTP_PROXY=http://your_proxy_address:port
:: If authentication is required for the proxy
:: set HTTP_PROXY=http://username:password@your_proxy_address:port
```
These settings are effective only for the current CMD session. For permanent configuration, set them via system environment variables.

#### Windows (PowerShell)
```powershell
$env:HTTP_PROXY="http://your_proxy_address:port"
# If authentication is required for the proxy
# $env:HTTP_PROXY="http://username:password@your_proxy_address:port"
```
These settings are effective only for the current PowerShell session. For permanent configuration, add them to your PowerShell profile (`$PROFILE`) or set them via system environment variables.

**Please replace `your_proxy_address` and `port` with your actual proxy address and port.**

---

### 🐳 Docker Deployment

The project supports Docker deployment. For a detailed guide, please refer to the [Docker Deployment Guide](./README.Docker.md).

---

All requests use the standard OpenAI format.

*   **Health Check**
    ```bash
    curl http://localhost:3000/health
    ```
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

*   **Multimodal Content Generation**
    ```bash
    curl http://localhost:3000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{
        "model": "gemini-2.5-flash",
        "messages": [
          {
            "role": "user",
            "content": [
              {"type": "text", "text": "Describe this image"},
              {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
            ]
          }
        ]
      }'
    ```

*   **Using Different Providers (via Path)**
    ```bash
    # Using Gemini
    curl http://localhost:3000/gemini-cli-oauth/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "Hello"}]}'
    
    # Using Claude
    curl http://localhost:3000/claude-custom/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer 123456" \
      -d '{"model": "claude-3-opus-20240229", "messages": [{"role": "user", "content": "Hello"}]}'
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

*   **🔌 Connect to Any OpenAI Client**: This is the fundamental feature of this project. Direct the API address of any OpenAI-compatible application (e.g., LobeChat, NextChat, VS Code extensions) to this service (`http://localhost:3000`) to seamlessly leverage all configured models.

*   **🔍 Centralized Request Monitoring & Auditing**: Set `"PROMPT_LOG_MODE": "file"` in `config.json` to capture all requests and responses and save them to a local log file. This is vital for analyzing, debugging, and optimizing prompts, and even for constructing private datasets.

*   **💡 Dynamic System Prompts**:
    *   By configuring `SYSTEM_PROMPT_FILE_PATH` and `SYSTEM_PROMPT_MODE` in `config.json`, you gain more flexible control over system prompt behavior.
    *   **Supported Modes**:
        *   `overwrite`: Completely ignores the client's system prompt, enforcing the content from the file.
        *   `append`: Appends the file's content to the end of the client's system prompt, supplementing existing rules.
    *   This allows you to establish consistent base instructions for various clients while enabling individual applications to personalize extensions.

*   **🛠️ Foundation for Secondary Development**:
    *   **Add New Models**: Simply create a new provider directory under `src`, implement the `ApiServiceAdapter` interface and corresponding strategies, and then register them in `adapter.js` and `common.js`.
    *   **Response Caching**: Implement caching logic for frequently repeated queries to reduce API calls and enhance response speed.
    *   **Custom Content Filtering**: Introduce keyword filtering or content review logic before sending or returning requests to ensure compliance.

---

## 📄 Open Source License

This project operates under the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0). For complete details, please refer to the `LICENSE` file located in the root directory.

## 🙏 Acknowledgements

The development of this project was significantly inspired by the official Google Gemini CLI and incorporated some code implementations from Cline 3.18.0's `gemini-cli.ts`. We extend our sincere gratitude to the official Google team and the Cline development team for their exceptional work!

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=justlovemaki/AIClient-2-API&type=Timeline)](https://www.star-history.com/#justlovemaki/AIClient-2-API&Timeline)
