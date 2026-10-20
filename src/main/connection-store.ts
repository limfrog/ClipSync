import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GroupCredentials } from '../shared/group';
import { validateStoredGroup } from './group-credentials';

export interface SecretStorage { available(): boolean; encrypt(text: string): Buffer; decrypt(data: Buffer): string }

/** Only derived secrets are persisted, protected by the operating system's key store. */
export class ConnectionStore {
  constructor(private readonly filename: string, private readonly secrets: SecretStorage) {}
  async load(): Promise<GroupCredentials | null> {
    let bytes: Buffer;
    try { bytes = await readFile(this.filename); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (!this.secrets.available()) throw new Error('운영체제 보안 저장소를 열 수 없어 자동 연결을 복원하지 못했습니다.');
    return validateStoredGroup(JSON.parse(this.secrets.decrypt(bytes)));
  }
  async save(credentials: GroupCredentials): Promise<boolean> {
    if (!this.secrets.available()) return false;
    const data = this.secrets.encrypt(JSON.stringify(validateStoredGroup(credentials)));
    await mkdir(path.dirname(this.filename), { recursive: true });
    await writeFile(`${this.filename}.tmp`, data, { mode: 0o600 });
    await rename(`${this.filename}.tmp`, this.filename);
    return true;
  }
  async clear() { await rm(this.filename, { force: true }); await rm(`${this.filename}.tmp`, { force: true }); }
}
