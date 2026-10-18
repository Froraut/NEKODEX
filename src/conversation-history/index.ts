export { ConversationHistoryStore, historyMessageLink } from "./store";
export type {
  CaptureRecord, HistoryMarkdownExport, HistoryMessage, HistoryPage, HistoryPageOptions,
  HistorySearch, HistoryStatus, HistoryThread, MessageIdentity, RecordResult, ThreadIdentity,
} from "./types";

export { captureValidatedNativeResponse } from "./capture";
export type { ValidatedHistoryTurn, ValidatedUserText } from "./capture";

export type { CanonicalCaptureLease } from './canonical';
export type { OwnedNativeHistoryPort, OwnedNativeCaptureLease, OwnedNativeHistoryStatus, OwnedNativeHistoryScope } from './owned-native';
