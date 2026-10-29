# Release procedure

1. Run `npm ci --ignore-scripts` in an isolated checkout. Before replacing an
   existing node_modules directory, check whether it is shared or a symlink.
2. Run `npm test`, `npm run build` and `npm run test:ui`. Inspect actual exit codes.
3. Run `py scripts/prepare-runtime.py` on Windows (or `python3` on Linux).
   All artifact hashes must match runtime-lock.json. Keep dependency notices.
4. On Windows run `npm run package:win` and wait for exit code 0.
5. Launch the unpacked executable with `--smoke-test <absolute-output-directory>`
   and `LINE_AGENT_HOME` set to an isolated test profile. This bounded check loads
   the real packaged UI, calls the preload bridge, checks LINE status and performs
   a real MCP handshake. It never discovers chats or reads messages. It must exit 0.
6. In an authorized local test profile, read a known chat through the packaged MCP.
   Check nonempty results, chat/account identity, source references, and revocation
   without restarting the MCP. Do not copy real chat data into this repository.
7. Test the installer in a new destination; verify launch, bundled runtime and
   generated connection paths from that destination. A new destination on an
   existing PC is not a clean Windows VM test; disclose that distinction.
8. Rebuild after any packaged source or runtime change. Run
   `py scripts/finalize-release.py` after the builder exits. This rebuilds the ZIP
   after NSIS adds its elevation helper, compares ZIP entries with an independent
   directory walk and verifies every extracted file hash. It also writes checksums.
9. Derive the source delivery file list with `git ls-files` and independently with
   a filesystem walk (excluding generated/ignored directories). Diff them, report
   the count and investigate missing scripts/docs/public/config files.
10. Scan tracked source, demo screenshots and release archives for private data.
    Publish only synthetic screenshots. Generate SHA256SUMS.txt for EXE and ZIP.
11. Create a GitHub prerelease, upload EXE, ZIP and checksums, then fetch release
    metadata to verify visibility, asset names and byte sizes. Do not claim code
    signing, clean-machine support, or LINE builds that were not tested.

No background poller, Windows scheduled task, auto-start or automatic updater is
installed. Uninstalling preserves the app's settings; the user can remove them
from the settings folder if desired. Remove the MCP entry from the Agent when
uninstalling. A running MCP process may continue until that Agent closes it.

Runtime source provenance:

- Node archive hash: Node's official SHASUMS256.txt.
- Python embeddable archive: pinned HTTPS python.org download; SHA-256 locked
  from the initial download (not an independently verified publisher signature).
- Reader: GitHub commit pinned from the v3.3.8 tag; archive SHA-256 locked.
- SQLite archive and DLL: upstream reader's required hashes.
- Python wheels: exact filename and SHA-256 from PyPI's release metadata.
