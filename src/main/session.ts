import { randomBytes, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import WebSocket, { WebSocketServer } from 'ws';
import { DEFAULT_PORT, MAX_TEXT_BYTES, RecentMessages, open, proof, seal, sealTransfer, verifyProof, type Invitation } from './protocol';
import type { Peer, TransferPacket } from '../shared/transfers';

interface Callbacks {
  onText(text: string, localEcho?: boolean): void;
  onPeers(count: number): void;
  onDisconnect(reason: string): void;
  onTransfer?(packet: TransferPacket, from: string): void;
  onDevices?(devices: Peer[]): void;
}

export interface Session {
  id: string;
  publish(text: string): void;
  sendTransfer(packet: TransferPacket, to: string): void;
  close(): Promise<void>;
}

const MAX_WIRE_BYTES = MAX_TEXT_BYTES * 8 + 4096;
const AUTH_TIMEOUT = 5000;
const deviceName = hostname().normalize('NFC').slice(0, 80);

function parseControl(wire: string): Record<string, unknown> {
  if (wire.length > 512) throw new Error('Invalid handshake');
  const value = JSON.parse(wire);
  if (!value || typeof value !== 'object') throw new Error('Invalid handshake');
  return value;
}

export async function hostSession(key: string, callbacks: Callbacks, port = DEFAULT_PORT, host = '0.0.0.0'): Promise<Session & { port: number }> {
  const server = new WebSocketServer({ host, port, maxPayload: MAX_WIRE_BYTES, perMessageDeflate: false });
  const authenticated = new Set<WebSocket>();
  const identities = new Map<WebSocket, Peer>();
  const seen = new RecentMessages();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closing = false;
  // Handle post-listen failures as well as the initial listen error.
  server.on('error', () => { if (!closing) callbacks.onDisconnect('연결 서버를 유지할 수 없습니다. 다시 연결해 주세요.'); });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  function broadcast(wire: string) {
    for (const client of authenticated) {
      if (client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount > MAX_WIRE_BYTES * 2) client.terminate();
        else client.send(wire);
      }
    }
  }

  function deviceList() {
    const peers = [{ id: 'host', name: deviceName }, ...identities.values()];
    callbacks.onDevices?.(peers.filter(peer => peer.id !== 'host'));
    for (const client of authenticated) client.send(JSON.stringify({ type: 'peers', peers }));
  }

  function route(wire: string, to: string) {
    for (const [socket, peer] of identities) {
      if (peer.id === to && socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > MAX_WIRE_BYTES * 2) throw new Error('파일 전송이 지연되고 있습니다.');
        socket.send(wire);
        return;
      }
    }
    throw new Error('받을 PC와 연결이 끊어졌습니다.');
  }

  server.on('connection', (client, request) => {
    // Browser pages must not be able to drive a local clipboard session.
    if (request.headers.origin || server.clients.size > 16) { client.close(1008); return; }
    const challenge = randomBytes(32).toString('base64url');
    const timer = setTimeout(() => client.terminate(), AUTH_TIMEOUT);
    timers.add(timer);
    client.send(JSON.stringify({ type: 'challenge', challenge }));
    client.on('error', () => client.terminate());
    client.on('message', (raw, binary) => {
      try {
        if (binary) throw new Error('Binary messages are not supported');
        const wire = raw.toString();
        if (!authenticated.has(client)) {
          const message = parseControl(wire);
          if (message.type !== 'auth' || !verifyProof(key, 'client', challenge, message.proof)) throw new Error('Authentication failed');
          clearTimeout(timer);
          timers.delete(timer);
          authenticated.add(client);
          const peer = { id: randomUUID(), name: typeof message.name === 'string' ? message.name.slice(0, 80) : '참여 PC' };
          identities.set(client, peer);
          client.send(JSON.stringify({ type: 'ready', selfId: peer.id, proof: proof(key, 'server', challenge) }));
          callbacks.onPeers(authenticated.size);
          deviceList();
          return;
        }
        const message = open(key, wire);
        if (!seen.accept(message.id)) return;
        if (message.transfer) {
          if (message.from !== identities.get(client)?.id) throw new Error('Invalid sender');
          if (message.to === 'host') callbacks.onTransfer?.(message.transfer, message.from!);
          else {
            try { route(wire, message.to!); }
            catch {
              client.send(sealTransfer(key, { type: 'cancel', transferId: message.transfer.transferId, reason: '받을 PC와 연결이 해제됐습니다.' }, message.to!, message.from!));
            }
          }
          return;
        }
        callbacks.onText(message.text);
        // Every peer, including the sender, applies the host's canonical order.
        // Omitting the sender here can leave simultaneous copies divergent.
        broadcast(wire);
      } catch {
        client.close(1008, 'Invalid session message');
      }
    });
    client.on('close', () => {
      clearTimeout(timer);
      timers.delete(timer);
      identities.delete(client);
      if (authenticated.delete(client) && !closing) { callbacks.onPeers(authenticated.size); deviceList(); }
    });
  });

  // Ping detects peers lost without a TCP close (sleep, Wi-Fi changes).
  const alive = new WeakSet<WebSocket>();
  server.on('connection', client => {
    alive.add(client);
    client.on('pong', () => alive.add(client));
  });
  const heartbeat = setInterval(() => {
    for (const client of server.clients) {
      if (!alive.has(client)) client.terminate();
      else { alive.delete(client); client.ping(); }
    }
  }, 15000);
  heartbeat.unref();

  return {
    id: 'host',
    port: (server.address() as { port: number }).port,
    publish(text) {
      const wire = seal(key, text);
      seen.accept(open(key, wire).id);
      broadcast(wire);
    },
    sendTransfer(packet, to) { route(sealTransfer(key, packet, 'host', to), to); },
    async close() {
      closing = true;
      clearInterval(heartbeat);
      for (const timer of timers) clearTimeout(timer);
      for (const client of server.clients) client.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

export async function joinSession(invitation: Invitation, callbacks: Callbacks): Promise<Session> {
  const address = invitation.host.includes(':') ? `[${invitation.host}]` : invitation.host;
  const client = new WebSocket(`ws://${address}:${invitation.port}`, { maxPayload: MAX_WIRE_BYTES, perMessageDeflate: false, handshakeTimeout: AUTH_TIMEOUT });
  const seen = new RecentMessages();
  const pending = new Set<string>();
  let ready = false;
  let closing = false;
  let challenge = '';
  let selfId = '';

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('연결 시간이 초과됐습니다. 같은 네트워크와 방화벽 설정을 확인해 주세요.')); client.terminate(); }, AUTH_TIMEOUT);
    client.on('error', () => reject(new Error('호스트에 연결할 수 없습니다. 초대 코드와 네트워크를 확인해 주세요.')));
    client.on('close', () => {
      clearTimeout(timer);
      if (!ready) reject(new Error('연결이 거부됐습니다. 호스트의 최신 초대 코드를 사용해 주세요.'));
      else if (!closing) callbacks.onDisconnect('호스트와 연결이 끊어졌습니다. 다시 참여해 주세요.');
    });
    client.on('message', (raw, binary) => {
      try {
        if (binary) throw new Error('Invalid message');
        const wire = raw.toString();
        if (ready && wire.startsWith('{"type":"peers"')) {
          const list = JSON.parse(wire);
          if (!Array.isArray(list.peers) || list.peers.length > 17 || list.peers.some((p: Peer) => !p || typeof p.id !== 'string' || !/^(host|[0-9a-f-]{36})$/.test(p.id) || typeof p.name !== 'string' || p.name.length > 80)) throw new Error('Invalid peers');
          callbacks.onDevices?.(list.peers.filter((p: Peer) => p.id !== selfId));
          return;
        }
        if (!ready) {
          const message = parseControl(wire);
          if (!challenge && message.type === 'challenge' && typeof message.challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.challenge)) {
            challenge = message.challenge;
            client.send(JSON.stringify({ type: 'auth', name: deviceName, proof: proof(invitation.key, 'client', challenge) }));
          } else if (challenge && message.type === 'ready' && verifyProof(invitation.key, 'server', challenge, message.proof)) {
            clearTimeout(timer);
            if (typeof message.selfId !== 'string' || !/^[0-9a-f-]{36}$/.test(message.selfId)) throw new Error('앱 버전을 확인해 주세요.');
            selfId = message.selfId;
            ready = true;
            callbacks.onPeers(1);
            resolve();
          } else throw new Error('Authentication failed');
          return;
        }
        const message = open(invitation.key, wire);
        if (message.transfer) {
          if (message.to !== selfId) throw new Error('Invalid recipient');
          if (seen.accept(message.id)) callbacks.onTransfer?.(message.transfer, message.from!);
          return;
        }
        if (seen.accept(message.id)) callbacks.onText(message.text, pending.delete(message.id));
      } catch {
        reject(new Error('연결을 인증할 수 없습니다. 새 초대 코드로 다시 시도해 주세요.'));
        client.close(1008, 'Invalid session message');
      }
    });
  });

  return {
    id: selfId,
    publish(text) {
      if (client.readyState !== WebSocket.OPEN) throw new Error('호스트와 연결이 끊어졌습니다.');
      if (client.bufferedAmount > MAX_WIRE_BYTES * 2) throw new Error('전송이 지연되고 있습니다. 잠시 후 다시 복사해 주세요.');
      const wire = seal(invitation.key, text);
      pending.add(open(invitation.key, wire).id);
      if (pending.size > 1024) pending.delete(pending.values().next().value!);
      client.send(wire);
    },
    sendTransfer(packet, to) {
      if (client.readyState !== WebSocket.OPEN) throw new Error('호스트와 연결이 끊어졌습니다.');
      if (client.bufferedAmount > MAX_WIRE_BYTES * 2) throw new Error('파일 전송이 지연되고 있습니다.');
      client.send(sealTransfer(invitation.key, packet, selfId, to));
    },
    async close() {
      closing = true;
      if (client.readyState === WebSocket.CLOSED) return;
      await new Promise<void>(resolve => {
        client.once('close', () => resolve());
        client.terminate();
      });
    },
  };
}
