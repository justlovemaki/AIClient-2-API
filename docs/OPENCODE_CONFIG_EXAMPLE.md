# OpenCode 配置示例及重点解释

本文档提供了一个典型的 `opencode` 配置文件示例，并对其中的关键配置项进行了详细解释，帮助您快速理解如何配置不同的 AI 服务提供商。

## 配置示例 (`config.json`)

```json
{
    "plugin": [],
    "provider": {
        "kiro": {
            "npm": "@ai-sdk/anthropic",
            "name": "AIClient2API-kiro",
            "options": {
                "baseURL": "http://localhost:3000/claude-kiro-oauth/v1",
                "apiKey": "123456"
            },
            "models": {
                "claude-opus-4-5": {
                    "name": "Claude Opus 4.5 Kiro"
                },
                "claude-sonnet-4-5-20250929": {
                    "name": "Claude Sonnet 4.5 Kiro"
                }
            }
        },
        "qwen": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "AIClient2API-qwen",
            "options": {
                "baseURL": "http://localhost:3000/openai-qwen-oauth/v1",
                "apiKey": "123456"
            },
            "models": {
                "qwen3-coder-plus": {
                    "name": "Qwen3 Coder Plus Openai "
                }
            }
        },
        "gemini-antigravity": {
            "npm": "@ai-sdk/google",
            "name": "AIClient2API-antigravity",
            "options": {
                "baseURL": "http://localhost:3000/gemini-antigravity/v1beta",
                "apiKey": "123456"
            },
            "models": {
                "gemini-2.5-flash-preview": {
                    "name": "gemini-2.5-flash-antigravity"
                },
                "gemini-3-flash-preview": {
                    "name": "gemini-3-flash-antigravity"
                },
                "gemini-3-pro-preview": {
                    "name": "gemini-3-pro-antigravity"
                }
            }
        },
        "gemini-cli": {
            "npm": "@ai-sdk/google",
            "name": "AIClient2API-geminicli",
            "options": {
                "baseURL": "http://localhost:3000/v1beta",
                "apiKey": "123456"
            },
            "models": {
                "gemini-2.5-flash-preview": {
                    "name": "gemini-2.5-flash-geminicli"
                },
                "gemini-3-flash-preview": {
                    "name": "gemini-3-flash-geminicli"
                },
                "gemini-3-pro-preview": {
                    "name": "gemini-3-pro-geminicli"
                }
            }
        }
    },
    "$schema": "https://opencode.ai/config.json"
}
```

## 配置重点解释

### 1. `provider` (服务提供商配置)
这是配置的核心部分，每个键（如 `kiro`, `qwen`, `gemini-cli`）代表一个独立的服务提供商实例。

*   **`npm` (SDK 适配器)**:
    *   指定底层使用的 AI SDK。例如：
        *   `@ai-sdk/anthropic`: 用于 Anthropic (Claude) 系列模型。
        *   `@ai-sdk/openai-compatible`: 用于兼容 OpenAI 接口标准的模型（如通义千问 Qwen）。
        *   `@ai-sdk/google`: 用于 Google Gemini 系列模型。
    *   **重点**: 必须确保 `npm` 字段与您要使用的模型协议匹配，否则会导致连接失败。

*   **`options` (连接参数)**:
    *   **`baseURL`**: API 的访问地址。在示例中，许多是内网或中转地址（如 `http://localhost:3000/...`）。
    *   **`apiKey`**: 访问 API 所需的身份验证密钥。

*   **`models` (模型映射)**:
    *   定义该提供商下可用的模型列表。
    *   **键名 (ID)**: 实际调用时使用的模型 ID（例如 `claude-opus-4-5`）。
    *   **`name`**: 在 UI 界面上显示的友好名称。
    *   **重点**: 这里的键名必须与服务端实际支持的模型标识符一致。

### 2. 区分同类型的不同实例
在示例中，有两个 `gemini` 相关的配置：`gemini-antigravity` 和 `gemini-cli`。
*   它们虽然都使用 `@ai-sdk/google`，但通过不同的 `baseURL` 区分。
*   这允许您在同一配置中接入来自不同网关或环境的同类模型，并通过自定义的 `name`（如 `gemini-2.5-flash-antigravity` vs `gemini-2.5-flash-geminicli`）在前端进行区分。

### 3. `$schema`
*   用于提供 JSON 模式验证。在支持的编辑器（如 VS Code）中，它可以为您提供自动补全和实时错误检查。
