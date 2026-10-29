"""Prepare pinned Windows runtimes without installing anything globally.

Run on Linux/WSL with Python 3, or Windows with `py scripts/prepare-runtime.py`.
Every artifact is HTTPS + SHA-256 pinned in runtime-lock.json. Runtime assets
and private user settings are deliberately outside git.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'runtime-lock.json').read_text())
CACHE = ROOT / '.downloads'
DEST = ROOT / 'runtime'


def download(item):
    name, spec = item
    file = CACHE / spec['archive']
    if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != spec['sha256']:
        if not spec['url'].startswith('https://'):
            raise ValueError('HTTPS required')
        with urllib.request.urlopen(spec['url'], timeout=90) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != spec['sha256']:
            raise ValueError(f'{name}: archive hash mismatch')
        file.write_bytes(content)
    print(f'Verified {name}', flush=True)
    return name, file


def extract(archive, dest, strip_first=False, include=None):
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            rel = pathlib.PurePosixPath(entry.filename)
            if rel.is_absolute() or '..' in rel.parts or '\\' in entry.filename or ':' in entry.filename:
                raise ValueError('Unsafe archive path')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Archive symlink refused')
            if strip_first:
                rel = pathlib.PurePosixPath(*rel.parts[1:])
            if not rel.parts or (include and not include(rel)):
                continue
            target = dest.joinpath(*rel.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(entry))


def main():
    CACHE.mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        files = dict(pool.map(download, LOCK['artifacts'].items()))
    # Build in a disposable directory; never alter an existing runtime in place.
    with tempfile.TemporaryDirectory(prefix='line-agent-runtime-') as tmp:
        out = pathlib.Path(tmp)
        extract(files['node'], out / 'node', strip_first=True,
                include=lambda p: str(p) in ['node.exe', 'LICENSE'])
        extract(files['python'], out / 'python')
        for name in ['cryptography', 'pillow', 'cffi', 'pycparser']:
            extract(files[name], out / 'python' / 'Lib' / 'site-packages')
        (out / 'python' / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../vendor/src/extensions/python\nimport site\n')
        extract(files['vendor'], out / 'vendor', strip_first=True,
                include=lambda p: p.parts[0] in ['src', 'package.json', 'LICENSE.md'] or str(p) == 'docs/THIRD_PARTY.md')
        extract(files['sqlite'], out / 'sqlite-dist')
        dlls = list((out / 'sqlite-dist').rglob('sqlite3mc_x64.dll'))
        if len(dlls) != 1 or hashlib.sha256(dlls[0].read_bytes()).hexdigest() != LOCK['sqliteDllSha256']:
            raise ValueError('SQLite DLL hash mismatch')
        (out / 'sqlite').mkdir()
        shutil.copy2(dlls[0], out / 'sqlite' / 'sqlite3mc_x64.dll')
        for name in ['LICENSE', 'LICENSE.spdx', 'README.md']:
            shutil.copy2(out / 'sqlite-dist' / name, out / 'sqlite' / name)
        # Upstream notices include the exact SQLite MIT copyright/permission notice.
        shutil.copy2(out / 'vendor/docs/THIRD_PARTY.md', out / 'sqlite/THIRD_PARTY.md')
        shutil.rmtree(out / 'sqlite-dist')
        shutil.copy2(ROOT / 'runtime-lock.json', out / 'runtime-lock.json')
        shutil.copy2(ROOT / 'THIRD_PARTY_NOTICES.md', out / 'THIRD_PARTY_NOTICES.md')
        if DEST.exists():
            raise SystemExit('runtime/ already exists. Move it aside before rebuilding; nothing was overwritten.')
        shutil.copytree(out, DEST)
    print('Windows runtime prepared. No global packages or startup tasks were changed.', flush=True)


if __name__ == '__main__':
    main()
