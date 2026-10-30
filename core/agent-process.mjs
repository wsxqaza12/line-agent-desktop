import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { AppError } from './errors.mjs';

// Authentication stays inside the official CLI. An inherited API key must never
// silently replace the subscription selected in this application.
export const PRIVATE_ENV = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
];
export function cleanEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !PRIVATE_ENV.includes(key.toUpperCase()) && !key.startsWith('CODEX_INTERNAL_'),
    ),
  );
}

// Fixed shell text only. Paths, executable names and prompts are never evaluated
// as shell source. A separate Linux process group makes WSL cancellation reliable.
const WSL_RUN =
  'cd "$1" || exit 71; shift; exec setsid --fork --wait /bin/sh -c \'printf "__LINE_AGENT_PID__%s\\n" "$$" >&2; exec "$@"\' line-agent "$@"';
export function processSpec(target, args, cwd) {
  if (target.distro)
    return {
      command: 'wsl.exe',
      args: [
        '--distribution',
        target.distro,
        '--exec',
        '/bin/sh',
        '-c',
        WSL_RUN,
        'line-agent',
        cwd,
        '/usr/bin/env',
        ...PRIVATE_ENV.flatMap((key) => ['-u', key]),
        target.command,
        ...(target.prefix ?? []),
        ...args,
      ],
      cwd: undefined,
    };
  return { command: target.command, args: [...(target.prefix ?? []), ...args], cwd };
}

export function runProcess(
  target,
  args,
  { cwd, input = '', timeout = 20000, signal, onLine = () => {}, maxBytes = 4_000_000 } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('AGENT_CANCELLED'));
    const spec = processSpec(target, args, cwd);
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: cleanEnvironment(),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      pending = '',
      errPending = '',
      bytes = 0;
    let reason, linuxPid, forceTimer, killError;
    const decoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    const helper = (command, argv) => {
      const p = spawn(command, argv, { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => p.kill(), 5000);
      p.on('error', () => {
        killError = true;
        clearTimeout(timer);
      });
      p.on('close', () => clearTimeout(timer));
    };
    const kill = (force = false) => {
      if (target.distro && linuxPid) {
        helper('wsl.exe', [
          '--distribution',
          target.distro,
          '--exec',
          '/bin/kill',
          force ? '-KILL' : '-TERM',
          '--',
          `-${linuxPid}`,
        ]);
      } else if (!target.distro && child.pid) {
        if (process.platform === 'win32') helper('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
        else
          try {
            process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
          } catch {}
      } else if (force) child.kill();
    };
    const stop = (code) => {
      if (reason) return;
      reason = code;
      kill();
      forceTimer = setTimeout(() => kill(true), 2000);
    };
    const abort = () => stop('AGENT_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('AGENT_TIMEOUT'), timeout);
    child.stdout.on('data', (data) => {
      bytes += data.length;
      if (bytes > maxBytes) {
        stop('AGENT_OUTPUT_LIMIT');
        return;
      }
      const chunk = decoder.write(data);
      stdout += chunk;
      pending += chunk;
      let split;
      while ((split = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, split);
        pending = pending.slice(split + 1);
        try {
          onLine(line);
        } catch {
          stop('AGENT_INVALID_OUTPUT');
        }
      }
    });
    child.stderr.on('data', (data) => {
      const chunk = errDecoder.write(data);
      stderr = (stderr + chunk).slice(-12000);
      errPending = (errPending + chunk).slice(-12000);
      const match = errPending.match(/__LINE_AGENT_PID__(\d+)\r?\n/);
      if (match && !linuxPid) {
        linuxPid = Number(match[1]);
        if (reason) kill(true);
      }
    });
    child.stdin.on('error', () => {}); // Early CLI exit / failed login may close stdin.
    child.stdin.end(input);
    child.on('error', () => {
      reason ??= 'AGENT_START_FAILED';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      stdout += decoder.end();
      stderr += errDecoder.end();
      if (!reason && pending.trim()) {
        try {
          onLine(pending);
        } catch {
          reason = 'AGENT_INVALID_OUTPUT';
        }
      }
      if (reason) reject(new AppError(killError ? 'AGENT_STOP_FAILED' : reason));
      else resolve({ code, stdout, stderr });
    });
  });
}
