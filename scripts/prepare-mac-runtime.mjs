import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Build on an Apple Silicon Mac.');
const lock = JSON.parse(await fs.readFile('runtime-mac-lock.json', 'utf8'));
const root = path.resolve('runtime-mac');
await fs.mkdir('.downloads', { recursive: true });
const archive = path.resolve('.downloads/node-darwin-arm64.tar.gz');
let data = await fs.readFile(archive).catch(() => null);
if (!data) {
  const response = await fetch(lock.node.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(data).digest('hex') !== lock.node.sha256)
  throw new Error('Node SHA-256 mismatch');
await fs.writeFile(archive, data);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'line-agent-runtime-'));
try {
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temp], { stdio: 'inherit' });
  const source = path.join(temp, `node-v${lock.nodeVersion}-darwin-arm64`);
  await fs.mkdir(path.join(root, 'node/bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'mac'), { recursive: true });
  await fs.copyFile(path.join(source, 'bin/node'), path.join(root, 'node/bin/node'));
  await fs.chmod(path.join(root, 'node/bin/node'), 0o755);
  await fs.copyFile(path.join(source, 'LICENSE'), path.join(root, 'node/LICENSE'));
  execFileSync(
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-O',
      '-target',
      'arm64-apple-macosx13.5',
      'native/macos/LineReader.swift',
      '-o',
      path.join(root, 'mac/line-reader'),
    ],
    { stdio: 'inherit' },
  );
  const version = execFileSync(
    path.join(root, 'node/bin/node'),
    ['-p', 'process.version + " " + process.platform + " " + process.arch'],
    { encoding: 'utf8' },
  ).trim();
  if (version !== `v${lock.nodeVersion} darwin arm64`) throw new Error('Wrong Node runtime');
  await fs.writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        ...lock,
        nativeSourceSha256: createHash('sha256')
          .update(await fs.readFile('native/macos/LineReader.swift'))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Mac runtime verified: ${version}; native helper compile exit 0`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
