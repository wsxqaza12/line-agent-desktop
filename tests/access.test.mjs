import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SettingsStore } from '../core/settings.mjs';
import { LineService, validateRead } from '../core/service.mjs';
import { chat, other, ownSenderRef, scope, backend } from './fixtures.mjs';

async function setup(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-agent-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new SettingsStore(dir),
    service = new LineService(store, backend(overrides));
  return { dir, store, service };
}
test('fresh installation is paused, with no implicit chat access', async (t) => {
  let reads = 0;
  const { service, store } = await setup(t, {
    read: async () => {
      reads++;
    },
  });
  assert.deepEqual((await store.read()).chats, []);
  await assert.rejects(service.read(scope), { code: 'ACCESS_PAUSED' });
  await assert.rejects(service.setEnabled(true), { code: 'NO_CHATS' });
  assert.equal(reads, 0);
});
test('only discovered identity-bound chats can be authorized', async (t) => {
  const { service, store } = await setup(t);
  await assert.rejects(service.saveChats([chat.chatRef]), { code: 'CHAT_NOT_ALLOWED' });
  await service.recent();
  await service.saveChats([chat.chatRef]);
  await service.setEnabled(true);
  assert.deepEqual((await store.read()).chats, [chat]);
  await assert.rejects(service.read({ ...scope, chatRef: other.chatRef }), { code: 'CHAT_NOT_ALLOWED' });
  assert.equal((await service.read(scope)).count, 1);
});
test('missing account identity cannot be granted access', async (t) => {
  const { service } = await setup(t, { recent: async () => ({ chats: [chat], ownSenderRef: null }) });
  await service.recent();
  await assert.rejects(service.saveChats([chat.chatRef]), { code: 'ACCOUNT_UNAVAILABLE' });
});
test('reader receives bound identity, limited scope and metadata only', async (t) => {
  let passed;
  const { service } = await setup(t, {
    read: async (s) => {
      passed = s;
      return backend().read(s);
    },
  });
  await service.recent();
  await service.saveChats([chat.chatRef]);
  await service.setEnabled(true);
  await service.read({ ...scope, limit: 25, query: 'feature' });
  assert.deepEqual(passed, {
    chatName: chat.chatName,
    chatType: 'direct',
    expectedChatRef: chat.chatRef,
    expectedOwnSenderRef: ownSenderRef,
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    messageLimit: 25,
    query: 'feature',
    mediaMode: 'metadata',
  });
});
test('revocation during an in-flight read suppresses the result', async (t) => {
  let begin, finish;
  const started = new Promise((r) => {
    begin = r;
  });
  const released = new Promise((r) => {
    finish = r;
  });
  const { service, store } = await setup(t, {
    read: async (s) => {
      begin();
      await released;
      return backend().read(s);
    },
  });
  await store.update({ enabled: true, chats: [chat] });
  const response = service.read(scope);
  await started;
  // A different process can revoke permissions through the same on-disk store.
  const otherStore = new SettingsStore(store.home);
  await otherStore.update({ enabled: false });
  finish();
  await assert.rejects(response, { code: 'ACCESS_CHANGED' });
});
test('chat/account mismatch is rejected even if an adapter returns success', async (t) => {
  const { service, store } = await setup(t, {
    read: async (s) => ({ ...(await backend().read(s)), ownSenderRef: 'sender:' + '9'.repeat(24) }),
  });
  await store.update({ enabled: true, chats: [chat] });
  await assert.rejects(service.read(scope), { code: 'CHAT_IDENTITY_CHANGED' });
});
test('corrupt settings fail closed and are never overwritten implicitly', async (t) => {
  const { service, store } = await setup(t);
  await fs.writeFile(store.file, '{broken');
  await assert.rejects(service.read(scope), { code: 'SETTINGS_INVALID' });
  await assert.rejects(store.update({ enabled: true }), { code: 'SETTINGS_INVALID' });
  assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
});
test('audit records contain neither message text nor chat names', async (t) => {
  const { service, store } = await setup(t);
  await store.update({ enabled: true, chats: [chat] });
  await service.read(scope);
  const log = JSON.stringify(await store.activity());
  assert.doesNotMatch(log, /confidential|Example customer|sourceRef/);
  assert.match(log, /"count":1/);
});
test('unsupported scopes are rejected before the reader starts', () => {
  const invalid = [
    { ...scope, dateFrom: '2026-02-30' },
    { ...scope, dateTo: '2026-11-01' },
    { ...scope, dateTo: '2026-09-30' },
    { ...scope, limit: 0 },
    { ...scope, limit: 501 },
    { ...scope, query: '' },
    { ...scope, cursor: '../../../x' },
    { ...scope, mediaMode: 'preview' },
    { ...scope, chatName: 'Private room' },
    { ...scope, expectedOwnSenderRef: ownSenderRef },
  ];
  for (const args of invalid) assert.throws(() => validateRead(args), { code: 'INVALID_ARGUMENT' });
  assert.equal(validateRead({ ...scope, dateTo: '2026-10-31' }).limit, 200);
});
test('removing the last chat also pauses access', async (t) => {
  const { service, store } = await setup(t);
  await store.update({ enabled: true, chats: [chat] });
  await service.saveChats([]);
  assert.equal((await store.read()).enabled, false);
});
test('discovery never invokes the message reader', async (t) => {
  const { service } = await setup(t, {
    read: async () => {
      throw new Error('must not read');
    },
  });
  assert.equal((await service.recent()).chats.length, 2);
});
test('users can select rooms across separate search results', async (t) => {
  const { service, store } = await setup(t, {
    recent: async (query) => ({ chats: [query === 'first' ? chat : other], ownSenderRef }),
  });
  await service.recent('first');
  await service.recent('second');
  await service.saveChats([chat.chatRef, other.chatRef]);
  assert.equal((await store.read()).chats.length, 2);
});
