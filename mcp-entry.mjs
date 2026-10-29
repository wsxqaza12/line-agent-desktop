import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SettingsStore } from './core/settings.mjs';
import { LineBackend } from './core/backend.mjs';
import { LineService } from './core/service.mjs';
import { createMcpServer } from './core/mcp.mjs';

function option(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || !path.isAbsolute(value)) throw new Error('An absolute local path is required.');
  return value;
}
const root =
  option('--runtime-root') ??
  process.env.LINE_AGENT_RUNTIME ??
  path.resolve(path.dirname(process.argv[1]), '../runtime');
const home = option('--data-home') ?? process.env.LINE_AGENT_HOME;
const server = createMcpServer(new LineService(new SettingsStore(home), new LineBackend(root)));
server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write('LINE Agent Desktop: MCP startup failed.\n');
  process.exitCode = 1;
});
