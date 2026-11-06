import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Columns3,
  Inbox,
  Search,
  RefreshCw,
  Clipboard,
  X,
  ArrowRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  MessageSquare,
  LockKeyhole,
  GitMerge,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  Bridge,
  Chat,
  WorkItem,
  WorkStatus,
  WorkFields,
  WorkSnapshot,
  WorkRules,
  Result,
} from './types';
import './workbench.css';
import { OrganizePanel, useAssistant } from './assistant';

const unwrap = async <T,>(p: Promise<Result<T>>): Promise<T> => {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
};
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const statusNames: Record<WorkStatus, string> = {
  review: '待確認',
  todo: '待辦',
  doing: '進行中',
  done: '已完成',
  dismissed: '不列入待辦',
};
const fieldNames: Record<keyof WorkFields, string> = {
  title: '工作名稱',
  description: '內容',
  status: '狀態',
  owner: '負責人',
  dueDate: '期限',
};
const statusIcons = { review: CircleDashed, todo: Circle, doing: CircleDot, done: CircleCheck, dismissed: X };
const shortDate = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const dateTime = (s: string) =>
  new Date(s).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Native dialog provides focus trapping, Escape and focus restoration.
function Dialog({
  label,
  children,
  close,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`work-dialog ${wide ? 'wide' : ''}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-top">
        <strong>{label}</strong>
        <button className="icon-button" aria-label="關閉視窗" onClick={close}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Workbench({
  bridge,
  chats,
  enabled,
  onChats,
  onConnect,
  externalAgent = false,
  rulesOnly = false,
}: {
  bridge?: Bridge;
  chats: Chat[];
  enabled: boolean;
  onChats: () => void;
  onConnect: () => void;
  externalAgent?: boolean;
  rulesOnly?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null);
  const assistant = useAssistant(bridge);
  const [view, setView] = useState<'board' | 'date' | 'review' | 'dismissed'>('board');
  const [query, setQuery] = useState(''),
    [room, setRoom] = useState('all');
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [organize, setOrganize] = useState(false);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  async function reload() {
    if (bridge) setSnapshot(await unwrap(bridge.work()));
  }
  useEffect(() => {
    if (assistant.state?.job && ['completed', 'failed', 'cancelled'].includes(assistant.state.job.state))
      reload().catch((e) => setError(e.message));
  }, [assistant.state?.job?.state]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (bridge)
        unwrap(bridge.work())
          .then((s) => {
            if (alive) {
              setSnapshot(s);
              setError('');
            }
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
    };
    load();
    const off = bridge?.onWorkChanged?.(load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      off?.();
      window.removeEventListener('focus', load);
    };
  }, [bridge]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const all = snapshot?.items ?? [];
  const active = all.filter((i) => !i.mergedInto);
  const filtered = active.filter(
    (i) =>
      (room === 'all' || i.chatRef === room) &&
      `${i.title} ${i.description} ${i.chatName} ${i.owner ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const reviewCount = active.filter((i) => i.status === 'review').length;
  const rooms = [...new Map([...chats, ...all].map((c) => [c.chatRef, c.chatName])).entries()];
  const latest = all
    .map((i) => i.updatedAt)
    .sort()
    .at(-1);
  async function move(item: WorkItem, status: WorkStatus) {
    await run(async () => {
      await unwrap(
        bridge!.editWork({
          id: item.id,
          expectedRevision: item.revision,
          patch: { status },
          reason: '在看板調整進度',
        }),
      );
    });
  }
  function card(item: WorkItem) {
    const Icon = statusIcons[item.status];
    const overdue = item.dueDate && item.dueDate < today() && item.status !== 'done';
    return (
      <article
        className={`work-card ${item.status}`}
        key={item.id}
        draggable={!busy}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', item.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <button
          className="card-open"
          onClick={() => setSelected(item)}
          aria-label={`開啟工作：${item.title}`}
        >
          <span className="card-room">
            <MessageSquare size={12} />
            {item.chatName}
          </span>
          <h3>{item.title}</h3>
          {item.description && <p>{item.description}</p>}
          <span className="card-meta">
            <span className={overdue ? 'overdue' : ''}>
              <CalendarDays size={12} />
              {item.dueDate ? shortDate(item.dueDate) + (overdue ? ' 逾期' : '') : '未排日期'}
            </span>
            <span>{item.owner || '負責人待確認'}</span>
          </span>
        </button>
        <div className="card-bottom">
          <span>
            <Icon size={13} />
            {item.sources.length} 則來源{' '}
            {item.locks.length > 0 && <LockKeyhole size={12} aria-label="含人工修正" />}
          </span>
          <select
            aria-label={`狀態：${item.title}`}
            value={item.status}
            disabled={busy}
            onChange={(e) => move(item, e.target.value as WorkStatus)}
          >
            {Object.entries(statusNames).map(([value, name]) => (
              <option value={value} key={value}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </article>
    );
  }
  const dateItems = filtered.filter((i) => !['review', 'dismissed'].includes(i.status));
  const dateGroups = [
    ...new Set(dateItems.filter((i) => i.dueDate?.startsWith(month)).map((i) => i.dueDate!)),
  ].sort();
  const changeMonth = (delta: number) => {
    const d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(d.toISOString().slice(0, 7));
    setDay(null);
  };
  const firstDay = new Date(month + '-01T12:00:00Z').getUTCDay();
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();

  if (rulesOnly)
    return (
      <div className="work-area">
        <div className="work-heading">
          <div>
            <div className="work-kicker">整理偏好</div>
            <h1>讓助理知道你的做事方式</h1>
            <p>給 Agent 的共同規則。也可以直接跟 Agent 說要怎麼改。</p>
          </div>
        </div>
        {error && (
          <div role="alert" className="work-error">
            {error}
          </div>
        )}
        {snapshot && (
          <RulesEditor
            rules={snapshot.rules}
            save={(text, expectedRevision) =>
              run(async () => {
                await unwrap(bridge!.saveRules({ text, expectedRevision }));
              })
            }
            busy={busy}
          />
        )}
        <div className="rules-examples">
          <h2>從具體例子開始調整</h2>
          <p>「這個客戶提出的產品建議，先放待確認。」</p>
          <p>「只有我明確答應的工作，才把負責人設為我。」</p>
          <p>手動修改會保護那張卡的欄位；這裡的規則才會影響之後的整理。</p>
        </div>
      </div>
    );

  return (
    <div className="work-area">
      <div className="work-heading">
        <div>
          <div className="work-kicker">
            LINE WORKSPACE <span>/</span>{' '}
            {new Date().toLocaleDateString('zh-TW', {
              timeZone: 'Asia/Taipei',
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}
          </div>
          <h1>手上的事</h1>
          <p>
            {active.filter((i) => ['todo', 'doing'].includes(i.status)).length} 件工作進行中
            {latest ? ` · 最近更新 ${dateTime(latest)}` : ' · 從你在意的對話開始'}
          </p>
        </div>
        <div className="work-actions">
          <button
            className="icon-button"
            aria-label="更新工作看板"
            disabled={busy || !bridge}
            onClick={() => run(reload)}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="button primary"
            disabled={!bridge}
            onClick={() => (externalAgent ? onConnect() : setOrganize(true))}
          >
            {assistant.state?.job?.state === 'running' || assistant.state?.job?.state === 'stopping'
              ? '整理中 · 查看進度'
              : externalAgent
                ? '連接我的 Agent'
                : '請 Agent 整理'}{' '}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="work-error" role="alert">
          {error}
          <button className="text-button" onClick={() => run(reload)}>
            重新整理
          </button>
        </div>
      )}
      {(!chats.length || !enabled) && (
        <div className="workspace-access">
          <span className={`dot ${enabled ? '' : 'paused'}`} />
          <span>
            {!chats.length
              ? '先選擇助理可以讀取的聊天室，再請它整理工作。'
              : 'Agent 存取已暫停。你仍可查看、調整已儲存的工作。'}
          </span>
          <button className="text-button" onClick={onChats}>
            聊天室權限 <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="work-toolbar">
        <div className="work-tabs" role="tablist" aria-label="工作檢視">
          {(
            [
              { id: 'board', label: '看板', icon: Columns3 },
              { id: 'date', label: '日期', icon: CalendarDays },
              { id: 'review', label: '待確認', icon: Inbox },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={view === t.id}
              className={view === t.id ? 'selected' : ''}
              onClick={() => setView(t.id)}
            >
              <t.icon size={16} />
              {t.label}
              {t.id === 'review' && reviewCount > 0 && <b>{reviewCount}</b>}
            </button>
          ))}
        </div>
        <div className="work-filters">
          <label className="work-search">
            <Search size={15} />
            <input
              aria-label="搜尋工作"
              placeholder="搜尋工作…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select aria-label="篩選聊天室" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="all">所有聊天室</option>
            {rooms.map(([ref, name]) => (
              <option key={ref} value={ref}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!snapshot && !error && <div className="work-empty">正在載入工作…</div>}
      {snapshot && view === 'board' && (
        <div className="kanban">
          {(['todo', 'doing', 'done'] as const).map((status) => {
            const Icon = statusIcons[status],
              items = filtered.filter((i) => i.status === status);
            return (
              <section
                key={status}
                className={`kanban-column ${status}`}
                aria-label={statusNames[status]}
                onDragOver={(e) => {
                  if (!busy) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const item = active.find((i) => i.id === e.dataTransfer.getData('text/plain'));
                  if (item && item.status !== status && !busy) move(item, status);
                }}
              >
                <div className="column-title">
                  <Icon size={16} />
                  <h2>{statusNames[status]}</h2>
                  <span>{items.length}</span>
                </div>
                <div className="column-body">
                  {items.map(card)}
                  {items.length === 0 && (
                    <div className="column-empty">
                      {status === 'todo'
                        ? '下一件要做的事，會出現在這裡。'
                        : status === 'doing'
                          ? '開始處理時，把工作移到這裡。'
                          : '完成一件，就留下一個紀錄。'}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {snapshot && (view === 'review' || view === 'dismissed') && (
        <div className="review-view">
          <div className="review-intro">
            <Inbox size={20} />
            <div>
              <h2>{view === 'review' ? '這些事，等你做個決定。' : '已排除的事項'}</h2>
              <p>
                {view === 'review'
                  ? '接受後移到待辦；不需要處理的，標記「不列入待辦」。'
                  : '保留你的決定，避免 Agent 下一次又建立相同待辦。'}
              </p>
            </div>
          </div>
          <div className="review-grid">{filtered.filter((i) => i.status === view).map(card)}</div>
          {!filtered.some((i) => i.status === view) && (
            <div className="work-empty">
              {view === 'review' ? '目前沒有需要確認的工作。' : '目前沒有已排除的事項。'}
            </div>
          )}
        </div>
      )}
      {snapshot && view === 'date' && (
        <div className="date-layout">
          <div className="month-view">
            <div className="month-heading">
              <h2>{month.replace('-', ' 年 ')} 月</h2>
              <div>
                <button className="icon-button" aria-label="上一個月" onClick={() => changeMonth(-1)}>
                  <ChevronLeft size={17} />
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setMonth(today().slice(0, 7));
                    setDay(null);
                  }}
                >
                  本月
                </button>
                <button className="icon-button" aria-label="下一個月" onClick={() => changeMonth(1)}>
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
            <div className="calendar-grid">
              {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
                <div className="weekday" key={w}>
                  {w}
                </div>
              ))}
              {Array.from({ length: firstDay }, (_, i) => (
                <div className="calendar-spacer" key={`empty-${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`,
                  due = dateItems.filter((t) => t.dueDate === date);
                return (
                  <button
                    key={date}
                    className={`calendar-day ${date === today() ? 'today' : ''} ${day === date ? 'chosen' : ''}`}
                    aria-label={`${date}，${due.length} 件工作`}
                    aria-pressed={day === date}
                    onClick={() => setDay(day === date ? null : date)}
                  >
                    <span>{i + 1}</span>
                    {due.slice(0, 2).map((t) => (
                      <small key={t.id} className={t.status}>
                        {t.title}
                      </small>
                    ))}
                    {due.length > 2 && <small>還有 {due.length - 2} 件</small>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="date-agenda">
            <h2>{day ? `${shortDate(day)} 的工作` : '本月期限'}</h2>
            {(day ? [day] : dateGroups).map((date) => (
              <section key={date}>
                <h3>{shortDate(date)}</h3>
                {dateItems.filter((i) => i.dueDate === date).map(card)}
              </section>
            ))}
            {!(day ? dateItems.some((i) => i.dueDate === day) : dateGroups.length) && (
              <p className="agenda-empty">這段時間沒有排定期限。</p>
            )}
            <section className="unscheduled">
              <h3>
                未排日期 <span>{dateItems.filter((i) => !i.dueDate).length}</span>
              </h3>
              {dateItems.filter((i) => !i.dueDate).map(card)}
              {!dateItems.some((i) => !i.dueDate) && <p className="agenda-empty">沒有未排日期的工作。</p>}
            </section>
          </div>
        </div>
      )}
      <div className="work-footnote">
        <span>
          <LockKeyhole size={12} />
          人工調整會保留，Agent 可補充來源。
        </span>
        <button className="text-button" onClick={() => setView(view === 'dismissed' ? 'board' : 'dismissed')}>
          {view === 'dismissed'
            ? '回到看板'
            : `已排除 ${active.filter((i) => i.status === 'dismissed').length} 件`}
        </button>
      </div>
      {selected && (
        <TaskEditor
          item={selected}
          all={all}
          bridge={bridge!}
          close={() => setSelected(null)}
          saved={reload}
        />
      )}
      {organize && (
        <OrganizeDialog
          bridge={bridge!}
          enabled={enabled}
          room={room}
          chats={chats}
          close={() => setOrganize(false)}
          onConnect={() => {
            setOrganize(false);
            onConnect();
          }}
        />
      )}
    </div>
  );
}

function RulesEditor({
  rules,
  save,
  busy,
}: {
  rules: WorkRules;
  save: (text: string, revision: number) => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = useState(rules.text),
    [base, setBase] = useState(rules);
  useEffect(() => {
    if (rules.revision !== base.revision && (text === base.text || text === rules.text)) {
      setText(rules.text);
      setBase(rules);
    }
  }, [rules, text, base]);
  return (
    <section className="rules-editor">
      <label htmlFor="work-rules">
        <SlidersHorizontal size={17} />
        我的整理規則
      </label>
      {rules.revision !== base.revision && (
        <div className="work-error">
          其他 Agent 剛更新了規則，你的編輯仍保留在下方。
          <button
            className="text-button"
            onClick={() => {
              setBase(rules);
              setText(rules.text);
            }}
          >
            載入最新規則（捨棄本次編輯）
          </button>
        </div>
      )}
      <textarea
        id="work-rules"
        value={text}
        maxLength={12000}
        onChange={(e) => setText(e.target.value)}
        rows={12}
      />
      <div>
        <span>{rules.updatedAt ? `已儲存 ${dateTime(rules.updatedAt)}` : '目前使用基礎規則'}</span>
        <button
          className="button primary"
          disabled={busy || !text.trim() || text === rules.text}
          onClick={() => save(text, base.revision)}
        >
          儲存規則
        </button>
      </div>
    </section>
  );
}

function OrganizeDialog({
  bridge,
  enabled,
  room,
  chats,
  close,
  onConnect,
}: {
  bridge: Bridge;
  enabled: boolean;
  room: string;
  chats: Chat[];
  close: () => void;
  onConnect: () => void;
}) {
  const target =
    room === 'all' ? '所有已授權聊天室' : (chats.find((c) => c.chatRef === room)?.chatName ?? '所選聊天室');
  return (
    <Dialog label="整理 LINE 工作" close={close}>
      <OrganizePanel bridge={bridge} enabled={enabled} room={room} target={target} onConnect={onConnect} />
    </Dialog>
  );
}

function TaskEditor({
  item,
  all,
  bridge,
  close,
  saved,
}: {
  item: WorkItem;
  all: WorkItem[];
  bridge: Bridge;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(item);
  const [draft, setDraft] = useState<WorkFields>({
    title: item.title,
    description: item.description,
    status: item.status,
    owner: item.owner,
    dueDate: item.dueDate,
  });
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mergeId, setMergeId] = useState('');
  const [section, setSection] = useState<'sources' | 'history'>('sources');
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await run(async () => {
      const patch: Partial<WorkFields> = Object.fromEntries(
        Object.entries(draft).filter(([k, v]) => current[k as keyof WorkFields] !== v),
      );
      const next = await unwrap(
        bridge.editWork({
          id: current.id,
          expectedRevision: current.revision,
          patch,
          reason: reason || '手動調整',
        }),
      );
      setCurrent(next);
      setReason('');
      close();
    });
  }
  const dirty = Object.entries(draft).some(([k, v]) => current[k as keyof WorkFields] !== v);
  const mergeChoices = all.filter(
    (i) =>
      i.id !== current.id &&
      !i.mergedInto &&
      i.chatRef === current.chatRef &&
      i.ownSenderRef === current.ownSenderRef &&
      i.status !== 'dismissed',
  );
  const refresh = async () => {
    const s = await unwrap(bridge.work());
    const next = s.items.find((i) => i.id === current.id);
    if (next) {
      setCurrent(next);
      setDraft({
        title: next.title,
        description: next.description,
        status: next.status,
        owner: next.owner,
        dueDate: next.dueDate,
      });
    }
  };
  return (
    <Dialog
      label="工作詳情"
      wide
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="task-editor">
        <div className="task-form">
          <div className="editor-room">
            <MessageSquare size={14} />
            {current.chatName}
          </div>
          <label>
            工作名稱
            <input
              aria-label="工作名稱"
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            內容
            <textarea
              aria-label="工作內容"
              maxLength={4000}
              rows={4}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <div className="form-pair">
            <label>
              進度
              <select
                aria-label="工作進度"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as WorkStatus })}
              >
                {Object.entries(statusNames).map(([s, name]) => (
                  <option key={s} value={s}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              負責人
              <input
                aria-label="負責人"
                placeholder="尚未確認"
                value={draft.owner ?? ''}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value || null })}
              />
            </label>
          </div>
          <label>
            期限
            <input
              aria-label="工作期限"
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })}
            />
          </label>
          <label>
            這次修正的原因
            <input
              aria-label="修正原因"
              placeholder="例如：這只是建議，還沒答應要做"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {current.locks.length > 0 && (
            <div className="locked-fields">
              <LockKeyhole size={14} />
              <div>
                <p>人工保留：{current.locks.map((f) => fieldNames[f]).join('、')}</p>
                <button
                  className="text-button"
                  disabled={busy || dirty}
                  onClick={() =>
                    run(async () => {
                      setCurrent(
                        await unwrap(
                          bridge.editWork({
                            id: current.id,
                            expectedRevision: current.revision,
                            patch: {},
                            unlockFields: current.locks,
                            reason: '允許 Agent 再次更新這些欄位',
                          }),
                        ),
                      );
                    })
                  }
                >
                  允許 Agent 再次更新這些欄位
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="work-error" role="alert">
              {error}
              <button className="text-button" disabled={busy} onClick={() => run(refresh)}>
                載入最新版本（捨棄本次編輯）
              </button>
            </div>
          )}
          <div className="editor-save">
            <span>人工修改會優先保留</span>
            <button
              className="button primary"
              disabled={busy || !dirty || !draft.title.trim()}
              onClick={save}
            >
              儲存變更
            </button>
          </div>
          {mergeChoices.length > 0 && (
            <details className="merge-options">
              <summary>
                <GitMerge size={14} />
                合併重複工作
              </summary>
              <p>來源會併入目標卡，保留目標卡的內容、期限和進度。本卡會留下合併紀錄。</p>
              <select aria-label="合併到工作" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
                <option value="">選擇要保留的工作</option>
                {mergeChoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </select>
              <button
                className="button secondary"
                disabled={!mergeId || busy || dirty}
                onClick={() =>
                  run(async () => {
                    const target = mergeChoices.find((i) => i.id === mergeId)!;
                    await unwrap(
                      bridge.mergeWork({
                        sourceId: current.id,
                        sourceRevision: current.revision,
                        targetId: target.id,
                        targetRevision: target.revision,
                      }),
                    );
                    close();
                  })
                }
              >
                合併到這件工作
              </button>
            </details>
          )}
        </div>
        <div className="task-evidence">
          <div className="evidence-tabs" role="tablist" aria-label="工作依據">
            <button role="tab" aria-selected={section === 'sources'} onClick={() => setSection('sources')}>
              來源訊息 <b>{current.sources.length}</b>
            </button>
            <button role="tab" aria-selected={section === 'history'} onClick={() => setSection('history')}>
              變更紀錄
            </button>
          </div>
          {section === 'sources' ? (
            <>
              <p className="evidence-note">建立工作時保存的原文片段。</p>
              {current.sources.map((s) => (
                <blockquote key={s.sourceRef}>
                  <div>
                    <strong>{s.senderRef === current.ownSenderRef ? '我' : '對方'}</strong>
                    <time>
                      {s.date} {s.time}
                    </time>
                  </div>
                  <p>{s.text || '（非文字訊息）'}</p>
                  {s.truncated && <small>僅顯示前 1,500 字</small>}
                  <small className="source-id">{s.sourceRef}</small>
                </blockquote>
              ))}
            </>
          ) : (
            <div className="work-history">
              {[...current.history].reverse().map((h, i) => (
                <div key={i}>
                  <span>
                    {h.actor === 'human' ? '你的調整' : 'Agent 整理'} · {dateTime(h.at)}
                  </span>
                  <p>{h.reason}</p>
                  {Object.keys(h.changes)
                    .filter((k) => k in fieldNames)
                    .map((k) => {
                      const v = h.changes[k] as { from: unknown; to: unknown };
                      const show = (x: unknown) =>
                        k === 'status'
                          ? (statusNames[x as WorkStatus] ?? String(x))
                          : x === null || x === ''
                            ? '未設定'
                            : String(x);
                      return (
                        <small key={k}>
                          {fieldNames[k as keyof WorkFields]}：{show(v.from)} → {show(v.to)}
                        </small>
                      );
                    })}
                  {h.blockedFields.length > 0 && (
                    <small>
                      沿用人工設定：{h.blockedFields.map((f) => fieldNames[f as keyof WorkFields]).join('、')}
                    </small>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
