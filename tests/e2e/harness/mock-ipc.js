/**
 * Deterministic Mock IPC Router for EchoPlayerDesktop E2E Tests
 * Intercepts all 27 echoApi channels to eliminate external cloud dependencies.
 */

const { ipcMain } = require('electron');
const {
  MOCK_TRACKS,
  MOCK_LYRICS,
  MOCK_ROOM_INFO,
  MOCK_USER_DATA,
  SILENT_AUDIO_URL
} = require('./fixtures');

class MockIPC {
  constructor() {
    this.overrides = new Map();
    this.callHistory = new Map();
    this.activeUserData = JSON.parse(JSON.stringify(MOCK_USER_DATA));
    this.activeRoomInfo = JSON.parse(JSON.stringify(MOCK_ROOM_INFO));
    this.isRegistered = false;
  }

  recordCall(channel, args) {
    if (!this.callHistory.has(channel)) {
      this.callHistory.set(channel, []);
    }
    this.callHistory.get(channel).push(args);
  }

  getCalls(channel) {
    return this.callHistory.get(channel) || [];
  }

  clearCalls() {
    this.callHistory.clear();
  }

  override(channel, fn) {
    this.overrides.set(channel, fn);
  }

  restore(channel) {
    this.overrides.delete(channel);
  }

  resetAll() {
    this.overrides.clear();
    this.callHistory.clear();
    this.activeUserData = JSON.parse(JSON.stringify(MOCK_USER_DATA));
    this.activeRoomInfo = JSON.parse(JSON.stringify(MOCK_ROOM_INFO));
  }

  register() {
    if (this.isRegistered) return;
    this.isRegistered = true;

    // 1. search-music
    ipcMain.handle('search-music', async (event, query) => {
      this.recordCall('search-music', query);
      if (this.overrides.has('search-music')) {
        return this.overrides.get('search-music')(query);
      }
      if (!query || typeof query !== 'string') return [];
      const q = query.toLowerCase();
      const matches = MOCK_TRACKS.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        (t.genre && t.genre.toLowerCase().includes(q))
      );
      return matches.length > 0 ? matches : MOCK_TRACKS.slice(0, 5);
    });

    // 2. get-stream-url
    ipcMain.handle('get-stream-url', async (event, videoId) => {
      this.recordCall('get-stream-url', videoId);
      if (this.overrides.has('get-stream-url')) {
        return this.overrides.get('get-stream-url')(videoId);
      }
      const track = MOCK_TRACKS.find(t => t.id === videoId);
      return track ? track.url : SILENT_AUDIO_URL;
    });

    // 3. get-related-tracks
    ipcMain.handle('get-related-tracks', async (event, data) => {
      this.recordCall('get-related-tracks', data);
      if (this.overrides.has('get-related-tracks')) {
        return this.overrides.get('get-related-tracks')(data);
      }
      return MOCK_TRACKS.slice(1, 6);
    });

    // 4. get-lyrics
    ipcMain.handle('get-lyrics', async (event, data) => {
      this.recordCall('get-lyrics', data);
      if (this.overrides.has('get-lyrics')) {
        return this.overrides.get('get-lyrics')(data);
      }
      const title = (data && data.title) ? data.title.toLowerCase() : '';
      if (title.includes('plain')) {
        return {
          synced: false,
          lyrics: MOCK_LYRICS.plain,
          trackName: data.title,
          artistName: data.artist || 'Unknown'
        };
      }
      if (title.includes('instrumental') || title.includes('no-lyrics') || title.includes('corrupt')) {
        return {
          synced: false,
          lyrics: '',
          trackName: data.title,
          artistName: data.artist || 'Unknown'
        };
      }
      return {
        synced: true,
        lyrics: MOCK_LYRICS.synced,
        trackName: data ? data.title : 'Track',
        artistName: data ? data.artist : 'Artist'
      };
    });

    // 5. download-track
    ipcMain.handle('download-track', async (event, data) => {
      this.recordCall('download-track', data);
      if (this.overrides.has('download-track')) {
        return this.overrides.get('download-track')(data);
      }
      return { success: true, filePath: 'C:\\MockDownloads\\track.mp3' };
    });

    // 6. open-download-dir
    ipcMain.handle('open-download-dir', async () => {
      this.recordCall('open-download-dir', null);
      return true;
    });

    // 7. clear-cache
    ipcMain.handle('clear-cache', async () => {
      this.recordCall('clear-cache', null);
      return true;
    });

    // 8-10. Window controls
    ipcMain.handle('window-min', async () => {
      this.recordCall('window-min', null);
      return true;
    });
    ipcMain.handle('window-max', async () => {
      this.recordCall('window-max', null);
      return true;
    });
    ipcMain.handle('window-close', async () => {
      this.recordCall('window-close', null);
      return true;
    });

    // 11. load-user-data
    ipcMain.handle('load-user-data', async () => {
      this.recordCall('load-user-data', null);
      if (this.overrides.has('load-user-data')) {
        return this.overrides.get('load-user-data')();
      }
      return this.activeUserData;
    });

    // 12. save-user-data
    ipcMain.handle('save-user-data', async (event, data) => {
      this.recordCall('save-user-data', data);
      if (this.overrides.has('save-user-data')) {
        return this.overrides.get('save-user-data')(data);
      }
      this.activeUserData = { ...this.activeUserData, ...data };
      return { success: true };
    });

    ipcMain.handle('initialize-fresh-profile', async (event, profileSignals) => {
      this.recordCall('initialize-fresh-profile', profileSignals);
      if (this.overrides.has('initialize-fresh-profile')) {
        return this.overrides.get('initialize-fresh-profile')(profileSignals);
      }
      return { isFirstLaunch: false, showWelcomeWizard: false };
    });
    ipcMain.handle('mark-onboarding-complete', async (event, completed) => {
      this.recordCall('mark-onboarding-complete', completed);
      if (this.overrides.has('mark-onboarding-complete')) {
        return this.overrides.get('mark-onboarding-complete')(completed);
      }
      return true;
    });

    // 13. get-room-info
    ipcMain.handle('get-room-info', async () => {
      this.recordCall('get-room-info', null);
      if (this.overrides.has('get-room-info')) {
        return this.overrides.get('get-room-info')();
      }
      return this.activeRoomInfo;
    });

    // 14. regenerate-room-id
    ipcMain.handle('regenerate-room-id', async () => {
      this.recordCall('regenerate-room-id', null);
      this.activeRoomInfo.roomId = String(Math.floor(100000 + Math.random() * 900000));
      return this.activeRoomInfo.roomId;
    });

    // 15. set-room-id
    ipcMain.handle('set-room-id', async (event, code) => {
      this.recordCall('set-room-id', code);
      this.activeRoomInfo.roomId = code;
      return true;
    });

    // 16. set-room-network-mode
    ipcMain.handle('set-room-network-mode', async (event, mode) => {
      this.recordCall('set-room-network-mode', mode);
      this.activeRoomInfo.networkMode = mode;
      return true;
    });

    // 17. broadcast-room-state
    ipcMain.handle('broadcast-room-state', async (event, data) => {
      this.recordCall('broadcast-room-state', data);
      if (this.overrides.has('broadcast-room-state')) {
        return this.overrides.get('broadcast-room-state')(data);
      }
      return true;
    });

    // 18. realign-room-devices
    ipcMain.handle('realign-room-devices', async () => {
      this.recordCall('realign-room-devices', null);
      return true;
    });

    // 19. send-room-sync-pulse
    ipcMain.handle('send-room-sync-pulse', async () => {
      this.recordCall('send-room-sync-pulse', null);
      return true;
    });

    // 20. open-external-url
    ipcMain.handle('open-external-url', async (event, url) => {
      this.recordCall('open-external-url', url);
      return true;
    });

    // 21-23. Firebase account controls used by the profile UI
    ipcMain.handle('firebase-auth-start', async () => {
      this.recordCall('firebase-auth-start', null);
      return true;
    });
    ipcMain.handle('firebase-auth-get-user', async () => {
      this.recordCall('firebase-auth-get-user', null);
      return null;
    });
    ipcMain.handle('firebase-auth-signout', async () => {
      this.recordCall('firebase-auth-signout', null);
      return true;
    });

    ipcMain.handle('check-for-updates', async (_event, manual) => {
      this.recordCall('check-for-updates', manual);
      if (this.overrides.has('check-for-updates')) {
        return this.overrides.get('check-for-updates')(manual);
      }
      return { available: false, currentVersion: '1.0.3' };
    });
    ipcMain.handle('download-update', async () => {
      this.recordCall('download-update', null);
      return { success: true };
    });
    ipcMain.handle('open-update-url', async (_event, url) => {
      this.recordCall('open-update-url', url);
      return { success: true };
    });
    ipcMain.handle('get-app-version', async () => {
      this.recordCall('get-app-version', null);
      return '1.0.3';
    });
  }

  // Push event helpers to send events into a BrowserWindow webContents
  emitDownloadProgress(webContents, data) {
    webContents.send('download-progress', data);
  }

  emitWindowState(webContents, state) {
    webContents.send('window-state', state);
  }

  emitRoomMembersChanged(webContents, count) {
    webContents.send('room-members-changed', count);
  }

  emitTriggerSyncPulse(webContents, targetTime) {
    webContents.send('trigger-sync-pulse', targetTime);
  }

  emitBeepFusionStart(webContents) {
    webContents.send('beep-fusion-start');
  }

  emitBeepFusionStop(webContents) {
    webContents.send('beep-fusion-stop');
  }

  emitSatelliteStateSync(webContents, state) {
    webContents.send('satellite-state-sync', state);
  }
}

module.exports = {
  MockIPC
};
