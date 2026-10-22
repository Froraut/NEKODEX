import type { ToolDescriptor } from './agent-tools-types';
import type { Language } from './types';
import { Badge, BadgeRow } from './design';

/** A missing task attachment does not mean that the tool schema is invalid. */
export function AgentToolAvailability({ tool, language }: { tool: ToolDescriptor; language: Language }) {
  const ru = language === 'ru';
  const schemaUnsupported = tool.schemaSupported === false;
  const label = tool.supported
    ? (ru ? 'Доступен; требуется подтверждение' : 'Available; approval required')
    : schemaUnsupported
      ? (ru ? 'Схема не поддерживается' : 'Unsupported schema')
      : (ru ? 'Недоступен для этой задачи' : 'Unavailable for this task');
  return <>
    <BadgeRow><strong>{tool.id}</strong><Badge tone={schemaUnsupported ? 'warning' : 'neutral'}>{label}</Badge></BadgeRow>
    {tool.description ? <span>{tool.description}</span> : null}
    {!tool.supported && tool.unsupportedReason ? <p className="agent-tools-muted">{tool.unsupportedReason}</p> : null}
  </>;
}
