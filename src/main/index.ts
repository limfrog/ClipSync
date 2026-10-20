import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SyncController } from './controller';
import type { Result } from '../shared/api';
import { MAX_FILE_BYTES } from '../shared/transfers';

let window: BrowserWindow | null = null;
let controller: SyncController;
let quitting = false;
let imageCache: string;

// Tests isolate app data; normal desktops use Electron's standard per-user path.
if (process.env.CLIPSYNC_DATA_DIR) app.setPath('userData', process.env.CLIPSYNC_DATA_DIR);

function createWindow() {
  window = new BrowserWindow({
    width: 1080, height: 780, minWidth: 760, minHeight: 650,
    title: 'ClipSync', backgroundColor: '#101615',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  void window.loadFile(path.join(__dirname, 'renderer/index.html'));
  window.on('closed', () => { window = null; });
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
  ]) : Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'windowMenu' }]));

  controller = new SyncController({
    readText: async () => await clipboard.has('text/plain') ? clipboard.readText() : null,
    writeText: text => clipboard.writeText(text),
  }, state => {
    if (window && !window.isDestroyed()) window.webContents.send('clipsync:state', state);
  });
  ipcMain.handle('clipsync:get-state', () => controller.state());
  const actions: Record<string, (...args: never[]) => unknown> = {
    host: () => controller.host(),
    join: (code: string) => controller.join(code),
    disconnect: () => controller.disconnect(),
    pause: (paused: boolean) => controller.pause(paused),
    'copy-invitation': () => controller.copyInvitation(),
    'choose-file': async (peerId: string) => {
      const result = await dialog.showOpenDialog(window!, { title: '보낼 파일 선택 · 최대 500MB', properties: ['openFile'] });
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
      const result = await dialog.showSaveDialog(window!, { title: '파일을 받을 위치 선택', defaultPath: path.join(app.getPath('downloads'), transfer.name), buttonLabel: '여기에 받기' });
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
    ipcMain.handle(`clipsync:${name}`, async (_event, ...args): Promise<Result> => {
      try { await action(...args as never[]); return { ok: true }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '요청을 처리할 수 없습니다.' }; }
    });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // Closing the app stops clipboard sharing on every platform.
  app.quit();
});

app.on('before-quit', event => {
  if (quitting || !controller) return;
  event.preventDefault();
  quitting = true;
  void controller.dispose().finally(async () => {
    try { if (imageCache) await rm(imageCache, { recursive: true, force: true }); }
    finally { app.quit(); }
  });
});
