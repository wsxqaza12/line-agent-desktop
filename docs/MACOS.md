# Mac preview validation

The Mac adapter is a native Swift executable using macOS Accessibility. It is
launched by the packaged desktop process so the app owns the Accessibility consent.
The standalone MCP process calls the desktop through a per-user Unix socket with a
random token in a mode-0600 file. It cannot discover or grant chat permissions.
Every socket read goes through LineService, including fresh permission checks and
post-read revocation checks. No TCP listener, scheduler or login startup is added.

Build on Apple Silicon with `npm run runtime:mac` and `npm run package:mac`.
Runtime download hashes come from Node's official SHASUMS256.txt. Packaging includes
Node's LICENSE, Electron notices and bundled dependency licenses. The Mac runtime
contains no Python, Windows DLLs, user settings, tokens or chat contents.

Required checks before distributing a build:

1. Run unit/access/MCP tests, TypeScript build and browser UI checks. Record actual
   exit codes. The Mac UI has a permission guide and an external-agent connection;
   Windows keeps its existing optional CLI runner.
2. Build the native helper and test discovery and read on LINE 26.6.0 using an
   authorized room. Do not save real message bodies in the repo or release.
3. Package DMG and ZIP; verify code signature and architecture. Ad-hoc signing is
   not a Developer ID signature or notarization. Do not bypass Gatekeeper globally.
4. Mount DMG read-only, copy app into Applications, compare bundle files/hashes,
   and launch the installed app with an isolated profile. The smoke check loads
   the real UI, SQLite work store, native status helper and stdio MCP handshake.
5. Grant Accessibility to the installed app. In a private, isolated profile,
   select a previously authorized room. Read via the packaged MCP; verify nonempty
   text, dates, account/session binding, snapshot pagination and observed receipts.
   Test pause/revocation without restarting MCP and work-item writeback using only
   synthetic tasks in the isolated profile. Delete no user tasks or settings.
6. Close and reopen the installed app, verify data survives and the socket/token
   are renewed. Test the existing user's profile separately; do not overwrite it.
7. Derive the source manifest twice (Git and filesystem walk), diff and report its
   count. Compare the DMG/ZIP app trees independently and verify checksums after
   copying the installer. Disclose tests not completed and any consent still needed.

Scope: only rows currently loaded in LINE's window; no automatic scrollback.
Rows without explicit supported date/time labels are omitted and counted. The
system timezone must be Asia/Taipei. This first reader is restricted to traditional
Chinese LINE 26.6.0. Sender identity is unverified except the native outgoing
read-receipt suffix. Never infer a user commitment from an unknown sender.

Account identity is a hash of the .edb paths actually open by the LINE process,
not a read of their contents. A separate binding pins the process launch session;
after restarting LINE the user must reload and save permissions. Room identity is
account + exact displayed name + type; UI automation cannot provide immutable
server IDs. Duplicate or incomplete matches fail closed. A future database adapter
could improve this, but database key extraction is not shipped in this build.

The helper uses only discovered AX elements for clicks, checks foreground/window
bounds and confirms the exact room header before and after reading. It never
edits a message composer, posts keyboard events, accesses the clipboard or sends
a message. GUI reads can still mark a chat as read and temporarily move focus.

## Recorded validation — 2026-11-06

Environment: Apple M4, macOS 15.6, traditional Chinese LINE 26.6.0, bundled Node
24.22.0 and Electron 45.1.0. The native helper and application are arm64.

- Unit/access/MCP tests: 55 passed on Linux and 55 on Mac, exit 0. The Mac suite
  includes different TMPDIR values between the desktop app and an MCP client.
- TypeScript/Vite/bridge build and browser UI checks: exit 0. Existing Windows
  flows and the Mac permission/external-agent UI were exercised.
- Native reader: authorized discovery, dated message text, snapshot pagination,
  source references and pause checks passed, exit 0.
- DMG/ZIP packaging: exit 0. All 289 bundle files/symlinks matched between DMG,
  ZIP and the app copied to Applications. `codesign --verify --deep --strict`
  returned 0. This checks ad-hoc signature integrity, not notarization.
- Source manifest: 71 files cross-checked using Git and an independent filesystem
  walk. All 17 bundled core/Electron source files, the MCP bridge and the native
  source hash matched the build checkout.
- Installed app under the test launcher: real stdio MCP read, observed-source
  work writeback in an isolated profile, pause, in-flight revocation and app restart
  persistence passed, exit 0. No real tasks were changed in the user's profile.
- Normal LaunchServices startup: UI, SQLite and six-tool MCP handshake passed;
  Accessibility was **not yet granted in that launch context**. A test launcher's
  permission is not proof of normal app permission. Normal-launch message reading
  remains pending explicit macOS permission and the final integration check.

The tested installers are not notarized. A clean-machine Gatekeeper download test,
Intel Macs, other LINE versions/locales, and older supported macOS versions have not
been verified. Do not advertise those as tested configurations.
