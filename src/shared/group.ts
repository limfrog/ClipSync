export interface GroupInput { groupKey: string; password: string }
export interface GroupCredentials {
  groupKey: string;
  deviceId: string;
  room: string;
  authKey: string;
  key: string;
  seed: string;
}
export type GroupStatus = 'discovering' | 'connected' | 'reconnecting';
export interface ConnectionInfo { groupKey: string; remembered: boolean }
export const MAX_P2P_FRAME = 8 * 1024 * 1024 + 4096;
