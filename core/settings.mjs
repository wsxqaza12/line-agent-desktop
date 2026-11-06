import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

export const CHAT_REF = /^chat:[0-9a-f]{24}$/;
export const SENDER_REF = /^sender:[0-9a-f]{24}$/;
export function defaultHome() {
  return (
    process.env.LINE_AGENT_HOME ??
    path.join(
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (process.env.APPDATA ?? path.join(os.homedir(), '.config')),
      'LINE Agent Desktop',
    )
  );
}
export function validateChat(chat) {
  if (
    !chat ||
    !CHAT_REF.test(chat.chatRef) ||
    !SENDER_REF.test(chat.ownSenderRef) ||
    typeof chat.chatName !== 'string' ||
    !chat.chatName.trim() ||
    chat.chatName !== chat.chatName.trim() ||
    chat.chatName.length > 200 ||
    /\p{Cc}/u.test(chat.chatName) ||
    !['group', 'direct'].includes(chat.chatType) ||
    (chat.sessionRef !== undefined && !/^session:[0-9a-f]{24}$/.test(chat.sessionRef))
  )
    throw new AppError('INVALID_ARGUMENT');
  return {
    chatRef: chat.chatRef,
    chatName: chat.chatName,
    chatType: chat.chatType,
    ownSenderRef: chat.ownSenderRef,
    ...(chat.sessionRef ? { sessionRef: chat.sessionRef } : {}),
  };
}
function validate(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.chats) ||
    value.chats.length > 100 ||
    typeof value.revision !== 'string'
  )
    throw new AppError('SETTINGS_INVALID');
  const chats = value.chats.map(validateChat);
  if (new Set(chats.map((c) => c.chatRef)).size !== chats.length) throw new AppError('SETTINGS_INVALID');
  return { schemaVersion: 1, enabled: value.enabled, chats, revision: value.revision };
}
export class SettingsStore {
  constructor(home = defaultHome()) {
    this.home = home;
    this.file = path.join(home, 'settings.json');
    this.queue = Promise.resolve();
  }
  async read() {
    try {
      return validate(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT')
        return { schemaVersion: 1, enabled: false, chats: [], revision: 'initial' };
      throw new AppError('SETTINGS_INVALID');
    }
  }
  update(patch) {
    const run = this.queue.then(async () => {
      const old = await this.read();
      const next = validate({ ...old, ...patch, schemaVersion: 1, revision: randomUUID() });
      if (next.enabled && !next.chats.length) throw new AppError('NO_CHATS');
      await fs.mkdir(this.home, { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(temp, this.file);
      } finally {
        await fs.rm(temp, { force: true });
      }
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async record(action, outcome, detail = {}) {
    // Operational metadata only. Never accept raw messages, names, paths or errors here.
    const event = {
      id: randomUUID(),
      at: new Date().toISOString(),
      action,
      outcome,
      ...(CHAT_REF.test(detail.chatRef ?? '') ? { chatRef: detail.chatRef } : {}),
      ...(Number.isSafeInteger(detail.count) ? { count: detail.count } : {}),
      ...(typeof detail.code === 'string' && /^[A-Z_]+$/.test(detail.code) ? { code: detail.code } : {}),
    };
    const dir = path.join(this.home, 'activity');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, `${Date.now()}-${event.id}.json`), JSON.stringify(event), {
      mode: 0o600,
      flag: 'wx',
    });
    const names = (await fs.readdir(dir)).filter((n) => /^\d+-[a-f0-9-]+\.json$/.test(n)).sort();
    await Promise.all(names.slice(0, -200).map((n) => fs.rm(path.join(dir, n), { force: true })));
  }
  async activity() {
    const dir = path.join(this.home, 'activity');
    let names;
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return (
      await Promise.all(
        names
          .filter((n) => /^\d+-[a-f0-9-]+\.json$/.test(n))
          .sort()
          .slice(-30)
          .reverse()
          .map(async (n) => {
            try {
              return JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'));
            } catch {
              return null;
            }
          }),
      )
    ).filter(Boolean);
  }
}
