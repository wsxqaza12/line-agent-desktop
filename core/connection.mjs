import path from 'node:path';
export function connectionConfig(runtimeRoot, bridgePath, home) {
  const command = path.join(runtimeRoot, 'node', 'node.exe');
  // Explicit native paths also work when Windows Node is launched by a WSL client.
  // Do not rely on forwarding custom environment variables across the WSL boundary.
  const entry = { command, args: [bridgePath, '--runtime-root', runtimeRoot, '--data-home', home] };
  const toml = (executable) =>
    [
      '[mcp_servers.line_agent_desktop]',
      `command = ${JSON.stringify(executable)}`,
      `args = ${JSON.stringify(entry.args)}`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 150',
    ].join('\n');
  const wslCommand = command
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):\//, (_, drive) => `/mnt/${drive.toLowerCase()}/`);
  return {
    json: JSON.stringify({ mcpServers: { line_agent_desktop: entry } }, null, 2),
    codex: toml(command),
    codexWsl: toml(wslCommand),
    entry,
  };
}
