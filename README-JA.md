<div align="center">

![logo](src/img/logo-min.webp)

# AIClient-2-API 🚀

**複数のクライアント専用大規模言語モデルAPI（Gemini CLI、Qwen Code Plus、Kiro Claude...）を模擬リクエストし、ローカルのOpenAI互換インターフェースに統一的にラッピングする強力なプロキシ。**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![docker](https://img.shields.io/badge/docker-≥20.0.0-green.svg)](https://aiproxy.justlikemaki.vip/zh/docs/installation/docker-deployment.html)


[**中文**](./README.md) | [**English**](./README-EN.md) | [**日本語**](./README-JA.md) | [**詳細ドキュメント**](https://aiproxy.justlikemaki.vip/)

</div>

`AIClient2API` は開発者向けに作られた多機能で軽量なAPIプロキシです。大量の無料APIリクエスト枠を提供し、Gemini、Qwen Code、Claudeなどの主要な大規模言語モデルを完全にサポートします。Node.js HTTPサーバーを通じて、複数のバックエンドAPIを標準的なOpenAI形式のインターフェースに統一的に変換します。本プロジェクトは最新のモジュラーアーキテクチャを採用し、ストラテジーパターンとアダプターパターンをサポートし、完全なテストカバレッジとヘルスチェック機構を備えています。`npm install` 後すぐに使用できます。設定ファイルでモデルプロバイダーを簡単に切り替えるだけで、OpenAI互換のクライアントやアプリケーションが同一のAPIアドレスを通じて、異なる大規模言語モデルの機能をシームレスに使用でき、異なるサービスのために複数の設定を維持し、インターフェース非互換問題を処理する煩わしさから完全に解放されます。

> [!NOTE]
> Ruan Yifeng先生による[週刊359号](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html)での推薦に感謝します。
>
> 8.29 アカウントプールモードを追加。すべてのプロバイダーで複数アカウントの設定をサポート。ラウンドロビン、フェイルオーバー（クライアント再試行必要）、設定ダウングレードを内蔵。configでPROVIDER_POOLS_FILE_PATH設定が必要。詳細は設定ファイル：provider_pools.json参照
>
> 9.1  Qwen Code CLIサポートを密かに追加、qwen3-coder-plusモデルが使用可能
> 
> 10.18 Kiroはオープン登録、新規アカウントに500クレジット付与、Claude Sonnet4.5に対応

---

## 💡 コア機能

*   ✅ **マルチモデル統一アクセス**：一つのインターフェースで、Gemini、OpenAI、Claude、Kimi K2、GLM-4.5、Qwen Codeなど複数の最新モデルに対応。シンプルな起動パラメータやリクエストヘッダーで、異なるモデルプロバイダー間を自由に切り替え可能。
*   ✅ **公式制限の突破**：Gemini CLIのOAuth認証方式をサポートすることで、公式無料APIのレート制限と割り当て制限を効果的に回避し、より高いリクエスト枠と使用頻度を享受。
*   ✅ **クライアント制限の突破**：Kiro APIモードでClaude Sonnet 4.5モデルの無料使用をサポート。
*   ✅ **OpenAIとのシームレスな互換性**：OpenAI APIと完全に互換性のあるインターフェースを提供し、既存のツールチェーンとクライアント（LobeChat、NextChatなど）がゼロコストですべてのサポートモデルに接続可能。
*   ✅ **アカウントプールのインテリジェント管理**：マルチアカウントのラウンドロビン、フェイルオーバー、設定ダウングレードをサポートし、サービスの高可用性を確保し、単一アカウントの制限問題を効果的に回避。
*   ✅ **強化された制御性**：強力なログ機能により、すべてのリクエストのプロンプトをキャプチャして記録でき、監査、デバッグ、プライベートデータセット構築に便利。
*   ✅ **極めて拡張しやすい**：新しいモジュラーとストラテジーパターン設計により、新しいモデルプロバイダーの追加がかつてないほど簡単。
*   ✅ **完全なテストカバレッジ**：包括的な統合テストと単体テストを提供し、各APIエンドポイントと機能の安定性と信頼性を確保。
*   ✅ **Dockerサポート**：完全なDockerコンテナ化サポートを提供し、迅速なデプロイと環境の分離をサポート。

---

## 📑 クイックナビゲーション

- [🐳 Docker デプロイ](https://aiproxy.justlikemaki.vip/zh/docs/installation/docker-deployment.html)
- [🎨 モデルプロトコルとプロバイダー関係図](#-モデルプロトコルとプロバイダー関係図)
- [🔧 使用方法](#-使用方法)
- [💻 プロキシ設定](#-プロキシ設定)
- [🌟 特殊な使用法と上級テクニック](#-特殊な使用法と上級テクニック)
- [🚀 プロジェクト起動パラメータ](#-プロジェクト起動パラメータ)
- [📄 オープンソースライセンス](#-オープンソースライセンス)
- [🙏 謝辞](#-謝辞)
- [⚠️ 免責事項](#-免責事項)

---

## 🎨 モデルプロトコルとプロバイダー関係図


- OpenAIプロトコル (P_OPENAI): すべてのMODEL_PROVIDERをサポート。openai-custom、gemini-cli-oauth、claude-custom、
claude-kiro-oauth、openai-qwen-oauthを含む。
- Claudeプロトコル (P_CLAUDE): claude-custom、claude-kiro-oauth、gemini-cli-oauth、openai-custom、openai-qwen-oauthをサポート。
- Geminiプロトコル (P_GEMINI): gemini-cli-oauthをサポート。


  ```mermaid

   graph TD
       subgraph Core_Protocols["コアプロトコル"]
           P_OPENAI[OpenAI Protocol]
           P_GEMINI[Gemini Protocol]
           P_CLAUDE[Claude Protocol]
       end

       subgraph Supported_Model_Providers["サポートモデルプロバイダー"]
           MP_OPENAI[openai-custom]
           MP_GEMINI[gemini-cli-oauth]
           MP_CLAUDE_C[claude-custom]
           MP_CLAUDE_K[claude-kiro-oauth]
           MP_QWEN[openai-qwen-oauth]
       end

       P_OPENAI ---|サポート| MP_OPENAI
       P_OPENAI ---|サポート| MP_QWEN
       P_OPENAI ---|サポート| MP_GEMINI
       P_OPENAI ---|サポート| MP_CLAUDE_C
       P_OPENAI ---|サポート| MP_CLAUDE_K

       P_GEMINI ---|サポート| MP_GEMINI

       P_CLAUDE ---|サポート| MP_CLAUDE_C
       P_CLAUDE ---|サポート| MP_CLAUDE_K
       P_CLAUDE ---|サポート| MP_GEMINI
       P_CLAUDE ---|サポート| MP_OPENAI
       P_CLAUDE ---|サポート| MP_QWEN

       style P_OPENAI fill:#f9f,stroke:#333,stroke-width:2px
       style P_GEMINI fill:#ccf,stroke:#333,stroke-width:2px
       style P_CLAUDE fill:#cfc,stroke:#333,stroke-width:2px

  ```

---

## 🔧 使用方法

*   **MCPサポート**: オリジナルのGemini CLIの内蔵コマンド機能は使用できませんが、本プロジェクトはMCP (Model Context Protocol)を完璧にサポートし、MCPをサポートするクライアントと組み合わせることで、より強力な機能拡張が可能です。
*   **マルチモーダル機能**: 画像、ドキュメントなどのマルチモーダル入力をサポートし、よりリッチなインタラクティブ体験を提供。
*   **最新モデルサポート**: 最新の **Kimi K2**、**GLM-4.5**、**Qwen Code** モデルをサポート。`config.json` で対応するOpenAIまたはClaude互換インターフェースを設定するだけで使用可能。
*   **Qwen Codeサポート**: Qwen Code使用時は自動的にブラウザで認証ページが開き、認証完了後に `~/.qwen` ディレクトリに `oauth_creds.json` ファイルが生成されます。公式デフォルトパラメータ temperature=0、top_p=1 を使用してください。
*   **Kiro API**: Kiro API使用には[kiroクライアントをダウンロード](https://aibook.ren/archives/kiro-install)して認証ログインを完了し、kiro-auth-token.jsonを生成する必要があります。**最適な体験のためClaude Codeとの併用を推奨**。注意：Kiroサービスポリシーが調整されました。具体的な使用制限は公式発表をご確認ください。
*   **Claude Codeで異なるプロバイダーを使用**: Pathルーティングまたは環境変数を通じて、Claude関連のAPI呼び出しで異なるプロバイダーを使用できます：
    *   `http://localhost:3000/claude-custom` - 設定ファイルで定義されたClaude APIプロバイダーを使用
    *   `http://localhost:3000/claude-kiro-oauth` - Kiro OAuth認証方式でClaude APIにアクセス
    *   `http://localhost:3000/openai-custom` - OpenAIカスタムプロバイダーでClaudeリクエストを処理
    *   `http://localhost:3000/gemini-cli-oauth` - Gemini CLI OAuthプロバイダーでClaudeリクエストを処理
    *   `http://localhost:3000/openai-qwen-oauth` - Qwen OAuthプロバイダーでClaudeリクエストを処理
    *   各プロバイダーで異なるAPIキー、ベースURL、その他のパラメータを設定でき、柔軟なプロバイダー切り替えを実現

    これらのPathルートは直接のAPI呼び出しだけでなく、Cline、Kiloなどのプログラミングエージェントでも使用でき、異なるパスを指定することで対応するモデルを呼び出せます。例えば、プログラミングエージェントでAPIエンドポイントを設定する際、`http://localhost:3000/claude-kiro-oauth` を使用してKiro OAuth認証されたClaudeモデルを呼び出したり、`http://localhost:3000/gemini-cli-oauth` を使用してGeminiモデルを呼び出したりできます。

    Pathルートによるプロバイダー切り替えの他に、環境変数を設定してClaudeパラメータを設定することもできます。以下の環境変数で設定可能：

    *   `ANTHROPIC_BASE_URL`: Claude APIのベースURLパスを設定
    *   `ANTHROPIC_AUTH_TOKEN`: Claudeサービスの認証キーを設定
    *   `ANTHROPIC_MODEL`: 使用するClaudeモデルを設定

    #### 異なるシステムでの環境変数設定方法

    `http://localhost:3000/claude-custom` パスを使用する場合、以下の方法で環境変数を設定できます：

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

### 認証ファイルのデフォルトパス

各サービスの認証ファイルのデフォルト保存パス：

*   **Gemini**: `~/.gemini/oauth_creds.json`
*   **Kiro**: `~/.aws/sso/cache/kiro-auth-token.json`
*   **Qwen**: `~/.qwen/oauth_creds.json`

ここで `~` はユーザーホームディレクトリを表します。カスタムパスが必要な場合は、設定ファイルまたは環境変数で設定できます。

---


## 💻 プロキシ設定

> **ヒント**: Google/OpenAI/Claude/Kiroサービスに直接アクセスできない環境で使用する場合は、まずターミナルにHTTPプロキシを設定してください。HTTPSプロキシは設定しないでください。

### 異なるターミナル環境でのHTTPプロキシ設定コマンド

`AIClient2API` が外部AIサービス（Google、OpenAI、Claude、Kiroなど）に正常にアクセスできるようにするため、ターミナル環境でHTTPプロキシを設定する必要がある場合があります。以下は異なるオペレーティングシステム向けのプロキシ設定コマンドです：

#### Linux / macOS
```bash
export HTTP_PROXY="http://your_proxy_address:port"
# プロキシに認証が必要な場合
# export HTTP_PROXY="http://username:password@your_proxy_address:port"
```
これらの設定を永続化するには、シェル設定ファイル（例：`~/.bashrc`、`~/.zshrc`、`~/.profile`）に追加してください。

#### Windows (CMD)
```cmd
set HTTP_PROXY=http://your_proxy_address:port
:: プロキシに認証が必要な場合
:: set HTTP_PROXY=http://username:password@your_proxy_address:port
```
これらの設定は現在のCMDセッションでのみ有効です。永続的に設定するには、システム環境変数で設定してください。

#### Windows (PowerShell)
```powershell
$env:HTTP_PROXY="http://your_proxy_address:port"
# プロキシに認証が必要な場合
# $env:HTTP_PROXY="http://username:password@your_proxy_address:port"
```
これらの設定は現在のPowerShellセッションでのみ有効です。永続的に設定するには、PowerShell設定ファイル (`$PROFILE`) に追加するか、システム環境変数で設定してください。

**必ず `your_proxy_address` と `port` を実際のプロキシアドレスとポートに置き換えてください。**

---

## 🌟 特殊な使用法と上級テクニック

*   **🔌 任意のOpenAIクライアントとの接続**: 本プロジェクトの基本機能です。OpenAIをサポートする任意のアプリケーション（LobeChat、NextChat、VS Codeプラグインなど）のAPIアドレスを本サービス (`http://localhost:3000`) に向けることで、設定済みのすべてのモデルをシームレスに使用できます。

*   **🔍 一元的なリクエスト監視と監査**: `config.json` で `"PROMPT_LOG_MODE": "file"` を設定することで、すべてのリクエストとレスポンスをキャプチャし、ローカルログファイルに保存します。これはプロンプトの分析、デバッグ、最適化、さらにはプライベートデータセットの構築にとって重要です。

*   **💡 動的システムプロンプト**:
    *   `config.json` で `SYSTEM_PROMPT_FILE_PATH` と `SYSTEM_PROMPT_MODE` を設定することで、システムプロンプトの動作をより柔軟に制御できます。
    *   **サポートモード**:
        *   `override`: クライアントのシステムプロンプトを完全に無視し、ファイルの内容を強制使用。
        *   `append`: クライアントシステムプロンプトの末尾にファイルの内容を追加し、ルールを補完。
    *   これにより、異なるクライアントに統一された基本指示を設定しながら、個々のアプリケーションで個性的な拡張を許可できます。

*   **🛠️ 二次開発の基盤として**:
    *   **新モデルの追加**: `src` ディレクトリに新しいプロバイダーディレクトリを作成し、`ApiServiceAdapter` インターフェースと対応するストラテジーを実装し、`adapter.js` と `common.js` に登録するだけです。
    *   **レスポンスキャッシュ**: 高頻度の繰り返し質問にキャッシュロジックを追加し、API呼び出しを削減し、レスポンス速度を向上。
    *   **カスタムコンテンツフィルタリング**: リクエスト送信前または返却前にキーワードフィルタリングやコンテンツ審査ロジックを追加し、コンプライアンス要件を満たす。

*   **🎯 アカウントプールの高度な設定**:
    *   **マルチアカウント管理**: `provider_pools.json` ファイルを設定することで、各プロバイダーに複数のアカウントを設定し、インテリジェントなラウンドロビンを実現。
    *   **フェイルオーバー**: あるアカウントが無効になった場合、システムは自動的に次の利用可能なアカウントに切り替え、サービスの継続性を確保。
    *   **設定ダウングレード**: アカウント状態に基づいて設定パラメータを動的に調整し、リソース使用効率を最適化。
    *   **使用例**: プロジェクトの `provider_pools.json` 設定ファイルを参照し、マルチアカウント環境を簡単に設定。

---

## 🚀 プロジェクト起動パラメータ

本プロジェクトは豊富なコマンドラインパラメータ設定をサポートし、必要に応じてサービスの動作を柔軟に調整できます。以下は機能別にグループ化されたすべての起動パラメータの詳細説明です：

### 🔧 サーバー設定パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--host` | string | localhost | サーバーリッスンアドレス |
| `--port` | number | 3000 | サーバーリッスンポート |
| `--api-key` | string | 123456 | 認証に必要なAPIキー |

### 🤖 モデルプロバイダー設定パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--model-provider` | string | gemini-cli-oauth | AIモデルプロバイダー、選択可能値：openai-custom, claude-custom, gemini-cli-oauth, claude-kiro-oauth, openai-qwen-oauth |

### 🧠 OpenAI互換プロバイダーパラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--openai-api-key` | string | null | OpenAI APIキー (openai-customプロバイダー用) |
| `--openai-base-url` | string | null | OpenAI APIベースURL (openai-customプロバイダー用) |

### 🖥️ Claude互換プロバイダーパラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--claude-api-key` | string | null | Claude APIキー (claude-customプロバイダー用) |
| `--claude-base-url` | string | null | Claude APIベースURL (claude-customプロバイダー用) |

### 🔐 Gemini OAuth認証パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--gemini-oauth-creds-base64` | string | null | Gemini OAuth認証情報のBase64文字列 |
| `--gemini-oauth-creds-file` | string | null | Gemini OAuth認証情報JSONファイルパス |
| `--project-id` | string | null | Google CloudプロジェクトID (gemini-cliプロバイダー用) |

### 🎮 Kiro OAuth認証パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--kiro-oauth-creds-base64` | string | null | Kiro OAuth認証情報のBase64文字列 |
| `--kiro-oauth-creds-file` | string | null | Kiro OAuth認証情報JSONファイルパス |

### 🐼 Qwen OAuth認証パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--qwen-oauth-creds-file` | string | null | Qwen OAuth認証情報JSONファイルパス |

### 📝 システムプロンプト設定パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--system-prompt-file` | string | input_system_prompt.txt | システムプロンプトファイルパス |
| `--system-prompt-mode` | string | overwrite | システムプロンプトモード、選択可能値：overwrite（上書き）、append（追加） |

### 📊 ログ設定パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--log-prompts` | string | none | プロンプトログモード、選択可能値：console（コンソール）、file（ファイル）、none（なし） |
| `--prompt-log-base-name` | string | prompt_log | プロンプトログファイルベース名 |

### 🔄 リトライ機構パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--request-max-retries` | number | 3 | APIリクエスト失敗時の自動リトライ最大回数 |
| `--request-base-delay` | number | 1000 | 自動リトライ間の基本遅延時間（ミリ秒）、各リトライ後に遅延が増加 |

### ⏰ 定期タスクパラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--cron-near-minutes` | number | 15 | OAuthトークンリフレッシュタスクの間隔時間（分） |
| `--cron-refresh-token` | boolean | true | OAuthトークン自動リフレッシュタスクを有効にするか |

### 🎯 アカウントプール設定パラメータ

| パラメータ | タイプ | デフォルト値 | 説明 |
|------|------|--------|------|
| `--provider-pools-file` | string | null | プロバイダーアカウントプール設定ファイルパス |

### 使用例

```bash
# 基本的な使用法
node src/api-server.js

# ポートとAPIキーを指定
node src/api-server.js --port 8080 --api-key my-secret-key

# OpenAIプロバイダーを使用
node src/api-server.js --model-provider openai-custom --openai-api-key sk-xxx --openai-base-url https://api.openai.com/v1

# Claudeプロバイダーを使用
node src/api-server.js --model-provider claude-custom --claude-api-key sk-ant-xxx --claude-base-url https://api.anthropic.com

# Geminiプロバイダーを使用（Base64認証情報）
node src/api-server.js --model-provider gemini-cli-oauth --gemini-oauth-creds-base64 eyJ0eXBlIjoi... --project-id your-project-id

# Geminiプロバイダーを使用（認証情報ファイル）
node src/api-server.js --model-provider gemini-cli-oauth --gemini-oauth-creds-file /path/to/credentials.json --project-id your-project-id

# システムプロンプトを設定
node src/api-server.js --system-prompt-file custom-prompt.txt --system-prompt-mode append

# ログを設定
node src/api-server.js --log-prompts console
node src/api-server.js --log-prompts file --prompt-log-base-name my-logs

# 完全な例
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

## 📄 オープンソースライセンス

本プロジェクトは [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) オープンソースライセンスに従います。詳細はルートディレクトリの `LICENSE` ファイルをご覧ください。

## 🙏 謝辞

本プロジェクトの開発は公式Google Gemini CLIから大きなインスピレーションを受け、Cline 3.18.0版 `gemini-cli.ts` の一部のコード実装を参考にしました。ここにGoogle公式チームとCline開発チームの優れた仕事に心より感謝申し上げます！

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=justlovemaki/AIClient-2-API&type=Timeline)](https://www.star-history.com/#justlovemaki/AIClient-2-API&Timeline)

---

## ⚠️ 免責事項

### 使用リスクの注意

本プロジェクト（AIClient-2-API）は学習と研究目的のみです。ユーザーは本プロジェクト使用時、すべてのリスクを自己負担する必要があります。作者は本プロジェクトの使用により生じた直接的、間接的、結果的損失について一切の責任を負いません。

### サードパーティサービスの責任説明

本プロジェクトはAPIプロキシツールであり、AIモデルサービスを提供していません。すべてのAIモデルサービスは対応するサードパーティプロバイダー（Google、OpenAI、Anthropicなど）により提供されます。ユーザーが本プロジェクトを通じてこれらのサードパーティサービスにアクセスする際は、各サードパーティサービスの利用規約とポリシーを遵守する必要があります。作者はサードパーティサービスの可用性、品質、セキュリティ、合法性について責任を負いません。

### データプライバシー説明

本プロジェクトはローカルで実行され、ユーザーのデータを収集またはアップロードしません。ただし、ユーザーは本プロジェクト使用時、APIキーやその他の機密情報を保護することに注意する必要があります。定期的にAPIキーを確認・更新し、安全でないネットワーク環境での本プロジェクトの使用を避けることを推奨します。

### 法的コンプライアンスの注意

ユーザーは本プロジェクト使用時、所在国/地域の法律法規を遵守する必要があります。本プロジェクトを違法な目的に使用することは厳禁です。ユーザーが法律法規に違反したことによるいかなる結果も、ユーザー自身がすべての責任を負うものとします。
