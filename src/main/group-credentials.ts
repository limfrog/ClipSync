import { createHash, randomBytes, randomInt, randomUUID, scrypt } from 'node:crypto';
import type { GroupCredentials, GroupInput } from '../shared/group';

export function createGroupKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    const key = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join('');
    if (/[A-Za-z]/.test(key) && /[0-9]/.test(key)) return key;
  }
}

export async function deriveGroup(input: GroupInput, deviceId = randomUUID()): Promise<GroupCredentials> {
  if (!input || typeof input.groupKey !== 'string' || !/^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{20}$/.test(input.groupKey)) {
    throw new Error('연결 키는 영문과 숫자가 모두 포함된 20자리여야 합니다.');
  }
  if (typeof input.password !== 'string') throw new Error('비밀번호를 입력해 주세요.');
  const password = input.password.normalize('NFC');
  if ([...password].length < 8 || [...password].length > 128 || /[\r\n\0]/.test(password)) throw new Error('비밀번호는 8~128자로 정해 주세요.');
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, `ClipSync group v1:${input.groupKey}`, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
  });
  const authKey = bytes.subarray(32).toString('base64url');
  return { groupKey: input.groupKey, deviceId, seed: randomBytes(32).toString('base64url'), key: bytes.subarray(0, 32).toString('base64url'), authKey,
    room: createHash('sha256').update(Buffer.from(authKey, 'base64url')).digest('base64url') };
}

export function validateStoredGroup(value: unknown): GroupCredentials {
  if (!value || typeof value !== 'object') throw new Error('저장된 연결 정보를 읽을 수 없습니다.');
  const p = value as GroupCredentials;
  if (!/^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{20}$/.test(p.groupKey) || !/^[0-9a-f-]{36}$/.test(p.deviceId) ||
      ![p.room, p.authKey, p.key, p.seed].every(key => typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key) && Buffer.from(key, 'base64url').toString('base64url') === key) ||
      createHash('sha256').update(Buffer.from(p.authKey, 'base64url')).digest('base64url') !== p.room) throw new Error('저장된 연결 정보를 확인해 주세요.');
  return { groupKey: p.groupKey, deviceId: p.deviceId, room: p.room, authKey: p.authKey, key: p.key, seed: p.seed };
}
