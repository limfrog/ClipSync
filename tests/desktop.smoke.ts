import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { deriveGroup } from '../src/main/group-credentials';
import { groupSession } from '../src/main/group-session';
import { localDHT } from './p2p-helpers';
import { until } from './helpers';

test('clipboard manager searches, pins, recopies, saves preferences, hides and syncs its real OS clipboard', { timeout: 30000 }, async t => {
  const network = await localDHT();
  t.after(() => network.close());
  const profile = await mkdtemp(path.join(tmpdir(), 'clipsync-smoke-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const desktop = await electron.launch({
    executablePath: process.env.CLIPSYNC_EXECUTABLE,
    args: [...(process.env.CLIPSYNC_EXECUTABLE ? [] : ['.']), ...(process.env.CLIPSYNC_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
    env: { ...process.env, CLIPSYNC_DATA_DIR: profile, CLIPSYNC_DHT_BOOTSTRAP: network.bootstrap.join(',') },
  });
  t.after(() => desktop.close());
  const page = await desktop.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'ClipSync', exact: true }).waitFor();
  await page.evaluate(async () => { const p = await window.clipSync.preferences(); await window.clipSync.configure({ ...p, alwaysOnTop: true }); });
  await desktop.evaluate(({ app }) => app.emit('activate'));
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  assert.equal(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process), 'undefined');

  // Capture the initial screen without real clipboard content or session keys.
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop.png' });
  const dimensions = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
  assert.equal(dimensions.width, 400);
  assert.equal(dimensions.overflow, false);
  assert.equal(await page.locator('.header-top').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'drag');
  assert.equal(await page.locator('.toolbar').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'no-drag');
  const before = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
  await desktop.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; const [x,y] = win.getPosition(); win.setPosition(x + 25, y + 20); });
  const after = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
  assert.deepEqual(after, [before[0] + 25, before[1] + 20]);
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
  await page.getByRole('button', { name: '새 키 만들기' }).click();
  const groupKey = await page.getByLabel('연결 키 · 영문·숫자 20자리').inputValue();
  const password = 'desktop-test-password';
  await page.getByLabel('연결 비밀번호 · 8자 이상').fill(password);
  await page.getByRole('button', { name: '연결 저장', exact: true }).click();
  const received: string[] = [];
  const peer = groupSession(await deriveGroup({ groupKey, password }), { onText: text => { received.push(text); }, onPeers: () => {}, onDevices: () => {}, onTransfer: () => {}, onStatus: () => {} }, { bootstrap: network.bootstrap });
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
  await page.getByRole('button', { name: '연결 해제 및 저장 삭제' }).click();
  await until(async () => (await page.evaluate(() => window.clipSync.state())).mode === 'idle');
  assert.deepEqual(errors, []);
});
