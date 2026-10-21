// Check actual packaged artifacts, including resource icons, before publishing installers.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import * as asar from '@electron/asar';
import { NtExecutable, NtExecutableResource, Resource, Data } from 'resedit';

const kind = process.argv[2];
assert.ok(['Windows', 'macOS'].includes(kind), 'Pass Windows or macOS');
const root = 'release/installers';
const folders = kind === 'Windows' ? ['win-unpacked'] : (await readdir(root)).filter(name => /^mac(?:-|$)/.test(name));
assert.equal(folders.length, kind === 'Windows' ? 1 : 2);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
for (const folder of folders) {
  const resources = path.join(root, folder, ...(kind === 'Windows' ? ['resources'] : ['ClipSync.app', 'Contents', 'Resources']));
  const archive = path.join(resources, 'app.asar');
  const roots = [...new Set(asar.listPackage(archive).map(file => file.split(/[\\/]/)[1]))].sort();
  assert.deepEqual(roots, ['THIRD_PARTY_NOTICES.txt', 'dist', 'node_modules', 'package.json'].sort(), 'Only app files and production dependencies belong in ASAR');
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, version);
  for (const name of ['icon.png', 'icon-windows.png', 'tray-windows.ico', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
    assert.deepEqual(asar.extractFile(archive, `dist/assets/${name}`), await readFile(`assets/${name}`));
  }
  if (kind === 'Windows') {
    const expected = Data.IconFile.from(await readFile('build/icons/icon.ico')).icons.map(item => item.data);
    const bytes = item => Buffer.from(item.isRaw() ? item.bin : item.generate());
    // NSIS reorders RT_ICON IDs; compare complete frame contents independent of ID order.
    const frames = items => items.map(item => bytes(item).toString('base64')).sort();
    const expectedFrames = frames(expected);
    for (const exe of [path.join(root, folder, 'ClipSync.exe'), path.join(root, `ClipSync-${version}-Windows-x64-Setup.exe`)]) {
      const entries = NtExecutableResource.from(NtExecutable.from(await readFile(exe))).entries;
      assert.ok(Resource.IconGroupEntry.fromEntries(entries).some(group => {
        const actual = group.getIconItemsFromEntries(entries);
        return actual.length === expected.length && frames(actual).every((frame, index) => frame === expectedFrames[index]);
      }), `Selected icon must be embedded in ${exe}`);
    }
  } else {
    const expected = await readFile('build/icons/icon.icns');
    const icons = (await readdir(resources)).filter(name => name.endsWith('.icns'));
    const matches = await Promise.all(icons.map(async name => (await readFile(path.join(resources, name))).equals(expected)));
    assert.ok(matches.some(Boolean), `Selected ICNS must be present in ${folder}`);
  }
  console.log(`${folder}: app ${version}, ${(await stat(archive)).size} byte ASAR, selected icons verified`);
}
