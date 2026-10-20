import type { Peer, TransferState } from './transfers';
import type { HistoryItem, Preferences } from './history';
import type { ConnectionInfo, GroupInput, GroupStatus } from './group';

export interface SyncState {
  mode: 'idle' | 'hosting' | 'joined' | 'group';
  groupStatus?: GroupStatus;
  paused: boolean;
  peers: number;
  invitation: string;
  sent: number;
  received: number;
  lastActivity: string | null;
  error: string | null;
  devices: Peer[];
  transfers: TransferState[];
  history: HistoryItem[];
  clipboardRevision: number;
  historyRevision: number;
}

export interface Result { ok: boolean; error?: string }

export interface ClipSyncAPI {
  connection(): Promise<ConnectionInfo>;
  createGroupKey(): Promise<string>;
  connectGroup(input: GroupInput): Promise<Result>;
  copyGroupKey(): Promise<Result>;
  preferences(): Promise<Preferences>;
  configure(preferences: Preferences): Promise<Result>;
  history(action: 'copy' | 'pin' | 'delete' | 'clear', id?: string): Promise<Result>;
  hide(): Promise<Result>;
  quit(): Promise<Result>;
  openDownloads(): Promise<Result>;
  onPreferences(listener: (preferences: Preferences) => void): () => void;
  state(): Promise<SyncState>;
  disconnect(): Promise<Result>;
  pause(paused: boolean): Promise<Result>;
  chooseFile(peerId: string): Promise<Result>;
  sendImage(peerId: string): Promise<Result>;
  acceptTransfer(id: string): Promise<Result>;
  cancelTransfer(id: string): Promise<Result>;
  showFile(id: string): Promise<Result>;
  copyImage(id: string): Promise<Result>;
  subscribe(listener: (state: SyncState) => void): () => void;
}
