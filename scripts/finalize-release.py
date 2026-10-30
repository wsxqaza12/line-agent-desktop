"""Normalize the portable ZIP after NSIS finishes, then verify and checksum it.

electron-builder deliberately adds resources/elevate.exe to win-unpacked at
finalization, after the original ZIP is made. Rebuild ZIP after both targets
complete so its manifest exactly matches win-unpacked. Only package.json and
release artifacts are read; no user settings or chat data are accessed.
"""
import hashlib
import json
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RELEASE = ROOT / 'release'
APP = RELEASE / 'win-unpacked'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
ZIP = RELEASE / f'LINE-Agent-Desktop-{VERSION}-x64.zip'


def digest(stream):
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()


def main():
    if not (APP / 'LINE Agent Desktop.exe').is_file():
        raise SystemExit('Run the Windows packager first.')
    files = sorted(p for p in APP.rglob('*') if p.is_file())
    temp = ZIP.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in files:
            z.write(p, p.relative_to(APP).as_posix())
    temp.replace(ZIP)
    # Independent route: os.walk, not the rglob list used for construction.
    expected = set()
    for directory, _, names in os.walk(APP):
        for name in names:
            expected.add((Path(directory) / name).relative_to(APP).as_posix())
    with zipfile.ZipFile(ZIP) as z:
        actual = [p.filename for p in z.infolist() if not p.is_dir()]
        if len(actual) != len(set(actual)) or set(actual) != expected:
            raise SystemExit('ZIP/directory manifest mismatch')
        for name in actual:
            with z.open(name) as entry, (APP / name).open('rb') as local:
                if digest(entry) != digest(local):
                    raise SystemExit('ZIP content mismatch: ' + name)
    print(f'ZIP vs independent directory walk: {len(expected)} files, all SHA-256 hashes match.', flush=True)
    sums = []
    for p in [RELEASE / f'LINE-Agent-Desktop-{VERSION}-x64.exe', ZIP]:
        with p.open('rb') as source:
            sha = digest(source)
        sums.append(f'{sha}  {p.name}')
        print(f'{p.name}: {p.stat().st_size} bytes; SHA-256 {sha}', flush=True)
    (RELEASE / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n')
    (RELEASE / 'verification.json').write_text(json.dumps({
        'packageFiles': len(expected), 'zipDirectoryNamesMatch': True,
        'allExtractedFileHashesMatch': True,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
