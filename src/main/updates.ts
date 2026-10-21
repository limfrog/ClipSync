import type { ReleaseUpdate, UpdateState } from '../shared/updates';

export const RELEASES_API = 'https://api.github.com/repos/limfrog/ClipSync/releases?per_page=20';
const DOWNLOAD_ROOT = 'https://github.com/limfrog/ClipSync/releases/download/';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const COOLDOWN_MS = 60_000;

function versionParts(version: unknown): number[] | undefined {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || version.length > 30) return;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a); const right = versionParts(b);
  if (!left || !right) throw new Error('올바르지 않은 버전 정보입니다.');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

function installerSuffix(platform: string, arch: string): string | undefined {
  if (platform === 'win32' && arch === 'x64') return 'Windows-x64-Setup.exe';
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return `macOS-${arch}.pkg`;
}

export function selectRelease(data: unknown, current: string, platform: string, arch: string): ReleaseUpdate | undefined {
  if (!Array.isArray(data) || data.length > 20) throw new Error('GitHub의 버전 정보를 읽을 수 없습니다.');
  const suffix = installerSuffix(platform, arch);
  if (!suffix) return;
  let latest: ReleaseUpdate | undefined;
  let newer = false;
  for (const value of data) {
    if (!value || typeof value !== 'object' || value.draft !== false || typeof value.prerelease !== 'boolean') continue;
    const tag = value.tag_name;
    if (typeof tag !== 'string' || !tag.startsWith('v') || !versionParts(tag.slice(1))) continue;
    const version = tag.slice(1);
    if (compareVersions(version, current) <= 0 || (latest && compareVersions(version, latest.version) <= 0)) continue;
    newer = true;
    if (!Array.isArray(value.assets)) continue;
    const name = `ClipSync-${version}-${suffix}`;
    const downloadUrl = `${DOWNLOAD_ROOT}${tag}/${name}`;
    const asset = value.assets.find((asset: Record<string, unknown>) => asset && asset.name === name && asset.state === 'uploaded' && asset.browser_download_url === downloadUrl && Number.isSafeInteger(asset.size) && Number(asset.size) > 1_000_000 && Number(asset.size) <= 500_000_000);
    if (asset) latest = { version, preview: value.prerelease, bytes: asset.size, downloadUrl };
  }
  if (newer && !latest) throw new Error('새 버전의 이 PC용 설치 파일을 준비 중입니다. 잠시 후 다시 확인해 주세요.');
  return latest;
}

export class UpdateChecker {
  private value: UpdateState;
  private pending?: Promise<UpdateState>;
  private lastCheck = -Infinity;
  private abort?: AbortController;
  constructor(private readonly options: {
    version: string; platform: string; arch: string;
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    changed: (state: UpdateState) => void;
    now?: () => number;
  }) {
    compareVersions(options.version, options.version);
    this.value = { status: installerSuffix(options.platform, options.arch) ? 'idle' : 'unsupported', currentVersion: options.version };
  }
  state(): UpdateState { return structuredClone(this.value); }
  private publish(value: UpdateState) { this.value = value; this.options.changed(this.state()); return this.state(); }
  check(): Promise<UpdateState> {
    if (this.pending) return this.pending;
    const now = (this.options.now ?? Date.now)();
    if (this.value.status === 'unsupported' || now - this.lastCheck < COOLDOWN_MS) return Promise.resolve(this.state());
    this.publish({ status: 'checking', currentVersion: this.options.version });
    this.pending = this.request().finally(() => { this.lastCheck = (this.options.now ?? Date.now)(); this.pending = undefined; });
    return this.pending;
  }
  dispose() { this.abort?.abort(); }
  private async request(): Promise<UpdateState> {
    const abort = this.abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await this.options.fetch(RELEASES_API, { signal: abort.signal, redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ClipSync-update-check', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 요청 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.' : 'GitHub에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.');
      }
      if (!response.body) throw new Error('GitHub의 응답을 읽을 수 없습니다.');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error('GitHub의 버전 정보가 너무 큽니다.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const release = selectRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), this.options.version, this.options.platform, this.options.arch);
      return this.publish({ status: release ? 'available' : 'current', currentVersion: this.options.version, checkedAt: new Date((this.options.now ?? Date.now)()).toISOString(), ...(release ? { release } : {}) });
    } catch (error) {
      return this.publish({ status: 'error', currentVersion: this.options.version, error: error instanceof Error && !abort.signal.aborted && !(error instanceof SyntaxError) ? error.message : '업데이트를 확인하지 못했습니다. 네트워크를 확인하고 잠시 후 다시 시도해 주세요.' });
    } finally { clearTimeout(timeout); if (this.abort === abort) this.abort = undefined; }
  }
}
