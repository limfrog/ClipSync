import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createGroupKey, deriveGroup } from '../src/main/group-credentials';
import { ConnectionStore, type SecretStorage } from '../src/main/connection-store';
import { groupSession, type P2PSession } from '../src/main/group-session';
import { localDHT } from './p2p-helpers';
import { until } from './helpers';

test('20-character keys, password validation and NFC produce consistent distinct group secrets', async () => {
  const groupKey = createGroupKey();
  assert.match(groupKey, /^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{20}$/);
  const input = { groupKey, password: '비밀번호1234' };
  const a = await deriveGroup(input);
  const b = await deriveGroup({ ...input, password: input.password.normalize('NFD') });
  assert.equal(a.room, b.room); assert.equal(a.key, b.key); assert.equal(a.authKey, b.authKey);
  assert.notEqual(a.deviceId, b.deviceId); assert.notEqual(a.seed, b.seed);
  const wrong = await deriveGroup({ ...input, password: '다른비밀번호123' });
  assert.notEqual(a.room, wrong.room); assert.notEqual(a.key, wrong.key);
  await assert.rejects(deriveGroup({ ...input, password: '1234567' }), /8~128/);
  await assert.rejects(deriveGroup({ ...input, groupKey: 'A'.repeat(20) }), /20자리/);
});

test('remembered connection reloads derived credentials, deletes on disconnect and refuses plaintext fallback', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipsync-secrets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const key = randomBytes(32);
  const secrets: SecretStorage = {
    available: () => true,
    encrypt(text) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt(data) { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(); },
  };
  const filename = path.join(dir, 'connection.enc');
  const store = new ConnectionStore(filename, secrets);
  const input = { groupKey: createGroupKey(), password: 'private-password-1234' };
  const credentials = { ...await deriveGroup(input), peers: [randomBytes(32).toString('base64url')], nodes: [{ host: '192.168.1.2', port: 12345 }] };
  assert.equal(await store.save(credentials), true);
  const bytes = await readFile(filename);
  for (const value of [input.password, input.groupKey, credentials.key, credentials.authKey]) assert.equal(bytes.includes(value), false);
  assert.deepEqual(await new ConnectionStore(filename, secrets).load(), credentials);
  const noKeyring = new ConnectionStore(path.join(dir, 'no-keyring.enc'), { ...secrets, available: () => false });
  assert.equal(await noKeyring.save(credentials), false);
  await assert.rejects(readFile(path.join(dir, 'no-keyring.enc')), { code: 'ENOENT' });
  await store.clear(); assert.equal(await store.load(), null);
});

test('three equal P2P devices isolate wrong passwords, survive any peer exit and reconnect with stored identity', { timeout: 60000 }, async t => {
  const network = await localDHT();
  const sessions: P2PSession[] = [];
  t.after(async () => { for (const session of sessions) await session.close(); await network.close(); });
  const input = { groupKey: createGroupKey(), password: 'test-password-1234' };
  const credentials = await Promise.all([deriveGroup(input), deriveGroup(input), deriveGroup(input), deriveGroup({ ...input, password: 'different-password' })]);
  const texts: string[][] = [[], [], [], []]; const peers = [0, 0, 0, 0];
  const current = ['', '', '', ''];
  function start(index: number) {
    const session = groupSession(credentials[index], { onText: text => { texts[index].push(text); current[index] = text; }, onPeers: count => { peers[index] = count; }, onDevices: () => {}, onTransfer: () => {}, onStatus: () => {} }, { bootstrap: network.bootstrap, lan: false });
    sessions.push(session); return session;
  }
  const a = start(0); await delay(150);
  const b = start(1); const c = start(2); start(3);
  await until(() => peers.slice(0, 3).every(count => count === 2), 'P2P devices did not discover one another', 35000);
  assert.equal(peers[3], 0);
  a.publish('세 기기의 P2P 클립보드');
  await until(() => texts[1].includes('세 기기의 P2P 클립보드') && texts[2].includes('세 기기의 P2P 클립보드'));
  assert.deepEqual(texts[3], []);
  await a.close(); await until(() => peers[1] === 1 && peers[2] === 1);
  b.publish('첫 PC 종료 후에도 계속 연결'); await until(() => texts[2].includes('첫 PC 종료 후에도 계속 연결'));
  const restored = start(0); await until(() => peers.slice(0, 3).every(count => count === 2), 'Restart did not restore the existing group', 20000);
  restored.publish('같은 키로 자동 복귀'); await until(() => texts[1].includes('같은 키로 자동 복귀') && texts[2].includes('같은 키로 자동 복귀'));
  current[1] = '동시 복사 B'; b.publish(current[1]); current[2] = '동시 복사 C'; c.publish(current[2]);
  await until(() => current[0] === current[1] && current[1] === current[2] && ['동시 복사 B', '동시 복사 C'].includes(current[0]), 'Concurrent P2P copies did not converge');
  for (const session of sessions) assert.equal(session.diagnostics().relayAttempts, 0);
});

test('remembered Noise identity and DHT nodes restore a direct connection without matching topic discovery', { timeout: 15000 }, async t => {
  const network = await localDHT();
  const sessions: P2PSession[] = [];
  t.after(async () => { for (const session of sessions) await session.close(); await network.close(); });
  const input = { groupKey: createGroupKey(), password: 'remember-peer-1234' };
  let credentials = await deriveGroup(input);
  const other = await deriveGroup(input);
  let count = 0, otherCount = 0; const texts: string[] = [];
  const callbacks = { onText: (text: string) => { texts.push(text); }, onPeers: (peers: number) => { count = peers; }, onDevices: () => {}, onTransfer: () => {}, onStatus: () => {} };
  const first = groupSession(credentials, callbacks, { bootstrap: network.bootstrap, lan: false, onHints: hints => { credentials = { ...credentials, ...hints }; } });
  sessions.push(first);
  const peer = groupSession(other, { ...callbacks, onPeers: peers => { otherCount = peers; } }, { bootstrap: network.bootstrap, lan: false }); sessions.push(peer);
  await until(() => count === 1 && otherCount === 1, 'Initial DHT connection', 10000);
  assert.equal(credentials.peers?.length, 1); assert.ok(credentials.nodes?.length);
  await first.close(); count = 0;
  await until(() => otherCount === 0, 'Peer must observe the previous connection closing');
  // Deliberately give the restarted peer an unrelated topic: only cached peer lookup can find B.
  const restored = groupSession({ ...credentials, room: randomBytes(32).toString('base64url') }, callbacks, { bootstrap: network.bootstrap, lan: false }); sessions.push(restored);
  const before = Date.now();
  await until(() => count === 1 && otherCount === 1, 'Known peer should bypass topic matching', 8000);
  t.diagnostic(`cached identity reconnect through isolated DHT: ${Date.now() - before} ms`);
  peer.publish('기억한 기기에 바로 연결'); await until(() => texts.includes('기억한 기기에 바로 연결'));
  assert.equal(restored.diagnostics().lanPeers, 0); assert.equal(restored.diagnostics().relayAttempts, 0);
});
