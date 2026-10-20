export const MAX_FILE_BYTES = 500_000_000;
export const CHUNK_BYTES = 256 * 1024;

export interface Peer { id: string; name: string; transport?: 'lan' | 'p2p' }
export interface ClipboardBatch { id: string; index: number; count: number }
export type TransferPacket =
  | { type: 'offer'; transferId: string; name: string; size: number; sha256: string; image: boolean; clipboard?: ClipboardBatch }
  | { type: 'accept' | 'finish' | 'done'; transferId: string }
  | { type: 'cancel'; transferId: string; reason: string }
  | { type: 'chunk'; transferId: string; offset: number; data: string }
  | { type: 'ack'; transferId: string; offset: number };

export interface TransferState {
  id: string;
  direction: 'send' | 'receive';
  peerId: string;
  name: string;
  size: number;
  bytes: number;
  image: boolean;
  status: 'offered' | 'sending' | 'receiving' | 'completed' | 'cancelled' | 'failed';
  error: string | null;
  clipboard?: ClipboardBatch;
}

export function isTransferPacket(value: unknown): value is TransferPacket {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (typeof p.transferId !== 'string' || !/^[0-9a-f-]{36}$/.test(p.transferId)) return false;
  switch (p.type) {
    case 'offer': return typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 1024 &&
      (p.clipboard === undefined || validBatch(p.clipboard)) &&
      Number.isSafeInteger(p.size) && Number(p.size) >= 0 && Number(p.size) <= MAX_FILE_BYTES &&
      typeof p.sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.sha256) && typeof p.image === 'boolean';
    case 'accept': case 'finish': case 'done': return true;
    case 'cancel': return typeof p.reason === 'string' && p.reason.length <= 240;
    case 'ack': return Number.isSafeInteger(p.offset) && Number(p.offset) >= 0 && Number(p.offset) <= MAX_FILE_BYTES;
    case 'chunk': return Number.isSafeInteger(p.offset) && Number(p.offset) >= 0 && Number(p.offset) <= MAX_FILE_BYTES &&
      typeof p.data === 'string' && p.data.length > 0 && p.data.length <= Math.ceil(CHUNK_BYTES / 3) * 4;
    default: return false;
  }
}

function validBatch(value: unknown): value is ClipboardBatch {
  if (!value || typeof value !== 'object') return false;
  const b = value as ClipboardBatch;
  return typeof b.id === 'string' && /^[0-9a-f-]{36}$/.test(b.id) && Number.isInteger(b.count) && b.count > 0 && b.count <= 16 && Number.isInteger(b.index) && b.index >= 0 && b.index < b.count;
}
