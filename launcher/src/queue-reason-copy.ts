import type { Language } from './types';

/** Specific labels for queue holds and failures that previously shared one generic line. */
export interface QueueReasonCopy {
  capacity: string; runtimeTransition: string; localAdmission: string;
  safety: Record<'paused' | 'cooldown' | 'concurrency' | 'session-limit' | 'interval' | 'scheduled-break' | 'new-session-window', string>;
  failures: Record<'retained_conversation_unavailable', string>;
  interruptedLease: string; interruptedRestart: string;
  /** Joins a neutral hold to the readiness cause whose deadline keeps running behind it. */
  thenCause: string;
}

const en: QueueReasonCopy = {
  capacity: 'Waiting for a free browser slot',
  runtimeTransition: 'Waiting for the NEKODEX runtime to finish restarting',
  localAdmission: 'Waiting for a free slot or the account’s cooldown',
  safety: {
    paused: 'Stopped by account safety — review it in Accounts and resume',
    cooldown: 'Account is cooling down',
    concurrency: 'Account pacing: waiting for its active tasks',
    'session-limit': 'Account session time limit reached — review it in Accounts and resume',
    interval: 'Account pacing interval has not elapsed',
    'scheduled-break': 'Scheduled account break',
    'new-session-window': 'New Web session limit reached; waiting for the window',
  },
  failures: { retained_conversation_unavailable: 'The retained ChatGPT conversation is no longer available — start a new task' },
  interruptedLease: 'Interrupted when its browser lease ended — inspect the original task',
  interruptedRestart: 'Interrupted by a NEKODEX restart — inspect the original task',
  thenCause: 'then: {cause}',
};

const copy: Record<Language, QueueReasonCopy> = {
  en,
  ru: {
    capacity: 'Ожидание свободного места в браузере',
    runtimeTransition: 'Ожидание завершения перезапуска среды NEKODEX',
    localAdmission: 'Ожидание свободного места или окончания паузы аккаунта',
    safety: {
      paused: 'Остановлено защитой аккаунта — проверьте его в разделе «Аккаунты» и возобновите',
      cooldown: 'Аккаунт на паузе после ограничения',
      concurrency: 'Темп аккаунта: ожидание его активных задач',
      'session-limit': 'Достигнут лимит длительности сеанса — проверьте аккаунт в разделе «Аккаунты» и возобновите',
      interval: 'Интервал между запусками аккаунта ещё не прошёл',
      'scheduled-break': 'Плановый перерыв аккаунта',
      'new-session-window': 'Достигнут лимит новых Web-сеансов; ожидание окна',
    },
    failures: { retained_conversation_unavailable: 'Сохранённая беседа ChatGPT больше недоступна — запустите новую задачу' },
    interruptedLease: 'Прервано: закончилась аренда браузера — проверьте исходную задачу',
    interruptedRestart: 'Прервано перезапуском NEKODEX — проверьте исходную задачу',
    thenCause: 'затем: {cause}',
  },
  'zh-CN': {
    capacity: '等待空闲的浏览器位置',
    runtimeTransition: '等待 NEKODEX 运行时完成重启',
    localAdmission: '等待空闲位置或账户冷却结束',
    safety: {
      paused: '已被账户安全机制停止——请在“账户”中检查后恢复',
      cooldown: '账户正在冷却',
      concurrency: '账户节奏：等待其进行中的任务',
      'session-limit': '已达到账户会话时长上限——请在“账户”中检查后恢复',
      interval: '账户启动间隔尚未结束',
      'scheduled-break': '账户计划休息中',
      'new-session-window': '已达到新 Web 会话上限；等待时间窗口',
    },
    failures: { retained_conversation_unavailable: '保留的 ChatGPT 对话已不可用——请开始新任务' },
    interruptedLease: '浏览器租用结束导致中断——请检查原任务',
    interruptedRestart: 'NEKODEX 重启导致中断——请检查原任务',
    thenCause: '随后：{cause}',
  },
  'zh-TW': {
    capacity: '等待空閒的瀏覽器位置',
    runtimeTransition: '等待 NEKODEX 執行環境完成重新啟動',
    localAdmission: '等待空閒位置或帳戶冷卻結束',
    safety: {
      paused: '已被帳戶安全機制停止——請在「帳戶」中檢查後恢復',
      cooldown: '帳戶正在冷卻',
      concurrency: '帳戶節奏：等待其進行中的任務',
      'session-limit': '已達到帳戶工作階段時長上限——請在「帳戶」中檢查後恢復',
      interval: '帳戶啟動間隔尚未結束',
      'scheduled-break': '帳戶排定休息中',
      'new-session-window': '已達到新 Web 工作階段上限；等待時間視窗',
    },
    failures: { retained_conversation_unavailable: '保留的 ChatGPT 對話已無法使用——請開始新任務' },
    interruptedLease: '瀏覽器租用結束導致中斷——請檢查原任務',
    interruptedRestart: 'NEKODEX 重新啟動導致中斷——請檢查原任務',
    thenCause: '接著：{cause}',
  },
  ja: {
    capacity: 'ブラウザーの空き枠を待機中',
    runtimeTransition: 'NEKODEX ランタイムの再起動完了を待機中',
    localAdmission: '空き枠またはアカウントのクールダウン終了を待機中',
    safety: {
      paused: 'アカウント保護により停止中 — 「アカウント」で確認して再開してください',
      cooldown: 'アカウントのクールダウン中',
      concurrency: 'アカウントのペース制御：実行中のタスクを待機中',
      'session-limit': 'セッション時間の上限に達しました — 「アカウント」で確認して再開してください',
      interval: 'アカウントの開始間隔がまだ経過していません',
      'scheduled-break': 'アカウントの予定休憩中',
      'new-session-window': '新しい Web セッションの上限に達しました。時間枠を待機中',
    },
    failures: { retained_conversation_unavailable: '保持していた ChatGPT の会話は利用できなくなりました — 新しいタスクを開始してください' },
    interruptedLease: 'ブラウザーの利用期間が終了したため中断 — 元のタスクを確認してください',
    interruptedRestart: 'NEKODEX の再起動により中断 — 元のタスクを確認してください',
    thenCause: '次に：{cause}',
  },
  ko: {
    capacity: '빈 브라우저 슬롯 대기 중',
    runtimeTransition: 'NEKODEX 런타임 재시작 완료 대기 중',
    localAdmission: '빈 슬롯 또는 계정 쿨다운 종료 대기 중',
    safety: {
      paused: '계정 보호로 중지됨 — 계정에서 확인한 뒤 재개하세요',
      cooldown: '계정 쿨다운 중',
      concurrency: '계정 속도 제한: 진행 중인 작업 대기 중',
      'session-limit': '계정 세션 시간 한도 도달 — 계정에서 확인한 뒤 재개하세요',
      interval: '계정 시작 간격이 아직 지나지 않음',
      'scheduled-break': '계정 예정된 휴식 중',
      'new-session-window': '새 Web 세션 한도 도달; 시간 창 대기 중',
    },
    failures: { retained_conversation_unavailable: '보관된 ChatGPT 대화를 더 이상 사용할 수 없습니다 — 새 작업을 시작하세요' },
    interruptedLease: '브라우저 임대가 끝나 중단됨 — 원래 작업 확인',
    interruptedRestart: 'NEKODEX 재시작으로 중단됨 — 원래 작업 확인',
    thenCause: '이후: {cause}',
  },
};

export const queueReasonCopy = (language: Language): QueueReasonCopy => copy[language] ?? en;
