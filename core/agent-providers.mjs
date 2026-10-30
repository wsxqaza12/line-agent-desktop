import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { runProcess } from './agent-process.mjs';

const exists = async (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
const id = (t) => createHash('sha256').update(JSON.stringify(t)).digest('hex').slice(0, 20);
const DISCOVER =
  'PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"; for d in "$HOME"/.nvm/versions/node/*/bin; do test ! -d "$d" || PATH="$PATH:$d"; done; export PATH; command -v codex; command -v claude; exit 0';

export async function discoverTargets(nodePath) {
  const targets = [],
    notes = [];
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin')];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'pnpm'));
    dirs.push(path.join(os.homedir(), '.bun', 'bin'), path.join(os.homedir(), '.cargo', 'bin'));
  }
  for (const provider of ['codex', 'claude']) {
    for (const dir of [...new Set(dirs.filter(Boolean))]) {
      const exe = path.join(dir, provider + (process.platform === 'win32' ? '.exe' : ''));
      if (await exists(exe)) {
        targets.push({ provider, command: exe });
        break;
      }
      if (process.platform === 'win32') {
        // Execute the official npm entry with bundled Node, never cmd.exe or a .cmd shim.
        const entry = path.join(
          dir,
          'node_modules',
          provider === 'codex' ? '@openai/codex/bin/codex.js' : '@anthropic-ai/claude-code/cli.js',
        );
        if (await exists(entry)) {
          targets.push({ provider, command: nodePath, prefix: [entry] });
          break;
        }
      }
    }
  }
  if (process.platform === 'win32') {
    try {
      const list = await runProcess({ command: 'wsl.exe' }, ['--list', '--quiet'], { timeout: 12000 });
      if (list.code !== 0) notes.push('WSL 無法列出環境；Windows 偵測仍可使用。');
      else
        for (const distro of list.stdout
          .replaceAll('\0', '')
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !/^docker-desktop/.test(s))
          .slice(0, 8)) {
          try {
            const result = await runProcess({ command: 'wsl.exe' }, [
              '-d',
              distro,
              '--exec',
              '/bin/sh',
              '-c',
              DISCOVER,
            ]);
            if (result.code !== 0) {
              notes.push(`WSL ${distro} 暫時無法檢查。`);
              continue;
            }
            for (const command of result.stdout
              .trim()
              .split(/\r?\n/)
              .filter((s) => s.startsWith('/'))) {
              const provider = path.posix.basename(command);
              if (['codex', 'claude'].includes(provider)) targets.push({ provider, command, distro });
            }
          } catch {
            notes.push(`WSL ${distro} 偵測逾時或無法啟動，可重新偵測。`);
          }
        }
    } catch {
      notes.push('尚未偵測到可用的 WSL；Windows 偵測仍可使用。');
    }
  }
  return { targets: targets.map((t) => ({ ...t, id: id(t) })), notes };
}

export async function targetDirectory(target, home) {
  if (!target.distro) return home;
  const result = await runProcess({ command: 'wsl.exe' }, [
    '-d',
    target.distro,
    '--exec',
    'wslpath',
    '-a',
    '-u',
    home,
  ]);
  if (result.code !== 0 || !result.stdout.trim().startsWith('/')) throw new Error('WSL path unavailable');
  return result.stdout.trim();
}

export async function probeTarget(target, cwd) {
  const result = {
    id: target.id,
    provider: target.provider,
    label: target.provider === 'codex' ? 'Codex' : 'Claude Code',
    location: target.distro ? `WSL · ${target.distro}` : process.platform === 'win32' ? 'Windows' : '本機',
    version: '',
    status: 'unknown',
    detail: '暫時無法確認登入，請重新偵測。',
  };
  try {
    const v = await runProcess(target, ['--version'], { cwd });
    if (v.code !== 0) return { ...result, detail: '程式無法啟動，請檢查安裝。' };
    result.version = v.stdout.trim().slice(0, 100);
    const help = await runProcess(target, target.provider === 'codex' ? ['exec', '--help'] : ['--help'], {
      cwd,
    });
    const needed =
      target.provider === 'codex'
        ? ['--ignore-user-config', '--ignore-rules', '--output-schema', '--ephemeral']
        : ['--safe-mode', '--json-schema', '--no-session-persistence', '--tools'];
    if (help.code !== 0 || needed.some((flag) => !help.stdout.includes(flag)))
      return { ...result, status: 'update', detail: '版本較舊，請更新官方 CLI 後重新偵測。' };
    const auth = await runProcess(
      target,
      target.provider === 'codex' ? ['login', 'status'] : ['--safe-mode', 'auth', 'status', '--json'],
      { cwd },
    );
    if (target.provider === 'codex') {
      const text = auth.stdout + auth.stderr;
      if (auth.code === 0 && /chatgpt/i.test(text))
        return { ...result, status: 'ready', detail: '已登入 ChatGPT，可使用原帳號額度。' };
      if (/api key/i.test(text))
        return {
          ...result,
          status: 'api',
          detail: '目前是 API 登入。本版使用訂閱帳號，請在 Codex 切換為 ChatGPT 登入。',
        };
      if (/not logged in/i.test(text))
        return { ...result, status: 'login', detail: '請先開啟 Codex，用 ChatGPT 帳號登入。' };
    } else {
      const value = JSON.parse(auth.stdout);
      if (value.loggedIn && value.authMethod === 'claude.ai')
        return { ...result, status: 'ready', detail: '已登入 Claude，可使用原帳號額度。' };
      if (value.loggedIn)
        return { ...result, status: 'api', detail: '目前不是 Claude 訂閱登入，請在 Claude Code 切換帳號。' };
      if (value.loggedIn === false)
        return { ...result, status: 'login', detail: '請先開啟 Claude Code，用 Claude 帳號登入。' };
    }
    return result;
  } catch {
    return result;
  }
}
