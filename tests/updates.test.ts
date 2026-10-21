import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, RELEASES_API, selectRelease, UpdateChecker } from '../src/main/updates';

function release(version: string, preview = false) {
  return { tag_name: `v${version}`, draft: false, prerelease: preview, assets: ['Windows-x64-Setup.exe', 'macOS-arm64.pkg', 'macOS-x64.pkg'].map(suffix => ({
    name: `ClipSync-${version}-${suffix}`, state: 'uploaded', size: 123_456_789,
    browser_download_url: `https://github.com/limfrog/ClipSync/releases/download/v${version}/ClipSync-${version}-${suffix}`,
  })) };
}

test('updates compare numeric versions and choose a published installer matching this OS and CPU', () => {
  assert.ok(compareVersions('0.4.10', '0.4.9') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('0.4.9', '0.4.9'), 0);
  assert.throws(() => compareVersions('0.4.9/../evil', '0.4.9'));
  const releases = [release('0.4.8'), release('0.4.10', true), release('0.4.9')];
  for (const [platform, arch, suffix] of [['win32', 'x64', 'Windows-x64-Setup.exe'], ['darwin', 'arm64', 'macOS-arm64.pkg'], ['darwin', 'x64', 'macOS-x64.pkg']]) {
    const result = selectRelease(releases, '0.4.9', platform, arch)!;
    assert.equal(result.version, '0.4.10'); assert.equal(result.preview, true);
    assert.ok(result.downloadUrl.endsWith(`ClipSync-0.4.10-${suffix}`));
  }
  assert.equal(selectRelease([release('0.4.9'), release('0.4.8')], '0.4.9', 'win32', 'x64'), undefined);
});

test('updates reject drafts, foreign URLs, unfinished installers, malformed responses and unsupported targets', () => {
  assert.equal(selectRelease([{ ...release('0.4.10'), draft: true }], '0.4.9', 'win32', 'x64'), undefined);
  for (const url of ['file:///tmp/program.exe', 'https://example.com/program.exe', 'https://github.com/attacker/ClipSync/releases/download/v0.4.10/ClipSync-0.4.10-Windows-x64-Setup.exe']) {
    const data = release('0.4.10'); data.assets[0].browser_download_url = url;
    assert.throws(() => selectRelease([data], '0.4.9', 'win32', 'x64'), /설치 파일/);
  }
  for (const modification of [{ size: 500_000_001 }, { state: 'new' }, { name: '../ClipSync.exe' }]) {
    const data = release('0.4.10'); Object.assign(data.assets[0], modification);
    assert.throws(() => selectRelease([data], '0.4.9', 'win32', 'x64'), /설치 파일/);
  }
  assert.throws(() => selectRelease({}, '0.4.9', 'win32', 'x64'));
  assert.equal(selectRelease([release('0.4.10')], '0.4.9', 'win32', 'arm64'), undefined);
});

test('checks share one request, limit repeated checks, publish results and send no clipboard or identity data', async () => {
  let clock = 100_000; let calls = 0; let resolve!: (response: Response) => void;
  const statuses: string[] = [];
  const checker = new UpdateChecker({ version: '0.4.9', platform: 'win32', arch: 'x64', now: () => clock,
    changed: state => statuses.push(state.status), fetch: async (url, init) => {
      calls++; assert.equal(url, RELEASES_API); assert.equal(init.redirect, 'error');
      assert.equal(init.body, undefined); assert.deepEqual(Object.keys(init).sort(), ['headers', 'redirect', 'signal']);
      assert.deepEqual(init.headers, { Accept: 'application/vnd.github+json', 'User-Agent': 'ClipSync-update-check', 'X-GitHub-Api-Version': '2022-11-28' });
      return await new Promise<Response>(done => { resolve = done; });
    } });
  const a = checker.check(); const b = checker.check(); assert.equal(a, b); assert.equal(calls, 1);
  resolve(Response.json([release('0.4.10')]));
  const result = await a; assert.equal(result.status, 'available');
  result.release!.downloadUrl = 'https://attacker.invalid/';
  assert.ok(checker.state().release!.downloadUrl.startsWith('https://github.com/limfrog/ClipSync/'));
  await checker.check(); assert.equal(calls, 1);
  assert.deepEqual(statuses, ['checking', 'available']);
  clock += 60_000; const next = checker.check(); resolve(Response.json([release('0.4.9')]));
  assert.equal((await next).status, 'current'); assert.equal(calls, 2);
});

test('network/rate-limit/invalid/oversized responses remain errors instead of claiming current version is latest', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('', { status: 403 }), async () => new Response('invalid json'), async () => new Response('x'.repeat(1024 * 1024 + 1)), async () => Response.json([release('0.4.10')].map(value => ({ ...value, assets: [] })))]) {
    const checker = new UpdateChecker({ version: '0.4.9', platform: 'darwin', arch: 'arm64', fetch: fetcher, changed: () => {} });
    assert.equal((await checker.check()).status, 'error'); assert.equal(checker.state().release, undefined);
  }
  let calls = 0;
  const unsupported = new UpdateChecker({ version: '0.4.9', platform: 'linux', arch: 'x64', fetch: async () => { calls++; return Response.json([]); }, changed: () => {} });
  assert.equal((await unsupported.check()).status, 'unsupported'); assert.equal(calls, 0);
});

test('disposing an in-flight check aborts its network request', async () => {
  let aborted = false;
  const checker = new UpdateChecker({ version: '0.4.9', platform: 'win32', arch: 'x64', changed: () => {}, fetch: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
  }) });
  const pending = checker.check(); checker.dispose(); assert.equal((await pending).status, 'error'); assert.equal(aborted, true);
});
