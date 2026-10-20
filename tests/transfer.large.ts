import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { MAX_FILE_BYTES } from '../src/shared/transfers';
import { fileDigest } from '../src/main/transfers';
import { until } from './helpers';
import { complete, transferPair } from './transfer-helpers';

test('a full 500MB program transfers over encrypted sockets with bounded memory and an intact Korean filename', { timeout: 180000 }, async t => {
  const { root, client, sending, receiving } = await transferPair(t);
  const file = path.join(root, '한글 대용량 프로그램.exe'.normalize('NFD'));
  const handle = await open(file, 'wx');
  await handle.truncate(MAX_FILE_BYTES);
  await handle.write(Buffer.concat([Buffer.from('MZ'), randomBytes(1024)]), 0, 1026, 0);
  const tail = Buffer.from('마지막 한글 데이터 👋 UTF-8');
  await handle.write(tail, 0, tail.length, MAX_FILE_BYTES - tail.length);
  await handle.close();
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
  sampler.unref();
  t.after(() => clearInterval(sampler));
  const started = Date.now();
  const id = await sending.offer(file, client.id);
  await until(() => receiving.states().some(t => t.id === id));
  const folder = path.join(root, '수신'); await mkdir(folder);
  await receiving.accept(id, path.join(folder, '한글 대용량 프로그램.exe'));
  await complete(sending, receiving, id, 170000);
  const saved = receiving.completedFile(id).path;
  assert.equal((await stat(saved)).size, MAX_FILE_BYTES);
  assert.equal(path.basename(saved), '한글 대용량 프로그램.exe');
  const [sourceHash, savedHash] = await Promise.all([fileDigest(file), fileDigest(saved)]);
  assert.equal(sourceHash, savedHash);
  assert.ok(peakRss - baselineRss < 256 * 1024 * 1024, 'Transfer buffered too much of the file in memory');
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/large-transfer.json', JSON.stringify({
    completedAt: new Date().toISOString(), bytes: MAX_FILE_BYTES, sha256: savedHash,
    filename: path.basename(saved), durationMs: Date.now() - started,
    baselineRss, peakRss, rssGrowth: peakRss - baselineRss, outcome: 'passed',
  }, null, 2) + '\n');
});
