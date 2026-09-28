# NEKODEX

NEKODEX は ChatGPT アカウント、Codex タスク、ローカルツールを扱うデスクトップワークスペースです。**FroRaut** が [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) を基に保守しています。元の作者の帰属表示と MIT ライセンスを維持しています。OpenAI の公式製品ではありません。

[English](README.md) · [简体中文](README.zh-CN.md) · [Русский](README.ru.md) · [トラブルシューティング](TROUBLESHOOTING.md) · [セキュリティ](SECURITY.md)

## ダウンロード

**現在公開されているバージョンは `6.1.7-nekodex.1` です。** ソースのバージョンは先行する場合があります。以下のリンクは実際に公開されたファイルだけを示します。

| 対象 | ダウンロード | 状態 |
| --- | --- | --- |
| macOS 13+、Apple Silicon | [ARM64 DMG](https://github.com/Froraut/NEKODEX/releases/download/v6.1.7-nekodex.1/NEKODEX-6.1.7-nekodex.1-mac-arm64.dmg) | Developer ID 署名・公証済み |
| macOS 13+、Intel | [Intel DMG](https://github.com/Froraut/NEKODEX/releases/download/v6.1.7-nekodex.1/NEKODEX-6.1.7-nekodex.1-mac-x64.dmg) | Developer ID 署名・公証済み |
| Linux x64 | [AppImage](https://github.com/Froraut/NEKODEX/releases/download/v6.1.7-nekodex.1/codex-web-gpt-6.1.7-nekodex.1-linux-x64.AppImage) | 公開済み |
| Windows x64 | [プレビューのビルド](https://github.com/Froraut/NEKODEX/actions/workflows/release.yml) | 未署名。信頼済みアプリ内更新の対象外 |

[リリースノート](https://github.com/Froraut/NEKODEX/releases/tag/v6.1.7-nekodex.1) · [チェックサム](https://github.com/Froraut/NEKODEX/releases/download/v6.1.7-nekodex.1/checksums.txt) · [リリースの真正性](docs/release-signing.md)

macOS では DMG を開き、**NEKODEX** を「アプリケーション」にドラッグしてください。今後公開される更新はアプリ内の **Updates** からインストールできます。アカウント設定と ChatGPT のログインデータは保持し、更新前に実行中のタスクを終えてください。

## ワークスペース

| 画面 | 用途 |
| --- | --- |
| **Accounts** | ChatGPT アカウントごとにセッションを保存し、状態を確認して新しいタスクのルートを選びます。 |
| **Connections** | Codex モデルルートとローカルツールのコネクタを個別に設定します。設定の保存だけでは実際のタスクの成功を証明しません。 |
| **Browser** | 選択したアカウントの ChatGPT ページと、タスクに紐付いたタブを表示します。 |
| **Task center** | 待機中・実行中・失敗・完了したブラウザータスクを確認します。 |
| **Activity** | ローカルの Web/Native 観測値と安全な診断を表示します。公式の残り利用枠ではありません。 |
| **Updates** | 公開済み更新の確認、ダウンロード、検証状況を表示します。 |

自動モードの Codex モデル選択画面には **GPT-5.6 Sol (Web)**、**GPT-5.6 Sol Instant (Web)**、**GPT-5.6 Pro (Web)**、**GPT-6 Pro (Web)** などの**名前付き Web モデル**が表示されます。Luna のみを利用できるアカウントでは **GPT-5.6 Luna (Web)** を表示します。対応する推論レベルは Codex の **Effort** で選びます。保存済みタスクの旧固定モード ID は解決できますが、新規選択画面には表示しません。Codex の Native モデル名は現在の Codex カタログから取得し、NEKODEX が推測して変更することはありません。

**Automatic · Full** は現在のタスクに紐付いた **Codex Native6** コネクタを使用します。**Automatic · Browser-only** では MCP コネクタもローカルツールも不要です。**Manual** ではユーザーがプロンプトを貼り付けて送信し、別の **Codex Zero Risk4** コネクタを選択します。NEKODEX はその ChatGPT ページを読み取り・操作しません。ChatGPT が送信を受け付けない場合、別の利用可能なモデルを選んで同じプロンプトを再コピーできます。**Sent** はメッセージが受け付けられた後に押してください。既存の古いコネクタは互換性のために残し、新規設定ではアプリが示す正確な名前で作成してください。[コネクタ移行ガイド](docs/connector-identity-migration.md)

プロンプトは ChatGPT によってリモート処理されます。アカウントとワークスペースの方針、ツール権限が適用されます。ローカルツールの実行は Codex のサンドボックスと承認に従います。一時チャットは匿名またはローカル推論を意味しません。[セキュリティモデル](docs/security-model.md)

## ソースから実行

Bun 1.4.0 が必要です。開発ランチャーは設定とブラウザーストレージを分離し、インストール済みアプリのアカウントデータを引き継ぎません。

```bash
git clone https://github.com/Froraut/NEKODEX.git nekodex
cd nekodex
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run launcher:dev
```

[DEV ガイド](docs/dev-chat.md) · [アーキテクチャ](ARCHITECTURE.md) · [コントリビューション](CONTRIBUTING.md)
