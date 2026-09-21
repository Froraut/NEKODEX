<h1 align="center">NEKODEX</h1>

ChatGPT 账户、编程智能体与本地工具的桌面工作空间。
NEKODEX 提供原创猫咪图标、概览、独立账户管理页和石墨紫色界面。
参见[设计与兼容性说明](docs/design/nekodex.md)。

**当前下载版本：** `5.9.0-nekodex.1`，适用于 macOS 13 或更高版本。

| Mac 类型 | 下载 |
| --- | --- |
| Apple Silicon（M1 及更新型号） | [ARM64 DMG](https://github.com/Froraut/NEKODEX/releases/download/v5.9.0-nekodex.1/NEKODEX-5.9.0-nekodex.1-mac-arm64.dmg) |
| Intel | [Intel DMG](https://github.com/Froraut/NEKODEX/releases/download/v5.9.0-nekodex.1/NEKODEX-5.9.0-nekodex.1-mac-x64.dmg) |

[发行页面](https://github.com/Froraut/NEKODEX/releases/tag/v5.9.0-nekodex.1) · [校验和](https://github.com/Froraut/NEKODEX/releases/download/v5.9.0-nekodex.1/checksums.txt)。本次发行提供 macOS 和 Linux x64 安装包；未签名的 Windows 预览包单独提供。
首次安装 NEKODEX 需要手动过渡，因为旧更新器会验证原来的可执行文件名。
已有浏览器配置及数据标识保持不变，以保留账户状态。

由 **FroRaut** 维护，基于
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)。
保留原作者归属及 MIT 许可证。
参见[审查与改进路线图](docs/reviews/2026-09-11-review.md)。

```bash
git clone https://github.com/Froraut/codex-chatgpt-web.git
cd codex-chatgpt-web
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run dev:launcher
```

请使用 Bun 1.4.0。`dev:launcher` 使用隔离的开发配置，供审查和登录测试使用。
`bun run app` 同样启动源码开发版启动器。要替换已安装的应用，需要打包构建。
启用生产集成前，请先阅读[DEV 隔离](docs/dev-chat.md)。

<p align="center">
  <strong>将 ChatGPT Web（包括 Pro）作为 Codex 原生模型使用。</strong><br>
  切换模型档位，保留原有工作流。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="TROUBLESHOOTING.md">故障排除</a> · <a href="SECURITY.md">安全</a> · <a href="CONTRIBUTING.md">贡献</a>
</p>

<p align="center">
  <a href="https://github.com/Froraut/codex-chatgpt-web/actions/workflows/ci.yml"><img src="https://github.com/Froraut/codex-chatgpt-web/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/macOS-arm64%20%7C%20x64-black?logo=apple" alt="macOS arm64 and x64">
  <img src="https://img.shields.io/badge/Windows-x64-0078d4?logo=windows11" alt="Windows x64">
  <img src="https://img.shields.io/badge/Linux-x64-fcc624?logo=linux&logoColor=black" alt="Linux x64">
</p>

Free 和 Go 账户会在 Codex 原生模型选择器中看到 **ChatGPT Web — Luna**。具有推理选择器的
账户仍会按订阅权限看到 **Instant**、**Medium**、**High**、**Extra High** 和 **Pro**。
桥接程序会把当前编译后的 Codex 任务上下文发送到一个全新的 ChatGPT 临时聊天，附加图片，
并将可见的推理过程、工具活动和 Markdown 流式传回同一个 Codex 任务。

<p align="center">
  <img src="assets/demo.gif" alt="ChatGPT Web 实时轮次正在使用原生 Codex harness" width="960">
</p>

```text
Codex task ──Responses + SSE──▶ codex-chatgpt-web ──embedded browser──▶ ChatGPT
     ▲                                │                                      │
     └──────── native UI, context, images, tracing, and tool lifecycle ──────┘
```

Codex 会保留原生任务、上下文生命周期、界面和工具 harness。本地 Responses 桥接程序只会将
所选模型的任务转发到与该任务绑定的 ChatGPT 临时聊天；在完整模式下，MCP 会把 ChatGPT 连接回
同一个 Codex 任务的工具，直到下一次上下文压缩边界。

完整的分支工作流程、账号与连接器边界及替代方案请参阅 [工作流程、设置和替代方案](docs/workflow-and-alternatives.md).

[Hermes integration: Web models with Hermes tools](docs/hermes-integration.md)

## 亮点

- **Codex 原生模型。** ChatGPT Web 直接出现在 Codex 模型选择器中，同时保留原有任务界面、
  上下文生命周期、流式输出、追踪和工具展示。
- **通过 MCP 使用完整 Codex harness。** 完整模式支持登录账户公开的全部 effort（包括 Pro），
  并可访问当前任务的文件系统、shell、图片、审批以及已配置的工具和应用。
- **连续任务会话与原生上下文压缩。** 连续消息会复用同一个与任务绑定的临时聊天。到达上下文
  边界时，保留的 agent 会先写出检查点，再由 Codex 从干净聊天继续；若该私有聊天已被关闭，
  则使用 Codex 的规范任务历史作为回退来源。
- **统一的跨平台启动器。** macOS、Windows 和 Linux 应用统一管理登录、模型设置、MCP 指南、
  健康检查、安全诊断以及最多十六个可见的任务绑定浏览器标签页。
- **故障时明确失败。** 模型、工具缺失或 ChatGPT UI 发生变化时会返回明确错误，而不会静默切换
  路由或能力。端到端覆盖范围记录在[发布验证](docs/release-validation.md)中。

临时聊天是 ChatGPT 的隐私模式，并不代表匿名或仅在本地推理：提示仍会由 OpenAI 处理，并受账户
设置及 OpenAI [临时聊天政策](https://help.openai.com/en/articles/8914046-temporary-chat-faq)
约束。本项目为非官方项目；用户仍需自行遵守适用的 OpenAI 条款和工作区政策。

## 快速开始

从本页顶部下载与 Mac 匹配的 DMG。先退出已有应用，再将 NEKODEX 拖入“应用程序”文件夹。
保留已有配置文件和账户数据。Windows 和 Linux 源码仍保留在仓库中，本次发行不提供对应安装包。

然后在应用中完成三项检查：

1. 直接在启动器内置的 ChatGPT 浏览器中登录。普通登录页和身份提供商窗口保留在启动器管理的
   私有配置中。在 macOS 上，选择 **使用通行密钥** 会打开专用的 Chrome 配置；在那里完成登录后，
   返回启动器并选择 **导入 Chrome 登录**，仅传输和验证白名单内的 ChatGPT/OpenAI 会话。
2. 运行浏览器冒烟测试。
3. 点击 **安装模型**，重启一次 Codex，然后选择一个 **ChatGPT Web — …** 模型。

启动器会在设置期间检测当前账户的 ChatGPT 控件：Free/Go 账户只会显示 Luna；只有已登录账户
支持 Pro 时，Pro 才会显示。独立的 **MCP** 页面是可选项，它会在不需要终端命令的情况下引导你
完成完整 harness 设置。

打包后的启动器在内置浏览器中运行 ChatGPT 模型轮次。普通内置登录不需要安装 Chrome/Chromium，
可选的 macOS 通行密钥流程需要 Chrome。打包版本不需要模型 API 密钥、系统级 Node/Bun，
也不会由本项目另行下载浏览器。

**从源码运行**

```bash
git clone https://github.com/Froraut/codex-chatgpt-web.git && \
cd codex-chatgpt-web && \
bun run app
```

源码方式需要 Bun 1.4.0。该命令会安装锁定版本的依赖并打开应用。

## 模式

| 模式 | 模型 | 本地 Codex 工具 | 额外设置 |
| --- | --- | --- | --- |
| **仅浏览器** | Free/Go：Luna；Plus：Instant–High；Pro：增加 Extra High 和 Pro | 不可用；Codex 会显示警告 | 无 |
| **完整 harness** | Free/Go：Luna；Plus：Instant–High；Pro：增加 Extra High 和 Pro | 每个列出的 effort 均支持，包括 Pro | OpenAI 隧道 + ChatGPT 连接器 |
| **手动模式（Manual）** | 在 ChatGPT 中自行选择模型和 effort；启动器不会验证手动选择 | 通过独立连接器使用与当前回合绑定的 Codex 工具；Codex 路由仅支持文本 | 独立的 OpenAI 隧道 + `.2` 源码中的 `Codex Zero Risk4` 连接器；自行粘贴并发送提示 |

自动模式的模型选择器条目各自对应一个固定的 ChatGPT 模式。Codex 仍会显示内置的 Effort 和 Speed
选项，但更改它们不会在后台静默切换所选的浏览器模型。在自动完整模式下，每一个可用 effort 都会
获得同一个与当前回合绑定的 MCP 能力；Pro 没有单独限制，也没有缩减后的工具契约。

旧版 **Zero Risk** 模式现改名为**手动模式**。现有 `chatgpt-web/zero-risk` 和 `chatgpt-web/zero-risk-pro` 模型 ID、命令行选项及已保存设置保持兼容。`.2` 源码中连接器的准确名称为 `Codex Zero Risk4`；已发布 `.1` 二进制仍使用 `Codex Zero Risk2`。手动模式不自动读写 ChatGPT 页面或发送提示，但账户限制及 MCP/本地工具的实际影响仍然存在。操作步骤和故障排查见[手动流程指南](TROUBLESHOOTING.md#manual-workflow-stops)。

手动模式的 Codex 路由**仅支持文本**，不会自动接收 Computer Use 截图或其他图片输入。
图片必须在 ChatGPT 中手动添加；这样做也不会启用此路由的自动截图传递。进行视觉检查时，
请使用支持图片输入的路由，并验证实际的工具返回结果。关于图片、Windows 绑定和键盘错误
各自的限制，请参阅 [Computer Use 图片限制审查](docs/upstream-issue-457-computer-use.md)。

## 完整 harness

完整模式通过官方
[OpenAI tunnel-client](https://github.com/openai/tunnel-client)
将 ChatGPT 的工具调用连接回当前 Codex 任务。该隧道为出站连接：不会暴露公网 IP、开放入站端口，
也不需要配置路由器端口转发。

> **限制**
>
> 有关 **GPT-5.6 Sol Pro** 和 **GPT-6 Astra** 当前的 ChatGPT 消息额度，请参阅
> [Limits](https://github.com/miuuyy/codex-chatgpt-web/discussions/309)。Token 上下文上限取决于
> 账户类型和所选 effort。Plus 的 Medium/High 使用实测的 90,000-token 窗口；启用实验性的
> **3× context** 后最高为 270,000 tokens，并且全程支持原生 Codex compaction。

1. 完成启动器中的必需设置。
2. 在启动器中打开 **MCP**。请在将使用 ChatGPT 连接器的同一个 OpenAI 账户中创建 Tunnel
   和普通 API 密钥；创建密钥本身免费，也不会消耗模型 API 额度。
3. 粘贴 Tunnel ID 和 API 密钥，然后点击 **连接 Harness**。
4. 在 ChatGPT 设置中启用 **开发者模式**。新建连接器时选择 **Tunnel**，选择刚创建的
   Tunnel，将 **身份验证** 设为 **无**，并将名称准确设置为 **Codex Native4**（`.2` 源码）。
5. 在 **Codex Native4** 的 **权限** 中选择 **允许所有操作**；**允许低风险操作** 会在命令和
   补丁到达本地运行时前将其拦截。外层 Codex harness 仍会执行沙箱和审批规则。
6. 运行 **验证运行时**，检查 **Codex Native4** 的连接和运行时状态。

从已发布的 `.1` 二进制切换到按 `.2` 源码构建的运行时时，先启动新运行时，并按所用模式分别执行
**MCP → 连接 Harness**。然后在同一 OpenAI 账户的 ChatGPT 设置中，为该模式显示的 Tunnel
**新建**准确命名的连接器：自动完整模式使用 `Codex Native4`，隔离 DEV 完整模式使用
`Codex Native4 DEV`，手动模式使用 `Codex Zero Risk4`；身份验证选择**无**。自动完整模式运行
**验证运行时**；手动模式在粘贴并发送准备好的提示词前自行选择 `Codex Zero Risk4`。DEV 使用
独立 Tunnel 和账户配置。不要重命名或刷新旧连接器：ChatGPT 会按名称缓存公开工具契约。
`.1` 二进制仍对应 `Codex Native3`、`Codex Native3 DEV` 和 `Codex Zero Risk2`。保存本地设置或
看到连接器，并不证明实际 ChatGPT 工具调用已经成功；需要在当前任务中检查真实调用结果。

写入/修改操作还需要 ChatGPT 工作区及其管理员政策允许。请参阅
[开发者模式和 MCP 应用](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)。
除非显式启用 `--auto-approve-tool-calls`，否则意外的审批提示会直接失败；该选项只会点击
**Allow once**，绝不会授予永久权限。

## 日常操作

要使用普通 Chrome 配置文件中已经登录的 ChatGPT 账户，请参阅
[使用现有 Chrome 登录](docs/existing-chrome-sign-in.md)。此操作需要在 Chrome 中明确允许连接，
并且只将限定范围内的 ChatGPT/OpenAI 会话导入启动器。

使用 **活动** 页面查看安全的本地诊断，并通过 **设置 → 运行诊断** 执行端到端健康检查。设置页还可
取消保留的浏览器任务，或在卸载前移除 Codex 集成。仅在需要为每个浏览器检查点保存截图时设置
`CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS=1`。
使用[账户与 UI 验收工具](docs/account-ui-acceptance.md)运行带版本的离线样例，或单独明确启用
本地检查与账户检查。默认不会执行任何账户操作。
浏览器诊断默认保留最近 50 个已完成任务的记录，并保护仍由活动进程持有的记录。
将 `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT` 设为 1 至 1000 可调整已完成记录的保留数量。
进程崩溃后留下的记录会进入正常清理范围。

**设置 → 自动化 Pro 模型**可将自动化 Pro 回合固定为 **GPT-5.6 Sol Pro**、**GPT-5.5 Pro**
或 **GPT-6 Astra Pro**。默认的**跟随 ChatGPT**保留原有行为。选项从下一次 Pro 回合生效，
无需重启 Codex 或启动器，不影响其他档位及手动模式回合。所选版本不可用或无法验证时，
会在发送当前提示词前报错，不会切换到其他版本；GPT-6 仅在验证显示为 6 Pro 时使用“最新”选项。

新安装默认使用 **Compatibility V1** 以支持跨后端 subagent。**Native** 会保留 Codex 自身的
功能设置，并启用明文 Web-to-Web V2 委派。切换协议后，请重启 Codex 并创建新任务：

```bash
codex-chatgpt-web subagents status
codex-chatgpt-web subagents compatibility-v1
codex-chatgpt-web subagents native
```

## 限制和安全性

- 这是非官方浏览器自动化，并非 OpenAI API。ChatGPT UI 变更可能破坏选择器；发生变化时会明确
  失败，而不是静默切换模型或传输方式。
- 浏览器状态是敏感的登录凭据，loopback 监听器也可被同一本地用户运行的进程访问。切勿共享
  启动器 profile，并仅在可信工作站上使用。
- 发布包目前支持 macOS 13+（arm64/x64）、Windows x64 和 Linux x64。运行时、测试和打包会在
  CI 中对三种系统进行检查；依赖账户的浏览器与 MCP 流程使用单独的
  [发布验证](docs/release-validation.md)。
- 构建目前尚未进行平台签名，因此 Gatekeeper 或 SmartScreen 可能会显示警告。安装程序会在安装前
  验证已发布的 SHA-256 清单。

启用完整模式前，请阅读完整的[架构说明](docs/architecture.md)和
[安全模型](docs/security-model.md)。安全漏洞请通过 [SECURITY.md](SECURITY.md) 报告。

## 开发

```bash
bun run app
bun run dev:launcher
bun run src/cli.ts dev status
bun run dev:chat compaction-lab "Reply with exactly: DEV READY"
bun run verify
bun run smoke:subagents
bun run app:package
```

`dev:launcher` 会在 `~/.codex-chatgpt-web-dev` 下启动第二个独立的启动器配置：Electron 状态、
浏览器 Cookie/登录、ChatGPT 账户、配置、沙箱化 `CODEX_HOME`、聊天、诊断、broker 和 tunnel
配置均与正式启动器隔离。它可以与正式启动器同时运行，绝不会启动 Responses daemon 或修改
Codex。可选的完整模式只会启动并监管隔离的 DEV MCP tunnel，并使用独立连接器名称
`Codex Native4 DEV`（`.2` 源码；已发布 `.1` 仍使用 `Codex Native3 DEV`）。

`dev:chat` 是一个具名、持久的合成外层 Codex harness。它通过隔离的启动器浏览器、临时聊天、
prompt compiler、Responses parser 和压缩处理器执行当前工作树。可选的完整模式也会测试 MCP
连接器和 broker；工具效果会显示为明确的模拟回执。仅浏览器聊天不会暴露外层工具。该命令不会
打开 Responses listener、修改 `openai_base_url`、停止正式 daemon，也不会占用 17841 端口。
不带消息运行时，可使用 `/status`、`/fill 30000`、`/compact`、`/model` 和 `/reset`。首次使用时，
请在标有 **DEV** 的窗口中登录并初始化一次配置。完整模式仅用于模拟工具轮次；DEV 启动器会保持
DEV tunnel 就绪，具名聊天按需连接 broker。正式凭据和 `Codex Native4` 连接器绝不会被隐式复用。
详见 [DEV chat harness](docs/dev-chat.md)。

- [架构说明](docs/architecture.md)
- [DEV chat harness](docs/dev-chat.md)
- [安全模型](docs/security-model.md)
- [故障排除](TROUBLESHOOTING.md)
- [贡献指南](CONTRIBUTING.md)

## Star History

<a href="https://www.star-history.com/?repos=Froraut%2Fcodex-chatgpt-web&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Froraut/codex-chatgpt-web&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Froraut/codex-chatgpt-web&type=date&legend=top-left">
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Froraut/codex-chatgpt-web&type=date&legend=top-left">
  </picture>
</a>

## 免责声明

本项目是独立软件，与 OpenAI 无关联，也未获得 OpenAI 背书。请仅使用自己的账户，并遵守适用的
[使用条款](https://openai.com/policies/terms-of-use/)和工作区政策；本项目不会绕过身份验证或
访问控制。

升级现有连接器时，需要创建使用新名称的连接器。请参阅 [MCP 任务读取迁移指南](docs/mcp-task-access-migration.md)，并在实际 Codex 任务中验证 `codex_read_thread`。
