# OpenClaw 設定ガイド

OpenClaw で AIClient-2-API を使用するためのクイック設定ガイド。

---

## 前提条件

1. AIClient-2-API サービスを起動
2. Web UI (`http://localhost:3000`) で少なくとも1つのプロバイダーを設定
3. 設定ファイルから API Key を記録
4. OpenClaw をインストール
   - Docker バージョン：[justlikemaki/openclaw-docker-cn-im](https://hub.docker.com/r/justlikemaki/openclaw-docker-cn-im)
   - または他のインストール方法を使用

---

## 設定方法

### 方法1：OpenAI プロトコル（推奨）

**使用例**：Gemini モデルを使用する場合

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

### 方法2：Claude プロトコル

**使用例**：Prompt Caching などの機能を持つ Claude モデルを使用する場合

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

## プロバイダーの指定（オプション）

ルーティングパラメータで特定のプロバイダーを指定：

```json5
{
  models: {
    providers: {
      // Kiro Claude（OpenAI プロトコル）
      "aiclient2api-kiro": {
        baseUrl: "http://localhost:3000/claude-kiro-oauth/v1",
        apiKey: "${AICLIENT2API_KEY}",
        api: "openai-completions",
        models: [...]
      },
      
      // Kiro Claude（Claude プロトコル）
      "aiclient2api-kiro-claude": {
        baseUrl: "http://localhost:3000/claude-kiro-oauth",
        apiKey: "${AICLIENT2API_KEY}",
        api: "anthropic-messages",
        models: [...]
      },
      
      // Gemini CLI（OpenAI プロトコル）
      "aiclient2api-gemini": {
        baseUrl: "http://localhost:3000/gemini-cli-oauth/v1",
        apiKey: "${AICLIENT2API_KEY}",
        api: "openai-completions",
        models: [...]
      },
      
      // Antigravity（OpenAI プロトコル）
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

## フォールバックの設定

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

## よく使うコマンド

```bash
# すべてのモデルをリスト表示
openclaw models list

# モデルを切り替え
openclaw models set aiclient2api/claude-sonnet-4-5

# 特定のモデルでチャット
openclaw chat --model aiclient2api/gemini-3-flash-preview "あなたの質問"
```

---

## プロトコル比較

| 機能 | OpenAI プロトコル | Claude プロトコル |
|------|------------------|------------------|
| Base URL | `http://localhost:3000/v1` | `http://localhost:3000` |
| API タイプ | `openai-completions` | `anthropic-messages` |
| サポートモデル | すべてのモデル | Claude のみ |
| 特殊機能 | - | Prompt Caching、Extended Thinking |

---

## よくある質問

**Q: 接続に失敗しますか？**
- AIClient-2-API サービスが実行中であることを確認
- Base URL が正しいか確認（OpenAI プロトコルには `/v1` サフィックスが必要）
- `localhost` の代わりに `127.0.0.1` を使用してみる

**Q: 401 エラー？**
- API Key が正しく設定されているか確認
- 環境変数 `AICLIENT2API_KEY` が設定されているか確認

**Q: モデルが利用できない？**
- AIClient-2-API Web UI でプロバイダーが設定されているか確認
- `openclaw gateway restart` を実行してゲートウェイを再起動
- `openclaw models list` を実行してモデルリストを確認

---

詳細については、[AIClient-2-API ドキュメント](../README-JA.md) を参照してください
