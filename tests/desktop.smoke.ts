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

test('clipboard manager searches, pins, recopies, saves preferences, hides and syncs its real OS clipboard', { timeout: 30000 }, async t => {
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
  await page.getByRole('heading', { name: 'ClipSync', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  assert.equal(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process), 'undefined');

  // Capture the initial screen without real clipboard content or session keys.
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop.png' });
  const dimensions = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
  assert.equal(dimensions.width, 400);
  assert.equal(dimensions.overflow, false);
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await page.getByLabel('화면 테마').selectOption('dark');
  await page.getByRole('checkbox', { name: '창 항상 위에 고정', exact: true }).check();
  await page.getByRole('button', { name: '설정 저장' }).click();
  await until(async () => (await page.evaluate(() => window.clipSync.preferences())).alwaysOnTop);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
  await desktop.evaluate(({ clipboard }) => clipboard.writeText('회의 메모 · 다음 릴리스 준비\n자료를 정리하고 오늘의 작업을 마무리하세요.'));
  await until(async () => (await page.evaluate(() => window.clipSync.state())).history.some(item => item.preview.includes('회의 메모')));
  const record = page.locator('[data-history-id]').filter({ hasText: '회의 메모' });
  await record.getByRole('button', { name: '고정', exact: true }).click();
  await page.getByRole('tab', { name: '고정됨', exact: true }).click();
  assert.equal(await page.locator('[data-history-id]').count(), 1);
  await page.getByRole('searchbox', { name: '클립보드 히스토리 검색' }).fill('없는 기록');
  await page.getByRole('heading', { name: '일치하는 기록이 없어요' }).waitFor();
  await page.getByRole('searchbox', { name: '클립보드 히스토리 검색' }).fill('');
  await desktop.evaluate(({ clipboard }) => clipboard.writeText('다른 복사 내용'));
  await until(async () => (await page.evaluate(() => window.clipSync.state())).history.length === 2);
  await record.getByRole('button', { name: '복사', exact: true }).click();
  assert.equal(await desktop.evaluate(({ clipboard }) => clipboard.readText()), '회의 메모 · 다음 릴리스 준비\n자료를 정리하고 오늘의 작업을 마무리하세요.');
  await page.getByRole('button', { name: '비우기', exact: true }).click();
  await until(async () => (await page.evaluate(() => window.clipSync.state())).history.length === 1);
  await page.getByRole('tab', { name: '전체', exact: true }).click();
  await page.screenshot({ path: 'test-results/original-ui-dark.png' });
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await page.getByLabel('화면 테마').selectOption('light');
  await page.getByRole('button', { name: '설정 저장' }).click();
  await until(async () => await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  await page.screenshot({ path: 'test-results/original-ui-light.png' });
  await page.getByRole('button', { name: '창 숨기기', exact: true }).click();
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await desktop.evaluate(({ app }) => app.emit('activate'));
  await page.getByRole('button', { name: '기기 연결', exact: true }).click();
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
