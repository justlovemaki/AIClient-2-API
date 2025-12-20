<div align="center">

<img src="src/img/logo-min.webp" alt="logo"  style="width: 128px; height: 128px;margin-bottom: 3px;">

# AIClient-2-API 🚀

**複数のクライアント専用大規模言語モデルAPI（Gemini CLI、Antigravity、Qwen Code、Kiro ...）を模擬リクエストし、ローカルのOpenAI互換インターフェースに統一的にラッピングする強力なプロキシ。**

</div>

<div align="center">

<a href="https://deepwiki.com/justlovemaki/AIClient-2-API"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"  style="width: 134px; height: 23px;margin-bottom: 3px;"></a>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-≥20.0.0-blue.svg)](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
[![GitHub stars](https://img.shields.io/github/stars/justlovemaki/AIClient-2-API.svg?style=flat&label=Star)](https://github.com/justlovemaki/AIClient-2-API/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/justlovemaki/AIClient-2-API.svg)](https://github.com/justlovemaki/AIClient-2-API/issues)

[中文](./README-ZH.md) | [English](./README.md) | [**👉 日本語**](./README-JA.md) | [**📚 完全ドキュメント**](https://aiproxy.justlikemaki.vip/ja/)

</div>

`AIClient2API` はクライアント制限を突破するAPIプロキシサービスで、Gemini、Antigravity、Qwen Code、Kiroなど、元々クライアント内でのみ使用可能な無料大規模モデルを、あらゆるアプリケーションから呼び出せる標準OpenAI互換インターフェースに変換します。Node.jsをベースに構築され、OpenAI、Claude、Geminiの3大プロトコル間のインテリジェント変換をサポートし、Cherry-Studio、NextChat、Clineなどのツールで、Claude Opus 4.5、Gemini 3.0 Pro、Qwen3 Coder Plusなどの高度なモデルを大規模に無料で使用できるようにします。プロジェクトはストラテジーパターンとアダプターパターンに基づくモジュラーアーキテクチャを採用し、アカウントプール管理、インテリジェントポーリング、自動フェイルオーバー、ヘルスチェック機構を内蔵し、99.9%のサービス可用性を保証します。

> [!NOTE]
> **🎉 重要なマイルストーン**
>
> - Ruan Yifeng先生による[週刊359号](https://www.ruanyifeng.com/blog/2025/08/weekly-issue-359.html)での推薦に感謝します
>
> **📅 バージョン更新ログ**
>
> - **2025.12.11** - Dockerイメージが自動的にビルドされ、Docker Hubで公開されました: [justlikemaki/aiclient-2-api](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
> - **2025.11.30** - Antigravityプロトコルサポートの追加、Google内部インターフェース経由でGemini 3 Pro、Claude Sonnet 4.5などのモデルへのアクセスをサポート
> - **2025.11.16** - Ollamaプロトコルサポートの追加、統一インターフェースでサポートされるすべてのモデルにアクセス
> - **2025.11.11** - Web UI管理コントロールコンソールの追加、リアルタイム設定管理と健康状態モニタリングをサポート
> - **2025.11.06** - Gemini 3 プレビュー版のサポートを追加、モデル互換性とパフォーマンス最適化を向上
> - **2025.10.18** - Kiroオープン登録、新規アカウントに500クレジット付与、Claude Sonnet 4.5を完全サポート
> - **2025.09.01** - Qwen Code CLIを統合、`qwen3-coder-plus`モデルサポートを追加
> - **2025.08.29** - アカウントプール管理機能をリリース、マルチアカウントポーリング、自動フェイルオーバー、自動ダウングレード戦略をサポート
>   - 設定方法：config.jsonに`PROVIDER_POOLS_FILE_PATH`パラメータを追加
>   - 参考設定：[provider_pools.json](./provider_pools.json.example)
> - **開発済み履歴**
>   - Gemini CLI、Kiroなどのクライアント2APIをサポート
>   - OpenAI、Claude、Geminiの3つのプロトコル相互変換、自動インテリジェント切り替え

---

## 💡 コアアドバンテージ

### 🎯 統一アクセス、ワンストップ管理
*   **マルチモデル統一インターフェース**：標準OpenAI互換プロトコルを通じて、一度の設定でGemini、Claude、Qwen Code、Kimi K2、MiniMax M2などの主流大規模モデルにアクセス
*   **柔軟な切り替えメカニズム**：Pathルーティング、起動パラメータ、環境変数の3つの方法で動的にモデルを切り替え、異なるシナリオのニーズに対応
*   **ゼロコスト移行**：OpenAI API仕様と完全互換、Cherry-Studio、NextChat、Clineなどのツールを変更なしで使用可能
*   **マルチプロトコルインテリジェント変換**：OpenAI、Claude、Geminiの3大プロトコル間のインテリジェント変換をサポートし、クロスプロトコルモデル呼び出しを実現

### 🚀 制限を突破、効率を向上
*   **公式制限の回避**：OAuth認証メカニズムを利用して、Gemini、Antigravityなどの無料APIのレート制限と割り当て制限を効果的に突破
*   **無料高度モデル**：Kiro APIモードでClaude Opus 4.5を無料使用、Qwen OAuthモードでQwen3 Coder Plusを使用し、使用コストを削減
*   **インテリジェントアカウントプールスケジューリング**：マルチアカウントポーリング、自動フェイルオーバー、設定ダウングレードをサポートし、99.9%のサービス可用性を保証

### 🛡️ 安全で制御可能、データ透明
*   **フルチェーンログ記録**：すべてのリクエストとレスポンスデータをキャプチャし、監査とデバッグをサポート
*   **プライベートデータセット構築**：ログデータに基づいて専用トレーニングデータセットを迅速に構築
*   **システムプロンプト管理**：オーバーライドと追加の2つのモードをサポートし、統一された基本指示と個別拡張の完璧な組み合わせを実現

### 🔧 開発者フレンドリー、拡張が容易
*   **Web UI管理コントロールコンソール**：リアルタイム設定管理、健全性モニタリング、APIテスト、ログ表示
*   **モジュラーアーキテクチャ**：ストラテジーパターンとアダプターパターンに基づき、新しいモデルプロバイダーの追加はわずか3ステップ
*   **完全なテストカバレッジ**：統合テストと単体テストのカバレッジ90%+、コード品質を保証
*   **コンテナ化デプロイ**：Dockerサポートを提供、ワンクリックデプロイ、クロスプラットフォーム実行

---

## 📑 クイックナビゲーション

- [🐳 Docker デプロイ](https://hub.docker.com/r/justlikemaki/aiclient-2-api)
- [🔧 使用方法](#-使用方法)
- [📄 オープンソースライセンス](#-オープンソースライセンス)
- [🙏 謝辞](#-謝辞)
- [⚠️ 免責事項](#-免責事項)

---

## 🔧 使用方法

### 🚀 クイックスタート

AIClient-2-APIを使い始める最も推奨される方法は、自動起動スクリプトを使用し、**Web UIコンソール**で直接ビジュアル設定を行うことです。

#### 1. 起動スクリプトの実行
*   **Linux/macOS**: `chmod +x install-and-run.sh && ./install-and-run.sh`
*   **Windows**: `install-and-run.bat` をダブルクリックして実行

#### 2. コンソールへのアクセス
サーバー起動後、ブラウザで以下にアクセスしてください：
👉 [**http://localhost:3000**](http://localhost:3000)

> **デフォルトパスワード**: `admin123` (ログイン後、コンソールまたは `pwd` ファイルの変更で変更可能)

#### 3. ビジュアル設定 (推奨)
**「設定管理」** ページに入ると、以下を直接行えます：
*   ✅ 各プロバイダーの API Key の入力または OAuth 認証情報のアップロード
*   ✅ デフォルトモデルプロバイダーのリアルタイム切り替え
*   ✅ 健全性ステータスとリアルタイムリクエストログの監視

#### スクリプト実行例
```
========================================
  AI Client 2 API 快速インストール起動スクリプト
========================================

[確認] Node.js がインストールされているかを確認中...
✅ Node.js がインストールされています、バージョン: v20.10.0
✅ package.json ファイルが見つかりました
✅ node_modules ディレクトリが既に存在しています
✅ プロジェクトファイルの確認が完了しました

========================================
  AI Client 2 API サーバーを起動中...
========================================

🌐 サーバーは http://localhost:3000 で起動します
📖 管理インターフェースを表示するには http://localhost:3000 にアクセス
⏹️  サーバーを停止するには Ctrl+C を押してください
```

> **💡 ヒント**：スクリプトは自動的に依存関係をインストールし、サーバーを起動します。問題が発生した場合、スクリプトは明確なエラーメッセージと解決案を提供します。

---

### 📋 コア機能

#### Web UI管理コントロールコンソール

![Web UI](src/img/web.png)

以下の機能モジュールを備えたWeb管理インターフェース：

**📊 ダッシュボード**：システム概要、インタラクティブなルーティング例、クライアント設定ガイド

**⚙️ 設定管理**：全プロバイダー（Gemini、Antigravity、OpenAI、Claude、Kiro、Qwen）のリアルタイムパラメータ修正、高度設定、ファイルアップロード対応

**🔗 プロバイダープール**：アクティブ接続監視、プロバイダー健全性統計、有効化/無効化管理

**📁 設定ファイル**：OAuth資格情報の集中管理、検索フィルタリング、ファイル操作機能

**📜 リアルタイムログ**：システムログとリクエストログのライブ表示、管理コントロール付き

**🔐 ログイン認証**：デフォルトパスワード `admin123`、`pwd`ファイルで変更可能

アクセス：`http://localhost:3000` → ログイン → サイドバーナビゲーション → 即座有効

#### マルチモーダル入力機能
画像、ドキュメントなど様々なタイプの入力をサポートし、よりリッチなインタラクティブ体験とより強力なアプリケーションシナリオを提供します。

#### 最新モデルサポート
以下の最新大規模モデルをシームレスにサポート、Web UIまたは[`config.json`](./config.json)で対応するエンドポイントを設定するだけで使用可能：
*   **Claude 4.5 Opus** - Anthropic史上最強モデル、Kiro、Antigravity経由でサポート
*   **Gemini 3 Pro** - Google次世代アーキテクチャプレビュー版、Gemini、Antigravity経由でサポート
*   **Qwen3 Coder Plus** - アリババ通義千問の最新コード専用モデル、Qwen Code経由でサポート
*   **Kimi K2 / MiniMax M2** - 国内トップフラッグシップモデルの同期サポート、カスタムOpenAI、Claude経由でサポート

---

### 🔐 認証設定ガイド

> **💡 ヒント**：最適な体験を得るために、**Web UIコンソール**を通じてビジュアルに認証管理を行うことを推奨します。

#### 🌐 Web UI クイック認証 (推奨)
Web UI管理インターフェースでは、極めて迅速に認証設定を完了できます：
1. **認証の生成**：**「プロバイダープール」** ページまたは **「設定管理」** ページで、対応するプロバイダー（Gemini、Qwenなど）の右上にある **「認証生成」** ボタンをクリックします。
2. **スキャン/ログイン**：認証ダイアログが表示されるので、**「ブラウザで開く」** をクリックしてログイン検証を行います。Qwenの場合はウェブログインを完了するだけ、Gemini、Antigravityの場合はGoogleアカウントの認証を完了させます。
3. **自動保存**：認証成功後、システムは自動的に資格情報を取得し、`configs/` の対応するディレクトリに保存します。**「設定ファイル」** ページで新しく生成された資格情報を確認できます。
4. **ビジュアル管理**：Web UIでいつでも資格情報のアップロードや削除、または **「クイック関連付け」** 機能を使用して既存の資格情報ファイルをワンクリックでプロバイダーにバインドできます。

#### Gemini CLI OAuth設定
1. **OAuth認証情報の取得**：[Google Cloud Console](https://console.cloud.google.com/)にアクセスしてプロジェクトを作成し、Gemini APIを有効化
2. **プロジェクト設定**：有効なGoogle CloudプロジェクトIDを提供する必要があり、起動パラメータ`--project-id`で指定可能
3. **プロジェクトIDの確認**：Web UIで設定する際、入力したプロジェクトIDが Google Cloud Console および Gemini CLI で表示されるプロジェクトIDと一致していることを確認してください。

#### Antigravity OAuth設定
1. **個人アカウント**：個人アカウントは個別に認証が必要ですが、申請チャンネルは閉鎖されています。
2. **Pro会員**：Antigravity は一時的に Pro 会員に開放されています。まず Pro 会員を購入する必要があります。
3. **組織アカウント**：組織アカウントは個別に認証が必要です。管理者に連絡して認証を取得してください。

#### Qwen Code OAuth設定
1. **初回認証**：Qwenサービス設定後、システムが自動的にブラウザで認証ページを開きます
2. **推奨パラメータ**：最良の結果を得るために公式デフォルトパラメータを使用
   ```json
   {
     "temperature": 0,
     "top_p": 1
   }
   ```

#### Kiro API設定
1. **環境準備**：[Kiroクライアントをダウンロードしてインストール](https://kiro.dev/pricing/)
2. **認証完了**：クライアントでアカウントにログインし、`kiro-auth-token.json`認証情報ファイルを生成
3. **ベストプラクティス**：**Claude Code**との併用を推奨、最適な体験を得られる
4. **重要なお知らせ**：Kiroサービス使用ポリシーが更新されました、最新の使用制限と条件については公式ウェブサイトをご確認ください。

#### アカウントプール管理設定
1. **プール設定ファイルの作成**：[provider_pools.json.example](./provider_pools.json.example) を参考に設定ファイルを作成します
2. **プールパラメータの設定**：config.json で `PROVIDER_POOLS_FILE_PATH` を設定し、プール設定ファイルを指定します
3. **起動パラメータ設定**：`--provider-pools-file <path>` パラメータを使用してプール設定ファイルのパスを指定します
4. **ヘルスチェック**：システムは定期的にヘルスチェックを自動実行し、健全でないプロバイダーを使用しません

---

### 📁 認証ファイル保存パス

各サービスの認証情報ファイルのデフォルト保存場所：

| サービス | デフォルトパス | 説明 |
|------|---------|------|
| **Gemini** | `~/.gemini/oauth_creds.json` | OAuth認証情報 |
| **Kiro** | `~/.aws/sso/cache/kiro-auth-token.json` | Kiro認証トークン |
| **Qwen** | `~/.qwen/oauth_creds.json` | Qwen OAuth認証情報 |
| **Antigravity** | `~/.antigravity/oauth_creds.json` | Antigravity OAuth認証情報 (Claude 4.5 Opus サポート) |

> **説明**：`~`はユーザーホームディレクトリを表します（Windows: `C:\Users\ユーザー名`、Linux/macOS: `/home/ユーザー名`または`/Users/ユーザー名`）
>
> **カスタムパス**：設定ファイルの関連パラメータまたは環境変数でカスタム保存場所を指定可能

---

### 🦙 Ollamaプロトコル使用例

本プロジェクトはOllamaプロトコルをサポートしており、統一インターフェースを通じてすべてのサポートモデルにアクセスできます。Ollamaエンドポイントは`/api/tags`、`/api/chat`、`/api/generate`などの標準インターフェースを提供します。

**Ollama API呼び出し例**：

1. **利用可能なすべてのモデルをリスト表示**：
```bash
curl http://localhost:3000/ollama/api/tags
```

2. **チャットインターフェース**：
```bash
curl http://localhost:3000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "[Claude] claude-sonnet-4.5",
    "messages": [
      {"role": "user", "content": "こんにちは"}
    ]
  }'
```

3. **モデルプレフィックスを使用してプロバイダーを指定**：
- `[Kiro]` - Kiro APIを使用してClaudeモデルにアクセス
- `[Claude]` - 公式Claude APIを使用
- `[Gemini CLI]` - Gemini CLI OAuth経由でアクセス
- `[OpenAI]` - 公式OpenAI APIを使用
- `[Qwen CLI]` - Qwen OAuth経由でアクセス

---

## 📄 オープンソースライセンス

本プロジェクトは [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) オープンソースライセンスに従います。詳細はルートディレクトリの `LICENSE` ファイルをご覧ください。

## 🙏 謝辞

本プロジェクトの開発は公式Google Gemini CLIから大きなインスピレーションを受け、Cline 3.18.0版 `gemini-cli.ts` の一部のコード実装を参考にしました。ここにGoogle公式チームとCline開発チームの優れた仕事に心より感謝申し上げます！

### 貢献者リスト

AIClient-2-APIプロジェクトに貢献してくれたすべての開発者に感謝します：

[![Contributors](https://contrib.rocks/image?repo=justlovemaki/AIClient-2-API)](https://github.com/justlovemaki/AIClient-2-API/graphs/contributors)


### 🌟 Star History


[![Star History Chart](https://api.star-history.com/svg?repos=justlovemaki/AIClient-2-API&type=Timeline)](https://www.star-history.com/#justlovemaki/AIClient-2-API&Timeline)

---

## ⚠️ 免責事項

### 使用リスクの注意
本プロジェクト（AIClient-2-API）は学習と研究目的のみです。ユーザーは本プロジェクト使用時、すべてのリスクを自己負担する必要があります。作者は本プロジェクトの使用により生じた直接的、間接的、または結果的な損失について一切の責任を負いません。

### サードパーティサービスの責任説明
本プロジェクトはAPIプロキシツールであり、AIモデルサービスを提供していません。すべてのAIモデルサービスは対応するサードパーティプロバイダー（Google、OpenAI、Anthropicなど）により提供されます。ユーザーが本プロジェクトを通じてこれらのサードパーティサービスにアクセスする際は、各サードパーティサービスの利用規約とポリシーを遵守する必要があります。作者はサードパーティサービスの可用性、品質、セキュリティ、合法性について責任を負いません。

### データプライバシー説明
本プロジェクトはローカルで実行され、ユーザーのデータを収集またはアップロードしません。ただし、ユーザーは本プロジェクト使用時、APIキーやその他の機密情報を保護することに注意する必要があります。定期的にAPIキーを確認・更新し、安全でないネットワーク環境での本プロジェクトの使用を避けることを推奨します。

### 法的コンプライアンスの注意
ユーザーは本プロジェクト使用時、所在国/地域の法律法規を遵守する必要があります。本プロジェクトを違法な目的に使用することは厳禁です。ユーザーが法律法規に違反したことによるいかなる結果も、ユーザー自身がすべての責任を負うものとします。
