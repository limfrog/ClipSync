declare module 'hyperswarm' {
  import { EventEmitter } from 'node:events';
  import { Duplex } from 'node:stream';
  export interface PeerSocket extends Duplex { handshakeHash: Buffer; remotePublicKey: Buffer; setKeepAlive(ms: number): void }
  export default class Hyperswarm extends EventEmitter {
    constructor(options?: { seed?: Buffer; bootstrap?: string[]; maxPeers?: number; relayThrough?: null; backoffs?: number[] });
    connections: Set<PeerSocket>;
    keyPair: { publicKey: Buffer; secretKey: Buffer };
    dht: EventEmitter & { bootstrapped: boolean; stats: { relaying: { attempts: number; successes: number } } };
    join(topic: Buffer, options?: { server: boolean; client: boolean }): { refresh(): Promise<void>; flushed(): Promise<void> };
    joinPeer(publicKey: Buffer): void;
    leavePeer(publicKey: Buffer): void;
    destroy(): Promise<void>;
  }
}
declare module 'hyperdht' {
  import { EventEmitter } from 'node:events';
  export default class DHT extends EventEmitter {
    static bootstrapper(port: number, host: string): DHT;
    ready(): Promise<void>;
    address(): { port: number; host: string };
    destroy(options?: { force: boolean }): Promise<void>;
  }
}
declare module 'hyperdht/testnet.js' {
  export default function testnet(size: number): Promise<{ bootstrap: { host: string; port: number }[]; destroy(): Promise<void> }>;
}
