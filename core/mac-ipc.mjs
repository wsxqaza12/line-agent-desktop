import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, safeError } from './errors.mjs';

const credentials = (home) => path.join(home, 'mac-bridge.json');
// MCP clients sanitize TMPDIR; a Finder-launched app uses /var/folders/.../T.
// Both processes must derive the same short Unix socket path independently.
const socketPath = (home) =>
  path.join(
    '/tmp',
    `line-agent-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(home).digest('hex').slice(0, 16)}.sock`,
  );
export async function startMacBridge(home, service, onIdle = () => {}) {
  const socket = socketPath(home),
    token = randomBytes(32).toString('hex');
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  try {
    const old = await fs.lstat(socket);
    if (!old.isSocket() || old.uid !== process.getuid()) throw new AppError('MAC_BRIDGE_FAILED');
    await fs.unlink(socket);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const server = net.createServer((client) => {
    let data = '',
      handled = false;
    client.setEncoding('utf8');
    client.setTimeout(60000, () => client.destroy());
    client.on('error', () => {});
    client.on('data', async (chunk) => {
      if (handled) return;
      data += chunk;
      if (Buffer.byteLength(data) > 16000) {
        handled = true;
        client.destroy();
        return;
      }
      if (!data.includes('\n')) return;
      handled = true;
      try {
        const request = JSON.parse(data.trim());
        if (
          typeof request.token !== 'string' ||
          request.token.length !== token.length ||
          !timingSafeEqual(Buffer.from(request.token), Buffer.from(token))
        )
          throw new AppError('MAC_BRIDGE_FAILED');
        let result;
        if (request.method === 'status' && request.args === undefined) result = await service.status();
        else if (request.method === 'read') result = await service.read(request.args);
        else throw new AppError('INVALID_ARGUMENT');
        client.end(JSON.stringify({ ok: true, data: result }) + '\n');
      } catch (error) {
        client.end(JSON.stringify({ ok: false, error: safeError(error) }) + '\n');
      } finally {
        onIdle();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  await fs.chmod(socket, 0o600);
  await fs.writeFile(credentials(home), JSON.stringify({ socket, token }), { mode: 0o600 });
  await fs.chmod(credentials(home), 0o600);
  return async () => {
    server.close();
    await fs.rm(credentials(home), { force: true });
    await fs.rm(socket, { force: true });
  };
}

export async function callMacBridge(home, method, args) {
  let config;
  try {
    const stat = await fs.lstat(credentials(home));
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error();
    config = JSON.parse(await fs.readFile(credentials(home), 'utf8'));
    if (config.socket !== socketPath(home) || !/^[0-9a-f]{64}$/.test(config.token)) throw new Error();
  } catch {
    throw new AppError('MAC_APP_REQUIRED');
  }
  return new Promise((resolve, reject) => {
    const client = net.createConnection(config.socket);
    let response = '',
      finished = false;
    const fail = (code) => {
      if (finished) return;
      finished = true;
      client.destroy();
      reject(new AppError(code));
    };
    client.setEncoding('utf8');
    client.setTimeout(60000, () => fail('LOCAL_READER_TIMEOUT'));
    client.on('error', () => fail('MAC_APP_REQUIRED'));
    client.on('connect', () =>
      client.write(
        JSON.stringify({ token: config.token, method, ...(args === undefined ? {} : { args }) }) + '\n',
      ),
    );
    client.on('data', (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response) > 8 * 1024 * 1024) return fail('MAC_READER_FAILED');
      if (!response.includes('\n')) return;
      try {
        const result = JSON.parse(response.trim());
        if (!result.ok) return fail(result.error?.code ?? 'MAC_READER_FAILED');
        finished = true;
        client.destroy();
        resolve(result.data);
      } catch {
        fail('MAC_READER_FAILED');
      }
    });
    client.on('end', () => {
      if (!finished) fail('MAC_READER_FAILED');
    });
  });
}
