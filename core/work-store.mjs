import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

export const DEFAULT_RULES = `明確交辦給我的工作、我已答應的事情，列為待辦。
產品建議、尚未決定採用的想法、負責人不明的要求，先放待確認。
問候、閒聊、純資訊不建立任務；別人的承諾不等於我的待辦。
同一件工作的補充、改期、進度，更新原任務，不重複開卡。
沒有說明的負責人、期限留空；相對日期以原訊息時間和 Asia/Taipei 換算。
只有明確完成證據才標記已完成；群組沒回覆不代表私下還沒處理。
保留人的修正與「不是待辦」決定；遇到不確定的判斷，寫明原因，放待確認。`;
export const WORK_FIELDS = ['title', 'description', 'status', 'owner', 'dueDate'];
export const WORK_STATUSES = ['review', 'todo', 'doing', 'done', 'dismissed'];
const decode = (row) => (row ? JSON.parse(row.payload) : null);
const now = () => new Date().toISOString();

// Short SQLite transactions coordinate the desktop UI and independent MCP processes.
// No connection is retained across calls, including on Windows during upgrades.
export class WorkStore {
  constructor(home) {
    this.home = home;
    this.file = path.join(home, 'work.sqlite');
  }
  transaction(fn, guard = () => {}) {
    fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
    let db;
    try {
      db = new DatabaseSync(this.file, { timeout: 5000 });
      db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version > 1) throw new AppError('WORK_VERSION_NEWER');
      if (version === 0)
        db.exec(`CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY, chat_ref TEXT NOT NULL, own_ref TEXT NOT NULL,
        work_key TEXT NOT NULL, payload TEXT NOT NULL,
        UNIQUE(chat_ref, own_ref, work_key));
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
        PRAGMA user_version=1;`);
      guard();
      const result = fn(db);
      guard();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db?.exec('ROLLBACK');
      } catch {}
      if (error instanceof AppError) throw error;
      throw new AppError(/locked|busy/i.test(error.message) ? 'WORK_BUSY' : 'WORK_STORE_INVALID');
    } finally {
      db?.close();
    }
  }
  items(db) {
    return db.prepare('SELECT payload FROM items ORDER BY rowid DESC').all().map(decode);
  }
  rules(db) {
    return (
      decode(db.prepare("SELECT payload FROM meta WHERE key='rules'").get()) ?? {
        text: DEFAULT_RULES,
        revision: 0,
        updatedAt: null,
      }
    );
  }
  snapshot(guard, filter = () => true) {
    return this.transaction((db) => ({ items: this.items(db).filter(filter), rules: this.rules(db) }), guard);
  }
  get(db, id) {
    const item = decode(db.prepare('SELECT payload FROM items WHERE id=?').get(id));
    if (!item) throw new AppError('WORK_NOT_FOUND');
    return item;
  }
  save(db, item) {
    db.prepare(
      `INSERT INTO items(id,chat_ref,own_ref,work_key,payload) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,
    ).run(item.id, item.chatRef, item.ownSenderRef, item.workKey, JSON.stringify(item));
  }
  event(item, actor, reason, changes, blockedFields = []) {
    item.updatedAt = now();
    item.revision++;
    item.history.push({ at: item.updatedAt, actor, reason, changes, blockedFields });
  }
  upsert(input, chat, resolveSource, guard) {
    return this.transaction((db) => {
      let item;
      if (input.id) {
        item = this.get(db, input.id);
        if (item.chatRef !== chat.chatRef || item.ownSenderRef !== chat.ownSenderRef)
          throw new AppError('CHAT_NOT_ALLOWED');
        if (item.mergedInto) throw new AppError('WORK_MERGED');
        if (item.revision !== input.expectedRevision) throw new AppError('WORK_CONFLICT');
      } else {
        const duplicate = decode(
          db
            .prepare('SELECT payload FROM items WHERE chat_ref=? AND own_ref=? AND work_key=?')
            .get(chat.chatRef, chat.ownSenderRef, input.workKey),
        );
        if (duplicate) return { item: duplicate, duplicate: true, blockedFields: [] };
        if (db.prepare('SELECT count(*) AS n FROM items').get().n >= 10000) throw new AppError('WORK_LIMIT');
        item = {
          id: randomUUID(),
          workKey: input.workKey,
          chatRef: chat.chatRef,
          chatName: chat.chatName,
          ownSenderRef: chat.ownSenderRef,
          title: '',
          description: '',
          status: 'review',
          owner: null,
          dueDate: null,
          revision: 0,
          createdAt: now(),
          updatedAt: now(),
          locks: [],
          sources: [],
          history: [],
          mergedInto: null,
        };
      }
      const sources = input.sourceRefs.map(
        (ref) => item.sources.find((s) => s.sourceRef === ref) ?? resolveSource(ref),
      );
      const merged = [...new Map([...item.sources, ...sources].map((s) => [s.sourceRef, s])).values()];
      if (merged.length > 300) throw new AppError('WORK_LIMIT');
      const blockedFields = [],
        changes = {};
      for (const [key, value] of Object.entries(input.patch)) {
        if (item[key] === value) continue;
        if (item.locks.includes(key)) blockedFields.push(key);
        else {
          changes[key] = { from: item[key], to: value };
          item[key] = value;
        }
      }
      const added = merged.length - item.sources.length;
      item.sources = merged;
      if (added) changes.sourcesAdded = added;
      if (!item.revision || Object.keys(changes).length || blockedFields.length) {
        this.event(item, 'agent', input.reason, changes, blockedFields);
        this.save(db, item);
      }
      return { item, duplicate: false, blockedFields };
    }, guard);
  }
  edit(input) {
    return this.transaction((db) => {
      const item = this.get(db, input.id);
      if (item.mergedInto) throw new AppError('WORK_MERGED');
      if (item.revision !== input.expectedRevision) throw new AppError('WORK_CONFLICT');
      const changes = {};
      for (const [key, value] of Object.entries(input.patch)) {
        if (item[key] !== value) {
          changes[key] = { from: item[key], to: value };
          item[key] = value;
          if (!item.locks.includes(key)) item.locks.push(key);
        }
      }
      if (input.unlockFields?.length) {
        item.locks = item.locks.filter((f) => !input.unlockFields.includes(f));
        changes.unlocked = input.unlockFields;
      }
      if (Object.keys(changes).length) {
        this.event(item, 'human', input.reason || '手動調整', changes);
        this.save(db, item);
      }
      return item;
    });
  }
  merge(input) {
    return this.transaction((db) => {
      const target = this.get(db, input.targetId),
        source = this.get(db, input.sourceId);
      if (source.revision !== input.sourceRevision || target.revision !== input.targetRevision)
        throw new AppError('WORK_CONFLICT');
      if (source.mergedInto || target.mergedInto) throw new AppError('WORK_MERGED');
      // Cross-room merges would expose revoked-room evidence through a permitted task.
      if (
        source.id === target.id ||
        source.chatRef !== target.chatRef ||
        source.ownSenderRef !== target.ownSenderRef
      )
        throw new AppError('INVALID_ARGUMENT');
      target.sources = [
        ...new Map([...target.sources, ...source.sources].map((s) => [s.sourceRef, s])).values(),
      ];
      if (target.sources.length > 300) throw new AppError('WORK_LIMIT');
      source.status = 'dismissed';
      source.mergedInto = target.id;
      if (!source.locks.includes('status')) source.locks.push('status');
      this.event(target, 'human', '合併重複工作；保留本卡的內容與進度', { mergedFrom: source.id });
      this.event(source, 'human', '已合併到另一件工作', { mergedInto: target.id });
      this.save(db, target);
      this.save(db, source);
      return target;
    });
  }
  saveRules(input, guard) {
    return this.transaction((db) => {
      const old = this.rules(db);
      if (input.expectedRevision !== old.revision) throw new AppError('WORK_CONFLICT');
      const rules = { text: input.text, revision: old.revision + 1, updatedAt: now() };
      db.prepare(
        "INSERT INTO meta(key,payload) VALUES('rules',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
      ).run(JSON.stringify(rules));
      return rules;
    }, guard);
  }
}
