# 0.3.1 Preview validation

Validation date: 2026-10-31 (Asia/Taipei).

## Checks repeated for this release

| Check                                     | Evidence                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core tests on Linux                       | 47 passed, 0 failed; actual exit code 0                                                                                                                                                               |
| Core tests on native Windows Node 24.22.0 | 46 passed, 0 failed, 1 Linux shell test skipped; actual exit code 0                                                                                                                                   |
| Production build                          | TypeScript, Vite UI and standalone MCP bundle; actual exit code 0                                                                                                                                     |
| Browser interactions                      | Board, dates, human edits, evidence, permissions, AI selection/start/cancel and manual-path add/remove; 390 px layout; zero page errors; actual exit code 0                                           |
| Windows installation discovery            | Native npm Claude Code 2.1.314 resolves through declared `bin/claude.exe`; WSL Claude Code 2.1.314 and Codex 0.165.0 also found                                                                       |
| Windows → WSL cancellation                | Dedicated process group stopped; Linux PID confirmed absent after completion; actual validation exit code 0                                                                                           |
| Windows packaging                         | NSIS installer and portable ZIP built successfully; actual exit code 0                                                                                                                                |
| Packaged and installed desktop            | Both real Windows executables discovered native Claude and two WSL CLIs; six MCP tools, three isolated test cards rendered through real preload/SQLite; both exit codes 0                             |
| Upgrade from v0.3.0                       | Installed at the registered destination; settings.json, work.sqlite and assistant/selection.json byte-identical before/after; four authorized rooms and access state preserved; installer exit code 0 |
| Installed source and bridge               | Independently enumerated 20 application files match ASAR names and SHA-256; bridge matches build output; packaged version 0.3.1 and retained metadata verified; exit code 0                           |
| Portable ZIP                              | 460 entries matched an independent directory walk; every file hash matched; finalization exit code 0                                                                                                  |
| Existing WSL MCP connection               | Installed Windows bridge still exposes six tools and the same four authorized rooms; no messages read; exit code 0                                                                                    |
| Reopened user application                 | One visible installed window and one correct desktop shortcut; both verification exit codes 0                                                                                                         |

The regression suite covers npm changing from JavaScript to a native entry,
multiple installed versions, registry PATH newer than the application environment,
custom/Unicode paths, declared package entries, corrupt/missing entries, desktop
aliases, WSL records, UTF-16 distro names, probe failures/timeouts, stopped scans,
manual-path persistence/removal and missing selections. A rejected cached login
changes that candidate to login-required and prevents another run until rechecked.

The installation-layout matrix uses synthetic directories and mocked probe results;
it is not a claim that every listed package manager was installed on a clean PC.
See [DETECTION.md](DETECTION.md) for search scope and diagnostic states.

## Actual model requests

Each test used a synthetic one-message conversation and a separate private work
profile. No test cards were written to the user's real work board.

- Windows → WSL Claude Code 2.1.314: CLI exit 0; one card written and its observed
  source text verified.
- Windows → WSL Codex 0.165.0: CLI exit 0; one card written and its observed source
  text verified.
- Native Windows Claude Code 2.1.314: discovery, version, required flags and cached
  subscription login checks passed. The actual service request exited 1 with
  `401 OAuth access token is invalid`; no card was written. This account needs to
  sign in again. Native Windows inference is **not** marked as passed.
- The combined three-candidate live validation exited **1** because of that
  authentication failure. Successful discovery alone does not verify live access.

No OAuth token files were read or copied. Login remains inside the official CLI.
Inherited API authentication overrides are removed from the child environment.

## Earlier baseline

The [v0.3.0 validation record](https://github.com/wsxqaza12/line-agent-desktop/blob/v0.3.0/docs/VALIDATION.md)
includes a 20-message authorized LINE read, packaged MCP source writeback,
human-field locking, revocation in the same process, the v0.2 → v0.3 upgrade and
skill validation. Those live-chat checks are retained as the earlier baseline;
they were not rerun against real conversations for this detection-only update.
The corresponding permission, provenance, concurrency and work-lifecycle unit
tests were rerun above.

Tested desktop host: Windows 11 x64 build 26200, LINE 26.5.0.3975,
Electron 45.1.0, bundled Node 24.22.0, embedded CPython 3.13.17,
upstream reader 3.3.8 and Ubuntu WSL. CI runs tests/build on Linux and Windows;
the browser suite runs on Linux.

## Remaining limits

- No clean Windows GUI installation or different LINE versions/accounts tested.
  Hosted Windows CI verifies tests/build, not a signed-in LINE/AI installation.
- Native Windows inference still needs a valid CLI subscription login. There is
  no automatic provider or API-key fallback.
- Unsigned preview; no automatic updater, scheduler or message sender.
- Manual selection covers custom locations. Automatic searches are bounded:
  8 WSL distros and 24 candidates, with visible notes when limited/interrupted.
- Per-run input limits remain 1,000 messages, 300 tasks and 120,000 characters;
  output is limited to 100 changes and model execution to 10 minutes.
- Source checks prove the cited message was observed, not that the model's
  interpretation is correct. Semantic deduplication remains the Agent's job.
- Shared rules are portable work preferences, not model fine-tuning or an import
  of every Agent's private memories.
- Some contacts cannot be resolved from LINE's local index. There is no GUI
  fallback, and an empty local result does not prove no conversation exists.

Screenshots in the repository use fictional demo data. Private profiles,
credentials, real chat text/identifiers, logs and profile backups are excluded
from the source repository and release assets.

Delivery lists were derived twice: Git tracked/untracked paths versus an
independent filesystem walk (60 source files), and Git diff versus comparisons
with HEAD file contents (24 changed files). Both differences were zero; the
manifest check exited 0. Installed ASAR contained no private profile files.

See [RELEASING.md](RELEASING.md) for packaging and upgrade checks.
