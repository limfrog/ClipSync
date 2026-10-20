import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { portableFilename } from '../src/main/file-names';
import { MAX_FILE_BYTES, CHUNK_BYTES, isTransferPacket } from '../src/shared/transfers';
import { fileDigest, TransferManager } from '../src/main/transfers';
import { joinSession, type Session } from '../src/main/session';
import { until } from './helpers';
import { complete, transferPair } from './transfer-helpers';

test('Korean names normalize macOS NFD to NFC without mojibake and remain valid Windows names', () => {
  const original = '한글 프로그램 설치파일 👋.exe';
  assert.equal(portableFilename(original.normalize('NFD')), original);
  assert.equal(portableFilename(original.normalize('NFC')), original);
  assert.equal(portableFilename('CON.exe'), '_CON.exe');
  assert.equal(portableFilename('COM¹.exe'), '_COM¹.exe');
  assert.equal(portableFilename('이름:금지?.txt. '), '이름_금지_.txt');
  assert.ok(!portableFilename('../경로\\탈출.exe').includes('/'));
  assert.ok(!portableFilename('../경로\\탈출.exe').includes('\\'));
  const long = portableFilename('가'.repeat(300) + '.exe');
  assert.ok(Buffer.byteLength(long) <= 220);
  assert.ok(long.endsWith('.exe'));
});

test('encrypted multi-chunk program transfer preserves Korean filename and arbitrary file bytes', async t => {
  const { root, client, sending, receiving } = await transferPair(t);
  const source = path.join(root, '한글 설치 프로그램.exe'.normalize('NFD'));
  const data = Buffer.concat([Buffer.from('MZ\0한글 UTF-8\0'), Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]), randomBytes(CHUNK_BYTES * 3 + 17)]);
  await writeFile(source, data);
  const id = await sending.offer(source, client.id);
  await until(() => receiving.states().some(t => t.id === id));
  assert.equal(receiving.states()[0].name, '한글 설치 프로그램.exe');
  assert.equal(sending.states()[0].bytes, 0);
  const folder = path.join(root, '수신 폴더'); await mkdir(folder);
  await receiving.accept(id, path.join(folder, '한글 설치 프로그램.exe'.normalize('NFD')));
  await complete(sending, receiving, id);
  const saved = receiving.completedFile(id).path;
  assert.equal(path.basename(saved), '한글 설치 프로그램.exe');
  assert.deepEqual(await readFile(saved), data);
  assert.equal(await fileDigest(saved), await fileDigest(source));
});

test('empty files transfer and canonically equivalent destination names never overwrite existing files', async t => {
  const { root, client, sending, receiving } = await transferPair(t);
  const source = path.join(root, '빈 한글 파일.zip'); await writeFile(source, '');
  const dest = path.join(root, '자료.zip'); await writeFile(dest, 'existing');
  const id = await sending.offer(source, client.id);
  await until(() => receiving.states().some(t => t.id === id));
  await receiving.accept(id, path.join(path.dirname(dest), path.basename(dest).normalize('NFD')));
  await complete(sending, receiving, id);
  assert.equal(await readFile(dest, 'utf8'), 'existing');
  assert.equal(path.basename(receiving.completedFile(id).path), '자료 (1).zip');
  assert.equal((await readFile(receiving.completedFile(id).path)).length, 0);
});

test('files larger than 500,000,000 bytes and malformed metadata are rejected before streaming', async t => {
  const { root, client, sending } = await transferPair(t);
  const file = path.join(root, '초과.exe');
  const fd = await open(file, 'wx'); await fd.truncate(MAX_FILE_BYTES + 1); await fd.close();
  await assert.rejects(sending.offer(file, client.id), /500MB/);
  assert.equal(sending.states().length, 0);
  assert.ok(!isTransferPacket({ type: 'offer', transferId: 'bad', name: 'x', size: 1 }));
  await assert.rejects(sending.offer(root, client.id), /ZIP/);
});

test('tampered content fails SHA-256 verification and removes the partial file', async t => {
  const { root, client, sending, receiving } = await transferPair(t, packet => {
    if (packet.type !== 'chunk') return packet;
    const data = Buffer.from(packet.data, 'base64'); data[0] ^= 1;
    return { ...packet, data: data.toString('base64') };
  });
  const file = path.join(root, '원본.exe'); await writeFile(file, randomBytes(5000));
  const folder = path.join(root, 'downloads'); await mkdir(folder);
  const id = await sending.offer(file, client.id);
  await until(() => receiving.states().some(t => t.id === id));
  await receiving.accept(id, path.join(folder, '수신.exe'));
  await until(() => receiving.states().find(t => t.id === id)?.status === 'failed');
  assert.deepEqual(await readdir(folder), []);
  await until(() => sending.states().find(t => t.id === id)?.status === 'cancelled');
});

test('rejecting an offer sends no chunks; disconnect cleanup removes an accepted partial file', async t => {
  let chunks = 0;
  const { root, client, sending, receiving } = await transferPair(t, packet => { if (packet.type === 'chunk') chunks++; return packet; });
  const file = path.join(root, '취소.exe'); await writeFile(file, randomBytes(CHUNK_BYTES * 8));
  const id = await sending.offer(file, client.id);
  await until(() => receiving.states().some(t => t.id === id));
  await receiving.cancel(id);
  await until(() => sending.states().find(t => t.id === id)?.status === 'cancelled');
  assert.equal(chunks, 0);
  const next = await sending.offer(file, client.id);
  await until(() => receiving.states().some(t => t.id === next));
  const folder = path.join(root, 'cancelled'); await mkdir(folder);
  await receiving.accept(next, path.join(folder, '취소.exe'));
  await receiving.abortAll(); await sending.abortAll();
  assert.deepEqual(await readdir(folder), []);
});

test('client-to-host and client-to-client transfers preserve Korean names through the host relay', async t => {
  const { root, host, receiving, sending, key } = await transferPair(t);
  const source = path.join(root, '맥에서 보낸 한글.dmg'.normalize('NFD')); await writeFile(source, randomBytes(CHUNK_BYTES * 2));
  const dest = path.join(root, '호스트 수신.dmg');
  const id = await receiving.offer(source, 'host');
  await until(() => sending.states().some(t => t.id === id));
  await sending.accept(id, dest);
  await complete(receiving, sending, id);
  assert.equal(await fileDigest(source), await fileDigest(dest));
  let thirdSession: Session;
  const third = new TransferManager((packet, to) => thirdSession.sendTransfer(packet, to), () => {});
  thirdSession = await joinSession({ host: '127.0.0.1', port: (host as Session & { port: number }).port, key }, { onText: () => {}, onPeers: () => {}, onDisconnect: () => {}, onTransfer: (packet, from) => third.receive(packet, from) });
  t.after(async () => { await third.abortAll(); await thirdSession.close(); });
  const forwarded = await receiving.offer(source, thirdSession.id);
  await until(() => third.states().some(t => t.id === forwarded));
  assert.ok(!sending.states().some(t => t.id === forwarded), 'Unicast file offer was delivered to the host as a recipient');
  const folder = path.join(root, '세 번째 PC'); await mkdir(folder);
  await third.accept(forwarded, path.join(folder, third.states()[0].name));
  await complete(receiving, third, forwarded);
  assert.equal(await fileDigest(source), await fileDigest(third.completedFile(forwarded).path));
  assert.equal(third.states()[0].name, '맥에서 보낸 한글.dmg');
});
