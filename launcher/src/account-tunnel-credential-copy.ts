import type { Language } from './types';

type CredentialCopy = {
  title: string; legacy: string; protected: string; unavailable: string; unknown: string;
  hint: string; migrate: string; migrating: string; migrated: string; failed: string;
  finishMigration: string;
  savedReady: string; savedNotReady: string; cleanupPending: string; recovery: string;
  storageChoice: string; protectedOption: string; legacyOption: string; storageChoiceHint: string; legacyWarning: string;
};
const en: CredentialCopy = {
  finishMigration: 'Finish migration',
  storageChoice: 'Save the runtime key in', protectedOption: 'Protected storage (macOS)', legacyOption: 'Private file (unencrypted)',
  storageChoiceHint: 'Protected storage currently requires macOS. On other systems, explicitly choose private file storage to continue. NEKODEX never switches to file storage automatically.',
  legacyWarning: 'The runtime key is stored as an unencrypted private file on this computer.',
  title: 'Credential storage', legacy: 'Legacy key file', protected: 'OS protected storage',
  unavailable: 'No saved credential', unknown: 'Storage status unavailable',
  hint: 'Storage status describes saved credentials. It does not confirm that protected storage is unlocked or that the tunnel is ready.',
  migrate: 'Migrate', migrating: 'Migrating…', migrated: 'Migrated',
  failed: 'Credential migration could not be confirmed. Refresh the account status before retrying.',
  savedReady: 'The credential was saved in protected storage and this tunnel is ready. This does not confirm a ChatGPT connector or tool execution.',
  savedNotReady: 'The credential was saved in protected storage, but this tunnel is not ready. The saved credential is retained; use this account’s tunnel setup to recover.',
  cleanupPending: 'Migration cleanup is pending. The legacy key file has been retained for recovery.',
  recovery: 'Recovery is required. Keep the saved credential and use this account’s tunnel setup before retrying migration.',
};
const ru: CredentialCopy = {
  finishMigration: 'Завершить перенос',
  storageChoice: 'Где сохранить ключ среды', protectedOption: 'Защищённое хранилище (macOS)', legacyOption: 'Приватный файл (без шифрования)',
  storageChoiceHint: 'Защищённое хранилище сейчас доступно на macOS. В других системах явно выберите приватный файл. NEKODEX не переключается на хранение в файле автоматически.',
  legacyWarning: 'Ключ среды хранится на этом компьютере в приватном файле без шифрования.',
  title: 'Хранение ключа', legacy: 'Прежний файл ключа', protected: 'Защищённое хранилище ОС',
  unavailable: 'Нет сохранённого ключа', unknown: 'Состояние хранилища недоступно',
  hint: 'Статус описывает сохранённый ключ. Он не подтверждает, что защищённое хранилище разблокировано или туннель готов.',
  migrate: 'Перенести', migrating: 'Перенос…', migrated: 'Перенесено',
  failed: 'Не удалось подтвердить перенос ключа. Обновите статус аккаунта перед повторной попыткой.',
  savedReady: 'Ключ сохранён в защищённом хранилище, туннель готов. Это не подтверждает коннектор ChatGPT или выполнение инструмента.',
  savedNotReady: 'Ключ сохранён в защищённом хранилище, но туннель ещё не готов. Ключ сохранён; восстановите подключение через настройку туннеля этого аккаунта.',
  cleanupPending: 'Очистка после переноса ещё не завершена. Прежний файл ключа сохранён для восстановления.',
  recovery: 'Требуется восстановление. Сохраните ключ и откройте настройку туннеля этого аккаунта перед повторным переносом.',
};
const zhCN: CredentialCopy = {
  finishMigration: '完成迁移',
  storageChoice: '运行时密钥保存位置', protectedOption: '保护存储（macOS）', legacyOption: '私有文件（未加密）',
  storageChoiceHint: '保护存储目前需要 macOS。在其他系统上，请明确选择私有文件存储以继续。NEKODEX 不会自动切换到文件存储。',
  legacyWarning: '运行时密钥以未加密的私有文件形式保存在此计算机上。',
  title: '凭据存储', legacy: '旧版密钥文件', protected: '操作系统保护存储',
  unavailable: '无已保存的凭据', unknown: '存储状态不可用',
  hint: '存储状态描述已保存的凭据，并不确认保护存储已解锁或隧道已就绪。',
  migrate: '迁移', migrating: '正在迁移…', migrated: '已迁移',
  failed: '无法确认凭据迁移。重试前请刷新账户状态。',
  savedReady: '凭据已保存到保护存储，且此隧道已就绪。这并不确认 ChatGPT 连接器或工具执行。',
  savedNotReady: '凭据已保存到保护存储，但此隧道尚未就绪。已保存的凭据会保留；请通过此账户的隧道设置恢复连接。',
  cleanupPending: '迁移清理尚未完成。旧版密钥文件已保留以便恢复。',
  recovery: '需要恢复。请保留已保存的凭据，并在重试迁移前使用此账户的隧道设置。',
};
const zhTW: CredentialCopy = {
  finishMigration: '完成移轉',
  storageChoice: '執行階段金鑰儲存位置', protectedOption: '保護儲存（macOS）', legacyOption: '私有檔案（未加密）',
  storageChoiceHint: '保護儲存目前需要 macOS。在其他系統上，請明確選擇私有檔案儲存以繼續。NEKODEX 不會自動切換到檔案儲存。',
  legacyWarning: '執行階段金鑰以未加密的私有檔案形式儲存在此電腦上。',
  title: '憑證儲存', legacy: '舊版金鑰檔案', protected: '作業系統保護儲存',
  unavailable: '無已儲存的憑證', unknown: '儲存狀態無法取得',
  hint: '儲存狀態描述已儲存的憑證，並不確認保護儲存已解鎖或通道已就緒。',
  migrate: '移轉', migrating: '正在移轉…', migrated: '已移轉',
  failed: '無法確認憑證移轉。重試前請重新整理帳號狀態。',
  savedReady: '憑證已儲存到保護儲存，且此通道已就緒。這並不確認 ChatGPT 連接器或工具執行。',
  savedNotReady: '憑證已儲存到保護儲存，但此通道尚未就緒。已儲存的憑證會保留；請透過此帳號的通道設定恢復連線。',
  cleanupPending: '移轉清理尚未完成。舊版金鑰檔案已保留以便復原。',
  recovery: '需要復原。請保留已儲存的憑證，並在重試移轉前使用此帳號的通道設定。',
};
const ja: CredentialCopy = {
  finishMigration: '移行を完了',
  storageChoice: '実行用キーの保存先', protectedOption: '保護ストレージ（macOS）', legacyOption: '非公開ファイル（暗号化なし）',
  storageChoiceHint: '保護ストレージは現在 macOS が必要です。他のシステムでは、非公開ファイルへの保存を明示的に選択してください。自動でファイル保存に切り替わることはありません。',
  legacyWarning: '実行用キーはこのコンピューター上の暗号化されていない非公開ファイルに保存されます。',
  title: '認証情報の保存先', legacy: '従来のキーファイル', protected: 'OS の保護ストレージ',
  unavailable: '保存された認証情報なし', unknown: '保存状態を確認できません',
  hint: '保存状態は保存済み認証情報についての表示です。保護ストレージのロック解除やトンネルの準備完了を確認するものではありません。',
  migrate: '移行', migrating: '移行中…', migrated: '移行済み',
  failed: '認証情報の移行を確認できませんでした。再試行の前にアカウントの状態を更新してください。',
  savedReady: '認証情報を保護ストレージに保存し、このトンネルの準備が完了しました。ChatGPT コネクターやツール実行の確認ではありません。',
  savedNotReady: '認証情報を保護ストレージに保存しましたが、トンネルはまだ準備できていません。認証情報は保持されます。このアカウントのトンネル設定から復旧してください。',
  cleanupPending: '移行後のクリーンアップは未完了です。復旧のため従来のキーファイルを保持しています。',
  recovery: '復旧が必要です。保存済み認証情報を保持し、再度移行する前にこのアカウントのトンネル設定を開いてください。',
};
const ko: CredentialCopy = {
  finishMigration: '이전 완료',
  storageChoice: '런타임 키 저장 위치', protectedOption: '보호 저장소(macOS)', legacyOption: '비공개 파일(암호화되지 않음)',
  storageChoiceHint: '보호 저장소는 현재 macOS가 필요합니다. 다른 시스템에서는 계속하려면 비공개 파일 저장을 명시적으로 선택하세요. NEKODEX는 파일 저장으로 자동 전환하지 않습니다.',
  legacyWarning: '런타임 키는 이 컴퓨터에 암호화되지 않은 비공개 파일로 저장됩니다.',
  title: '인증 정보 저장소', legacy: '기존 키 파일', protected: 'OS 보호 저장소',
  unavailable: '저장된 인증 정보 없음', unknown: '저장 상태를 확인할 수 없음',
  hint: '저장 상태는 저장된 인증 정보에 대한 표시입니다. 보호 저장소의 잠금 해제나 터널 준비 완료를 확인하지는 않습니다.',
  migrate: '이전', migrating: '이전 중…', migrated: '이전됨',
  failed: '인증 정보 이전을 확인하지 못했습니다. 다시 시도하기 전에 계정 상태를 새로 고치세요.',
  savedReady: '인증 정보가 보호 저장소에 저장되었으며 이 터널이 준비되었습니다. ChatGPT 커넥터나 도구 실행을 확인한 것은 아닙니다.',
  savedNotReady: '인증 정보가 보호 저장소에 저장되었지만 터널은 아직 준비되지 않았습니다. 저장된 인증 정보는 유지됩니다. 이 계정의 터널 설정에서 복구하세요.',
  cleanupPending: '이전 후 정리가 아직 끝나지 않았습니다. 복구를 위해 기존 키 파일이 보존되어 있습니다.',
  recovery: '복구가 필요합니다. 저장된 인증 정보를 유지하고 이전을 다시 시도하기 전에 이 계정의 터널 설정을 사용하세요.',
};
export function accountTunnelCredentialCopy(language: Language): CredentialCopy {
  return ({ en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko })[language] ?? en;
}
