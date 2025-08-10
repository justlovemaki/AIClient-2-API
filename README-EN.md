<div align="center">

![logo](src/img/logo-min.webp)

# AIClient-2-API 🚀

**A powerful proxy that unifies multiple large model APIs (Gemini, OpenAI, Claude...) into a local OpenAI-compatible interface.**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![docker](https://img.shields.io/badge/docker-≥20.0.0-green.svg)](https://aiproxy.justlikemaki.vip/en/docs/installation/docker-deployment.html)

[**中文**](./README.md) | [**English**](./README-EN.md) | [**More Detailed Documentation**](https://aiproxy.justlikemaki.vip/)

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
*   **Kiro API**: Using the Kiro API requires [downloading the Kiro client](https://aibook.ren/archives/kiro-install) and completing authorized login to generate `kiro-auth-token.json`. **Recommended for optimal experience with Claude Code**. Note: New users who encounter **429** errors when using the service indicate that the Kiro service is **no longer available**, and may need to wait until Kiro fully opens registration before being able to use it.

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
