import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { until } from './helpers';

test('packaged app registers native login startup, restores it, starts hidden and unregisters', { timeout: 90000 }, async t => {
  assert.ok(process.env.CI || process.env.CLIPSYNC_TEST_NATIVE_STARTUP === '1', 'Native startup checks require an isolated CI runner or explicit opt-in');
  assert.ok(process.env.CLIPSYNC_EXECUTABLE);
  assert.ok(['win32', 'darwin'].includes(process.platform));
  const profile = await mkdtemp(path.join(tmpdir(), 'clipsync-startup-'));
  // Existing users keep their theme, shortcut and toolbar pin after migration.
  await writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', alwaysOnTop: true, shortcut: 'CommandOrControl+Shift+V' }));
  let app: ElectronApplication | undefined;
  async function launch(hidden = false) {
    app = await electron.launch({ executablePath: process.env.CLIPSYNC_EXECUTABLE, args: hidden ? ['--startup'] : [], env: { ...process.env, CLIPSYNC_DATA_DIR: profile } });
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.clipSync));
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    return page;
  }
  t.after(async () => {
    // Always remove this app's native registration, including after assertion failure.
    if (!app || app.process().exitCode !== null) await launch();
    await app!.evaluate(({ app }) => app.setLoginItemSettings({ openAtLogin: false, ...(process.platform === 'win32' ? { path: process.execPath, args: ['--startup'], name: 'ClipSync' } : {}) })).catch(() => {});
    await app!.close(); await rm(profile, { recursive: true, force: true });
  });
  let page = await launch();
  assert.equal((await page.evaluate(() => window.clipSync.preferences())).theme, 'light');
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: '부팅 시 시작', exact: true });
  assert.equal(await checkbox.isEnabled(), true);
  await checkbox.check(); await page.getByRole('button', { name: '설정 저장' }).click();
  await until(async () => !await page.locator('#settings-dialog').isVisible() || Boolean(await page.locator('#settings-error').textContent()));
  assert.equal(await page.locator('#settings-dialog').isVisible(), false, await page.locator('#settings-error').textContent() ?? 'Startup settings were not saved');
  await until(async () => (await page.evaluate(() => window.clipSync.preferences())).startOnLogin);
  const settings = await app!.evaluate(({ app }) => app.getLoginItemSettings(process.platform === 'win32' ? { path: process.execPath, args: ['--startup'] } : {}));
  if (process.platform === 'win32') {
    assert.equal(settings.openAtLogin, true); assert.equal(settings.executableWillLaunchAtLogin, true);
    const registry = await promisify(execFile)('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'ClipSync']);
    assert.ok(registry.stdout.includes('--startup')); assert.ok(registry.stdout.includes('ClipSync.exe'));
  } else {
    assert.ok(['enabled', 'requires-approval'].includes(settings.status), JSON.stringify(settings));
  }
  const saved = JSON.parse(await readFile(path.join(profile, 'preferences.json'), 'utf8'));
  assert.equal(saved.startOnLogin, true); assert.equal(saved.alwaysOnTop, true);
  console.log(`Native ${process.platform} login item: ${settings.status ?? settings.openAtLogin}`);
  await app!.close();
  page = await launch(true);
  assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false, 'Login startup must stay in the tray/menu bar');
  if (process.platform === 'darwin') assert.equal(await app!.evaluate(({ app }) => app.dock?.isVisible()), false);
  assert.equal((await page.evaluate(() => window.clipSync.preferences())).startOnLogin, true);
  // A manual second launch must focus this instance rather than create a second process.
  await promisify(execFile)(process.env.CLIPSYNC_EXECUTABLE!, [], { env: { ...process.env, CLIPSYNC_DATA_DIR: profile }, timeout: 15000 });
  await until(async () => await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await page.getByRole('checkbox', { name: '부팅 시 시작', exact: true }).uncheck();
  await page.getByRole('button', { name: '설정 저장' }).click();
  await until(async () => !(await page.evaluate(() => window.clipSync.preferences())).startOnLogin);
  const disabled = await app!.evaluate(({ app }) => app.getLoginItemSettings(process.platform === 'win32' ? { path: process.execPath, args: ['--startup'] } : {}));
  assert.equal(disabled.openAtLogin, false);
});
