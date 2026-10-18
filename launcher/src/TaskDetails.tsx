import { Disclosure, Badge } from './design';
import { taskDetailCopy } from './task-detail-copy';
import { taskCenterCopy } from './task-center-copy';
import type { BrowserTaskState, Language } from './types';

/** This projection reads only bounded owner-provided metadata, never prompts or tool arguments. */
export function TaskDetails({ task, language, timeFormat }: { task: BrowserTaskState; language: Language; timeFormat: Intl.DateTimeFormat }) {
  const text = taskDetailCopy(language);
  const shared = taskCenterCopy(language);
  const observation = task.observation;
  const transitions = { compaction: text.compaction, checkpoint: text.checkpoint, 'browser-rebind': text.browserRebind, 'assistant-replacement': text.assistantReplacement };
  const submission = { 'not-sent': text.notSent, unknown: text.unknown, uncertain: text.uncertain, 'context-accepted': text.contextAccepted, accepted: text.accepted };
  const time = (value: number) => <time dateTime={new Date(value).toISOString()}>{timeFormat.format(value)}</time>;
  return <Disclosure title={text.details} className="task-details">
    <section className="task-details__section">
      <h3>{text.delivery}</h3>
      <dl className="task-details__facts">
        <dt>{text.owner}</dt><dd>{text.browser} · {task.accountName} · <code>{task.accountId}</code></dd>
        <dt>{text.delivery}</dt><dd>{submission[task.submission]}</dd>
        <dt>{text.settlement}</dt><dd>{shared.phases[task.phase]}</dd>
        <dt>{text.observed}</dt><dd>{time(task.updatedAt)}</dd>
      </dl>
      <p>{task.submission === 'not-sent' ? text.notSentBody : task.submission === 'accepted' ? text.acceptedBody : text.uncertainBody}</p>
      {task.phase === 'cancelled' ? <p>{text.cancelledBody}</p> : null}
      {task.delivery?.length ? <ol className="task-details__receipts">{task.delivery.map(receipt => <li key={receipt.sequence}>
        <strong>{shared.phases[receipt.phase]}</strong><span>{submission[receipt.submission]} · {time(receipt.observedAt)}</span>
      </li>)}</ol> : <p className="task-details__muted">{text.unavailable}</p>}
    </section>
    <section className="task-details__section">
      <h3>{text.actions}</h3><p>{text.actionGuard}</p>
      <ul className="task-details__capabilities">
        <li>{shared.open}: {task.canOpen ? text.available : text.openUnavailable}</li>
        <li>{shared.cancel}: {task.canCancel ? text.available : text.cancelUnavailable}</li>
        <li>{shared.dismiss}: {task.canDismiss ? text.available : text.dismissUnavailable}</li>
      </ul>
    </section>
    <section className="task-details__section">
      <h3>{text.lineage}</h3>
      <dl className="task-details__facts">
        <dt>{text.trace}</dt><dd><code>{task.traceId}</code></dd>
        <dt>{text.document}</dt><dd><code>{task.tabId || text.unavailable}</code></dd>
        <dt>{text.thread}</dt><dd><code>{observation?.native?.threadId ?? text.unavailable}</code></dd>
        <dt>{text.turn}</dt><dd><code>{observation?.native?.turnId ?? text.unavailable}</code></dd>
      </dl>
      {observation ? <p className="task-details__muted">{text.source}: <code>{observation.source}</code> · {text.observed}: {time(observation.observedAt)}</p> : null}
      {observation?.lineage.length ? <ul className="task-details__records">{observation.lineage.map((link, index) => <li key={index}>
        <strong>{transitions[link.kind]}</strong> · {time(link.observedAt)}
        {link.fromId ? <div><code>{link.fromId}</code>{link.toId !== link.fromId ? <> → <code>{link.toId ?? text.unavailable}</code></> : null}</div> : null}
        {link.sourceTraceId ? <div>{text.trace}: <code>{link.sourceTraceId}</code></div> : null}
      </li>)}</ul> : <p className="task-details__muted">{text.noLineage}</p>}
    </section>
    <section className="task-details__section">
      <h3>{text.workers}</h3><p>{text.workerNote}</p>
      {observation?.native?.parentThreadId ? <><dl className="task-details__facts">
        <dt>{text.source}</dt><dd><code>{observation.native.source}</code></dd>
        <dt>{text.observed}</dt><dd>{time(observation.observedAt)}</dd>
        <dt>{text.identifiers}</dt><dd>{observation.native.parentThreadId ? <><code>{observation.native.parentThreadId}</code> → </> : null}<code>{observation.native.threadId}</code>{observation.native.agentName ? <> · {observation.native.agentName}</> : null}</dd>
        <dt>{shared.status}</dt><dd>{text.requestObserved}</dd>
      </dl></> : <p className="task-details__muted">{text.noWorkers}</p>}
    </section>
    <section className="task-details__section">
      <h3>{text.tools}</h3><p>{text.readOnly}</p>
      {observation ? <p className="task-details__muted">{text.source}: <code>{observation.source}</code> · {text.observed}: {time(observation.observedAt)}</p> : null}
      {observation?.tools.length ? <ul className="task-details__records">{observation.tools.map((tool, index) => <li key={`${tool.name}:${index}`}>
        <strong><code>{tool.namespace ? `${tool.namespace} / ` : ''}{tool.name}</code></strong>
        <div className="task-details__badges">
          {tool.advertised ? <Badge>{text.advertised}</Badge> : null}{tool.selected ? <Badge>{text.selected}</Badge> : null}
          {tool.observed === 'succeeded' ? <Badge tone="success">{text.succeeded}</Badge> : null}
        </div>
        <div>{text.source}: <code>{observation.source}</code> · {text.scope}: <code>{task.traceId}</code></div>
        {tool.observedAt ? <div>{text.observed}: {time(tool.observedAt)}</div> : null}
      </li>)}</ul> : <p className="task-details__muted">{text.noTools}</p>}
      {observation?.toolsTruncated ? <p className="task-details__muted">{text.partial}</p> : null}
    </section>
    <section className="task-details__section">
      <h3>{text.skills}</h3><p>{text.digestNote}</p>
      {observation?.skills.length ? <ul className="task-details__records">{observation.skills.map((skill, index) => <li key={`${skill.contentDigest}:${index}`}>
        <strong>{skill.name}</strong> <Badge>{text.selected}</Badge>
        <dl className="task-details__facts">
          <dt>{text.source}</dt><dd><code>{skill.source}</code></dd>
          <dt>{text.digest}</dt><dd><code>{skill.contentDigest}</code></dd>
          {skill.sourceDigest ? <><dt>{text.source} · {text.digest}</dt><dd><code>{skill.sourceDigest}</code></dd></> : null}
        </dl>
      </li>)}</ul> : <p className="task-details__muted">{text.noSkills}</p>}
      {observation?.skillsTruncated ? <p className="task-details__muted">{text.partial}</p> : null}
    </section>
  </Disclosure>;
}
