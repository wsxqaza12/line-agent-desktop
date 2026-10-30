import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Pause,
  Play,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { demoBridge } from './demo';
import type { Bridge, Chat, State, LineStatus, Result, Connection, Page } from './types';
import { Workbench } from './workbench';
import './style.css';
import './workbench.css';

const demo = !window.lineAgent && new URLSearchParams(location.search).has('demo');
const bridge: Bridge | undefined = window.lineAgent ?? (demo ? demoBridge : undefined);
const unwrap = async <T,>(promise: Promise<Result<T>>): Promise<T> => {
  const r = await promise;
  if (!r.ok) throw new Error(`${r.error.message} [${r.error.code}]`);
  return r.data;
};
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() + 8 * 3600000 - 6 * 86400000).toISOString().slice(0, 10);
const labels: Record<string, string> = {
  connection: '檢查 LINE 連線',
  permissions: '更新聊天室權限',
  resume: '開啟 Agent 存取',
  pause: '暫停 Agent 存取',
  read: '讀取聊天室',
  mcp_test: '測試 MCP 連線',
};
const nav = [
  { id: 'work', label: '工作看板', icon: LayoutDashboard },
  { id: 'rules', label: '整理偏好', icon: SlidersHorizontal },
  { id: 'chats', label: '聊天室權限', icon: MessagesSquare },
  { id: 'connect', label: '連接 Agent', icon: Plug },
  { id: 'settings', label: '狀態與說明', icon: Settings2 },
];

function App() {
  const [tab, setTab] = useState('work');
  const [state, setState] = useState<State | null>(null);
  const [line, setLine] = useState<LineStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [candidates, setCandidates] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [more, setMore] = useState(false);
  const [warnings, setWarnings] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [client, setClient] = useState('codex');
  const [host, setHost] = useState('windows');
  const [mcpTested, setMcpTested] = useState(false);
  const [previewChat, setPreviewChat] = useState<Chat | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [from, setFrom] = useState(weekAgo());
  const [to, setTo] = useState(today());
  const reload = async () => {
    if (bridge) {
      const s = await unwrap(bridge.state());
      setState(s);
      setSelected(s.settings.chats.map((c) => c.chatRef));
    }
  };
  useEffect(() => {
    reload().catch((e) => setNotice({ text: e.message, error: true }));
  }, []);
  useEffect(
    () => bridge?.onClosing?.(() => setNotice({ text: '讀取仍在進行，完成清理後會自動關閉視窗。' })),
    [],
  );
  async function run(key: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      await task();
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy('');
    }
  }
  async function check() {
    await run('status', async () => {
      setLine(null);
      const s = await unwrap(bridge!.status());
      setLine(s);
      await reload();
      if (!s.running) setNotice({ text: '請先開啟電腦版 LINE 並登入，再檢查一次。', error: true });
    });
  }
  async function search() {
    await run('search', async () => {
      const r = await unwrap(bridge!.recent(query));
      setCandidates((old) => [
        ...new Map(
          [...old.filter((c) => selected.includes(c.chatRef)), ...r.chats].map((c) => [c.chatRef, c]),
        ).values(),
      ]);
      setSearched(true);
      setMore(r.hasMore);
      setWarnings(r.warnings.length > 0);
    });
  }
  async function save() {
    await run('save', async () => {
      await unwrap(bridge!.saveChats(selected));
      await reload();
      setNotice({ text: '聊天室權限已儲存。' });
    });
  }
  async function toggle() {
    await run('toggle', async () => {
      await unwrap(bridge!.setEnabled(!state?.settings.enabled));
      await reload();
    });
  }
  async function connect() {
    setTab('connect');
    if (!connection) await run('config', async () => setConnection(await unwrap(bridge!.connection())));
  }
  async function copy(text: string) {
    await run('copy', async () => {
      await unwrap(bridge!.copy(text));
      setNotice({ text: '已複製，可以貼到你的 Agent。' });
    });
  }
  async function read(chat: Chat, cursor?: string) {
    await run('read', async () => {
      setPreviewChat(chat);
      const p = await unwrap(
        bridge!.read({
          chatRef: chat.chatRef,
          dateFrom: from,
          dateTo: to,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        }),
      );
      setPage(p);
      await reload();
    });
  }
  const enabled = state?.settings.enabled ?? false;
  const allowed = state?.settings.chats ?? [];
  const ready = !!line?.running;
  const step = !ready ? 0 : !allowed.length ? 1 : 2;
  const available = !!bridge && !!state;
  const allChats = [...new Map([...candidates, ...allowed].map((c) => [c.chatRef, c])).values()];
  const configText = connection
    ? client === 'codex'
      ? host === 'wsl'
        ? connection.codexWsl
        : connection.codex
      : connection.json
    : '';
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify(allowed.map((c) => c.chatRef).sort());
  const buttonIcon = (key: string, Icon = ArrowRight) =>
    busy === key ? <LoaderCircle size={17} className="spin" /> : <Icon size={17} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <MessagesSquare size={23} strokeWidth={2.2} />
          </div>
          <div>
            LINE Agent<span>DESKTOP</span>
          </div>
        </div>
        <div className="workspace-label">你的本機工作空間</div>
        <nav aria-label="主要導覽">
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              aria-current={tab === n.id ? 'page' : undefined}
              className={`nav-item ${tab === n.id ? 'active' : ''}`}
              onClick={() => (n.id === 'connect' && available ? connect() : setTab(n.id))}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === 'chats' && allowed.length > 0 && <b>{allowed.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={20} />
            <div>
              <strong>工作留在你的電腦</strong>
              <p>讓自己的 Agent 幫忙整理</p>
            </div>
          </div>
          <div className="version">
            <span className="dot" /> Windows · v0.2.0 <span>PREVIEW</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            工作空間 <ChevronRight size={14} /> {nav.find((n) => n.id === tab)?.label}
          </span>
          <div className={`status-pill ${enabled ? 'green' : ''}`}>
            <span className="dot" />
            {enabled ? 'Agent 存取已開啟' : 'Agent 存取已暫停'}
          </div>
        </header>
        {demo && (
          <div className="demo-banner">介面展示模式 · 所有聊天室與訊息皆為虛構，沒有連接你的 LINE。</div>
        )}
        {!bridge && (
          <div className="notice error">請使用 Windows 桌面程式開啟。瀏覽器展示可在網址加上 ?demo。</div>
        )}
        {notice && (
          <div
            className={`notice ${notice.error ? 'error' : 'success'}`}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}
            <span>{notice.text}</span>
            <button aria-label="關閉通知" onClick={() => setNotice(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="content">
          {(tab === 'work' || tab === 'rules') && (
            <Workbench
              key={tab}
              bridge={bridge}
              chats={allowed}
              enabled={enabled}
              rulesOnly={tab === 'rules'}
              onChats={() => setTab('chats')}
              onConnect={connect}
            />
          )}

          {tab === 'chats' && (
            <>
              <div className="heading row">
                <div>
                  <div className="eyebrow">CHAT ACCESS</div>
                  <h1>助理能看什麼，由你選。</h1>
                  <p>只讀取已授權的聊天室，保留對話的時間與出處。</p>
                </div>
                <button
                  className={`button ${enabled ? 'secondary' : 'primary'}`}
                  disabled={!available || !!busy || !allowed.length}
                  onClick={toggle}
                >
                  {buttonIcon('toggle', enabled ? Pause : Play)}
                  {enabled ? '暫停所有存取' : '開啟 Agent 存取'}
                </button>
              </div>
              <div className="scope-bar">
                <ShieldCheck size={20} />
                <div>
                  <strong>{enabled ? '已開啟所選聊天室的存取' : '目前已暫停 Agent 存取'}</strong>
                  <span>
                    {allowed.length
                      ? `${allowed.length} 個聊天室已儲存。變更權限會在每次讀取時檢查。`
                      : '先選擇聊天室、儲存權限，再開啟存取。'}
                  </span>
                </div>
              </div>
              <section className="panel chat-panel">
                <div className="search-row">
                  <div className="search-input">
                    <Search size={18} />
                    <input
                      aria-label="搜尋聊天室"
                      placeholder="搜尋聊天室或聯絡人名稱…"
                      value={query}
                      maxLength={100}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && available && !busy) search();
                      }}
                    />
                  </div>
                  <button className="button secondary" disabled={!available || !!busy} onClick={search}>
                    {buttonIcon('search', RefreshCw)}
                    {searched ? '重新搜尋' : '載入聊天室'}
                  </button>
                </div>
                <div className="list-caption">
                  <span>最近 30 天的本機聊天室 · 每次最多 50 個</span>
                  <span>已勾選 {selected.length} 個</span>
                </div>
                <div className="chat-list">
                  {allChats.length === 0 ? (
                    <div className="large-empty">
                      <MessagesSquare size={36} />
                      <h3>{searched ? '這次搜尋沒有找到聊天室' : '從你的聊天室開始'}</h3>
                      <p>
                        {searched
                          ? '請試試完整名稱，或到 LINE 確認對話已同步。'
                          : '按「載入聊天室」查看名稱清單，這一步不讀取訊息內容。'}
                      </p>
                    </div>
                  ) : (
                    allChats.map((c) => (
                      <div
                        className={`chat-row ${selected.includes(c.chatRef) ? 'selected' : ''}`}
                        key={c.chatRef}
                      >
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`授權 ${c.chatName}`}
                            checked={selected.includes(c.chatRef)}
                            disabled={!!busy}
                            onChange={(e) =>
                              setSelected((old) =>
                                e.target.checked ? [...old, c.chatRef] : old.filter((r) => r !== c.chatRef),
                              )
                            }
                          />
                          <div className={`avatar ${c.chatType}`}>
                            {c.chatType === 'group' ? <Users size={20} /> : c.chatName.slice(0, 1)}
                          </div>
                          <div className="chat-info">
                            <strong>{c.chatName}</strong>
                            <span>
                              {c.chatType === 'group' ? '群組' : '個人對話'}
                              {c.lastMessageAt &&
                                ` · ${new Date(c.lastMessageAt).toLocaleDateString('zh-TW')}`}
                            </span>
                          </div>
                        </label>
                        {allowed.some((a) => a.chatRef === c.chatRef) && (
                          <button
                            className="text-button"
                            disabled={!enabled || !!busy}
                            onClick={() => {
                              setPreviewChat(c);
                              setPage(null);
                            }}
                          >
                            讀取測試 <ChevronRight size={15} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {(more || warnings) && (
                  <div className="list-note">
                    {more && '還有更多結果，請輸入名稱縮小搜尋範圍。'}
                    {warnings && '部分聊天室的本機身分無法確認，因此未列入。'}
                  </div>
                )}
                <div className="panel-footer">
                  <span>{dirty ? '有尚未儲存的變更' : '只有儲存的聊天室能提供給 Agent'}</span>
                  <button className="button primary" disabled={!dirty || !!busy} onClick={save}>
                    {buttonIcon('save', Check)}儲存聊天室權限
                  </button>
                </div>
              </section>
              <p className="help-line">
                <CircleHelp size={16} /> 找不到聊天室？目前只列出本機索引可確認的對話；不會自動操作 LINE
                視窗或猜測同名對象。
              </p>
            </>
          )}

          {tab === 'connect' && (
            <>
              <div className="heading">
                <div className="eyebrow">BRING YOUR OWN AGENT</div>
                <h1>接上你習慣的助理。</h1>
                <p>設定一次，之後直接叫 Agent 整理 LINE 工作看板。</p>
              </div>
              <div className="client-tabs" role="tablist" aria-label="選擇 Agent">
                {[
                  { id: 'codex', name: 'Codex', icon: Terminal },
                  { id: 'claude', name: 'Claude Desktop', icon: Sparkles },
                  { id: 'other', name: '其他 MCP 客戶端', icon: Plug },
                ].map((c) => (
                  <button
                    role="tab"
                    aria-selected={client === c.id}
                    className={client === c.id ? 'chosen' : ''}
                    key={c.id}
                    onClick={() => setClient(c.id)}
                  >
                    <c.icon size={20} />
                    {c.name}
                    {client === c.id && <CheckCircle2 size={17} />}
                  </button>
                ))}
              </div>
              <section className="panel connect-panel">
                <div className="numbered-title">
                  <span>1</span>
                  <div>
                    <h2>加入本機 MCP 設定</h2>
                    <p>
                      {client === 'codex'
                        ? `將下面區塊加入 ${host === 'wsl' ? 'WSL 家目錄' : 'Windows 使用者目錄'}下的 .codex/config.toml。`
                        : client === 'claude'
                          ? '在 Claude Desktop「設定 → 開發者 → 編輯設定」加入這個 MCP 伺服器。'
                          : '在支援本機 stdio MCP 的客戶端，加入以下伺服器設定。'}
                    </p>
                  </div>
                </div>
                {client === 'codex' && (
                  <div className="host-choice" role="group" aria-label="Codex 執行位置">
                    <span>Codex 執行在</span>
                    <button aria-pressed={host === 'windows'} onClick={() => setHost('windows')}>
                      Windows
                    </button>
                    <button aria-pressed={host === 'wsl'} onClick={() => setHost('wsl')}>
                      WSL
                    </button>
                  </div>
                )}
                <div className="code-header">
                  <span>{client === 'codex' ? 'config.toml' : 'MCP JSON'}</span>
                  <button disabled={!connection || !!busy} onClick={() => connection && copy(configText)}>
                    <Clipboard size={14} /> 複製設定
                  </button>
                </div>
                <pre className="code-block">{connection ? configText : '正在準備連線設定…'}</pre>
                <p className="small-note">
                  保留你原本的其他設定；同名伺服器請更新既有區塊。若 Codex 在 WSL
                  執行，請切換上方執行位置；需要啟用 WSL 的 Windows 程式互通，並使用預設 /mnt
                  磁碟掛載。關閉桌面視窗後，Agent 仍可依儲存的權限讀取；要停止請先按「暫停所有存取」。
                </p>
                <div className="numbered-title second">
                  <span>2</span>
                  <div>
                    <h2>測試連線，重新開啟 Agent</h2>
                    <p>測試會啟動 MCP 並核對工具清單，不讀取聊天訊息。</p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={!available || !!busy}
                    onClick={() =>
                      run('mcp', async () => {
                        const r = await unwrap(bridge!.testMcp());
                        setMcpTested(r.connected);
                        await reload();
                        setNotice({
                          text: '本機 MCP 連線成功。請在 Agent 重新載入設定後，確認已出現 6 個 LINE 與工作看板工具。',
                        });
                      })
                    }
                  >
                    {buttonIcon('mcp', mcpTested ? CheckCircle2 : Plug)}
                    {mcpTested ? '重新測試' : '測試 MCP 連線'}
                  </button>
                </div>
              </section>
              <section className="panel prompts">
                <h2>
                  <MessageCircle size={18} />
                  連接後，可以這樣問
                </h2>
                {[
                  '列出我已授權的 LINE 聊天室。',
                  '請用 LINE Agent Desktop 的 get_work_context 讀取規則與現有任務，再整理已授權聊天室最近七天的工作，用 upsert_work_item 寫回看板，保留人工修正並附上來源。',
                  '根據剛才的對話，幫我草擬一段回覆，先給我確認。',
                ].map((text) => (
                  <button key={text} onClick={() => copy(text)} disabled={!available || !!busy}>
                    <span>{text}</span>
                    <Clipboard size={16} />
                  </button>
                ))}
              </section>
              <p className="help-line">
                <ShieldCheck size={16} /> 工具在本機讀取；提供給 Agent
                的內容，會依你選用的模型與服務設定處理。可讀取 LINE、更新本機工作看板；不會傳送 LINE 訊息。
              </p>
            </>
          )}

          {tab === 'settings' && (
            <>
              <div className="heading row">
                <div>
                  <div className="eyebrow">STATUS & DETAILS</div>
                  <h1>知道現在發生什麼。</h1>
                  <p>連線狀態、授權範圍與操作紀錄，都在這裡。</p>
                </div>
                <button className="button secondary" disabled={!available || !!busy} onClick={check}>
                  {buttonIcon('status', RefreshCw)}重新檢查
                </button>
              </div>
              <section className="panel details">
                <h2>連線狀態</h2>
                <div>
                  <span>LINE 電腦版</span>
                  <strong>
                    {line ? (line.running ? `已執行 · ${line.version}` : '尚未執行') : '尚未檢查'}
                  </strong>
                </div>
                <div>
                  <span>Agent 訊息存取</span>
                  <strong className={enabled ? 'green-text' : ''}>
                    {enabled ? `已開啟 · ${allowed.length} 個聊天室` : '已暫停'}
                  </strong>
                </div>
                <div>
                  <span>背景排程 / 開機自啟</span>
                  <strong>未啟用</strong>
                </div>
                <div>
                  <span>訊息傳送</span>
                  <strong>尚未提供傳送功能</strong>
                </div>
                <div>
                  <span>本機執行環境</span>
                  <strong>
                    {state?.environment.components.every((c) => c.available) ? '已備妥' : '尚未備妥'}
                  </strong>
                </div>
              </section>
              <div className="bottom-grid">
                <section className="panel detail-copy">
                  <h2>資料存在哪裡？</h2>
                  <p>
                    聊天室授權、工作看板、整理規則與變更紀錄保存在本機。Agent 引用的來源會保存最多 1,500
                    字片段，未引用的訊息不另外存檔。暫停或撤銷授權會停止 Agent
                    存取，已保存的工作仍可由你查看。
                  </p>
                  <button
                    className="button secondary"
                    disabled={!available || !!busy}
                    onClick={() =>
                      run('folder', async () => {
                        await unwrap(bridge!.openSettings());
                      })
                    }
                  >
                    <FolderOpen size={16} />
                    開啟設定資料夾
                  </button>
                </section>
                <section className="panel detail-copy">
                  <h2>目前的讀取範圍</h2>
                  <p>
                    資料來自電腦版 LINE 的本機快取，可能不包含完整歷史。每次可查最多 31
                    天，更多訊息以分頁讀取。未驗證的 LINE 版本會停止讀取。
                  </p>
                  <span className="subtle">
                    基於 bensonmaxai/line-desktop-mcp v3.3.8
                    <br />
                    社群工具，與 LINE 官方無關。
                  </span>
                </section>
              </div>
              <section className="panel log-panel">
                <div className="panel-heading">
                  <h2>最近操作</h2>
                  <button
                    className="text-button"
                    disabled={!available || !!busy}
                    onClick={() => run('refresh', reload)}
                  >
                    <RefreshCw size={14} />
                    重新整理
                  </button>
                </div>
                {state?.activity.length ? (
                  state.activity.map((a) => (
                    <div className="log-row" key={a.id}>
                      <time>{new Date(a.at).toLocaleString('zh-TW')}</time>
                      <span>{labels[a.action] ?? a.action}</span>
                      <span className={a.outcome === 'success' ? 'green-text' : 'error-text'}>
                        {a.outcome === 'success' ? '完成' : (a.code ?? '未完成')}
                        {a.count !== undefined ? ` · ${a.count} 筆` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="subtle">尚無操作紀錄。這裡只記錄結果，不記錄聊天原文。</p>
                )}
              </section>
            </>
          )}
          <footer className="footer">
            <span>LINE Agent Desktop</span>
            <span>對話裡的工作，有地方接著做。</span>
            <ShieldCheck size={14} />
          </footer>
        </div>
      </main>
      {previewChat && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
            <div className="modal-header">
              <div>
                <span className="eyebrow">READ TEST</span>
                <h2 id="preview-title">{previewChat.chatName}</h2>
              </div>
              <button
                className="icon-button"
                disabled={!!busy}
                aria-label="關閉讀取測試"
                onClick={() => {
                  setPreviewChat(null);
                  setPage(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <p className="subtle">明確按下讀取後才查詢訊息，內容只顯示在這個視窗。</p>
            {notice?.error && (
              <div className="notice error" role="alert">
                {notice.text}
              </div>
            )}
            <div className="date-range">
              <label>
                開始日期
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(null);
                  }}
                  disabled={!!busy}
                />
              </label>
              <span>→</span>
              <label>
                結束日期
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(null);
                  }}
                  disabled={!!busy}
                />
              </label>
              <button
                className="button primary"
                disabled={!!busy || !enabled}
                onClick={() => read(previewChat)}
              >
                {buttonIcon('read', Search)}讀取訊息
              </button>
            </div>
            <div className="preview-body">
              {page ? (
                <>
                  {page.messages.length === 0 && (
                    <p className="subtle">這個日期範圍的本機快取沒有訊息，不能據此判定沒有對話。</p>
                  )}
                  {page.messages.map((m) => (
                    <article
                      className={`message-preview ${m.senderRef === page.ownSenderRef ? 'self' : ''}`}
                      key={m.sourceRef}
                    >
                      <div>
                        <strong>{m.senderRef === page.ownSenderRef ? '我' : '對方'}</strong>
                        <time>
                          {m.date} {m.time}
                        </time>
                      </div>
                      <p>{m.text || '［附件或非文字訊息］'}</p>
                      <code>{m.sourceRef}</code>
                    </article>
                  ))}
                  <div className="preview-end">
                    本頁 {page.count} 筆 · 本機快取 · Asia/Taipei
                    {page.pagination.hasMore && (
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() =>
                          page.pagination.nextCursor && read(previewChat, page.pagination.nextCursor)
                        }
                      >
                        讀取更早一頁 <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="large-empty">
                  <Search size={28} />
                  <p>選擇日期，測試這個聊天室的讀取。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
