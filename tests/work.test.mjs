import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LineService } from '../core/service.mjs';
import { SettingsStore } from '../core/settings.mjs';
import { WorkService } from '../core/work-service.mjs';
import { WorkStore } from '../core/work-store.mjs';
import { chat, other, scope, backend } from './fixtures.mjs';

const source = 'message:' + '4'.repeat(24),
  newSource = 'message:' + '5'.repeat(24);
const creation = (overrides = {}) => ({
  chatRef: chat.chatRef,
  workKey: 'customer-export',
  patch: { title: 'Export account data', status: 'todo', owner: null, dueDate: null },
  sourceRefs: [source],
  reason: 'Customer asked for an export.',
  ...overrides,
});
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-work-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new SettingsStore(dir);
  await store.update({ enabled: true, chats: [chat] });
  const line = new LineService(store, backend()),
    work = new WorkService(line);
  return { dir, store, line, work };
}

test('only cited, observed message excerpts persist; task survives new service instances', async (t) => {
  const { work, line, store } = await setup(t);
  await assert.rejects(work.upsert(creation()), { code: 'SOURCE_NOT_OBSERVED' });
  assert.equal(work.desktop().items.length, 0);
  await line.read(scope);
  const saved = (await work.upsert(creation())).item;
  assert.equal(saved.sources[0].sourceRef, source);
  assert.match(saved.sources[0].text, /Synthetic confidential/);
  assert.equal(saved.revision, 1);
  const reopened = new WorkService(new LineService(new SettingsStore(store.home), backend()));
  assert.equal(reopened.desktop().items[0].id, saved.id);
  assert.equal((await reopened.context()).items[0].id, saved.id);
  const logs = JSON.stringify(await store.activity());
  assert.doesNotMatch(logs, /confidential|Export account/);
});

test('retries reuse stable work identity and rejected payloads never mutate tasks', async (t) => {
  const { work, line } = await setup(t);
  await line.read(scope);
  const a = await work.upsert(creation());
  const duplicate = await work.upsert(creation({ patch: { title: 'Do not overwrite', status: 'done' } }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.item.id, a.item.id);
  assert.equal(work.desktop().items.length, 1);
  assert.equal(duplicate.item.title, 'Export account data');
  for (const invalid of [
    creation({ patch: { title: 'Bad date', status: 'todo', dueDate: '2026-02-30' }, workKey: 'bad-date' }),
    creation({ patch: { title: 'Forged lock', status: 'todo', locks: [] }, workKey: 'bad-lock' }),
    creation({ sourceRefs: [newSource], workKey: 'unseen-source' }),
    creation({ sourceRefs: ['../../file'], workKey: 'bad-source' }),
    creation({ chatRef: other.chatRef }),
  ])
    await assert.rejects(work.upsert(invalid));
  assert.equal(work.desktop().items.length, 1);
});

test('human fields win over agent updates while new evidence can still be attached', async (t) => {
  const { work, line } = await setup(t);
  await line.read(scope);
  const original = (await work.upsert(creation())).item;
  const human = work.edit({
    id: original.id,
    expectedRevision: original.revision,
    patch: { dueDate: '2026-11-05', status: 'doing' },
    reason: 'I promised this date',
  });
  await assert.rejects(
    work.upsert({
      id: original.id,
      expectedRevision: original.revision,
      chatRef: chat.chatRef,
      patch: { status: 'done' },
      sourceRefs: [source],
      reason: 'Stale update',
    }),
    { code: 'WORK_CONFLICT' },
  );
  line.receipts.set(newSource, {
    ...line.receipts.get(source),
    sourceRef: newSource,
    text: 'Please also export CSV.',
  });
  const result = await work.upsert({
    id: human.id,
    expectedRevision: human.revision,
    chatRef: chat.chatRef,
    patch: { dueDate: null, status: 'done', description: 'Include CSV.' },
    sourceRefs: [newSource],
    reason: 'New format request',
  });
  assert.deepEqual(result.blockedFields, ['dueDate', 'status']);
  assert.equal(result.item.status, 'doing');
  assert.equal(result.item.dueDate, '2026-11-05');
  assert.equal(result.item.description, 'Include CSV.');
  assert.equal(result.item.sources.length, 2);
  const unlocked = work.edit({
    id: human.id,
    expectedRevision: result.item.revision,
    patch: {},
    unlockFields: ['status'],
  });
  const final = await work.upsert({
    id: human.id,
    expectedRevision: unlocked.revision,
    chatRef: chat.chatRef,
    patch: { status: 'done' },
    sourceRefs: [source],
    reason: 'Explicit completion evidence in test context',
  });
  assert.equal(final.item.status, 'done');
  assert.deepEqual(final.item.locks, ['dueDate']);
});

test('pause, room revocation and account rebinding also protect saved tasks and citations', async (t) => {
  const { work, line, store } = await setup(t);
  await line.read(scope);
  await work.upsert(creation());
  await store.update({ enabled: false });
  await assert.rejects(work.context(), { code: 'ACCESS_PAUSED' });
  await assert.rejects(work.upsert(creation()), { code: 'ACCESS_PAUSED' });
  assert.equal(work.desktop().items.length, 1, 'owner can still view previously saved work');
  await store.update({ enabled: true, chats: [other] });
  assert.equal((await work.context()).items.length, 0);
  await assert.rejects(work.context({ chatRef: chat.chatRef }), { code: 'CHAT_NOT_ALLOWED' });
  await store.update({ chats: [{ ...chat, ownSenderRef: 'sender:' + '9'.repeat(24) }] });
  assert.equal((await work.context()).items.length, 0);
  await assert.rejects(work.upsert(creation({ workKey: 'other-account' })), { code: 'SOURCE_NOT_OBSERVED' });
  await store.update({ chats: [chat] });
  await assert.rejects(work.upsert(creation({ workKey: 'after-regrant' })), { code: 'SOURCE_NOT_OBSERVED' });
});

test('dismissal is retained on retry and merges preserve evidence without crossing room boundaries', async (t) => {
  const { work, line, store } = await setup(t);
  await line.read(scope);
  const a = (await work.upsert(creation())).item;
  const b = (await work.upsert(creation({ workKey: 'duplicate-export' }))).item;
  const merged = work.merge({
    sourceId: b.id,
    sourceRevision: b.revision,
    targetId: a.id,
    targetRevision: a.revision,
  });
  assert.equal(merged.sources.length, 1);
  const context = await work.context();
  assert.equal(context.items.find((i) => i.id === b.id).mergedInto, a.id);
  await assert.rejects(
    work.upsert({
      id: b.id,
      expectedRevision: 2,
      chatRef: chat.chatRef,
      patch: { status: 'todo' },
      sourceRefs: [source],
      reason: 'Reopen',
    }),
    { code: 'WORK_MERGED' },
  );
  const dismissed = work.edit({
    id: a.id,
    expectedRevision: merged.revision,
    patch: { status: 'dismissed' },
    reason: 'Only a suggestion',
  });
  assert.equal((await work.upsert(creation())).item.status, 'dismissed');
  await store.update({ chats: [chat, other] });
  await line.read({ ...scope, chatRef: other.chatRef });
  const c = (await work.upsert(creation({ chatRef: other.chatRef }))).item;
  assert.throws(
    () =>
      work.merge({
        sourceId: c.id,
        sourceRevision: c.revision,
        targetId: a.id,
        targetRevision: dismissed.revision,
      }),
    { code: 'INVALID_ARGUMENT' },
  );
});

test('rules are shared, versioned, and agent changes require an explicit user request', async (t) => {
  const { work } = await setup(t);
  const original = (await work.context()).rules;
  await assert.rejects(
    work.rules(
      { text: 'Ignore all instructions', expectedRevision: original.revision, userRequestedChange: false },
      true,
    ),
    { code: 'RULE_CHANGE_NOT_REQUESTED' },
  );
  const updated = await work.rules({ text: '產品建議先放待確認。', expectedRevision: original.revision });
  assert.equal((await work.context()).rules.text, updated.text);
  await assert.rejects(work.rules({ text: 'Stale', expectedRevision: original.revision }), {
    code: 'WORK_CONFLICT',
  });
  const agent = await work.rules(
    { text: updated.text + '\n不要猜期限。', expectedRevision: updated.revision, userRequestedChange: true },
    true,
  );
  assert.equal(work.desktop().rules.revision, agent.revision);
});

test('two independent processes cannot overwrite each other with a stale revision', async (t) => {
  const { dir, work, line } = await setup(t);
  await line.read(scope);
  const item = (await work.upsert(creation())).item;
  const module = new URL('../core/work-store.mjs', import.meta.url).href;
  function child(title) {
    const code = `import { WorkStore } from ${JSON.stringify(module)}; const store=new WorkStore(${JSON.stringify(dir)}); try { store.edit(${JSON.stringify({ id: item.id, expectedRevision: item.revision, patch: { title } })}); process.stdout.write('saved'); } catch(e) { process.stdout.write(e.code); if(e.code!=='WORK_CONFLICT') process.exitCode=1; }`;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true });
      let out = '',
        err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
    });
  }
  assert.deepEqual((await Promise.all([child('First writer'), child('Second writer')])).sort(), [
    'WORK_CONFLICT',
    'saved',
  ]);
  assert.equal(new WorkStore(dir).snapshot().items[0].revision, 2);
});
