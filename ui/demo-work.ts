import type { WorkSnapshot, WorkItem, WorkEdit, WorkMerge, WorkRules } from './types';

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const date = (offset: number) => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
const sample = [
  [
    '整理首頁改版的需求清單',
    'todo',
    '森野設計｜網站專案',
    '先彙整這輪的修改，再和設計師確認優先順序。',
    1,
    '我',
  ],
  ['確認下週訪談的時間', 'todo', 'Alex Chen', '週二或週四下午都可以，待確認大家的時段。', 3, '我'],
  [
    '寄出第二階段的報價',
    'todo',
    '森野設計｜網站專案',
    '把新增的會員功能獨立列出，讓客戶確認範圍。',
    null,
    '我',
  ],
  [
    '調整手機版的預約流程',
    'doing',
    '森野設計｜網站專案',
    '已確認操作順序，正在處理表單與確認畫面。',
    2,
    '我',
  ],
  ['準備產品訪談的問題', 'doing', 'Alex Chen', '聚焦第一次使用的卡點，整理五個主要問題。', 0, '我'],
  ['確認網站上線前的素材', 'done', '森野設計｜網站專案', '客戶已補齊圖片與文案，素材核對完成。', -1, '我'],
  [
    '評估加入深色模式',
    'review',
    '森野設計｜網站專案',
    '這是產品建議，還沒有確認是否納入這次範圍。',
    null,
    null,
  ],
  ['下次聚會聊聊社群合作', 'review', 'Alex Chen', '對方提出合作方向，尚未有明確的下一步。', null, null],
] as const;
let snapshot: WorkSnapshot = {
  rules: {
    text: '明確交辦給我的工作、我已答應的事情，列為待辦。\n產品建議與尚未決定的想法，先放待確認。\n閒聊不建立任務；別人的承諾不等於我的待辦。\n同一件工作的補充更新原卡；沒有期限或負責人的留空。\n保留人工修正；只有明確完成證據才標記已完成。',
    revision: 0,
    updatedAt: null,
  },
  items: sample.map(([title, status, chatName, description, offset, owner], i): WorkItem => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    workKey: `sample-${i + 1}`,
    title,
    status,
    chatName,
    description,
    owner,
    dueDate: offset === null ? null : date(offset),
    chatRef: 'chat:' + (chatName.startsWith('森野') ? '1' : '2').repeat(24),
    ownSenderRef: 'sender:' + '1'.repeat(24),
    revision: 1,
    createdAt: date(-1) + 'T01:10:00Z',
    updatedAt: today + 'T01:15:00Z',
    locks: [],
    mergedInto: null,
    sources: [
      {
        sourceRef: 'message:' + String(i + 2).repeat(24),
        date: date(-1),
        time: '09:40',
        senderRef: 'sender:' + '2'.repeat(24),
        text:
          i === 6 ? '晚上看有點刺眼，之後可以考慮加深色模式嗎？' : `【虛構展示訊息】${title}。${description}`,
        truncated: false,
      },
    ],
    history: [
      {
        at: today + 'T01:15:00Z',
        actor: 'agent',
        reason:
          status === 'review'
            ? '對話提出了方向，尚未明確交辦，先等待確認。'
            : '根據對話中的交辦與進度建立工作。',
        changes: { status: { from: 'review', to: status } },
        blockedFields: [],
      },
    ],
  })),
};
if (new URLSearchParams(location.search).has('fresh')) snapshot.items = [];
export function demoWork() {
  return structuredClone(snapshot);
}
export function demoEdit(args: WorkEdit) {
  const item = snapshot.items.find((i) => i.id === args.id)!;
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.patch))
    if (item[key as keyof WorkItem] !== value) {
      changes[key] = { from: item[key as keyof WorkItem], to: value };
      if (!item.locks.includes(key as keyof WorkEdit['patch']))
        item.locks.push(key as keyof WorkEdit['patch']);
    }
  Object.assign(item, args.patch);
  if (args.unlockFields) item.locks = item.locks.filter((f) => !args.unlockFields!.includes(f));
  item.revision++;
  item.updatedAt = new Date().toISOString();
  item.history.push({
    at: item.updatedAt,
    actor: 'human',
    reason: args.reason || '手動調整',
    changes,
    blockedFields: [],
  });
  return structuredClone(item);
}
export function demoMerge(args: WorkMerge) {
  const source = snapshot.items.find((i) => i.id === args.sourceId)!,
    target = snapshot.items.find((i) => i.id === args.targetId)!;
  source.mergedInto = target.id;
  source.status = 'dismissed';
  source.revision++;
  target.sources = [...new Map([...target.sources, ...source.sources].map((s) => [s.sourceRef, s])).values()];
  target.revision++;
  return structuredClone(target);
}
export function demoRules(args: { text: string; expectedRevision: number }): WorkRules {
  snapshot.rules = {
    text: args.text,
    revision: snapshot.rules.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  return structuredClone(snapshot.rules);
}
