import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findNpmTarget,
  collectWindowsTargets,
  probeTarget,
  manualTarget,
  uniqueTargets,
  targetId,
} from '../core/agent-providers.mjs';
import {
  windowsSearchLocations,
  expandWindowsLocations,
  parseWslTargets,
  WSL_DISCOVERY_SCRIPT,
} from '../core/agent-locations.mjs';
import { runProcess } from '../core/agent-process.mjs';

async function installation(t, provider = 'claude') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'line npm 偵測 '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const name = provider === 'claude' ? '@anthropic-ai/claude-code' : '@openai/codex';
  const root = path.join(directory, 'node_modules', name);
  await fs.mkdir(root, { recursive: true });
  const manifest = async (bin, packageName = name) =>
    fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: packageName, bin }));
  const file = async (relative) => {
    const entry = path.join(root, relative);
    await fs.mkdir(path.dirname(entry), { recursive: true });
    await fs.writeFile(entry, 'test fixture');
    return entry;
  };
  return { directory, root, manifest, file };
}

test('Windows npm Claude remains discoverable after cli.js changes to bin/claude.exe', async (t) => {
  const f = await installation(t);
  const legacy = await f.file('cli.js');
  await f.manifest({ claude: 'cli.js' });
  assert.deepEqual(await findNpmTarget('claude', f.directory, process.execPath), {
    provider: 'claude',
    command: process.execPath,
    prefix: [legacy],
  });
  await fs.unlink(legacy);
  const native = await f.file('bin/claude.exe');
  await f.manifest({ claude: 'bin/claude.exe' });
  assert.deepEqual(await findNpmTarget('claude', f.directory, process.execPath), {
    provider: 'claude',
    command: native,
  });
});

test('npm Codex keeps its declared JS entry and supports a string bin', async (t) => {
  const f = await installation(t, 'codex');
  const entry = await f.file('bin/codex.js');
  for (const bin of [{ codex: 'bin/codex.js' }, './bin/codex.js']) {
    await f.manifest(bin);
    assert.deepEqual(await findNpmTarget('codex', f.directory, process.execPath), {
      provider: 'codex',
      command: process.execPath,
      prefix: [entry],
    });
  }
});

test('discovery follows a new declared entry even if the obsolete launcher remains', async (t) => {
  const f = await installation(t);
  await f.file('cli.js');
  const entry = await f.file('bin/claude.exe');
  await f.manifest({ claude: 'bin\\claude.exe' });
  assert.equal((await findNpmTarget('claude', f.directory, process.execPath)).command, entry);
});

test('missing, malformed and mismatched npm packages are skipped without crashing discovery', async (t) => {
  const f = await installation(t);
  assert.equal(await findNpmTarget('claude', f.directory, process.execPath), null);
  await fs.writeFile(path.join(f.root, 'package.json'), '{');
  assert.equal(await findNpmTarget('claude', f.directory, process.execPath), null);
  await f.manifest({ claude: 'missing.exe' });
  assert.equal(await findNpmTarget('claude', f.directory, process.execPath), null);
  await f.file('bin/claude.exe');
  await f.manifest({ claude: 'bin/claude.exe' }, 'unrelated-package');
  assert.equal(await findNpmTarget('claude', f.directory, process.execPath), null);
});

test('npm discovery refuses shell shims and entry points outside the expected package', async (t) => {
  const f = await installation(t);
  await fs.writeFile(path.join(f.directory, 'outside.exe'), 'test fixture');
  await f.file('launcher.cmd');
  for (const bin of [
    '../../../outside.exe',
    '..\\..\\..\\outside.exe',
    path.join(f.directory, 'outside.exe'),
    'C:\\outside.exe',
    'launcher.cmd',
  ]) {
    await f.manifest({ claude: bin });
    assert.equal(await findNpmTarget('claude', f.directory, process.execPath), null, bin);
  }
});

test('fresh Windows registry PATH finds a new install without restarting an app with stale PATH', async (t) => {
  const f = await installation(t);
  const old = path.join(f.directory, 'old install'),
    updated = path.join(f.directory, '新安裝');
  await fs.mkdir(old);
  await fs.mkdir(updated);
  await fs.writeFile(path.join(old, 'claude.exe'), 'old');
  await fs.writeFile(path.join(updated, 'claude.exe'), 'new');
  const locations = windowsSearchLocations(
    { Path: old, CUSTOM_AI_HOME: updated },
    f.directory,
    { user: { Path: '"%CUSTOM_AI_HOME%"' }, machinePath: '' },
    path,
  );
  const result = await collectWindowsTargets(locations, process.execPath);
  assert.deepEqual(
    new Set(result.targets.filter((t) => t.provider === 'claude').map((t) => t.command)),
    new Set([path.join(old, 'claude.exe'), path.join(updated, 'claude.exe')]),
  );
});

test('native, npm, pnpm and WinGet installs coexist; duplicate PATH entries do not duplicate choices', async (t) => {
  const f = await installation(t);
  const npm = await f.file('bin/claude.exe');
  await f.manifest({ claude: 'bin/claude.exe' });
  const local = path.join(f.directory, 'Local AppData');
  const pnpm = path.join(local, 'pnpm');
  const pnpmRoot = path.join(pnpm, 'global', '5');
  const pkg = path.join(pnpmRoot, 'node_modules', '@openai', 'codex');
  await fs.mkdir(path.join(pkg, 'bin'), { recursive: true });
  await fs.writeFile(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@openai/codex', bin: { codex: 'bin/codex.js' } }),
  );
  await fs.writeFile(path.join(pkg, 'bin', 'codex.js'), 'fixture');
  const native = path.join(f.directory, '.local', 'bin');
  const winget = path.join(local, 'Microsoft', 'WinGet', 'Links');
  for (const dir of [native, winget]) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'claude.exe'), 'fixture');
  }
  const dirs = windowsSearchLocations(
    { Path: `${f.directory};${f.directory}`, LOCALAPPDATA: local, PNPM_HOME: pnpm },
    f.directory,
    {},
    path,
  );
  const expanded = await expandWindowsLocations(dirs, { LOCALAPPDATA: local });
  const result = await collectWindowsTargets(expanded.locations, process.execPath);
  assert.equal(result.targets.length, 4);
  assert.equal(result.targets.filter((t) => t.command === npm).length, 1);
  assert.ok(result.targets.some((t) => t.command === path.join(winget, 'claude.exe')));
  assert.ok(result.targets.some((t) => t.prefix?.[0] === path.join(pkg, 'bin', 'codex.js')));
});

test('Windows paths normalize quotes, case, variables and skip relative/network entries', () => {
  const dirs = windowsSearchLocations(
    {
      Path: '"C:\\AI Tools";c:\\ai tools;.;\\\\server\\share',
      USERPROFILE: 'C:\\使用者',
      PNPM_HOME: 'C:\\Old pnpm',
    },
    'C:\\使用者',
    { user: { Path: '%USERPROFILE%\\bin', PNPM_HOME: 'D:\\New pnpm' } },
  );
  assert.equal(dirs.filter((d) => d.directory.toLowerCase() === 'c:\\ai tools').length, 1);
  assert.ok(dirs.some((d) => d.directory === 'C:\\使用者\\bin'));
  assert.ok(dirs.some((d) => d.directory === 'D:\\New pnpm'));
  assert.ok(dirs.every((d) => path.win32.isAbsolute(d.directory) && !d.directory.startsWith('\\\\')));
});

test('Desktop App Execution Aliases are excluded from CLI discovery', async (t) => {
  const f = await installation(t);
  const dir = path.join(f.directory, 'Microsoft', 'WindowsApps');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'claude.exe'), 'Desktop alias');
  assert.equal(
    (await collectWindowsTargets([{ directory: dir, installation: 'PATH' }], process.execPath)).targets
      .length,
    0,
  );
});

test('WSL records preserve Unicode, spaces and distinct versions while excluding imported Windows wrappers', () => {
  const data = [
    'claude',
    '/home/使用者/AI tools/claude',
    'native',
    'claude',
    '/home/使用者/.npm-global/bin/claude',
    'npm',
    'codex',
    '/mnt/c/Users/example/AppData/Roaming/npm/codex',
    'PATH',
    'claude',
    '/home/使用者/AI tools/claude',
    'PATH',
    '',
  ].join('\0');
  const targets = uniqueTargets(parseWslTargets(data, '測試 Ubuntu'));
  assert.equal(targets.length, 2);
  assert.equal(targets[0].distro, '測試 Ubuntu');
  assert.equal(targets[0].pathPrefix, '/home/使用者/AI tools');
  assert.equal(
    targets[0].id,
    targetId({ provider: 'claude', command: targets[0].command, distro: targets[0].distro }),
  );
});

test(
  'WSL discovery script emits all executable copies on PATH without sourcing shell startup files',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await installation(t);
    for (const folder of ['first', 'second']) {
      const dir = path.join(f.directory, folder);
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    }
    const result = await runProcess({ command: '/usr/bin/env' }, [
      `HOME=${f.directory}`,
      `PATH=${path.join(f.directory, 'first')}:${path.join(f.directory, 'second')}`,
      '/bin/sh',
      '-c',
      WSL_DISCOVERY_SCRIPT,
    ]);
    assert.equal(result.code, 0);
    assert.equal(parseWslTargets(result.stdout, 'test').length, 2);
  },
);

const compatibleHelp = '--safe-mode --json-schema --no-session-persistence --tools';
test('old and current installs are independently probed; failed checks never mean logged out or outdated', async () => {
  const t = { provider: 'claude', id: 'new', command: '/path/claude' };
  const probe = (mode) =>
    probeTarget(t, os.tmpdir(), {
      execute: async (_t, args) => {
        if (args.includes('--version')) return { code: 0, stdout: '2.1.314 (Claude Code)', stderr: '' };
        if (args.includes('--help')) {
          if (mode === 'timeout') throw Object.assign(new Error(), { code: 'AGENT_TIMEOUT' });
          return {
            code: mode === 'failed-help' ? 1 : 0,
            stdout: mode === 'old' ? '--tools' : compatibleHelp,
            stderr: '',
          };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            email: 'private@example.invalid',
          }),
          stderr: '',
        };
      },
    });
  assert.equal((await probe('old')).status, 'update');
  assert.equal((await probe('failed-help')).status, 'unknown');
  const timeout = await probe('timeout');
  assert.equal(timeout.status, 'unknown');
  assert.match(timeout.detail, /逾時/);
  const ready = await probe('ready');
  assert.equal(ready.status, 'ready');
  assert.ok(!JSON.stringify(ready).includes('private@'));
});

test('manual selection records explicit native, JS and WSL entries without shell evaluation', async (t) => {
  const f = await installation(t);
  const exe = path.join(f.directory, 'Claude Program.exe');
  const native = manualTarget('claude', exe, process.execPath);
  assert.equal(native.command, exe);
  assert.equal(native.manual, true);
  const js = path.join(f.directory, 'cli.js');
  assert.deepEqual(manualTarget('claude', js, process.execPath).prefix, [js]);
  const wsl = manualTarget(
    'claude',
    '\\\\wsl.localhost\\Ubuntu\\home\\person\\AI Tools\\claude',
    process.execPath,
  );
  assert.equal(wsl.command, '/home/person/AI Tools/claude');
  assert.equal(wsl.distro, 'Ubuntu');
  assert.throws(() => manualTarget('claude', path.join(f.directory, 'launcher.cmd'), process.execPath), {
    code: 'AGENT_INVALID_PATH',
  });
});

test('process reader decodes WSL UTF-16 output including non-ASCII distribution names', async () => {
  const r = await runProcess(
    { command: process.execPath },
    ['-e', 'process.stdout.write(Buffer.from("測試 Ubuntu\\r\\n", "utf16le"))'],
    { encoding: 'utf16le' },
  );
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '測試 Ubuntu\r\n');
});
