import type { ComponentProps } from 'react';
import taskControlCopy from '../electron/task-control-copy.json';
import { Button, Notice, SettingRow, cx } from './design';
import type { Copy } from './i18n';
import { DoctorSummary } from './launcher-ui';
import { RouteDiagnostics } from './RouteDiagnostics';
import { settingsCopy } from './settings-copy';
import type { CodexSettingsStatus } from './setup-progress';
import { SupportReportButton, supportReportCopy } from './SupportReportButton';
import type { DoctorReport, Language } from './types';
import { workflowHelpCopy, type WorkflowHelpTopic } from './workflow-help-copy';

type SettingsDiagnosticsProps = {
  copy: Copy;
  language: Language;
  devProfile: boolean;
  locked: boolean;
  codexStatus: CodexSettingsStatus | null;
  codexRestartRequired: boolean;
  showModelSetup: () => void;
  showWorkflow?: (workflow: WorkflowHelpTopic) => void;
  route: Pick<ComponentProps<typeof RouteDiagnostics>, 'disabled' | 'onActionError' | 'onExport' | 'onViewActivity' | 'readReport'> & { generation: number };
  doctor: { report: DoctorReport | null; busy: boolean; onRun: () => void };
  cancelTurns: { message: string | null; busy: boolean; onCancel: () => void };
  integration: { removed: boolean; busy: boolean; onRemove: () => void };
  onError: (message: string) => void;
};

/** Presentation only. SettingsSurface retains the save queue, live owners and transition guards. */
export function SettingsDiagnostics({
  copy, language, devProfile, locked, codexStatus, codexRestartRequired, showModelSetup,
  showWorkflow, route, doctor, cancelTurns, integration, onError,
}: SettingsDiagnosticsProps) {
  const settings = settingsCopy(language);
  const taskCopy = taskControlCopy[language] ?? taskControlCopy.en;
  const supportReport = supportReportCopy(language);
  const workflowHelp = workflowHelpCopy(language);
  return (
    <section className="nk-settings-group" id="settings-diagnostics">
      <header><h2>{copy.diagnostics}</h2></header>
      {codexStatus ? (
        <section className="settings-codex-status" aria-label={copy.modelsConnectionTab}>
          <Notice
            tone={codexStatus === "catalog-error" ? "warning" : "info"}
            title={codexStatus === "picker" ? copy.setupConfirmTitle
              : codexStatus === "catalog-error" ? copy.catalogUnavailable
              : codexStatus === "catalog" ? copy.setupCatalogTitle
              : codexStatus === "removed" ? copy.integrationRemoved : copy.codexSettingsSaved}
            action={<Button size="sm" onClick={showModelSetup}>{copy.openModelSettings}</Button>}
          >
            {codexStatus === "picker"
              ? codexRestartRequired ? copy.setupConfirmRestartBody : copy.setupConfirmBody
              : codexStatus === "catalog-error" ? copy.catalogFailureKeptInstall
              : codexStatus === "removed" ? copy.codexIntegrationRemovedBody
              : codexStatus === "manual-refresh" ? copy.codexManualRefreshBody : copy.setupCatalogBody}
          </Notice>
        </section>
      ) : null}
      <div className="nk-panel">
        {showWorkflow ? (['native', 'vm', 'browser'] as const).map(topic => (
          <SettingRow key={topic} data-settings-search
            title={workflowHelp.guides[topic].title}
            description={workflowHelp.guides[topic].body}
            control={<Button onClick={() => showWorkflow(topic)}>{workflowHelp.guides[topic].action}</Button>}
          />
        )) : null}
        {!devProfile ? (
          <RouteDiagnostics
            key={route.generation}
            disabled={route.disabled}
            language={language}
            onActionError={route.onActionError}
            onExport={route.onExport}
            onViewActivity={route.onViewActivity}
            readReport={route.readReport}
          />
        ) : null}
        <SettingRow data-settings-search
          title={supportReport.action}
          description={supportReport.body}
          control={<SupportReportButton language={language} onError={onError} />}
        />
        <SettingRow data-settings-search
          className={cx(doctor.report && "settings-row--with-result")}
          title={copy.runDoctor}
          description={settings.doctorBody}
          control={(
            <Button icon="activity" busy={doctor.busy} disabled={locked} onClick={doctor.onRun}>{copy.runDoctor}</Button>
          )}
        />
        {doctor.report ? (
          <div className="settings-row-result">
            <DoctorSummary copy={copy} language={language} report={doctor.report} />
          </div>
        ) : null}
        {/* Both destructive rows open the launcher's own confirmation dialog, whose Cancel all / Remove is the
            confirming (danger) step; the row button is only the first, secondary click. */}
        {!devProfile ? (
          <SettingRow data-settings-search
            title={taskCopy.all}
            description={cancelTurns.message ?? taskCopy.detail}
            control={<Button busy={cancelTurns.busy} disabled={locked} onClick={cancelTurns.onCancel}>{taskCopy.confirm}</Button>}
          />
        ) : null}
        {!devProfile ? (
          <SettingRow data-settings-search
            title={copy.uninstallIntegration}
            description={integration.removed ? copy.integrationRemoved : copy.uninstallIntegrationBody}
            control={(
              <Button busy={integration.busy} disabled={locked || integration.removed} onClick={integration.onRemove}>
                {settings.remove}
              </Button>
            )}
          />
        ) : null}
      </div>
    </section>
  );
}
