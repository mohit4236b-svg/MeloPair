const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('echoApi', {
  searchMusic: (query) => ipcRenderer.invoke('search-music', query),
  getStreamUrl: (track) => ipcRenderer.invoke('get-stream-url', track),
  getRelatedTracks: (data) => ipcRenderer.invoke('get-related-tracks', data),
  getLyrics: (data) => ipcRenderer.invoke('get-lyrics', data),
  downloadTrack: (data) => ipcRenderer.invoke('download-track', data),
  openDownloadDir: () => ipcRenderer.invoke('open-download-dir'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  onDownloadProgress: (cb) => {
    ipcRenderer.on('download-progress', (event, data) => cb(data));
  },
  minimize: () => ipcRenderer.invoke('window-min'),
  maximize: () => ipcRenderer.invoke('window-max'),
  close: () => ipcRenderer.invoke('window-close'),
  loadUserData: () => ipcRenderer.invoke('load-user-data'),
  saveUserData: (data) => ipcRenderer.invoke('save-user-data', data),
  startFirebaseSignIn: () => ipcRenderer.invoke('firebase-auth-start'),
  getFirebaseUser: () => ipcRenderer.invoke('firebase-auth-get-user'),
  signOutFirebaseUser: () => ipcRenderer.invoke('firebase-auth-signout'),
  onFirebaseAuthResult: (cb) => {
    const listener = (_event, result) => cb(result);
    ipcRenderer.on('firebase-auth-result', listener);
    return () => ipcRenderer.removeListener('firebase-auth-result', listener);
  },
  onWindowState: (cb) => {
    ipcRenderer.on('window-state', (event, state) => cb(state));
  },
  // Echo Rooms / Multi-Device Sync
  getRoomInfo: () => ipcRenderer.invoke('get-room-info'),
  regenerateRoomId: () => ipcRenderer.invoke('regenerate-room-id'),
  setRoomId: (code) => ipcRenderer.invoke('set-room-id', code),
  setRoomNetworkMode: (mode) => ipcRenderer.invoke('set-room-network-mode', mode),
  broadcastRoomState: (data) => ipcRenderer.invoke('broadcast-room-state', data),
  realignRoomDevices: () => ipcRenderer.invoke('realign-room-devices'),
  sendRoomSyncPulse: () => ipcRenderer.invoke('send-room-sync-pulse'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  onRoomMembersChanged: (cb) => {
    ipcRenderer.on('room-members-changed', (event, count) => cb(count));
  },
  onTriggerSyncPulse: (cb) => {
    ipcRenderer.on('trigger-sync-pulse', (event, targetTime) => cb(targetTime));
  },
  onBeepFusionStart: (cb) => {
    ipcRenderer.on('beep-fusion-start', () => cb());
  },
  onBeepFusionStop: (cb) => {
    ipcRenderer.on('beep-fusion-stop', () => cb());
  }
});
