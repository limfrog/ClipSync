import { createSocket } from 'node:dgram';
import { createServer, connect, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { GroupCredentials, LANDiagnostics } from '../shared/group';
import { proof, verifyProof } from './protocol';

/** Local discovery needs no internet. Only authenticated announcements can trigger a dial. */
export function discoverLAN(credentials: GroupCredentials, connected: (socket: Socket) => void, diagnostic?: (event: string) => void, options: { multicast?: boolean; broadcast?: boolean } = {}) {
  const reported = new Set<string>();
  function report(event: string) { if (reported.size < 40 && !reported.has(event)) { reported.add(event); diagnostic?.(event); } }
  let lastError: string | null = null, beacons = 0;
  let receivedPackets = 0, peerAnnouncements = 0, otherGroupBeacons = 0, rejectedBeacons = 0, announcementsSent = 0, connectAttempts = 0;
  const code = (error: unknown) => { lastError = (error as NodeJS.ErrnoException).code ?? 'unknown'; return lastError; };
  const bytes = Buffer.from(credentials.room, 'base64url');
  const address = `239.255.${bytes[0]}.${bytes[1]}`;
  const groups = options.multicast === false ? [] : [...new Set([address, '239.255.67.83'])];
  const port = 47834;
  const udp = createSocket({ type: 'udp4', reuseAddr: true });
  const server = createServer(socket => {
    if (stopped) { socket.destroy(); return; }
    socket.setKeepAlive(true, 5000); connected(socket);
  });
  const sockets = new Set<Socket>();
  const attempts = new Map<string, number>();
  const targets = new Set<string>();
  let stopped = false, ready = false, announcing = false, tcpPort = 0, lastReply = 0;
  let interfaces: string[] = [];
  let broadcasts: string[] = [];
  const payload = () => {
    const body = `${credentials.room}:${credentials.deviceId}:${tcpPort}`;
    return Buffer.from(JSON.stringify({ room: credentials.room, id: credentials.deviceId, port: tcpPort, mac: proof(credentials.authKey, 'lan', body) }));
  };
  function announce() {
    if (!ready || !tcpPort || stopped || announcing) return;
    const data = payload();
    const pending = [
      ...interfaces.flatMap(iface => groups.map(host => ({ iface, host }))),
      ...(options.broadcast === false ? [] : broadcasts.map(host => ({ host, iface: '' }))),
    ];
    announcing = true;
    function next() {
      const target = pending.shift();
      if (stopped || !target) { announcing = false; return; }
      try {
        // dgram.send resolves addresses asynchronously. Changing the interface before its
        // callback sends every queued packet on the final (possibly virtual/VPN) interface.
        if (target.iface) udp.setMulticastInterface(target.iface);
        udp.send(data, port, target.host, error => {
          if (error) report(`send ${target.iface || target.host}: ${code(error)}`);
          else announcementsSent++;
          next();
        });
      } catch (error) { report(`interface ${target.iface}: ${code(error)}`); next(); }
    }
    next();
  }
  function joinInterfaces() {
    if (!ready || stopped) return;
    const entries = Object.values(networkInterfaces()).flatMap(list => (list ?? []).filter(item => item.family === 'IPv4'));
    const next = [...new Set(entries.map(item => item.address))];
    for (const iface of next) if (!interfaces.includes(iface)) for (const group of groups) {
      try { udp.addMembership(group, iface); report(`joined ${iface}`); }
      catch (error) { report(`join ${iface}: ${code(error)}`); }
    }
    // Directed broadcasts stay on each adapter's own subnet, including when a VPN changes
    // the default route. No subnet scanning or internet broadcast destination is used.
    const number = (value: string) => value.split('.').reduce((total, byte) => (total << 8) | Number(byte), 0) >>> 0;
    broadcasts = [...new Set(entries.filter(item => !item.internal && item.netmask !== '255.255.255.255' && item.netmask !== '0.0.0.0').map(item => {
      const destination = (number(item.address) | ~number(item.netmask)) >>> 0;
      return [24, 16, 8, 0].map(shift => (destination >>> shift) & 255).join('.');
    }))];
    interfaces = next;
  }
  udp.on('error', error => report(`udp: ${code(error)}`)); // DHT remains available when multicast is prohibited.
  server.on('error', error => report(`tcp: ${code(error)}`));
  udp.on('message', (data, remote) => {
    if (stopped) return;
    receivedPackets++;
    if (data.length > 1024) return;
    try {
      const value = JSON.parse(data.toString());
      if (!value || typeof value !== 'object' || typeof value.room !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.room) ||
          typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id) || value.id === credentials.deviceId ||
          !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.mac !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.mac)) return;
      peerAnnouncements++;
      // Counts describe only discovery traffic; authentication still gates every dial.
      if (value.room !== credentials.room) { otherGroupBeacons++; return; }
      if (!verifyProof(credentials.authKey, 'lan', `${value.room}:${value.id}:${value.port}`, value.mac)) { rejectedBeacons++; return; }
      beacons++; report(`beacon ${remote.address}`);
      if (Date.now() - lastReply > 500) { lastReply = Date.now(); announce(); }
      // One deterministic initiator prevents simultaneous TCP connections on both PCs.
      if (credentials.deviceId > value.id) return;
      const key = `${value.id}:${remote.address}:${value.port}`;
      if (targets.has(value.id) || Date.now() - (attempts.get(key) ?? 0) < 1500 || sockets.size >= 16) return;
      if (attempts.size > 64) attempts.clear();
      attempts.set(key, Date.now()); targets.add(value.id);
      connectAttempts++;
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
    report('udp ready'); ready = true;
    try { udp.setBroadcast(true); } catch (error) { report(`broadcast: ${code(error)}`); }
    udp.setMulticastTTL(1); udp.setMulticastLoopback(true); joinInterfaces(); announce();
  });
  const timer = setInterval(announce, 1000); timer.unref();
  const interfacesTimer = setInterval(() => { joinInterfaces(); announce(); }, 10000); interfacesTimer.unref();
  return {
    refresh: announce,
    diagnostics: (): LANDiagnostics => ({ udpReady: ready, tcpReady: tcpPort > 0, interfaces: interfaces.length, beacons, receivedPackets, peerAnnouncements, otherGroupBeacons, rejectedBeacons, announcementsSent, connectAttempts, broadcastTargets: broadcasts.length, lastError }),
    close() {
      stopped = true; clearInterval(timer); clearInterval(interfacesTimer);
      for (const socket of sockets) socket.destroy();
      server.close(); try { udp.close(); } catch { /* Already closed. */ }
    },
  };
}
