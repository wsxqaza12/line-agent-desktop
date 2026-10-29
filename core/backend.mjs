import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from './errors.mjs';

export class LineBackend {
  constructor(runtimeRoot) {
    this.root = runtimeRoot;
    this.reader = null;
  }
  async environment() {
    const items = [
      ['node', 'node/node.exe'],
      ['python', 'python/python.exe'],
      ['reader', 'vendor/src/extensions/line-local-reader.mjs'],
      ['sqlite', 'sqlite/sqlite3mc_x64.dll'],
    ];
    return {
      platform: process.platform,
      supported: process.platform === 'win32' && process.arch === 'x64',
      components: await Promise.all(
        items.map(async ([id, relative]) => ({
          id,
          available: await fs.access(path.join(this.root, relative)).then(
            () => true,
            () => false,
          ),
        })),
      ),
    };
  }
  async load() {
    const env = await this.environment();
    if (!env.supported) throw new AppError('WINDOWS_REQUIRED');
    if (env.components.some((c) => !c.available)) throw new AppError('RUNTIME_MISSING');
    process.env.LINE_MCP_PYTHON = path.join(this.root, 'python', 'python.exe');
    process.env.LINE_MCP_SQLITE3MC_DLL = path.join(this.root, 'sqlite', 'sqlite3mc_x64.dll');
    process.env.LINE_MCP_READER_TIMEOUT_MS = '120000';
    if (!this.reader)
      this.reader = await import(
        pathToFileURL(path.join(this.root, 'vendor/src/extensions/line-local-reader.mjs')).href
      );
    return this.reader;
  }
  async status() {
    await this.load();
    const { readLineClientStatus } = await import(
      pathToFileURL(path.join(this.root, 'vendor/src/extensions/line-client-status.mjs')).href
    );
    const result = await readLineClientStatus();
    if (!result.ok) throw new AppError(result.code ?? 'LINE_CLIENT_STATUS_UNAVAILABLE');
    return {
      verified: result.client.verified,
      version: result.client.version,
      running: result.process.state === 'running',
      processState: result.process.state,
    };
  }
  async recent(query) {
    return (await this.load()).readLocalLineRecentChats({ days: 30, limit: 50, ...(query ? { query } : {}) });
  }
  async read(scope) {
    return (await this.load()).readLocalLineMessages(scope);
  }
}
