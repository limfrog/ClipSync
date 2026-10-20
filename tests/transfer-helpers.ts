import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { createKey } from '../src/main/protocol';
import { hostSession, joinSession, type Session } from '../src/main/session';
import { TransferManager } from '../src/main/transfers';
import type { TransferPacket } from '../src/shared/transfers';
import { until } from './helpers';

export async function transferPair(t: TestContext, intercept?: (packet: TransferPacket) => TransferPacket) {
  const root = await mkdtemp(path.join(tmpdir(), 'clipsync-transfer-'));
  let host: Session;
  let client: Session;
  const sending = new TransferManager((packet, to) => host.sendTransfer(intercept ? intercept(packet) : packet, to), () => {});
  const receiving = new TransferManager((packet, to) => client.sendTransfer(packet, to), () => {});
  const callbacks = { onText: () => {}, onPeers: () => {}, onDisconnect: () => {} };
  const key = createKey();
  host = await hostSession(key, { ...callbacks, onTransfer: (packet, from) => sending.receive(packet, from) }, 0, '127.0.0.1');
  client = await joinSession({ host: '127.0.0.1', port: (host as Session & { port: number }).port, key }, { ...callbacks, onTransfer: (packet, from) => receiving.receive(packet, from) });
  t.after(async () => {
    await receiving.abortAll(); await sending.abortAll();
    await client.close(); await host.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, host, client, sending, receiving, key };
}

export async function complete(sender: TransferManager, receiver: TransferManager, id: string, timeout = 5000) {
  await until(() => sender.states().find(t => t.id === id)?.status === 'completed' && receiver.states().find(t => t.id === id)?.status === 'completed', 'File transfer did not complete', timeout);
}
