import { contextBridge, ipcRenderer } from 'electron';
import type { ClipSyncAPI, SyncState } from '../shared/api';

const api: ClipSyncAPI = {
  state: () => ipcRenderer.invoke('clipsync:get-state'),
  host: () => ipcRenderer.invoke('clipsync:host'),
  join: invitation => ipcRenderer.invoke('clipsync:join', invitation),
  disconnect: () => ipcRenderer.invoke('clipsync:disconnect'),
  pause: paused => ipcRenderer.invoke('clipsync:pause', paused),
  copyInvitation: () => ipcRenderer.invoke('clipsync:copy-invitation'),
  chooseFile: peerId => ipcRenderer.invoke('clipsync:choose-file', peerId),
  sendImage: peerId => ipcRenderer.invoke('clipsync:send-image', peerId),
  acceptTransfer: id => ipcRenderer.invoke('clipsync:accept-transfer', id),
  cancelTransfer: id => ipcRenderer.invoke('clipsync:cancel-transfer', id),
  showFile: id => ipcRenderer.invoke('clipsync:show-file', id),
  copyImage: id => ipcRenderer.invoke('clipsync:copy-image', id),
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: SyncState) => listener(state);
    ipcRenderer.on('clipsync:state', handler);
    return () => ipcRenderer.removeListener('clipsync:state', handler);
  },
};

contextBridge.exposeInMainWorld('clipSync', api);
