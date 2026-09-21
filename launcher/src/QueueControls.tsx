import { useState } from 'react';
import type { BrowserQueueState, Language } from './types';

const copy = {
  en: ['Waiting tasks', 'Pause new tasks', 'Resume new tasks', 'Current tasks continue running.', 'Not sent', 'Cancel waiting task', 'Move to front', 'Resume this task', 'Dismiss', 'Awaiting original Codex task connection', 'Submission outcome needs review', 'Queue storage unavailable', 'All accounts', 'No tasks waiting', 'Waiting for capacity or account readiness', 'Acquiring browser', 'Paused', 'Cancelled before sending', 'Admission failed', 'Interrupted — inspect original task'],
  ru: ['Очередь задач', 'Приостановить новые задачи', 'Возобновить новые задачи', 'Текущие задачи продолжают работу.', 'Не отправлено', 'Отменить ожидающую задачу', 'Переместить в начало', 'Возобновить эту задачу', 'Убрать запись', 'Ожидание подключения исходной задачи Codex', 'Результат предыдущей отправки требует проверки', 'Хранилище очереди недоступно', 'Все аккаунты', 'Ожидающих задач нет', 'Ожидание свободного места или готовности аккаунта', 'Подготовка браузера', 'Приостановлено', 'Отменено до отправки', 'Не удалось запустить', 'Прервано — проверьте исходную задачу'],
  'zh-CN': ['等待中的任务', '暂停新任务', '恢复新任务', '当前任务将继续运行。', '尚未发送', '取消等待任务', '移到队首', '恢复此任务', '移除记录', '等待原 Codex 任务连接', '需要检查上次发送结果', '队列存储不可用', '所有账户', '没有等待任务', '等待容量或账户就绪', '准备浏览器', '已暂停', '发送前已取消', '启动失败', '已中断，请检查原任务'],
  'zh-TW': ['等待中的任務', '暫停新任務', '恢復新任務', '目前任務將繼續執行。', '尚未傳送', '取消等待任務', '移到佇列開頭', '恢復此任務', '移除記錄', '等待原 Codex 任務連線', '需要檢查上次傳送結果', '佇列儲存空間無法使用', '所有帳戶', '沒有等待任務', '等待容量或帳戶就緒', '準備瀏覽器', '已暫停', '傳送前已取消', '啟動失敗', '已中斷，請檢查原任務'],
  ja: ['待機中のタスク', '新しいタスクを一時停止', '新しいタスクを再開', '現在のタスクは実行を続けます。', '未送信', '待機タスクをキャンセル', '先頭へ移動', 'このタスクを再開', '記録を閉じる', '元の Codex タスクの接続待ち', '前回の送信結果を確認してください', 'キュー保存先を利用できません', 'すべてのアカウント', '待機タスクなし', '空き枠またはアカウント準備待ち', 'ブラウザー準備中', '一時停止中', '送信前にキャンセル済み', '開始失敗', '中断・元のタスクを確認'],
  ko: ['대기 중인 작업', '새 작업 일시 중지', '새 작업 재개', '현재 작업은 계속 실행됩니다.', '전송되지 않음', '대기 작업 취소', '맨 앞으로 이동', '이 작업 재개', '기록 닫기', '원래 Codex 작업 연결 대기', '이전 전송 결과 확인 필요', '대기열 저장소 사용 불가', '모든 계정', '대기 작업 없음', '빈 슬롯 또는 계정 준비 대기', '브라우저 준비 중', '일시 중지됨', '전송 전 취소됨', '시작 실패', '중단됨 — 원래 작업 확인'],
};

export function QueueControls({ queue, language, disabled, action, pause, onError }: {
  queue?: BrowserQueueState; language: Language; disabled: boolean;
  action: (id: string, action: 'cancel' | 'resume' | 'prioritize' | 'dismiss') => Promise<unknown>;
  pause: (accountId: string | null, paused: boolean) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState(false);
  const [account, setAccount] = useState('all');
  const text = copy[language] ?? copy.en;
  const cancellingText = { en: 'Cancelling before sending', ru: 'Отмена до отправки', 'zh-CN': '正在取消，尚未发送', 'zh-TW': '正在取消，尚未傳送', ja: '送信前にキャンセル中', ko: '전송 전 취소 중' }[language];
  if (!queue) return null;
  const paused = account === 'all' ? queue.paused : queue.pausedAccounts.includes(account);
  const act = async (operation: () => Promise<unknown>) => {
    if (disabled || pending) return;
    setPending(true); try { await operation(); } catch (error) { onError(error); } finally { setPending(false); }
  };
  const labels = new Map(queue.accounts.map(row => [row.id, row.label]));
  const entries = [...queue.entries].sort((a, b) => Number(a.canDismiss) - Number(b.canDismiss)
    || (a.position || 0) - (b.position || 0) || a.createdAt - b.createdAt);
  return <section className="task-queue" aria-label={text[0]}>
    <h2>{text[0]}</h2>
    <div className="task-center-actions">
      <select aria-label={text[12]} value={account} disabled={disabled || pending} onChange={event => setAccount(event.target.value)}>
        <option value="all">{text[12]}</option>
        {queue.accounts.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
      </select>
      <button type="button" className="button-secondary" disabled={disabled || pending || !!queue.storageIssue}
        onClick={() => void act(() => pause(account === 'all' ? null : account, !paused))}>{paused ? text[2] : text[1]}</button>
    </div>
    <p>{text[3]}</p>
    {queue.storageIssue ? <p role="alert">{text[11]}</p> : null}
    {!queue.entries.length ? <p>{text[13]}</p> : null}
    {entries.map(row => {
      const reason = row.status === 'cancelling' ? cancellingText : row.reason === 'owner-reconnect-required' ? text[9]
        : row.reason === 'previous-submission-needs-review' ? text[10]
          : row.status === 'cancelled' ? text[17] : row.status === 'failed' ? text[18] : row.status === 'interrupted' ? text[19]
            : row.status === 'admitting' ? text[15] : row.status === 'paused' || row.reason?.startsWith('paused') ? text[16] : text[14];
      return <article key={row.id}>
        <header><strong>{row.position > 0 ? `${row.position}. ` : ''}{row.accountId ? labels.get(row.accountId) : text[12]}</strong><span role="status">{reason}</span></header>
        <p><code>{row.traceId}</code>{['waiting', 'paused', 'admitting', 'cancelling', 'cancelled', 'failed'].includes(row.status) ? ` · ${text[4]}` : ''}</p>
        {row.retryAt ? <p><time dateTime={new Date(row.retryAt).toISOString()}>{new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' }).format(row.retryAt)}</time></p> : null}
        <div className="task-center-actions">
          {row.canCancel ? <button className="text-button" type="button" disabled={disabled || pending} onClick={() => void act(() => action(row.id, 'cancel'))}>{text[5]}</button> : null}
          {row.canPrioritize ? <button className="text-button" type="button" disabled={disabled || pending} onClick={() => void act(() => action(row.id, 'prioritize'))}>{text[6]}</button> : null}
          {row.canResume ? <button className="text-button" type="button" disabled={disabled || pending} onClick={() => void act(() => action(row.id, 'resume'))}>{text[7]}</button> : null}
          {row.canDismiss ? <button className="text-button" type="button" disabled={disabled || pending} onClick={() => void act(() => action(row.id, 'dismiss'))}>{text[8]}</button> : null}
        </div>
      </article>;
    })}
  </section>;
}
