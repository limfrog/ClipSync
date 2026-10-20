import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { SyncController } from '../src/main/controller';
import { MemoryClipboard, until } from './helpers';

async function pair(t: { after(fn: () => Promise<void>): void }) {
  const a = new MemoryClipboard();
  const b = new MemoryClipboard();
  const host = new SyncController(a, () => {}, 15);
  const client = new SyncController(b, () => {}, 15);
  t.after(async () => { await client.dispose(); await host.dispose(); });
  await host.host(0, '127.0.0.1');
  await client.join(host.state().invitation);
  return { a, b, host, client };
}

test('new clipboard changes sync in both directions without sharing pre-connection content or loops', async t => {
  const { a, b, host, client } = await pair(t);
  await setTimeout(60);
  assert.deepEqual(b.writes, []);
  a.text = 'first copy 👋';
  await until(() => b.text === a.text);
  b.text = 'reply from B';
  await until(() => a.text === 'reply from B');
  await setTimeout(60);
  assert.equal(host.state().sent, 1);
  assert.equal(host.state().received, 1);
  assert.equal(client.state().sent, 1);
  assert.equal(client.state().received, 1);
});

test('pause stops local send and receive; resume does not share copies made while paused', async t => {
  const { a, b, host, client } = await pair(t);
  await client.pause(true);
  b.text = 'private while paused';
  a.text = 'host during pause';
  await until(() => host.state().sent === 1);
  await setTimeout(60);
  assert.equal(b.text, 'private while paused');
  assert.equal(client.state().received, 0);
  await client.pause(false);
  await setTimeout(60);
  assert.equal(client.state().sent, 0);
  b.text = 'new public copy';
  await until(() => a.text === 'new public copy');
  assert.equal(client.state().sent, 1);
});

test('copying the invitation does not transmit the session key; disconnect stops sharing', async t => {
  const { a, b, host, client } = await pair(t);
  await host.copyInvitation();
  await setTimeout(60);
  assert.ok(a.text.startsWith('clipsync://'));
  assert.equal(b.writes.length, 0);
  assert.equal(host.state().sent, 0);
  await client.disconnect();
  await until(() => host.state().peers === 0);
  b.text = 'after disconnect';
  await setTimeout(60);
  assert.notEqual(a.text, b.text);
  assert.equal(client.state().mode, 'idle');
});

test('a non-text clipboard is ignored without clearing a peer clipboard', async t => {
  let text: string | null = 'initial';
  const host = new SyncController({ readText: async () => text, writeText: async value => { text = value; } }, () => {}, 15);
  const target = new MemoryClipboard();
  const client = new SyncController(target, () => {}, 15);
  t.after(async () => { await client.dispose(); await host.dispose(); });
  await host.host(0, '127.0.0.1');
  await client.join(host.state().invitation);
  text = null;
  await setTimeout(60);
  assert.equal(target.writes.length, 0);
  text = 'text after image';
  await until(() => target.text === 'text after image');
  assert.equal(host.state().sent, 1);
});
