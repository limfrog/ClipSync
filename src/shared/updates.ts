export interface ReleaseUpdate {
  version: string;
  preview: boolean;
  bytes: number;
  downloadUrl: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'error' | 'unsupported';
  currentVersion: string;
  checkedAt?: string;
  release?: ReleaseUpdate;
  error?: string;
}
