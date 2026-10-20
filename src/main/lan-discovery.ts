import { createSocket } from 'node:dgram';
import { createServer, connect, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { GroupCredentials } from '../shared/group';
import { proof, verifyProof } from './protocol';

/** Local discovery needs no internet. Only authenticated announcements can trigger a dial. */
export function discoverLAN(credentials: GroupCredentials, connected: (socket: Socket) => void, diagnostic?: (event: string) => void) {
  const reported = new Set<string>();
  function report(event: string) { if (reported.size < 40 && !reported.has(event)) { reported.add(event); diagnostic?.(event); } }
  const code = (error: unknown) => (error as NodeJS.ErrnoException).code ?? 'unknown';
  const bytes = Buffer.from(credentials.room, 'base64url');
  const address = `239.255.${bytes[0]}.${bytes[1]}`;
  const port = 47834;
  const udp = createSocket({ type: 'udp4', reuseAddr: true });
  const server = createServer(socket => {
    if (stopped) { socket.destroy(); return; }
    socket.setKeepAlive(true, 5000); connected(socket);
  });
  const sockets = new Set<Socket>();
  const attempts = new Map<string, number>();
  const targets = new Set<string>();
  let stopped = false, ready = false, tcpPort = 0, lastReply = 0;
  let interfaces: string[] = [];
  const payload = () => {
    const body = `${credentials.room}:${credentials.deviceId}:${tcpPort}`;
    return Buffer.from(JSON.stringify({ room: credentials.room, id: credentials.deviceId, port: tcpPort, mac: proof(credentials.authKey, 'lan', body) }));
  };
  function announce() {
    if (!ready || !tcpPort || stopped) return;
    const data = payload();
    for (const iface of interfaces) {
      try { udp.setMulticastInterface(iface); udp.send(data, port, address, error => { if (error) report(`send ${iface}: ${code(error)}`); }); } catch (error) { report(`interface ${iface}: ${code(error)}`); /* Interface may disappear during sleep/VPN changes. */ }
    }
  }
  function joinInterfaces() {
    if (!ready || stopped) return;
    const next = [...new Set(Object.values(networkInterfaces()).flatMap(list => (list ?? []).filter(item => item.family === 'IPv4').map(item => item.address)))];
    for (const iface of next) if (!interfaces.includes(iface)) { try { udp.addMembership(address, iface); report(`joined ${iface}`); } catch (error) { report(`join ${iface}: ${code(error)}`); /* Some virtual interfaces do not support multicast. */ } }
    interfaces = next;
  }
  udp.on('error', error => report(`udp: ${code(error)}`)); // DHT remains available when multicast is prohibited.
  server.on('error', error => report(`tcp: ${code(error)}`));
  udp.on('message', (data, remote) => {
    if (stopped || data.length > 1024) return;
    try {
      const value = JSON.parse(data.toString());
      if (value.room !== credentials.room || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id) || value.id === credentials.deviceId ||
          !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
          !verifyProof(credentials.authKey, 'lan', `${value.room}:${value.id}:${value.port}`, value.mac)) return;
      report(`beacon ${remote.address}`);
      if (Date.now() - lastReply > 500) { lastReply = Date.now(); announce(); }
      // One deterministic initiator prevents simultaneous TCP connections on both PCs.
      if (credentials.deviceId > value.id) return;
      const key = `${value.id}:${remote.address}:${value.port}`;
      if (targets.has(value.id) || Date.now() - (attempts.get(key) ?? 0) < 1500 || sockets.size >= 16) return;
      if (attempts.size > 64) attempts.clear();
      attempts.set(key, Date.now()); targets.add(value.id);
      const socket = connect({ host: remote.address, port: value.port });
      report(`dial ${remote.address}`);
      sockets.add(socket); socket.setTimeout(4000, () => socket.destroy());
      socket.on('error', error => report(`connect ${remote.address}: ${code(error)}`)); socket.on('close', () => { sockets.delete(socket); targets.delete(value.id); });
      socket.once('connect', () => { socket.setTimeout(0); socket.setKeepAlive(true, 5000); connected(socket); });
    } catch { /* Untrusted LAN traffic is ignored. */ }
  });
  server.listen(0, '0.0.0.0', () => {
    if (stopped) { server.close(); return; }
    const info = server.address(); if (info && typeof info !== 'string') tcpPort = info.port;
    announce();
  });
  udp.bind(port, '0.0.0.0', () => {
    if (stopped) { udp.close(); return; }
    report('udp ready'); ready = true; udp.setMulticastTTL(1); udp.setMulticastLoopback(true); joinInterfaces(); announce();
  });
  const timer = setInterval(announce, 1000); timer.unref();
  const interfacesTimer = setInterval(() => { joinInterfaces(); announce(); }, 10000); interfacesTimer.unref();
  return {
    refresh: announce,
    close() {
      stopped = true; clearInterval(timer); clearInterval(interfacesTimer);
      for (const socket of sockets) socket.destroy();
      server.close(); try { udp.close(); } catch { /* Already closed. */ }
    },
  };
}
