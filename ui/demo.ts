import type { Bridge, Chat, Settings, Result } from './types';
import { demoWork, demoEdit, demoMerge, demoRules } from './demo-work';
const ownSenderRef = 'sender:' + '1'.repeat(24);
const names = ['森野設計｜網站專案', 'Alex Chen', '產品交流小聚', '週末的咖啡約', '讀書會・第二季'];
const chats: Chat[] = names.map((chatName, i) => ({
  chatName,
  chatRef: 'chat:' + String(i + 1).repeat(24),
  chatType: i === 1 ? 'direct' : 'group',
  ownSenderRef,
  lastMessageAt: new Date(Date.now() - i * 3600000).toISOString(),
}));
const fresh = new URLSearchParams(location.search).has('fresh');
let settings: Settings = {
  schemaVersion: 1,
  enabled: !fresh,
  chats: fresh ? [] : chats.slice(0, 2),
  revision: 'demo',
};
const ok = async <T>(data: T): Promise<Result<T>> => {
  await new Promise((r) => setTimeout(r, 180));
  return { ok: true, data: structuredClone(data) };
};
export const demoBridge: Bridge = {
  work: () => ok(demoWork()),
  editWork: (args) => ok(demoEdit(args)),
  mergeWork: (args) => ok(demoMerge(args)),
  saveRules: (args) => ok(demoRules(args)),
  state: () =>
    ok({
      settings,
      environment: {
        platform: 'win32',
        supported: true,
        components: ['node', 'python', 'reader', 'sqlite'].map((id) => ({ id, available: true })),
      },
      activity: [],
    }),
  status: () => ok({ verified: true, running: true, version: '26.5.0.3975', processState: 'running' }),
  recent: (query) =>
    ok({
      chats: chats.filter((c) => c.chatName.toLowerCase().includes(query.toLowerCase())),
      hasMore: false,
      warnings: [],
      checkedAt: new Date().toISOString(),
    }),
  saveChats: (refs) => {
    settings = {
      ...settings,
      chats: chats.filter((c) => refs.includes(c.chatRef)),
      enabled: refs.length > 0 && settings.enabled,
    };
    return ok(settings);
  },
  setEnabled: (enabled) => {
    settings = { ...settings, enabled };
    return ok(settings);
  },
  read: (args) =>
    ok({
      chatName: chats.find((c) => c.chatRef === args.chatRef)?.chatName ?? '',
      chatRef: args.chatRef,
      ownSenderRef,
      count: 2,
      messages: [
        {
          sourceRef: 'message:' + '2'.repeat(24),
          date: args.dateTo,
          time: '10:35',
          text: '可以在下週的版本加上深色模式嗎？目前晚上看有點刺眼。',
          senderRef: 'sender:' + '2'.repeat(24),
        },
        {
          sourceRef: 'message:' + '3'.repeat(24),
          date: args.dateTo,
          time: '10:42',
          text: '收到，我先記錄起來，確認排程後回覆。',
          senderRef: ownSenderRef,
        },
      ],
      pagination: { hasMore: false, nextCursor: null },
    }),
  connection: () =>
    ok({
      json: JSON.stringify(
        {
          mcpServers: {
            line_agent_desktop: {
              command: 'C:\\Apps\\LINE Agent Desktop\\resources\\runtime\\node\\node.exe',
              args: ['C:\\Apps\\LINE Agent Desktop\\resources\\bridge\\mcp-server.cjs'],
            },
          },
        },
        null,
        2,
      ),
      codex:
        '[mcp_servers.line_agent_desktop]\ncommand = "C:/Apps/LINE Agent Desktop/resources/runtime/node/node.exe"\nargs = ["C:/Apps/LINE Agent Desktop/resources/bridge/mcp-server.cjs"]',
      codexWsl:
        '[mcp_servers.line_agent_desktop]\ncommand = "/mnt/c/Apps/LINE Agent Desktop/resources/runtime/node/node.exe"\nargs = ["C:/Apps/LINE Agent Desktop/resources/bridge/mcp-server.cjs"]',
    }),
  testMcp: () =>
    ok({
      connected: true,
      tools: [
        'get_line_status',
        'list_allowed_chats',
        'read_line_messages',
        'get_work_context',
        'upsert_work_item',
        'update_work_rules',
      ],
      testedAt: new Date().toISOString(),
    }),
  copy: async (text) => {
    await navigator.clipboard?.writeText(text);
    return ok(true);
  },
  openSettings: () => ok(true),
};
