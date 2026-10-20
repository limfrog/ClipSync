import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { Duplex } from 'node:stream';
import { discoverLAN } from './lan-discovery';
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
interface Member { socket: Duplex; id: string; name: string; rank: string; lastSeen: number }
export interface P2POptions { bootstrap?: string[]; lan?: boolean; lanDiagnostic?(event: string): void; onHints?(hints: { peers: string[]; nodes: { host: string; port: number }[] }): void }
export interface P2PSession extends Session { diagnostics(): { peers: number; relayAttempts: number; lanPeers: number; routingNodes: number; lan?: { udpReady: boolean; tcpReady: boolean; interfaces: number; beacons: number; lastError: string | null } } }

/** LAN multicast/TCP and WAN DHT/Noise race in parallel; payloads are always authenticated and encrypted. */
export function groupSession(credentials: GroupCredentials, callbacks: Callbacks, options: P2POptions = {}): P2PSession {
  const swarm = new Hyperswarm({ seed: Buffer.from(credentials.seed, 'base64url'), maxPeers: 15,
    bootstrap: options.bootstrap, nodes: credentials.nodes, relayThrough: null, maxParallel: 6, jitter: 250, backoffs: [500, 1000, 2500, 5000] });
  const members = new Map<string, Member>();
  const seen = new RecentMessages();
  const sockets = new Set<Duplex>();
  const known = new Set(credentials.peers ?? []);
  for (const key of known) swarm.joinPeer(Buffer.from(key, 'base64url'));
  function remember(key: string) {
    known.delete(key); known.add(key);
    while (known.size > 15) known.delete(known.values().next().value!);
    options.onHints?.({ peers: [...known], nodes: swarm.dht.toArray({ limit: 16 }) });
  }
  let closed = false;
  let hadPeers = false;
  let clock = 0;
  let lastStamp = { clock: 0, from: '' };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function update() {
    if (closed) return;
    const peers = [...members.values()].map(({ id, name, rank }) => ({ id, name, transport: rank.startsWith('0:') ? 'lan' as const : 'p2p' as const }));
    callbacks.onDevices(peers); callbacks.onPeers(peers.length);
    callbacks.onStatus(peers.length ? 'connected' : hadPeers ? 'reconnecting' : 'discovering');
  }
  function send(socket: Duplex, message: unknown) {
    if (socket.destroyed || socket.writableLength > MAX_P2P_FRAME * 2) throw new Error('P2P 연결이 지연되고 있습니다.');
    const payload = Buffer.from(JSON.stringify(message));
    if (payload.length > MAX_P2P_FRAME) throw new Error('P2P 메시지가 너무 큽니다.');
    const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
    socket.write(Buffer.concat([header, payload]));
  }
  function attach(socket: Duplex, noise?: PeerSocket) {
    if (closed || sockets.size >= 48) { socket.destroy(); return; }
    sockets.add(socket);
    noise?.setKeepAlive(5000);
    const challenge = randomBytes(32).toString('base64url');
    let hello: { id: string; name: string; challenge: string; publicKey?: string } | undefined;
    let authenticated = false;
    let buffer: Buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => socket.destroy(), 8000); timeout.unref(); timers.add(timeout);
    socket.on('error', () => {});
    send(socket, { type: 'hello', id: credentials.deviceId, ...(!noise ? { publicKey: swarm.keyPair.publicKey.toString('base64url') } : {}), name: hostname().normalize('NFC').slice(0, 80), challenge });
    function binding() {
      return noise ? noise.handshakeHash.toString('base64url') : `ClipSync LAN v1:${[swarm.keyPair.publicKey.toString('base64url'), hello!.publicKey!].sort().join(':')}`;
    }
    function message(value: Record<string, unknown>) {
      if (!authenticated) {
        if (!hello && value.type === 'hello' && typeof value.id === 'string' && /^[0-9a-f-]{36}$/.test(value.id) && value.id !== credentials.deviceId &&
            typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 80 && typeof value.challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.challenge)) {
          if (!noise && (typeof value.publicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.publicKey))) throw new Error('Invalid key');
          hello = { id: value.id, name: value.name, challenge: value.challenge, publicKey: value.publicKey as string | undefined };
          const context = `${hello.challenge}:${challenge}:${hello.id}:${credentials.deviceId}:${binding()}`;
          send(socket, { type: 'auth', clock, proof: proof(credentials.authKey, 'client', context) }); return;
        }
        if (hello && value.type === 'auth' && verifyProof(credentials.authKey, 'client', `${challenge}:${hello.challenge}:${credentials.deviceId}:${hello.id}:${binding()}`, value.proof)) {
          if (!Number.isSafeInteger(value.clock) || (value.clock as number) < 0) throw new Error('Invalid device');
          const rank = `${noise ? '1' : '0'}:${createHash('sha256').update([challenge, hello.challenge].sort().join(':')).digest('hex')}`;
          const previous = members.get(hello.id);
          if ((!previous && members.size >= 15) || (previous && previous.rank <= rank)) { socket.destroy(); return; }
          clock = Math.max(clock, value.clock as number);
          clearTimeout(timeout); timers.delete(timeout); authenticated = true; hadPeers = true;
          members.set(hello.id, { socket, id: hello.id, name: hello.name, rank, lastSeen: Date.now() });
          previous?.socket.destroy();
          const publicKey = noise?.remotePublicKey ?? Buffer.from(hello.publicKey!, 'base64url');
          remember(publicKey.toString('base64url'));
          swarm.joinPeer(publicKey); update(); return;
        }
        throw new Error('Authentication failed');
      }
      if (!noise && (value.type === 'ping' || value.type === 'pong')) {
        const member = members.get(hello!.id);
        if (member?.socket === socket) member.lastSeen = Date.now();
        if (value.type === 'ping') send(socket, { type: 'pong' });
        return;
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
      sockets.delete(socket); clearTimeout(timeout); timers.delete(timeout);
      if (hello && members.get(hello.id)?.socket === socket) { members.delete(hello.id); update(); }
    });
  }
  swarm.on('connection', (socket: PeerSocket) => attach(socket, socket));
  const lan = options.lan === false ? undefined : discoverLAN(credentials, socket => attach(socket), options.lanDiagnostic);
  swarm.on('error', () => { if (!closed && !members.size) callbacks.onStatus('reconnecting', 'P2P 탐색을 다시 시도하고 있습니다. 네트워크와 방화벽을 확인해 주세요.'); });
  const discovery = swarm.join(Buffer.from(credentials.room, 'base64url'), { server: true, client: true });
  void discovery.flushed().then(async () => { update(); if (!closed) await discovery.refresh(); }).catch(() => {
    if (!closed && !members.size) callbacks.onStatus('reconnecting', '상대 기기를 찾지 못했습니다. UDP 연결과 네트워크를 확인해 주세요.');
  });
  let refreshCount = 0, lastRefresh = 0;
  const refresh = setInterval(() => {
    if (closed) return;
    refreshCount++;
    if (refreshCount <= 6 || refreshCount % 6 === 0) void discovery.refresh().catch(() => {});
    for (const member of members.values()) {
      if (!member.rank.startsWith('0:')) continue;
      if (Date.now() - member.lastSeen > 15000) member.socket.destroy();
      else { try { send(member.socket, { type: 'ping' }); } catch { member.socket.destroy(); } }
    }
    if (refreshCount % 6 === 0 && known.size) options.onHints?.({ peers: [...known], nodes: swarm.dht.toArray({ limit: 16 }) });
  }, 5000); refresh.unref();
  const discoverWarning = setTimeout(() => {
    if (!closed && !members.size) callbacks.onStatus(hadPeers ? 'reconnecting' : 'discovering', swarm.dht.toArray({ limit: 1 }).length
      ? '같은 키·비밀번호와 방화벽의 ClipSync 허용을 확인해 주세요. 외부망은 NAT 제한으로 직접 연결되지 않을 수 있습니다.'
      : '외부 탐색망에 접근하지 못했습니다. 방화벽의 ClipSync·UDP 허용을 확인해 주세요. 내부 네트워크 탐색은 계속합니다.');
  }, 25000); discoverWarning.unref();
  return {
    id: credentials.deviceId,
    refresh() {
      if (closed || Date.now() - lastRefresh < 2000) return;
      lastRefresh = Date.now(); refreshCount = 0; lan?.refresh();
      for (const key of known) swarm.joinPeer(Buffer.from(key, 'base64url'));
      void discovery.refresh().catch(() => {}); update();
    },
    diagnostics: () => ({ peers: members.size, relayAttempts: swarm.dht.stats.relaying.attempts, lanPeers: [...members.values()].filter(member => member.rank.startsWith('0:')).length, routingNodes: swarm.dht.toArray({ limit: 16 }).length, lan: lan?.diagnostics() }),
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
      lan?.close(); for (const socket of sockets) socket.destroy();
      await swarm.destroy();
    },
  };
}
