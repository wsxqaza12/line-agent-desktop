import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
await build({
  entryPoints: ['mcp-entry.mjs'],
  outfile: 'build/mcp-server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
});
// Preserve dependency notices for both the bundled UI and the standalone bridge.
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const notices = [];
for (const relative of Object.keys(lock.packages)
  .filter((p) => p.startsWith('node_modules/'))
  .sort()) {
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(relative, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const files = (await fs.readdir(relative)).filter((n) =>
    /^(license|licence|notice|copying)(\.|$)/i.test(n),
  );
  notices.push(`\n--- ${pkg.name}@${pkg.version} (${pkg.license ?? 'see notice'}) ---\n`);
  for (const file of files) {
    if ((await fs.stat(path.join(relative, file))).isFile())
      notices.push(await fs.readFile(path.join(relative, file), 'utf8'));
  }
}
await fs.writeFile('build/THIRD_PARTY_LICENSES.txt', notices.join('\n'));
