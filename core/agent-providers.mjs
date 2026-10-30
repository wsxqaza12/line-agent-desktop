import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { runProcess } from './agent-process.mjs';
import {
  readWindowsPaths,
  windowsSearchLocations,
  expandWindowsLocations,
  WSL_DISCOVERY_SCRIPT,
  parseWslTargets,
} from './agent-locations.mjs';
import { AppError } from './errors.mjs';

export const targetId = (t) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        provider: t.provider,
        command: t.command,
        ...(t.prefix ? { prefix: t.prefix } : {}),
        ...(t.distro ? { distro: t.distro } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 20);

export function uniqueTargets(targets) {
  const seen = new Set();
  return targets
    .filter((t) => {
      let key = JSON.stringify([t.provider, t.distro ?? '', t.command, t.prefix ?? []]);
      if (!t.distro && process.platform === 'win32') key = key.toLowerCase().replaceAll('\\\\', '/');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => ({ ...t, id: t.id ?? targetId(t) }));
}

export async function findNpmTarget(provider, directory, nodePath, onIssue = () => {}) {
  const packageName = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' }[provider];
  if (!packageName) return null;
  const packageRoot = path.resolve(directory, 'node_modules', packageName);
  const unsupported = () => {
    onIssue(
      `${provider === 'claude' ? 'Claude Code' : 'Codex'} 的 npm 入口格式不支援，可手動指定實際的 CLI：${packageRoot}`,
    );
    return null;
  };
  let found = false;
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    found = true;
    if (metadata.name !== packageName) return null;
    const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[provider];
    if (typeof bin !== 'string' || !bin.trim() || /[\u0000-\u001f]/.test(bin)) return unsupported();
    // npm can change a JS launcher to a native binary during an upgrade. Resolve
    // the package's declared entry, without evaluating its .cmd/PowerShell shim.
    const relative = bin.replaceAll('\\', '/');
    if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return unsupported();
    const entry = path.resolve(packageRoot, relative);
    const inside = path.relative(packageRoot, entry);
    if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
      return unsupported();
    if (!(await fs.stat(entry)).isFile()) return unsupported();
    if (/\.exe$/i.test(entry)) return { provider, command: entry };
    if (/\.[cm]?js$/i.test(entry)) return { provider, command: nodePath, prefix: [entry] };
    return unsupported();
  } catch (error) {
    if (found || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR'))
      onIssue(
        `${provider === 'claude' ? 'Claude Code' : 'Codex'} 的 npm 安裝無法讀取或入口缺失：${packageRoot}`,
      );
    return null;
  }
}

export async function collectWindowsTargets(locations, nodePath) {
  const targets = [],
    notes = [];
  for (const { directory, installation } of locations) {
    // Claude Desktop can own an App Execution Alias called claude.exe. It is not the CLI.
    if (/[\\/]Microsoft[\\/]WindowsApps(?:[\\/]|$)/i.test(directory)) continue;
    for (const provider of ['codex', 'claude']) {
      const command = path.join(directory, `${provider}.exe`);
      try {
        if ((await fs.stat(command)).isFile()) targets.push({ provider, command, installation });
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') notes.push(`無法檢查程式：${command}`);
      }
      const target = await findNpmTarget(provider, directory, nodePath, (note) => notes.push(note));
      if (target) targets.push({ ...target, installation: installation === 'PATH' ? 'npm' : installation });
    }
  }
  return { targets: uniqueTargets(targets), notes: [...new Set(notes)] };
}

// Only the trusted main process passes the file picker result to this function.
export function manualTarget(provider, selectedPath, nodePath) {
  if (
    !['codex', 'claude'].includes(provider) ||
    typeof selectedPath !== 'string' ||
    /[\u0000-\u001f]/.test(selectedPath)
  )
    throw new AppError('INVALID_ARGUMENT');
  const wsl = selectedPath.match(/^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\(.+)$/i);
  let target;
  if (wsl) {
    target = { provider, command: '/' + wsl[2].replaceAll('\\', '/'), distro: wsl[1] };
    target.pathPrefix = path.posix.dirname(target.command);
  } else {
    if (!path.isAbsolute(selectedPath) || /[\\/]Microsoft[\\/]WindowsApps(?:[\\/]|$)/i.test(selectedPath))
      throw new AppError('AGENT_INVALID_PATH');
    if (/\.exe$/i.test(selectedPath)) target = { provider, command: selectedPath };
    else if (/\.[cm]?js$/i.test(selectedPath))
      target = { provider, command: nodePath, prefix: [selectedPath] };
    else throw new AppError('AGENT_INVALID_PATH');
  }
  return { ...target, id: targetId(target), installation: '手動指定', manual: true, selectedPath };
}

export async function discoverTargets(nodePath, { signal } = {}) {
  const targets = [],
    notes = [];
  if (process.platform === 'win32') {
    let registry = {};
    try {
      registry = await readWindowsPaths(runProcess, signal);
    } catch {
      notes.push(
        'Windows 最新的安裝路徑暫時無法讀取，這次改用程式啟動時的 PATH 與常見位置；可重新偵測或手動指定。',
      );
    }
    const expanded = await expandWindowsLocations(
      windowsSearchLocations(process.env, os.homedir(), registry),
      process.env,
    );
    const native = await collectWindowsTargets(expanded.locations, nodePath);
    targets.push(...native.targets);
    notes.push(...expanded.notes, ...native.notes);
    try {
      const list = await runProcess({ command: 'wsl.exe' }, ['--list', '--quiet'], {
        timeout: 12000,
        encoding: 'utf16le',
        signal,
      });
      if (list.code !== 0) notes.push('WSL 無法列出環境；Windows 偵測仍可使用。');
      else {
        const distros = list.stdout
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !/^docker-desktop/.test(s));
        if (distros.length > 8) notes.push('這次檢查前 8 個 WSL 環境；其他環境可用檔案選擇器手動指定程式。');
        for (const distro of distros.slice(0, 8)) {
          try {
            const result = await runProcess(
              { command: 'wsl.exe' },
              ['-d', distro, '--exec', '/bin/sh', '-c', WSL_DISCOVERY_SCRIPT],
              { timeout: 15000, signal },
            );
            if (result.code !== 0) notes.push(`WSL ${distro} 無法完成檢查，可重新偵測或手動指定。`);
            else targets.push(...parseWslTargets(result.stdout, distro));
          } catch {
            notes.push(`WSL ${distro} 偵測逾時或無法啟動，可重新偵測或手動指定。`);
          }
        }
      }
    } catch {
      notes.push('WSL 偵測未完成或尚未安裝；Windows 偵測仍可使用。');
    }
  } else {
    const result = await runProcess({ command: '/bin/sh' }, ['-c', WSL_DISCOVERY_SCRIPT], { signal });
    targets.push(...parseWslTargets(result.stdout, undefined));
  }
  const unique = uniqueTargets(targets);
  if (unique.length > 24) notes.push('找到超過 24 個安裝，這次先檢查前 24 個；其他位置可手動指定。');
  return { targets: unique.slice(0, 24), notes: [...new Set(notes)] };
}

export async function targetDirectory(target, home, options = {}) {
  if (!target.distro) return home;
  const result = await runProcess(
    { command: 'wsl.exe' },
    ['-d', target.distro, '--exec', 'wslpath', '-a', '-u', home],
    { timeout: 8000, ...options },
  );
  if (result.code !== 0 || !result.stdout.trim().startsWith('/')) throw new Error('WSL path unavailable');
  return result.stdout.trim();
}

export async function probeTarget(target, cwd, { execute = runProcess, timeout = 8000, signal } = {}) {
  const result = {
    id: target.id,
    provider: target.provider,
    label: target.provider === 'codex' ? 'Codex' : 'Claude Code',
    location: target.distro ? `WSL · ${target.distro}` : process.platform === 'win32' ? 'Windows' : '本機',
    version: '',
    installation: target.installation ?? '',
    executable: target.prefix?.[0] ?? target.command,
    manual: !!target.manual,
    status: 'unknown',
    detail: '暫時無法確認登入，請重新偵測。',
  };
  let step = '啟動';
  const options = { cwd, timeout, signal };
  try {
    const v = await execute(target, ['--version'], options);
    if (v.code !== 0) return { ...result, detail: '程式無法啟動，請檢查安裝。' };
    result.version = v.stdout.trim().slice(0, 100);
    if (!(target.provider === 'codex' ? /\bcodex-cli\b/i : /\bClaude Code\b/i).test(result.version))
      return { ...result, detail: '這個程式沒有回報相符的 CLI 身分，請確認選的是 Codex 或 Claude Code。' };
    step = '功能檢查';
    const help = await execute(
      target,
      target.provider === 'codex' ? ['exec', '--help'] : ['--help'],
      options,
    );
    if (help.code !== 0) return { ...result, detail: '已找到程式，但功能檢查失敗，請重新偵測或檢查安裝。' };
    const needed =
      target.provider === 'codex'
        ? ['--ignore-user-config', '--ignore-rules', '--output-schema', '--ephemeral']
        : ['--safe-mode', '--json-schema', '--no-session-persistence', '--tools'];
    if (needed.some((flag) => !help.stdout.includes(flag)))
      return { ...result, status: 'update', detail: '版本較舊，請更新官方 CLI 後重新偵測。' };
    step = '登入檢查';
    const auth = await execute(
      target,
      target.provider === 'codex' ? ['login', 'status'] : ['--safe-mode', 'auth', 'status', '--json'],
      options,
    );
    if (target.provider === 'codex') {
      const text = auth.stdout + auth.stderr;
      if (auth.code === 0 && /chatgpt/i.test(text))
        return { ...result, status: 'ready', detail: '已找到 ChatGPT 登入資訊；連線與額度會在整理時確認。' };
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
      if (auth.code === 0 && value.loggedIn && value.authMethod === 'claude.ai')
        return {
          ...result,
          status: 'ready',
          detail: '已找到 Claude 訂閱登入資訊；連線與額度會在整理時確認。',
        };
      if (auth.code === 0 && value.loggedIn)
        return { ...result, status: 'api', detail: '目前不是 Claude 訂閱登入，請在 Claude Code 切換帳號。' };
      if (value.loggedIn === false)
        return { ...result, status: 'login', detail: '請先開啟 Claude Code，用 Claude 帳號登入。' };
    }
    return result;
  } catch (error) {
    return {
      ...result,
      detail:
        error.code === 'AGENT_TIMEOUT'
          ? `${step}逾時，尚未確認是否可用；請重新偵測。`
          : `${step}未完成，請重新偵測或檢查程式位置。`,
    };
  }
}
