import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../core/mcp.mjs';
import { LineService } from '../core/service.mjs';
import { SettingsStore } from '../core/settings.mjs';
import { connectionConfig } from '../core/connection.mjs';
import { chat, other, scope, backend } from './fixtures.mjs';

test('real MCP exposes scoped reads and local work writes, with no sending', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-agent-mcp-'));
  const store = new SettingsStore(dir);
  await store.update({ enabled: true, chats: [chat] });
  const server = createMcpServer(new LineService(store, backend()));
  const client = new Client({ name: 'test', version: '1.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await server.connect(s);
  await client.connect(c);
  const list = await client.listTools();
  assert.deepEqual(
    list.tools.map((t) => t.name),
    [
      'get_line_status',
      'list_allowed_chats',
      'read_line_messages',
      'get_work_context',
      'upsert_work_item',
      'update_work_rules',
    ],
  );
  assert.equal(list.tools.find((t) => t.name === 'upsert_work_item').annotations.readOnlyHint, false);
  const allowed = await client.callTool({ name: 'list_allowed_chats', arguments: {} });
  assert.equal(JSON.parse(allowed.content[0].text).chats.length, 1);
  const denied = await client.callTool({
    name: 'read_line_messages',
    arguments: { ...scope, chatRef: other.chatRef },
  });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /CHAT_NOT_ALLOWED/);
  const read = await client.callTool({ name: 'read_line_messages', arguments: scope });
  assert.equal(JSON.parse(read.content[0].text).count, 1);
  const saved = await client.callTool({
    name: 'upsert_work_item',
    arguments: {
      chatRef: chat.chatRef,
      workKey: 'synthetic-request',
      patch: { title: 'A synthetic task', status: 'review' },
      sourceRefs: ['message:' + '4'.repeat(24)],
      reason: 'Test request needs confirmation',
    },
  });
  assert.equal(saved.isError, undefined);
  const task = JSON.parse(saved.content[0].text).item;
  assert.equal(task.title, 'A synthetic task');
  const context = await client.callTool({ name: 'get_work_context', arguments: {} });
  assert.equal(JSON.parse(context.content[0].text).items[0].id, task.id);
  const send = await client.callTool({ name: 'send_message', arguments: {} });
  assert.equal(send.isError, true);
  await store.update({ enabled: false });
  const paused = await client.callTool({ name: 'list_allowed_chats', arguments: {} });
  assert.match(paused.content[0].text, /ACCESS_PAUSED/);
  const pausedWork = await client.callTool({ name: 'get_work_context', arguments: {} });
  assert.match(pausedWork.content[0].text, /ACCESS_PAUSED/);
});
test('configuration serializes spaces, quotes and backslashes without shell execution', () => {
  const root = String.raw`C:\Users\Example User\LINE Agent`;
  const bridge = String.raw`C:\App "test"\bridge.cjs`;
  const home = String.raw`C:\Users\Example User\AppData\Roaming\LINE Agent Desktop`;
  const config = connectionConfig(root, bridge, home, 'win32');
  const args = [bridge, '--runtime-root', root, '--data-home', home];
  assert.deepEqual(JSON.parse(config.json).mcpServers.line_agent_desktop.args, args);
  assert.ok(config.codex.includes(`args = ${JSON.stringify(args)}`));
  assert.ok(config.codexWsl.includes('command = "/mnt/c/Users/Example User/LINE Agent/node/node.exe"'));
  assert.ok(config.codexWsl.includes(`args = ${JSON.stringify(args)}`));
});
