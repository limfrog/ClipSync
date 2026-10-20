import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createKey, proof, seal } from '../src/main/protocol';
import { hostSession, joinSession } from '../src/main/session';
import { until } from './helpers';

function events() {
  const texts: string[] = [];
  let peers = 0;
  let disconnected = false;
  return {
    texts,
    get peers() { return peers; },
    get disconnected() { return disconnected; },
    callbacks: {
      onText: (text: string, localEcho = false) => { if (!localEcho) texts.push(text); },
      onPeers: (count: number) => { peers = count; },
      onDisconnect: () => { disconnected = true; },
    },
  };
}

test('three peers exchange encrypted Unicode text in both directions without counting local echoes as received copies', async t => {
  const key = createKey();
  const hostEvents = events();
  const host = await hostSession(key, hostEvents.callbacks, 0, '127.0.0.1');
  t.after(() => host.close());
  const invitation = { host: '127.0.0.1', port: host.port, key };
  const aEvents = events();
  const bEvents = events();
  const a = await joinSession(invitation, aEvents.callbacks);
  t.after(() => a.close());
  const b = await joinSession(invitation, bEvents.callbacks);
  t.after(() => b.close());
  assert.equal(hostEvents.peers, 2);
  a.publish('PC A → 모두 👋');
  await until(() => hostEvents.texts.length === 1 && bEvents.texts.length === 1);
  assert.deepEqual(aEvents.texts, []);
  assert.equal(hostEvents.texts[0], 'PC A → 모두 👋');
  host.publish('호스트 → 모두');
  await until(() => aEvents.texts.length === 1 && bEvents.texts.length === 2);
  b.publish('');
  await until(() => hostEvents.texts.length === 2 && aEvents.texts.length === 2);
  assert.equal(aEvents.texts[1], '');
  await a.close();
  await until(() => hostEvents.peers === 1);
});

test('wrong session keys are denied and a correct peer can still connect', async t => {
  const key = createKey();
  const state = events();
  const host = await hostSession(key, state.callbacks, 0, '127.0.0.1');
  t.after(() => host.close());
  const invitation = { host: '127.0.0.1', port: host.port, key };
  await assert.rejects(joinSession({ ...invitation, key: createKey() }, events().callbacks));
  assert.equal(state.peers, 0);
  const good = await joinSession(invitation, events().callbacks);
  t.after(() => good.close());
  assert.equal(state.peers, 1);
});

test('unauthenticated messages and browser origins are denied', async t => {
  const key = createKey();
  const state = events();
  const host = await hostSession(key, state.callbacks, 0, '127.0.0.1');
  t.after(() => host.close());
  for (const options of [{}, { origin: 'https://example.com' }]) {
    const client = new WebSocket(`ws://127.0.0.1:${host.port}`, options);
    const closed = once(client, 'close');
    client.on('error', () => {});
    client.once('open', () => client.send(seal(key, 'must not be accepted')));
    const [code] = await closed;
    assert.equal(code, 1008);
  }
  assert.deepEqual(state.texts, []);
  assert.equal(state.peers, 0);
});

test('replayed payloads are ignored and closing the host reports disconnection', async t => {
  const key = createKey();
  const state = events();
  const host = await hostSession(key, state.callbacks, 0, '127.0.0.1');
  t.after(() => host.close());
  const client = new WebSocket(`ws://127.0.0.1:${host.port}`);
  t.after(() => client.terminate());
  client.on('error', () => {});
  const authenticated = new Promise<void>(resolve => {
    client.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'challenge') client.send(JSON.stringify({ type: 'auth', proof: proof(key, 'client', message.challenge) }));
      if (message.type === 'ready') resolve();
    });
  });
  await authenticated;
  const wire = seal(key, 'only once');
  client.send(wire);
  client.send(wire);
  // A following unique message establishes that both previous frames were processed.
  client.send(seal(key, 'barrier'));
  await until(() => state.texts.length === 2);
  assert.deepEqual(state.texts, ['only once', 'barrier']);
  const joinedEvents = events();
  const joined = await joinSession({ host: '127.0.0.1', port: host.port, key }, joinedEvents.callbacks);
  t.after(() => joined.close());
  await host.close();
  await until(() => joinedEvents.disconnected);
});

test('simultaneous client copies converge to the host order on every peer', async t => {
  const key = createKey();
  let hostText = '';
  let aText = 'from A';
  let bText = 'from B';
  let messages = 0;
  let echoes = 0;
  const callbacks = { onPeers: () => {}, onDisconnect: () => {} };
  const host = await hostSession(key, { ...callbacks, onText: text => { hostText = text; messages++; } }, 0, '127.0.0.1');
  t.after(() => host.close());
  const invitation = { host: '127.0.0.1', port: host.port, key };
  const a = await joinSession(invitation, { ...callbacks, onText: (text, localEcho) => { aText = text; if (localEcho) echoes++; } });
  t.after(() => a.close());
  const b = await joinSession(invitation, { ...callbacks, onText: (text, localEcho) => { bText = text; if (localEcho) echoes++; } });
  t.after(() => b.close());
  a.publish(aText);
  b.publish(bText);
  await until(() => messages === 2 && echoes === 2 && hostText === aText && hostText === bText);
  assert.ok(hostText === 'from A' || hostText === 'from B');
});
