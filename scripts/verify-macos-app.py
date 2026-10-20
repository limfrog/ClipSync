"""Verify ad-hoc Mach-O page hashes, special slots and bundle resources.

Ad-hoc code intentionally has an empty CMS slot (no identity certificate).
This checks integrity, not Developer ID trust or Gatekeeper/notarization.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import plistlib
import struct
import sys

MAGICS = (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def chunks(data):
    if data[:4] in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        count = struct.unpack_from('>I', data, 4)[0]
        require(0 < count < 16, 'Invalid fat Mach-O architecture count')
        wide = data[:4] == b'\xca\xfe\xba\xbf'
        for index in range(count):
            fields = struct.unpack_from('>IIQQII' if wide else '>IIIII', data, 8 + index * (32 if wide else 20))
            offset, size = fields[2:4]
            require(offset + size <= len(data), 'Invalid fat Mach-O range')
            yield data[offset:offset + size]
    else:
        yield data


def code_signature(data):
    require(data[:4] in MAGICS[:2], 'Unsupported Mach-O format')
    cursor = 32 if data[:4] == MAGICS[0] else 28
    count = struct.unpack_from('<I', data, 16)[0]
    for _ in range(count):
        command, size = struct.unpack_from('<II', data, cursor)
        require(size >= 8 and cursor + size <= len(data), 'Invalid load command')
        if command == 29:
            offset, length = struct.unpack_from('<II', data, cursor + 8)
            require(offset + length <= len(data), 'Invalid code signature bounds')
            signature = data[offset:offset + length]
            magic, total, n = struct.unpack_from('>III', signature)
            require(magic == 0xFADE0CC0 and total <= length and n < 100, 'Invalid signature superblob')
            blobs = {}
            for index in range(n):
                kind, start = struct.unpack_from('>II', signature, 12 + index * 8)
                _, blob_size = struct.unpack_from('>II', signature, start)
                require(blob_size >= 8 and start + blob_size <= total, 'Invalid signature blob')
                blobs[kind] = signature[start:start + blob_size]
            return offset, blobs
        cursor += size
    raise ValueError('Mach-O has no code signature')


def digest_for(kind, data):
    require(kind in (1, 2, 3), f'Unsupported digest type: {kind}')
    return hashlib.sha1(data).digest() if kind == 1 else hashlib.sha256(data).digest()


def verify_macho(file):
    data = file.read_bytes()
    hashes = []
    for thin in chunks(data):
        signature_offset, blobs = code_signature(thin)
        directory = blobs[0]
        require(struct.unpack_from('>I', directory)[0] == 0xFADE0C02, 'Missing code directory')
        version, flags, hash_offset, _, special_count, code_count, limit = struct.unpack_from('>7I', directory, 8)
        require(flags & 2, f'Expected ad-hoc signature: {file}')
        hash_size, hash_type, _, page_shift = struct.unpack_from('4B', directory, 36)
        require(hash_size in (20, 32) and page_shift <= 20, 'Invalid signature digest parameters')
        if version >= 0x20300 and limit == 0xffffffff:
            limit = struct.unpack_from('>Q', directory, 56)[0]
        require(limit <= signature_offset, 'Code limit includes signature')
        page_size = 1 << page_shift
        require(code_count == (limit + page_size - 1) // page_size, 'Incorrect number of signed pages')
        for page in range(code_count):
            expected = directory[hash_offset + page * hash_size:hash_offset + (page + 1) * hash_size]
            actual = digest_for(hash_type, thin[page * page_size:min((page + 1) * page_size, limit)])[:hash_size]
            require(expected == actual, f'Code page mismatch: {file}, page {page}')
        for slot in range(1, special_count + 1):
            expected = directory[hash_offset - slot * hash_size:hash_offset - (slot - 1) * hash_size]
            if expected == bytes(hash_size):
                continue
            if slot in blobs:
                content = blobs[slot]
            elif slot == 1:
                candidates = [file.parent / 'Info.plist', file.parent.parent / 'Info.plist', file.parent / 'Resources/Info.plist']
                content = next((p.read_bytes() for p in candidates if p.is_file() and digest_for(hash_type, p.read_bytes())[:hash_size] == expected), None)
            elif slot == 3:
                candidates = [file.parent / '_CodeSignature/CodeResources', file.parent.parent / '_CodeSignature/CodeResources']
                content = next((p.read_bytes() for p in candidates if p.is_file() and digest_for(hash_type, p.read_bytes())[:hash_size] == expected), None)
            else:
                raise ValueError(f'Unknown nonempty signature slot {slot}: {file}')
            require(content is not None and digest_for(hash_type, content)[:hash_size] == expected, f'Special slot mismatch {slot}: {file}')
        if 65536 in blobs:
            require(blobs[65536] == bytes.fromhex('fade0b0100000008'), 'Unexpected CMS in ad-hoc signature')
        hashes.append(digest_for(hash_type, directory)[:20])
    return hashes


def bundle_executable(bundle):
    info_paths = [bundle / 'Contents/Info.plist', bundle / 'Resources/Info.plist']
    info_path = next((p for p in info_paths if p.is_file()), None)
    require(info_path is not None, f'Missing bundle Info.plist: {bundle}')
    info = plistlib.loads(info_path.read_bytes())
    executable = info.get('CFBundleExecutable')
    require(isinstance(executable, str), 'Missing CFBundleExecutable')
    candidate = bundle / 'Contents/MacOS' / executable if (bundle / 'Contents').is_dir() else bundle / executable
    return candidate.resolve()


def verify_app(app):
    app = Path(app).resolve()
    verified = {}
    for base, _, files in os.walk(app, followlinks=False):
        for name in files:
            file = Path(base) / name
            if file.is_symlink():
                continue
            with file.open('rb') as stream:
                magic = stream.read(4)
            if magic in MAGICS:
                verified[file.resolve()] = verify_macho(file)
    require(len(verified) >= 5, 'Expected Electron main binary, helpers and frameworks')
    resources_count = 0
    for resource in app.rglob('_CodeSignature/CodeResources'):
        base = resource.parent.parent
        info = plistlib.loads(resource.read_bytes())
        for relative, entry in info.get('files2', {}).items():
            target = base / relative
            require(target.resolve().is_relative_to(app), 'Bundle resource escapes the app')
            if 'symlink' in entry:
                require(target.is_symlink() and os.readlink(target) == entry['symlink'], f'Changed symlink: {target}')
            elif 'hash2' in entry or 'hash' in entry:
                require(target.is_file(), f'Missing signed resource: {target}')
                digest = hashlib.sha256 if 'hash2' in entry else hashlib.sha1
                with target.open('rb') as stream:
                    actual = hashlib.file_digest(stream, digest().name).digest()
                require(actual == entry.get('hash2', entry.get('hash')), f'Changed bundle resource: {target}')
            elif 'cdhash' in entry:
                nested = bundle_executable(target) if target.is_dir() else target.resolve()
                require(entry['cdhash'] in verified.get(nested, []), f'Changed nested signature: {target}')
            else:
                raise ValueError(f'Unsupported resource signature: {target}')
            resources_count += 1
    for bundle in [app, *app.rglob('*.app')]:
        executable = bundle_executable(bundle)
        require(executable.stat().st_mode & 0o111, f'Non-executable app binary: {executable}')
        for thin in chunks(executable.read_bytes()):
            _, blobs = code_signature(thin)
            require(5 in blobs, f'Missing executable entitlements: {executable}')
            entitlements = plistlib.loads(blobs[5][8:])
            require(entitlements.get('com.apple.security.cs.allow-jit') is True, 'Missing Electron JIT entitlement')
    print(f'Ad-hoc integrity verified: {len(verified)} Mach-O files, {resources_count} bundle resources: {app.name}')
    return {'machOFiles': len(verified), 'resources': resources_count}


if __name__ == '__main__':
    verify_app(Path(sys.argv[1]))
