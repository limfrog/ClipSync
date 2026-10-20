import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, open, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { clipboard, ClipboardItem, nativeImage } from 'electron';
import { MAX_FILE_BYTES } from '../shared/transfers';
import type { MediaSnapshot, MediaClipboard } from './media-sync';

export async function reserveSpace(folder: string, bytes: number) {
  await mkdir(folder, { recursive: true });
  const space = await statfs(folder);
  if (space.bavail * space.bsize < bytes + 500_000_000) throw new Error('클립보드 동기화를 위한 저장 공간이 부족합니다.');
}

export async function describeMedia(paths: string[], image: boolean): Promise<MediaSnapshot> {
  let size = 0;
  const hash = createHash('sha256');
  for (const file of paths) {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('폴더와 macOS 앱은 ZIP으로 압축한 뒤 복사해 주세요.');
    if (info.size > MAX_FILE_BYTES) throw new Error('500MB를 초과한 파일은 클립보드 동기화에서 제외됩니다.');
    size += info.size;
    hash.update(`${file}\0${info.size}\0${info.mtimeMs}\0`);
  }
  let thumbnail: string | undefined;
  if (image && size <= 8_000_000) {
    const handle = await open(paths[0], 'r');
    try {
      const header = Buffer.alloc(24); await handle.read(header, 0, 24, 0);
      if (header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && header.readUInt32BE(16) * header.readUInt32BE(20) <= 16_000_000) {
        const preview = nativeImage.createFromPath(paths[0]);
        if (!preview.isEmpty()) {
          const { width, height } = preview.getSize();
          const scale = Math.min(240 / width, 144 / height, 1);
          const data = preview.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }).toDataURL();
          if (data.length <= 80_000) thumbnail = data;
        }
      }
    } finally { await handle.close(); }
  }
  return { id: randomUUID(), paths, image, size, fingerprint: `files:${hash.digest('hex')}`, thumbnail };
}

/** Use Electron's native file mapping: CF_HDROP, NSFilenamesPboardType, URI list. */
export class NativeMediaClipboard implements MediaClipboard {
  private lastImageHash = '';
  private lastImage: MediaSnapshot | null = null;
  private lastBlob: Blob | null = null;
  constructor(private readonly cache: () => Promise<string>) {}

  async read(): Promise<MediaSnapshot | null> {
    const items = await clipboard.read();
    // File references take precedence over Finder/Explorer thumbnail images.
    const files = items.find(item => item.types.includes('text/uri-list'));
    if (files) {
      const blob = await files.getType('text/uri-list');
      if (blob.size > 64_000) throw new Error('한 번에 파일 16개까지 복사해 주세요.');
      const uris = (await blob.text()).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      if (!uris.length || uris.length > 16) throw new Error('한 번에 파일 16개까지 복사해 주세요.');
      const paths = uris.map(uri => {
        const url = new URL(uri);
        if (url.protocol !== 'file:' || url.hostname && url.hostname !== 'localhost') throw new Error('이 PC의 파일만 클립보드에서 동기화할 수 있습니다.');
        return fileURLToPath(url);
      });
      return describeMedia([...new Set(paths)], false);
    }
    const image = items.find(item => item.types.includes('image/png'));
    if (!image) return null;
    const blob = await image.getType('image/png');
    if (blob.size > MAX_FILE_BYTES) throw new Error('500MB 이하의 이미지만 동기화할 수 있습니다.');
    const hash = createHash('sha256');
    for await (const chunk of Readable.fromWeb(blob.stream() as import('node:stream/web').ReadableStream)) hash.update(chunk);
    const digest = hash.digest('hex');
    if (digest === this.lastImageHash && this.lastImage) return this.lastImage;
    this.lastImageHash = digest;
    this.lastBlob = blob;
    this.lastImage = { id: randomUUID(), paths: [], image: true, size: blob.size, fingerprint: `image:${digest}` };
    return this.lastImage;
  }

  async materialize(snapshot: MediaSnapshot): Promise<MediaSnapshot> {
    if (!snapshot.image || snapshot.paths.length) return snapshot;
    if (snapshot.fingerprint !== this.lastImage?.fingerprint || !this.lastBlob) throw new Error('클립보드 이미지가 변경됐습니다.');
    const blob = this.lastBlob;
    const cache = await this.cache(); await reserveSpace(cache, blob.size);
    const file = path.join(cache, `클립보드 이미지-${this.lastImageHash.slice(0, 16)}.png`);
    try {
      await pipeline(Readable.fromWeb(blob.stream() as import('node:stream/web').ReadableStream), createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.lastImage = { ...await describeMedia([file], true), fingerprint: snapshot.fingerprint };
    return this.lastImage;
  }

  async describe(paths: string[], image: boolean) { return describeMedia(paths, image); }

  async write(snapshot: MediaSnapshot) {
    // Only paths retained by the main process reach this API; renderer paths are never accepted.
    for (const file of snapshot.paths) if (!(await stat(file)).isFile()) throw new Error('기록의 원본 파일을 찾을 수 없습니다.');
    if (snapshot.image) {
      const blob = await openAsBlob(snapshot.paths[0], { type: 'image/png' });
      await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } else await clipboard.write([new ClipboardItem({ 'text/uri-list': snapshot.paths.map(file => pathToFileURL(file).href).join('\r\n') })]);
  }
}
