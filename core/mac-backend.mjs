import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { AppError } from './errors.mjs';
import { defaultHome } from './settings.mjs';
import { callMacBridge } from './mac-ipc.mjs';
import { macChatRef, parseMacRows } from './mac-messages.mjs';

export class MacBackend {
  constructor(root, { desktop = false, home = defaultHome(), execute } = {}) {
    this.root = root;
    this.desktop = desktop;
    this.home = home;
    this.execute = execute;
    this.snapshots = new Map();
  }
  async environment() {
    return {
      platform: 'darwin',
      supported: process.arch === 'arm64',
      mode: 'macos-accessibility',
      components: await Promise.all(
        [
          ['node', 'node/bin/node'],
          ['reader', 'mac/line-reader'],
        ].map(async ([id, relative]) => ({
          id,
          available: await fs.access(path.join(this.root, relative)).then(
            () => true,
            () => false,
          ),
        })),
      ),
    };
  }
  invoke(method, args = {}) {
    if (this.execute) return this.execute(method, args);
    return new Promise((resolve, reject) => {
      const child = execFile(
        path.join(this.root, 'mac/line-reader'),
        [],
        { timeout: 45000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout) => {
          try {
            const result = JSON.parse(stdout);
            if (!result.ok) return reject(new AppError(result.code));
            if (error) return reject(new AppError('MAC_READER_FAILED'));
            resolve(result.data);
          } catch {
            reject(new AppError(error?.killed ? 'LOCAL_READER_TIMEOUT' : 'MAC_READER_FAILED'));
          }
        },
      );
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ method, ...args }));
    });
  }
  status() {
    return this.desktop ? this.invoke('status') : callMacBridge(this.home, 'status');
  }
  async recent(query = '') {
    if (!this.desktop) throw new AppError('MAC_APP_REQUIRED');
    const result = await this.invoke('recent', { query });
    return {
      ...result,
      chats: result.chats.map((chat) => ({
        ...chat,
        sessionRef: result.sessionRef,
        chatRef: macChatRef(result.ownSenderRef, chat.chatName, chat.chatType),
      })),
      checkedAt: new Date().toISOString(),
      warnings: result.duplicateNamesOmitted ? ['MAC_DUPLICATE_NAMES_OMITTED'] : [],
    };
  }
  async read(scope) {
    if (!this.desktop)
      return callMacBridge(this.home, 'read', {
        chatRef: scope.expectedChatRef,
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        limit: scope.messageLimit,
        ...(scope.query !== undefined ? { query: scope.query } : {}),
        ...(scope.cursor ? { cursor: scope.cursor } : {}),
      });
    const chatRef = macChatRef(scope.expectedOwnSenderRef, scope.chatName, scope.chatType);
    if (scope.expectedChatRef !== chatRef) throw new AppError('CHAT_IDENTITY_CHANGED');
    const signature = createHash('sha256')
      .update(
        JSON.stringify([
          chatRef,
          scope.expectedSessionRef,
          scope.dateFrom,
          scope.dateTo,
          scope.query ?? '',
          scope.messageLimit,
        ]),
      )
      .digest('hex');
    const now = Date.now();
    for (const [key, value] of this.snapshots) if (value.expires < now) this.snapshots.delete(key);
    let snapshot,
      offset = 0,
      id;
    if (scope.cursor) {
      const match = /^([a-f0-9]{32})_([0-9]+)$/.exec(scope.cursor);
      if (!match) throw new AppError('MAC_CURSOR_EXPIRED');
      id = match[1];
      offset = Number(match[2]);
      snapshot = this.snapshots.get(id);
      if (
        !snapshot ||
        snapshot.signature !== signature ||
        !Number.isSafeInteger(offset) ||
        offset < 1 ||
        offset >= snapshot.messages.length
      )
        throw new AppError('MAC_CURSOR_EXPIRED');
      // Even cached pages must recheck the running account/session before release.
      const current = await this.invoke('session');
      if (
        current.ownSenderRef !== scope.expectedOwnSenderRef ||
        current.sessionRef !== scope.expectedSessionRef
      )
        throw new AppError('CHAT_ACCOUNT_CHANGED');
    } else {
      const raw = await this.invoke('read', scope);
      if (raw.ownSenderRef !== scope.expectedOwnSenderRef) throw new AppError('CHAT_ACCOUNT_CHANGED');
      const parsed = parseMacRows(raw.rows, {
        ownSenderRef: raw.ownSenderRef,
        chatRef,
        timeZone: raw.timeZone,
      });
      const messages = parsed.messages.filter(
        (m) =>
          m.date >= scope.dateFrom &&
          m.date <= scope.dateTo &&
          (!scope.query || m.text.toLocaleLowerCase().includes(scope.query.toLocaleLowerCase())),
      );
      id = randomBytes(16).toString('hex');
      snapshot = {
        signature,
        messages,
        omitted: parsed.omitted,
        checkedAt: raw.checkedAt,
        expires: now + 120000,
      };
      this.snapshots.set(id, snapshot);
      while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value);
    }
    const messages = snapshot.messages.slice(offset, offset + scope.messageLimit);
    const next = offset + messages.length;
    return {
      chatRef,
      chatName: scope.chatName,
      ownSenderRef: scope.expectedOwnSenderRef,
      count: messages.length,
      messages,
      pagination: {
        hasMore: next < snapshot.messages.length,
        nextCursor: next < snapshot.messages.length ? `${id}_${next}` : null,
      },
      freshness: { checkedAt: snapshot.checkedAt },
      coverage: { complete: false, mode: 'loaded-line-window', omittedRows: snapshot.omitted },
      warnings: [
        'MAC_LOADED_HISTORY_ONLY',
        'MAC_SENDER_IDENTITY_LIMITED',
        ...(snapshot.omitted ? ['MAC_UNPARSED_ROWS_OMITTED'] : []),
      ],
    };
  }
}
