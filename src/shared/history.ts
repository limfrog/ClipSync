import type { TransferState } from './transfers';

export interface HistoryItem {
  id: string;
  type: 'text' | 'image' | 'file';
  preview: string;
  source: 'local' | 'remote';
  pinned: boolean;
  copiedAt: string;
  transfer?: TransferState;
  mediaId?: string;
  size?: number;
  thumbnail?: string;
}

export interface Preferences {
  theme: 'system' | 'dark' | 'light';
  alwaysOnTop: boolean;
  startOnLogin: boolean;
  startupStatus?: 'unsupported' | 'unavailable' | 'disabled' | 'enabled' | 'requires-approval' | 'blocked';
  shortcut: string;
  shortcutAvailable?: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system', alwaysOnTop: false, startOnLogin: false, shortcut: 'CommandOrControl+Shift+V',
};
