import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, shell, Tray } from 'electron';
import path from 'node:path';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SyncController } from './controller';
import type { Result } from '../shared/api';
import { MAX_FILE_BYTES } from '../shared/transfers';
import { DEFAULT_PREFERENCES, type Preferences } from '../shared/history';
import { NativeMediaClipboard } from './clipboard-media';
import { MediaSync } from './media-sync';
import { ConnectionStore } from './connection-store';
import { createGroupKey, deriveGroup } from './group-credentials';
import type { GroupCredentials, GroupInput } from '../shared/group';

let window: BrowserWindow | null = null;
let controller: SyncController;
let quitting = false;
let imageCache: string;
let tray: Tray | null = null;
let preferences = { ...DEFAULT_PREFERENCES };
let nativeDialogDepth = 0;
let media: MediaSync | undefined;
let lastHistorySent = -1;
let settingsQueue = Promise.resolve();
let connectionQueue = Promise.resolve();
let connectionStore: ConnectionStore;
let savedGroup: GroupCredentials | null = null;
let remembered = false;
let position: { x: number; y: number } | undefined;
let positionTimer: ReturnType<typeof setTimeout> | undefined;
const imageCachePath = async () => imageCache ??= await mkdtemp(path.join(app.getPath('temp'), 'clipsync-images-'));

function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('설정을 확인해 주세요.');
  const p = value as Preferences;
  if (!['system', 'dark', 'light'].includes(p.theme) || typeof p.alwaysOnTop !== 'boolean' ||
      typeof p.shortcut !== 'string' || p.shortcut.length > 80 || !/^(?=.*(?:Control|Ctrl|Command|Cmd|Alt|Option)).+\+[A-Z0-9]$/i.test(p.shortcut)) {
    throw new Error('테마와 단축키 설정을 확인해 주세요.');
  }
  return { theme: p.theme, alwaysOnTop: p.alwaysOnTop, shortcut: p.shortcut };
}

const preferencesPath = () => path.join(app.getPath('userData'), 'preferences.json');
const currentPreferences = () => ({ ...preferences, shortcutAvailable: globalShortcut.isRegistered(preferences.shortcut) });

function toggleWindow() {
  if (!window || window.isDestroyed()) createWindow();
  else if (window.isVisible() && window.isFocused()) hideWindow();
  else { window.show(); window.focus(); }
}

function hideWindow() {
  if (tray) window?.hide(); else window?.minimize();
}

function p2pOptions() {
  // Custom discovery nodes support private deployments and isolated integration tests.
  const identity = savedGroup?.deviceId;
  const bootstrap = process.env.CLIPSYNC_DHT_BOOTSTRAP?.split(',').map(value => value.trim()).filter(Boolean);
  return { ...(bootstrap?.length ? { bootstrap } : {}), onHints(hints: { peers: string[]; nodes: { host: string; port: number }[] }) {
    if (!identity || quitting) return;
    const work = connectionQueue.then(async () => {
      if (savedGroup?.deviceId !== identity || !remembered) return;
      const nodes = hints.nodes.length ? hints.nodes : savedGroup.nodes;
      if (JSON.stringify(savedGroup.peers) === JSON.stringify(hints.peers) && JSON.stringify(savedGroup.nodes) === JSON.stringify(nodes)) return;
      savedGroup = { ...savedGroup, peers: hints.peers, ...(nodes ? { nodes } : {}) };
      await connectionStore.save(savedGroup);
    });
    connectionQueue = work.catch(() => {});
  } };
}

function connectionInfo() { return { groupKey: savedGroup?.groupKey ?? '', remembered }; }

async function connectGroup(input: GroupInput) {
  if (controller.state().mode !== 'idle') throw new Error('기존 연결을 해제한 뒤 새 키를 설정해 주세요.');
  const credentials = await deriveGroup(input);
  remembered = await connectionStore.save(credentials);
  savedGroup = credentials;
  controller.protectText(input.password);
  await controller.connectGroup(credentials, p2pOptions());
  if (!remembered) controller.reportError('운영체제 보안 저장소를 사용할 수 없어 이번 실행에서만 연결합니다. 재실행 후에는 키와 비밀번호를 다시 입력해야 합니다.');
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  icon.setTemplateImage(process.platform === 'darwin');
  try {
    tray = new Tray(icon);
    tray.setToolTip('ClipSync · 클립보드와 파일 동기화');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'ClipSync 열기', click: () => { if (!window) createWindow(); window?.show(); window?.focus(); } },
      { type: 'separator' }, { label: '종료', click: () => app.quit() },
    ]));
    tray.on('click', toggleWindow);
  } catch (error) { console.warn('Tray unavailable:', error instanceof Error ? error.message : error); }
}

async function configure(value: unknown) {
  const next = validatePreferences(value);
  const newShortcut = next.shortcut !== preferences.shortcut || !globalShortcut.isRegistered(next.shortcut);
  if (newShortcut && !globalShortcut.register(next.shortcut, toggleWindow)) throw new Error('다른 앱이 사용 중인 단축키입니다. 다른 조합을 선택해 주세요.');
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(`${preferencesPath()}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${preferencesPath()}.tmp`, preferencesPath());
  } catch (error) { if (newShortcut) globalShortcut.unregister(next.shortcut); throw error; }
  if (next.shortcut !== preferences.shortcut) globalShortcut.unregister(preferences.shortcut);
  preferences = next;
  window?.setAlwaysOnTop(next.alwaysOnTop);
  window?.webContents.send('clipsync:preferences', currentPreferences());
}

async function nativeDialog<T>(action: () => Promise<T>) {
  nativeDialogDepth++;
  try { return await action(); } finally { nativeDialogDepth--; }
}

// Tests isolate app data; normal desktops use Electron's standard per-user path.
if (process.env.CLIPSYNC_DATA_DIR) app.setPath('userData', process.env.CLIPSYNC_DATA_DIR);

function createWindow() {
  lastHistorySent = -1;
  window = new BrowserWindow({
    width: 400, height: Math.min(760, screen.getPrimaryDisplay().workArea.height - 30),
    minWidth: 380, minHeight: 500, frame: false, movable: true, resizable: false, fullscreenable: false,
    ...(position ?? {}),
    alwaysOnTop: preferences.alwaysOnTop, skipTaskbar: Boolean(tray),
    title: 'ClipSync', backgroundColor: '#09090b', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  void window.loadFile(path.join(__dirname, 'renderer/index.html'));
  window.on('show', () => { if (process.platform === 'darwin') void app.dock?.show(); });
  window.on('hide', () => { if (process.platform === 'darwin' && tray && !quitting) app.dock?.hide(); });
  window.on('move', () => {
    if (!window) return;
    const [x, y] = window.getPosition(); position = { x, y };
    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
      void mkdir(app.getPath('userData'), { recursive: true }).then(() => writeFile(path.join(app.getPath('userData'), 'window-position.json'), JSON.stringify(position), { mode: 0o600 })).catch(() => {});
    }, 200);
  });
  window.on('close', event => { if (!quitting && tray) { event.preventDefault(); hideWindow(); } });
  window.on('blur', () => {
    if (tray && !preferences.alwaysOnTop && !nativeDialogDepth && !window?.webContents.isDevToolsOpened()) hideWindow();
  });
  window.on('closed', () => { window = null; });
}

void app.whenReady().then(async () => {
  try { preferences = validatePreferences(JSON.parse(await readFile(preferencesPath(), 'utf8'))); }
  catch { preferences = { ...DEFAULT_PREFERENCES }; }
  try {
    const value = JSON.parse(await readFile(path.join(app.getPath('userData'), 'window-position.json'), 'utf8'));
    if (Number.isInteger(value.x) && Number.isInteger(value.y) && screen.getAllDisplays().some(({ workArea: r }) => value.x >= r.x && value.x + 400 <= r.x + r.width && value.y >= r.y && value.y + 80 <= r.y + r.height)) position = { x: value.x, y: value.y };
  } catch { /* First launch or a disconnected display uses the default position. */ }
  connectionStore = new ConnectionStore(path.join(app.getPath('userData'), 'connection.enc'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: text => safeStorage.encryptString(text), decrypt: data => safeStorage.decryptString(data),
  });
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
  ]) : Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'windowMenu' }]));

  controller = new SyncController({
    readText: async () => await clipboard.has('text/uri-list') || await clipboard.has('image/png') ? null : await clipboard.has('text/plain') ? clipboard.readText() : null,
    writeText: text => clipboard.writeText(text),
  }, state => {
    if (window && !window.isDestroyed()) {
      // Media progress does not resend all image previews ten times per second.
      window.webContents.send('clipsync:state', { ...state, history: state.historyRevision === lastHistorySent ? undefined : state.history });
      lastHistorySent = state.historyRevision;
    }
    media?.observe(state);
  });
  media = new MediaSync(controller, new NativeMediaClipboard(imageCachePath), path.join(process.env.CLIPSYNC_DATA_DIR ?? app.getPath('downloads'), 'ClipSync'));
  ipcMain.handle('clipsync:get-state', () => controller.state());
  ipcMain.handle('clipsync:preferences', () => currentPreferences());
  const trusted = (event: Electron.IpcMainInvokeEvent) => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('clipsync:connection', event => { if (!trusted(event)) throw new Error('허용되지 않은 창입니다.'); return connectionInfo(); });
  ipcMain.handle('clipsync:create-group-key', event => { if (!trusted(event)) throw new Error('허용되지 않은 창입니다.'); return createGroupKey(); });
  const actions: Record<string, (...args: never[]) => unknown> = {
    configure: (value: unknown) => {
      const work = settingsQueue.then(() => configure(value));
      settingsQueue = work.catch(() => {});
      return work;
    },
    history: (action: string, id?: string) => action === 'copy' && controller.state().history.some(item => item.id === id && item.mediaId) ? media!.copy(id!) : controller.manageHistory(action, id),
    hide: hideWindow,
    quit: () => { setImmediate(() => app.quit()); },
    'open-downloads': async () => {
      const folder = path.join(process.env.CLIPSYNC_DATA_DIR ?? app.getPath('downloads'), 'ClipSync');
      await mkdir(folder, { recursive: true });
      const error = await shell.openPath(folder);
      if (error) throw new Error(error);
    },
    'connect-group': (input: GroupInput) => {
      const work = connectionQueue.then(() => connectGroup(input)); connectionQueue = work.catch(() => {}); return work;
    },
    'copy-group-key': () => { if (!savedGroup) throw new Error('먼저 기기를 연결해 주세요.'); return controller.copyGroupKey(savedGroup.groupKey); },
    'copy-diagnostics': () => {
      const state = controller.state();
      const report = { app: 'ClipSync', version: app.getVersion(), platform: process.platform, arch: process.arch, systemVersion: process.getSystemVersion(),
        status: state.groupStatus ?? state.mode, remembered, paused: state.paused, ...controller.connectionDiagnostics() };
      // Use the private clipboard path so a support report is neither recorded nor synchronized.
      return controller.copyGroupKey(JSON.stringify(report, null, 2));
    },
    rediscover: () => controller.rediscover(),
    disconnect: () => {
      const work = connectionQueue.then(async () => {
        await connectionStore.clear(); savedGroup = null; remembered = false; await controller.disconnect();
      }); connectionQueue = work.catch(() => {}); return work;
    },
    pause: (paused: boolean) => controller.pause(paused),
    'choose-file': async (peerId: string) => {
      const result = await nativeDialog(() => dialog.showOpenDialog(window!, { title: '보낼 파일 선택 · 최대 500MB', properties: ['openFile'] }));
      if (!result.canceled && result.filePaths[0]) await controller.sendFile(result.filePaths[0], peerId);
    },
    'send-image': async (peerId: string) => {
      if (!await clipboard.has('image/png')) throw new Error('클립보드에 이미지가 없습니다. 이미지를 복사한 뒤 다시 눌러 주세요.');
      const item = (await clipboard.read()).find(item => item.types.includes('image/png'));
      if (!item) throw new Error('클립보드 이미지를 읽을 수 없습니다.');
      const blob = await item.getType('image/png');
      if (blob.size > MAX_FILE_BYTES) throw new Error('500MB 이하의 이미지만 보낼 수 있습니다.');
      imageCache ??= await mkdtemp(path.join(app.getPath('temp'), 'clipsync-images-'));
      const filename = path.join(imageCache, `클립보드 이미지-${Date.now()}.png`);
      try {
        await pipeline(Readable.fromWeb(blob.stream() as import('node:stream/web').ReadableStream), createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
        await controller.sendFile(filename, peerId, true, true);
      } catch (error) { await rm(filename, { force: true }); throw error; }
    },
    'accept-transfer': async (id: string) => {
      const transfer = controller.state().transfers.find(t => t.id === id && t.direction === 'receive' && t.status === 'offered');
      if (!transfer) throw new Error('수신 대기 중인 파일이 아닙니다.');
      const result = await nativeDialog(() => dialog.showSaveDialog(window!, { title: '파일을 받을 위치 선택', defaultPath: path.join(app.getPath('downloads'), transfer.name), buttonLabel: '여기에 받기' }));
      if (!result.canceled && result.filePath) await controller.acceptTransfer(id, result.filePath);
    },
    'cancel-transfer': (id: string) => controller.cancelTransfer(id),
    'show-file': (id: string) => shell.showItemInFolder(controller.completedFile(id).path),
    'copy-image': async (id: string) => {
      const file = controller.completedFile(id);
      if (!file.image) throw new Error('클립보드 이미지로 받은 파일만 복사할 수 있습니다.');
      const blob = await openAsBlob(file.path, { type: 'image/png' });
      await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    },
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle(`clipsync:${name}`, async (event, ...args): Promise<Result> => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: '허용되지 않은 창입니다.' };
      try { await action(...args as never[]); return { ok: true }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '요청을 처리할 수 없습니다.' }; }
    });
  }
  createTray();
  globalShortcut.register(preferences.shortcut, toggleWindow);
  createWindow();
  try {
    const saved = await connectionStore.load();
    if (saved) { savedGroup = saved; remembered = true; await controller.connectGroup(saved, p2pOptions()); }
  } catch { controller.reportError('저장된 연결 정보를 복원하지 못했습니다. 운영체제 보안 저장소를 확인하거나 연결을 다시 설정해 주세요.'); }
  app.on('activate', () => { if (!window) createWindow(); window?.show(); window?.focus(); });
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

app.on('before-quit', event => {
  if (quitting || !controller) return;
  event.preventDefault();
  quitting = true;
  clearTimeout(positionTimer);
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
  void connectionQueue.catch(() => {}).then(() => controller.dispose()).finally(async () => {
    await media?.dispose();
    try { if (imageCache) await rm(imageCache, { recursive: true, force: true }); }
    finally { app.quit(); }
  });
});
