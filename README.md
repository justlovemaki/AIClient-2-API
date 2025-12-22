<div align="center">

<img src="src/img/logo-min.webp" alt="logo"  style="width: 128px; height: 128px;margin-bottom: 3px;">

# AIClient-2-API 🚀

**A powerful proxy that can unify the requests of various client-only large model APIs (Gemini CLI, Antigravity, Qwen Code, Kiro ...), simulate requests, and encapsulate them into a local OpenAI-compatible interface.**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-≥20.0.0-blue.svg)](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
[![GitHub stars](https://img.shields.io/github/stars/justlovemaki/AIClient-2-API.svg?style=flat&label=Star)](https://github.com/justlovemaki/AIClient-2-API/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/justlovemaki/AIClient-2-API.svg)](https://github.com/justlovemaki/AIClient-2-API/issues)

[中文](./README-ZH.md) | [**👉 English**](./README.md) | [日本語](./README-JA.md) | [**📚 Documentation**](https://aiproxy.justlikemaki.vip/en/)

</div>

`AIClient2API` is an API proxy service that breaks through client limitations, converting free large models originally restricted to client use only (such as Gemini, Antigravity, Qwen Code, Kiro) into standard OpenAI-compatible interfaces that can be called by any application. Built on Node.js, it supports intelligent conversion between OpenAI, Claude, and Gemini protocols, enabling tools like Cherry-Studio, NextChat, and Cline to freely use advanced models such as Claude Opus 4.5, Gemini 3.0 Pro, and Qwen3 Coder Plus at scale. The project adopts a modular architecture based on strategy and adapter patterns, with built-in account pool management, intelligent polling, automatic failover, and health check mechanisms, ensuring 99.9% service availability.

> [!NOTE]
> **🎉 Important Milestone**
>
> - Thanks to Ruan Yifeng for the recommendation in [Weekly Issue 359](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html)
>
> **📅 Version Update Log**
>
> - **2025.12.11** - Automatically built Docker images are now available on Docker Hub: [justlikemaki/aiclient-2-api](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
> - **2025.11.30** - Added Antigravity protocol support, enabling access to Gemini 3 Pro, Claude Sonnet 4.5, and other models via Google internal interfaces
> - **2025.11.16** - Added Ollama protocol support, unified interface to access all supported models (Claude, Gemini, Qwen, OpenAI, etc.)
> - **2025.11.11** - Added Web UI management console, supporting real-time configuration management and health status monitoring
> - **2025.11.06** - Added support for Gemini 3 Preview, enhanced model compatibility and performance optimization
> - **2025.10.18** - Kiro open registration, new accounts get 500 credits, full support for Claude Sonnet 4.5
> - **2025.09.01** - Integrated Qwen Code CLI, added `qwen3-coder-plus` model support
> - **2025.08.29** - Released account pool management feature, supporting multi-account polling, intelligent failover, and automatic degradation strategies
>   - Configuration: Add `PROVIDER_POOLS_FILE_PATH` parameter in config.json
>   - Reference configuration: [provider_pools.json](./provider_pools.json.example)
> - **History Developed**
>   - Support Gemini CLI, Kiro and other client2API
>   - OpenAI, Claude, Gemini three-protocol mutual conversion, automatic intelligent switching

---

## 💡 Core Advantages

### 🎯 Unified Access, One-Stop Management
*   **Multi-Model Unified Interface**: Through standard OpenAI-compatible protocol, configure once to access mainstream large models including Gemini, Claude, Qwen Code, Kimi K2, MiniMax M2
*   **Flexible Switching Mechanism**: Path routing, support dynamic model switching via startup parameters or environment variables to meet different scenario requirements
*   **Zero-Cost Migration**: Fully compatible with OpenAI API specifications, tools like Cherry-Studio, NextChat, Cline can be used without modification
*   **Multi-Protocol Intelligent Conversion**: Support intelligent conversion between OpenAI, Claude, and Gemini protocols for cross-protocol model invocation

### 🚀 Break Through Limitations, Improve Efficiency
*   **Bypass Official Restrictions**: Utilize OAuth authorization mechanism to effectively break through rate and quota limits of services like Gemini, Antigravity
*   **Free Advanced Models**: Use Claude Opus 4.5 for free via Kiro API mode, use Qwen3 Coder Plus via Qwen OAuth mode, reducing usage costs
*   **Intelligent Account Pool Scheduling**: Support multi-account polling, automatic failover, and configuration degradation, ensuring 99.9% service availability

### 🛡️ Secure and Controllable, Data Transparent
*   **Full-Chain Log Recording**: Capture all request and response data, supporting auditing and debugging
*   **Private Dataset Construction**: Quickly build proprietary training datasets based on log data
*   **System Prompt Management**: Support override and append modes, achieving perfect combination of unified base instructions and personalized extensions

### 🔧 Developer-Friendly, Easy to Extend
*   **Web UI Management Console**: Real-time configuration management, health status monitoring, API testing and log viewing
*   **Modular Architecture**: Based on strategy and adapter patterns, adding new model providers requires only 3 steps
*   **Complete Test Coverage**: Integration and unit test coverage 90%+, ensuring code quality
*   **Containerized Deployment**: Provides Docker support, one-click deployment, cross-platform operation

---

## 📑 Quick Navigation

- [🐳 Docker Deployment](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
- [🔧 Usage Instructions](#-usage-instructions)
- [📄 Open Source License](#-open-source-license)
- [🙏 Acknowledgements](#-acknowledgements)
- [⚠️ Disclaimer](#-disclaimer)

---

## 🔧 Usage Instructions

### 🚀 Quick Start

The most recommended way to use AIClient-2-API is to start it through an automated script and configure it visually directly in the **Web UI console**.

#### 1. Run the startup script
*   **Linux/macOS**: `chmod +x install-and-run.sh && ./install-and-run.sh`
*   **Windows**: Double-click `install-and-run.bat`

#### 2. Access the console
After the server starts, open your browser and visit:
👉 [**http://localhost:3000**](http://localhost:3000)

> **Default Password**: `admin123` (can be changed in the console or by modifying the `pwd` file after login)

#### 3. Visual Configuration (Recommended)
Go to the **"Configuration"** page, you can:
*   ✅ Fill in the API Key for each provider or upload OAuth credential files
*   ✅ Switch default model providers in real-time
*   ✅ Monitor health status and real-time request logs

#### Script Execution Example
```
========================================
  AI Client 2 API Quick Install Script
========================================

[Check] Checking if Node.js is installed...
✅ Node.js is installed, version: v20.10.0
✅ Found package.json file
✅ node_modules directory already exists
✅ Project file check completed

========================================
  Starting AI Client 2 API Server...
========================================

🌐 Server will start on http://localhost:3000
📖 Visit http://localhost:3000 to view management interface
⏹️  Press Ctrl+C to stop server
```

> **💡 Tip**: The script will automatically install dependencies and start the server. If you encounter any issues, the script provides clear error messages and suggested solutions.

---

### 📋 Core Features

#### Web UI Management Console

![Web UI](src/img/en.png)

A functional Web management interface, including:

**📊 Dashboard**: System overview, interactive routing examples, client configuration guide

**⚙️ Configuration**: Real-time parameter modification, supporting all providers (Gemini, Antigravity, OpenAI, Claude, Kiro, Qwen), including advanced settings and file uploads

**🔗 Provider Pools**: Monitor active connections, provider health statistics, enable/disable management

**📁 Config Files**: Centralized OAuth credential management, supporting search filtering and file operations

**📜 Real-time Logs**: Real-time display of system and request logs, with management controls

**🔐 Login Verification**: Default password `admin123`, can be modified via `pwd` file

Access: `http://localhost:3000` → Login → Sidebar navigation → Take effect immediately

#### Multimodal Input Capabilities
Supports various input types such as images and documents, providing you with a richer interaction experience and more powerful application scenarios.

#### Latest Model Support
Seamlessly support the following latest large models, just configure the corresponding endpoint in Web UI or [`config.json`](./config.json):
*   **Claude 4.5 Opus** - Anthropic's strongest model ever, now supported via Kiro, Antigravity
*   **Gemini 3 Pro** - Google's next-generation architecture preview, now supported via Gemini, Antigravity
*   **Qwen3 Coder Plus** - Alibaba Tongyi Qianwen's latest code-specific model, now supported via Qwen Code
*   **Kimi K2 / MiniMax M2** - Synchronized support for top domestic flagship models, now supported via custom OpenAI, Claude

---

### 🔐 Authorization Configuration Guide

> **💡 Tip**: For the best experience, it is recommended to manage authorization visually through the **Web UI console**.

#### 🌐 Web UI Quick Authorization (Recommended)
In the Web UI management interface, you can complete authorization configuration rapidly:
1. **Generate Authorization**: On the **"Provider Pools"** page or **"Configuration"** page, click the **"Generate Authorization"** button in the upper right corner of the corresponding provider (e.g., Gemini, Qwen).
2. **Scan/Login**: An authorization dialog will pop up, you can click **"Open in Browser"** for login verification. For Qwen, just complete the web login; for Gemini and Antigravity, complete the Google account authorization.
3. **Auto-Save**: After successful authorization, the system will automatically obtain credentials and save them to the corresponding directory in `configs/`. You can see the newly generated credentials on the **"Config Files"** page.
4. **Visual Management**: You can upload or delete credentials at any time in the Web UI, or use the **"Quick Associate"** function to bind existing credential files to providers with one click.

#### Gemini CLI OAuth Configuration
1. **Obtain OAuth Credentials**: Visit [Google Cloud Console](https://console.cloud.google.com/) to create a project and enable Gemini API
2. **Project Configuration**: You may need to provide a valid Google Cloud project ID, which can be specified via the startup parameter `--project-id`
3. **Ensure Project ID**: When configuring in the Web UI, ensure the project ID entered matches the project ID displayed in the Google Cloud Console and Gemini CLI.

#### Antigravity OAuth Configuration
1. **Personal Account**: Personal accounts require separate authorization, application channels have been closed.
2. **Pro Member**: Antigravity is temporarily open to Pro members, you need to purchase a Pro membership first.
3. **Organization Account**: Organization accounts require separate authorization, contact the administrator to obtain authorization.

#### Qwen Code OAuth Configuration
1. **First Authorization**: After configuring the Qwen service, the system will automatically open the authorization page in the browser
2. **Recommended Parameters**: Use official default parameters for best results
   ```json
   {
     "temperature": 0,
     "top_p": 1
   }
   ```

#### Kiro API Configuration
1. **Environment Preparation**: [Download and install Kiro client](https://kiro.dev/pricing/)
2. **Complete Authorization**: Log in to your account in the client to generate `kiro-auth-token.json` credential file
3. **Best Practice**: Recommended to use with **Claude Code** for optimal experience
4. **Important Notice**: Kiro service usage policy has been updated, please visit the official website for the latest usage restrictions and terms

#### Account Pool Management Configuration
1. **Create Pool Configuration File**: Create a configuration file referencing [provider_pools.json.example](./provider_pools.json.example)
2. **Configure Pool Parameters**: Set `PROVIDER_POOLS_FILE_PATH` in config.json to point to the pool configuration file
3. **Startup Parameter Configuration**: Use the `--provider-pools-file <path>` parameter to specify the pool configuration file path
4. **Health Check**: The system will automatically perform periodic health checks and avoid using unhealthy providers

---

### 📁 Authorization File Storage Paths

Default storage locations for authorization credential files of each service:

| Service | Default Path | Description |
|------|---------|------|
| **Gemini** | `~/.gemini/oauth_creds.json` | OAuth authentication credentials |
| **Kiro** | `~/.aws/sso/cache/kiro-auth-token.json` | Kiro authentication token |
| **Qwen** | `~/.qwen/oauth_creds.json` | Qwen OAuth credentials |
| **Antigravity** | `~/.antigravity/oauth_creds.json` | Antigravity OAuth credentials (supports Claude 4.5 Opus) |

> **Note**: `~` represents the user home directory (Windows: `C:\Users\username`, Linux/macOS: `/home/username` or `/Users/username`)
>
> **Custom Path**: Can specify custom storage location via relevant parameters in configuration file or environment variables

---

### 🦙 Ollama Protocol Usage Examples

This project supports the Ollama protocol, allowing access to all supported models through a unified interface. The Ollama endpoint provides standard interfaces such as `/api/tags`, `/api/chat`, `/api/generate`, etc.

**Ollama API Call Examples**:

1. **List all available models**:
```bash
curl http://localhost:3000/ollama/api/tags
```

2. **Chat interface**:
```bash
curl http://localhost:3000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "[Claude] claude-sonnet-4.5",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

3. **Specify provider using model prefix**:
- `[Kiro]` - Access Claude models using Kiro API
- `[Claude]` - Use official Claude API
- `[Gemini CLI]` - Access via Gemini CLI OAuth
- `[OpenAI]` - Use official OpenAI API
- `[Qwen CLI]` - Access via Qwen OAuth

---

## 📄 Open Source License

This project follows the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) license. For details, please check the `LICENSE` file in the root directory.

## 🙏 Acknowledgements

The development of this project was greatly inspired by the official Google Gemini CLI and referenced part of the code implementation of `gemini-cli.ts` in Cline 3.18.0. Sincere thanks to the Google official team and the Cline development team for their excellent work!

### Contributor List

Thanks to all the developers who contributed to the AIClient-2-API project:

[![Contributors](https://contrib.rocks/image?repo=justlovemaki/AIClient-2-API)](https://github.com/justlovemaki/AIClient-2-API/graphs/contributors)

### Sponsor List

We are grateful for the support from our sponsors:

- [**Cigarliu**](https://github.com/Cigarliu "9.9")
- [**xianengqi**](https://github.com/xianengqi "9.9")
- [**3831143avl**](https://github.com/3831143avl "10")
- [**醉春风**](https://github.com/handsometong "28.8")
- [**crazy**](https://github.com/404 "88")

### 🌟 Star History


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
