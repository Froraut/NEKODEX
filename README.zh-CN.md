# NEKODEX

NEKODEX 是用于管理 ChatGPT 账户、Codex 任务和本地工具的桌面工作空间，由 **FroRaut** 维护，基于 [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)。保留原作者署名与 MIT 许可证。本项目不是 OpenAI 官方产品。

[English](README.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [故障排除](TROUBLESHOOTING.md) · [安全说明](SECURITY.md)

## 下载

**目前公开发布的版本：`6.1.9-nekodex.1`。** 源码版本可能更新；公开下载链接只指向已经发布的文件。

| 平台 | 下载 | 状态 |
| --- | --- | --- |
| macOS 13+，Apple Silicon | [ARM64 DMG](https://github.com/Froraut/NEKODEX/releases/download/v6.1.9-nekodex.1/NEKODEX-6.1.9-nekodex.1-mac-arm64.dmg) | Developer ID 签名并公证 |
| macOS 13+，Intel | [Intel DMG](https://github.com/Froraut/NEKODEX/releases/download/v6.1.9-nekodex.1/NEKODEX-6.1.9-nekodex.1-mac-x64.dmg) | Developer ID 签名并公证 |
| Linux x64 | [AppImage](https://github.com/Froraut/NEKODEX/releases/download/v6.1.9-nekodex.1/codex-web-gpt-6.1.9-nekodex.1-linux-x64.AppImage) | 已发布 |
| Windows x64 | [构建预览](https://github.com/Froraut/NEKODEX/actions/workflows/release.yml) | 未签名；不支持应用内可信更新 |

[发行说明](https://github.com/Froraut/NEKODEX/releases/tag/v6.1.9-nekodex.1) · [校验和](https://github.com/Froraut/NEKODEX/releases/download/v6.1.9-nekodex.1/checksums.txt) · [发行真实性](docs/release-signing.md)

在 macOS 上打开 DMG，将 **NEKODEX** 拖入“应用程序”。今后的已发布更新可从应用内的 **Updates** 页面安装。保留账户配置和 ChatGPT 登录资料；更新前先完成正在运行的任务。

## 工作方式

| 页面 | 用途 |
| --- | --- |
| **Accounts** | 为每个 ChatGPT 账户保存独立会话，检查账户状态，并选择新任务的路由。 |
| **Connections** | 分别设置 Codex 模型路由与本地工具连接器。配置已保存不等于真实任务已成功。 |
| **Browser** | 查看当前账户的 ChatGPT 页面及绑定到任务的浏览器标签页。 |
| **Task center** | 查看等待、运行、失败和完成的浏览器任务。 |
| **Activity** | 查看本地 Web/Native 观测数据和安全诊断；它不是官方账户剩余额度。 |
| **Updates** | 检查已发布的 NEKODEX 更新并查看下载和验证状态。 |

自动模式在 Codex 模型选择器中展示**具名 Web 模型**，例如 **GPT-5.6 Sol (Web)**、**GPT-5.6 Sol Instant (Web)**、**GPT-5.6 Pro (Web)**、**GPT-6 Pro (Web)**；只有 Luna 控件的账户使用 **GPT-5.6 Luna (Web)**。支持的推理强度通过 Codex 的 **Effort** 选择。现有任务仍可解析旧的固定模式 ID，但新任务的选择器不再显示那些旧条目。Codex 原生模型名称来自当前 Codex 目录，不由 NEKODEX 猜测或重命名。

**Automatic · Full** 使用为当前任务绑定的 **Codex Native6** 连接器。**Automatic · Browser-only** 不需要 MCP 连接器，也不提供本地工具。**Manual** 模式由用户自行粘贴并发送提示，并选择独立的 **Codex Zero Risk4** 连接器；NEKODEX 不读取或操作该 ChatGPT 页面。若 ChatGPT 未接受消息，可以换用其他可用模型并重新复制同一提示；只有消息被接受后才点击 **Sent**。既有旧连接器应保留作兼容用途，新设置需创建应用显示的准确名称。[连接器迁移说明](docs/connector-identity-migration.md)

ChatGPT 会远程处理提示。账户、工作区和工具权限仍适用；本地工具执行遵循 Codex 的沙箱与审批规则。临时聊天并非匿名或本地推理。[安全模型](docs/security-model.md)

## 从源码运行

需要 Bun 1.4.0。开发启动器使用独立的配置和浏览器存储，不会接管已安装应用的账户资料。

```bash
git clone https://github.com/Froraut/NEKODEX.git nekodex
cd nekodex
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run launcher:dev
```

[DEV 指南](docs/dev-chat.md) · [架构](ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md)
