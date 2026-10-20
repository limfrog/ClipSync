import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { isTransferPacket, type TransferPacket } from '../shared/transfers';

export const MAX_TEXT_BYTES = 1024 * 1024;
export const DEFAULT_PORT = 47832;

export interface Invitation { host: string; port: number; key: string }
export interface ClipboardMessage { id: string; text: string; transfer?: TransferPacket; from?: string; to?: string; clock?: number }

export function createKey(): string {
  return randomBytes(32).toString('base64url');
}

function keyBuffer(key: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('올바르지 않은 초대 코드입니다.');
  const bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== key) throw new Error('올바르지 않은 초대 코드입니다.');
  return bytes;
}

export function createInvitation(invitation: Invitation): string {
  const url = new URL('clipsync://join');
  url.search = new URLSearchParams({ host: invitation.host, port: String(invitation.port), key: invitation.key }).toString();
  return url.toString();
}

export function parseInvitation(value: string): Invitation {
  try {
    if (typeof value !== 'string' || value.length > 512) throw new Error();
    const url = new URL(value.trim());
    const host = url.searchParams.get('host') ?? '';
    const port = Number(url.searchParams.get('port'));
    const key = url.searchParams.get('key') ?? '';
    if (url.protocol !== 'clipsync:' || url.hostname !== 'join' || (url.pathname && url.pathname !== '/') ||
        url.username || url.password || url.hash || !isIP(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    keyBuffer(key);
    return { host, port, key };
  } catch {
    throw new Error('초대 코드를 확인해 주세요. 호스트 PC에서 새 코드를 복사할 수 있습니다.');
  }
}

export function proof(key: string, role: 'client' | 'server' | 'lan', challenge: string): string {
  return createHmac('sha256', keyBuffer(key)).update(`${role}:${challenge}`).digest('base64url');
}

export function verifyProof(key: string, role: 'client' | 'server' | 'lan', challenge: string, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(proof(key, role, challenge)), Buffer.from(candidate));
}

export function seal(key: string, text: string, id = randomUUID()): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('1MB 이하의 텍스트만 동기화할 수 있습니다.');
  return encrypt(key, { id, text });
}

export function sealTransfer(key: string, transfer: TransferPacket, from: string, to: string, id = randomUUID()): string {
  if (!isTransferPacket(transfer)) throw new Error('Invalid transfer packet');
  return encrypt(key, { id, text: '', transfer, from, to });
}

export function sealGroupText(key: string, text: string, clock: number, from: string): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('1MB 이하의 텍스트만 동기화할 수 있습니다.');
  return encrypt(key, { id: randomUUID(), text, clock, from });
}

function encrypt(key: string, message: ClipboardMessage): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(key), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
  return JSON.stringify({ type: 'data', nonce: nonce.toString('base64'), data: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}

export function open(key: string, wire: string): ClipboardMessage {
  const envelope = JSON.parse(wire);
  if (envelope?.type !== 'data' || typeof envelope.nonce !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.data !== 'string') throw new Error('Invalid envelope');
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (nonce.length !== 12 || tag.length !== 16 || envelope.data.length > MAX_TEXT_BYTES * 8 + 1024) throw new Error('Invalid payload');
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer(key), nonce);
  decipher.setAuthTag(tag);
  const clear = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  const message = JSON.parse(clear.toString('utf8'));
  if (typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) ||
      typeof message.text !== 'string' || Buffer.byteLength(message.text, 'utf8') > MAX_TEXT_BYTES) throw new Error('Invalid clipboard message');
  if (message.transfer !== undefined) {
    if (!isTransferPacket(message.transfer) || typeof message.from !== 'string' || typeof message.to !== 'string' ||
        !/^(host|[0-9a-f-]{36})$/.test(message.from) || !/^(host|[0-9a-f-]{36})$/.test(message.to)) throw new Error('Invalid transfer routing');
    return { id: message.id, text: '', transfer: message.transfer, from: message.from, to: message.to };
  }
  if (message.clock !== undefined) {
    if (!Number.isSafeInteger(message.clock) || message.clock < 1 || typeof message.from !== 'string' || !/^[0-9a-f-]{36}$/.test(message.from)) throw new Error('Invalid group ordering');
    return { id: message.id, text: message.text, clock: message.clock, from: message.from };
  }
  return { id: message.id, text: message.text };
}

export class RecentMessages {
  private readonly ids = new Set<string>();

  accept(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > 1024) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
}
