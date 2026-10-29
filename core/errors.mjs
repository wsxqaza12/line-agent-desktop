const messages = {
  WINDOWS_REQUIRED: '目前支援 Windows x64。請在已登入 LINE 的 Windows 電腦執行。',
  RUNTIME_MISSING: '本機讀取環境不完整，請重新安裝完整版本。',
  LINE_BUILD_UNVERIFIED: '這個 LINE 版本尚未通過讀取器驗證，請等候相容版本更新。',
  LINE_PROCESS_UNAVAILABLE: '請先開啟電腦版 LINE 並登入，再試一次。',
  LINE_CLIENT_STATUS_UNAVAILABLE: '無法確認 LINE 狀態，請檢查 LINE 是否已安裝並登入。',
  LINE_NOT_RUNNING: 'LINE 尚未執行，請先開啟並登入。',
  CHAT_NOT_FOUND: '本機索引找不到這個聊天室。請在 LINE 確認名稱與同步狀態，再重新搜尋；目前無法從介面補讀。',
  CHAT_AMBIGUOUS: '有多個同名聊天室，無法確認唯一對象，這次沒有讀取訊息。',
  CHAT_IDENTITY_CHANGED: '聊天室身分已改變，請重新選取聊天室。',
  CHAT_ACCOUNT_CHANGED: '目前登入的 LINE 帳號與授權時不同，請重新選取聊天室。',
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
  UNKNOWN_TOOL: '不支援這個操作。此版本只提供讀取功能。',
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
