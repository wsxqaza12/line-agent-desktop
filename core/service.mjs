import { AppError, safeError } from './errors.mjs';
import { CHAT_REF } from './settings.mjs';

export function validateRead(args) {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some(
      (k) => !['chatRef', 'dateFrom', 'dateTo', 'limit', 'query', 'cursor'].includes(k),
    ) ||
    !CHAT_REF.test(args.chatRef ?? '')
  )
    throw new AppError('INVALID_ARGUMENT');
  for (const key of ['dateFrom', 'dateTo']) {
    const v = args[key];
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000'))
      throw new AppError('INVALID_ARGUMENT');
    const d = new Date(v + 'T00:00:00Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== v) throw new AppError('INVALID_ARGUMENT');
  }
  const days = (Date.parse(args.dateTo) - Date.parse(args.dateFrom)) / 86400000;
  if (
    days < 0 ||
    days > 30 ||
    !Number.isSafeInteger(args.limit ?? 200) ||
    (args.limit ?? 200) < 1 ||
    (args.limit ?? 200) > 500 ||
    (args.query !== undefined &&
      (typeof args.query !== 'string' ||
        !args.query ||
        args.query.length > 1000 ||
        args.query.includes('\0'))) ||
    (args.cursor !== undefined &&
      (typeof args.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(args.cursor)))
  )
    throw new AppError('INVALID_ARGUMENT');
  return { ...args, limit: args.limit ?? 200 };
}
export class LineService {
  constructor(store, backend) {
    this.store = store;
    this.backend = backend;
    this.busy = false;
    this.candidates = new Map();
    this.receipts = new Map();
  }
  async state() {
    return {
      settings: await this.store.read(),
      environment: await this.backend.environment(),
      activity: await this.store.activity(),
    };
  }
  async status() {
    try {
      const line = await this.backend.status();
      await this.store.record(
        'connection',
        line.running ? 'success' : 'error',
        line.running ? {} : { code: 'LINE_NOT_RUNNING' },
      );
      return line;
    } catch (error) {
      await this.store.record('connection', 'error', safeError(error));
      throw error;
    }
  }
  async recent(query = '') {
    if (typeof query !== 'string' || query.length > 100 || /\p{Cc}/u.test(query))
      throw new AppError('INVALID_ARGUMENT');
    return this.exclusive(async () => {
      const result = await this.backend.recent(query.trim());
      // Keep discovered selections across searches until they can be saved.
      // The reader still rechecks the bound chat/account identity on every read.
      const chats = result.chats.map((c) => ({ ...c, ownSenderRef: result.ownSenderRef }));
      for (const c of chats) this.candidates.set(c.chatRef, c);
      return { chats, hasMore: result.hasMore, warnings: result.warnings, checkedAt: result.checkedAt };
    });
  }
  async saveChats(refs) {
    if (
      !Array.isArray(refs) ||
      refs.length > 100 ||
      new Set(refs).size !== refs.length ||
      refs.some((r) => !CHAT_REF.test(r))
    )
      throw new AppError('INVALID_ARGUMENT');
    const old = await this.store.read();
    const choices = new Map(old.chats.map((c) => [c.chatRef, c]));
    for (const [ref, c] of this.candidates) choices.set(ref, c);
    const chats = refs.map((ref) => {
      const c = choices.get(ref);
      if (!c) throw new AppError('CHAT_NOT_ALLOWED');
      if (!c.ownSenderRef) throw new AppError('ACCOUNT_UNAVAILABLE');
      return c;
    });
    const result = await this.store.update({ chats, ...(chats.length === 0 ? { enabled: false } : {}) });
    await this.store.record('permissions', 'success', { count: chats.length });
    return result;
  }
  async setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new AppError('INVALID_ARGUMENT');
    const result = await this.store.update({ enabled });
    await this.store.record(enabled ? 'resume' : 'pause', 'success');
    return result;
  }
  async allowed() {
    const s = await this.store.read();
    if (!s.enabled) throw new AppError('ACCESS_PAUSED');
    return s.chats.map(({ chatRef, chatName, chatType }) => ({ chatRef, chatName, chatType }));
  }
  async read(input) {
    const args = validateRead(input);
    return this.exclusive(async () => {
      try {
        const before = await this.store.read();
        if (!before.enabled) throw new AppError('ACCESS_PAUSED');
        const chat = before.chats.find((c) => c.chatRef === args.chatRef);
        if (!chat) throw new AppError('CHAT_NOT_ALLOWED');
        const page = await this.backend.read({
          chatName: chat.chatName,
          chatType: chat.chatType,
          expectedChatRef: chat.chatRef,
          expectedOwnSenderRef: chat.ownSenderRef,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          messageLimit: args.limit,
          mediaMode: 'metadata',
          ...(args.query !== undefined ? { query: args.query } : {}),
          ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
        });
        const after = await this.store.read();
        if (!after.enabled || after.revision !== before.revision) throw new AppError('ACCESS_CHANGED');
        if (page.chatRef !== chat.chatRef || page.ownSenderRef !== chat.ownSenderRef)
          throw new AppError('CHAT_IDENTITY_CHANGED');
        await this.store.record('read', 'success', { chatRef: chat.chatRef, count: page.count });
        // Memory only: persist an excerpt only when the agent cites it in a work item.
        for (const message of page.messages) {
          this.receipts.set(message.sourceRef, {
            sourceRef: message.sourceRef,
            chatRef: chat.chatRef,
            ownSenderRef: chat.ownSenderRef,
            permissionRevision: after.revision,
            date: message.date ?? '',
            time: message.time ?? '',
            senderRef: message.senderRef ?? '',
            text: String(message.text ?? ''),
          });
        }
        while (this.receipts.size > 5000) this.receipts.delete(this.receipts.keys().next().value);
        return page;
      } catch (error) {
        await this.store.record('read', 'error', { chatRef: args.chatRef, ...safeError(error) });
        throw error;
      }
    });
  }
  async exclusive(fn) {
    if (this.busy) throw new AppError('BUSY');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
}
