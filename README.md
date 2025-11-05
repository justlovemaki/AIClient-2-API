<div align="center">

![logo](src/img/logo-min.webp)

# AIClient-2-API 🚀

**A powerful proxy that can unify the requests of various large model APIs (Gemini CLI, Qwen Code Plus, Kiro Claude...) that are only used within the client into a local OpenAI compatible interface.**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-≥20.0.0-blue.svg)](https://aiproxy.justlikemaki.vip/en/docs/installation/docker-deployment.html)


[**中文**](./README-ZH.md) | [**English**](./README.md) | [**日本語**](./README-JA.md) | [**📚 Complete Documentation**](https://aiproxy.justlikemaki.vip/en/)

</div>

`AIClient2API` is an API proxy service that breaks through client limitations, converting free large models originally restricted to client use only (such as Gemini CLI, Qwen Code Plus, Kiro Claude) into standard OpenAI-compatible interfaces that can be called by any application. Built on Node.js, it supports intelligent conversion between three major protocols (OpenAI, Claude, Gemini), enabling tools like Cherry-Studio, NextChat, and Cline to freely use advanced models such as Claude Sonnet 4.5, Gemini 2.5 Flash, and Qwen3 Coder Plus at scale. The project adopts a modular architecture based on strategy and adapter patterns, with built-in account pool management, intelligent polling, automatic failover, and health check mechanisms, ensuring 99.9% service availability.

> [!NOTE]
> **🎉 Important Milestone**
>
> - Thanks to Ruan Yifeng for the recommendation in [Weekly Issue 359](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html)
>
> **📅 Version Update Log**
>
> - **2025.10.18** - Kiro open registration, new accounts get 500 credits, full support for Claude Sonnet 4.5
> - **2025.09.01** - Integrated Qwen Code CLI, added `qwen3-coder-plus` model support
> - **2025.08.29** - Released account pool management feature, supporting multi-account polling, intelligent failover, and automatic degradation strategies
>   - Configuration: Add `PROVIDER_POOLS_FILE_PATH` parameter in config.json
>   - Reference configuration: [provider_pools.json](./provider_pools.json.example)

---

## 💡 Core Advantages

### 🎯 Unified Access, One-Stop Management
*   **Multi-Model Unified Interface**: Through standard OpenAI-compatible protocol, configure once to access mainstream large models including Gemini, Claude, GPT, Qwen Code, Kimi K2, GLM-4.6
*   **Flexible Switching Mechanism**: Support dynamic model switching via startup parameters, Path routing, or environment variables to meet different scenario requirements
*   **Zero-Cost Migration**: Fully compatible with OpenAI API specifications, tools like Cherry-Studio, NextChat, Cline can be used without modification
*   **Multi-Protocol Intelligent Conversion**: Support intelligent conversion between OpenAI, Claude, and Gemini protocols for cross-protocol model invocation
    *   Call Claude models using OpenAI protocol: Use `claude-custom` or `claude-kiro-oauth` providers
    *   Call Gemini models using OpenAI protocol: Use `gemini-cli-oauth` provider
    *   Call Gemini models using Claude protocol: Use `gemini-cli-oauth` provider
    *   Call OpenAI models using Claude protocol: Use `openai-custom` or `openai-qwen-oauth` providers

### 🚀 Break Through Limitations, Improve Efficiency
*   **Bypass Official Restrictions**: Utilize OAuth authorization mechanism to effectively break through rate and quota limits of free APIs like Gemini
*   **Free Advanced Models**: Use Claude Sonnet 4.5 for free via Kiro API mode, use Qwen3 Coder Plus via Qwen OAuth mode, reducing usage costs
*   **Intelligent Account Pool Scheduling**: Support multi-account polling, automatic failover, and configuration degradation, ensuring 99.9% service availability

### 🛡️ Secure and Controllable, Data Transparent
*   **Full-Chain Log Recording**: Capture all request and response data, supporting auditing and debugging
*   **Private Dataset Construction**: Quickly build proprietary training datasets based on log data
*   **System Prompt Management**: Support override and append modes, achieving perfect combination of unified base instructions and personalized extensions

### 🔧 Developer-Friendly, Easy to Extend
*   **Modular Architecture**: Based on strategy and adapter patterns, adding new model providers requires only 3 steps
*   **Complete Test Coverage**: Integration and unit test coverage 90%+, ensuring code quality
*   **Containerized Deployment**: Provides Docker support, one-click deployment, cross-platform operation
*   **MCP Protocol Support**: Perfectly compatible with Model Context Protocol, easily extend functionality

---

## 📑 Quick Navigation

- [🐳 Docker Deployment](https://aiproxy.justlikemaki.vip/en/docs/installation/docker-deployment.html)
- [🎨 Model Protocol and Provider Relationship Diagram](#-model-protocol-and-provider-relationship-diagram)
- [🔧 Usage Instructions](#-usage-instructions)
- [🚀 Project Startup Parameters](#-project-startup-parameters)
- [📄 Open Source License](#-open-source-license)
- [🙏 Acknowledgements](#-acknowledgements)
- [⚠️ Disclaimer](#-disclaimer)

---

## 🎨 Model Protocol and Provider Relationship Diagram

This project supports multiple model providers through different protocols. The following is an overview of their relationships:

*   **OpenAI Protocol (P_OPENAI)**: Implemented by `openai-custom`, `gemini-cli-oauth`, `claude-custom`, `claude-kiro-oauth`, and `openai-qwen-oauth` model providers.
*   **Claude Protocol (P_CLAUDE)**: Implemented by `claude-custom`, `claude-kiro-oauth`, `gemini-cli-oauth`, `openai-custom`, and `openai-qwen-oauth` model providers.
*   **Gemini Protocol (P_GEMINI)**: Implemented by `gemini-cli-oauth` model provider.

Detailed relationship diagram:

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

### 📋 Core Features

#### MCP Protocol Support
This project is fully compatible with **Model Context Protocol (MCP)**, enabling seamless integration with MCP-supporting clients for powerful functional extensions.

#### Multimodal Input Capabilities
Supports various input types including images and documents, providing richer interactive experiences and more powerful application scenarios.

#### Latest Model Support
Seamlessly supports the following latest large models, simply configure the corresponding OpenAI or Claude compatible interface in [`config.json`](./config.json):
*   **Kimi K2** - Moonshot AI's latest flagship model
*   **GLM-4.5** - Zhipu AI's latest version
*   **Qwen Code** - Alibaba Tongyi Qianwen code-specific model

---

### 🔐 Authorization Configuration Guide

#### Gemini CLI OAuth Configuration
1. **Obtain OAuth Credentials**: Visit [Google Cloud Console](https://console.cloud.google.com/) to create a project and enable Gemini API
2. **First Authorization**: After using Gemini service, the command line will print Google authorization page, copy the page to browser for authorization, then return to command line
3. **Credential Storage**: After successful authorization, `oauth_creds.json` file will be automatically generated and saved to `~/.gemini` directory
4. **Project Configuration**: Need to provide a valid Google Cloud project ID, can be specified via startup parameter `--project-id`

#### Qwen Code OAuth Configuration
1. **First Authorization**: After starting the service, the system will automatically open the authorization page in the browser
2. **Credential Storage**: After successful authorization, `oauth_creds.json` file will be automatically generated and saved to `~/.qwen` directory
3. **Recommended Parameters**: Use official default parameters for best results
   ```json
   {
     "temperature": 0,
     "top_p": 1
   }
   ```

#### Kiro API Configuration
1. **Environment Preparation**: [Download and install Kiro client](https://aibook.ren/archives/kiro-install)
2. **Complete Authorization**: Log in to your account in the client to generate `kiro-auth-token.json` credential file
3. **Best Practice**: Recommended to use with **Claude Code** for optimal experience
4. **Important Notice**: Kiro service usage policy has been updated, please visit the official website for the latest usage restrictions and terms

#### OpenAI Responses API
*   **Application Scenario**: Suitable for scenarios requiring structured dialogue using OpenAI Responses API, such as Codex
*   **Configuration Method**:
    *   Method 1: Set `MODEL_PROVIDER` to `openaiResponses-custom` in [`config.json`](./config.json)
    *   Method 2: Use startup parameter `--model-provider openaiResponses-custom`
    *   Method 3: Use path routing `/openaiResponses-custom`
*   **Required Parameters**: Provide valid API key and base URL

---

### 🔄 Model Provider Switching

This project provides two flexible model switching methods to meet different usage scenario requirements.

#### Method 1: Startup Parameter Switching

Specify the default model provider via command line parameters:

```bash
# Use Gemini provider
node src/api-server.js --model-provider gemini-cli-oauth --project-id your-project-id

# Use Claude Kiro provider
node src/api-server.js --model-provider claude-kiro-oauth

# Use Qwen provider
node src/api-server.js --model-provider openai-qwen-oauth
```

**Available Model Provider Identifiers**:
- `openai-custom` - Standard OpenAI API
- `claude-custom` - Official Claude API
- `gemini-cli-oauth` - Gemini CLI OAuth
- `claude-kiro-oauth` - Kiro Claude OAuth
- `openai-qwen-oauth` - Qwen Code OAuth
- `openaiResponses-custom` - OpenAI Responses API

#### Method 2: Path Routing Switching (Recommended)

Achieve instant switching by specifying provider identifier in API request path:

| Route Path | Description | Use Case |
|---------|------|---------|
| `/claude-custom` | Use Claude API from config file | Official Claude API calls |
| `/claude-kiro-oauth` | Access Claude via Kiro OAuth | Free use of Claude Sonnet 4.5 |
| `/openai-custom` | Use OpenAI provider to handle requests | Standard OpenAI API calls |
| `/gemini-cli-oauth` | Access via Gemini CLI OAuth | Break through Gemini free limits |
| `/openai-qwen-oauth` | Access via Qwen OAuth | Use Qwen Code Plus |
| `/openaiResponses-custom` | OpenAI Responses API | Structured dialogue scenarios |

**Usage Examples**:
```bash
# Configure in programming agents like Cline, Kilo
API_ENDPOINT=http://localhost:3000/claude-kiro-oauth

# Direct API call
curl http://localhost:3000/gemini-cli-oauth/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.0-flash-exp","messages":[...]}'```

---

### 📁 Authorization File Storage Paths

Default storage locations for authorization credential files of each service:

| Service | Default Path | Description |
|------|---------|------|
| **Gemini** | `~/.gemini/oauth_creds.json` | OAuth authentication credentials |
| **Kiro** | `~/.aws/sso/cache/kiro-auth-token.json` | Kiro authentication token |
| **Qwen** | `~/.qwen/oauth_creds.json` | Qwen OAuth credentials |

> **Note**: `~` represents the user home directory (Windows: `C:\Users\username`, Linux/macOS: `/home/username` or `/Users/username`)
>
> **Custom Path**: Can specify custom storage location via relevant parameters in configuration file or environment variables

---

## 🚀 Project Startup Parameters

This project supports rich command-line parameter configuration, allowing flexible adjustment of service behavior as needed. The following is a detailed explanation of all startup parameters, displayed in functional groups:

### 🔧 Server Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--host` | string | localhost | Server listening address |
| `--port` | number | 3000 | Server listening port |
| `--api-key` | string | 123456 | API key for authentication |

### 🤖 Model Provider Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--model-provider` | string | gemini-cli-oauth | AI model provider, optional values: openai-custom, claude-custom, gemini-cli-oauth, claude-kiro-oauth, openai-qwen-oauth |

### 🧠 OpenAI Compatible Provider Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--openai-api-key` | string | null | OpenAI API key (required when `model-provider` is `openai-custom`) |
| `--openai-base-url` | string | null | OpenAI API base URL (required when `model-provider` is `openai-custom`) |

### 🖥️ Claude Compatible Provider Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--claude-api-key` | string | null | Claude API key (required when `model-provider` is `claude-custom`) |
| `--claude-base-url` | string | null | Claude API base URL (required when `model-provider` is `claude-custom`) |

### 🔐 Gemini OAuth Authentication Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--gemini-oauth-creds-base64` | string | null | Base64 string of Gemini OAuth credentials (optional when `model-provider` is `gemini-cli-oauth`, choose one with `--gemini-oauth-creds-file`) |
| `--gemini-oauth-creds-file` | string | null | Gemini OAuth credentials JSON file path (optional when `model-provider` is `gemini-cli-oauth`, choose one with `--gemini-oauth-creds-base64`) |
| `--project-id` | string | null | Google Cloud project ID (required when `model-provider` is `gemini-cli-oauth`) |

### 🎮 Kiro OAuth Authentication Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--kiro-oauth-creds-base64` | string | null | Base64 string of Kiro OAuth credentials (optional when `model-provider` is `claude-kiro-oauth`, choose one with `--kiro-oauth-creds-file`) |
| `--kiro-oauth-creds-file` | string | null | Kiro OAuth credentials JSON file path (optional when `model-provider` is `claude-kiro-oauth`, choose one with `--kiro-oauth-creds-base64`) |

### 🐼 Qwen OAuth Authentication Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--qwen-oauth-creds-file` | string | null | Qwen OAuth credentials JSON file path (required when `model-provider` is `openai-qwen-oauth`) |

### 🔄 OpenAI Responses API Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--model-provider` | string | openaiResponses-custom | Model provider, set to `openaiResponses-custom` when using OpenAI Responses API |
| `--openai-api-key` | string | null | OpenAI API key (required when `model-provider` is `openaiResponses-custom`) |
| `--openai-base-url` | string | null | OpenAI API base URL (required when `model-provider` is `openaiResponses-custom`) |

### 📝 System Prompt Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--system-prompt-file` | string | input_system_prompt.txt | System prompt file path |
| `--system-prompt-mode` | string | overwrite | System prompt mode, optional values: overwrite (override), append (append) |

### 📊 Log Configuration Parameters

| Parameter | Type | Default Value | Description |
|------|------|--------|------|
| `--log-prompts` | string | none | Prompt log mode, optional values: console (console), file (file), none (none) |
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

# Use OpenAI Responses API provider
node src/api-server.js --model-provider openaiResponses-custom --openai-api-key sk-xxx --openai-base-url https://api.openai.com/v1

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