# 0.1.0 Preview validation

Validation date: 2026-10-30 (Asia/Taipei).

## Verified locally

| Check                                             | Evidence                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission / settings / MCP tests                 | 14 passed, 0 failed; actual exit code 0 on Windows Node 24.22.0                                                                                      |
| TypeScript + production UI + standalone MCP build | `npm run build`, actual exit code 0                                                                                                                  |
| Browser interaction test                          | Onboarding, chat selection, save, enable, message preview, Codex Windows/WSL settings, MCP test, pause and 390 px layout; actual exit code 0         |
| Packaged desktop startup                          | Real Windows executable, sandboxed renderer, preload IPC, LINE status and MCP handshake; actual exit code 0                                          |
| Packaged reader                                   | 20 messages from an explicitly authorized test chat; nonempty source references and matched chat/account identity                                    |
| Runtime revocation                                | Pause persisted on disk, then the same MCP process refused a subsequent read with ACCESS_PAUSED                                                      |
| WSL client                                        | Linux MCP SDK launched native Windows Node with explicit runtime/data paths; 3 tools and verified LINE status; actual exit code 0                    |
| Installer and relocated application               | Per-user NSIS installation into a new Programs directory, then installed UI startup and 20-message MCP read/revocation check; every command exited 0 |
| Portable ZIP                                      | ZIP manifest compared with an independent directory walk: 458 files; all extracted SHA-256 hashes matched; exit code 0                               |

Source delivery manifest: `git ls-files` compared with an independent filesystem
walk, 39 files and zero differences (exit code 0).

The UI screenshots in this repository use fictional data and an explicit demo
banner. Private chat contents, account references, local profile paths and live
screenshots are not included. Live checks recorded only result counts and status.

Tested host: Windows 11 x64, build 26200, LINE 26.5.0.3975, Electron 45.1.0,
bundled Node 24.22.0, embedded CPython 3.13.17 and upstream reader 3.3.8.

## Remaining limits

- A clean Windows VM and different LINE versions/accounts have not been tested.
- The package is unsigned. No code-signing identity or automatic update service
  is configured.
- No live message sending is implemented or tested.
- MCP transport is tested directly; this does not imply every Agent product or
  version has successfully loaded the generated configuration.
- Some contacts that exist in LINE's UI cannot be resolved from the local index.
  The application reports this boundary and has no GUI fallback.
- The local cache can be incomplete; a zero-message result is not proof that no
  conversation took place. The first seven-day read returned zero; the explicit
  30-day verification scope returned 20 messages.

See [RELEASING.md](RELEASING.md) for repeatable release checks and runtime provenance.
