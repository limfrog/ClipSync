import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoginStartup } from '../src/main/login-startup';

function native(packaged = true) {
  let state = { openAtLogin: false, wasOpenedAtLogin: false, executableWillLaunchAtLogin: false, status: 'not-registered', launchItems: [] as { name: string; scope: string; args: string[]; enabled: boolean }[] };
  const calls: Record<string, unknown>[] = [];
  const app = {
    isPackaged: packaged,
    getLoginItemSettings: (options: unknown) => { calls.push({ get: options }); return state; },
    setLoginItemSettings: (options: { openAtLogin: boolean; enabled?: boolean }) => {
      calls.push({ set: options });
      state = { ...state, openAtLogin: options.openAtLogin, executableWillLaunchAtLogin: options.openAtLogin && options.enabled === true, status: options.openAtLogin ? 'enabled' : 'not-registered', launchItems: options.openAtLogin ? [{ name: 'ClipSync', scope: 'user', args: ['--startup'], enabled: options.enabled === true }] : [] };
    },
  } as unknown as ConstructorParameters<typeof LoginStartup>[0];
  return { app, calls, setState: (patch: Partial<typeof state>) => { state = { ...state, ...patch }; } };
}

test('Windows registers the installed executable and hidden-start argument, then unregisters it', () => {
  const n = native(); const path = 'C:\\Users\\한글 이름\\Programs\\ClipSync\\ClipSync.exe';
  const startup = new LoginStartup(n.app, 'win32', path);
  startup.set(true); assert.equal(startup.info().startOnLogin, true);
  n.setState({ openAtLogin: false }); // Electron only queries its default AppUserModelID here.
  assert.equal(startup.info().startOnLogin, true, 'The custom Run entry remains enabled');
  assert.ok(n.calls.some(call => JSON.stringify(call.set) === JSON.stringify({ path: `"${path}"`, args: ['--startup'], openAtLogin: true, name: 'ClipSync', enabled: true })));
  startup.set(false); assert.equal(startup.info().startOnLogin, false);
});

test('Windows respects an externally disabled startup item until the user explicitly enables it', () => {
  const n = native(); n.setState({ openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [{ name: 'ClipSync', scope: 'user', args: ['--startup'], enabled: false }] });
  const startup = new LoginStartup(n.app, 'win32');
  assert.deepEqual(startup.info(), { startOnLogin: false, startupStatus: 'blocked' });
  startup.set(true); assert.equal(startup.info().startupStatus, 'enabled');
});

test('Mac reports pending system approval and allows removing the requested login item', () => {
  const n = native(); n.setState({ status: 'requires-approval' });
  const startup = new LoginStartup(n.app, 'darwin');
  assert.deepEqual(startup.info(), { startOnLogin: true, startupStatus: 'requires-approval' });
  startup.set(false); assert.deepEqual(startup.info(), { startOnLogin: false, startupStatus: 'disabled' });
});

test('development builds and unsupported systems never register Electron as a login item', () => {
  for (const [n, platform] of [[native(false), 'win32'], [native(), 'linux']] as const) {
    const startup = new LoginStartup(n.app, platform);
    assert.equal(startup.info().startupStatus, 'unsupported');
    assert.equal(startup.startedAtLogin(), false); startup.set(false);
    assert.throws(() => startup.set(true), /설치된 Windows/); assert.deepEqual(n.calls, []);
  }
});

test('a native settings query failure does not prevent the desktop from starting', () => {
  const n = native();
  n.app.getLoginItemSettings = () => { throw new Error('Native service unavailable'); };
  const startup = new LoginStartup(n.app, 'darwin');
  assert.deepEqual(startup.info(), { startOnLogin: false, startupStatus: 'unavailable' });
  assert.equal(startup.startedAtLogin(), false);
  assert.throws(() => startup.set(true), /자동 시작 설정을 확인/);
});
