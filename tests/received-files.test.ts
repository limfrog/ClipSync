import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { CHUNK_BYTES, isTransferPacket } from '../src/shared/transfers';
import { TransferManager } from '../src/main/transfers';
import { until } from './helpers';
import { complete, transferPair } from './transfer-helpers';

test('same name, size and SHA-256 reuse an existing file without sending any chunks, including after receiver restart', async t => {
  let chunks = 0;
  const { root, client, sending, receiving } = await transferPair(t, packet => { if (packet.type === 'chunk') chunks++; return packet; });
  const source = path.join(root, '한글 프로그램.exe');
  const folder = path.join(root, 'downloads'); await mkdir(folder);
  const target = path.join(folder, path.basename(source));
  const data = randomBytes(CHUNK_BYTES * 2 + 3); await writeFile(source, data); await writeFile(target, data);
  async function transfer() {
    const id = await sending.offer(source, client.id);
    await until(() => receiving.states().some(t => t.id === id));
    await receiving.accept(id, target); await complete(sending, receiving, id);
    assert.equal(receiving.completedFile(id).path, target);
    assert.equal(sending.states().find(t => t.id === id)?.bytes, 0);
    assert.equal(receiving.states().find(t => t.id === id)?.reused, true);
  }
  await transfer(); await transfer(); assert.equal(chunks, 0);
  // A new manager has no remembered transfer IDs or in-memory cache.
  const resumed = new TransferManager(() => {}, () => {}); t.after(() => resumed.abortAll());
  const { fileDigest } = await import('../src/main/transfers');
  const id = randomUUID();
  resumed.receive({ type: 'offer', transferId: id, name: path.basename(source), size: data.length, sha256: await fileDigest(source), image: false, reuse: true }, 'peer');
  await until(() => resumed.states().length === 1); await resumed.accept(id, target);
  resumed.receive({ type: 'finish', transferId: id }, 'peer');
  await until(() => resumed.states()[0].status === 'completed');
  assert.equal(resumed.completedFile(id).path, target); assert.deepEqual(await readdir(folder), [path.basename(target)]);
});

test('same size with different bytes is preserved, while matching numbered NFD copies are reused', async t => {
  let chunks = 0;
  const { root, client, sending, receiving } = await transferPair(t, packet => { if (packet.type === 'chunk') chunks++; return packet; });
  const source = path.join(root, '자료.exe'); await writeFile(source, 'ABCD');
  const folder = path.join(root, 'received'); await mkdir(folder);
  const target = path.join(folder, '자료.exe'); await writeFile(target, 'WXYZ');
  const first = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === first));
  await receiving.accept(first, target); await complete(sending, receiving, first);
  assert.equal(await readFile(target, 'utf8'), 'WXYZ');
  assert.equal(path.basename(receiving.completedFile(first).path), '자료 (1).exe');
  const firstChunks = chunks;
  const second = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === second));
  await receiving.accept(second, target.normalize('NFD')); await complete(sending, receiving, second);
  assert.equal(chunks, firstChunks); assert.equal(receiving.completedFile(second).path, receiving.completedFile(first).path);
  assert.equal((await readdir(folder)).length, 2);
  await unlink(receiving.completedFile(first).path);
  const nfd = path.join(folder, '자료 (2).exe'.normalize('NFD')); await writeFile(nfd, 'ABCD');
  const third = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === third));
  await receiving.accept(third, target); await complete(sending, receiving, third);
  assert.equal(receiving.completedFile(third).path, nfd); assert.equal(chunks, firstChunks);
});

test('modified and deleted received files are downloaded again; symbolic links are not reused', async t => {
  const { root, client, sending, receiving } = await transferPair(t);
  const source = path.join(root, 'source.zip'); await writeFile(source, 'GOOD');
  const folder = path.join(root, 'received'); await mkdir(folder);
  const target = path.join(folder, 'source.zip'); await writeFile(target, 'BADD');
  let id = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === id));
  await receiving.accept(id, target); await complete(sending, receiving, id);
  const first = receiving.completedFile(id).path; await unlink(first); await unlink(target);
  // Windows runners may not grant symlink privileges. The Unix branch exercises
  // real symbolic links; both platforms exercise deletion and changed content.
  if (process.platform !== 'win32') await symlink(source, target);
  id = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === id));
  await receiving.accept(id, target); await complete(sending, receiving, id);
  assert.equal(receiving.states().find(t => t.id === id)?.bytes, 4);
  assert.equal(await readFile(receiving.completedFile(id).path, 'utf8'), 'GOOD');
});

test('a candidate removed between hash comparison and finish safely falls back to data transfer', async t => {
  let chunks = 0; let removed = false;
  const { root, client, sending, receiving } = await transferPair(t, packet => {
    if (packet.type === 'chunk') chunks++;
    return packet;
  });
  const source = path.join(root, 'race.zip'); await writeFile(source, 'correct');
  const folder = path.join(root, 'received'); await mkdir(folder);
  const target = path.join(folder, 'race.zip'); await writeFile(target, 'correct');
  // Gate the real source's finish so deletion happens after accept/have.
  const receive = receiving.receive.bind(receiving);
  receiving.receive = (packet, from) => {
    if (packet.type === 'finish' && !removed) { removed = true; void unlink(target).then(() => receive(packet, from)); }
    else receive(packet, from);
  };
  const id = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === id));
  await receiving.accept(id, target); await complete(sending, receiving, id);
  assert.ok(chunks > 0); assert.equal(await readFile(receiving.completedFile(id).path, 'utf8'), 'correct');
  assert.equal(receiving.states().find(t => t.id === id)?.reused, undefined);
});

test('legacy offers still receive their bytes and avoid an extra saved copy', async t => {
  let chunks = 0;
  const { root, client, sending, receiving } = await transferPair(t, packet => {
    if (packet.type === 'offer') { const { reuse, ...legacy } = packet; return legacy; }
    if (packet.type === 'chunk') chunks++;
    return packet;
  });
  const source = path.join(root, 'legacy.exe'); await writeFile(source, 'legacy');
  const folder = path.join(root, 'received'); await mkdir(folder);
  const target = path.join(folder, 'legacy.exe'); await writeFile(target, 'legacy');
  const id = await sending.offer(source, client.id); await until(() => receiving.states().some(t => t.id === id));
  await receiving.accept(id, target); await complete(sending, receiving, id);
  assert.ok(chunks > 0); assert.equal(receiving.completedFile(id).path, target);
  assert.deepEqual(await readdir(folder), ['legacy.exe']);
  assert.equal(isTransferPacket({ type: 'accept', transferId: id, have: 'bad' }), false);
});
