<h1 align="center">NEKODEX</h1>

ChatGPT アカウント、コーディングエージェント、ローカルツールのデスクトップ環境。
NEKODEX は独自の猫アイコン、概要画面、独立したアカウント管理画面、
グラファイトとラベンダーの配色を備えています。
[デザインと互換性の説明](docs/design/nekodex.md)を参照してください。

**ダウンロード版：** `5.4.0-nekodex.1`。macOS 13 以降に対応しています。

| Mac | ダウンロード |
| --- | --- |
| Apple Silicon（M1 以降） | [ARM64 DMG](https://github.com/Froraut/NEKODEX/releases/download/v5.4.0-nekodex.1/NEKODEX-5.4.0-nekodex.1-mac-arm64.dmg) |
| Intel | [Intel DMG](https://github.com/Froraut/NEKODEX/releases/download/v5.4.0-nekodex.1/NEKODEX-5.4.0-nekodex.1-mac-x64.dmg) |

[リリースページ](https://github.com/Froraut/NEKODEX/releases/tag/v5.4.0-nekodex.1) · [チェックサム](https://github.com/Froraut/NEKODEX/releases/download/v5.4.0-nekodex.1/checksums.txt)。このリリースは macOS 版のみです。
旧アップデーターは以前の実行ファイル名を検証するため、初回は手動での移行が必要です。
アカウント状態を保持するため、既存のブラウザープロファイルとデータ識別子を維持します。

**FroRaut** がメンテナンスし、
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)を基にしています。
元の作者の帰属表示と MIT ライセンスは維持しています。
[レビューと改善計画](docs/reviews/2026-09-11-review.md)を参照してください。

```bash
git clone https://github.com/Froraut/codex-chatgpt-web.git
cd codex-chatgpt-web
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run dev:launcher
```

Bun 1.4.0 を使用してください。`dev:launcher` はレビューとログインテスト用に隔離された開発プロファイルを使用します。
`bun run app` もソース開発用ランチャーを起動します。インストール済みアプリを置き換えるには、パッケージ化したビルドが必要です。本番環境への統合を有効にする前に、
[DEV の隔離](docs/dev-chat.md)を確認してください。

<p align="center">
  <strong>ChatGPT Web（Pro を含む）を Codex のネイティブモデルとして使用。</strong><br>
  モデルの利用枠を切り替えて、いつものワークフローを維持できます。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="TROUBLESHOOTING.md">トラブルシューティング</a> · <a href="SECURITY.md">セキュリティ</a> · <a href="CONTRIBUTING.md">コントリビューション</a>
</p>

<p align="center">
  <a href="https://github.com/Froraut/codex-chatgpt-web/actions/workflows/ci.yml"><img src="https://github.com/Froraut/codex-chatgpt-web/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT ライセンス"></a>
  <img src="https://img.shields.io/badge/macOS-arm64%20%7C%20x64-black?logo=apple" alt="macOS arm64 および x64">
  <img src="https://img.shields.io/badge/Windows-x64-0078d4?logo=windows11" alt="Windows x64">
  <img src="https://img.shields.io/badge/Linux-x64-fcc624?logo=linux&logoColor=black" alt="Linux x64">
</p>

Free および Go アカウントでは、Codex のネイティブモデル選択画面に
**ChatGPT Web — Luna** が追加されます。reasoning セレクターが表示されるアカウントでは、
サブスクリプションで利用可能な **Instant**、**Medium**、**High**、**Extra High**、**Pro** を使用できます。
ブリッジは、コンパイル済みの現在の Codex タスクコンテキストを新しい ChatGPT 一時チャットへ送り、
画像を添付し、表示される reasoning、ツールアクティビティ、Markdown を同じ Codex タスクへストリーミングします。

<p align="center">
  <img src="assets/demo.gif" alt="ネイティブ Codex ハーネスを使用する ChatGPT Web ターン" width="960">
</p>

```text
Codex タスク ──Responses + SSE──▶ codex-chatgpt-web ──内蔵ブラウザー──▶ ChatGPT
      ▲                                  │                              │
      └──── ネイティブ UI、コンテキスト、画像、トレース、ツールライフサイクル ────┘
```

Codex はネイティブのタスク、コンテキストライフサイクル、UI、ツールハーネスを維持します。
ローカル Responses ブリッジは、選択されたモデルのタスクだけをタスクに紐付いた ChatGPT 一時チャットへルーティングします。
Full モードでは、次のコンパクション境界まで、MCP が ChatGPT を同じ Codex タスクのツールへ接続します。

フォークの設定手順、アカウントとコネクタの境界、代替案については以下を参照してください： [ワークフロー、設定と代替案](docs/workflow-and-alternatives.md).

[Hermes integration: Web models with Hermes tools](docs/hermes-integration.md)

## 主な特長

- **Codex のネイティブモデル。** ChatGPT Web は Codex のモデル選択画面から実行され、元のタスク UI、
  コンテキストライフサイクル、ストリーミング、トレース、ツール表示はそのまま維持されます。
- **MCP 経由の完全な Codex ハーネス。** Full モードでは、Pro を含め、サインイン中のアカウントで
  利用可能なすべての effort から、実行中タスクのファイルシステム、シェル、画像、承認、設定済みツール／アプリを使用できます。
- **継続的なタスクセッションとネイティブコンパクション。** 連続するメッセージは、タスクに紐付いた
  1 つの一時チャットを再利用します。コンテキスト境界に達すると、保持中のエージェントがチェックポイントを書き、
  その後 Codex が新しいチャットを開始します。チャットが閉じられていた場合は、正規の Codex 履歴がフォールバックになります。
- **1 つのクロスプラットフォームランチャー。** macOS、Windows、Linux 向けアプリが、サインイン、
  モデル設定、MCP ガイド、ヘルスチェック、安全な診断、最大 16 件の表示可能なタスク紐付きブラウザータブを管理します。
- **Fail-closed 動作。** モデルやツールの欠落、ChatGPT UI の変更が発生した場合、ルートや機能を黙って切り替えず、
  明示的なエラーを返します。エンドツーエンドの対象範囲は
  [リリース検証](docs/release-validation.md)に記載されています。

一時チャットは ChatGPT のプライバシーモードであり、匿名化やローカル推論ではありません。
プロンプトは引き続き OpenAI によって処理され、アカウント設定および OpenAI の
[一時チャットポリシー](https://help.openai.com/en/articles/8914046-temporary-chat-faq)が適用されます。
このプロジェクトは非公式です。適用される OpenAI の利用規約とワークスペースポリシーを守る責任は利用者にあります。

## クイックスタート

ページ上部からお使いの Mac に対応する DMG をダウンロードしてください。既存のアプリを終了し、
NEKODEX を「アプリケーション」フォルダーにドラッグします。既存のプロファイルとアカウントデータは保持してください。
Windows と Linux のソースは引き続き利用できますが、このリリースに各プラットフォームのインストーラーは含まれません。

アプリ内で次の 3 項目を完了します。

1. ランチャー内蔵の ChatGPT ブラウザーで直接サインインします。通常のログインページと ID プロバイダーの
   ウィンドウは、ランチャー管理の非公開プロファイル内に保持されます。macOS では **パスキーを使用** を選ぶと
   専用の Chrome プロファイルが開きます。そこでサインインを完了し、ランチャーの **Chrome のログインを取り込む** を
   選ぶと、許可リストにある ChatGPT/OpenAI のセッションだけを転送して検証します。
2. ブラウザーのスモークテストを実行します。
3. **モデルをインストール**を押し、Codex を一度再起動して、**ChatGPT Web — …** モデルを選択します。

セットアップ時に、ランチャーが現在のアカウントの ChatGPT コントロールを検出します。
Free/Go アカウントでは Luna のみが表示され、Pro はサインイン中のアカウントで利用可能な場合にのみ表示されます。
独立した **MCP** ページは任意で、ターミナルコマンドを使わずに Full ハーネスの設定を案内します。

パッケージ版ランチャーは ChatGPT モデルのターンを内蔵ブラウザーで処理します。
通常の内蔵ブラウザーでのログインには、Chrome/Chromium のインストールは不要です。
任意の macOS パスキーフローには Chrome が必要です。パッケージ版ではモデル API キー、
システムの Node/Bun、プロジェクト管理のブラウザーダウンロードは不要です。

**ソースから実行**

```bash
git clone https://github.com/Froraut/codex-chatgpt-web.git && \
cd codex-chatgpt-web && \
bun run app
```

この方法には Bun 1.4.0 が必要です。コマンドはロックされた依存関係をインストールしてアプリを開きます。

## モード

| モード | モデル | ローカル Codex ツール | 追加設定 |
| --- | --- | --- | --- |
| **Browser-only** | Free/Go: Luna、Plus: Instant～High、Pro: Extra High と Pro を追加 | なし。Codex が警告を表示 | なし |
| **Full harness** | Free/Go: Luna、Plus: Instant～High、Pro: Extra High と Pro を追加 | Pro を含むすべての表示 effort で使用可能 | OpenAI トンネル + ChatGPT コネクタ |

モデル選択画面の各項目は、1 つの固定 ChatGPT モードに対応します。Codex には内蔵の Effort と Speed 行も表示されますが、
それらを変更しても、選択済みのブラウザーモデルが黙って切り替わることはありません。
Full モードでは、利用可能なすべての effort が同じターン紐付き MCP capability を受け取ります。
Pro 専用の制限や縮小されたツール契約はありません。

旧 **Zero Risk** モードの表示名は**手動モード**に変更しました。既存の `chatgpt-web/zero-risk` と `chatgpt-web/zero-risk-pro` のモデル ID、コマンドオプション、保存済み設定は互換性を維持します。コネクタの正確な名前は `Codex Zero Risk2` のままです。ChatGPT ページの自動読み書きや送信は行いませんが、アカウント制限と MCP/ローカルツールの影響は引き続き適用されます。

手動モードの Codex ルートは**テキスト専用**で、Computer Use のスクリーンショットや
その他の画像入力を自動では受け取りません。画像は ChatGPT で手動添付する必要があり、
手動添付しても、このルートでスクリーンショットが自動転送されるようにはなりません。
視覚的な確認には、画像入力をサポートするルートを使用し、実際のツール結果を検証してください。
画像、Windows のバインディング、キーボードエラーのそれぞれの制限については、
[Computer Use の画像制限レビュー](docs/upstream-issue-457-computer-use.md)を参照してください。

## Full ハーネス

Full モードは、公式の [OpenAI tunnel-client](https://github.com/openai/tunnel-client) を通じて、
ChatGPT のツール呼び出しを現在の Codex タスクへ接続します。トンネルは外向きであり、公開 IP の露出、
受信ポートの開放、ルーターのポート転送は不要です。

> **Limits**
>
> **GPT-5.6 Sol Pro** と **GPT-6 Astra** の現在の ChatGPT メッセージ上限については、
> [Limits](https://github.com/miuuyy/codex-chatgpt-web/discussions/309) を参照してください。
> Token コンテキスト上限は、アカウント種別と選択した effort によって異なります。Plus の
> Medium/High は実測 90,000-token ウィンドウを使用し、実験的な **3× context** を有効にすると
> 最大 270,000 tokens まで拡張されます。いずれの場合もネイティブ Codex compaction に対応します。

1. ランチャーの必須セットアップを完了します。
2. ランチャーで **MCP** を開きます。ChatGPT コネクタを使用するものと同じ OpenAI アカウントで
   Tunnel と通常の API キーを作成します。キーの作成は無料で、モデル API クレジットを消費しません。
3. Tunnel ID と API キーを貼り付け、**ハーネスを接続**を押します。
4. ChatGPT の設定で **Developer Mode** を有効にします。**Tunnel** を使う**新しい**コネクタを作成し、
   対象の Tunnel を選択して、**Authentication** を **None**、名前を正確に **Codex Native3** に設定します。
5. **Codex Native3** の **Permissions** で **Allow all actions** を選択します。
   **Allow low-risk actions** では、コマンドとパッチがこのランタイムへ到達する前にブロックされます。
   外側の Codex ハーネスでは、引き続きサンドボックスと承認が適用されます。
6. **ランタイムを検証**を実行し、**Codex Native3** が接続済みで利用可能であることを確認します。

書き込み／変更操作には、ChatGPT ワークスペースと管理者ポリシー側での許可も必要です。
[Developer Mode と MCP アプリ](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)を参照してください。
予期しない承認プロンプトは、`--auto-approve-tool-calls` が明示的に有効でない限り fail-closed になります。
このオプションが押すのは **Allow once** だけで、永続的な許可は付与しません。

## 運用

通常の Chrome プロファイルでログイン済みの ChatGPT アカウントを使う場合は、
[既存の Chrome セッションでサインイン](docs/existing-chrome-sign-in.md)を参照してください。
Chrome で接続を明示的に許可する必要があり、限定した ChatGPT/OpenAI のセッションだけを取り込みます。

安全なローカル診断には **アクティビティ**、エンドツーエンドのヘルスチェックには
**設定 → 診断を実行**を使用します。設定から、保持中のブラウザーターンのキャンセルや、
アンインストール前の Codex 統合削除も行えます。すべてのブラウザーチェックポイントでスクリーンショットが必要な場合にのみ、
`CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS=1` を設定してください。
[アカウントと UI の検証ツール](docs/account-ui-acceptance.md)では、バージョン付きのオフライン
フィクスチャと、個別に明示して許可するローカル・アカウント検証を実行できます。既定ではアカウントを操作しません。
ブラウザー診断は完了した最新 50 件を保持し、実行中のヘルパープロセスが所有する記録を保護します。
`CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT` を 1～1000 に設定すると保持件数を変更できます。
クラッシュしたヘルパーの記録は通常の削除対象になります。

**設定 → 自動 Pro モデル**では、自動 Pro ターンを **GPT-5.6 Sol Pro**、**GPT-5.5 Pro**、
**GPT-6 Astra Pro** に固定できます。既定の **ChatGPT に合わせる**は従来の動作を維持します。
次の Pro ターンから反映され、Codex やランチャーの再起動は不要です。他の推論レベルや
手動モードのターンには影響しません。指定バージョンが利用できない、または確認できない場合は
送信前にエラーとなり、別のモデルへ切り替えません。GPT-6 は 6 Pro と確認できる場合のみ
**最新**を使用します。

新規インストールでは、クロスバックエンドのサブエージェントに **Compatibility V1** を使用します。
**Native** は Codex 独自の機能設定を維持し、プレーンテキストの Web-to-Web V2 delegation を有効にします。
プロトコル変更後は Codex を再起動し、新しいタスクを開始してください。

```bash
codex-chatgpt-web subagents status
codex-chatgpt-web subagents compatibility-v1
codex-chatgpt-web subagents native
```

## 制限とセキュリティ

- これは非公式のブラウザー自動化であり、OpenAI API ではありません。ChatGPT UI の変更によりセレクターが壊れる可能性があります。
  差異が発生した場合、モデルや転送方式を黙って切り替えず、明示的に失敗します。
- ブラウザー状態は機密性の高いログイン情報です。また、loopback リスナーには同じローカルユーザーで動作する
  プロセスからアクセスできます。ランチャープロファイルを共有せず、信頼できるワークステーションを使用してください。
- リリースパッケージは現在、macOS 13+（arm64/x64）、Windows x64、Linux x64 を対象としています。
  ランタイム、テスト、パッケージングは CI で 3 プラットフォームすべてに対して検証されます。
  アカウント依存のブラウザー／MCP フローには、個別の[リリース検証](docs/release-validation.md)を使用します。
- ビルドはまだプラットフォーム署名されていないため、Gatekeeper または SmartScreen が警告を表示する場合があります。
  インストーラーは、インストール前に公開 SHA-256 マニフェストを検証します。

Full モードを有効にする前に、完全な[アーキテクチャ](docs/architecture.md)と
[セキュリティモデル](docs/security-model.md)をお読みください。脆弱性は [SECURITY.md](SECURITY.md) から報告してください。

## 開発

```bash
bun run app
bun run dev:launcher
bun run src/cli.ts dev status
bun run dev:chat compaction-lab "Reply with exactly: DEV READY"
bun run verify
bun run smoke:subagents
bun run app:package
```

`dev:launcher` は `~/.codex-chatgpt-web-dev` に 2 つ目のランチャープロファイルを作成します。
Electron state、ブラウザーの cookie／ログイン、ChatGPT アカウント、設定、サンドボックス化された `CODEX_HOME`、
チャット、診断、broker、トンネルプロファイルは本番環境から分離されます。通常のランチャーと同時に実行でき、
Responses daemon の起動や Codex の変更は行いません。任意の Full セットアップでは、独立した ChatGPT コネクタ名
`Codex Native3 DEV` を使用し、隔離された MCP トンネルのみを起動・監視します。

`dev:chat` は名前付きの永続的な synthetic outer-Codex ハーネスです。現在の作業ツリーを、隔離されたランチャーの
ブラウザー、一時チャット、プロンプトコンパイラー、Responses parser、コンパクションハンドラーを通して実行します。
任意の Full セットアップでは MCP コネクタと broker も検証され、ツールの効果は明示的なシミュレーション結果になります。
Browser-only チャットは外側のツールを公開しません。Responses リスナーを開いたり、`openai_base_url` を変更したり、
稼働中 daemon を停止したり、ポート 17841 を使用したりすることもありません。
メッセージなしで実行すると、`/status`、`/fill 30000`、`/compact`、`/model`、`/reset` コマンドを使用できます。
**DEV** と表示されたウィンドウ内で一度サインインし、プロファイルを初期化してください。
シミュレーションツールのターンが必要な場合にのみ、任意の Full ハーネスを設定します。
ランチャーは DEV トンネルを使用可能な状態に保ち、名前付きチャットは必要に応じて broker を接続します。
本番の認証情報や `Codex Native3` コネクタが暗黙的に再利用されることはありません。
[DEV chat ハーネス](docs/dev-chat.md)を参照してください。

- [アーキテクチャ](docs/architecture.md)
- [DEV chat ハーネス](docs/dev-chat.md)
- [セキュリティモデル](docs/security-model.md)
- [トラブルシューティング](TROUBLESHOOTING.md)
- [コントリビューションガイド](CONTRIBUTING.md)

## Star の履歴

<a href="https://www.star-history.com/?repos=Froraut%2Fcodex-chatgpt-web&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Froraut/codex-chatgpt-web&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Froraut/codex-chatgpt-web&type=date&legend=top-left">
    <img alt="Star 履歴チャート" src="https://api.star-history.com/chart?repos=Froraut/codex-chatgpt-web&type=date&legend=top-left">
  </picture>
</a>

## 免責事項

これは独立したソフトウェアであり、OpenAI との提携や OpenAI による推奨を受けたものではありません。
ご自身のアカウントで、適用される[利用規約](https://openai.com/policies/terms-of-use/)と
ワークスペースポリシーに従って使用してください。認証やアクセス制御を回避するものではありません。

既存コネクタの更新には、新しい名前のコネクタが必要です。[MCP タスク読み取りの移行手順](docs/mcp-task-access-migration.md)を参照し、実際の Codex タスクで `codex_read_thread` を確認してください。
