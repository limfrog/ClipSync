import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import Hyperswarm, { type PeerSocket } from 'hyperswarm';
import type { GroupCredentials, GroupStatus } from '../shared/group';
import { MAX_P2P_FRAME } from '../shared/group';
import type { Peer, TransferPacket } from '../shared/transfers';
import { open, proof, RecentMessages, sealGroupText, sealTransfer, verifyProof } from './protocol';
import type { Session } from './session';

interface Callbacks {
  onText(text: string, localEcho?: boolean): void;
  onPeers(count: number): void;
  onDevices(devices: Peer[]): void;
  onTransfer(packet: TransferPacket, from: string): void;
  onStatus(status: GroupStatus, error?: string): void;
}
interface Member { socket: PeerSocket; id: string; name: string }
export interface P2POptions { bootstrap?: string[] }
export interface P2PSession extends Session { diagnostics(): { peers: number; relayAttempts: number } }

/** All PCs announce and discover a private topic; clipboard data uses direct Noise streams. */
export function groupSession(credentials: GroupCredentials, callbacks: Callbacks, options: P2POptions = {}): P2PSession {
  const swarm = new Hyperswarm({ seed: Buffer.from(credentials.seed, 'base64url'), maxPeers: 15,
    bootstrap: options.bootstrap, relayThrough: null, backoffs: [1000, 2000, 5000, 10000, 20000] });
  const members = new Map<string, Member>();
  const seen = new RecentMessages();
  let closed = false;
  let hadPeers = false;
  let clock = 0;
  let lastStamp = { clock: 0, from: '' };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function update() {
    if (closed) return;
    const peers = [...members.values()].map(({ id, name }) => ({ id, name }));
    callbacks.onDevices(peers); callbacks.onPeers(peers.length);
    callbacks.onStatus(peers.length ? 'connected' : hadPeers ? 'reconnecting' : 'discovering');
  }
  function send(socket: PeerSocket, message: unknown) {
    if (socket.destroyed || socket.writableLength > MAX_P2P_FRAME * 2) throw new Error('P2P 연결이 지연되고 있습니다.');
    const payload = Buffer.from(JSON.stringify(message));
    if (payload.length > MAX_P2P_FRAME) throw new Error('P2P 메시지가 너무 큽니다.');
    const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
    socket.write(Buffer.concat([header, payload]));
  }
  swarm.on('connection', (socket: PeerSocket) => {
    if (closed || members.size >= 15) { socket.destroy(); return; }
    socket.setKeepAlive(5000);
    const challenge = randomBytes(32).toString('base64url');
    let hello: { id: string; name: string; challenge: string } | undefined;
    let authenticated = false;
    let buffer: Buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => socket.destroy(), 8000); timeout.unref(); timers.add(timeout);
    socket.on('error', () => {});
    send(socket, { type: 'hello', id: credentials.deviceId, name: hostname().normalize('NFC').slice(0, 80), challenge });
    function message(value: Record<string, unknown>) {
      if (!authenticated) {
        if (!hello && value.type === 'hello' && typeof value.id === 'string' && /^[0-9a-f-]{36}$/.test(value.id) && value.id !== credentials.deviceId &&
            typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 80 && typeof value.challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.challenge)) {
          hello = { id: value.id, name: value.name, challenge: value.challenge };
          const context = `${hello.challenge}:${challenge}:${hello.id}:${credentials.deviceId}:${socket.handshakeHash.toString('base64url')}`;
          send(socket, { type: 'auth', clock, proof: proof(credentials.authKey, 'client', context) }); return;
        }
        if (hello && value.type === 'auth' && verifyProof(credentials.authKey, 'client', `${challenge}:${hello.challenge}:${credentials.deviceId}:${hello.id}:${socket.handshakeHash.toString('base64url')}`, value.proof)) {
          if (members.has(hello.id) || !Number.isSafeInteger(value.clock) || (value.clock as number) < 0) throw new Error('Invalid device');
          clock = Math.max(clock, value.clock as number);
          clearTimeout(timeout); timers.delete(timeout); authenticated = true; hadPeers = true;
          members.set(hello.id, { socket, id: hello.id, name: hello.name });
          swarm.joinPeer(socket.remotePublicKey); update(); return;
        }
        throw new Error('Authentication failed');
      }
      if (value.type !== 'data' || typeof value.payload !== 'string') throw new Error('Invalid data');
      const data = open(credentials.key, value.payload);
      if (data.from !== hello!.id) throw new Error('Invalid sender');
      if (!seen.accept(data.id)) return;
      if (data.transfer) {
        if (data.to !== credentials.deviceId) throw new Error('Invalid destination');
        callbacks.onTransfer(data.transfer, hello!.id); return;
      }
      if (data.clock === undefined) throw new Error('Missing message order');
      clock = Math.max(clock, data.clock);
      if (data.clock > lastStamp.clock || data.clock === lastStamp.clock && data.from! > lastStamp.from) {
        lastStamp = { clock: data.clock, from: data.from! }; callbacks.onText(data.text);
      }
    }
    socket.on('data', (chunk: Buffer) => {
      try {
        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
        while (buffer.length >= 4) {
          const size = buffer.readUInt32BE(0);
          if (size < 2 || size > (authenticated ? MAX_P2P_FRAME : 2048)) throw new Error('Invalid frame');
          if (buffer.length < size + 4) break;
          const value = JSON.parse(buffer.subarray(4, size + 4).toString());
          buffer = buffer.subarray(size + 4);
          if (!value || typeof value !== 'object') throw new Error('Invalid message');
          message(value);
        }
        if (buffer.length > MAX_P2P_FRAME + 4) throw new Error('Frame overflow');
      } catch { socket.destroy(); }
    });
    socket.on('close', () => {
      clearTimeout(timeout); timers.delete(timeout);
      if (hello && members.get(hello.id)?.socket === socket) { members.delete(hello.id); update(); }
    });
  });
  swarm.on('error', () => { if (!closed) callbacks.onStatus('reconnecting', 'P2P 탐색을 다시 시도하고 있습니다. 네트워크와 방화벽을 확인해 주세요.'); });
  const discovery = swarm.join(Buffer.from(credentials.room, 'base64url'), { server: true, client: true });
  void discovery.flushed().then(async () => { update(); if (!closed) await discovery.refresh(); }).catch(() => {
    if (!closed) callbacks.onStatus('reconnecting', '상대 기기를 찾지 못했습니다. UDP 연결과 네트워크를 확인해 주세요.');
  });
  const refresh = setInterval(() => { if (!closed) void discovery.refresh().catch(() => {}); }, 30000); refresh.unref();
  const discoverWarning = setTimeout(() => {
    if (!closed && !members.size) callbacks.onStatus('discovering', '같은 키·비밀번호의 기기를 찾는 중입니다. 계속 연결되지 않으면 UDP 차단 또는 NAT 제한을 확인해 주세요.');
  }, 25000); discoverWarning.unref();
  return {
    id: credentials.deviceId,
    diagnostics: () => ({ peers: members.size, relayAttempts: swarm.dht.stats.relaying.attempts }),
    publish(text) {
      const stamp = ++clock;
      const payload = sealGroupText(credentials.key, text, stamp, credentials.deviceId);
      lastStamp = { clock: stamp, from: credentials.deviceId };
      for (const member of members.values()) send(member.socket, { type: 'data', payload });
    },
    sendTransfer(packet, to) {
      const member = members.get(to);
      if (!member) throw new Error('상대 PC와 P2P 연결을 복원하는 중입니다.');
      send(member.socket, { type: 'data', payload: sealTransfer(credentials.key, packet, credentials.deviceId, to) });
    },
    async close() {
      if (closed) return;
      closed = true; clearInterval(refresh); clearTimeout(discoverWarning); for (const timer of timers) clearTimeout(timer);
      for (const socket of swarm.connections) socket.destroy();
      await swarm.destroy();
    },
  };
}
