import type { Language } from "./types";

// Readable, localised titles for launcher log events (Overview "Recent events" and Activity). Each known event id
// maps to one sentence-case title per language, in the order en, ru, zh-CN, zh-TW, ja, ko. An id that is not listed
// (a new or dynamic event) reads as its localised area and the id's own words.

type Titles = readonly [en: string, ru: string, zhCN: string, zhTW: string, ja: string, ko: string];

const ORDER: Record<Language, number> = { en: 0, ru: 1, "zh-CN": 2, "zh-TW": 3, ja: 4, ko: 5 };

const TITLES: Record<string, Titles> = {
  // Codex route (bridge)
  "bridge.route_restore_after_runtime_failure_failed": ["Couldn't restore the Codex route after a runtime failure", "Не удалось восстановить маршрут Codex после сбоя среды выполнения", "运行时故障后无法恢复 Codex 路由", "執行階段故障後無法還原 Codex 路由", "ランタイム障害後に Codex ルートを復元できませんでした", "런타임 오류 후 Codex 경로를 복원할 수 없음"],
  "bridge.route_restored_after_runtime_failure": ["Codex route restored after a runtime failure", "Маршрут Codex восстановлен после сбоя среды выполнения", "运行时故障后已恢复 Codex 路由", "執行階段故障後已還原 Codex 路由", "ランタイム障害後に Codex ルートを復元しました", "런타임 오류 후 Codex 경로 복원됨"],

  // Browser: accounts and sign-in
  "browser.account_add_rollback_failed": ["Couldn't undo a failed account add", "Не удалось отменить неудачное добавление аккаунта", "无法撤销失败的账户添加", "無法復原失敗的帳戶新增", "失敗したアカウント追加を取り消せませんでした", "실패한 계정 추가를 취소할 수 없음"],
  "browser.account_affinity_write_failed": ["Couldn't save the account assignment", "Не удалось сохранить привязку аккаунта", "无法保存账户分配", "無法儲存帳戶指派", "アカウントの割り当てを保存できませんでした", "계정 할당을 저장할 수 없음"],
  "browser.account_descriptor_refresh_failed": ["Couldn't refresh account details", "Не удалось обновить сведения об аккаунте", "无法刷新账户详情", "無法重新整理帳戶詳細資料", "アカウント情報を更新できませんでした", "계정 정보를 새로 고칠 수 없음"],
  "browser.account_new_session_rollback_failed": ["Couldn't undo a new account session", "Не удалось отменить новый сеанс аккаунта", "无法撤销新的账户会话", "無法復原新的帳戶工作階段", "新しいアカウントセッションを取り消せませんでした", "새 계정 세션을 취소할 수 없음"],
  "browser.account_refresh_deferred": ["Account refresh postponed", "Обновление аккаунта отложено", "账户刷新已推迟", "帳戶重新整理已延後", "アカウントの更新を延期しました", "계정 새로 고침 연기됨"],
  "browser.account_refresh_failed": ["Account refresh failed", "Не удалось обновить аккаунт", "账户刷新失败", "帳戶重新整理失敗", "アカウントを更新できませんでした", "계정 새로 고침 실패"],
  "browser.account_safety_failure_record_failed": ["Couldn't record an account safety event", "Не удалось записать событие безопасности аккаунта", "无法记录账户安全事件", "無法記錄帳戶安全事件", "アカウントの安全イベントを記録できませんでした", "계정 안전 이벤트를 기록할 수 없음"],
  "browser.auth_navigation_completed": ["Sign-in page loaded", "Страница входа загружена", "登录页面已加载", "登入頁面已載入", "ログインページを読み込みました", "로그인 페이지 로드됨"],
  "browser.auth_navigation_failed": ["Sign-in page failed to load", "Не удалось загрузить страницу входа", "登录页面加载失败", "登入頁面載入失敗", "ログインページを読み込めませんでした", "로그인 페이지를 불러오지 못함"],
  "browser.auth_navigation_started": ["Opening the sign-in page", "Открывается страница входа", "正在打开登录页面", "正在開啟登入頁面", "ログインページを開いています", "로그인 페이지 여는 중"],
  "browser.auth_navigation_timeout": ["Sign-in page timed out", "Время загрузки страницы входа истекло", "登录页面加载超时", "登入頁面載入逾時", "ログインページがタイムアウトしました", "로그인 페이지 시간 초과"],
  "browser.auth_refresh_failed": ["Sign-in check failed", "Не удалось проверить вход", "登录检查失败", "登入檢查失敗", "ログインを確認できませんでした", "로그인 확인 실패"],
  "browser.auth_renderer_gone": ["Sign-in page crashed", "Страница входа аварийно закрылась", "登录页面已崩溃", "登入頁面已當機", "ログインページがクラッシュしました", "로그인 페이지 충돌"],
  "browser.auth_surface_closed": ["Sign-in window closed", "Окно входа закрыто", "登录窗口已关闭", "登入視窗已關閉", "ログインウィンドウを閉じました", "로그인 창 닫힘"],
  "browser.auth_surface_opened": ["Sign-in window opened", "Окно входа открыто", "登录窗口已打开", "登入視窗已開啟", "ログインウィンドウを開きました", "로그인 창 열림"],
  "browser.auth_window_open_failed": ["Couldn't open the sign-in window", "Не удалось открыть окно входа", "无法打开登录窗口", "無法開啟登入視窗", "ログインウィンドウを開けませんでした", "로그인 창을 열 수 없음"],
  "browser.authenticated": ["Signed in to ChatGPT", "Вход в ChatGPT выполнен", "已登录 ChatGPT", "已登入 ChatGPT", "ChatGPT にログインしました", "ChatGPT에 로그인됨"],
  "browser.login_opened": ["Sign-in opened", "Вход открыт", "已打开登录", "已開啟登入", "ログインを開きました", "로그인 열림"],
  "browser.logout_completed": ["Signed out of ChatGPT", "Выполнен выход из ChatGPT", "已退出 ChatGPT", "已登出 ChatGPT", "ChatGPT からログアウトしました", "ChatGPT에서 로그아웃됨"],
  "browser.passkey_login_imported": ["Passkey sign-in imported", "Вход по ключу доступа импортирован", "已导入通行密钥登录", "已匯入通行金鑰登入", "パスキーのログインを取り込みました", "패스키 로그인 가져옴"],
  "browser.passkey_login_started": ["Passkey sign-in started", "Начат вход по ключу доступа", "已开始通行密钥登录", "已開始通行金鑰登入", "パスキーでのログインを開始しました", "패스키 로그인 시작됨"],
  "browser.session_import_verification_failed": ["Couldn't verify the imported sign-in", "Не удалось проверить импортированный вход", "无法验证导入的登录", "無法驗證匯入的登入", "取り込んだログインを確認できませんでした", "가져온 로그인을 확인할 수 없음"],
  "browser.session_refresh_failed": ["Session refresh failed", "Не удалось обновить сеанс", "会话刷新失败", "工作階段重新整理失敗", "セッションを更新できませんでした", "세션 새로 고침 실패"],

  // Browser: Cloudflare and network
  "browser.cloudflare_challenge_detected": ["Cloudflare check detected", "Обнаружена проверка Cloudflare", "检测到 Cloudflare 验证", "偵測到 Cloudflare 驗證", "Cloudflare の確認を検出しました", "Cloudflare 확인 감지됨"],
  "browser.cloudflare_challenge_not_reloaded": ["Cloudflare check left open", "Проверка Cloudflare оставлена открытой", "Cloudflare 验证保持打开", "Cloudflare 驗證保持開啟", "Cloudflare の確認はそのままにしました", "Cloudflare 확인을 그대로 둠"],
  "browser.cloudflare_challenge_persisted": ["Cloudflare check still showing", "Проверка Cloudflare всё ещё показана", "Cloudflare 验证仍在显示", "Cloudflare 驗證仍在顯示", "Cloudflare の確認がまだ表示されています", "Cloudflare 확인이 계속 표시됨"],
  "browser.cloudflare_challenge_recovered": ["Cloudflare check passed", "Проверка Cloudflare пройдена", "已通过 Cloudflare 验证", "已通過 Cloudflare 驗證", "Cloudflare の確認を通過しました", "Cloudflare 확인 통과"],
  "browser.cloudflare_challenge_recovery_failed": ["Couldn't get past the Cloudflare check", "Не удалось пройти проверку Cloudflare", "无法通过 Cloudflare 验证", "無法通過 Cloudflare 驗證", "Cloudflare の確認を通過できませんでした", "Cloudflare 확인을 통과할 수 없음"],
  "browser.network_egress_check_failed": ["Network check failed", "Не удалось проверить сеть", "网络检查失败", "網路檢查失敗", "ネットワークを確認できませんでした", "네트워크 확인 실패"],
  "browser.network_egress_checked": ["Network checked", "Сеть проверена", "已检查网络", "已檢查網路", "ネットワークを確認しました", "네트워크 확인됨"],
  "browser.navigation_timeout": ["Page load timed out", "Время загрузки страницы истекло", "页面加载超时", "頁面載入逾時", "ページの読み込みがタイムアウトしました", "페이지 로드 시간 초과"],

  // Browser: control and windows
  "browser.connector_helper": ["Connector helper message", "Сообщение помощника коннектора", "连接器助手消息", "連接器助手訊息", "コネクタヘルパーのメッセージ", "커넥터 도우미 메시지"],
  "browser.control_rejected": ["Browser control request rejected", "Запрос управления браузером отклонён", "浏览器控制请求被拒绝", "瀏覽器控制要求遭拒", "ブラウザー操作の要求を拒否しました", "브라우저 제어 요청 거부됨"],
  "browser.control_request_failed": ["Browser control request failed", "Не удалось выполнить запрос управления браузером", "浏览器控制请求失败", "瀏覽器控制要求失敗", "ブラウザー操作の要求に失敗しました", "브라우저 제어 요청 실패"],
  "browser.control_server_error": ["Browser control server error", "Ошибка сервера управления браузером", "浏览器控制服务器出错", "瀏覽器控制伺服器錯誤", "ブラウザー操作サーバーのエラー", "브라우저 제어 서버 오류"],
  "browser.control_started": ["Browser control started", "Управление браузером запущено", "浏览器控制已启动", "瀏覽器控制已啟動", "ブラウザー操作を開始しました", "브라우저 제어 시작됨"],
  "browser.idle_cleanup_failed": ["Couldn't clean up idle tabs", "Не удалось очистить неактивные вкладки", "无法清理空闲标签页", "無法清理閒置分頁", "待機中のタブを片付けられませんでした", "유휴 탭을 정리할 수 없음"],
  "browser.initialization_failed": ["Browser failed to start", "Не удалось запустить браузер", "浏览器启动失败", "瀏覽器啟動失敗", "ブラウザーを起動できませんでした", "브라우저를 시작하지 못함"],
  "browser.initialized": ["Browser ready", "Браузер готов", "浏览器已就绪", "瀏覽器已就緒", "ブラウザーの準備ができました", "브라우저 준비됨"],
  "browser.renderer_gone": ["Browser page crashed", "Страница браузера аварийно закрылась", "浏览器页面已崩溃", "瀏覽器頁面已當機", "ブラウザーのページがクラッシュしました", "브라우저 페이지 충돌"],
  "browser.sleep_block_released": ["Sleep allowed again", "Спящий режим снова разрешён", "已重新允许睡眠", "已重新允許睡眠", "スリープを再び許可しました", "절전 다시 허용됨"],
  "browser.sleep_blocked_for_turns": ["Sleep paused while turns run", "Спящий режим отключён на время запросов", "任务运行期间暂停睡眠", "任務執行期間暫停睡眠", "ターンの実行中はスリープを止めました", "턴 실행 중 절전 일시 중지"],
  "browser.snapshot_publish_failed": ["Couldn't update the browser status", "Не удалось обновить состояние браузера", "无法更新浏览器状态", "無法更新瀏覽器狀態", "ブラウザーの状態を更新できませんでした", "브라우저 상태를 업데이트할 수 없음"],
  "browser.surface_mark_failed": ["Couldn't mark the browser view", "Не удалось отметить область браузера", "无法标记浏览器视图", "無法標記瀏覽器檢視", "ブラウザービューをマークできませんでした", "브라우저 보기를 표시할 수 없음"],
  "browser.workspace_manifest_write_failed": ["Couldn't save the browser windows list", "Не удалось сохранить список окон браузера", "无法保存浏览器窗口列表", "無法儲存瀏覽器視窗清單", "ブラウザーウィンドウの一覧を保存できませんでした", "브라우저 창 목록을 저장할 수 없음"],
  "browser.workspace_session_mutation_blocked": ["Browser window change blocked", "Изменение окна браузера заблокировано", "浏览器窗口更改已被阻止", "瀏覽器視窗變更已遭封鎖", "ブラウザーウィンドウの変更をブロックしました", "브라우저 창 변경 차단됨"],
  "browser.workspace_session_verification_failed": ["Couldn't verify a browser window session", "Не удалось проверить сеанс окна браузера", "无法验证浏览器窗口会话", "無法驗證瀏覽器視窗工作階段", "ブラウザーウィンドウのセッションを確認できませんでした", "브라우저 창 세션을 확인할 수 없음"],

  // Browser: tabs
  "browser.tab_activation_rollback_failed": ["Couldn't undo a tab switch", "Не удалось отменить переключение вкладки", "无法撤销标签页切换", "無法復原分頁切換", "タブの切り替えを取り消せませんでした", "탭 전환을 취소할 수 없음"],
  "browser.tab_closed": ["Tab closed", "Вкладка закрыта", "标签页已关闭", "分頁已關閉", "タブを閉じました", "탭 닫힘"],
  "browser.tab_completed": ["Tab finished", "Вкладка завершила работу", "标签页已完成", "分頁已完成", "タブの処理が完了しました", "탭 완료됨"],
  "browser.tab_created": ["Tab opened", "Вкладка открыта", "标签页已打开", "分頁已開啟", "タブを開きました", "탭 열림"],
  "browser.tab_initialization_failed": ["Tab failed to start", "Не удалось запустить вкладку", "标签页启动失败", "分頁啟動失敗", "タブを起動できませんでした", "탭을 시작하지 못함"],
  "browser.tab_navigation_failed": ["Tab failed to load", "Не удалось загрузить вкладку", "标签页加载失败", "分頁載入失敗", "タブを読み込めませんでした", "탭을 불러오지 못함"],
  "browser.tab_released": ["Tab released", "Вкладка освобождена", "标签页已释放", "分頁已釋放", "タブを解放しました", "탭 해제됨"],
  "browser.tab_renderer_gone": ["Tab crashed", "Вкладка аварийно закрылась", "标签页已崩溃", "分頁已當機", "タブがクラッシュしました", "탭 충돌"],
  "browser.tab_responsive": ["Tab responding again", "Вкладка снова отвечает", "标签页已恢复响应", "分頁已恢復回應", "タブが再び応答しています", "탭이 다시 응답함"],
  "browser.tab_retained": ["Tab kept open", "Вкладка оставлена открытой", "标签页保持打开", "分頁保持開啟", "タブを開いたままにしました", "탭을 열어 둠"],
  "browser.tab_reused": ["Tab reused", "Вкладка использована повторно", "标签页已复用", "分頁已重複使用", "タブを再利用しました", "탭 재사용됨"],
  "browser.tab_selection_rollback_failed": ["Couldn't undo a tab selection", "Не удалось отменить выбор вкладки", "无法撤销标签页选择", "無法復原分頁選取", "タブの選択を取り消せませんでした", "탭 선택을 취소할 수 없음"],
  "browser.tab_unresponsive": ["Tab not responding", "Вкладка не отвечает", "标签页无响应", "分頁沒有回應", "タブが応答しません", "탭이 응답하지 않음"],
  "browser.retained_conversation_released": ["Kept chat released", "Сохранённый чат освобождён", "已释放保留的聊天", "已釋放保留的聊天", "保持していたチャットを解放しました", "유지된 채팅 해제됨"],
  "browser.retained_tab_expired": ["Kept tab expired", "Срок сохранённой вкладки истёк", "保留的标签页已过期", "保留的分頁已過期", "保持していたタブの期限が切れました", "유지된 탭 만료됨"],

  // Browser: turns
  "browser.turn_started": ["Turn started", "Запрос начат", "任务已开始", "任務已開始", "ターンを開始しました", "턴 시작됨"],
  "browser.turn_ended": ["Turn ended", "Запрос завершён", "任务已结束", "任務已結束", "ターンが終了しました", "턴 종료됨"],
  "browser.turn_authentication_blocked": ["Turn blocked: sign-in needed", "Запрос остановлен: нужен вход", "任务受阻：需要登录", "任務受阻：需要登入", "ターンを停止: ログインが必要です", "턴 차단됨: 로그인 필요"],
  "browser.turn_leases_refreshed_after_suspension": ["Turns resumed after sleep", "Запросы продолжены после сна", "睡眠后已恢复任务", "睡眠後已恢復任務", "スリープ後にターンを再開しました", "절전 후 턴 재개됨"],
  "browser.turn_navigation_blocked": ["Turn navigation blocked", "Переход во время запроса заблокирован", "任务期间的导航已被阻止", "任務期間的導覽已遭封鎖", "ターン中のページ移動をブロックしました", "턴 중 이동 차단됨"],
  "browser.stale_turn_owner_replaced": ["Stale turn owner replaced", "Устаревший владелец запроса заменён", "已替换过期的任务所有者", "已取代過期的任務擁有者", "古いターンの所有者を置き換えました", "오래된 턴 소유자 교체됨"],
  "browser.removed_turn_settlement_failed": ["Couldn't finish a removed turn", "Не удалось завершить удалённый запрос", "无法结束已移除的任务", "無法結束已移除的任務", "削除されたターンを終了できませんでした", "제거된 턴을 마무리할 수 없음"],
  "browser.orphan_turn_cancel_failed": ["Couldn't cancel an abandoned turn", "Не удалось отменить брошенный запрос", "无法取消被放弃的任务", "無法取消被放棄的任務", "放置されたターンをキャンセルできませんでした", "버려진 턴을 취소할 수 없음"],
  "browser.orphan_turn_expired": ["Abandoned turn expired", "Срок брошенного запроса истёк", "被放弃的任务已过期", "被放棄的任務已過期", "放置されたターンの期限が切れました", "버려진 턴 만료됨"],
  "browser.orphan_turn_reaped": ["Abandoned turn cleared", "Брошенный запрос удалён", "已清除被放弃的任务", "已清除被放棄的任務", "放置されたターンを片付けました", "버려진 턴 정리됨"],
  "browser.artifact_lease_registered": ["File transfer started", "Передача файла начата", "文件传输已开始", "檔案傳輸已開始", "ファイル転送を開始しました", "파일 전송 시작됨"],
  "browser.artifact_lease_completed": ["File transfer finished", "Передача файла завершена", "文件传输已完成", "檔案傳輸已完成", "ファイル転送が完了しました", "파일 전송 완료됨"],
  "browser.artifact_partial_cleanup_failed": ["Couldn't clean up a partial file transfer", "Не удалось очистить незавершённую передачу файла", "无法清理未完成的文件传输", "無法清理未完成的檔案傳輸", "途中のファイル転送を片付けられませんでした", "완료되지 않은 파일 전송을 정리할 수 없음"],

  // Browser: manual mode
  "browser.manual_control_started": ["Manual control started", "Ручное управление запущено", "手动控制已开始", "手動控制已開始", "手動操作を開始しました", "수동 제어 시작됨"],
  "browser.manual_conversation_invalidated": ["Manual chat no longer valid", "Ручной чат больше не действителен", "手动聊天已失效", "手動聊天已失效", "手動チャットは無効になりました", "수동 채팅이 더 이상 유효하지 않음"],
  "browser.manual_orphan_turn_reaped": ["Abandoned manual turn cleared", "Брошенный ручной запрос удалён", "已清除被放弃的手动任务", "已清除被放棄的手動任務", "放置された手動ターンを片付けました", "버려진 수동 턴 정리됨"],
  "browser.manual_prompt_confirmed": ["Manual prompt confirmed", "Ручной запрос подтверждён", "手动提示已确认", "手動提示已確認", "手動プロンプトを確認しました", "수동 프롬프트 확인됨"],
  "browser.manual_prompt_copied": ["Manual prompt copied", "Ручной запрос скопирован", "手动提示已复制", "手動提示已複製", "手動プロンプトをコピーしました", "수동 프롬프트 복사됨"],
  "browser.manual_tab_initialization_failed": ["Manual tab failed to start", "Не удалось запустить ручную вкладку", "手动标签页启动失败", "手動分頁啟動失敗", "手動タブを起動できませんでした", "수동 탭을 시작하지 못함"],
  "browser.manual_tab_navigation_failed": ["Manual tab failed to load", "Не удалось загрузить ручную вкладку", "手动标签页加载失败", "手動分頁載入失敗", "手動タブを読み込めませんでした", "수동 탭을 불러오지 못함"],
  "browser.manual_tab_navigation_superseded": ["Manual tab navigation replaced", "Переход ручной вкладки заменён", "手动标签页导航已被替换", "手動分頁導覽已被取代", "手動タブのページ移動を置き換えました", "수동 탭 이동이 대체됨"],
  "browser.manual_tab_renderer_gone": ["Manual tab crashed", "Ручная вкладка аварийно закрылась", "手动标签页已崩溃", "手動分頁已當機", "手動タブがクラッシュしました", "수동 탭 충돌"],
  "browser.manual_turn_cancel_failed": ["Couldn't cancel the manual turn", "Не удалось отменить ручной запрос", "无法取消手动任务", "無法取消手動任務", "手動ターンをキャンセルできませんでした", "수동 턴을 취소할 수 없음"],
  "browser.manual_turn_started": ["Manual turn started", "Ручной запрос начат", "手动任务已开始", "手動任務已開始", "手動ターンを開始しました", "수동 턴 시작됨"],
  "browser.manual_turn_timed_out": ["Manual turn timed out", "Время ручного запроса истекло", "手动任务已超时", "手動任務已逾時", "手動ターンがタイムアウトしました", "수동 턴 시간 초과"],

  // Codex, connector, local tools, connection test
  "codex.model_catalog_failed": ["Model catalog failed", "Сбой каталога моделей", "模型目录失败", "模型目錄失敗", "モデルカタログのエラー", "모델 카탈로그 실패"],
  "codex.model_catalog_served": ["Model catalog served to Codex", "Каталог моделей передан Codex", "已向 Codex 提供模型目录", "已向 Codex 提供模型目錄", "モデルカタログを Codex に提供しました", "Codex에 모델 카탈로그 제공됨"],
  "codex.model_catalog_verification_pending": ["Model catalog check pending", "Проверка каталога моделей ожидает", "模型目录检查待完成", "模型目錄檢查待完成", "モデルカタログの確認待ち", "모델 카탈로그 확인 대기 중"],
  "connector.verification_failed": ["Connector check failed", "Не удалось проверить коннектор", "连接器检查失败", "連接器檢查失敗", "コネクタを確認できませんでした", "커넥터 확인 실패"],
  "connector.verified": ["Connector verified", "Коннектор проверен", "连接器已验证", "連接器已驗證", "コネクタを確認しました", "커넥터 확인됨"],
  "mcp.verification_requested": ["Local tools check requested", "Запрошена проверка локальных инструментов", "已请求检查本地工具", "已要求檢查本機工具", "ローカルツールの確認を要求しました", "로컬 도구 확인 요청됨"],
  "smoke.started": ["Connection test started", "Проверка подключения начата", "连接测试已开始", "連線測試已開始", "接続テストを開始しました", "연결 테스트 시작됨"],
  "smoke.completed": ["Connection test completed", "Проверка подключения завершена", "连接测试已完成", "連線測試已完成", "接続テストが完了しました", "연결 테스트 완료됨"],

  // DEV profile
  "dev_profile.config_invalid": ["DEV profile settings are invalid", "Настройки профиля DEV недействительны", "DEV 配置文件设置无效", "DEV 設定檔設定無效", "DEV プロファイルの設定が無効です", "DEV 프로필 설정이 올바르지 않음"],
  "dev_profile.ready": ["DEV profile ready", "Профиль DEV готов", "DEV 配置文件已就绪", "DEV 設定檔已就緒", "DEV プロファイルの準備ができました", "DEV 프로필 준비됨"],
  "dev_profile.runtime_start_failed": ["DEV runtime failed to start", "Не удалось запустить среду выполнения DEV", "DEV 运行时启动失败", "DEV 執行階段啟動失敗", "DEV ランタイムを起動できませんでした", "DEV 런타임을 시작하지 못함"],

  // Launcher
  "launcher.external_url_rejected": ["External link blocked", "Внешняя ссылка заблокирована", "外部链接已被阻止", "外部連結已遭封鎖", "外部リンクをブロックしました", "외부 링크 차단됨"],
  "launcher.ipc_failed": ["Launcher request failed", "Не удалось выполнить запрос NEKODEX", "启动器请求失败", "啟動器要求失敗", "ランチャーの要求に失敗しました", "런처 요청 실패"],
  "launcher.logs_exported": ["Log exported", "Журнал экспортирован", "日志已导出", "日誌已匯出", "ログを書き出しました", "로그 내보냄"],
  "launcher.onboarding_completed": ["Welcome setup completed", "Первоначальная настройка завершена", "欢迎设置已完成", "歡迎設定已完成", "初期設定が完了しました", "시작 설정 완료됨"],
  "launcher.quit_cleanup_failed": ["Cleanup on quit failed", "Не удалось выполнить очистку при выходе", "退出时清理失败", "結束時清理失敗", "終了時の後片付けに失敗しました", "종료 시 정리 실패"],
  "launcher.quit_cleanup_incomplete": ["Cleanup on quit incomplete", "Очистка при выходе не завершена", "退出时清理未完成", "結束時清理未完成", "終了時の後片付けが完了していません", "종료 시 정리가 완료되지 않음"],
  "launcher.renderer_gone": ["Launcher window crashed", "Окно NEKODEX аварийно закрылось", "启动器窗口已崩溃", "啟動器視窗已當機", "ランチャーのウィンドウがクラッシュしました", "런처 창 충돌"],
  "launcher.renderer_navigation_blocked": ["Launcher navigation blocked", "Переход в окне NEKODEX заблокирован", "启动器导航已被阻止", "啟動器導覽已遭封鎖", "ランチャー内のページ移動をブロックしました", "런처 이동 차단됨"],
  "launcher.renderer_recovery_completed": ["Launcher window recovered", "Окно NEKODEX восстановлено", "启动器窗口已恢复", "啟動器視窗已復原", "ランチャーのウィンドウを復旧しました", "런처 창 복구됨"],
  "launcher.renderer_recovery_dialog_failed": ["Couldn't show the recovery message", "Не удалось показать сообщение о восстановлении", "无法显示恢复消息", "無法顯示復原訊息", "復旧メッセージを表示できませんでした", "복구 메시지를 표시할 수 없음"],
  "launcher.renderer_recovery_failed": ["Launcher window recovery failed", "Не удалось восстановить окно NEKODEX", "启动器窗口恢复失败", "啟動器視窗復原失敗", "ランチャーのウィンドウを復旧できませんでした", "런처 창 복구 실패"],
  "launcher.renderer_recovery_recurred": ["Launcher window crashed again", "Окно NEKODEX снова аварийно закрылось", "启动器窗口再次崩溃", "啟動器視窗再次當機", "ランチャーのウィンドウが再びクラッシュしました", "런처 창이 다시 충돌함"],
  "launcher.renderer_recovery_started": ["Recovering the launcher window", "Восстановление окна NEKODEX", "正在恢复启动器窗口", "正在復原啟動器視窗", "ランチャーのウィンドウを復旧しています", "런처 창 복구 중"],
  "launcher.shell_zoom_shortcut_failed": ["Zoom shortcut failed", "Не удалось изменить масштаб", "缩放快捷键失败", "縮放快速鍵失敗", "ズームのショートカットに失敗しました", "확대/축소 단축키 실패"],
  "launcher.tray_unavailable": ["Menu bar icon unavailable", "Значок в строке меню недоступен", "菜单栏图标不可用", "選單列圖示無法使用", "メニューバーのアイコンを利用できません", "메뉴 막대 아이콘을 사용할 수 없음"],
  "launcher.window_created": ["Launcher window opened", "Окно NEKODEX открыто", "启动器窗口已打开", "啟動器視窗已開啟", "ランチャーのウィンドウを開きました", "런처 창 열림"],
  "launcher.window_state_write_failed": ["Couldn't save the window position", "Не удалось сохранить положение окна", "无法保存窗口位置", "無法儲存視窗位置", "ウィンドウの位置を保存できませんでした", "창 위치를 저장할 수 없음"],

  // Updates
  "launcher.update_available": ["Update available", "Доступно обновление", "有可用更新", "有可用更新", "アップデートがあります", "업데이트 있음"],
  "launcher.update_cache_prune_failed": ["Couldn't clear old update files", "Не удалось удалить старые файлы обновлений", "无法清除旧的更新文件", "無法清除舊的更新檔案", "古いアップデートファイルを削除できませんでした", "이전 업데이트 파일을 지울 수 없음"],
  "launcher.update_cancel_failed": ["Couldn't cancel the update", "Не удалось отменить обновление", "无法取消更新", "無法取消更新", "アップデートをキャンセルできませんでした", "업데이트를 취소할 수 없음"],
  "launcher.update_cancel_unsettled": ["Update cancellation still in progress", "Отмена обновления ещё выполняется", "更新取消仍在进行", "更新取消仍在進行", "アップデートのキャンセルを処理中です", "업데이트 취소가 아직 진행 중"],
  "launcher.update_check_failed": ["Update check failed", "Не удалось проверить обновления", "检查更新失败", "檢查更新失敗", "アップデートを確認できませんでした", "업데이트 확인 실패"],
  "launcher.update_cleanup_failed": ["Update cleanup failed", "Не удалось очистить файлы обновления", "更新清理失败", "更新清理失敗", "アップデートの後片付けに失敗しました", "업데이트 정리 실패"],
  "launcher.update_cleanup_preserved": ["Update files kept for recovery", "Файлы обновления сохранены для восстановления", "已保留更新文件以便恢复", "已保留更新檔案以便復原", "復旧用にアップデートファイルを残しました", "복구를 위해 업데이트 파일 보관됨"],
  "launcher.update_worker_started": ["Update started", "Обновление начато", "更新已开始", "更新已開始", "アップデートを開始しました", "업데이트 시작됨"],

  // Runtime
  "runtime.active_turns_cancelled": ["Active turns cancelled", "Активные запросы отменены", "活动任务已取消", "進行中的任務已取消", "実行中のターンをキャンセルしました", "활성 턴 취소됨"],
  "runtime.background_attached": ["Background runtime connected", "Фоновая среда выполнения подключена", "已连接后台运行时", "已連線背景執行階段", "バックグラウンドのランタイムに接続しました", "백그라운드 런타임 연결됨"],
  "runtime.background_detach_compensation_failed": ["Couldn't restore the background runtime", "Не удалось восстановить фоновую среду выполнения", "无法恢复后台运行时", "無法還原背景執行階段", "バックグラウンドのランタイムを復元できませんでした", "백그라운드 런타임을 복원할 수 없음"],
  "runtime.background_network_unavailable": ["Background runtime has no network", "У фоновой среды выполнения нет сети", "后台运行时无网络", "背景執行階段沒有網路", "バックグラウンドのランタイムがネットワークに接続できません", "백그라운드 런타임에 네트워크 없음"],
  "runtime.browser_turn_cancelled": ["Browser turn cancelled", "Запрос в браузере отменён", "浏览器任务已取消", "瀏覽器任務已取消", "ブラウザーのターンをキャンセルしました", "브라우저 턴 취소됨"],
  "runtime.committed_release_bootstrap": ["Runtime release set up", "Выпуск среды выполнения подготовлен", "运行时版本已设置", "執行階段版本已設定", "ランタイムのリリースを準備しました", "런타임 릴리스 설정됨"],
  "runtime.existing_chrome_cleanup_failed": ["Chrome sign-in cleanup failed", "Не удалось очистить данные входа из Chrome", "Chrome 登录清理失败", "Chrome 登入清理失敗", "Chrome ログインの後片付けに失敗しました", "Chrome 로그인 정리 실패"],
  "runtime.external_owner_detected": ["Runtime is run by another process", "Средой выполнения управляет другой процесс", "运行时由其他进程运行", "執行階段由其他處理程序執行", "ランタイムは別のプロセスが実行しています", "다른 프로세스가 런타임을 실행 중"],
  "runtime.failed_quit_resume_deferred": ["Resume after a failed quit postponed", "Возобновление после неудачного выхода отложено", "退出失败后的恢复已推迟", "結束失敗後的繼續已延後", "終了失敗後の再開を延期しました", "종료 실패 후 재개 연기됨"],
  "runtime.forced_shutdown_started": ["Force-stopping the runtime", "Принудительная остановка среды выполнения", "正在强制停止运行时", "正在強制停止執行階段", "ランタイムを強制停止しています", "런타임 강제 중지 중"],
  "runtime.forced_shutdown_completed": ["Runtime force-stopped", "Среда выполнения принудительно остановлена", "运行时已强制停止", "執行階段已強制停止", "ランタイムを強制停止しました", "런타임 강제 중지됨"],
  "runtime.forced_shutdown_unsettled_start": ["Runtime start interrupted by a force stop", "Запуск среды выполнения прерван принудительной остановкой", "强制停止中断了运行时启动", "強制停止中斷了執行階段啟動", "強制停止によりランタイムの起動が中断されました", "강제 중지로 런타임 시작이 중단됨"],
  "runtime.operation_started": ["Runtime task started", "Задача среды выполнения начата", "运行时任务已开始", "執行階段任務已開始", "ランタイムの処理を開始しました", "런타임 작업 시작됨"],
  "runtime.operation_completed": ["Runtime task completed", "Задача среды выполнения завершена", "运行时任务已完成", "執行階段任務已完成", "ランタイムの処理が完了しました", "런타임 작업 완료됨"],
  "runtime.operation_failed": ["Runtime task failed", "Задача среды выполнения не выполнена", "运行时任务失败", "執行階段任務失敗", "ランタイムの処理に失敗しました", "런타임 작업 실패"],
  "runtime.passkey_cancel_failed": ["Couldn't cancel the passkey sign-in", "Не удалось отменить вход по ключу доступа", "无法取消通行密钥登录", "無法取消通行金鑰登入", "パスキーでのログインをキャンセルできませんでした", "패스키 로그인을 취소할 수 없음"],
  "runtime.passkey_cleanup_failed": ["Passkey sign-in cleanup failed", "Не удалось очистить данные входа по ключу доступа", "通行密钥登录清理失败", "通行金鑰登入清理失敗", "パスキーログインの後片付けに失敗しました", "패스키 로그인 정리 실패"],
  "runtime.pending_generation_recovered": ["Pending runtime version recovered", "Ожидающая версия среды выполнения восстановлена", "已恢复待处理的运行时版本", "已復原待處理的執行階段版本", "保留中のランタイムのバージョンを復旧しました", "대기 중인 런타임 버전 복구됨"],
  "runtime.release_generation_staged": ["New runtime version staged", "Новая версия среды выполнения подготовлена", "新的运行时版本已就位", "新的執行階段版本已就位", "新しいランタイムのバージョンを準備しました", "새 런타임 버전 준비됨"],
  "runtime.release_upgraded": ["Runtime upgraded", "Среда выполнения обновлена", "运行时已升级", "執行階段已升級", "ランタイムをアップグレードしました", "런타임 업그레이드됨"],
  "runtime.secret_cleanup_failed": ["Couldn't remove saved secrets", "Не удалось удалить сохранённые секреты", "无法删除已保存的密钥", "無法刪除已儲存的密鑰", "保存済みのシークレットを削除できませんでした", "저장된 비밀 정보를 삭제할 수 없음"],
  "runtime.setup_required": ["Runtime setup needed", "Нужна настройка среды выполнения", "需要设置运行时", "需要設定執行階段", "ランタイムの設定が必要です", "런타임 설정 필요"],
  "runtime.stale_owner_recovery_started": ["Recovering a stale runtime process", "Восстановление зависшего процесса среды выполнения", "正在恢复过期的运行时进程", "正在復原過期的執行階段處理程序", "古いランタイムのプロセスを復旧しています", "오래된 런타임 프로세스 복구 중"],
  "runtime.stale_owner_recovered": ["Stale runtime process recovered", "Зависший процесс среды выполнения восстановлен", "已恢复过期的运行时进程", "已復原過期的執行階段處理程序", "古いランタイムのプロセスを復旧しました", "오래된 런타임 프로세스 복구됨"],
  "runtime.startup_candidate_failed": ["Runtime start attempt failed", "Попытка запуска среды выполнения не удалась", "运行时启动尝试失败", "執行階段啟動嘗試失敗", "ランタイムの起動の試行に失敗しました", "런타임 시작 시도 실패"],
  "runtime.startup_failed": ["Runtime failed to start", "Не удалось запустить среду выполнения", "运行时启动失败", "執行階段啟動失敗", "ランタイムを起動できませんでした", "런타임을 시작하지 못함"],
  "runtime.startup_generation_recovered": ["Runtime version recovered at start", "Версия среды выполнения восстановлена при запуске", "启动时已恢复运行时版本", "啟動時已復原執行階段版本", "起動時にランタイムのバージョンを復旧しました", "시작 시 런타임 버전 복구됨"],
  "runtime.startup_proof_reconciliation_failed": ["Couldn't confirm earlier checks at start", "Не удалось подтвердить прежние проверки при запуске", "启动时无法确认之前的检查", "啟動時無法確認先前的檢查", "起動時に以前の確認結果を照合できませんでした", "시작 시 이전 확인 결과를 확인할 수 없음"],
  "runtime.state_write_failed": ["Couldn't save the runtime state", "Не удалось сохранить состояние среды выполнения", "无法保存运行时状态", "無法儲存執行階段狀態", "ランタイムの状態を保存できませんでした", "런타임 상태를 저장할 수 없음"],
  "runtime.stdout": ["Runtime output", "Вывод среды выполнения", "运行时输出", "執行階段輸出", "ランタイムの出力", "런타임 출력"],
  "runtime.stderr": ["Runtime error output", "Вывод ошибок среды выполнения", "运行时错误输出", "執行階段錯誤輸出", "ランタイムのエラー出力", "런타임 오류 출력"],
  "runtime.tunnel_adopted": ["Existing tunnel reused", "Используется существующий туннель", "已复用现有隧道", "已重複使用現有隧道", "既存のトンネルを再利用しました", "기존 터널 재사용됨"],
  "runtime.tunnel_adopted_for_stop": ["Existing tunnel taken over to stop it", "Существующий туннель перехвачен для остановки", "已接管现有隧道以将其停止", "已接管現有隧道以將其停止", "停止するために既存のトンネルを引き継ぎました", "중지하기 위해 기존 터널 인수됨"],
  "runtime.tunnel_monitor_observation_restored": ["Tunnel status available again", "Состояние туннеля снова доступно", "隧道状态已恢复可用", "隧道狀態已恢復可用", "トンネルの状態を再び取得できます", "터널 상태를 다시 사용할 수 있음"],
  "runtime.tunnel_monitor_observation_unavailable": ["Tunnel status unavailable", "Состояние туннеля недоступно", "隧道状态不可用", "隧道狀態無法使用", "トンネルの状態を取得できません", "터널 상태를 사용할 수 없음"],
  "runtime.tunnel_monitor_unhealthy": ["Tunnel unhealthy", "Туннель работает со сбоями", "隧道运行异常", "隧道運作異常", "トンネルが正常ではありません", "터널 상태 비정상"],
  "runtime.tunnel_status_report_failed": ["Tunnel status report failed", "Не удалось получить отчёт о состоянии туннеля", "隧道状态报告失败", "隧道狀態報告失敗", "トンネルの状態を報告できませんでした", "터널 상태 보고 실패"],
  "runtime.tunnel_waiting": ["Waiting for the tunnel", "Ожидание туннеля", "正在等待隧道", "正在等待隧道", "トンネルを待っています", "터널 대기 중"],
  "runtime.web_route_repair_monitor_restore_failed": ["Couldn't restore Web route repair", "Не удалось восстановить исправление маршрута Web", "无法恢复 Web 路由修复", "無法還原 Web 路由修復", "Web ルートの修復を復元できませんでした", "Web 경로 복구를 복원할 수 없음"],
  "runtime.web_route_repair_state_failed": ["Couldn't save the Web route repair state", "Не удалось сохранить состояние исправления маршрута Web", "无法保存 Web 路由修复状态", "無法儲存 Web 路由修復狀態", "Web ルートの修復状態を保存できませんでした", "Web 경로 복구 상태를 저장할 수 없음"],
  "runtime.web_route_repair_unavailable": ["Web route repair unavailable", "Исправление маршрута Web недоступно", "Web 路由修复不可用", "Web 路由修復無法使用", "Web ルートの修復を利用できません", "Web 경로 복구를 사용할 수 없음"],
};

// The area of an unlisted event, from its first segment.
const AREAS: Record<string, Titles> = {
  bridge: ["Codex route", "Маршрут Codex", "Codex 路由", "Codex 路由", "Codex ルート", "Codex 경로"],
  browser: ["Browser", "Браузер", "浏览器", "瀏覽器", "ブラウザー", "브라우저"],
  codex: ["Codex", "Codex", "Codex", "Codex", "Codex", "Codex"],
  connector: ["Connector", "Коннектор", "连接器", "連接器", "コネクタ", "커넥터"],
  dev_profile: ["DEV profile", "Профиль DEV", "DEV 配置文件", "DEV 設定檔", "DEV プロファイル", "DEV 프로필"],
  launcher: ["Launcher", "NEKODEX", "启动器", "啟動器", "ランチャー", "런처"],
  mcp: ["Local tools", "Локальные инструменты", "本地工具", "本機工具", "ローカルツール", "로컬 도구"],
  runtime: ["Runtime", "Среда выполнения", "运行时", "執行階段", "ランタイム", "런타임"],
  smoke: ["Connection test", "Проверка подключения", "连接测试", "連線測試", "接続テスト", "연결 테스트"],
};

const words = (value: string) => value.replaceAll("_", " ").trim();

/** The readable title of a log event id such as "browser.turn_ended", in the UI language. */
export function eventTitle(event: string, language: Language): string {
  const index = ORDER[language] ?? 0;
  const known = TITLES[event];
  if (known) return known[index] ?? known[0];
  const [area = "", ...rest] = event.split(".");
  const areaTitle = AREAS[area]?.[index];
  const detail = rest.map(words).filter(Boolean).join(" · ");
  if (areaTitle) return detail ? `${areaTitle}: ${detail}` : areaTitle;
  const plain = event.split(".").map(words).filter(Boolean).join(" · ");
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : event;
}
