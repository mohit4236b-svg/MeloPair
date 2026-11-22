/**
 * Headless Electron Harness for EchoPlayerDesktop E2E Tests
 * Manages headless BrowserWindow lifecycle, error capture, and DOM synchronization.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { DOMDriver } = require('./dom-driver');
const { MockIPC } = require('./mock-ipc');

// Ensure headless flags are appended early
try {
  app.commandLine.appendSwitch('mute-audio');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('disable-gpu');
} catch (e) {
  // Switches already configured or runtime past switch initialization
}

const APP_ROOT = path.resolve(__dirname, '../../..');
const PRELOAD_PATH = path.join(APP_ROOT, 'preload.js');
const INDEX_HTML_PATH = path.join(APP_ROOT, 'index.html');

const mockIPC = new MockIPC();
mockIPC.register();

class ElectronHarness {
  constructor() {
    this.windows = new Set();
    this.mockIPC = mockIPC;
  }

  async ensureAppReady() {
    if (!app.isReady()) {
      await app.whenReady();
    }
  }

  async createWindow(options = {}) {
    await this.ensureAppReady();

    const width = options.width || 1280;
    const height = options.height || 860;

    const win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    });

    const errors = [];
    const logs = [];

    // Capture console output and errors
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      logs.push({ level, message, line, sourceId });
      // level 3 is error in Electron console-message
      if (level === 3 || message.includes('Uncaught') || message.includes('ReferenceError') || message.includes('TypeError')) {
        errors.push({ level, message, line, sourceId });
      }
    });

    // Capture render process crashes
    win.webContents.on('render-process-gone', (event, details) => {
      errors.push({ type: 'render-process-gone', details });
    });

    // Injected script to capture window.onerror and unhandledrejection
    await win.webContents.session.setPreloads([PRELOAD_PATH]);

    await win.loadFile(INDEX_HTML_PATH);

    // Wait for DOM ready
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve(true);
        } else {
          window.addEventListener('load', () => resolve(true), { once: true });
        }
      })
    `);

    // Give DOMContentLoaded handlers 150ms to finish initial bindings
    await new Promise(r => setTimeout(r, 150));

    const driver = new DOMDriver(win);
    this.windows.add(win);

    return {
      win,
      driver,
      mockIPC: this.mockIPC,
      errors,
      logs,
      async resetState() {
        mockIPC.resetAll();
        errors.length = 0;
        await driver.evaluate(() => {
          // Reset audio
          const aA = document.getElementById('audioA');
          const aB = document.getElementById('audioB');
          if (aA) { aA.pause(); aA.currentTime = 0; }
          if (aB) { aB.pause(); aB.currentTime = 0; }

          // Reset modal
          const npModal = document.getElementById('nowPlayingModal');
          if (npModal && !npModal.classList.contains('hidden')) {
            npModal.classList.add('hidden');
          }

          // Reset lyrics sheet if controller exists
          if (window.lyricsSheetController && typeof window.lyricsSheetController.setState === 'function') {
            window.lyricsSheetController.setState('hidden');
          }

          // Reset stage view to discovery
          if (typeof window.switchStageView === 'function') {
            const disc = document.getElementById('viewDiscovery');
            if (disc) window.switchStageView(disc);
          }
        });
        await new Promise(r => setTimeout(r, 50));
      },
      async destroy() {
        if (!win.isDestroyed()) {
          win.destroy();
        }
      }
    };
  }

  async closeAllWindows() {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
    this.windows.clear();
  }
}

const harness = new ElectronHarness();

module.exports = {
  harness,
  ElectronHarness,
  mockIPC
};
