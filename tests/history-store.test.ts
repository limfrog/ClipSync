import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SecretStorage } from '../src/main/connection-store';
import { HistoryStore, validateHistory } from '../src/main/history-store';
import type { SavedHistoryEntry } from '../src/main/media-sync';
import { SyncController } from '../src/main/controller';
import { MemoryClipboard } from './helpers';

function secretStorage(): SecretStorage {
  const key = randomBytes(32);
  return {
    available: () => true,
    encrypt(text) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt(data) { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(); },
  };
}
function textEntry(text: string): SavedHistoryEntry {
  return { item: { id: randomUUID(), type: 'text', preview: text.slice(0, 1000), source: 'remote', pinned: true, copiedAt: new Date().toISOString() }, text };
}

test('encrypted history survives restart with full Unicode text, order, pins and durable image bytes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'clipsync-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const secrets = secretStorage(); const filename = path.join(root, 'history.enc');
  const store = new HistoryStore(filename, secrets);
  const text = textEntry('한글 👋\n'.repeat(1200));
  const image = path.join(root, 'temporary.png'); const png = randomBytes(2048); await writeFile(image, png);
  const id = randomUUID();
  const photo: SavedHistoryEntry = { item: { id, type: 'image', preview: '클립보드 이미지', pinned: false, source: 'local', copiedAt: new Date().toISOString() }, media: { id, paths: [image], image: true, size: png.length, fingerprint: 'image:example' } };
  await mkdir(store.images);
  await writeFile(path.join(store.images, `${createHash('sha256').update(id).digest('hex')}.png.tmp`), 'interrupted cache copy');
  await store.save([photo, text]);
  assert.equal((await readFile(filename)).includes('한글'), false);
  await rm(image);
  const saved = await new HistoryStore(filename, secrets).load();
  assert.deepEqual(saved.map(entry => entry.item.id), [id, text.item.id]);
  assert.deepEqual(await readFile(saved[0].media!.paths[0]), png);
  const clipboard = new MemoryClipboard(); clipboard.text = '현재 클립보드는 유지';
  const controller = new SyncController(clipboard, () => {}, 100000); t.after(() => controller.dispose());
  controller.restoreHistory(saved.filter(entry => entry.item.type === 'text'));
  assert.equal(clipboard.text, '현재 클립보드는 유지');
  assert.equal(controller.state().history[0].pinned, true);
  assert.equal(controller.state().sent, 0);
  await controller.manageHistory('copy', text.item.id);
  assert.equal(clipboard.text, text.text);
  await store.save([text]);
  assert.deepEqual(await readdir(store.images), [], 'Deleted image records must release their owned cached bytes');
  await store.clear(); assert.deepEqual(await store.load(), []);
});

test('history refuses plaintext fallback, detects tampering and validates stored file references', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'clipsync-history-invalid-')); t.after(() => rm(root, { recursive: true, force: true }));
  const secrets = secretStorage(); const filename = path.join(root, 'history.enc');
  const store = new HistoryStore(filename, secrets); const entry = textEntry('비밀 기록');
  const unavailable = new HistoryStore(filename, { ...secrets, available: () => false });
  await assert.rejects(unavailable.save([entry]), /보안 저장소/);
  await assert.rejects(readFile(filename), { code: 'ENOENT' });
  await store.save([entry]);
  await assert.rejects(unavailable.load(), /보안 저장소/);
  const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1; await writeFile(filename, bytes);
  await assert.rejects(store.load());
  assert.throws(() => validateHistory({ version: 2, entries: [] }));
  assert.deepEqual(validateHistory({ version: 1, entries: [textEntry('clipsync://private'), { ...entry, text: 'x'.repeat(1_048_577) }] }), []);
  const id = randomUUID();
  assert.deepEqual(validateHistory({ version: 1, entries: [{ item: { ...entry.item, id, type: 'file' }, media: { id, paths: ['relative.exe'], image: false, size: 1, fingerprint: 'bad' } }] }), []);
});
