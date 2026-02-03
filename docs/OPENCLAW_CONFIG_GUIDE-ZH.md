# OpenClaw 配置指南

在 OpenClaw 中使用 AIClient-2-API 的快速配置指南。

---

## 前置准备

1. 启动 AIClient-2-API 服务
2. 在 Web UI (`http://localhost:3000`) 配置至少一个提供商
3. 记录配置文件中的 API Key
4. 安装 OpenClaw
   - Docker 版本：[justlikemaki/openclaw-docker-cn-im](https://hub.docker.com/r/justlikemaki/openclaw-docker-cn-im)
   - 或使用其他安装方式

---

## 配置方式

### 方式一：OpenAI 协议（推荐）

**适用场景**：使用 Gemini 模型

```json5
{
  env: {
    AICLIENT2API_KEY: "your-api-key"
  },
  agents: {
    defaults: {
      model: { primary: "aiclient2api/gemini-3-flash-preview" },
      models: {
        "aiclient2api/gemini-3-flash-preview": { alias: "Gemini 3 Flash" }
      }
    }
  },
  models: {
    mode: "merge",
    providers: {
      aiclient2api: {
        baseUrl: "http://localhost:3000/v1",
        apiKey: "${AICLIENT2API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "gemini-3-flash-preview",
            name: "Gemini 3 Flash Preview",
            reasoning: false,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1000000,
            maxTokens: 8192
          }
        ]
      }
    }
  }
}
```

### 方式二：Claude 协议

**适用场景**：使用 Claude 模型，需要 Prompt Caching 等特性

```json5
{
  env: {
    AICLIENT2API_KEY: "your-api-key"
  },
  agents: {
    defaults: {
      model: { primary: "aiclient2api/claude-sonnet-4-5" },
      models: {
        "aiclient2api/claude-sonnet-4-5": { alias: "Claude Sonnet 4.5" }
      }
    }
  },
  models: {
    mode: "merge",
    providers: {
      aiclient2api: {
        baseUrl: "http://localhost:3000",
        apiKey: "${AICLIENT2API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            reasoning: false,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192
          }
        ]
      }
    }
  }
}
```

---

## 指定提供商（可选）

通过路由参数指定特定提供商：

```json5
{
  models: {
    providers: {
      // Kiro 提供的 Claude (OpenAI 协议)
      "aiclient2api-kiro": {
        baseUrl: "http://localhost:3000/claude-kiro-oauth/v1",
        apiKey: "${AICLIENT2API_KEY}",
        api: "openai-completions",
        models: [...]
      },
      
      // Kiro 提供的 Claude (Claude 协议)
      "aiclient2api-kiro-claude": {
        baseUrl: "http://localhost:3000/claude-kiro-oauth",
        apiKey: "${AICLIENT2API_KEY}",
        api: "anthropic-messages",
        models: [...]
      },
      
      // Gemini CLI (OpenAI 协议)
      "aiclient2api-gemini": {
        baseUrl: "http://localhost:3000/gemini-cli-oauth/v1",
        apiKey: "${AICLIENT2API_KEY}",
        api: "openai-completions",
        models: [...]
      },
      
      // Antigravity (OpenAI 协议)
      "aiclient2api-antigravity": {
        baseUrl: "http://localhost:3000/gemini-antigravity/v1",
        apiKey: "${AICLIENT2API_KEY}",
        api: "openai-completions",
        models: [...]
      }
    }
  }
}
```

---

## 配置 Fallback

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "aiclient2api/claude-sonnet-4-5",
        fallbacks: [
          "aiclient2api/gemini-3-flash-preview"
        ]
      }
    }
  }
}
```

---

## 常用命令

```bash
# 列出所有模型
openclaw models list

# 切换模型
openclaw models set aiclient2api/claude-sonnet-4-5

# 使用指定模型对话
openclaw chat --model aiclient2api/gemini-3-flash-preview "你的问题"
```

---

## 协议对比

| 特性 | OpenAI 协议 | Claude 协议 |
|------|------------|------------|
| Base URL | `http://localhost:3000/v1` | `http://localhost:3000` |
| API 类型 | `openai-completions` | `anthropic-messages` |
| 支持模型 | 所有模型 | 仅 Claude |
| 特殊特性 | - | Prompt Caching、Extended Thinking |

---

## 常见问题

**Q: 连接失败？**
- 确认 AIClient-2-API 服务运行中
- 检查 Base URL 是否正确（OpenAI 协议需要 `/v1` 后缀）
- 尝试使用 `127.0.0.1` 替代 `localhost`

**Q: 401 错误？**
- 检查 API Key 是否正确配置
- 确认环境变量 `AICLIENT2API_KEY` 已设置

**Q: 模型不可用？**
- 在 AIClient-2-API Web UI 确认已配置对应提供商
- 运行 `openclaw gateway restart` 重启网关
- 运行 `openclaw models list` 验证模型列表

---

更多信息请参考 [AIClient-2-API 文档](../README-ZH.md)
