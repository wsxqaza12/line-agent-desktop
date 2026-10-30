import { useEffect, useState } from 'react';
import { Check, RefreshCw, Square, Play, ArrowRight } from 'lucide-react';
import type { AssistantState, Bridge } from './types';
import './assistant.css';
const unwrap = <T,>(r: import('./types').Result<T>): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
};

const busyJob = (state: AssistantState | null) =>
  state?.job?.state === 'running' || state?.job?.state === 'stopping';
export function useAssistant(bridge?: Bridge) {
  const [state, setState] = useState<AssistantState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    bridge
      ?.assistant()
      .then(unwrap)
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const off = bridge?.onAssistantChanged?.((s) => {
      if (active) setState(s);
    });
    return () => {
      active = false;
      off?.();
    };
  }, [bridge]);
  async function act(fn: () => Promise<import('./types').Result<AssistantState>>) {
    setError('');
    try {
      setState(unwrap(await fn()));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return { state, error, act };
}

export function AssistantSetup({ bridge, onAdvanced }: { bridge?: Bridge; onAdvanced: () => void }) {
  const { state, error, act } = useAssistant(bridge);
  const [scanning, setScanning] = useState(false);
  const [choosing, setChoosing] = useState(false);
  async function scan() {
    setScanning(true);
    await act(() => bridge!.scanAssistants());
    setScanning(false);
  }
  useEffect(() => {
    bridge?.assistant().then((r) => {
      if (r.ok && !r.data.scanning && !busyJob(r.data)) void scan();
    });
  }, [bridge]);
  const working = busyJob(state);
  async function choose(provider: 'codex' | 'claude') {
    setChoosing(true);
    await act(() => bridge!.chooseAssistantFile(provider));
    setChoosing(false);
  }
  return (
    <section className="assistant-setup">
      <div className="work-heading">
        <div>
          <h1>AI 助理</h1>
          <p>選一次，之後在看板按下整理就能開始。</p>
        </div>
        <button
          className="button secondary"
          disabled={!bridge || scanning || state?.scanning || working || choosing}
          onClick={scan}
        >
          <RefreshCw size={16} className={scanning || state?.scanning ? 'spin' : ''} />
          {scanning || state?.scanning ? '正在偵測…' : '重新偵測'}
        </button>
      </div>
      <p className="assistant-intro">
        使用這台電腦已登入的 Codex 或 Claude Code。Windows 和 WSL 都能偵測，登入由原本的 AI 程式管理。
      </p>
      {state?.scanning && (
        <button className="text-button" onClick={() => act(() => bridge!.stopAssistantScan())}>
          停止偵測
        </button>
      )}
      {error && (
        <p className="work-error" role="alert">
          {error}
        </p>
      )}
      <div className="provider-list">
        {state?.providers.map((p) => (
          <article className={`provider-row ${state.selectedId === p.id ? 'selected' : ''}`} key={p.id}>
            <div className="provider-mark">{p.provider === 'codex' ? 'C' : '✳'}</div>
            <div className="provider-detail">
              <h2>
                {p.label} <span>{p.location}</span>
              </h2>
              <p>{p.detail}</p>
              <small>{[p.version, p.installation].filter(Boolean).join(' · ')}</small>
              {p.executable && <code className="provider-path">{p.executable}</code>}
              {p.manual && (
                <button
                  className="text-button"
                  disabled={working || state.scanning || choosing}
                  onClick={() => act(() => bridge!.removeManualAssistant(p.id))}
                >
                  移除手動設定
                </button>
              )}
            </div>
            <button
              className="button secondary"
              disabled={p.status !== 'ready' || working || state.scanning || choosing}
              onClick={() => act(() => bridge!.selectAssistant(p.id))}
            >
              {state.selectedId === p.id && p.status === 'ready' ? (
                <>
                  <Check size={16} />
                  已選用
                </>
              ) : p.status === 'ready' ? (
                '使用這個 AI'
              ) : p.status === 'login' ? (
                '需要登入'
              ) : p.status === 'update' ? (
                '需要更新'
              ) : p.status === 'missing' ? (
                '未找到'
              ) : (
                '尚未確認可用'
              )}
            </button>
          </article>
        ))}
      </div>
      {!scanning && !state?.scanning && state?.providers.length === 0 && (
        <div className="assistant-empty">
          <h2>尚未找到可用的 AI 程式</h2>
          <p>
            如果目前只使用 ChatGPT 或 Claude 網頁，請先安裝官方 Codex CLI 或 Claude
            Code，再用你的訂閱帳號登入。
          </p>
        </div>
      )}
      {state?.notes.map((note) => (
        <p className="small-note" key={note}>
          {note}
        </p>
      ))}
      <div className="assistant-manual">
        <h2>已安裝，卻沒找到？</h2>
        <p>可自行選擇 Codex 或 Claude Code 的程式檔。自訂安裝位置也能使用，選好後會記住並檢查登入。</p>
        <div className="manual-actions">
          <button
            className="button secondary"
            disabled={!bridge || working || scanning || state?.scanning || choosing}
            onClick={() => choose('codex')}
          >
            指定 Codex 位置
          </button>
          <button
            className="button secondary"
            disabled={!bridge || working || scanning || state?.scanning || choosing}
            onClick={() => choose('claude')}
          >
            指定 Claude Code 位置
          </button>
        </div>
        <p className="small-note">
          請選 CLI 的 .exe 或 JavaScript 入口；WSL 可從檔案選擇器的 Linux 資料夾選取。Claude Desktop
          的聊天視窗程式無法作為 CLI 使用。
        </p>
      </div>
      <details className="assistant-help">
        <summary>安裝、登入與使用額度</summary>
        <p>
          Codex：在終端執行 <code>npm install -g @openai/codex</code>，再執行 <code>codex login</code>。Claude
          Code：依官方安裝方式安裝後，執行 <code>claude auth login</code>。WSL 請在對應的 Linux
          環境操作。完成後按「重新偵測」。
        </p>
        <p>
          按下開始整理，所選聊天室的訊息、規則與相關工作會送到你選的 AI
          服務，使用原帳號的額度。本版要求訂閱登入；不會自動改用 API 金鑰或切換另一個 AI。
        </p>
        <p>每次使用獨立的整理工作，不會加入你正在進行的 Codex／Claude 對話。整理偏好在左側可自行修改。</p>
      </details>
      <button className="text-button advanced-link" onClick={onAdvanced}>
        進階設定 · 外部 Agent／MCP <ArrowRight size={15} />
      </button>
    </section>
  );
}

export function OrganizePanel({
  bridge,
  enabled,
  room,
  target,
  onConnect,
}: {
  bridge: Bridge;
  enabled: boolean;
  room: string;
  target: string;
  onConnect: () => void;
}) {
  const { state, error, act } = useAssistant(bridge);
  const [days, setDays] = useState('7'),
    [starting, setStarting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const running = busyJob(state),
    job = state?.job;
  const provider = state?.providers.find((p) => p.id === state.selectedId);
  useEffect(() => {
    bridge.assistant().then((r) => {
      if (r.ok && !r.data.providers.length && !r.data.scanning && !busyJob(r.data))
        void act(() => bridge.scanAssistants());
    });
  }, [bridge]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  async function start() {
    setStarting(true);
    await act(() =>
      bridge.startOrganizing({ days: Number(days), ...(room === 'all' ? {} : { chatRef: room }) }),
    );
    setStarting(false);
  }
  return (
    <div className="organize-body">
      <p className="organize-target">{target}</p>
      <div className="organize-choice">
        <label>
          整理範圍
          <select
            aria-label="整理天數"
            value={days}
            disabled={running || starting}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="1">今天</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
          </select>
        </label>
        <div>
          <span>使用的 AI</span>
          <strong>
            {provider?.label ?? '尚未選擇'}
            {provider ? ` · ${provider.location}` : ''}
          </strong>
          <button className="text-button" disabled={running || starting} onClick={onConnect}>
            {provider ? '更換 AI' : '選擇 AI 助理'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
      {state?.scanning && <p className="small-note">正在偵測這台電腦的 AI…</p>}
      {!enabled && <p className="work-error">請先在聊天室權限開啟 Agent 存取。</p>}
      {error && (
        <p className="work-error" role="alert">
          {error}
        </p>
      )}
      {job && (
        <div className={`run-progress ${job.state}`} role="status" aria-live="polite">
          <strong>
            {job.state === 'failed' ? '這次整理未完成' : job.state === 'cancelled' ? '已停止整理' : job.phase}
          </strong>
          <p>
            已讀 {job.messageCount} 則 · 新增 {job.added} 件 · 更新 {job.updated} 件
            {job.skipped ? ` · 保留 ${job.skipped} 件` : ''}
          </p>
          {running && (
            <small>
              已經過 {Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 1000))} 秒
              {job.events ? ` · 已收到 ${job.events} 次 AI 回應事件` : ''}
              。可先關閉此面板查看工作；關閉程式會停止整理。
            </small>
          )}
          {job.summary && <p className="run-summary">{job.summary}</p>}
          {job.error && <p>{job.error.message}</p>}
          {job.warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </div>
      )}
      {running ? (
        <button
          className="button secondary"
          disabled={job?.state === 'stopping'}
          onClick={() => act(() => bridge.stopOrganizing())}
        >
          <Square size={14} />
          {job?.state === 'stopping' ? '正在停止…' : '停止整理'}
        </button>
      ) : (
        <button
          className="button primary"
          disabled={!enabled || provider?.status !== 'ready' || state?.scanning || starting}
          onClick={start}
        >
          <Play size={15} />
          {starting ? '正在啟動…' : '開始整理'}
        </button>
      )}
      <p className="small-note">
        訊息會交給所選 AI 服務判讀，結果直接寫回看板，保留人工修正。只在你按下開始時執行。
      </p>
    </div>
  );
}
