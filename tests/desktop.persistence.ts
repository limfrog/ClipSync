import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { deriveGroup } from '../src/main/group-credentials';
import { groupSession, type P2PSession } from '../src/main/group-session';
import { until } from './helpers';
import { localDHT } from './p2p-helpers';

test('native dragging, secure connection restore, hide keeps syncing, quit exits and disconnect stays forgotten', { timeout: 60000 }, async t => {
  const network = await localDHT();
  const profile = await mkdtemp(path.join(tmpdir(), 'clipsync-remember-'));
  const apps: { app: ElectronApplication; closed: boolean }[] = [];
  let wm: ChildProcess | undefined;
  let peer: P2PSession | undefined;
  t.after(async () => {
    for (const entry of apps) if (!entry.closed) await entry.app.close();
    await peer?.close(); wm?.kill(); await network.close(); await rm(profile, { recursive: true, force: true });
  });
  if (process.platform === 'linux') {
    wm = spawn(process.env.CLIPSYNC_OPENBOX ?? 'openbox', ['--sm-disable'], { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { wm!.once('spawn', resolve); wm!.once('error', reject); });
    await delay(400);
    assert.equal(wm.exitCode, null, 'Window manager could not start');
  }
  async function launch() {
    const app = await electron.launch({ executablePath: process.env.CLIPSYNC_EXECUTABLE,
      args: [...(process.env.CLIPSYNC_EXECUTABLE ? [] : [process.platform === 'linux' ? 'tests/fixtures/secure-entry.cjs' : '.']), ...(process.env.CLIPSYNC_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
      env: { ...process.env, CLIPSYNC_DATA_DIR: profile, CLIPSYNC_DHT_BOOTSTRAP: network.bootstrap.join(',') },
    });
    const entry = { app, closed: false }; apps.push(entry); app.on('close', () => { entry.closed = true; });
    const page = await app.firstWindow(); await page.getByRole('heading', { name: 'ClipSync', exact: true }).waitFor();
    const storage = await app.evaluate(({ safeStorage, app }) => ({ available: safeStorage.isEncryptionAvailable(), backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'native', requested: app.commandLine.getSwitchValue('password-store') }));
    assert.equal(storage.available, true, `Native secret store: ${JSON.stringify(storage)}`); assert.notEqual(storage.backend, 'basic_text');
    await page.evaluate(async () => { const p = await window.clipSync.preferences(); await window.clipSync.configure({ ...p, alwaysOnTop: true }); });
    // Window-manager/keyring startup can blur and hide the tray window before the first click.
    await app.evaluate(({ app }) => app.emit('activate'));
    return { app, page };
  }
  const first = await launch();
  await first.page.getByRole('button', { name: '기기 연결', exact: true }).click();
  await first.page.getByRole('button', { name: '새 키 만들기' }).click();
  const groupKey = await first.page.getByLabel('연결 키 · 영문·숫자 20자리').inputValue();
  const password = 'remember-test-password-123';
  await first.page.getByLabel('연결 비밀번호 · 8자 이상').fill(password);
  await first.page.getByRole('button', { name: '연결 저장', exact: true }).click();
  await until(async () => (await first.page.evaluate(() => window.clipSync.connection())).remembered);
  peer = groupSession(await deriveGroup({ groupKey, password }), { onText: () => {}, onPeers: () => {}, onDevices: () => {}, onTransfer: () => {}, onStatus: () => {} }, { bootstrap: network.bootstrap });
  await until(async () => (await first.page.evaluate(() => window.clipSync.state())).peers === 1, 'Initial P2P connection failed', 15000);
  await until(async () => {
    const bytes = await readFile(path.join(profile, 'connection.enc'));
    const count = await first.app.evaluate(({ safeStorage }, encoded) => {
      return JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))).peers?.length ?? 0;
    }, bytes.toString('base64'));
    return count === 1;
  }, 'Authenticated peer hints were not persisted with native encryption');
  const stored = await readFile(path.join(profile, 'connection.enc'));
  assert.equal(stored.includes(password), false); assert.equal(stored.includes(groupKey), false);
  await first.page.getByRole('button', { name: '기기 연결 닫기', exact: true }).click();
  if (process.platform === 'linux') {
    const [x, y] = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
    await promisify(execFile)(process.env.CLIPSYNC_XDOTOOL ?? 'xdotool', ['mousemove', '--sync', String(x + 130), String(y + 22), 'sleep', '0.2', 'mousedown', '1', 'sleep', '0.2', 'mousemove', '--sync', String(x + 170), String(y + 42), 'sleep', '0.2', 'mousemove', '--sync', String(x + 210), String(y + 62), 'sleep', '0.2', 'mouseup', '1']);
    await until(async () => {
      const moved = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
      return moved[0] !== x || moved[1] !== y;
    }, 'Dragging the native title area did not move the window');
  }
  await delay(300);
  const position = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
  await first.page.getByRole('button', { name: '창 숨기기', exact: true }).click();
  assert.equal(await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  peer.publish('창을 숨겨도 P2P 동기화 유지');
  await until(async () => await first.app.evaluate(({ clipboard }) => clipboard.readText()) === '창을 숨겨도 P2P 동기화 유지');
  await first.app.evaluate(({ app }) => app.emit('activate'));
  const exited = new Promise(resolve => first.app.process().once('exit', resolve));
  await first.page.getByRole('button', { name: '종료', exact: true }).click(); await exited;
  const restored = await launch();
  await until(async () => (await restored.page.evaluate(() => window.clipSync.state())).peers === 1, 'Restart did not automatically restore P2P connection', 15000);
  assert.deepEqual(await restored.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition()), position);
  peer.publish('앱 재실행 후 비밀번호 재입력 없이 동기화');
  await until(async () => await restored.app.evaluate(({ clipboard }) => clipboard.readText()) === '앱 재실행 후 비밀번호 재입력 없이 동기화');
  assert.equal((await restored.page.evaluate(() => window.clipSync.disconnect())).ok, true);
  await assert.rejects(readFile(path.join(profile, 'connection.enc')), { code: 'ENOENT' });
  await restored.app.close();
  const forgotten = await launch(); await delay(500);
  assert.equal((await forgotten.page.evaluate(() => window.clipSync.state())).mode, 'idle');
  assert.equal((await forgotten.page.evaluate(() => window.clipSync.connection())).groupKey, '');
});
