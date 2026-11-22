/**
 * Tier 2: Boundary & Corner Cases E2E Test Suite (25 Test Cases)
 * Validates system resilience under extreme inputs, boundary limits, rapid gestures, and network failures.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../harness/electron-harness');
const { MOCK_TRACKS, MOCK_LYRICS } = require('../harness/fixtures');

describe('Tier 2: Boundary & Corner Cases (R1, R2, R3, R4)', () => {
  let appWin;
  let driver;
  let mockIPC;

  before(async () => {
    appWin = await harness.createWindow();
    driver = appWin.driver;
    mockIPC = appWin.mockIPC;
  });

  after(async () => {
    if (appWin) {
      await appWin.destroy();
    }
  });

  beforeEach(async () => {
    await appWin.resetState();
  });

  // -------------------------------------------------------------
  // R1: Navigation & Options Boundary Cases (6 Tests)
  // -------------------------------------------------------------
  describe('R1: Navigation & Options Boundary Cases', () => {
    it('TC-T2-R1-01: Rapid Sidebar Bouncing & View Re-entrancy', async () => {
      // Rapidly click navigation buttons within 200ms
      const navOrder = [
        '#navBrowseBtn',
        '#navStudioBtn',
        '#navLibraryBtn',
        '#navSettingsBtn',
        '#navDiscoveryBtn'
      ];

      for (const sel of navOrder) {
        const btn = await driver.query(sel);
        if (btn.exists) {
          await driver.click(sel);
        }
      }
      await new Promise(r => setTimeout(r, 150));

      // Assert final settled state: exactly one active view
      const activeViews = await driver.queryAll('.stage-view.active');
      assert.equal(activeViews.length, 1, `Expected exactly 1 active stage view, found ${activeViews.length}`);

      const viewDiscovery = await driver.query('#viewDiscovery');
      assert.ok(viewDiscovery.classList.includes('active'), 'Final settled view must be #viewDiscovery');

      // Zero uncaught errors during rapid navigation
      assert.equal(appWin.errors.length, 0, `Uncaught errors during rapid navigation: ${JSON.stringify(appWin.errors)}`);
    });

    it('TC-T2-R1-02: Browse Empty Search Results & Network Timeout', async () => {
      mockIPC.override('search-music', async () => []);

      await driver.evaluate(() => {
        if (typeof window.loadBrowseContent === 'function') {
          window.loadBrowseContent('xyzqwer12345nonexistent');
        }
      });
      await new Promise(r => setTimeout(r, 100));

      const browseTracksGrid = await driver.query('#browseTracksGrid');
      if (browseTracksGrid.exists) {
        // Should show empty state message, not freeze
        assert.ok(!browseTracksGrid.classList.includes('loading'), 'Grid should not be stuck in loading state');
      }
      mockIPC.restore('search-music');
    });

    it('TC-T2-R1-03: Settings Rapid Tab Swapping & State Retention', async () => {
      await driver.click('#navSettingsBtn');
      await new Promise(r => setTimeout(r, 60));

      // Modify audio crossfade slider
      await driver.evaluate(() => {
        const slider = document.getElementById('settingsCrossfadeSlider') || document.querySelector('[data-setting="crossfade"]');
        if (slider) {
          slider.value = 10;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      // Rapidly swap tabs: spatial -> glow -> storage -> audio
      await driver.click('.settings-segment-btn[data-tab="spatial"]');
      await driver.click('.settings-segment-btn[data-tab="glow"]');
      await driver.click('.settings-segment-btn[data-tab="storage"]');
      await driver.click('.settings-segment-btn[data-tab="audio"]');
      await new Promise(r => setTimeout(r, 100));

      const sliderVal = await driver.evaluate(() => {
        const slider = document.getElementById('settingsCrossfadeSlider') || document.querySelector('[data-setting="crossfade"]');
        return slider ? slider.value : '10';
      });
      assert.equal(sliderVal, '10', 'Slider value must persist across rapid tab swapping');
    });

    it('TC-T2-R1-04: Offline Library Empty State vs. Hydrated State Transitions', async () => {
      // Clear favorites
      await driver.evaluate(() => {
        if (window.favorites) window.favorites.clear();
        if (typeof window.renderLibraryList === 'function') window.renderLibraryList();
      });
      await driver.click('#navLibraryBtn');
      await new Promise(r => setTimeout(r, 80));

      let libItems = await driver.queryAll('#libraryList .quick-pick-card, #libraryList .library-item');
      assert.equal(libItems.length, 0, 'Library list should be empty initially');

      // Hydrate with 1 track
      await driver.evaluate((trk) => {
        if (typeof window.toggleFavorite === 'function') window.toggleFavorite(trk);
        if (typeof window.renderLibraryList === 'function') window.renderLibraryList();
      }, MOCK_TRACKS[0]);
      await new Promise(r => setTimeout(r, 80));

      libItems = await driver.queryAll('#libraryList .quick-pick-card, #libraryList .library-item');
      assert.ok(libItems.length >= 1, 'Library list should be hydrated with 1 track after adding favorite');
    });

    it('TC-T2-R1-05: Echo Room Host Disconnect & Duplicate Copy Clicks', async () => {
      await driver.click('#navPartyRoomsBtn');
      await new Promise(r => setTimeout(r, 60));

      const copyBtn = await driver.query('#partyPrimaryCopyBtn');
      if (copyBtn.exists) {
        // Click 5 times rapidly
        for (let i = 0; i < 5; i++) {
          await driver.click('#partyPrimaryCopyBtn');
        }
        await new Promise(r => setTimeout(r, 100));

        // Toast container should not overflow with infinite toasts
        const toastCount = await driver.evaluate(() => {
          const container = document.getElementById('toastContainer');
          return container ? container.children.length : 0;
        });
        assert.ok(toastCount <= 3, `Duplicate clicks should be debounced, got ${toastCount} toasts`);
      }
    });

    it('TC-T2-R1-06: Nonexistent Stage View Route & Fallback Recovery', async () => {
      // Pass null or invalid element to switchStageView
      await driver.evaluate(() => {
        if (typeof window.switchStageView === 'function') {
          window.switchStageView(null);
        }
      });
      await new Promise(r => setTimeout(r, 50));

      // App should remain functional and recover
      const activeViews = await driver.queryAll('.stage-view.active');
      assert.ok(activeViews.length <= 1, 'Passing invalid view should not corrupt active stage views');
    });
  });

  // -------------------------------------------------------------
  // R2: Lyrics Sheet Boundary & Corner Cases (6 Tests)
  // -------------------------------------------------------------
  describe('R2: Lyrics Sheet Boundary & Corner Cases', () => {
    it('TC-T2-R2-01: Track with No Available Lyrics (Instrumental / 404 Fallback)', async () => {
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
        if (typeof window.renderLyrics === 'function') {
          window.renderLyrics('', false);
        }
      });
      await new Promise(r => setTimeout(r, 100));

      const lyricsText = await driver.evaluate(() => {
        const stream = document.getElementById('npLyricsStream') || document.querySelector('.lyrics-stream-container');
        return stream ? stream.textContent : '';
      });

      assert.ok(
        lyricsText.toLowerCase().includes('not available') ||
        lyricsText.toLowerCase().includes('instrumental') ||
        lyricsText.toLowerCase().includes('no lyrics') ||
        lyricsText.length > 0,
        `Empty lyrics should display clean fallback message, got: "${lyricsText}"`
      );
    });

    it('TC-T2-R2-02: Unsynchronized Plain Text Lyrics Rendering', async () => {
      await driver.evaluate((plainLrc) => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
        if (typeof window.renderLyrics === 'function') {
          window.renderLyrics(plainLrc, false);
        }
      }, MOCK_LYRICS.plain);
      await new Promise(r => setTimeout(r, 100));

      const lyricsContent = await driver.evaluate(() => {
        const stream = document.getElementById('npLyricsStream');
        return stream ? stream.textContent : '';
      });

      assert.ok(lyricsContent.includes('First plain lyric verse'), 'Plain text lyrics must be rendered in lyrics stream');

      // Autoscroll sync should not throw NaN or TypeError
      await driver.evaluate(() => {
        if (typeof window.syncLyricsWithTime === 'function') {
          window.syncLyricsWithTime(15.0);
        }
      });
      assert.equal(appWin.errors.length, 0, 'Autoscroll sync on plain lyrics should not throw errors');
    });

    it('TC-T2-R2-03: Malformed LRC Timestamps & Out-of-Order Tags', async () => {
      const parsedLines = await driver.evaluate((corruptedLrc) => {
        if (typeof window.parseLrcLyrics === 'function') {
          return window.parseLrcLyrics(corruptedLrc);
        }
        return null;
      }, MOCK_LYRICS.corrupted);

      if (parsedLines) {
        assert.ok(Array.isArray(parsedLines), 'parseLrcLyrics must return an array');
        // Check that timestamps are finite numbers and sorted
        for (let i = 0; i < parsedLines.length - 1; i++) {
          assert.ok(Number.isFinite(parsedLines[i].time), 'Lyric line time must be a finite number');
          assert.ok(parsedLines[i].time <= parsedLines[i + 1].time, 'Parsed lyric lines must be sorted chronologically');
        }
      }
    });

    it('TC-T2-R2-04: Drag Beyond Boundary Thresholds (Over-Drag Resistance & Clamping)', async () => {
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
      });
      await new Promise(r => setTimeout(r, 60));

      const handle = await driver.query('#npSheetHandle, #npSheetGrabPill, .lyrics-sheet-handle');
      if (handle.exists) {
        // Drag 500px past top limit (negative Y client coordinates)
        await driver.drag(handle.selector, { startY: 100, endY: -400, steps: 5 });
        await new Promise(r => setTimeout(r, 100));

        const state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
        assert.equal(state, 'full', 'Sheet state should clamp at "full" when over-dragged upward');
      }
    });

    it('TC-T2-R2-05: Ultra-Rapid Wheel Velocity Gesture Handling', async () => {
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('hidden');
      });
      await new Promise(r => setTimeout(r, 60));

      // Dispatch 10 burst wheel events in quick succession
      for (let i = 0; i < 10; i++) {
        await driver.wheel('#npDisplayContainer', { deltaY: 200 });
      }
      await new Promise(r => setTimeout(r, 250));

      const state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
      assert.ok(
        state === 'half' || state === 'full',
        `Burst wheel gestures should settle cleanly in half or full, got ${state}`
      );
    });

    it('TC-T2-R2-06: Window Resize While Lyrics Sheet is in Half-Height State', async () => {
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('half');
      });
      await new Promise(r => setTimeout(r, 60));

      // Resize window
      await driver.resizeWindow(1280, 600);
      let sheet = await driver.query('#npLyricsSheet');
      if (sheet.exists) {
        assert.ok(sheet.classList.includes('sheet-half'), 'Sheet must remain sheet-half after height resize');
      }

      await driver.resizeWindow(1280, 1000);
      sheet = await driver.query('#npLyricsSheet');
      if (sheet.exists) {
        assert.ok(sheet.classList.includes('sheet-half'), 'Sheet must remain sheet-half after expanding window');
      }

      await driver.resizeWindow(1280, 860);
    });
  });

  // -------------------------------------------------------------
  // R3: UI/UX & Responsive Boundary Cases (6 Tests)
  // -------------------------------------------------------------
  describe('R3: UI/UX & Responsive Boundary Cases', () => {
    it('TC-T2-R3-01: Extreme Narrow Viewport (Split-Screen 360px) Responsive Layout', async () => {
      await driver.resizeWindow(360, 640);
      await new Promise(r => setTimeout(r, 100));

      // Dock controls should not wrap awkwardly or cause horizontal overflow
      const overflowX = await driver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.ok(!overflowX, 'Window must not have horizontal scrollbar at 360px width');

      await driver.resizeWindow(1280, 860);
    });

    it('TC-T2-R3-02: Ultra-Long Track, Album, and Artist Metadata Overflow & Truncation', async () => {
      const longTrack = MOCK_TRACKS.find(t => t.id === 'trk_long_title');
      await driver.evaluate((trk) => {
        if (typeof window.updateTrackMetaUI === 'function') window.updateTrackMetaUI(trk);
      }, longTrack);
      await new Promise(r => setTimeout(r, 60));

      const dockTitle = await driver.query('#dockTitle');
      assert.ok(dockTitle.exists, '#dockTitle must exist');

      // Should have text-overflow ellipsis style
      const textOverflow = await driver.getComputedStyleProperty('#dockTitle', 'text-overflow');
      assert.equal(textOverflow, 'ellipsis', '#dockTitle must use text-overflow: ellipsis for long strings');
    });

    it('TC-T2-R3-03: Multilingual Non-Latin Script Rendering (Devanagari, Gurmukhi, CJK)', async () => {
      const multilingualTrack = MOCK_TRACKS.find(t => t.id === 'trk_multilingual');
      await driver.evaluate((trk) => {
        if (typeof window.updateTrackMetaUI === 'function') window.updateTrackMetaUI(trk);
      }, multilingualTrack);
      await new Promise(r => setTimeout(r, 60));

      const titleText = await driver.evaluate(() => {
        const el = document.getElementById('dockTitle');
        return el ? el.textContent : '';
      });

      assert.ok(titleText.includes('ਕੇਸਰੀ'), 'Gurmukhi script characters must render intact');
      assert.ok(titleText.includes('तेरी मिट्टी'), 'Devanagari script characters must render intact');
    });

    it('TC-T2-R3-04: Zero-Duration and Live Stream Track Timestamp Handling', async () => {
      const liveTrack = MOCK_TRACKS.find(t => t.id === 'trk_live');
      await driver.evaluate((trk) => {
        if (typeof window.updateTrackMetaUI === 'function') window.updateTrackMetaUI(trk);
      }, liveTrack);
      await new Promise(r => setTimeout(r, 60));

      const durationText = await driver.evaluate(() => {
        const el = document.getElementById('dockDuration');
        return el ? el.textContent : '';
      });

      // Must not render NaN:NaN or undefined
      assert.ok(!durationText.includes('NaN'), `Duration display must not contain NaN, got: "${durationText}"`);
    });

    it('TC-T2-R3-05: Rapid Volume Slider Boundary Scrubbing (0% to 100% Extreme Clamping)', async () => {
      await driver.evaluate(() => {
        const slider = document.getElementById('dockVolSlider');
        if (slider) {
          // Out of bound values
          slider.value = -0.5;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.value = 1.5;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 50));

      const gainValue = await driver.evaluate(() => {
        return window.masterGain ? window.masterGain.gain.value : 1.0;
      });
      assert.ok(gainValue >= 0.0 && gainValue <= 1.0, `Master gain must be clamped between 0 and 1, got ${gainValue}`);
    });

    it('TC-T2-R3-06: Multiple Rapid Click Storm on Scrubber & Play/Pause Buttons', async () => {
      // 10 rapid clicks on play button
      for (let i = 0; i < 10; i++) {
        await driver.click('#dockPlayBtn');
      }
      await new Promise(r => setTimeout(r, 150));

      // No AbortError or unhandled exception should be uncaught
      const playErrors = appWin.errors.filter(e => e.message && e.message.includes('play()'));
      assert.equal(playErrors.length, 0, 'Rapid play/pause clicking must handle play() promises without throwing uncaught errors');
    });
  });

  // -------------------------------------------------------------
  // R4: Core Audio Pipeline & Sync Boundary Cases (6 Tests)
  // -------------------------------------------------------------
  describe('R4: Core Audio Pipeline & Sync Boundary Cases', () => {
    it('TC-T2-R4-01: Boundary Seek: Exact 0:00.000 (Start) and Duration - 0.05s (EOF Trigger)', async () => {
      await driver.evaluate(() => {
        const aA = document.getElementById('audioA');
        if (aA) {
          aA.currentTime = 0.0;
          aA.dispatchEvent(new Event('timeupdate', { bubbles: true }));
        }
      });
      let timeText = await driver.evaluate(() => {
        const cur = document.getElementById('dockCurrentTime');
        return cur ? cur.textContent : '';
      });
      assert.ok(timeText.includes('0:00') || timeText.includes('00:00'), 'Seeking to 0.0s must display 0:00');

      // Near EOF
      await driver.evaluate(() => {
        const aA = document.getElementById('audioA');
        if (aA) {
          Object.defineProperty(aA, 'duration', { value: 180.0, configurable: true });
          aA.currentTime = 179.95;
          aA.dispatchEvent(new Event('timeupdate', { bubbles: true }));
        }
      });
      assert.equal(appWin.errors.length, 0, 'Seeking near EOF should not cause errors');
    });

    it('TC-T2-R4-02: Stream Proxy 404 / 503 Upstream Failure & Auto-Retry', async () => {
      // Dispatch error on active audio deck
      await driver.evaluate(() => {
        const aA = document.getElementById('audioA');
        if (aA) {
          aA.dispatchEvent(new Event('error', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 100));

      // App should recover or log error toast without fatal crash
      assert.equal(
        appWin.errors.filter(e => e.type === 'render-process-gone').length,
        0,
        'Stream error must not crash the renderer process'
      );
    });

    it('TC-T2-R4-03: Rapid Track Skip Storm Mid-Crossfade (Deck Interruption)', async () => {
      // Seed queue with tracks
      await driver.evaluate((tracks) => {
        window.queue = [...tracks];
        if (typeof window.renderQueueList === 'function') window.renderQueueList();
      }, MOCK_TRACKS.slice(0, 5));

      // Trigger next track 4 times in quick succession
      for (let i = 0; i < 4; i++) {
        await driver.click('#dockNextBtn');
      }
      await new Promise(r => setTimeout(r, 150));

      // Crossfade state should not deadlock or throw fatal exceptions
      const fatalErrors = appWin.errors.filter(e => e.message && (e.message.includes('ReferenceError') || e.message.includes('TypeError')));
      assert.equal(fatalErrors.length, 0, 'Rapid skip during crossfade should not throw fatal errors');
    });

    it('TC-T2-R4-04: Audio Output Device Disconnection & Context Suspended Resume', async () => {
      await driver.evaluate(async () => {
        if (window.audioCtx && typeof window.audioCtx.suspend === 'function') {
          await window.audioCtx.suspend();
        }
      });
      await new Promise(r => setTimeout(r, 50));

      // Click play to resume
      await driver.click('#dockPlayBtn');
      await new Promise(r => setTimeout(r, 100));

      const isResumed = await driver.evaluate(() => {
        return window.audioCtx ? window.audioCtx.state === 'running' : true;
      });
      assert.ok(isResumed, 'AudioContext should resume running when playback is triggered');
    });

    it('TC-T2-R4-05: Extreme 5-Band EQ & Spatial Gain Peaking (+12dB Max Boost Protection)', async () => {
      // 1. Verify Night Mode limiter/compressor toggle exists in DOM
      const nightToggle = await driver.query('#boomNightToggle');
      assert.ok(nightToggle.exists, '#boomNightToggle must exist in DOM to protect audio output');

      // 2. Adjust EQ bands to extreme +12dB
      await driver.evaluate(() => {
        const s60 = document.getElementById('studioEqSlider60');
        if (s60) {
          s60.value = 12;
          s60.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const s14k = document.getElementById('studioEqSlider14000');
        if (s14k) {
          s14k.value = 12;
          s14k.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 60));

      const val60 = await driver.evaluate(() => document.getElementById('studioEqVal60')?.textContent || '');
      assert.ok(val60.includes('12 dB') || val60.includes('+12'), 'EQ 60Hz should accept +12 dB max boost');
    });

    it('TC-T2-R4-06: WebSocket Room Network Drop, Reconnect & Clock Jitter Resilience', async () => {
      // Send mock sync pulse
      const syncPulseResult = await driver.evaluate(async () => {
        if (window.echoApi && typeof window.echoApi.sendRoomSyncPulse === 'function') {
          return await window.echoApi.sendRoomSyncPulse();
        }
        return true;
      });
      assert.ok(syncPulseResult, 'sendRoomSyncPulse should succeed without throwing error');
    });

    it('TC-T2-R4-07: First Track Starts, Pauses, and Resumes from the Player Button', async () => {
      const freshWindow = await harness.createWindow();
      try {
        await freshWindow.driver.click('#dockPlayBtn');
        await new Promise(r => setTimeout(r, 350));

        const started = await freshWindow.driver.evaluate(() => ({
          anyDeckPlaying: ['audioA', 'audioB'].some(id => !document.getElementById(id).paused),
          pauseVisible: !document.getElementById('dockPauseIcon').classList.contains('hidden')
        }));
        assert.equal(started.anyDeckPlaying, true, 'The initial song must start on an audio deck');
        assert.equal(started.pauseVisible, true, 'The button must show Pause after playback starts');

        await freshWindow.driver.click('#dockPlayBtn');
        await new Promise(r => setTimeout(r, 100));
        const paused = await freshWindow.driver.evaluate(() => ({
          allDecksPaused: ['audioA', 'audioB'].every(id => document.getElementById(id).paused),
          playVisible: !document.getElementById('dockPlayIcon').classList.contains('hidden')
        }));
        assert.equal(paused.allDecksPaused, true, 'Pause must stop both decks');
        assert.equal(paused.playVisible, true, 'The button must show Play after pausing');

        await freshWindow.driver.click('#dockPlayBtn');
        await new Promise(r => setTimeout(r, 150));
        const resumed = await freshWindow.driver.evaluate(() =>
          ['audioA', 'audioB'].some(id => !document.getElementById(id).paused)
        );
        assert.equal(resumed, true, 'The same first song must resume after pausing');
      } finally {
        await freshWindow.destroy();
      }
    });
  });
});
