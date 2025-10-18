<div align="center">

![logo](src/img/logo-min.webp)

# AIClient-2-API 🚀

**A powerful proxy that can unify the requests of various large model APIs (Gemini CLI, Qwen Code Plus, Kiro Claude...) that are only used within the client into a local OpenAI compatible interface.**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![docker](https://img.shields.io/badge/docker-≥20.0.0-green.svg)](https://aiproxy.justlikemaki.vip/en/docs/installation/docker-deployment.html)

[**中文**](./README.md) | [**English**](./README-EN.md) | [**日本語**](./README-JA.md) | [**More Detailed Documentation**](https://aiproxy.justlikemaki.vip/en/)

</div>

`AIClient2API` is a versatile and lightweight API proxy designed for developers, providing abundant free API request quotas and comprehensive support for mainstream large models including Google Gemini, Qwen Code, and Claude. It transforms various backend APIs into a standard OpenAI format interface via a Node.js HTTP server. The project features a modern, modular architecture, supporting strategy and adapter patterns, complete with comprehensive test coverage and health check mechanisms. It's ready to use out-of-the-box: simply `npm install` and run. You can easily switch between model providers in the configuration file, allowing any OpenAI-compatible client or application to seamlessly use different large model capabilities through the same API address, eliminating the hassle of maintaining multiple configurations and dealing with incompatible interfaces for different services.

> [!NOTE]
> Thanks to Ruan Yifeng for the recommendation in [Weekly Issue 359](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html).
>
> 8.29 Added account pool mode, which supports multiple accounts for all providers, with built-in polling, failover (requires client retry), and configuration degradation. Requires adding PROVIDER_POOLS_FILE_PATH to config, see the configuration file: provider_pools.json for details.
>
> 9.1 Added Qwen Code CLI support, can use qwen3-coder-plus model
> 
> 10.18 Kiro open registration, new accounts get 500 credits, now supports Claude Sonnet4.5

---

## 💡 Core Advantages

*   ✅ **Unified Access to Multiple Models**: One interface to access Gemini, OpenAI, Claude, Kimi K2, GLM-4.5, Qwen Code, and other cutting-edge models. Freely switch between different model providers using simple startup parameters or request headers.
*   ✅ **Bypass Official Restrictions**: By supporting Gemini CLI's OAuth authorization method, it effectively circumvents the rate and quota limits of official free APIs, granting you higher request quotas and usage frequency.
*   ✅ **Bypass Client Restrictions**: Kiro API mode supports free usage of the Claude Sonnet 4.5 model.
*   ✅ **Seamless OpenAI Compatibility**: Provides an interface fully compatible with the OpenAI API, enabling your existing toolchains and clients (e.g., LobeChat, NextChat) to integrate all supported models at zero cost.
*   ✅ **Intelligent Account Pool Management**: Supports multi-account polling, failover, and configuration degradation, ensuring high service availability and effectively avoiding single account limitations.
*   ✅ **Enhanced Controllability**: Powerful logging features allow you to capture and record all request prompts, facilitating auditing, debugging, and building private datasets.
*   ✅ **Extremely Easy to Extend**: Thanks to the new modular and strategy pattern design, adding a new model provider has never been simpler.
*   ✅ **Comprehensive Test Coverage**: Provides extensive integration and unit tests, ensuring the stability and reliability of all API endpoints and features.
*   ✅ **Docker Support**: Provides complete Docker containerization support for rapid deployment and environment isolation.

---

## 📑 Quick Navigation

- [🐳 Docker Deployment](https://aiproxy.justlikemaki.vip/en/docs/installation/docker-deployment.html)
- [🎨 Model Protocol and Provider Relationship Diagram](#-model-protocol-and-provider-relationship-diagram)
- [🔧 Usage Instructions](#-usage-instructions)
- [💻 Proxy Settings](#-proxy-settings)
- [🌟 Special Usage & Advanced Tips](#-special-usage--advanced-tips)
- [🚀 Project Startup Parameters](#-project-startup-parameters)
- [📄 Open Source License](#-open-source-license)
- [🙏 Acknowledgements](#-acknowledgements)
- [⚠️ Disclaimer](#-disclaimer)

---

## 🎨 Model Protocol and Provider Relationship Diagram

- OpenAI Protocol (P_OPENAI): Supports all MODEL_PROVIDERs, including openai-custom, gemini-cli-oauth, claude-custom, claude-kiro-oauth and openai-qwen-oauth.
- Claude Protocol (P_CLAUDE): Supports claude-custom, claude-kiro-oauth, gemini-cli-oauth, openai-custom and openai-qwen-oauth.
- Gemini Protocol (P_GEMINI): Supports gemini-cli-oauth.

  ```mermaid
  
   graph TD
       subgraph Core_Protocols["Core Protocols"]
           P_OPENAI[OpenAI Protocol]
           P_GEMINI[Gemini Protocol]
           P_CLAUDE[Claude Protocol]
       end
   
       subgraph Supported_Model_Providers["Supported Model Providers"]
           MP_OPENAI[openai-custom]
           MP_GEMINI[gemini-cli-oauth]
           MP_CLAUDE_C[claude-custom]
           MP_CLAUDE_K[claude-kiro-oauth]
           MP_QWEN[openai-qwen-oauth]
       end
   
       P_OPENAI ---|Support| MP_OPENAI
       P_OPENAI ---|Support| MP_QWEN
       P_OPENAI ---|Support| MP_GEMINI
       P_OPENAI ---|Support| MP_CLAUDE_C
       P_OPENAI ---|Support| MP_CLAUDE_K
   
       P_GEMINI ---|Support| MP_GEMINI
   
       P_CLAUDE ---|Support| MP_CLAUDE_C
       P_CLAUDE ---|Support| MP_CLAUDE_K
       P_CLAUDE ---|Support| MP_GEMINI
       P_CLAUDE ---|Support| MP_OPENAI
       P_CLAUDE ---|Support| MP_QWEN
   
       style P_OPENAI fill:#f9f,stroke:#333,stroke-width:2px
       style P_GEMINI fill:#ccf,stroke:#333,stroke-width:2px
       style P_CLAUDE fill:#cfc,stroke:#333,stroke-width:2px

  ```

---

## 🔧 Usage Instructions

*   **MCP Support**: While the built-in command functions of the original Gemini CLI are unavailable, this project fully supports MCP (Model Context Protocol), enabling powerful functional extensions when paired with MCP-compatible clients.
*   **Multimodal Capabilities**: Supports multimodal inputs like images and documents, offering a richer interactive experience.
*   **Latest Model Support**: Supports the latest **Kimi K2**, **GLM-4.5** and **Qwen Code** models. Simply configure the corresponding OpenAI or Claude compatible interfaces in `config.json` for use.
*   **Qwen Code Support**: Using Qwen Code will automatically open an authorization page in the browser. After completing authorization, it will generate an `oauth_creds.json` file in the `~/.qwen` directory. Please use the official default parameters temperature=0 and top_p=1.
*   **Kiro API**: Using the Kiro API requires [downloading the Kiro client](https://aibook.ren/archives/kiro-install) and completing authorized login to generate `kiro-auth-token.json`. **Recommended for optimal experience with Claude Code**. Note: Kiro service policy has been adjusted, please check official announcements for specific usage limitations.
*   **Using Different Providers in Claude Code**: Via Path routing, you can use different providers in Claude-related API calls:
    *   `http://localhost:3000/claude-custom` - Use the Claude API provider defined in the configuration file
    *   `http://localhost:3000/claude-kiro-oauth` - Access the Claude API using Kiro OAuth authentication
    *   `http://localhost:3000/openai-custom` - Use the OpenAI custom provider to handle Claude requests
    *   `http://localhost:3000/gemini-cli-oauth` - Use the Gemini CLI OAuth provider to handle Claude requests
    *   `http://localhost:3000/openai-qwen-oauth` - Use the Qwen OAuth provider to handle Claude requests
    *   Each provider can be configured with different API keys, base URLs, and other parameters for flexible provider switching

    These Path routes can not only be used in direct API calls but also in programming agents like Cline and Kilo. By specifying different paths, you can invoke the corresponding models. For example, when configuring API endpoints in a programming agent, you can use `http://localhost:3000/claude-kiro-oauth` to invoke the Claude model authenticated via Kiro OAuth, or use `http://localhost:3000/gemini-cli-oauth` to invoke the Gemini model.

    Besides switching providers via Path routing, you can also configure Claude parameters by setting environment variables. For instance, when using the `http://localhost:3000/claude-custom` path route, you can configure via the following environment variables:

    *   `ANTHROPIC_BASE_URL`: Set the base URL path for the Claude API
    *   `ANTHROPIC_AUTH_TOKEN`: Set the authentication token for the Claude service
    *   `ANTHROPIC_MODEL`: Set the Claude model to be used

    #### Environment Variable Setting Methods for Different Systems

    When using the `http://localhost:3000/claude-custom` path, you can set environment variables as follows:

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

### Default Authorization File Paths

The following are the default storage paths for authorization files for each service:

*   **Gemini**: `~/.gemini/oauth_creds.json`
*   **Kiro**: `~/.aws/sso/cache/kiro-auth-token.json`
*   **Qwen**: `~/.qwen/oauth_creds.json`

Where `~` represents the user's home directory. If you need to customize the paths, you can set them through configuration files or environment variables.

---

## 💻 Proxy Settings

> **Hint**: If you are using this in an environment where direct access to Google/OpenAI/Claude/Kiro services is unavailable, please set up an HTTP proxy for your terminal first, do not set up an HTTPS proxy.

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

## 🌟 Special Usage & Advanced Tips

*   **🔌 Connect to Any OpenAI Client**: This is the fundamental feature of this project. Direct the API address of any OpenAI-compatible application (e.g., LobeChat, NextChat, VS Code extensions) to this service (`http://localhost:3000`) to seamlessly leverage all configured models.

*   **🔍 Centralized Request Monitoring & Auditing**: Set `"PROMPT_LOG_MODE": "file"` in `config.json` to capture all requests and responses and save them to a local log file. This is vital for analyzing, debugging, and optimizing prompts, and even for constructing private datasets.

*   **💡 Dynamic System Prompts**:
    *   By configuring `SYSTEM_PROMPT_FILE_PATH` and `SYSTEM_PROMPT_MODE` in `config.json`, you gain more flexible control over system prompt behavior.
    *   **Supported Modes**:
        *   `override`: Completely ignores the client's system prompt, enforcing the content from the file.
        *   `append`: Appends the file's content to the end of the client's system prompt, supplementing existing rules.
    *   This allows you to establish consistent base instructions for various clients while enabling individual applications to personalize extensions.

*   **🛠️ Foundation for Secondary Development**:
    *   **Add New Models**: Simply create a new provider directory under `src`, implement the `ApiServiceAdapter` interface and corresponding strategies, and then register them in `adapter.js` and `common.js`.
    *   **Response Caching**: Implement caching logic for frequently repeated queries to reduce API calls and enhance response speed.
    *   **Custom Content Filtering**: Introduce keyword filtering or content review logic before sending or returning requests to ensure compliance.

*   **🎯 Advanced Account Pool Configuration**:
    *   **Multi-Account Management**: Configure multiple accounts for each provider through the `provider_pools.json` file, enabling intelligent polling.
    *   **Failover**: When an account becomes unavailable, the system automatically switches to the next available account, ensuring service continuity.
    *   **Configuration Degradation**: Dynamically adjust configuration parameters based on account status to optimize resource usage efficiency.
    *   **Usage Example**: Refer to the `provider_pools.json` configuration file in the project to easily set up a multi-account environment.

---

## 🚀 Project Startup Parameters

This project supports rich command-line parameter configuration, allowing flexible adjustment of service behavior as needed. The following is a detailed explanation of all startup parameters, displayed in functional groups:

### 🔧 Server Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--host` | string | localhost | Server listening address |
| `--port` | number | 3000 | Server listening port |
| `--api-key` | string | 123456 | API key required for authentication |

### 🤖 Model Provider Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--model-provider` | string | gemini-cli-oauth | AI model provider, optional values: openai-custom, claude-custom, gemini-cli-oauth, claude-kiro-oauth, openai-qwen-oauth |

### 🧠 OpenAI Compatible Provider Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--openai-api-key` | string | null | OpenAI API key (for openai-custom provider) |
| `--openai-base-url` | string | null | OpenAI API base URL (for openai-custom provider) |

### 🖥️ Claude Compatible Provider Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--claude-api-key` | string | null | Claude API key (for claude-custom provider) |
| `--claude-base-url` | string | null | Claude API base URL (for claude-custom provider) |

### 🔐 Gemini OAuth Authentication Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--gemini-oauth-creds-base64` | string | null | Base64 string of Gemini OAuth credentials |
| `--gemini-oauth-creds-file` | string | null | Gemini OAuth credentials JSON file path |
| `--project-id` | string | null | Google Cloud project ID (for gemini-cli provider) |

### 🎮 Kiro OAuth Authentication Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--kiro-oauth-creds-base64` | string | null | Base64 string of Kiro OAuth credentials |
| `--kiro-oauth-creds-file` | string | null | Kiro OAuth credentials JSON file path |

### 🐼 Qwen OAuth Authentication Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--qwen-oauth-creds-file` | string | null | Qwen OAuth credentials JSON file path |

### 📝 System Prompt Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--system-prompt-file` | string | input_system_prompt.txt | System prompt file path |
| `--system-prompt-mode` | string | overwrite | System prompt mode, optional values: overwrite, append |

### 📊 Log Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--log-prompts` | string | none | Prompt log mode, optional values: console, file, none |
| `--prompt-log-base-name` | string | prompt_log | Prompt log file base name |

### 🔄 Retry Mechanism Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--request-max-retries` | number | 3 | Maximum number of automatic retries when API requests fail |
| `--request-base-delay` | number | 1000 | Base delay time (milliseconds) between automatic retries, delay increases after each retry |

### ⏰ Scheduled Task Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--cron-near-minutes` | number | 15 | Interval time (minutes) for OAuth token refresh task schedule |
| `--cron-refresh-token` | boolean | true | Whether to enable automatic OAuth token refresh task |

### 🎯 Account Pool Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--provider-pools-file` | string | null | Provider account pool configuration file path |

### Usage Examples

```bash
# Basic usage
node src/api-server.js

# Specify port and API key
node src/api-server.js --port 8080 --api-key my-secret-key

# Use OpenAI provider
node src/api-server.js --model-provider openai-custom --openai-api-key sk-xxx --openai-base-url https://api.openai.com/v1

# Use Claude provider
node src/api-server.js --model-provider claude-custom --claude-api-key sk-ant-xxx --claude-base-url https://api.anthropic.com

# Use Gemini provider (Base64 credentials)
node src/api-server.js --model-provider gemini-cli-oauth --gemini-oauth-creds-base64 eyJ0eXBlIjoi... --project-id your-project-id

# Use Gemini provider (credentials file)
node src/api-server.js --model-provider gemini-cli-oauth --gemini-oauth-creds-file /path/to/credentials.json --project-id your-project-id

# Configure system prompt
node src/api-server.js --system-prompt-file custom-prompt.txt --system-prompt-mode append

# Configure logging
node src/api-server.js --log-prompts console
node src/api-server.js --log-prompts file --prompt-log-base-name my-logs

# Complete example
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

## 📄 Open Source License

This project operates under the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0). For complete details, please refer to the `LICENSE` file located in the root directory.

## 🙏 Acknowledgements

The development of this project was significantly inspired by the official Google Gemini CLI and incorporated some code implementations from Cline 3.18.0's `gemini-cli.ts`. We extend our sincere gratitude to the official Google team and the Cline development team for their exceptional work!

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=justlovemaki/AIClient-2-API&type=Timeline)](https://www.star-history.com/#justlovemaki/AIClient-2-API&Timeline)

---

## ⚠️ Disclaimer

### Usage Risk Warning
This project (AIClient-2-API) is for learning and research purposes only. Users assume all risks when using this project. The author is not responsible for any direct, indirect, or consequential losses resulting from the use of this project.

### Third-Party Service Responsibility Statement
This project is an API proxy tool and does not provide any AI model services. All AI model services are provided by their respective third-party providers (such as Google, OpenAI, Anthropic, etc.). Users should comply with the terms of service and policies of each third-party service when accessing them through this project. The author is not responsible for the availability, quality, security, or legality of third-party services.

### Data Privacy Statement
This project runs locally and does not collect or upload any user data. However, users should protect their API keys and other sensitive information when using this project. It is recommended that users regularly check and update their API keys and avoid using this project in insecure network environments.

### Legal Compliance Reminder
Users should comply with the laws and regulations of their country/region when using this project. It is strictly prohibited to use this project for any illegal purposes. Any consequences resulting from users' violation of laws and regulations shall be borne by the users themselves.
