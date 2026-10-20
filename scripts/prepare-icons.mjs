// Format/size conversion only. Artwork is in assets/icon.png and tray-template-source.png.
// Requires ImageMagick 7 (`magick`); generated binaries are committed for regular builds.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

await mkdir('build/icons', { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), 'clipsync-icons-'));
const convert = (...args) => execFileSync('magick', args, { stdio: 'inherit' });
try {
  convert('assets/icon.png', '-define', 'icon:auto-resize=256,128,64,48,32,24,16', 'build/icons/icon.ico');
  const chunks = [];
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const file = path.join(scratch, `${size}.png`);
    convert('assets/icon.png', '-resize', `${size}x${size}`, file);
    const png = await readFile(file);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii'); header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii'); header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  await writeFile('build/icons/icon.icns', Buffer.concat([header, ...chunks]));
  for (const [source, name] of [['assets/icon.png', 'tray'], ['assets/tray-template-source.png', 'trayTemplate']]) {
    for (const [suffix, size] of [['', 18], ['@2x', 36]]) {
      convert(source, '-resize', `${size}x${size}`, `assets/${name}${suffix}.png`);
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
