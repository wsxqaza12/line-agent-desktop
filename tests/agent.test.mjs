import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../core/settings.mjs';
import { LineService } from '../core/service.mjs';
import { WorkService } from '../core/work-service.mjs';
import { AgentRunner, readAgentEvent, classifyFailure, validateChanges } from '../core/agent-runner.mjs';
import { cleanEnvironment, runProcess, processSpec } from '../core/agent-process.mjs';
import { backend, chat, other } from './fixtures.mjs';

const sourceRef = 'message:' + '4'.repeat(24);
const proposed = () => ({
  summary: '整理完成',
  warnings: [],
  changes: [
    {
      id: null,
      expectedRevision: null,
      workKey: 'confirmed-delivery',
      chatRef: chat.chatRef,
      patch: { title: '確認交期', description: '整理交期後回覆', status: 'todo', owner: null, dueDate: null },
      sourceRefs: [sourceRef],
      reason: '使用者明確答應',
    },
  ],
});
async function fixture(t, execute, overrides = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'line-runner-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const store = new SettingsStore(home),
    line = new LineService(
      store,
      backend({
        read: async (s) => ({
          chatRef: s.expectedChatRef,
          ownSenderRef: s.expectedOwnSenderRef,
          messages: [
            {
              sourceRef,
              text: '我今天會整理交期後回覆。',
              date: '2026-10-31',
              time: '10:00',
              senderRef: chat.ownSenderRef,
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
        }),
        ...overrides,
      }),
    );
  await line.recent('');
  await line.saveChats([chat.chatRef, other.chatRef]);
  await line.setEnabled(true);
  const work = new WorkService(line);
  const runner = new AgentRunner(line, work, process.execPath, {
    discover: async () => ({
      targets: [{ id: 'test', provider: 'codex', command: process.execPath }],
      notes: [],
    }),
    probe: async () => ({ id: 'test', provider: 'codex', label: 'Codex', status: 'ready' }),
    execute,
  });
  await runner.initialize();
  await runner.scan();
  await runner.select('test');
  t.after(async () => {
    if (runner.busy) await runner.cancel();
  });
  return { line, work, runner, home };
}
function success(value = proposed()) {
  return async (_target, _args, options) => {
    options.onLine(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: JSON.stringify(value) },
      }),
    );
    options.onLine('{"type":"turn.completed"}');
    return { code: 0, stdout: '', stderr: '' };
  };
}
test('runner reads scoped evidence, writes real board, retries deduplicate and preserves selection', async (t) => {
  let input;
  const f = await fixture(t, async (...args) => {
    input = args[2].input;
    return success()(...args);
  });
  await f.runner.start({ days: 7, chatRef: chat.chatRef });
  await f.runner.pending;
  assert.equal(f.runner.job.state, 'completed');
  assert.equal(f.runner.job.added, 1);
  assert.equal(f.work.desktop().items[0].sources[0].text, '我今天會整理交期後回覆。');
  assert.ok(input.includes(chat.chatRef));
  assert.ok(!input.includes(other.chatRef));
  await f.runner.start({ days: 7, chatRef: chat.chatRef });
  await f.runner.pending;
  assert.equal(f.work.desktop().items.length, 1);
  assert.equal(f.runner.job.skipped, 1);
  assert.deepEqual(await fs.readdir(path.join(f.home, 'assistant')), ['selection.json']);
  await f.runner.initialize();
  assert.equal(f.runner.selectedId, 'test');
});
test('permission changes during model execution discard result', async (t) => {
  const f = await fixture(t, async (...args) => {
    await f.line.setEnabled(false);
    return success()(...args);
  });
  await f.runner.start({ days: 7, chatRef: chat.chatRef });
  await f.runner.pending;
  assert.equal(f.runner.job.error.code, 'ACCESS_CHANGED');
  assert.equal(f.work.desktop().items.length, 0);
});
test('nonzero exit, missing terminal event and malformed evidence never write', async (t) => {
  for (const mode of ['exit', 'terminal', 'evidence']) {
    const f = await fixture(t, async (...args) => {
      const value = proposed();
      if (mode === 'evidence') value.changes[0].sourceRefs = ['invented'];
      if (mode === 'terminal') return { code: 0, stdout: '', stderr: '' };
      const result = await success(value)(...args);
      if (mode === 'exit') result.code = 1;
      return result;
    });
    await f.runner.start({ days: 7, chatRef: chat.chatRef });
    await f.runner.pending;
    assert.equal(f.runner.job.state, 'failed');
    assert.equal(f.work.desktop().items.length, 0);
  }
});
test('cancellation waits for child completion and blocks overlapping runs', async (t) => {
  let started;
  const ready = new Promise((r) => {
    started = r;
  });
  const f = await fixture(t, async (_target, _args, options) => {
    started();
    return runProcess({ command: process.execPath }, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: os.tmpdir(),
      signal: options.signal,
    });
  });
  await f.runner.start({ days: 1, chatRef: chat.chatRef });
  await ready;
  await assert.rejects(f.runner.start({ days: 1 }), { code: 'BUSY' });
  await f.runner.cancel();
  assert.equal(f.runner.busy, false);
  assert.equal(f.runner.job.state, 'cancelled');
  assert.equal(f.work.desktop().items.length, 0);
});
test('human edits made during inference survive and stale AI update is reported', async (t) => {
  const f = await fixture(t, success());
  await f.runner.start({ days: 1, chatRef: chat.chatRef });
  await f.runner.pending;
  const old = f.work.desktop().items[0];
  f.runner.execute = async (...args) => {
    f.work.edit({ id: old.id, expectedRevision: old.revision, patch: { title: '人工決定的工作名稱' } });
    const value = proposed();
    Object.assign(value.changes[0], { id: old.id, expectedRevision: old.revision, workKey: null });
    return success(value)(...args);
  };
  await f.runner.start({ days: 1, chatRef: chat.chatRef });
  await f.runner.pending;
  assert.equal(f.work.desktop().items[0].title, '人工決定的工作名稱');
  assert.equal(f.runner.job.skipped, 1);
  assert.equal(f.runner.job.warnings.length, 1);
});
test('oversized/incomplete reads do not reach AI', async (t) => {
  let called = false;
  const f = await fixture(
    t,
    async () => {
      called = true;
    },
    {
      read: async (s) => ({
        chatRef: s.expectedChatRef,
        ownSenderRef: s.expectedOwnSenderRef,
        messages: [
          {
            sourceRef,
            text: '大'.repeat(120001),
            date: '2026-10-31',
            time: '10:00',
            senderRef: chat.ownSenderRef,
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      }),
    },
  );
  await f.runner.start({ days: 30, chatRef: chat.chatRef });
  await f.runner.pending;
  assert.equal(f.runner.job.error.code, 'AGENT_INPUT_LIMIT');
  assert.equal(called, false);
});
test('stream adapters require success and never expose reasoning as result', () => {
  const state = { events: 0 };
  readAgentEvent('codex', '{"type":"item.completed","item":{"type":"reasoning","text":"private"}}', state);
  assert.equal(state.answer, undefined);
  readAgentEvent(
    'claude',
    JSON.stringify({ type: 'result', subtype: 'success', structured_output: proposed() }),
    state,
  );
  assert.equal(state.completed, true);
  assert.deepEqual(state.answer, proposed());
  assert.equal(classifyFailure('usage limit reached'), 'AGENT_USAGE_LIMIT');
  assert.equal(classifyFailure('401 unauthorized'), 'AGENT_LOGIN_REQUIRED');
  assert.deepEqual(cleanEnvironment({ PATH: 'ok', ANTHROPIC_API_KEY: 'secret', CODEX_API_KEY: 'secret' }), {
    PATH: 'ok',
  });
});
test('scope gate rejects other-room changes and whole batch before writing', () => {
  const value = proposed(),
    input = { chats: [{ ...chat, messages: [{ sourceRef }] }], items: [] };
  value.changes.push({ ...value.changes[0], chatRef: other.chatRef });
  assert.throws(() => validateChanges(value, input), { code: 'AGENT_INVALID_OUTPUT' });
  const spec = processSpec(
    { distro: 'Ubuntu', command: '/home/a/cli' },
    ['a;$(touch nope)'],
    '/tmp/path with spaces',
  );
  assert.equal(spec.args.at(-1), 'a;$(touch nope)');
  assert.ok(!spec.args[6].includes('touch nope'));
});
test('process adapter decodes split UTF-8, enforces timeout and preserves exit status', async () => {
  const r = await runProcess({ command: process.execPath }, [
    '-e',
    'const b=Buffer.from("繁體中文\\n");process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.exitCode=7},20)',
  ]);
  assert.equal(r.stdout, '繁體中文\n');
  assert.equal(r.code, 7);
  await assert.rejects(
    runProcess({ command: process.execPath }, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 }),
    { code: 'AGENT_TIMEOUT' },
  );
});
