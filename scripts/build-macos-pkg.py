"""Create an unsigned Apple flat component PKG with an ad-hoc signed app.

XAR format: Apple libxar header + compressed TOC + checked heap members.
Payload format: gzip-compressed POSIX odc cpio, matching pkgbuild's payload.
An actual macOS installation still needs native Installer/Gatekeeper validation.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('CLIPSYNC_INSTALLER_TOOLS', '/workspace/.cache/clipsync-installer-tools'))
RCODESIGN = TOOLS / 'rcodesign/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign'
MKBOM = TOOLS / 'bomutils/build/bin/mkbom'


def run(args: list[str], log: Path | None = None):
    if log:
        with log.open('w') as stream:
            result = subprocess.run(args, stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode:
            print(log.read_text()[-6000:])
        result.check_returncode()
    else:
        subprocess.run(args, check=True)


def sign_app(app: Path, log: Path):
    for base, dirs, files in os.walk(app, followlinks=False):
        for name in dirs + files:
            p = Path(base) / name
            if p.is_symlink():
                # Bundles contain relative framework aliases, never external links.
                if not p.resolve().is_relative_to(app.resolve()):
                    raise ValueError(f'External app symlink: {p}')
                continue
            mode = p.stat().st_mode
            p.chmod(0o755 if p.is_dir() or mode & 0o111 else 0o644)
    app.chmod(0o755)
    entitlements = str(ROOT / 'build/entitlements.mac.plist')
    args = [str(RCODESIGN), 'sign', '--timestamp-url', 'none', '--entitlements-xml-file', entitlements]
    for nested in sorted(app.rglob('*.app')):
        if not nested.is_symlink():
            args += ['--entitlements-xml-file', f'{nested.relative_to(app)}:{entitlements}']
    run(args + [str(app)], log)
    # The signer preserves payload bytes, but normalize new metadata permissions too.
    for base, _, files in os.walk(app, followlinks=False):
        for name in files:
            p = Path(base) / name
            if p.is_symlink():
                continue
            with p.open('rb') as stream:
                magic = stream.read(4)
            p.chmod(0o755 if magic in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe') or p.stat().st_mode & 0o111 else 0o644)
    for base, _, _ in os.walk(app, followlinks=False):
        Path(base).chmod(0o755)
    # rcodesign 0.29's generic verifier tries to parse an empty CMS even for
    # ad-hoc signatures. Independently verify page hashes and all resource slots.
    spec = importlib.util.spec_from_file_location('verify_macos_app', ROOT / 'scripts/verify-macos-app.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    verifier.verify_app(app)


def entries(root: Path):
    yield root
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            yield Path(base) / name


def cpio_payload(root: Path, output: Path):
    paths = list(entries(root))
    total = 0
    with output.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as archive:
        def header(name, inode, mode, size, mtime=0):
            encoded = name.encode('utf-8') + b'\0'
            fields = f'070707{0:06o}{inode:06o}{mode:06o}{0:06o}{80:06o}{1:06o}{0:06o}{mtime:011o}{len(encoded):06o}{size:011o}'
            assert len(fields) == 76
            archive.write(fields.encode('ascii'))
            archive.write(encoded)

        for inode, p in enumerate(paths, 1):
            st = p.lstat()
            name = '.' if p == root else './' + p.relative_to(root).as_posix()
            if p.is_symlink():
                data = os.readlink(p).encode('utf-8')
                header(name, inode, stat.S_IFLNK | 0o777, len(data), int(st.st_mtime))
                archive.write(data)
            elif p.is_dir():
                header(name, inode, stat.S_IFDIR | 0o755, 0, int(st.st_mtime))
            else:
                mode = 0o755 if st.st_mode & 0o111 else 0o644
                header(name, inode, stat.S_IFREG | mode, st.st_size, int(st.st_mtime))
                with p.open('rb') as source:
                    shutil.copyfileobj(source, archive, 1024 * 1024)
                total += st.st_size
        header('TRAILER!!!', 0, 0, 0)
    return len(paths), total


def xar_archive(files: list[Path], output: Path):
    root = ET.Element('xar')
    toc = ET.SubElement(root, 'toc')
    ET.SubElement(toc, 'creation-time').text = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    checksum = ET.SubElement(toc, 'checksum', style='sha1')
    ET.SubElement(checksum, 'offset').text = '0'
    ET.SubElement(checksum, 'size').text = '20'
    offset = 20
    for index, file in enumerate(files, 1):
        size = file.stat().st_size
        with file.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        entry = ET.SubElement(toc, 'file', id=str(index))
        for tag, value in [('name', file.name), ('type', 'file'), ('mode', '0644'), ('uid', '0'), ('gid', '0')]:
            ET.SubElement(entry, tag).text = value
        data = ET.SubElement(entry, 'data')
        for tag, value in [('length', size), ('offset', offset), ('size', size)]:
            ET.SubElement(data, tag).text = str(value)
        ET.SubElement(data, 'encoding', style='application/octet-stream')
        for kind in ['archived-checksum', 'extracted-checksum']:
            ET.SubElement(data, kind, style='sha256').text = digest
        offset += size
    xml = ET.tostring(root, encoding='UTF-8', xml_declaration=True)
    compressed = zlib.compress(xml, 9)
    with output.open('wb') as archive:
        archive.write(struct.pack('>IHHQQI', 0x78617221, 28, 1, len(compressed), len(xml), 1))
        archive.write(compressed)
        archive.write(hashlib.sha1(compressed).digest())
        for file in files:
            with file.open('rb') as source:
                shutil.copyfileobj(source, archive, 1024 * 1024)


def main():
    if not RCODESIGN.is_file() or not MKBOM.is_file():
        raise SystemExit('Run bash scripts/setup-installer-tools.sh first.')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    out = ROOT / 'release/installers'
    out.mkdir(parents=True, exist_ok=True)
    for arch in ['arm64', 'x64']:
        app = ROOT / f'release/ClipSync-darwin-{arch}/ClipSync.app'
        if not app.is_dir():
            raise SystemExit(f'Missing app: {app}; run node scripts/build-mac-apps.mjs')
        sign_app(app, out / f'macOS-{arch}-sign.log')
        with tempfile.TemporaryDirectory(prefix=f'clipsync-pkg-{arch}-') as temp:
            work = Path(temp)
            payload_root = work / 'root'
            payload_root.mkdir(mode=0o755)
            shutil.copytree(app, payload_root / app.name, symlinks=True)
            count, size = cpio_payload(payload_root, work / 'Payload')
            run([str(MKBOM), '-u', '0', '-g', '80', str(payload_root), str(work / 'Bom')])
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            package = ET.Element('pkg-info', {'format-version': '2', 'identifier': 'dev.limfrog.clipsync', 'version': version, 'install-location': '/Applications', 'auth': 'root', 'relocatable': 'false'})
            ET.SubElement(package, 'payload', {'installKBytes': str((size + 1023) // 1024), 'numberOfFiles': str(count)})
            bundle_version = ET.SubElement(package, 'bundle-version')
            ET.SubElement(bundle_version, 'bundle', {'id': info['CFBundleIdentifier'], 'path': './ClipSync.app', 'CFBundleVersion': info['CFBundleVersion'], 'CFBundleShortVersionString': info['CFBundleShortVersionString']})
            ET.SubElement(package, 'upgrade-bundle', {'id': info['CFBundleIdentifier']})
            ET.SubElement(package, 'atomic-update-bundle', {'id': info['CFBundleIdentifier']})
            (work / 'PackageInfo').write_bytes(ET.tostring(package, encoding='UTF-8', xml_declaration=True))
            target = out / f'ClipSync-{version}-macOS-{arch}.pkg'
            xar_archive([work / 'Bom', work / 'PackageInfo', work / 'Payload'], target)
            print('macOS installer:', target, f'({target.stat().st_size:,} bytes)', flush=True)


if __name__ == '__main__':
    main()
