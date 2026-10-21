import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStorage } from './connection-store';
import type { SavedHistoryEntry } from './media-sync';
import { MAX_FILE_BYTES } from '../shared/transfers';

const MAX_STORE_BYTES = 32 * 1024 * 1024;

/** Validate a versioned main-process snapshot; never accept executable renderer state. */
export function validateHistory(value: unknown): SavedHistoryEntry[] {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { entries?: unknown }).entries)) throw new Error('저장된 기록 형식을 확인할 수 없습니다.');
  const entries = (value as { entries: SavedHistoryEntry[] }).entries;
  if (entries.length > 100) throw new Error('저장된 기록 개수가 너무 많습니다.');
  const ids = new Set<string>(); let textBytes = 0;
  return entries.flatMap<SavedHistoryEntry>(entry => {
    const item = entry?.item;
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) ||
      !['text', 'image', 'file'].includes(item.type) || !['local', 'remote'].includes(item.source) || typeof item.pinned !== 'boolean' ||
      typeof item.copiedAt !== 'string' || !Number.isFinite(Date.parse(item.copiedAt)) || typeof item.preview !== 'string' || item.preview.length > 4000) return [];
    ids.add(item.id);
    const clean = { id: item.id, type: item.type, preview: item.preview, source: item.source, pinned: item.pinned, copiedAt: item.copiedAt };
    if (item.type === 'text') {
      if (typeof entry.text !== 'string' || !entry.text || entry.text.startsWith('clipsync://') || Buffer.byteLength(entry.text) > 1_048_576) return [];
      textBytes += Buffer.byteLength(entry.text);
      if (textBytes > 4 * 1024 * 1024) return [];
      return [{ item: { ...clean, preview: entry.text.slice(0, 1000) }, text: entry.text }];
    }
    const media = entry.media;
    if (!media || !Array.isArray(media.paths) || !media.paths.length || media.paths.length > 16 ||
      media.paths.some(file => typeof file !== 'string' || file.length > 32768 || !path.isAbsolute(file) || file.includes('\0')) ||
      typeof media.image !== 'boolean' || media.image !== (item.type === 'image') || media.image && media.paths.length !== 1 ||
      !Number.isSafeInteger(media.size) || media.size < 0 || media.size > MAX_FILE_BYTES * media.paths.length ||
      typeof media.fingerprint !== 'string' || media.fingerprint.length > 2048) return [];
    const thumbnail = typeof media.thumbnail === 'string' && media.thumbnail.length <= 80_000 && media.thumbnail.startsWith('data:image/png;base64,') ? media.thumbnail : undefined;
    return [{ item: { ...clean, mediaId: item.id, size: media.size, thumbnail }, media: { id: item.id, paths: [...media.paths], image: media.image, size: media.size, fingerprint: media.fingerprint, thumbnail } }];
  });
}

/** Text and file references use the OS key store. Image bytes live in a private cache. */
export class HistoryStore {
  readonly images: string;
  constructor(readonly filename: string, private readonly secrets: SecretStorage) { this.images = path.join(path.dirname(filename), 'history-images'); }
  available() { return this.secrets.available(); }

  async load() {
    let bytes: Buffer;
    try {
      if ((await stat(this.filename)).size > MAX_STORE_BYTES) throw new Error('저장된 기록 크기를 확인해 주세요.');
      bytes = await readFile(this.filename);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (!this.available()) throw new Error('운영체제 보안 저장소를 열 수 없어 기록을 복원하지 못했습니다.');
    return validateHistory(JSON.parse(this.secrets.decrypt(bytes)));
  }

  async save(snapshot: SavedHistoryEntry[]) {
    if (!this.available()) throw new Error('운영체제 보안 저장소를 사용할 수 없어 기록 유지를 켤 수 없습니다.');
    const entries = validateHistory({ version: 1, entries: snapshot });
    await mkdir(this.images, { recursive: true, mode: 0o700 });
    const retained = new Set<string>();
    for (const entry of entries) if (entry.media?.image) {
      const source = entry.media.paths[0];
      const name = `${createHash('sha256').update(entry.item.id).digest('hex')}.png`;
      const destination = path.join(this.images, name);
      try {
        const info = await lstat(source);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
        try { await lstat(destination); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          try {
            await rm(`${destination}.tmp`, { force: true });
            await copyFile(source, `${destination}.tmp`, constants.COPYFILE_EXCL);
            await chmod(`${destination}.tmp`, 0o600);
            await rename(`${destination}.tmp`, destination);
          } finally { await rm(`${destination}.tmp`, { force: true }); }
        }
        entry.media.paths = [destination]; retained.add(name);
      } catch (error) {
        // An original deleted outside ClipSync remains a reference; other records survive.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const bytes = this.secrets.encrypt(JSON.stringify({ version: 1, entries }));
    if (bytes.length > MAX_STORE_BYTES) throw new Error('저장할 클립보드 기록이 너무 큽니다.');
    await writeFile(`${this.filename}.tmp`, bytes, { mode: 0o600 });
    await rename(`${this.filename}.tmp`, this.filename);
    for (const name of await readdir(this.images)) if (/^[a-f0-9]{64}\.png$/.test(name) && !retained.has(name)) await rm(path.join(this.images, name), { force: true });
  }

  async clear() { await rm(this.filename, { force: true }); await rm(`${this.filename}.tmp`, { force: true }); }
  // Disabled histories retain usable image references only for the current run.
  async clearImages() { await rm(this.images, { recursive: true, force: true }); }
}
