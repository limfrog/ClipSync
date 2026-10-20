import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { parseInvitation } from '../src/main/protocol';
import { joinSession } from '../src/main/session';
import { until } from './helpers';

test('desktop UI authenticates a peer and syncs the real OS clipboard in both directions', { timeout: 30000 }, async t => {
  const profile = await mkdtemp(path.join(tmpdir(), 'clipsync-smoke-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const desktop = await electron.launch({
    executablePath: process.env.CLIPSYNC_EXECUTABLE,
    args: [...(process.env.CLIPSYNC_EXECUTABLE ? [] : ['.']), ...(process.env.CLIPSYNC_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
    env: { ...process.env, CLIPSYNC_DATA_DIR: profile },
  });
  t.after(() => desktop.close());
  const page = await desktop.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '클립보드를 하나로.' }).waitFor();
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  assert.equal(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process), 'undefined');

  // Capture the initial screen without real clipboard content or session keys.
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop.png' });
  await page.getByRole('button', { name: '연결 열기' }).click();
  await until(async () => (await page.evaluate(() => window.clipSync.state())).mode === 'hosting');
  await page.getByRole('button', { name: '초대 코드 복사' }).click();
  const invitation = parseInvitation(await desktop.evaluate(({ clipboard }) => clipboard.readText()));
  invitation.host = '127.0.0.1';
  const received: string[] = [];
  const peer = await joinSession(invitation, { onText: text => { received.push(text); }, onPeers: () => {}, onDisconnect: () => {} });
  t.after(() => peer.close());
  await until(async () => await page.locator('#peer-count').textContent() === '1');

  await desktop.evaluate(({ clipboard }) => clipboard.writeText('데스크톱에서 복사한 텍스트 👋'));
  await until(() => received.includes('데스크톱에서 복사한 텍스트 👋'));
  peer.publish('다른 PC에서 보낸 텍스트');
  await until(async () => await desktop.evaluate(({ clipboard }) => clipboard.readText()) === '다른 PC에서 보낸 텍스트');
  await until(async () => await page.locator('#received-count').textContent() === '1');

  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await until(async () => (await page.evaluate(() => window.clipSync.state())).paused);
  peer.publish('일시정지 중에는 적용하지 않기');
  await setTimeout(200);
  assert.equal(await desktop.evaluate(({ clipboard }) => clipboard.readText()), '다른 PC에서 보낸 텍스트');
  await page.getByRole('button', { name: '동기화 재개' }).click();
  await page.getByRole('button', { name: '연결 해제' }).click();
  await until(async () => (await page.evaluate(() => window.clipSync.state())).mode === 'idle');
  assert.deepEqual(errors, []);
});
