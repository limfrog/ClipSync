export interface GroupInput { groupKey: string; password: string }
export interface GroupCredentials {
  groupKey: string;
  deviceId: string;
  room: string;
  authKey: string;
  key: string;
  seed: string;
  peers?: string[];
  nodes?: { host: string; port: number }[];
}
export type GroupStatus = 'discovering' | 'connected' | 'reconnecting';
export interface ConnectionInfo { groupKey: string; remembered: boolean }
export const MAX_P2P_FRAME = 8 * 1024 * 1024 + 4096;

/** Shareable counters only: never include addresses, names or group/password material. */
export interface LANDiagnostics {
  udpReady: boolean;
  tcpReady: boolean;
  interfaces: number;
  beacons: number;
  receivedPackets: number;
  peerAnnouncements: number;
  otherGroupBeacons: number;
  rejectedBeacons: number;
  announcementsSent: number;
  connectAttempts: number;
  broadcastTargets: number;
  lastError: string | null;
}
