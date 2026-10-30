import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './agent-process.mjs';

const envValue = (env, name) =>
  env[name] ?? env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())] ?? '';

// Read just installation-related variables, never the user's full environment or
// shell profile. This sees PATH updates made after Electron was started.
export async function readWindowsPaths(execute = runProcess, signal) {
  const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $ErrorActionPreference='Stop'; $v=@{}; foreach($k in @('Path','PNPM_HOME','NPM_CONFIG_PREFIX','BUN_INSTALL','VOLTA_HOME')) { $v[$k]=[Environment]::GetEnvironmentVariable($k,'User') }; @{user=$v; machinePath=[Environment]::GetEnvironmentVariable('Path','Machine')} | ConvertTo-Json -Compress`;
  const result = await execute(
    { command: 'powershell.exe' },
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 8000, signal },
  );
  if (result.code !== 0) throw new Error('Windows environment unavailable');
  const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  if (!value || typeof value.user !== 'object' || Array.isArray(value.user))
    throw new Error('Invalid environment');
  return value;
}

export function windowsSearchLocations(env, home, registry = {}, paths = path.win32) {
  const refreshed = { ...env };
  for (const key of ['PNPM_HOME', 'NPM_CONFIG_PREFIX', 'BUN_INSTALL', 'VOLTA_HOME']) {
    if (typeof registry.user?.[key] === 'string' && registry.user[key]) refreshed[key] = registry.user[key];
  }
  const expand = (value) => {
    let text = String(value ?? '')
      .trim()
      .replace(/^"(.*)"$/, '$1');
    for (let i = 0; i < 4; i++) {
      const next = text.replace(/%([^%]+)%/g, (whole, name) => envValue(refreshed, name) || whole);
      if (next === text) break;
      text = next;
    }
    return text;
  };
  const locations = [],
    seen = new Set();
  const add = (directory, installation) => {
    directory = expand(directory);
    // Do not probe arbitrary network shares or current-directory PATH entries.
    if (!directory || !paths.isAbsolute(directory) || directory.startsWith('\\\\') || directory.includes('%'))
      return;
    const key = paths
      .normalize(directory)
      .replace(/[\\/]+$/, '')
      .toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    locations.push({ directory, installation });
  };
  for (const value of [registry.machinePath, registry.user?.Path, envValue(env, 'PATH')])
    for (const directory of String(value ?? '').split(';')) add(directory, 'PATH');
  add(paths.join(home, '.local', 'bin'), '原生安裝');
  const appData = envValue(env, 'APPDATA'),
    localData = envValue(env, 'LOCALAPPDATA');
  if (appData) add(paths.join(appData, 'npm'), 'npm');
  if (localData) {
    add(paths.join(localData, 'Microsoft', 'WinGet', 'Links'), 'WinGet');
    add(paths.join(localData, 'pnpm'), 'pnpm');
  }
  add(envValue(refreshed, 'PNPM_HOME'), 'pnpm');
  add(envValue(refreshed, 'NPM_CONFIG_PREFIX'), 'npm');
  const bun = expand(envValue(refreshed, 'BUN_INSTALL')) || paths.join(home, '.bun');
  add(paths.join(bun, 'bin'), 'Bun');
  add(paths.join(bun, 'install', 'global'), 'Bun');
  add(paths.join(expand(envValue(refreshed, 'VOLTA_HOME')) || paths.join(home, '.volta'), 'bin'), 'Volta');
  add(paths.join(home, 'scoop', 'shims'), 'Scoop');
  add(paths.join(home, '.cargo', 'bin'), '原生安裝');
  add(paths.join(home, '.claude', 'local'), '舊版本機 npm');
  return locations;
}

export async function expandWindowsLocations(locations, env) {
  const extra = [],
    notes = [];
  for (const { directory, installation } of locations) {
    if (installation !== 'pnpm' && path.basename(directory).toLowerCase() !== 'pnpm') continue;
    const global = path.join(directory, 'global');
    try {
      const entries = await fs.readdir(global, { withFileTypes: true });
      for (const entry of entries.filter((e) => e.isDirectory()).slice(0, 8))
        extra.push({ directory: path.join(global, entry.name), installation: 'pnpm' });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        notes.push(`無法讀取 pnpm 安裝目錄：${global}`);
    }
  }
  const localData = envValue(env, 'LOCALAPPDATA');
  if (localData) {
    const packages = path.join(localData, 'Microsoft', 'WinGet', 'Packages');
    try {
      const entries = await fs.readdir(packages, { withFileTypes: true });
      for (const entry of entries
        .filter((e) => e.isDirectory() && /^Anthropic\.ClaudeCode_/i.test(e.name))
        .slice(0, 8))
        extra.push({ directory: path.join(packages, entry.name), installation: 'WinGet' });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        notes.push('無法讀取 WinGet 安裝目錄，可手動指定程式。');
    }
  }
  return { locations: [...locations, ...extra], notes };
}

// NUL-separated records preserve spaces and non-ASCII names. Do not source shell
// startup scripts: they can have unrelated side effects or require an interactive terminal.
export const WSL_DISCOVERY_SCRIPT = `
emit_dir() {
  case "$1" in /*) ;; *) return ;; esac
  for provider in codex claude; do
    if [ -f "$1/$provider" ] && [ -x "$1/$provider" ]; then
      printf '%s\\0%s\\0%s\\0' "$provider" "$1/$provider" "$2"
    fi
  done
}
old_ifs=$IFS; IFS=:; set -f
for directory in $PATH; do emit_dir "$directory" PATH; done
set +f; IFS=$old_ifs
emit_dir "$HOME/.local/bin" native
emit_dir "$HOME/.npm-global/bin" npm
emit_dir "$HOME/.bun/bin" bun
emit_dir "$HOME/.cargo/bin" native
emit_dir "$HOME/.local/share/pnpm" pnpm
emit_dir "$PNPM_HOME" pnpm
emit_dir "$HOME/.volta/bin" volta
emit_dir "$HOME/.asdf/shims" asdf
for directory in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.local/share/fnm/node-versions/*/installation/bin; do
  [ ! -d "$directory" ] || emit_dir "$directory" node
done
exit 0`;

export function parseWslTargets(stdout, distro) {
  const parts = stdout.split('\0'),
    targets = [];
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const [provider, command, installation] = parts.slice(i, i + 3);
    if (!['claude', 'codex'].includes(provider) || !command.startsWith('/') || /[\r\n]/.test(command))
      continue;
    // Windows npm shell wrappers found through WSL's imported PATH are not Linux installs.
    if (/^\/mnt\/[a-z]\/.*(?:AppData|Program Files)\//i.test(command)) continue;
    targets.push({
      provider,
      command,
      distro,
      installation: `WSL · ${installation}`,
      pathPrefix: path.posix.dirname(command),
    });
  }
  return targets;
}
