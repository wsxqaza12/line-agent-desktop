# 0.3.0 Preview validation

Validation date: 2026-10-31 (Asia/Taipei).

## Verified locally

| Check                                    | Evidence                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission, settings, MCP and work store | 30 tests passed on Linux Node and Windows Node 24.22.0; actual exit code 0                                                                                                                         |
| Concurrent work updates                  | Two independent processes attempted the same revision; exactly one succeeded and one returned WORK_CONFLICT                                                                                        |
| Source provenance and privacy            | Unobserved citations refused; only cited excerpts stored; revoked rooms/accounts hidden from MCP; pause blocks task and message access                                                             |
| Task lifecycle                           | Stable-key retry deduplication, human field protection, unlock, dismissal, merge, rule version conflicts                                                                                           |
| Production build                         | TypeScript, Vite UI and standalone MCP bundle; actual exit code 0                                                                                                                                  |
| Browser interactions                     | Board, drag/drop, source/history detail, human edits, review/dismissal, month view, no-deadline tasks, rules, AI selection/start/progress/cancel, search, permissions and 390 px layout; exit code 0, no page errors |
| Skill validation                         | Bundled line-workboard SKILL.md passed the skill validator; exit code 0                                                                                                                            |
| Packaged reader and work writeback       | 20 real messages from an explicitly authorized room; cited excerpt matches the reader, native MCP and desktop work store share state, human status stays locked; exit code 0                       |
| Runtime revocation                       | Same MCP process refuses message reads, work reads and task writes after pause; isolated profile left paused                                                                                       |
| Packaged desktop                         | Native Windows executable, sandboxed renderer, preload IPC, six MCP tools and a persisted task rendered in the real work board; exit code 0                                                        |
| Portable ZIP                             | 460 entries compared with an independent directory walk; all extracted file hashes match; exit code 0                                                                                              |
| Installed upgrade                        | NSIS v0.2.0 → v0.3.0 at the Windows-registered directory; settings.json and work.sqlite byte-identical before/after, selected rooms and access state preserved; exit code 0                                        |
| Installed MCP                            | 20-message scoped read, source writeback, shared data and human-lock/revocation checks rerun against installed resources; exit code 0                                                              |
| Installed UI and WSL                     | Installed desktop renders saved work through real preload IPC; WSL client launches the installed Windows bridge and reads shared rules/current authorization; both exit code 0                     |
| Electron SQLite                          | Packaged Electron 45.1.0 includes Node 24.22.1 / SQLite 3.53.4; real in-memory query exited 0                                                                                                      |

Additional 0.3.0 checks:

- Windows discovery found native Claude and WSL Codex/Claude; old native Claude
  correctly requires an update. Both WSL subscription logins were recognized.
- Each official CLI processed a synthetic one-message conversation and wrote one
  real work card to a separate test database. Exact observed source text matched;
  both CLI processes exited 0 and the combined validation exited 0.
- WSL cancellation targeted a dedicated process group; after completion the test
  PID no longer existed. Validation exit code 0. No user terminal was reused.
- Invalid JSON/provenance, nonzero CLI exit, missing completion event, revoked
  permissions and oversized input do not write AI results. Concurrent human
  edits remain intact; conflicts are counted. Selection persists across restarts.
- Packaged preload can discover both ready WSL engines. The real Windows renderer
  also displays saved work; MCP remains six tools with the same permission gate.
- No OAuth token files were read/copied. Inherited API authentication variables
  are removed from child processes; the original official CLI owns login.

Source delivery manifest: Git tracked/untracked paths compared with an independent filesystem walk, 57 files and zero differences (exit code 0).

The browser screenshots use fictional data and an explicit demo banner. Live
checks use a private isolated profile outside the repository. Test cards are
explicitly labelled as verification data and are not stored in the user's real
work board. No real chat text, identifiers, profile backups or screenshots are
published. Real-chat verification logs contain counts and booleans only. Model-runner validation uses synthetic messages only.

Tested host: Windows 11 x64 build 26200, LINE 26.5.0.3975, Electron 45.1.0,
bundled Node 24.22.0, embedded CPython 3.13.17 and upstream reader 3.3.8.

## Remaining limits

- No clean Windows VM or different LINE versions/accounts tested.
- Unsigned preview; no automatic updater, scheduler or message sender.
- The model runner requires a compatible official CLI and subscription login. Web
  login alone is insufficient. There is no automatic provider or API-key fallback.
- Per-run input limits: 1,000 messages, 300 tasks, 120,000 characters; output 100
  changes; model timeout 10 minutes. Large requests must use a narrower scope.
- Native Windows Claude 2.0.69 was detected as needing an update. End-to-end model
  inference was tested through Windows → WSL with Codex 0.165.0 and Claude 2.1.314,
  not a new Windows-native installation of either current engine.
- Source-reference validation proves an observed message exists; it does not prove
  the model interpreted it correctly. No model-accuracy benchmark is claimed.
- Stable work keys deduplicate retries. Semantic matching remains the Agent's job;
  the user can merge duplicates within a room.
- The shared rules and corrections are portable work state, not model fine-tuning
  or a universal import of an Agent's private memories.
- Some contacts cannot be resolved from the local index. There is no GUI fallback.
- Local cache can be incomplete; an empty result is not proof of no conversation.

See [RELEASING.md](RELEASING.md) for repeatable packaging and upgrade checks.
