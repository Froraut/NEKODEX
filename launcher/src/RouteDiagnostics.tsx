import { useRef, useState } from "react";
import { Icon } from "./icons";
import type { Language, RouteDiagnosticsReport } from "./types";

const en = {
  title: "Check Codex routing", body: "Read the configured provider, Codex home, and observed model-catalog requests.",
  checking: "Checking routing…", refresh: "Check again", failed: "Routing diagnostics could not be read. Try again, or run Doctor for runtime health.",
  scope: "These values come from the launcher's Codex configuration. A running Codex client may use a different home, profile, or command-line override. This check does not change settings.",
  home: "Codex home", file: "Base configuration file", profileFile: "Profile configuration file", profile: "Configured profile", provider: "Configured provider", source: "Provider setting", config: "Configuration", integration: "Integration", route: "Configured route", catalog: "Model-catalog requests", last: "Last successful request",
  none: "Default (no profile selected)", unknown: "Unavailable", installed: "Installed", absent: "Not installed", active: "Active, matches the installed route", inactive: "Inactive", mismatch: "Active, configuration differs", unverified: "Could not verify the route",
  loaded: "Read successfully", missing: "File missing", invalid: "Invalid configuration", unreadable: "Could not read the file",
  default: "Default", root: "Main configuration", profileSource: "Selected profile", observed: "Observed", waiting: "Waiting for the first successful request", unavailable: "Observation unavailable",
  observedBody: "The current bridge runtime received a successful model-catalog request. Model selection and completed turns are separate checks.",
  waitingBody: "After installation, restart Codex and open a new task. If models remain absent, check that Codex uses the home and profile shown here. Reinstalling alone does not explain a missing catalog request.",
  unavailableBody: "The current runtime's catalog observation could not be verified. Run Doctor to check runtime health, then check again.",
  custom: "A custom provider is configured and may bypass this bridge. Confirm which provider the intended Codex task uses before changing any configuration.",
  override: "A local model-catalog override is configured and may replace the bridge's model list. Review that setting in the shown configuration file.",
  routeMismatch: "The configured route differs from the installed bridge. Review the chosen profile and integration status in Doctor before reconnecting.",
  drift: "The installed integration differs from its recorded configuration. Run Doctor to inspect the mismatch before reconnecting.",
  configProblem: "The Codex configuration could not be read reliably. Check the file shown here; provider and route details may be incomplete.",
  profileProblem: "The configured profile could not be resolved by this diagnostic. Check the selected profile and its configuration file.",
  providerProblem: "The configured provider could not be interpreted. Review its setting in the configuration file.",
  integrationProblem: "Integration status could not be read. Run Doctor for a fresh check.",
  recoveryPending: "Integration recovery is pending. This diagnostic did not repair installation files. Review the recovery status before reconnecting.",
} as const;

type DiagnosticsCopy = { [K in keyof typeof en]: string };
const zh: DiagnosticsCopy = {
  title: "检查 Codex 路由", body: "读取配置的提供商、Codex 目录及已观察到的模型目录请求。",
  checking: "正在检查路由…", refresh: "重新检查", failed: "无法读取路由诊断。请重试，或运行诊断检查运行时状态。",
  scope: "这些值来自启动器使用的 Codex 配置。运行中的 Codex 客户端可能使用其他目录、配置档案或命令行覆盖项。此检查不会修改设置。",
  home: "Codex 目录", file: "基础配置文件", profileFile: "档案配置文件", profile: "配置的档案", provider: "配置的提供商", source: "提供商设置来源", config: "配置", integration: "集成", route: "配置的路由", catalog: "模型目录请求", last: "最近成功请求",
  none: "默认（未选择档案）", unknown: "不可用", installed: "已安装", absent: "未安装", active: "已启用，与安装的路由一致", inactive: "未启用", mismatch: "已启用，但配置不一致", unverified: "无法验证路由",
  loaded: "读取成功", missing: "文件不存在", invalid: "配置无效", unreadable: "无法读取文件", default: "默认", root: "主配置", profileSource: "所选档案", observed: "已观察到", waiting: "等待首次成功请求", unavailable: "无法获取观察结果",
  observedBody: "当前桥接运行时已收到成功的模型目录请求。模型选择和回合完成情况需要单独验证。",
  waitingBody: "安装后重启 Codex 并打开新任务。如果仍未显示模型，请确认 Codex 使用此处显示的目录和档案。仅重新安装无法解释缺少目录请求的原因。",
  unavailableBody: "无法验证当前运行时的目录请求记录。请运行诊断检查运行时状态，然后重新检查。",
  custom: "当前配置了自定义提供商，可能绕过此桥接。修改配置前，请确认目标 Codex 任务使用哪个提供商。",
  override: "当前配置了本地模型目录覆盖项，可能替换桥接的模型列表。请检查所示配置文件中的此设置。",
  routeMismatch: "配置的路由与已安装的桥接不同。重新连接前，请通过诊断检查所选档案及集成状态。",
  drift: "已安装的集成与记录的配置不同。重新连接前，请运行诊断检查差异。",
  configProblem: "无法可靠读取 Codex 配置。请检查所示文件；提供商及路由信息可能不完整。",
  profileProblem: "此诊断无法解析配置的档案。请检查所选档案及其配置文件。",
  providerProblem: "无法解析配置的提供商。请检查配置文件中的此设置。",
  integrationProblem: "无法读取集成状态。请运行诊断重新检查。",
  recoveryPending: "集成恢复尚未完成。此次诊断未修复任何安装文件。重新连接前，请检查恢复状态。",
};
const ja: DiagnosticsCopy = {
  title: "Codex のルーティングを確認", body: "設定されたプロバイダー、Codex ホーム、観測済みのモデルカタログ要求を読み取ります。",
  checking: "ルーティングを確認中…", refresh: "再確認", failed: "ルーティング診断を読み取れませんでした。再試行するか、診断を実行してランタイムを確認してください。",
  scope: "表示値はランチャーが使用する Codex 設定に基づきます。実行中の Codex は別のホーム、プロファイル、コマンドラインの上書きを使用している場合があります。この確認で設定は変更されません。",
  home: "Codex ホーム", file: "基本設定ファイル", profileFile: "プロファイル設定ファイル", profile: "設定されたプロファイル", provider: "設定されたプロバイダー", source: "プロバイダーの設定元", config: "設定", integration: "統合", route: "設定されたルート", catalog: "モデルカタログ要求", last: "最後の成功した要求",
  none: "既定（プロファイル未選択）", unknown: "取得不可", installed: "インストール済み", absent: "未インストール", active: "有効、インストール済みルートと一致", inactive: "無効", mismatch: "有効、設定が不一致", unverified: "ルートを検証できません",
  loaded: "読み取り成功", missing: "ファイルがありません", invalid: "無効な設定", unreadable: "ファイルを読み取れません", default: "既定", root: "メイン設定", profileSource: "選択したプロファイル", observed: "観測済み", waiting: "最初の成功した要求を待機中", unavailable: "観測結果を取得できません",
  observedBody: "現在のブリッジランタイムでモデルカタログ要求の成功が観測されました。モデル選択とターンの完了は別途確認が必要です。",
  waitingBody: "インストール後に Codex を再起動して新しいタスクを開いてください。モデルが表示されなければ、Codex がここに示すホームとプロファイルを使用しているか確認してください。再インストールだけでは要求がない原因は分かりません。",
  unavailableBody: "現在のランタイムのカタログ要求を検証できませんでした。診断でランタイムを確認してから再確認してください。",
  custom: "カスタムプロバイダーが設定されており、このブリッジを経由しない可能性があります。設定を変更する前に、対象の Codex タスクが使うプロバイダーを確認してください。",
  override: "ローカルモデルカタログの上書きが設定されており、ブリッジのモデル一覧を置き換える可能性があります。表示された設定ファイルで確認してください。",
  routeMismatch: "設定されたルートがインストール済みブリッジと異なります。再接続の前に、診断でプロファイルと統合状態を確認してください。",
  drift: "インストール済みの統合が記録された設定と異なります。再接続する前に診断で差異を確認してください。",
  configProblem: "Codex 設定を確実に読み取れませんでした。表示されたファイルを確認してください。プロバイダーとルートの情報が不完全な場合があります。",
  profileProblem: "この診断では設定されたプロファイルを解決できませんでした。選択したプロファイルとその設定ファイルを確認してください。",
  providerProblem: "設定されたプロバイダーを解釈できませんでした。設定ファイルを確認してください。",
  integrationProblem: "統合状態を読み取れませんでした。診断で再確認してください。",
  recoveryPending: "統合の復旧が未完了です。この診断ではインストール済みファイルを修復していません。再接続の前に復旧状態を確認してください。",
};

export function routeDiagnosticsCopy(language: Language): DiagnosticsCopy {
  return language === "zh-CN" ? zh : language === "ja" ? ja : en;
}

export function routeDiagnosticsView(report: RouteDiagnosticsReport, language: Language) {
  const copy = routeDiagnosticsCopy(language);
  const name = (value: string | null) => value && value.trim() === value && /^[\p{L}\p{M}\p{N}_. -]{1,128}$/u.test(value) ? value : copy.unknown;
  const path = (value: string) => value.length <= 4096 && !/[\u0000-\u001f\u007f]|:\/\//.test(value) ? value : copy.unknown;
  const knownConfiguration = report.configStatus === "loaded";
  const catalogStatus = report.catalog.status;
  const catalogValue = catalogStatus === "observed" ? `${copy.observed} (${report.catalog.successfulRequests})`
    : catalogStatus === "waiting" ? copy.waiting : copy.unavailable;
  const rows = [
    { label: copy.home, value: path(report.codexHome) },
    { label: copy.file, value: path(report.configPath) },
    ...(report.profilePath ? [{ label: copy.profileFile, value: path(report.profilePath) }] : []),
    { label: copy.config, value: copy[report.configStatus] },
    { label: copy.profile, value: report.profile ? name(report.profile) : knownConfiguration && !report.issueCodes.includes("profile-unavailable") ? copy.none : copy.unknown },
    { label: copy.provider, value: knownConfiguration ? name(report.provider) : copy.unknown },
    { label: copy.source, value: !knownConfiguration ? copy.unknown : report.providerSource === "profile" ? copy.profileSource : report.providerSource === "unknown" ? copy.unknown : copy[report.providerSource] },
    { label: copy.integration, value: report.installed === null ? copy.unknown : report.installed ? copy.installed : copy.absent },
    { label: copy.route, value: report.active === false ? copy.inactive : report.active && report.routeMatches === true ? copy.active : report.active && report.routeMatches === false ? copy.mismatch : copy.unverified },
    { label: copy.catalog, value: catalogValue },
  ];
  if (catalogStatus === "observed" && report.catalog.lastSuccessfulAt) {
    const date = new Date(report.catalog.lastSuccessfulAt);
    if (Number.isFinite(date.getTime())) rows.push({ label: copy.last, value: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "medium" }).format(date) });
  }
  const messages: Record<string, string> = {
    "custom-provider": copy.custom, "catalog-override": copy.override, "route-mismatch": copy.routeMismatch,
    "integration-drift": copy.drift, "config-missing": copy.configProblem, "config-invalid": copy.configProblem,
    "config-unreadable": copy.configProblem, "profile-unavailable": copy.profileProblem,
    "provider-invalid": copy.providerProblem, "integration-unreadable": copy.integrationProblem,
    "integration-recovery-pending": copy.recoveryPending,
  };
  return { rows, guidance: [...new Set(report.issueCodes.filter(code => Object.hasOwn(messages, code)).map(code => messages[code]!))],
    catalogBody: catalogStatus === "observed" ? copy.observedBody : catalogStatus === "waiting" ? copy.waitingBody : copy.unavailableBody };
}

export function RouteDiagnosticsResult({ report, language }: { report: RouteDiagnosticsReport; language: Language }) {
  const copy = routeDiagnosticsCopy(language);
  const view = routeDiagnosticsView(report, language);
  return (
    <div className="route-diagnostics-result" aria-live="polite">
      <p>{copy.scope}</p>
      <dl>{view.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      <p>{view.catalogBody}</p>
      {view.guidance.length ? <ul>{view.guidance.map(message => <li key={message}>{message}</li>)}</ul> : null}
    </div>
  );
}

export function RouteDiagnostics({ language, disabled = false, readReport }: {
  language: Language;
  disabled?: boolean;
  readReport: () => Promise<RouteDiagnosticsReport>;
}) {
  const [report, setReport] = useState<RouteDiagnosticsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const copy = routeDiagnosticsCopy(language);
  const check = async () => {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    setReport(null);
    try { setReport(await readReport()); }
    catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return (
    <section className="route-diagnostics" aria-label={copy.title}>
      <button className="diagnostic-row" disabled={disabled || busy} onClick={() => void check()} type="button">
        <Icon name="activity" />
        <span><strong>{busy ? copy.checking : report ? copy.refresh : copy.title}</strong><small>{copy.body}</small></span>
        <Icon name="chevron" />
      </button>
      {failed ? <p className="route-diagnostics-error" role="alert">{copy.failed}</p> : null}
      {report ? <RouteDiagnosticsResult report={report} language={language} /> : null}
    </section>
  );
}
