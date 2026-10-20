"""Validate exported installers with independent libarchive and 7-Zip readers.

This checks archive integrity and payloads; it does not run native installers.
Linux dependencies: libarchive.so.13 and electron-builder's downloaded 7zz.
"""
from __future__ import annotations
import ctypes as C
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import stat
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release/installers'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
LIB = C.CDLL('libarchive.so.13')


def bind(name, result, *args):
    fn = getattr(LIB, name)
    fn.restype, fn.argtypes = result, args
    return fn


new = bind('archive_read_new', C.c_void_p)
filters = bind('archive_read_support_filter_all', C.c_int, C.c_void_p)
formats = bind('archive_read_support_format_all', C.c_int, C.c_void_p)
open_file = bind('archive_read_open_filename', C.c_int, C.c_void_p, C.c_char_p, C.c_size_t)
next_entry = bind('archive_read_next_header', C.c_int, C.c_void_p, C.POINTER(C.c_void_p))
read_block = bind('archive_read_data_block', C.c_int, C.c_void_p, C.POINTER(C.c_void_p), C.POINTER(C.c_size_t), C.POINTER(C.c_longlong))
free = bind('archive_read_free', C.c_int, C.c_void_p)
error = bind('archive_error_string', C.c_char_p, C.c_void_p)
pathname = bind('archive_entry_pathname', C.c_char_p, C.c_void_p)
mode = bind('archive_entry_mode', C.c_uint, C.c_void_p)
uid = bind('archive_entry_uid', C.c_longlong, C.c_void_p)
gid = bind('archive_entry_gid', C.c_longlong, C.c_void_p)
symlink = bind('archive_entry_symlink', C.c_char_p, C.c_void_p)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def bom_paths(path):
    # Read the documented BOM B-tree directly. bomutils' lsbom at the pinned
    # commit has an inverted Paths-name condition and crashes on BomInfo.
    data = path.read_bytes()
    magic, version, _, table, _, variables, _ = struct.unpack_from('>8s6I', data)
    require(magic == b'BOMStore' and version == 1, 'Invalid BOM header')
    blocks = struct.unpack_from('>I', data, table)[0]

    def block(index):
        require(0 < index < blocks, 'Invalid BOM block index')
        start, size = struct.unpack_from('>II', data, table + 4 + index * 8)
        require(start + size <= len(data), 'Invalid BOM block bounds')
        return data[start:start + size]

    count = struct.unpack_from('>I', data, variables)[0]
    cursor, tree = variables + 4, None
    for _ in range(count):
        index, length = struct.unpack_from('>IB', data, cursor)
        if data[cursor + 5:cursor + 5 + length] == b'Paths':
            tree = block(index)
        cursor += 5 + length
    require(tree is not None and tree[:4] == b'tree', 'Missing BOM Paths tree')
    nodes, visited = {}, set()

    def walk(index):
        require(index not in visited, 'Cycle in BOM tree')
        visited.add(index)
        leaf = block(index)
        is_leaf, count = struct.unpack_from('>HH', leaf)
        for position in range(count):
            value, key = struct.unpack_from('>II', leaf, 12 + position * 8)
            if not is_leaf:
                walk(value)
                continue
            ident, _ = struct.unpack_from('>II', block(value))
            file = block(key)
            parent = struct.unpack_from('>I', file)[0]
            name = file[4:].split(b'\0', 1)[0].decode('utf-8')
            require(ident not in nodes, 'Duplicate BOM path ID')
            nodes[ident] = (parent, name)

    walk(struct.unpack_from('>I', tree, 8)[0])
    require(len(nodes) == struct.unpack_from('>I', tree, 16)[0], 'Wrong BOM path count')
    result = set()
    for ident in nodes:
        parts, parents = [], set()
        while ident:
            require(ident not in parents and ident in nodes, 'Invalid BOM parent chain')
            parents.add(ident)
            ident, name = nodes[ident]
            parts.insert(0, name)
        result.add(PurePosixPath(*parts).as_posix())
    return result


def archive(path, visitor):
    handle = new()
    try:
        require(filters(handle) == 0 and formats(handle) == 0, 'libarchive setup failed')
        require(open_file(handle, os.fsencode(path), 1024 * 1024) == 0, f'Cannot open {path}')
        entry = C.c_void_p()
        while True:
            status = next_entry(handle, C.byref(entry))
            if status == 1:
                break
            require(status == 0, f'Archive header failed: {error(handle)!r}')
            name = pathname(entry).decode('utf-8')
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts, f'Unsafe path: {name}')
            def blocks():
                position = 0
                while True:
                    buffer, size, offset = C.c_void_p(), C.c_size_t(), C.c_longlong()
                    status = read_block(handle, C.byref(buffer), C.byref(size), C.byref(offset))
                    if status == 1:
                        break
                    require(status == 0, f'Archive data failed: {error(handle)!r}')
                    require(offset.value == position, 'Unexpected sparse archive entry')
                    position += size.value
                    yield C.string_at(buffer, size.value)

            visitor(name, entry, blocks())
    finally:
        free(handle)


def verify_mac(arch):
    target = OUT / f'ClipSync-{VERSION}-macOS-{arch}.pkg'
    app = ROOT / f'release/ClipSync-darwin-{arch}/ClipSync.app'
    seen = set()
    with tempfile.TemporaryDirectory(prefix='clipsync-pkg-check-') as directory:
        work = Path(directory)

        def unpack(name, entry, blocks):
            require(name in ('Bom', 'PackageInfo', 'Payload') and name not in seen, f'Unexpected XAR member: {name}')
            seen.add(name)
            with (work / name).open('wb') as stream:
                for block in blocks:
                    stream.write(block)

        archive(target, unpack)
        require(seen == {'Bom', 'PackageInfo', 'Payload'}, 'Incomplete component package')
        from xml.etree import ElementTree as ET
        info = ET.parse(work / 'PackageInfo').getroot()
        require(info.attrib['identifier'] == 'dev.limfrog.clipsync' and info.attrib['version'] == VERSION, 'Wrong PKG identity')
        require(info.attrib['install-location'] == '/Applications', 'Wrong install location')
        paths = set()
        count = 0

        def check_payload(name, entry, blocks):
            nonlocal count
            relative = PurePosixPath(name).as_posix()
            require(relative not in paths, f'Duplicate payload path: {relative}')
            paths.add(relative)
            require(uid(entry) == 0 and gid(entry) == 80, 'Wrong payload ownership')
            count += 1
            if relative == '.':
                require(stat.S_ISDIR(mode(entry)), 'Missing root directory')
                return
            require(relative == 'ClipSync.app' or relative.startswith('ClipSync.app/'), 'Unexpected install path')
            source = app.parent / relative
            require(source.resolve().is_relative_to(app.resolve()), f'External payload link: {relative}')
            if stat.S_ISLNK(mode(entry)):
                require(source.is_symlink() and symlink(entry).decode('utf-8') == os.readlink(source), f'Changed symlink: {relative}')
            elif stat.S_ISDIR(mode(entry)):
                require(source.is_dir() and mode(entry) & 0o777 == 0o755, f'Wrong directory: {relative}')
            else:
                require(stat.S_ISREG(mode(entry)) and source.is_file(), f'Unexpected payload type: {relative}')
                digest = hashlib.sha256()
                for block in blocks:
                    digest.update(block)
                require(digest.hexdigest() == sha(source), f'Payload differs from signed app: {relative}')
                expected_mode = 0o755 if source.stat().st_mode & 0o111 else 0o644
                require(mode(entry) & 0o777 == expected_mode, f'Wrong file permissions: {relative}')

        archive(work / 'Payload', check_payload)
        require(count == int(info.find('payload').attrib['numberOfFiles']), 'Wrong payload file count')
        expected_paths = {'.', 'ClipSync.app'}
        for base, dirs, files in os.walk(app, followlinks=False):
            expected_paths.update((Path(base) / n).relative_to(app.parent).as_posix() for n in dirs + files)
        require(paths == expected_paths, 'Missing app payload entries')
        require(bom_paths(work / 'Bom') == paths, 'BOM paths differ from payload')
    main = app / 'Contents/MacOS/ClipSync'
    with main.open('rb') as stream:
        header = stream.read(8)
    require(struct.unpack('<II', header) == (0xFEEDFACF, 0x100000C if arch == 'arm64' else 0x1000007), 'Wrong CPU architecture')
    plist = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    require(plist['CFBundleIdentifier'] == 'dev.limfrog.clipsync' and plist['CFBundleShortVersionString'] == VERSION, 'Wrong app metadata')
    spec = importlib.util.spec_from_file_location('verify_macos_app', ROOT / 'scripts/verify-macos-app.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    integrity = verifier.verify_app(app)
    return {'file': target.name, 'bytes': target.stat().st_size, 'sha256': sha(target), 'payloadEntries': count,
            'minimumMacOS': plist.get('LSMinimumSystemVersion'), 'adHocIntegrity': integrity, 'nativeInstallTested': False}


def verify_windows():
    target = OUT / f'ClipSync-{VERSION}-Windows-x64-Setup.exe'
    cache = Path(os.environ.get('ELECTRON_BUILDER_CACHE', '/workspace/.cache/electron-builder'))
    seven = next(cache.glob('7zip@*/7zip-linux-x64-*/bin/7zz'))
    subprocess.run([str(seven), 't', str(target)], check=True, stdout=subprocess.DEVNULL)
    with tempfile.TemporaryDirectory(prefix='clipsync-win-check-') as directory:
        subprocess.run([str(seven), 'x', '-y', f'-o{directory}', str(target)], check=True, stdout=subprocess.DEVNULL)
        dest = Path(directory)
        source = OUT / 'win-unpacked'
        files = [file for file in source.rglob('*') if file.is_file()]
        for file in files:
            require(sha(file) == sha(dest / file.relative_to(source)), f'Windows payload differs: {file.name}')
        require((dest / 'Uninstall ClipSync.exe').exists(), 'Missing generated uninstaller')
        with (dest / 'ClipSync.exe').open('rb') as stream:
            require(stream.read(2) == b'MZ', 'Missing Windows executable')
            stream.seek(0x3c)
            offset = struct.unpack('<I', stream.read(4))[0]
            stream.seek(offset)
            require(stream.read(6) == b'PE\0\0\x64\x86', 'Wrong Windows CPU architecture')
    return {'file': target.name, 'bytes': target.stat().st_size, 'sha256': sha(target),
            'payloadFilesCompared': len(files), 'nativeInstallTested': False}


def main():
    results = [verify_windows(), verify_mac('arm64'), verify_mac('x64')]
    report = {'validatedAt': datetime.now(timezone.utc).isoformat(), 'version': VERSION,
              'platform': 'Linux x86_64', 'trustedPublisherSigned': False, 'appleNotarized': False, 'installers': results}
    (OUT / 'installer-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'SHA256SUMS.txt').write_text(''.join(f"{result['sha256']}  {result['file']}\n" for result in results))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
