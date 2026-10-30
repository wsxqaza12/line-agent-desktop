# LINE Agent Desktop

**把 LINE 對話裡的工作，交給你自己的 Agent 整理。**

Windows 本機工作看板。選擇授權聊天室，讓原本使用的 Agent 讀取對話、
整理待辦並寫回看板。你可以調整進度、確認建議、依日期查看工作，
點開任務就能看原訊息片段與變更紀錄。

<img src="docs/images/overview.png" alt="LINE 工作看板：待辦、進行中、已完成。畫面使用虛構展示資料。" width="1080" />

[下載 Windows 測試版](https://github.com/wsxqaza12/line-agent-desktop/releases) ·
[使用方式](#開始使用) · [Agent skill](skills/line-workboard/SKILL.md) ·
[驗證紀錄](docs/VALIDATION.md)

**0.3.0 Preview**。安裝包內附 Node、Python 與 LINE 讀取器，不需要安裝開發環境。
需要已安裝、登入的 Codex CLI 或 Claude Code；沒有附贈 AI 訂閱或背景排程。

## 開始使用

1. 開啟已登入的 Windows 電腦版 LINE，安裝並開啟 LINE Agent Desktop。
2. 到「聊天室權限」載入或搜尋聊天室，勾選後儲存，再按「開啟 Agent 存取」。
   新安裝預設暫停，不會自動授權聊天室。
3. 到「AI 助理」偵測 Windows／WSL 裡的 Codex、Claude Code，選擇已登入的 AI。
   如果尚未安裝官方 CLI，先依介面指引安裝，再用訂閱帳號登入；只登入網頁不代表 CLI 已登入。
4. 回到看板按「請 Agent 整理」，選日期範圍，再按「開始整理」。
   程式會讀取授權對話，交給所選 AI，核對來源後直接寫回看板。
5. 在進度面板查看已讀訊息與寫入數；可停止整理。關閉程式會停止本次作業。

選擇的 AI 會記住，下次開啟整理面板會重新偵測。模型使用原帳號的額度，
目前只接受 ChatGPT／Claude 訂閱登入，不自動改用 API 金鑰、不自動換供應商。
這不是把網頁訂閱轉成通用 API：執行與登入都由官方 Codex／Claude Code 管理。
本程式不讀取、複製或儲存它們的 OAuth token。

「AI 助理 → 進階設定 · 外部 Agent／MCP」保留原本的 MCP 介面，
可讓其他 Agent 自行查詢。Codex 支援 Windows／WSL 設定，其他客戶端使用 MCP JSON。
你也可以直接對已連接的 Agent 說：

> 整理已授權聊天室最近七天的工作。先讀取工作規則和現有任務，再讀訊息，
> 用 LINE Agent Desktop 的工具更新看板，保留人工修正並附上來源。

MCP 設定請加入既有檔案，保留其他伺服器；同名區塊請更新，不要重複加入。
WSL 使用預設 `/mnt/<磁碟>/` 掛載和 Windows 程式互通，自訂掛載時需調整 command。
桌面的 MCP 測試核對握手與工具清單；Agent 是否載入仍需在該 Agent 確認。

## 每天怎麼用

- **看板**：待辦、進行中、已完成。拖曳卡片或用卡片的狀態選單更新進度。
- **日期**：月曆與期限清單，沒有期限的工作另列在「未排日期」。
- **待確認**：尚未承諾的建議、負責人不明的要求。接受後移到待辦，
  不需要做的標記「不列入待辦」。排除決定會保留給 Agent 參考。
- **工作詳情**：修改內容、負責人、期限，查看來源與變更紀錄。
  人工改過的欄位會鎖定；可以逐次允許 Agent 再次更新這些欄位。
- **合併工作**：同一聊天室的重複卡片可以合併。保留目標卡的內容與進度、
  合併雙方來源，原卡留下合併紀錄。不同聊天室不能合併，避免跨越授權範圍。
- **整理偏好**：編輯共同規則，或直接跟 Agent 說「這類產品建議先放待確認」。
  單張卡片的修改不會默默變成全域規則。

看板開啟時會偵測本機工作資料的變更，返回視窗也會更新。沒有定時讀 LINE、
開機自啟或通知排程。只有按下「開始整理」才會啟動模型。需要定期整理時，請在你的 Agent 設定排程。

## 基礎規則與 skill

預設把明確交辦、自己的承諾列為待辦；產品建議和不確定的工作先待確認；
閒聊不開卡。沒有明說的負責人或期限留空；完成需要證據。
後續補充更新原任務，人工修正優先保留。

可攜的 [line-workboard skill](skills/line-workboard/SKILL.md) 隨原始碼提供，
安裝包也放在 `resources/skills/line-workboard/`。需要 skill 的使用者可把整個
`line-workboard` 資料夾放進自己的 Agent skills 目錄，例如 Codex 的
`~/.codex/skills/`。MCP 本身也提供整理指引，不安裝 skill 仍可使用。

「整理偏好」保存可修改的規則與例子，不進行模型權重訓練，也不讀取 Agent
全部的私人記憶。模型推理與既有偏好由你選用的 Agent 處理。

## MCP 與資料流程

```text
LINE 電腦版 → 授權讀取器 → 所選官方 CLI → 結構化整理結果
                              ↓ 來源／範圍／版本檢查
                      本機工作資料庫 → 看板／日期
                              ↕ 本機 MCP
                          其他外部 Agent
```

內建整理採獨立、短期的 CLI 工作：程式把授權範圍、規則與現有工作送到 AI，
驗證完整結構化結果後再逐筆套用。MCP 不需要先設定。Codex 使用隔離設定與唯讀沙箱，
停用 shell、外掛、hooks、瀏覽器與多 Agent；Claude 使用 safe mode、空工具清單及空 MCP 設定。
不加入使用者既有對話、不載入個人的專案指令；共用偏好由本工具的「整理偏好」提供。

單次上限：1,000 則訊息、300 張相關工作、120,000 字元輸入、100 筆變更。
超出時在呼叫 AI 前停止，請縮小日期／聊天室範圍。AI 執行最多 10 分鐘。
停止時若 LINE 正在讀取，需等待讀取器結束（單次最多約 120 秒）；已寫入的工作會保留。
模型失敗、來源不符或讀取不完整不會當成成功；有人工同時修改時保留新版並顯示略過數。

| 工具                 | 用途                                       |
| -------------------- | ------------------------------------------ |
| `get_line_status`    | LINE 相容性、執行狀態、存取開關            |
| `list_allowed_chats` | 列出已授權聊天室                           |
| `read_line_messages` | 依聊天室、日期讀取訊息分頁                 |
| `get_work_context`   | 讀取整理規則、現有工作與人工修正，支援分頁 |
| `upsert_work_item`   | 建立或更新本機工作，附上實際讀過的來源     |
| `update_work_rules`  | 使用者明確要求時，更新整理偏好             |

新來源必須在同一 MCP 連線實際讀過；伺服器自行保存引用片段，Agent 不能傳入
捏造原文。這只能驗證來源存在，無法保證模型對語意的判斷正確。
Agent 需要先讀現有工作，處理同一件事的後續更新；固定 `workKey` 讓重試不開新卡，
語意上的重複仍需 Agent 比對，或由使用者合併。

每張卡以 revision 檢查衝突，SQLite transaction 協調不同程序。
人工修改的欄位優先保留，Agent 收到 `blockedFields`；不會靜默覆蓋。
`get_work_context` 每張卡回傳最近 10 筆來源／變更紀錄及總數，完整紀錄在桌面查看。
每個本機工作庫上限 10,000 張卡，每卡上限 300 個來源。

## 資料與權限

資料預設存在 `%APPDATA%\LINE Agent Desktop\`：

- `settings.json`：聊天室授權與存取開關。
- `work.sqlite`：工作、整理規則、人工修正、變更紀錄與引用的來源片段。
  每則引用最多保存 1,500 字；沒有引用的原訊息不在本程式另外存檔。官方 CLI／AI 服務的記錄與資料處理由其設定與政策決定。
- `assistant/selection.json`：所選 AI 的本機識別碼，不包含登入憑證。
- `activity/`：最近 200 筆連線／讀取／權限操作中繼資料，不包含聊天原文。

訊息與工作讀寫都受聊天室和登入帳號綁定限制。暫停、撤銷授權或重新綁定帳號後，
Agent 無法讀寫不在授權範圍的工作。已儲存的工作仍可由使用者在桌面查看；撤銷授權
不會刪除歷史工作，也無法收回已交給其他 Agent 的內容。Agent 不能透過工具修改授權。

關閉桌面視窗會停止本工具啟動的 AI 工作，但不會取消授權，外部 Agent 仍可啟動 MCP。要停止請按「暫停所有存取」。
權限限制適用於本 MCP，不限制同一個作業系統使用者帳號下的其他程式。

- LINE 本機快取不等於完整伺服器歷史。每次最多查 31 天、500 筆，可用 cursor 分頁；日期採 Asia/Taipei。
- 只有本機索引可確認的聊天室能讀取；部分 LINE 介面中的對話可能找不到，沒有 GUI 備援。
- 未驗證的 LINE 版本會停止讀取，不能略過相容性或 DLL 檢查。
- 聊天原文是資料，不是 Agent 應服從的指令。
- 訊息提供給 Agent 後，依該模型／服務設定處理；本機工具不代表模型離線執行。
- 不傳送 LINE 訊息。草擬回覆可以交給 Agent，真正傳送尚未提供。

遇到問題請提供錯誤代碼、Windows／LINE 版本與重現步驟，
不要上傳真實訊息、設定檔、工作資料庫或帳號資料。

## 升級

關閉桌面工具及正在使用它的 MCP 連線，再執行新版 `.exe`，沿用原安裝位置。
程式檔案會更新，使用者資料與聊天室授權保留，重新連接 Agent 即可使用新版工具。
ZIP 是解壓縮版，不會更新已安裝的程式。解除安裝也保留使用者資料。

v0.2.0 升到 v0.3.0 沿用相同設定與工作資料庫，只新增 AI 選擇設定。
目前無自動更新服務。測試版尚未簽章，Windows 可能顯示「不明的發行者」。

## 開發與打包

開發使用 Node.js 24 LTS；準備發行環境還需要 Python 3。
工作儲存使用 Node 內建 [SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。

```bash
npm ci --ignore-scripts
npm test
npm run build
npm run dev
# http://127.0.0.1:5179/?demo       虛構的工作看板
# http://127.0.0.1:5179/?demo&fresh 空白設定流程
```

```bash
npx playwright install chromium
npm run test:ui
```

Windows 打包：

```powershell
py scripts/prepare-runtime.py
npm run package:win
py scripts/finalize-release.py
```

`prepare-runtime.py` 核對 `runtime-lock.json` 的版本與 SHA-256，
只寫入專案的 `.downloads/` 和 `runtime/`，不修改全域環境或排程。
已有 `runtime/` 時請先移到別處，腳本不覆寫現有目錄。
完整發行流程見 [RELEASING.md](docs/RELEASING.md)。

## 開源來源與授權

LINE 讀取來自 [bensonmaxai/line-desktop-mcp](https://github.com/bensonmaxai/line-desktop-mcp)，
源自 [dtwang/line-desktop-mcp](https://github.com/dtwang/line-desktop-mcp)。
本專案新增工作看板、日期視圖、任務寫回 MCP、人工修正保護、共同整理規則、
聊天室授權和可攜執行環境。

程式採 MIT；依賴保留原授權與署名，見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
社群工具，與 LINE 官方無關。

## 官方執行介面

- [Codex 非互動模式](https://learn.chatgpt.com/docs/non-interactive-mode)：沿用 CLI 登入、JSON 事件與結構化輸出。
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)：print、safe mode、stream-json 與 JSON schema。
- [Claude 訂閱與 Agent SDK](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)：`claude -p` 的訂閱額度說明。

偵測會檢查必要 CLI 旗標，舊版提示更新。已實測 Codex 0.165.0、Claude Code 2.1.314；
Windows 上的 Claude Code 2.0.69 正確顯示需要更新。不會代為升級或覆寫個人的 AI 設定。
