import { contextBridge, ipcRenderer } from 'electron';
import type { ClipSyncAPI, SyncState } from '../shared/api';
import type { Preferences } from '../shared/history';

let history: SyncState['history'] = [];
let historyRevision = -1;
function decodeState(state: Omit<SyncState, 'history'> & { history?: SyncState['history'] }): SyncState {
  if (state.history && state.historyRevision >= historyRevision) { history = state.history; historyRevision = state.historyRevision; }
  return { ...state, history };
}

const api: ClipSyncAPI = {
  connection: () => ipcRenderer.invoke('clipsync:connection'),
  createGroupKey: () => ipcRenderer.invoke('clipsync:create-group-key'),
  connectGroup: input => ipcRenderer.invoke('clipsync:connect-group', input),
  copyGroupKey: () => ipcRenderer.invoke('clipsync:copy-group-key'),
  preferences: () => ipcRenderer.invoke('clipsync:preferences'),
  configure: preferences => ipcRenderer.invoke('clipsync:configure', preferences),
  history: (action, id) => ipcRenderer.invoke('clipsync:history', action, id),
  hide: () => ipcRenderer.invoke('clipsync:hide'),
  quit: () => ipcRenderer.invoke('clipsync:quit'),
  openDownloads: () => ipcRenderer.invoke('clipsync:open-downloads'),
  onPreferences(listener) {
    const handler = (_event: Electron.IpcRendererEvent, preferences: Preferences) => listener(preferences);
    ipcRenderer.on('clipsync:preferences', handler);
    return () => ipcRenderer.removeListener('clipsync:preferences', handler);
  },
  state: async () => decodeState(await ipcRenderer.invoke('clipsync:get-state')),
  disconnect: () => ipcRenderer.invoke('clipsync:disconnect'),
  pause: paused => ipcRenderer.invoke('clipsync:pause', paused),
  chooseFile: peerId => ipcRenderer.invoke('clipsync:choose-file', peerId),
  sendImage: peerId => ipcRenderer.invoke('clipsync:send-image', peerId),
  acceptTransfer: id => ipcRenderer.invoke('clipsync:accept-transfer', id),
  cancelTransfer: id => ipcRenderer.invoke('clipsync:cancel-transfer', id),
  showFile: id => ipcRenderer.invoke('clipsync:show-file', id),
  copyImage: id => ipcRenderer.invoke('clipsync:copy-image', id),
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: SyncState) => listener(decodeState(state));
    ipcRenderer.on('clipsync:state', handler);
    return () => ipcRenderer.removeListener('clipsync:state', handler);
  },
};

contextBridge.exposeInMainWorld('clipSync', api);
