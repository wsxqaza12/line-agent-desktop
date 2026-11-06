const messages = {
  MAC_ACCESSIBILITY_REQUIRED:
    '請到系統設定 → 隱私權與安全性 → 輔助使用，允許 LINE Agent Desktop，再回來重新檢查。',
  MAC_APP_REQUIRED: 'Mac 讀取需要 LINE Agent Desktop 保持開啟，請先開啟桌面工具。',
  MAC_LOGIN_REQUIRED: '請先在 Mac 的 LINE 登入，並顯示聊天主視窗。',
  MAC_UI_CHANGED: 'LINE 視窗結構無法辨識，這次沒有讀取。請使用繁體中文介面並開啟聊天主視窗。',
  MAC_UI_BUSY: 'LINE 視窗在操作中改變，結果已捨棄。請讓 LINE 保持可操作，讀取時暫停滑鼠操作後再試。',
  MAC_SEARCH_INCOMPLETE: 'LINE 搜尋結果未完整顯示，無法排除同名聊天室。請用更完整的名稱搜尋。',
  MAC_TIMEZONE_REQUIRED: 'Mac 預覽版目前需要系統時區為 Asia/Taipei，才能確認訊息日期與時間。',
  MAC_CURSOR_EXPIRED: '這次視窗讀取的分頁已過期或條件不同，請從第一頁重新讀取。',
  MAC_READER_FAILED: 'Mac 讀取未完成。請確認已允許輔助使用，LINE 已登入，並重新檢查。',
  MAC_BRIDGE_FAILED: '無法連接桌面讀取服務，請重新開啟 LINE Agent Desktop。',
  AGENT_NOT_READY: 'AI 尚未就緒。請到「AI 助理」重新偵測，並選擇已登入的 Codex 或 Claude Code。',
  AGENT_MANUAL_LIMIT: '最多保留 8 個手動位置，請先移除不再使用的設定。',
  AGENT_INVALID_PATH:
    '請選擇 Codex／Claude Code 的 CLI 執行檔（.exe 或 JavaScript 入口）。聊天視窗程式與 .cmd 捷徑無法使用。',
  AGENT_START_FAILED: '無法啟動 AI。請重新偵測安裝位置，或更新官方 CLI。',
  AGENT_CANCELLED: '已停止這次整理。已寫入的工作會保留。',
  AGENT_TIMEOUT: 'AI 超過 10 分鐘未完成，這次已停止。請縮短日期範圍後重試。',
  AGENT_STOP_FAILED: '程序清理未完成，請檢查 AI 程序狀態後再試。',
  AGENT_OUTPUT_LIMIT: 'AI 回傳內容超過本次容量，這次沒有套用 AI 結果。請縮短範圍重試。',
  AGENT_INPUT_LIMIT: '這次資料太多。請選單一聊天室或縮短日期範圍後重試；尚未交給 AI 判讀。',
  AGENT_INCOMPLETE_READ: '聊天室分頁未完整讀取，這次尚未交給 AI。請稍後重試。',
  AGENT_INVALID_OUTPUT: 'AI 結果格式或來源驗證未通過，這次沒有套用結果。可以重新整理。',
  AGENT_USAGE_LIMIT: '所選 AI 的額度已用完或暫時受限。請稍後重試，或自行選擇另一個 AI。',
  AGENT_LOGIN_REQUIRED: 'AI 登入已失效。請在官方 Codex／Claude Code 重新登入，再回來偵測。',
  AGENT_FAILED: 'AI 未能完成這次整理。請確認網路、登入和訂閱額度，再重試。',
  WINDOWS_REQUIRED: '目前支援 Windows x64 與 Apple Silicon Mac，請使用對應的安裝包。',
  RUNTIME_MISSING: '本機讀取環境不完整，請重新安裝完整版本。',
  LINE_BUILD_UNVERIFIED: '這個 LINE 版本尚未通過讀取器驗證，請等候相容版本更新。',
  LINE_PROCESS_UNAVAILABLE: '請先開啟電腦版 LINE 並登入，再試一次。',
  LINE_CLIENT_STATUS_UNAVAILABLE: '無法確認 LINE 狀態，請檢查 LINE 是否已安裝並登入。',
  LINE_NOT_RUNNING: 'LINE 尚未執行，請先開啟並登入。',
  CHAT_NOT_FOUND: '找不到這個聊天室。請在 LINE 確認完整名稱與同步狀態，再重新搜尋。',
  CHAT_AMBIGUOUS: '有多個同名聊天室，無法確認唯一對象，這次沒有讀取訊息。',
  CHAT_IDENTITY_CHANGED: '聊天室身分已改變，請重新選取聊天室。',
  CHAT_ACCOUNT_CHANGED:
    'LINE 帳號或登入工作階段已改變，請重新載入並儲存聊天室授權。Mac 預覽版在 LINE 重開後需要重新授權。',
  ACCOUNT_UNAVAILABLE: '無法確認登入帳號，暫時不能授權聊天室。請開啟 LINE 同步後重試。',
  ACCESS_PAUSED: 'LINE 存取已暫停，請在桌面工具重新開啟。',
  CHAT_NOT_ALLOWED: '這個聊天室尚未獲得授權。請先在桌面工具選取。',
  ACCESS_CHANGED: '讀取期間授權已變更，結果已捨棄。',
  SETTINGS_INVALID: '設定檔無法讀取。已停止訊息存取，請檢查設定檔或還原備份。',
  INVALID_ARGUMENT: '輸入格式不正確，請檢查聊天室、日期與筆數。',
  SOURCE_BUSY: 'LINE 資料仍在同步，請稍後手動重試。',
  SESSION_KEY_UNAVAILABLE: 'LINE 工作階段尚未就緒，請確認已登入，再重試。',
  LOCAL_READER_TIMEOUT: '讀取超時。請確認 LINE 已完成同步後重試。',
  BUSY: '已有一個讀取作業正在執行，請稍後再試。',
  NO_CHATS: '請至少選擇一個聊天室，再啟用存取。',
  UNKNOWN_TOOL: '不支援這個操作。',
  WORK_NOT_FOUND: '找不到這件工作，請重新整理看板。',
  WORK_CONFLICT: '這件工作或規則剛被更新。請重新整理，再套用你的變更。',
  WORK_MERGED: '這件工作已合併，請重新讀取看板並更新合併後的任務。',
  WORK_BUSY: '工作資料正被另一個程序更新，請稍後重試。',
  WORK_STORE_INVALID: '無法讀取工作資料庫，請保留原檔並檢查備份。',
  WORK_VERSION_NEWER: '工作資料由較新版本建立，請更新桌面工具後再開啟。',
  WORK_LIMIT: '工作資料已達本版容量上限，這次沒有寫入。',
  SOURCE_NOT_OBSERVED: '請先在同一個 MCP 連線讀取來源訊息，再引用 sourceRef 建立工作。',
  RULE_CHANGE_NOT_REQUESTED: '只有使用者要求修改整理偏好時，Agent 才能更新規則。',
};
export class AppError extends Error {
  constructor(code, message) {
    super(message ?? messages[code] ?? `讀取未完成（${code}）。`);
    this.code = code;
  }
}
export function safeError(error) {
  const code =
    typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code)
      ? error.code
      : 'OPERATION_FAILED';
  return { code, message: messages[code] ?? `操作未完成（${code}）。請到「狀態與說明」查看處理方式。` };
}
