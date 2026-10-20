import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createGroupKey, deriveGroup } from '../src/main/group-credentials';
import { groupSession, type P2PSession } from '../src/main/group-session';
import type { GroupCredentials } from '../src/shared/group';
import { until } from './helpers';

test('LAN connects without internet discovery, rejects wrong password, reconnects and remembers authenticated peers', { timeout: 20000 }, async t => {
  const input = { groupKey: createGroupKey(), password: 'local-password-1234' };
  const credentials = await Promise.all([deriveGroup(input), deriveGroup(input), deriveGroup(input), deriveGroup({ ...input, password: 'incorrect-password' })]);
  // Force the wrong-password peer onto the same topic to exercise beacon MAC validation too.
  credentials[3] = { ...credentials[3], room: credentials[0].room };
  const sessions: P2PSession[] = [];
  t.after(async () => { for (const session of sessions) await session.close(); });
  const peers = [0, 0, 0, 0]; const texts: string[][] = [[], [], [], []];
  const events: string[] = [];
  t.after(() => t.diagnostic(events.join('; ')));
  const hints: { peers: string[]; nodes: { host: string; port: number }[] }[] = [];
  function start(index: number) {
    const session = groupSession(credentials[index], {
      onText: text => texts[index].push(text), onPeers: count => { peers[index] = count; },
      onDevices: () => {}, onTransfer: () => {}, onStatus: () => {},
    }, { bootstrap: [], lanDiagnostic: event => { if (events.length < 80) events.push(`${index}: ${event}`); }, onHints: value => { hints[index] = value; } });
    sessions.push(session); return session;
  }
  const a = start(0); start(3);
  await delay(250);
  const before = performance.now(); const b = start(1); start(2);
  await until(() => peers.slice(0, 3).every(count => count === 2), 'LAN should connect without any DHT node', 5000);
  t.diagnostic(`three-device LAN discovery: ${Math.round(performance.now() - before)} ms`);
  assert.equal(peers[3], 0);
  assert.equal(a.diagnostics().routingNodes, 0);
  assert.equal(a.diagnostics().lanPeers, 2);
  a.publish('인터넷 없이 한글 클립보드 연결');
  await until(() => texts[1].length === 1 && texts[2].length === 1);
  assert.equal(texts[1][0], '인터넷 없이 한글 클립보드 연결'); assert.deepEqual(texts[3], []);
  assert.equal(hints[0].peers.length, 2);
  credentials[0] = { ...credentials[0], ...hints[0] } satisfies GroupCredentials;
  await a.close(); await until(() => peers[1] === 1 && peers[2] === 1);
  const restart = performance.now(); const restored = start(0);
  await until(() => peers.slice(0, 3).every(count => count === 2), 'Restart should rediscover the same group', 5000);
  t.diagnostic(`LAN restart: ${Math.round(performance.now() - restart)} ms`);
  restored.publish('재시작 후 자동 연결');
  await until(() => texts[1].includes('재시작 후 자동 연결'));
  // Several beacon cycles must not continually replace authenticated sockets.
  await delay(2200);
  assert.deepEqual(peers, [2, 2, 2, 0]);
  b.publish('연결 유지'); await until(() => texts[2].includes('연결 유지'));
  for (const session of sessions) assert.equal(session.diagnostics().relayAttempts, 0);
});
