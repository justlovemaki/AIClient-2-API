<div align="center">

<img src="src/img/logo-mid.webp" alt="logo"  style="width: 128px; height: 128px;margin-bottom: 3px;">

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

[**🔧 OpenClaw Config**](./docs/OPENCLAW_CONFIG_GUIDE.md) | [中文](./README-ZH.md) | [**👉 English**](./README.md) | [日本語](./README-JA.md) | [**📚 Documentation**](https://aiproxy.justlikemaki.vip/en/)

</div>

`AIClient2API` is an API proxy service that breaks through client limitations, converting free large models originally restricted to client use only (such as Gemini, Antigravity, Qwen Code, Kiro) into standard OpenAI-compatible interfaces that can be called by any application. Built on Node.js, it supports intelligent conversion between OpenAI, Claude, and Gemini protocols, enabling tools like Cherry-Studio, NextChat, and Cline to freely use advanced models such as Claude Opus 4.5, Gemini 3.0 Pro, and Qwen3 Coder Plus at scale. The project adopts a modular architecture based on strategy and adapter patterns, with built-in account pool management, intelligent polling, automatic failover, and health check mechanisms, ensuring 99.9% service availability.

> [!NOTE]
> **🎉 Important Milestone**
>
> - Thanks to Ruan Yifeng for the recommendation in [Weekly Issue 359](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html)
>
> **📅 Version Update Log**
>
> <details>
> <summary>Click to expand detailed version history</summary>
>
> - **2026.01.26** - Added Codex protocol support: supports OpenAI Codex OAuth authorization access
> - **2026.01.25** - Enhanced AI Monitor plugin: supports monitoring request parameters and responses before and after AI protocol conversion. Optimized log management: unified log format, visual configuration
> - **2026.01.15** - Optimized provider pool manager: added async refresh queue mechanism, buffer queue deduplication, global concurrency control, node warmup and automatic expiry detection
> - **2026.01.07** - Added iFlow protocol support, enabling access to Qwen, Kimi, DeepSeek, and GLM series models via OAuth authentication with automatic token refresh
> - **2026.01.03** - Added theme switching functionality and optimized provider pool initialization, removed the fallback strategy of using provider default configuration
> - **2025.12.30** - Added main process management and automatic update functionality
> - **2025.12.25** - Unified configuration management: All configs centralized to `configs/` directory. Docker users need to update mount path to `-v "local_path:/app/configs"`
> - **2025.12.11** - Automatically built Docker images are now available on Docker Hub: [justlikemaki/aiclient-2-api](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
> - **2025.11.30** - Added Antigravity protocol support, enabling access to Gemini 3 Pro, Claude Sonnet 4.5, and other models via Google internal interfaces
> - **2025.11.16** - Added Ollama protocol support, unified interface to access all supported models (Claude, Gemini, Qwen, OpenAI, etc.)
> - **2025.11.11** - Added Web UI management console, supporting real-time configuration management and health status monitoring
> - **2025.11.06** - Added support for Gemini 3 Preview, enhanced model compatibility and performance optimization
> - **2025.10.18** - Kiro open registration, new accounts get 500 credits, full support for Claude Sonnet 4.5
> - **2025.09.01** - Integrated Qwen Code CLI, added `qwen3-coder-plus` model support
> - **2025.08.29** - Released account pool management feature, supporting multi-account polling, intelligent failover, and automatic degradation strategies
>   - Configuration: Add `PROVIDER_POOLS_FILE_PATH` parameter in `configs/config.json`
>   - Reference configuration: [provider_pools.json](./configs/provider_pools.json.example)
> - **History Developed**
>   - Support Gemini CLI, Kiro and other client2API
>   - OpenAI, Claude, Gemini three-protocol mutual conversion, automatic intelligent switching
> </details>

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

- [💡 Core Advantages](#-core-advantages)
- [🚀 Quick Start](#-quick-start)
  - [🐳 Docker Deployment](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
  - [📋 Core Features](#-core-features)
- [🔐 Authorization Configuration Guide](#-authorization-configuration-guide)
- [📁 Authorization File Storage Paths](#-authorization-file-storage-paths)
- [🦙 Ollama Protocol Usage Examples](#-ollama-protocol-usage-examples)
- [⚙️ Advanced Configuration](#advanced-configuration)
- [❓ FAQ](#-faq)
- [📄 Open Source License](#-open-source-license)
- [🙏 Acknowledgements](#-acknowledgements)
- [⚠️ Disclaimer](#️-disclaimer)

---

## 🔧 Usage Instructions

### 🚀 Quick Start

The most recommended way to use AIClient-2-API is to start it through an automated script and configure it visually directly in the **Web UI console**.

#### 🐳 Docker Quick Start (Recommended)

```bash
docker run -d -p 3000:3000 -p 8085-8087:8085-8087 -p 1455:1455 -p 19876-19880:19876-19880 --restart=always -v "your_path:/app/configs" --name aiclient2api justlikemaki/aiclient-2-api
```

**Parameter Description**:
- `-d`: Run container in background
- `-p 3000:3000 ...`: Port mapping. 3000 is for Web UI, others are for OAuth callbacks (Gemini: 8085, Antigravity: 8086, iFlow: 8087, Codex: 1455, Kiro: 19876-19880)
- `--restart=always`: Container auto-restart policy
- `-v "your_path:/app/configs"`: Mount configuration directory (replace "your_path" with actual path, e.g., `/home/user/aiclient-configs`)
- `--name aiclient2api`: Container name

#### 🐳 Docker Compose Deployment

You can also use Docker Compose for deployment. First, navigate to the `docker` directory:

```bash
cd docker
mkdir -p configs
docker compose up -d
```

To build from source instead of using the pre-built image, edit `docker-compose.yml`:
1. Comment out the `image: justlikemaki/aiclient-2-api:latest` line
2. Uncomment the `build:` section
3. Run `docker compose up -d --build`

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
Seamlessly support the following latest large models, just configure the corresponding endpoint in Web UI or [`configs/config.json`](./configs/config.json):
*   **Claude 4.5 Opus** - Anthropic's strongest model ever, now supported via Kiro, Antigravity
*   **Gemini 3 Pro** - Google's next-generation architecture preview, now supported via Gemini, Antigravity
*   **Qwen3 Coder Plus** - Alibaba Tongyi Qianwen's latest code-specific model, now supported via Qwen Code
*   **Kimi K2 / MiniMax M2** - Synchronized support for top domestic flagship models, now supported via custom OpenAI, Claude

---

### 🔐 Authorization Configuration Guide

<details>
<summary>Click to expand detailed authorization configuration steps for each provider</summary>

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

#### Kiro Extended Thinking (Claude Models)
AIClient-2-API supports Kiro extended thinking when using Claude-compatible requests (`/v1/messages`) or OpenAI-compatible requests (`/v1/chat/completions`) routed to `claude-kiro-oauth`.

**Claude-compatible (`/v1/messages`)**:
```bash
curl http://localhost:3000/claude-kiro-oauth/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "thinking": { "type": "enabled", "budget_tokens": 10000 },
    "messages": [{ "role": "user", "content": "Solve this step by step." }]
  }'
```

**OpenAI-compatible (`/v1/chat/completions`)**:
```bash
curl http://localhost:3000/claude-kiro-oauth/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [{ "role": "user", "content": "Solve this step by step." }],
    "extra_body": {
      "anthropic": {
        "thinking": { "type": "enabled", "budget_tokens": 10000 }
      }
    }
  }'
```

**Adaptive mode**:
- Claude: `"thinking": { "type": "adaptive", "effort": "high" }`
- OpenAI: `"extra_body.anthropic.thinking": { "type": "adaptive", "effort": "high" }`

Notes:
- `budget_tokens` is clamped to `[1024, 24576]` (default `20000` if omitted/invalid).
- Token acquisition/refresh/pool rotation is unchanged.

#### iFlow OAuth Configuration
1. **First Authorization**: In Web UI's "Configuration" or "Provider Pools" page, click the "Generate Authorization" button for iFlow
2. **Phone Login**: The system will open the iFlow authorization page, complete login verification using your phone number
3. **Auto Save**: After successful authorization, the system will automatically obtain the API Key and save credentials
4. **Supported Models**: Qwen3 series, Kimi K2, DeepSeek V3/R1, GLM-4.6/4.7, etc.
5. **Auto Refresh**: The system will automatically refresh tokens when they are about to expire, no manual intervention required

#### Codex OAuth Configuration
1. **Generate Authorization**: On the Web UI "Provider Pools" or "Configuration" page, click the "Generate Authorization" button for Codex
2. **Browser Login**: The system opens the OpenAI Codex authorization page to complete OAuth login
3. **Auto Save**: After successful authorization, the system automatically saves the Codex OAuth credential file
4. **Callback Port**: Ensure the OAuth callback port `1455` is not occupied

#### Account Pool Management Configuration
1. **Create Pool Configuration File**: Create a configuration file referencing [provider_pools.json.example](./configs/provider_pools.json.example)
2. **Configure Pool Parameters**: Set `PROVIDER_POOLS_FILE_PATH` in `configs/config.json` to point to the pool configuration file
3. **Startup Parameter Configuration**: Use the `--provider-pools-file <path>` parameter to specify the pool configuration file path
4. **Health Check**: The system will automatically perform periodic health checks and avoid using unhealthy providers

</details>

### 📁 Authorization File Storage Paths

<details>
<summary>Click to expand default storage locations for authorization credentials</summary>

Default storage locations for authorization credential files of each service:

| Service | Default Path | Description |
|------|---------|------|
| **Gemini** | `~/.gemini/oauth_creds.json` | OAuth authentication credentials |
| **Kiro** | `~/.aws/sso/cache/kiro-auth-token.json` | Kiro authentication token |
| **Qwen** | `~/.qwen/oauth_creds.json` | Qwen OAuth credentials |
| **Antigravity** | `~/.antigravity/oauth_creds.json` | Antigravity OAuth credentials (supports Claude 4.5 Opus) |
| **iFlow** | `~/.iflow/oauth_creds.json` | iFlow OAuth credentials (supports Qwen, Kimi, DeepSeek, GLM) |
| **Codex** | `~/.codex/oauth_creds.json` | Codex OAuth credentials |

> **Note**: `~` represents the user home directory (Windows: `C:\Users\username`, Linux/macOS: `/home/username` or `/Users/username`)

> **Custom Path**: Can specify custom storage location via relevant parameters in configuration file or environment variables

</details>

---

### 🦙 Ollama Protocol Usage Examples

This project supports the Ollama protocol, allowing access to all supported models through a unified interface. The Ollama endpoint provides standard interfaces such as `/api/tags`, `/api/chat`, `/api/generate`, etc.

**Ollama API Call Examples**:

1. **List all available models**:
```bash
curl http://localhost:3000/ollama/api/tags \
  -H "Authorization: Bearer your-api-key"
```

2. **Chat interface**:
```bash
curl http://localhost:3000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
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

### Advanced Configuration

<details>
<summary>Click to expand proxy configuration, model filtering, and Fallback advanced settings</summary>

#### 1. Proxy Configuration

This project supports flexible proxy configuration, allowing you to configure a unified proxy for different providers or use provider-specific proxied endpoints.

**Configuration Methods**:

1. **Web UI Configuration** (Recommended): Convenient configuration management

  In the "Configuration" page of the Web UI, you can visually configure all proxy options:
  - **Unified Proxy**: Fill in the proxy address in the "Proxy Settings" area and check the providers that need to use the proxy
  - **Provider Endpoints**: In each provider's configuration area, directly modify the Base URL to a proxied endpoint
  - **Click "Save Configuration"**: Takes effect immediately without restarting the service

2. **Unified Proxy Configuration**: Configure a global proxy and specify which providers use it

   - **Web UI Configuration**: Fill in the proxy address in the "Proxy Settings" area of the "Configuration" page and check the providers that need to use the proxy
   - **Configuration File**: Configure in `configs/config.json`
   ```json
   {
     "PROXY_URL": "http://127.0.0.1:7890",
     "PROXY_ENABLED_PROVIDERS": [
       "gemini-cli-oauth",
       "gemini-antigravity",
       "claude-kiro-oauth"
     ]
   }
   ```

3. **Provider-Specific Proxied Endpoints**: Some providers (like OpenAI, Claude) support configuring proxied API endpoints

   - **Web UI Configuration**: In each provider's configuration area on the "Configuration" page, modify the corresponding Base URL
   - **Configuration File**: Configure in `configs/config.json`
   ```json
   {
     "OPENAI_BASE_URL": "https://your-proxy-endpoint.com/v1",
     "CLAUDE_BASE_URL": "https://your-proxy-endpoint.com"
   }
   ```

**Supported Proxy Types**:
- **HTTP Proxy**: `http://127.0.0.1:7890`
- **HTTPS Proxy**: `https://127.0.0.1:7890`
- **SOCKS5 Proxy**: `socks5://127.0.0.1:1080`

**Use Cases**:
- **Network-Restricted Environments**: Use in network environments where Google, OpenAI, and other services cannot be accessed directly
- **Hybrid Configuration**: Some providers use unified proxy, others use their own proxied endpoints
- **Flexible Switching**: Enable/disable proxy for specific providers at any time in the Web UI

**Notes**:
- Proxy configuration priority: Unified proxy configuration > Provider-specific endpoints > Direct connection
- Ensure the proxy service is stable and available, otherwise it may affect service quality
- SOCKS5 proxy usually performs better than HTTP proxy

#### 2. Model Filtering Configuration

Support excluding unsupported models through `notSupportedModels` configuration, the system will automatically skip these providers.

**Configuration**: Add `notSupportedModels` field for providers in `configs/provider_pools.json`:

```json
{
  "gemini-cli-oauth": [
    {
      "uuid": "provider-1",
      "notSupportedModels": ["gemini-3.0-pro", "gemini-3.5-flash"],
      "checkHealth": true
    }
  ]
}
```

**How It Works**:
- When requesting a specific model, the system automatically filters out providers that have configured the model as unsupported
- Only providers that support the model will be selected to handle the request

**Use Cases**:
- Some accounts cannot access specific models due to quota or permission restrictions
- Need to assign different model access permissions to different accounts

#### 3. Provider Priority Configuration

Support deterministic account ordering through a per-node `priority` field in `provider_pools.json`.

**Configuration** (smaller number = higher priority):

```json
{
  "claude-kiro-oauth": [
    {
      "uuid": "primary-node-uuid",
      "priority": 1,
      "checkHealth": true
    },
    {
      "uuid": "backup-node-uuid",
      "priority": 2,
      "checkHealth": true
    }
  ]
}
```

**How It Works**:
- The pool manager first filters healthy/available nodes by the lowest `priority` value
- Only nodes in that highest-priority tier participate in LRU/score-based balancing
- If the whole highest-priority tier becomes unavailable, the next priority tier is used automatically
- If `priority` is omitted or invalid, default `100` is applied (backward compatible behavior)

#### 4. Cross-Type Fallback Configuration

When all accounts under a Provider Type (e.g., `gemini-cli-oauth`) are exhausted due to 429 quota limits or marked as unhealthy, the system can automatically fallback to another compatible Provider Type (e.g., `gemini-antigravity`) instead of returning an error directly.

**Configuration**: Add `providerFallbackChain` configuration in `configs/config.json`:

```json
{
  "providerFallbackChain": {
    "gemini-cli-oauth": ["gemini-antigravity"],
    "gemini-antigravity": ["gemini-cli-oauth"],
    "claude-kiro-oauth": ["claude-custom"],
    "claude-custom": ["claude-kiro-oauth"]
  }
}
```

**How It Works**:
1. Try to select a healthy account from the primary Provider Type pool
2. If all accounts in that type are unhealthy or return 429:
   - Look up the configured fallback types
   - Check if the fallback type supports the requested model (protocol compatibility check)
   - Select a healthy account from the fallback type's pool
3. Supports multi-level degradation chains: `gemini-cli-oauth → gemini-antigravity → openai-custom`
4. Only returns an error if all fallback types are also unavailable

**Use Cases**:
- In batch task scenarios, the free RPD quota of a single Provider Type can be easily exhausted in a short time
- Through cross-type Fallback, you can fully utilize the independent quotas of multiple Providers, improving overall availability and throughput

**Notes**:
- Fallback only occurs between protocol-compatible types (e.g., between `gemini-*`, between `claude-*`)
- The system automatically checks if the target Provider Type supports the requested model

</details>

---

## ❓ FAQ

<details>
<summary>Click to expand FAQ and solutions (port occupation, Docker startup, 429 errors, etc.)</summary>

### 1. OAuth Authorization Failed

**Problem Description**: After clicking "Generate Authorization", the browser opens the authorization page but authorization fails or cannot be completed.

**Solutions**:
- **Check Network Connection**: Ensure you can access Google, Alibaba Cloud, and other services normally
- **Check Port Occupation**: OAuth callbacks require specific ports (Gemini: 8085, Antigravity: 8086, iFlow: 8087, Codex: 1455, Kiro: 19876-19880), ensure these ports are not occupied
- **Clear Browser Cache**: Try using incognito mode or clearing browser cache and retry
- **Check Firewall Settings**: Ensure the firewall allows access to local callback ports
- **Docker Users**: Ensure all OAuth callback ports are correctly mapped

### 2. Port Already in Use

**Problem Description**: When starting the service, it shows the port is already in use (e.g., `EADDRINUSE`).

**Solutions**:
```bash
# Windows - Find the process occupying the port
netstat -ano | findstr :3000
# Then use Task Manager to end the corresponding PID process

# Linux/macOS - Find and end the process occupying the port
lsof -i :3000
kill -9 <PID>
```

Or modify the port configuration in `configs/config.json` to use a different port.

### 3. Docker Container Won't Start

**Problem Description**: Docker container fails to start or exits immediately.

**Solutions**:
- **Check Logs**: `docker logs aiclient2api` to view error messages
- **Check Mount Path**: Ensure the local path in the `-v` parameter exists and has read/write permissions
- **Check Port Conflicts**: Ensure all mapped ports are not occupied on the host
- **Re-pull Image**: `docker pull justlikemaki/aiclient-2-api:latest`

### 4. Credential File Not Recognized

**Problem Description**: After uploading or configuring credential files, the system shows it cannot be recognized or format error.

**Solutions**:
- **Check File Format**: Ensure the credential file is valid JSON format
- **Check File Path**: Ensure the file path is correct, Docker users need to ensure the file is in the mounted directory
- **Check File Permissions**: Ensure the service has permission to read the credential file
- **Regenerate Credentials**: If credentials have expired, try re-authorizing via OAuth

### 5. Request Returns 429 Error

**Problem Description**: API requests frequently return 429 Too Many Requests error.

**Solutions**:
- **Configure Account Pool**: Add multiple accounts to `provider_pools.json`, enable polling mechanism
- **Configure Fallback**: Configure `providerFallbackChain` in `config.json` for cross-type degradation
- **Reduce Request Frequency**: Appropriately increase request intervals to avoid triggering rate limits
- **Wait for Quota Reset**: Free quotas usually reset daily or per minute

### 6. Model Unavailable or Returns Error

**Problem Description**: When requesting a specific model, it returns an error or shows the model is unavailable.

**Solutions**:
- **Check Model Name**: Ensure you're using the correct model name (case-sensitive)
- **Check Provider Support**: Confirm the currently configured provider supports that model
- **Check Account Permissions**: Some advanced models may require specific account permissions
- **Configure Model Filtering**: Use `notSupportedModels` to exclude unsupported models

### 7. Web UI Cannot Be Accessed

**Problem Description**: Browser cannot open `http://localhost:3000`.

**Solutions**:
- **Check Service Status**: Confirm the service has started successfully, check terminal output
- **Check Port Mapping**: Docker users ensure `-p 3000:3000` parameter is correct
- **Try Other Address**: Try accessing `http://127.0.0.1:3000`
- **Check Firewall**: Ensure the firewall allows access to port 3000

### 8. Streaming Response Interrupted

**Problem Description**: When using streaming output, the response is interrupted midway or incomplete.

**Solutions**:
- **Check Network Stability**: Ensure network connection is stable
- **Increase Timeout**: Increase request timeout in client configuration
- **Check Proxy Settings**: If using a proxy, ensure the proxy supports long connections
- **Check Service Logs**: Check for error messages

### 9. Configuration Changes Not Taking Effect

**Problem Description**: After modifying configuration in Web UI, service behavior doesn't change.

**Solutions**:
- **Refresh Page**: Refresh the Web UI page after modification
- **Check Save Status**: Confirm the configuration was saved successfully (check prompt messages)
- **Restart Service**: Some configurations may require service restart to take effect
- **Check Configuration File**: Directly check `configs/config.json` to confirm changes were written

### 10. API Returns 404

**Problem Description**: When calling API endpoints, it returns 404 Not Found error.

**Solutions**:
- **Check Endpoint Path**: Ensure you're using the correct endpoint path, such as `/v1/chat/completions`, `/ollama/api/chat`, etc.
- **Check Client Auto-completion**: Some clients (like Cherry-Studio, NextChat) automatically append paths (like `/v1/chat/completions`) after the Base URL, causing path duplication. Check the actual request URL in the console and remove redundant path parts
- **Check Service Status**: Confirm the service has started normally, visit `http://localhost:3000` to view Web UI
- **Check Port Configuration**: Ensure requests are sent to the correct port (default 3000)
- **View Available Routes**: Check "Interactive Routing Examples" on the Web UI dashboard page to see all available endpoints

### 11. Unauthorized: API key is invalid or missing

**Problem Description**: When calling API endpoints, it returns `Unauthorized: API key is invalid or missing.` error.

**Solutions**:
- **Check API Key Configuration**: Ensure API Key is correctly configured in `configs/config.json` or Web UI
- **Check Request Header Format**: Ensure the request contains the correct Authorization header format, such as `Authorization: Bearer your-api-key`
- **Check Service Logs**: View detailed error messages on the "Real-time Logs" page in Web UI to locate the specific cause

### 12. No available and healthy providers for type

**Problem Description**: When calling API, it returns `No available and healthy providers for type xxx` error.

**Solutions**:
- **Check Provider Status**: Check if providers of the corresponding type are in healthy status on the "Provider Pools" page in Web UI
- **Check Credential Validity**: Confirm OAuth credentials have not expired; if expired, regenerate authorization
- **Check Quota Limits**: Some providers may have reached free quota limits; wait for quota reset or add more accounts
- **Enable Fallback**: Configure `providerFallbackChain` in `config.json` to automatically switch to backup providers when the primary provider is unavailable
- **View Detailed Logs**: Check specific health check failure reasons on the "Real-time Logs" page in Web UI

### 13. Request Returns 403 Forbidden Error

**Problem Description**: API requests return 403 Forbidden error.

**Solutions**:
- **Check Node Status**: If you see the node status is normal (health check passed) on the "Provider Pools" page in Web UI, you can ignore this error as the system will handle it automatically
- **Check Account Permissions**: Confirm the account has permission to access the requested model or service
- **Check API Key Permissions**: Some providers' API Keys may have access scope restrictions; ensure the Key has sufficient permissions
- **Check Regional Restrictions**: Some services may have regional access restrictions; try using a proxy or VPN
- **Check Credential Status**: OAuth credentials may have been revoked or expired; try regenerating authorization
- **Check Request Frequency**: Some providers have strict request frequency limits; reduce request frequency and retry
- **View Provider Documentation**: Visit the official documentation of the corresponding provider to understand specific access restrictions and requirements

</details>

---

## 📄 Open Source License

This project follows the [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) license. For details, please check the `LICENSE` file in the root directory.

## 🙏 Acknowledgements

The development of this project was greatly inspired by the official Google Gemini CLI and referenced part of the code implementation of `gemini-cli.ts` in Cline 3.18.0. Sincere thanks to the Google official team and the Cline development team for their excellent work!

### Contributor List

Thanks to all the developers who contributed to the AIClient-2-API project:

[![Contributors](https://contrib.rocks/image?repo=justlovemaki/AIClient-2-API)](https://github.com/justlovemaki/AIClient-2-API/graphs/contributors)


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
