import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { parseMacRows, macChatRef } from '../core/mac-messages.mjs';
import { MacBackend } from '../core/mac-backend.mjs';
import { startMacBridge, callMacBridge } from '../core/mac-ipc.mjs';
import { SettingsStore } from '../core/settings.mjs';
import { LineService } from '../core/service.mjs';
import { connectionConfig } from '../core/connection.mjs';

const own = 'sender:' + '1'.repeat(24),
  session = 'session:' + '2'.repeat(24);
const chat = { chatName: 'Example, customer', chatType: 'group', ownSenderRef: own, sessionRef: session };
chat.chatRef = macChatRef(own, chat.chatName, chat.chatType);
const rows = [
  'unknown date, 上午 9:00',
  '2026年11月5日',
  'Alex, Please add dark mode, 上午 9:05',
  'I will check, 下午 12:05, 已讀 3',
  '2026年11月6日',
  'Alex, No need to rush, 上午 12:01',
  'a sticker without a date',
];
const scope = {
  expectedChatRef: chat.chatRef,
  expectedOwnSenderRef: own,
  expectedSessionRef: session,
  chatName: chat.chatName,
  chatType: chat.chatType,
  dateFrom: '2026-11-05',
  dateTo: '2026-11-06',
  messageLimit: 1,
};
function adapter() {
  let reads = 0,
    identity = { ownSenderRef: own, sessionRef: session };
  const backend = new MacBackend('/unused', {
    desktop: true,
    execute: async (method) => {
      if (method === 'session') return identity;
      reads++;
      return { ...identity, rows, timeZone: 'Asia/Taipei', checkedAt: '2026-11-06T12:00:00Z' };
    },
  });
  return {
    backend,
    count: () => reads,
    changeSession: () => {
      identity = { ...identity, sessionRef: 'session:' + '3'.repeat(24) };
    },
  };
}
test('Mac parsing requires explicit dates, keeps sender text, and does not guess identity', () => {
  const parsed = parseMacRows(rows, { ownSenderRef: own, chatRef: chat.chatRef, timeZone: 'Asia/Taipei' });
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.omitted, 2);
  assert.equal(parsed.messages[0].text, 'Alex, Please add dark mode');
  assert.equal(parsed.messages[0].senderIdentity, 'unverified');
  assert.notEqual(parsed.messages[0].senderRef, own);
  assert.equal(parsed.messages[1].senderRef, own);
  assert.equal(parsed.messages[1].time, '12:05');
  assert.equal(parsed.messages[2].time, '00:01');
  assert.equal(parsed.messages[2].date, '2026-11-06');
  assert.throws(() => parseMacRows(rows, { timeZone: 'America/New_York' }), {
    code: 'MAC_TIMEZONE_REQUIRED',
  });
});
test('message dates and fake receipt text cannot replace date headers or UI suffixes', () => {
  const parsed = parseMacRows(
    [
      '2026年2月30日',
      'X, invalid date, 上午 9:05',
      '2026年11月5日',
      'X, please use 2027年1月1日, 下午 3:00, 已讀 2, 上午 10:00',
    ],
    { ownSenderRef: own, chatRef: chat.chatRef, timeZone: 'Asia/Taipei' },
  );
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].date, '2026-11-05');
  assert.equal(parsed.messages[0].time, '10:00');
  assert.notEqual(parsed.messages[0].senderRef, own);
});
test('snapshot references distinguish identical messages and survive repeat reads', () => {
  const data = ['2026年11月5日', rows[2], rows[2]];
  const opts = { ownSenderRef: own, chatRef: chat.chatRef, timeZone: 'Asia/Taipei' };
  const a = parseMacRows(data, opts).messages,
    b = parseMacRows(data, opts).messages;
  assert.notEqual(a[0].sourceRef, a[1].sourceRef);
  assert.deepEqual(a, b);
});
test('Mac pagination stays inside its original snapshot, filters dates and always reports partial history', async () => {
  const { backend, count } = adapter();
  const a = await backend.read(scope);
  assert.equal(a.count, 1);
  assert.equal(a.coverage.complete, false);
  const b = await backend.read({ ...scope, cursor: a.pagination.nextCursor });
  assert.equal(b.messages[0].time, '12:05');
  assert.equal(count(), 1);
  const c = await backend.read({ ...scope, cursor: b.pagination.nextCursor });
  assert.equal(c.pagination.hasMore, false);
  assert.equal(count(), 1);
  await assert.rejects(backend.read({ ...scope, query: 'another', cursor: a.pagination.nextCursor }), {
    code: 'MAC_CURSOR_EXPIRED',
  });
  await assert.rejects(backend.read({ ...scope, expectedChatRef: 'chat:' + '9'.repeat(24) }), {
    code: 'CHAT_IDENTITY_CHANGED',
  });
  const filtered = await backend.read({ ...scope, dateTo: '2026-11-05', query: 'dark mode' });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.pagination.hasMore, false);
});
test('cached Mac pages reject a changed LINE session', async () => {
  const { backend, changeSession } = adapter();
  const a = await backend.read(scope);
  changeSession();
  await assert.rejects(backend.read({ ...scope, cursor: a.pagination.nextCursor }), {
    code: 'CHAT_ACCOUNT_CHANGED',
  });
});
test('session bindings persist and cannot be supplied through read arguments', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-mac-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new SettingsStore(dir);
  await store.update({ chats: [chat], enabled: true });
  assert.equal((await store.read()).chats[0].sessionRef, session);
  const { backend } = adapter();
  const service = new LineService(store, backend);
  await assert.rejects(
    service.read({
      chatRef: chat.chatRef,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      expectedSessionRef: session,
    }),
    { code: 'INVALID_ARGUMENT' },
  );
});
test('Mac MCP config uses bundled native Node with spaced paths intact', () => {
  const config = connectionConfig(
    '/Applications/LINE Agent Desktop.app/Contents/Resources/runtime',
    '/Applications/LINE Agent Desktop.app/Contents/Resources/bridge/mcp-server.cjs',
    '/Users/Example User/Library/Application Support/LINE Agent Desktop',
    'darwin',
  );
  assert.ok(config.entry.command.endsWith('/node/bin/node'));
  assert.equal(
    JSON.parse(config.json).mcpServers.line_agent_desktop.args.at(-1),
    '/Users/Example User/Library/Application Support/LINE Agent Desktop',
  );
});
test(
  'Mac local bridge enforces authentication, live permissions and the desktop service',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-mac-ipc-'));
    const store = new SettingsStore(dir),
      { backend, count } = adapter();
    const service = new LineService(store, backend);
    const close = await startMacBridge(dir, service);
    t.after(async () => {
      await close();
      await fs.rm(dir, { recursive: true, force: true });
    });
    const input = { chatRef: chat.chatRef, dateFrom: scope.dateFrom, dateTo: scope.dateTo, limit: 1 };
    await assert.rejects(callMacBridge(dir, 'read', input), { code: 'ACCESS_PAUSED' });
    assert.equal(count(), 0);
    const config = JSON.parse(await fs.readFile(path.join(dir, 'mac-bridge.json'), 'utf8'));
    const response = await new Promise((resolve, reject) => {
      const client = net.createConnection(config.socket);
      let text = '';
      client.on('error', reject);
      client.on('connect', () =>
        client.write(JSON.stringify({ token: '0'.repeat(64), method: 'read', args: input }) + '\n'),
      );
      client.on('data', (d) => (text += d));
      client.on('end', () => resolve(JSON.parse(text)));
    });
    assert.equal(response.ok, false);
    assert.equal(count(), 0);
    await store.update({ chats: [chat], enabled: true });
    const previousTemp = process.env.TMPDIR;
    try {
      process.env.TMPDIR = path.join(dir, 'different-client-temp');
      assert.equal((await callMacBridge(dir, 'read', input)).count, 1);
    } finally {
      if (previousTemp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTemp;
    }
    await store.update({ enabled: false });
    await assert.rejects(callMacBridge(dir, 'read', input), { code: 'ACCESS_PAUSED' });
  },
);
