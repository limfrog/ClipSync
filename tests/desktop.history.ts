import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { until } from './helpers';
import { assertReadable } from './contrast';

test('resizable manager retains encrypted text, images, file references and pins without hiding on focus changes', { timeout: 90000 }, async t => {
  const profile = await mkdtemp(path.join(tmpdir(), 'clipsync-history-desktop-'));
  let app: ElectronApplication | undefined; let page: Page;
  t.after(async () => { if (app && app.process().exitCode === null) await app.close(); await rm(profile, { recursive: true, force: true }); });
  async function launch() {
    app = await electron.launch({ executablePath: process.env.CLIPSYNC_EXECUTABLE,
      args: [...(process.env.CLIPSYNC_EXECUTABLE ? [] : [process.platform === 'linux' ? 'tests/fixtures/secure-entry.cjs' : '.']), ...(process.env.CLIPSYNC_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
      env: { ...process.env, CLIPSYNC_DATA_DIR: profile },
    });
    page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.clipSync));
    const storage = await app.evaluate(({ safeStorage }) => ({ available: safeStorage.isEncryptionAvailable(), backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'native' }));
    assert.ok(storage.available && storage.backend !== 'basic_text', JSON.stringify(storage));
    return app;
  }
  async function quit() {
    const exit = new Promise(resolve => app!.process().once('exit', resolve));
    await page.getByRole('button', { name: '종료', exact: true }).click(); await exit;
  }
  await launch();
  const iconCoverage = await app!.evaluate(({ nativeImage }) => {
    return ['icon.png', 'icon-windows.png'].map(name => {
      const bytes = nativeImage.createFromPath(`${process.cwd()}/dist/assets/${name}`).resize({ width: 16, height: 16 }).toBitmap();
      let visible = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i] >= 128) visible++;
      return visible;
    });
  });
  assert.ok(iconCoverage[1] > iconCoverage[0] * 1.3, `Windows small icon coverage: ${iconCoverage}`);
  assert.equal((await page!.evaluate(() => window.clipSync.preferences())).retainHistory, false);
  assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isResizable()), true);
  assert.deepEqual(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize()), [360, 480]);
  const ratios: number[] = [];
  for (const [width, height] of [[360, 480], [720, 820]]) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await page!.waitForFunction(expected => innerWidth === expected, width);
    const geometry = await page!.evaluate(() => {
      const tabs = [...document.querySelectorAll<HTMLElement>('.seg-tab')];
      return { overflow: document.documentElement.scrollWidth > innerWidth, widths: tabs.map(tab => tab.getBoundingClientRect().width), clipped: tabs.some(tab => tab.scrollWidth > tab.clientWidth) };
    });
    assert.equal(geometry.overflow, false); assert.equal(geometry.clipped, false);
    ratios.push(geometry.widths[1] / geometry.widths[0]);
  }
  assert.ok(ratios.every(value => value > 1.5 && value < 1.7), JSON.stringify(ratios));
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  const info = await page!.evaluate(() => window.clipSync.appInfo());
  assert.deepEqual(info, { developer: 'Horizon Entertainment', email: 'apps@horizonent.co.kr', version: metadata.version, buildNumber: String(metadata.buildNumber) });
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(360, 480));
  await page!.getByRole('button', { name: '환경설정', exact: true }).click();
  await page!.getByText('Horizon Entertainment', { exact: true }).waitFor();
  assert.equal(await page!.getByRole('button', { name: 'apps@horizonent.co.kr', exact: true }).count(), 1);
  assert.equal(await page!.locator('#app-version').textContent(), `버전 ${metadata.version} · 빌드 ${metadata.buildNumber}`);
  for (const scroll of [0, 99999]) {
    await page!.locator('.settings-content').evaluate((element, top) => { element.scrollTop = top; }, scroll);
    const visibleFooter = await page!.locator('.settings-build-bar').evaluate(element => {
      const r = element.getBoundingClientRect(); const dialog = element.closest('dialog')!.getBoundingClientRect();
      return r.top >= dialog.top && r.bottom <= dialog.bottom && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    });
    assert.equal(visibleFooter, true, 'Version and build must stay visible while settings scroll at minimum size');
  }
  const requests: string[] = [];
  page!.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  for (const [label, filename] of [['개인정보처리방침', 'PRIVACY-POLICY.ko.txt'], ['이용약관', 'TERMS-OF-USE.ko.txt']]) {
    await page!.getByRole('button', { name: label, exact: true }).click();
    const document = page!.getByRole('dialog', { name: label, exact: true });
    await document.waitFor();
    assert.equal(await page!.locator('#legal-body').textContent(), await readFile(path.join('legal', filename), 'utf8'));
    assert.equal(await page!.locator('#legal-date').textContent(), '시행일 2026-10-21 · 문서 1.0');
    await page!.locator('#legal-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page!.keyboard.press('Escape');
    await until(async () => !await document.isVisible());
    assert.equal(await page!.locator('#settings-dialog').isVisible(), true, 'Closing a document must return to settings');
    assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  }
  assert.deepEqual(requests, [], 'Reading bundled legal documents must not request an external website');
  await page!.screenshot({ path: 'test-results/settings-developer-build.png' });
  await page!.getByRole('button', { name: '환경설정 닫기', exact: true }).click();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(720, 820));
  await app!.evaluate(({ clipboard }) => clipboard.writeText('먼저 복사하고 고정한 항목'));
  await until(async () => (await page!.evaluate(() => window.clipSync.state())).history.length === 1);
  await page!.locator('[data-history-id]').getByRole('button', { name: '고정', exact: true }).click();
  const text = '재실행 후에도 원문 전체를 복사합니다 👋\n'.repeat(80);
  await app!.evaluate(({ clipboard }, text) => clipboard.writeText(text), text);
  await until(async () => (await page!.evaluate(() => window.clipSync.state())).history.length === 2);
  const first = page!.locator('[data-history-id]').first();
  const newest = page!.locator('[data-history-id]').filter({ hasText: '재실행 후에도' });
  assert.equal(await first.getAttribute('aria-current'), null, 'A pinned record must not steal the current selection');
  assert.equal(await newest.getAttribute('aria-current'), 'true');
  await first.locator('.clip-top').click(); assert.equal(await first.getAttribute('aria-current'), 'true');
  await newest.getByRole('button', { name: '복사', exact: true }).click();
  await newest.getByText('✓ 선택됨', { exact: true }).waitFor();
  for (const theme of ['dark', 'light'] as const) {
    await page!.evaluate(async theme => { const p = await window.clipSync.preferences(); await window.clipSync.configure({ ...p, theme }); }, theme);
    await until(async () => await page!.evaluate(() => document.documentElement.dataset.theme) === theme);
    await assertReadable(page!);
    await page!.screenshot({ path: `test-results/resizable-selection-${theme}.png` });
  }
  await page!.getByRole('button', { name: '환경설정', exact: true }).click();
  await page!.getByRole('checkbox', { name: '종료 후에도 클립보드 기록 유지', exact: true }).check();
  await page!.getByRole('button', { name: '설정 저장' }).click();
  await until(async () => (await page!.evaluate(() => window.clipSync.preferences())).retainHistory);
  const program = path.join(profile, '한글 프로그램.exe'.normalize('NFD'));
  await writeFile(program, Buffer.from('MZ\0파일 바이트 👋'));
  await app!.evaluate(async ({ clipboard, ClipboardItem }, uri) => { await clipboard.write([new ClipboardItem({ 'text/uri-list': uri })]); }, pathToFileURL(program).href);
  await until(async () => (await page!.evaluate(() => window.clipSync.state())).history.some(item => item.type === 'file'));
  await app!.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const png = nativeImage.createFromBitmap(Buffer.from([12, 100, 240, 255]), { width: 1, height: 1 }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
  });
  await until(async () => (await page!.evaluate(() => window.clipSync.state())).history.some(item => item.type === 'image' && item.thumbnail));
  const before = (await page!.evaluate(() => window.clipSync.state())).history;
  // Real native focus switches plus the transient blur that used to hide the manager.
  for (let i = 0; i < 3; i++) {
    await app!.evaluate(({ app, BrowserWindow }) => {
      app.emit('activate');
      const main = BrowserWindow.getAllWindows()[0]; main.emit('blur');
      const other = new BrowserWindow({ width: 200, height: 100, show: true }); other.focus();
      setTimeout(() => { other.destroy(); app.emit('activate'); }, 70);
    });
    await delay(250);
    assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  }
  await app!.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    BrowserWindow.getAllWindows()[0].setBounds({ x: area.x + 40, y: area.y + 35, width: 640, height: 600 });
  });
  await delay(250);
  const bounds = await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
  await quit();
  const encrypted = await readFile(path.join(profile, 'history.enc'));
  assert.equal(encrypted.includes('재실행'), false); assert.equal(encrypted.includes('한글 프로그램'), false);
  assert.equal((await readdir(path.join(profile, 'history-images'))).length, 1);
  await launch();
  assert.deepEqual(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds()), bounds);
  const restored = (await page!.evaluate(() => window.clipSync.state())).history;
  assert.deepEqual(restored.map(item => [item.id, item.pinned, item.copiedAt]), before.map(item => [item.id, item.pinned, item.copiedAt]));
  assert.equal((await page!.evaluate(() => window.clipSync.state())).sent, 0);
  const textId = restored.find(item => item.preview.includes('재실행 후에도'))!.id;
  assert.equal((await page!.evaluate(id => window.clipSync.history('copy', id), textId)).ok, true);
  assert.equal(await app!.evaluate(({ clipboard }) => clipboard.readText()), text);
  const fileId = restored.find(item => item.type === 'file')!.id;
  assert.equal((await page!.evaluate(id => window.clipSync.history('copy', id), fileId)).ok, true);
  assert.equal(await app!.evaluate(({ clipboard }) => clipboard.has('text/uri-list')), true);
  const imageId = restored.find(item => item.type === 'image')!.id;
  assert.equal((await page!.evaluate(id => window.clipSync.history('copy', id), imageId)).ok, true);
  assert.equal(await app!.evaluate(({ clipboard }) => clipboard.has('image/png')), true);
  await rm(program);
  assert.equal((await page!.evaluate(id => window.clipSync.history('copy', id), fileId)).ok, false);
  // Disabling persistence deletes saved history but preserves this run's image references.
  await page!.getByRole('button', { name: '환경설정', exact: true }).click();
  await page!.getByRole('checkbox', { name: '종료 후에도 클립보드 기록 유지', exact: true }).uncheck();
  await page!.getByRole('button', { name: '설정 저장' }).click();
  await until(async () => !(await page!.evaluate(() => window.clipSync.preferences())).retainHistory);
  await assert.rejects(readFile(path.join(profile, 'history.enc')), { code: 'ENOENT' });
  assert.equal((await page!.evaluate(id => window.clipSync.history('copy', id), imageId)).ok, true);
  await quit(); await launch();
  assert.deepEqual((await page!.evaluate(() => window.clipSync.state())).history, []);
  await assert.rejects(readdir(path.join(profile, 'history-images')), { code: 'ENOENT' });
  await page!.getByRole('button', { name: '창 숨기기', exact: true }).click();
  assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await app!.evaluate(({ app }) => app.emit('activate'));
  assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  if (process.platform === 'darwin') assert.equal(await app!.evaluate(({ app }) => app.dock?.isVisible()), true);
});
