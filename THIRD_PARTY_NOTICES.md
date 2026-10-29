# Third-party components

LINE Agent Desktop is an independent community project, not affiliated with LINE.
The desktop UI, permission layer and packaging code use the MIT license in LICENSE.

The LINE reader is **bensonmaxai/line-desktop-mcp v3.3.8**, commit
`097324e678e6dba60a4c4e187054f8b7397a9100`, based on **dtwang/line-desktop-mcp**.
Reader functionality belongs to those upstream authors. The runtime preparation
script preserves their source, `LICENSE.md` and `docs/THIRD_PARTY.md` without
modification. See https://github.com/bensonmaxai/line-desktop-mcp .

The downloadable Windows package includes separately licensed components:

| Component                                              | Notice included in the package                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| LINE reader (MIT)                                      | resources/runtime/vendor/LICENSE.md and docs/THIRD_PARTY.md                        |
| SQLite3MultipleCiphers 2.5.1 (MIT and bundled notices) | resources/runtime/sqlite/LICENSE, LICENSE.spdx and THIRD_PARTY.md                  |
| Node.js 24.22.0                                        | resources/runtime/node/LICENSE                                                     |
| CPython 3.13.17                                        | resources/runtime/python/LICENSE.txt                                               |
| cryptography 50.0.2                                    | resources/runtime/python/Lib/site-packages/cryptography-50.0.2.dist-info/licenses/ |
| Pillow 12.3.0                                          | resources/runtime/python/Lib/site-packages/pillow-12.3.0.dist-info/licenses/       |
| cffi / pycparser                                       | Their .dist-info license files in resources/runtime/python/Lib/site-packages/      |
| Electron / Chromium                                    | LICENSE.electron.txt and LICENSES.chromium.html beside the executable              |
| JavaScript dependencies                                | resources/bridge/THIRD_PARTY_LICENSES.txt                                          |

All runtime download URLs and SHA-256 hashes are recorded in runtime-lock.json.
No CUA, AutoHotkey or message-sending automation is included in this version.
Artwork is original SVG/CSS geometry; no official LINE logo or private chat
screenshots are used. Demo names and messages are fictional.
