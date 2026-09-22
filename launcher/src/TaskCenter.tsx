import { useRef, useState } from 'react';
import type { BrowserTaskState, Language } from './types';
import './task-center.css';

const terms = {
  en: ['Task center', 'No recorded tasks', 'Open conversation', 'Dismiss', 'Cancel this task', 'Not sent. You can retry in the original Codex task.', 'Inspect this conversation before retrying. Nothing will be resent automatically.', 'Local observation stopped; provider work may continue.', 'Preparing', 'Sending context', 'Context accepted', 'Sending — acceptance not confirmed', 'Accepted by ChatGPT', 'Receiving response', 'Waiting for tools', 'Completed', 'Failed before sending', 'Sending uncertain', 'Response interrupted after sending', 'Observation cancelled', 'Interrupted by restart'],
  ru: ['Центр задач', 'Записанных задач нет', 'Открыть беседу', 'Убрать запись', 'Отменить эту задачу', 'Не отправлено. Можно повторить в исходной задаче Codex.', 'Проверьте беседу перед повтором. Автоматической повторной отправки не будет.', 'Локальное наблюдение остановлено; работа на стороне провайдера может продолжаться.', 'Подготовка', 'Отправка контекста', 'Контекст принят', 'Отправка — принятие не подтверждено', 'Принято ChatGPT', 'Получение ответа', 'Ожидание инструментов', 'Завершено', 'Сбой до отправки', 'Отправка не подтверждена', 'Ответ прерван после отправки', 'Наблюдение отменено', 'Прервано перезапуском'],
  'zh-CN': ['任务中心', '暂无任务记录', '打开对话', '移除记录', '取消此任务', '尚未发送，可在原 Codex 任务中重试。', '重试前检查对话，不会自动重新发送。', '本地观察已停止，提供方可能仍在工作。', '准备中', '正在发送上下文', '上下文已接受', '发送中，尚未确认接受', 'ChatGPT 已接受', '正在接收回复', '等待工具', '已完成', '发送前失败', '发送状态不确定', '发送后回复中断', '观察已取消', '重启导致中断'],
  'zh-TW': ['任務中心', '暫無任務記錄', '開啟對話', '移除記錄', '取消此任務', '尚未傳送，可在原 Codex 任務中重試。', '重試前檢查對話，不會自動重新傳送。', '本機觀察已停止，提供方可能仍在工作。', '準備中', '正在傳送內容', '內容已接受', '傳送中，尚未確認接受', 'ChatGPT 已接受', '正在接收回覆', '等待工具', '已完成', '傳送前失敗', '傳送狀態不確定', '傳送後回覆中斷', '觀察已取消', '重新啟動導致中斷'],
  ja: ['タスクセンター', '記録されたタスクなし', '会話を開く', '記録を閉じる', 'このタスクをキャンセル', '未送信です。元の Codex タスクで再試行できます。', '再試行前に会話を確認してください。自動再送信はしません。', 'ローカル観測を停止しました。提供元の処理は続く場合があります。', '準備中', 'コンテキスト送信中', 'コンテキスト受信済み', '送信中・受信未確認', 'ChatGPT 受信済み', '応答受信中', 'ツール待機中', '完了', '送信前に失敗', '送信状態不明', '送信後に応答中断', '観測キャンセル済み', '再起動により中断'],
  ko: ['작업 센터', '기록된 작업 없음', '대화 열기', '기록 닫기', '이 작업 취소', '전송되지 않았습니다. 원래 Codex 작업에서 재시도할 수 있습니다.', '재시도 전에 대화를 확인하세요. 자동으로 다시 전송하지 않습니다.', '로컬 관찰이 중지되었습니다. 제공자의 작업은 계속될 수 있습니다.', '준비 중', '컨텍스트 전송 중', '컨텍스트 수락됨', '전송 중 — 수락 미확인', 'ChatGPT 수락됨', '응답 수신 중', '도구 대기 중', '완료', '전송 전 실패', '전송 불확실', '전송 후 응답 중단', '관찰 취소됨', '재시작으로 중단됨'],
};
const phaseOrder = ['preparing', 'sending-context', 'context-accepted', 'sending', 'accepted', 'responding', 'waiting-tools', 'completed', 'failed-before-send', 'send-uncertain', 'failed-after-send', 'cancelled', 'interrupted'];
export const taskCenterTitle = (language: Language) => (terms[language] ?? terms.en)[0]!;
const actionCopy = {
  en: ['Stop observing this task? Completed external actions cannot be undone.', 'Keep working', 'The browser document is no longer available. Check the original Codex task; do not resend an uncertain submission.'],
  ru: ['Остановить наблюдение за этой задачей? Выполненные внешние действия не откатываются.', 'Продолжить работу', 'Браузерная страница больше недоступна. Проверьте исходную задачу Codex; не повторяйте отправку с неопределённым результатом.'],
  'zh-CN': ['停止观察此任务？已完成的外部操作无法撤销。', '继续工作', '浏览器页面已不可用。检查原 Codex 任务；不要重复发送状态不确定的请求。'],
  'zh-TW': ['停止觀察此任務？已完成的外部操作無法復原。', '繼續工作', '瀏覽器頁面已無法使用。檢查原 Codex 任務；不要重複傳送狀態不確定的請求。'],
  ja: ['このタスクの観測を停止しますか？完了した外部操作は元に戻せません。', '作業を続ける', 'ブラウザーページは利用できません。元の Codex タスクを確認し、送信状態が不明な要求を再送しないでください。'],
  ko: ['이 작업의 관찰을 중지할까요? 완료된 외부 작업은 되돌릴 수 없습니다.', '계속 작업', '브라우저 페이지를 사용할 수 없습니다. 원래 Codex 작업을 확인하고 전송 상태가 불확실한 요청을 다시 보내지 마세요.'],
};

const historyCopy = {
  en: ['Search trace, account or model', 'Status', 'All', 'Active', 'Needs attention', 'Completed', 'Account', 'All accounts', 'Clear filters', 'No matching tasks', '{shown} of {total} available records', 'Close the retained browser page and remove this record? Check the conversation before retrying; do not resend an uncertain submission. This does not delete provider chat history.', 'Keep record', 'Close page and remove record', 'Task history unavailable for this account. Available records may be incomplete.'],
  ru: ['Поиск по trace ID, аккаунту или модели', 'Статус', 'Все', 'Активные', 'Требуют внимания', 'Завершённые', 'Аккаунт', 'Все аккаунты', 'Сбросить фильтры', 'Совпадений нет', '{shown} из {total} доступных записей', 'Закрыть сохранённую страницу браузера и убрать запись? Проверьте беседу перед повтором; не повторяйте отправку с неопределённым результатом. История бесед у провайдера не удаляется.', 'Оставить запись', 'Закрыть страницу и убрать запись', 'История задач этого аккаунта недоступна. Доступные записи могут быть неполными.'],
  'zh-CN': ['搜索跟踪 ID、账号或模型', '状态', '全部', '进行中', '需要关注', '已完成', '账号', '全部账号', '清除筛选', '没有匹配的任务', '{shown} / {total} 条可用记录', '关闭保留的浏览器页面并移除此记录？重试前请检查对话；不要重新发送状态不确定的请求。这不会删除提供方的聊天历史。', '保留记录', '关闭页面并移除记录', '此账号的任务历史不可用。可用记录可能不完整。'],
  'zh-TW': ['搜尋追蹤 ID、帳號或模型', '狀態', '全部', '進行中', '需要關注', '已完成', '帳號', '全部帳號', '清除篩選', '沒有符合的任務', '{shown} / {total} 筆可用記錄', '關閉保留的瀏覽器頁面並移除此記錄？重試前請檢查對話；不要重新傳送狀態不確定的請求。這不會刪除提供方的聊天歷史。', '保留記錄', '關閉頁面並移除記錄', '此帳號的任務歷史無法使用。可用記錄可能不完整。'],
  ja: ['トレース ID・アカウント・モデルを検索', '状態', 'すべて', '実行中', '要確認', '完了', 'アカウント', 'すべてのアカウント', '絞り込みを解除', '該当するタスクなし', '利用可能な {total} 件中 {shown} 件', '保持されたブラウザーページを閉じて記録を削除しますか？再試行前に会話を確認し、送信状態が不明な要求を再送しないでください。提供元のチャット履歴は削除されません。', '記録を残す', 'ページを閉じて記録を削除', 'このアカウントのタスク履歴は利用できません。表示できる記録が不完全な可能性があります。'],
  ko: ['추적 ID, 계정 또는 모델 검색', '상태', '전체', '진행 중', '확인 필요', '완료', '계정', '모든 계정', '필터 지우기', '일치하는 작업 없음', '사용 가능한 {total}개 기록 중 {shown}개', '보관된 브라우저 페이지를 닫고 기록을 삭제할까요? 재시도 전에 대화를 확인하고 전송 상태가 불확실한 요청을 다시 보내지 마세요. 제공자의 대화 기록은 삭제되지 않습니다.', '기록 유지', '페이지 닫기 및 기록 삭제', '이 계정의 작업 기록을 사용할 수 없습니다. 표시되는 기록이 불완전할 수 있습니다.'],
};
type HistoryHealth = Array<{ accountId: string; accountName: string; issue: 'task-history-unavailable' }>;
type HistoryStatus = 'all' | 'active' | 'attention' | 'completed';
const taskKey = (task: BrowserTaskState) => JSON.stringify([task.accountId, task.id]);

const unknownModel: Record<Language, string> = { en: 'Model unknown', ru: 'Модель неизвестна', 'zh-CN': '模型未知', 'zh-TW': '模型未知', ja: 'モデル不明', ko: '모델 알 수 없음' };

export function TaskCenter({ tasks, language, disabled, open, cancel, dismiss, onError, historyHealth = [] }: {
  tasks: BrowserTaskState[]; historyHealth?: HistoryHealth; language: Language; disabled: boolean;
  open: (tabId: string) => Promise<unknown>; cancel: (tabId: string, traceId: string) => Promise<unknown>;
  dismiss: (accountId: string, id: string) => Promise<unknown>; onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<HistoryStatus>('all');
  const [account, setAccount] = useState('');
  const actionPending = useRef(false);
  const history = historyCopy[language] ?? historyCopy.en;
  const accounts = new Map(tasks.map(task => [task.accountId, task.accountName]));
  for (const health of historyHealth) accounts.set(health.accountId, health.accountName);
  const search = query.trim().toLocaleLowerCase(language);
  const visible = tasks.filter(task => (!account || task.accountId === account)
    && (status === 'all' || (status === 'active' ? !task.terminal
      : status === 'completed' ? task.terminal && task.phase === 'completed'
      : task.terminal && task.phase !== 'completed'))
    && (!search || [task.traceId, task.accountName, task.model ?? ''].some(value => value.toLocaleLowerCase(language).includes(search))));
  const clearConfirmations = () => { setCancelTarget(null); setDismissTarget(null); };
  const text = terms[language] ?? terms.en;
  const actions = actionCopy[language] ?? actionCopy.en;
  const act = async (id: string, action: () => Promise<unknown>) => {
    if (actionPending.current || disabled) return;
    actionPending.current = true;
    setPending(id);
    try { await action(); } catch (error) { onError(error); } finally { actionPending.current = false; setPending(null); }
  };
  return <section className="task-center" aria-label={text[0]}>
    {historyHealth.map(health => <p className="task-history-warning" role="status" key={health.accountId}>
      <strong>{health.accountName}</strong>: {history[14]}
    </p>)}
    <div className="task-history-filters">
      <label>{history[0]}<input type="search" value={query} onChange={event => { setQuery(event.target.value); clearConfirmations(); }} /></label>
      <label>{history[1]}<select value={status} onChange={event => { setStatus(event.target.value as HistoryStatus); clearConfirmations(); }}>
        {(['all', 'active', 'attention', 'completed'] as const).map((value, index) => <option key={value} value={value}>{history[2 + index]}</option>)}
      </select></label>
      <label>{history[6]}<select value={account} onChange={event => { setAccount(event.target.value); clearConfirmations(); }}>
        <option value="">{history[7]}</option>
        {[...accounts].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
        {account && !accounts.has(account) ? <option value={account}>{account}</option> : null}
      </select></label>
      <button className="text-button" type="button" disabled={!query && status === 'all' && !account}
        onClick={() => { setQuery(''); setStatus('all'); setAccount(''); clearConfirmations(); }}>{history[8]}</button>
    </div>
    <p className="task-history-count" role="status">{history[10]!.replace('{shown}', String(visible.length)).replace('{total}', String(tasks.length))}</p>
    <div className="task-center-list">
      {!tasks.length ? (historyHealth.length ? null : <p>{text[1]}</p>) : !visible.length ? <p>{history[9]}</p> : visible.map(task => <article key={taskKey(task)}>
        <header><strong>{task.accountName}</strong><span>{text[8 + phaseOrder.indexOf(task.phase)] ?? task.phase}</span></header>
        <p><span>{task.model ?? unknownModel[language]}</span> · <code>{task.traceId}</code> · <time dateTime={new Date(task.updatedAt).toISOString()}>
          {new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' }).format(task.updatedAt)}</time></p>
        {task.terminal && task.phase !== 'completed' ? <p role="status">{task.retrySafe ? text[5] : task.phase === 'cancelled' ? text[7] : task.canOpen ? text[6] : actions[2]}</p> : null}
        <div className="task-center-actions">
          {task.canOpen ? <button type="button" className="text-button" disabled={disabled || !!pending}
            onClick={() => void act(taskKey(task), () => open(task.tabId))}>{text[2]}</button> : null}
          {task.canCancel ? <button type="button" className="text-button" disabled={disabled || !!pending}
            onClick={() => { setDismissTarget(null); setCancelTarget(taskKey(task)); }}>{text[4]}</button> : null}
          {task.canDismiss ? <button type="button" className="text-button" disabled={disabled || !!pending}
            onClick={() => {
              if (task.canOpen && task.phase !== 'completed') { setCancelTarget(null); setDismissTarget(taskKey(task)); }
              else void act(taskKey(task), () => dismiss(task.accountId, task.id));
            }}>{text[3]}</button> : null}
        </div>
        {dismissTarget === taskKey(task) && task.canDismiss && task.canOpen && task.phase !== 'completed' ? <div className="task-cancel-confirm" role="alert">
          <p>{history[11]}</p>
          <button className="button-secondary" type="button" disabled={disabled || !!pending}
            onClick={() => void act(taskKey(task), async () => { await dismiss(task.accountId, task.id); setDismissTarget(null); })}>{history[13]}</button>
          <button className="text-button" type="button" disabled={!!pending} onClick={() => setDismissTarget(null)}>{history[12]}</button>
        </div> : null}
        {cancelTarget === taskKey(task) && task.canCancel ? <div className="task-cancel-confirm" role="alert">
          <p>{actions[0]}</p>
          <button className="button-secondary" type="button" disabled={disabled || !!pending}
            onClick={() => void act(taskKey(task), async () => { await cancel(task.tabId, task.traceId); setCancelTarget(null); })}>{text[4]}</button>
          <button className="text-button" type="button" disabled={!!pending} onClick={() => setCancelTarget(null)}>{actions[1]}</button>
        </div> : null}
      </article>)}
    </div>
  </section>;
}
