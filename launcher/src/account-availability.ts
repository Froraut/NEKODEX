import type { Language } from './types';

const copy = {
  en: { models: 'Available models', check: 'Check models', supported: 'Supported', unavailable: 'Unavailable', unknown: 'Not reported', exhausted: 'Limit reached', allowed: 'Available', local: 'New task pacing', ready: 'No local hold', paused: 'Paused', cooldown: 'Cooling down', concurrency: 'Waiting for active tasks', 'session-limit': 'Resume required', interval: 'Waiting for pacing interval', 'scheduled-break': 'Scheduled break', 'new-session-window': 'New session limit', retry: 'Available after' },
  ru: { models: 'Доступные модели', check: 'Проверьте модели', supported: 'Поддерживается', unavailable: 'Недоступно', unknown: 'Нет данных', exhausted: 'Лимит исчерпан', allowed: 'Доступно', local: 'Запуск новых задач', ready: 'Нет локальной задержки', paused: 'Приостановлено', cooldown: 'Период ожидания', concurrency: 'Ожидание активных задач', 'session-limit': 'Нужно возобновить', interval: 'Ожидание интервала', 'scheduled-break': 'Плановый перерыв', 'new-session-window': 'Лимит новых сессий', retry: 'Доступно после' },
  'zh-CN': { models: '可用模型', check: '检查模型', supported: '支持', unavailable: '不可用', unknown: '未报告', exhausted: '已达限额', allowed: '可用', local: '新任务节奏', ready: '无本地等待', paused: '已暂停', cooldown: '冷却中', concurrency: '等待当前任务', 'session-limit': '需要恢复', interval: '等待间隔', 'scheduled-break': '计划休息', 'new-session-window': '新会话限额', retry: '可用时间' },
  'zh-TW': { models: '可用模型', check: '檢查模型', supported: '支援', unavailable: '無法使用', unknown: '未回報', exhausted: '已達限額', allowed: '可用', local: '新任務節奏', ready: '無本機等待', paused: '已暫停', cooldown: '冷卻中', concurrency: '等待目前任務', 'session-limit': '需要恢復', interval: '等待間隔', 'scheduled-break': '排定休息', 'new-session-window': '新工作階段限額', retry: '可用時間' },
  ja: { models: '利用可能なモデル', check: 'モデルを確認', supported: '対応', unavailable: '利用不可', unknown: '報告なし', exhausted: '上限に到達', allowed: '利用可能', local: '新しいタスクの間隔', ready: 'ローカル待機なし', paused: '一時停止中', cooldown: '待機中', concurrency: '実行中のタスクを待機', 'session-limit': '再開が必要', interval: '間隔を待機', 'scheduled-break': '予定された休憩', 'new-session-window': '新規セッションの上限', retry: '利用可能になる時刻' },
  ko: { models: '사용 가능한 모델', check: '모델 확인', supported: '지원됨', unavailable: '사용 불가', unknown: '보고되지 않음', exhausted: '한도 도달', allowed: '사용 가능', local: '새 작업 간격', ready: '로컬 대기 없음', paused: '일시 중지됨', cooldown: '대기 중', concurrency: '진행 중인 작업 대기', 'session-limit': '재개 필요', interval: '간격 대기', 'scheduled-break': '예정된 휴식', 'new-session-window': '새 세션 한도', retry: '사용 가능 시간' },
};
export const accountAvailabilityCopy = (language: Language) => copy[language] ?? copy.en;

export function quotaAvailability(bucket: { allowed: boolean | null; limitReached: boolean | null }) {
  if (bucket.limitReached === true) return 'exhausted' as const;
  if (bucket.allowed === false) return 'unavailable' as const;
  if (bucket.allowed === true) return 'allowed' as const;
  return 'unknown' as const;
}
