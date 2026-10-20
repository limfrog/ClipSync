import type { Peer, TransferState } from './transfers';

export interface SyncState {
  mode: 'idle' | 'hosting' | 'joined';
  paused: boolean;
  peers: number;
  invitation: string;
  sent: number;
  received: number;
  lastActivity: string | null;
  error: string | null;
  devices: Peer[];
  transfers: TransferState[];
}

export interface Result { ok: boolean; error?: string }

export interface ClipSyncAPI {
  state(): Promise<SyncState>;
  host(): Promise<Result>;
  join(invitation: string): Promise<Result>;
  disconnect(): Promise<Result>;
  pause(paused: boolean): Promise<Result>;
  copyInvitation(): Promise<Result>;
  chooseFile(peerId: string): Promise<Result>;
  sendImage(peerId: string): Promise<Result>;
  acceptTransfer(id: string): Promise<Result>;
  cancelTransfer(id: string): Promise<Result>;
  showFile(id: string): Promise<Result>;
  copyImage(id: string): Promise<Result>;
  subscribe(listener: (state: SyncState) => void): () => void;
}
