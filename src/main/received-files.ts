import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface VerifiedFile { path: string; version: string }
const version = (s: BigIntStats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;

/** Never trust a cached hash of a user-editable file. Only name/size candidates
 * are read, and a full SHA-256 match plus stable metadata permits reuse. */
export async function findReceivedFile(target: string, size: number, digest: string, cancelled: () => boolean): Promise<VerifiedFile | undefined> {
  const base = path.basename(target).normalize('NFC');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numbered = new RegExp(`^${escape(stem)} \\([1-9][0-9]{0,3}\\)${escape(extension)}$`);
  const names = await readdir(path.dirname(target)).catch(() => [] as string[]);
  // Direct lookup uses the file system's case rules; enumeration also finds NFD
  // names and numbered copies created by older releases, including after restart.
  const candidates = [...new Set([target, ...names.filter(name => name.normalize('NFC') === base || numbered.test(name.normalize('NFC'))).map(name => path.join(path.dirname(target), name))])];
  for (const file of candidates) {
    if (cancelled()) return;
    try {
      const before = await lstat(file, { bigint: true });
      if (!before.isFile() || before.size !== BigInt(size)) continue;
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        if (version(before) !== version(await handle.stat({ bigint: true }))) continue;
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          if (cancelled()) return;
          hash.update(chunk);
        }
        const after = await handle.stat({ bigint: true });
        const current = await lstat(file, { bigint: true });
        if (current.isFile() && version(before) === version(after) && version(before) === version(current) && hash.digest('hex') === digest) return { path: file, version: version(current) };
      } finally { await handle.close(); }
    } catch { /* Missing, locked, changed, unreadable or symbolic link: receive normally. */ }
  }
}

export async function stillReceivedFile(file: VerifiedFile): Promise<boolean> {
  try { const current = await lstat(file.path, { bigint: true }); return current.isFile() && version(current) === file.version; }
  catch { return false; }
}
