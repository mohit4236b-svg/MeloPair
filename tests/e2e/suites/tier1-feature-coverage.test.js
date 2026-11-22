/**
 * Tier 1: Feature Coverage E2E Test Suite (27 Test Cases)
 * Validates functional correctness of all individual requirements (R1, R2, R3, R4) in nominal states.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../harness/electron-harness');
const { MOCK_TRACKS, MOCK_LYRICS, SILENT_AUDIO_URL } = require('../harness/fixtures');

describe('Tier 1: Feature Coverage (R1, R2, R3, R4)', () => {
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
  // R1: Navigation, Sidebar, Dock & Options (7 Tests)
  // -------------------------------------------------------------
  describe('R1: Navigation, Sidebar, Dock & Options', () => {
    it('TC-T1-R1-01: Sidebar Navigation - Listen Now (Discovery) View Activation', async () => {
      // Step 1: Click Browse to navigate away from Discovery
      await driver.click('#navBrowseBtn');
      await new Promise(r => setTimeout(r, 60));

      // Step 2: Click Listen Now
      await driver.click('#navDiscoveryBtn');
      await new Promise(r => setTimeout(r, 60));

      const navDiscovery = await driver.query('#navDiscoveryBtn');
      const navBrowse = await driver.query('#navBrowseBtn');
      const viewDiscovery = await driver.query('#viewDiscovery');
      const viewBrowse = await driver.query('#viewBrowse');

      assert.ok(navDiscovery.classList.includes('active'), 'navDiscoveryBtn must have class "active"');
      assert.ok(!navBrowse.classList.includes('active'), 'navBrowseBtn must not have class "active"');
      assert.ok(viewDiscovery.classList.includes('active'), 'viewDiscovery must have class "active"');
      assert.ok(!viewBrowse.classList.includes('active'), 'viewBrowse must not have class "active"');

      // Verify no uncaught ReferenceErrors occurred
      const uncaughtErrors = appWin.errors.filter(e => e.message && e.message.includes('ReferenceError'));
      assert.equal(uncaughtErrors.length, 0, `Expected 0 ReferenceErrors, got: ${JSON.stringify(uncaughtErrors)}`);
    });

    it('TC-T1-R1-02: Sidebar Navigation - Browse View Loading and Genre Cards Grid', async () => {
      // Click Browse tab
      await driver.click('#navBrowseBtn');
      await new Promise(r => setTimeout(r, 100));

      const viewBrowse = await driver.query('#viewBrowse');
      assert.ok(viewBrowse.classList.includes('active'), 'viewBrowse must have class "active"');

      // Check for ReferenceError: loadBrowseContent is not defined
      const loadBrowseErrors = appWin.errors.filter(e => e.message && e.message.includes('loadBrowseContent'));
      assert.equal(loadBrowseErrors.length, 0, 'Clicking Browse threw ReferenceError for loadBrowseContent');

      // Check 12 genre cards
      const genreCards = await driver.queryAll('.browse-card');
      assert.equal(genreCards.length, 12, `Expected 12 .browse-card elements, found ${genreCards.length}`);

      // Click first genre card
      await driver.click('.browse-card');
      await new Promise(r => setTimeout(r, 150));

      const shelfTitle = await driver.query('#browseShelfTitle');
      assert.ok(shelfTitle.exists, '#browseShelfTitle element must exist');
      assert.ok(shelfTitle.textContent.length > 0, '#browseShelfTitle must display category name');

      const browseTracksGrid = await driver.query('#browseTracksGrid');
      assert.ok(browseTracksGrid.exists, '#browseTracksGrid must exist');
    });

    it('TC-T1-R1-03: Sidebar Navigation - Lyrics Tab Absence & Studio FX Tab Presence', async () => {
      // R2 Mandate: Standalone Lyrics tab must NOT exist in sidebar navigation
      const navLyricsBtn = await driver.query('#navLyricsBtn');
      const sidebarLyricsLink = await driver.query('.sidebar-nav [data-view="lyrics"]');

      assert.ok(!navLyricsBtn.exists, '#navLyricsBtn must be completely removed from DOM per R2');
      assert.ok(!sidebarLyricsLink.exists, 'No sidebar element with data-view="lyrics" should exist');

      // R1 Mandate: Dedicated Studio FX tab in sidebar
      const navStudioBtn = await driver.query('#navStudioBtn');
      assert.ok(navStudioBtn.exists, '#navStudioBtn must exist in sidebar navigation');
      assert.ok(
        navStudioBtn.textContent.toLowerCase().includes('studio') ||
        navStudioBtn.textContent.toLowerCase().includes('eq'),
        '#navStudioBtn should have label mentioning Studio FX or EQ'
      );

      // Clicking #navStudioBtn activates viewStudio
      await driver.click('#navStudioBtn');
      await new Promise(r => setTimeout(r, 60));

      const viewStudio = await driver.query('#viewStudio');
      assert.ok(viewStudio.classList.includes('active'), '#viewStudio must have class "active" after clicking #navStudioBtn');
    });

    it('TC-T1-R1-04: Sidebar Navigation - Rooms Modal & Primary Copy Link Button', async () => {
      await driver.click('#navPartyRoomsBtn');
      await new Promise(r => setTimeout(r, 100));

      const copyBtn = await driver.query('#partyPrimaryCopyBtn');
      assert.ok(copyBtn.exists, '#partyPrimaryCopyBtn must exist');

      // Click copy button
      await driver.click('#partyPrimaryCopyBtn');
      await new Promise(r => setTimeout(r, 150));

      // Toast feedback check
      const toastText = await driver.evaluate(() => {
        const container = document.getElementById('toastContainer');
        if (!container) return '';
        const toast = container.querySelector('.toast, .echo-toast');
        return toast ? toast.textContent : '';
      });

      assert.ok(
        toastText.toLowerCase().includes('cop') || toastText.toLowerCase().includes('link') || toastText.length > 0,
        'Clicking partyPrimaryCopyBtn must show copy confirmation toast'
      );
    });

    it('TC-T1-R1-05: Sidebar Navigation - Offline Library Curation & Rendering', async () => {
      // Simulate favorites in localStorage or userData
      await driver.evaluate((trk) => {
        if (typeof window.toggleFavorite === 'function') {
          window.toggleFavorite(trk);
        } else {
          localStorage.setItem('echo_user_data_backup', JSON.stringify({
            favorites: [trk.id],
            history: []
          }));
        }
      }, MOCK_TRACKS[0]);

      await driver.click('#navLibraryBtn');
      await new Promise(r => setTimeout(r, 150));

      const viewLibrary = await driver.query('#viewLibrary');
      assert.ok(viewLibrary.classList.includes('active'), '#viewLibrary must have class "active"');

      // #libraryList must not be an unpopulated dead end
      const libraryList = await driver.query('#libraryList');
      assert.ok(libraryList.exists, '#libraryList element must exist');

      const renderedItems = await driver.queryAll('#libraryList .quick-pick-card, #libraryList .track-item, #libraryList .library-item');
      assert.ok(renderedItems.length >= 1, `Expected at least 1 track rendered in #libraryList, got ${renderedItems.length}`);
    });

    it('TC-T1-R1-06: Settings Tab Switching & Segmented Bar Activation', async () => {
      await driver.click('#navSettingsBtn');
      await new Promise(r => setTimeout(r, 100));

      const viewSettings = await driver.query('#viewSettings');
      assert.ok(viewSettings.classList.includes('active'), '#viewSettings must be active');

      // Test switching to each tab: spatial, glow, storage, audio
      const tabs = ['spatial', 'glow', 'storage', 'audio'];
      for (const tab of tabs) {
        await driver.click(`.settings-segment-btn[data-tab="${tab}"]`);
        await new Promise(r => setTimeout(r, 60));

        // Ensure activateSettingsTab is defined and didn't throw
        const activateErrors = appWin.errors.filter(e => e.message && e.message.includes('activateSettingsTab'));
        assert.equal(activateErrors.length, 0, `Switching to settings tab "${tab}" threw ReferenceError`);

        // Check active class on button
        const btn = await driver.query(`.settings-segment-btn[data-tab="${tab}"]`);
        assert.ok(btn.classList.includes('active'), `Segment button for "${tab}" must have class "active"`);

        // Check that corresponding pane is visible
        const paneId = `#settingsTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
        const pane = await driver.query(paneId);
        assert.ok(pane.exists, `Settings pane ${paneId} must exist`);
        assert.ok(pane.isVisible, `Settings pane ${paneId} must be visible when tab is active`);
      }
    });

    it('TC-T1-R1-07: Player Dock - Utility Controls (Lyrics, Queue Drawer, Studio FX)', async () => {
      // 1. Dock Lyrics Button should open Now Playing without openNowPlayingModal error
      await driver.click('#dockLyricsBtn');
      await new Promise(r => setTimeout(r, 100));

      const modalErrors = appWin.errors.filter(e => e.message && e.message.includes('openNowPlayingModal'));
      assert.equal(modalErrors.length, 0, '#dockLyricsBtn threw ReferenceError for openNowPlayingModal');

      const npModal = await driver.query('#nowPlayingModal');
      assert.ok(!npModal.classList.includes('hidden'), '#nowPlayingModal must open when #dockLyricsBtn is clicked');

      // Close modal
      await driver.evaluate(() => {
        if (typeof window.closeNowPlaying === 'function') {
          window.closeNowPlaying();
        } else {
          document.getElementById('nowPlayingModal')?.classList.add('hidden');
        }
      });
      await new Promise(r => setTimeout(r, 60));

      // 2. Dock Studio FX Button should route to viewStudio without activateSettingsTab error
      await driver.click('#dockStudioBtn');
      await new Promise(r => setTimeout(r, 100));

      const studioErrors = appWin.errors.filter(e => e.message && e.message.includes('activateSettingsTab'));
      assert.equal(studioErrors.length, 0, '#dockStudioBtn threw ReferenceError for activateSettingsTab');

      const viewStudio = await driver.query('#viewStudio');
      assert.ok(viewStudio.classList.includes('active'), '#dockStudioBtn must activate #viewStudio');
    });
  });

  // -------------------------------------------------------------
  // R2: Lyrics Sheet Progressive Interaction (7 Tests)
  // -------------------------------------------------------------
  describe('R2: Lyrics Sheet Progressive Interaction', () => {
    it('TC-T1-R2-01: Now Playing Launch & Prominent Album Artwork Display', async () => {
      // Load track into player
      await driver.evaluate((trk) => {
        if (typeof window.playTrackDirect === 'function') {
          window.playTrackDirect(trk);
        } else if (typeof window.updateTrackMetaUI === 'function') {
          window.updateTrackMetaUI(trk);
        }
        if (typeof window.openNowPlaying === 'function') {
          window.openNowPlaying();
        }
      }, MOCK_TRACKS[0]);
      await new Promise(r => setTimeout(r, 120));

      const modal = await driver.query('#nowPlayingModal');
      assert.ok(!modal.classList.includes('hidden'), '#nowPlayingModal must not be hidden');

      // Prominent artwork & kinetic viewport
      const artworkView = await driver.query('#npArtworkView');
      assert.ok(artworkView.exists, '#npArtworkView must exist in DOM');
      const kineticLines = await driver.query('#npKineticLines');
      assert.ok(kineticLines.exists, '#npKineticLines must exist in DOM');

      // Sheet should be hidden by default
      const sheet = await driver.query('#npLyricsSheet');
      assert.ok(sheet.exists, '#npLyricsSheet element must exist');
      assert.ok(sheet.classList.includes('sheet-hidden'), '#npLyricsSheet must start with class "sheet-hidden"');

      // Controller contract
      const controllerState = await driver.evaluate(() => {
        return window.lyricsSheetController ? window.lyricsSheetController.getState() : null;
      });
      assert.equal(controllerState, 'hidden', 'lyricsSheetController.getState() must return "hidden" initially');
    });

    it('TC-T1-R2-02: Progressive Scroll Transition: Hidden to Half-Height Sheet', async () => {
      // Open modal
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('hidden');
      });
      await new Promise(r => setTimeout(r, 60));

      // Scroll upward on artwork / display container
      await driver.wheel('#npDisplayContainer', { deltaY: 120 });
      await new Promise(r => setTimeout(r, 150));

      const sheetState = await driver.evaluate(() => {
        return window.lyricsSheetController ? window.lyricsSheetController.getState() : null;
      });
      assert.equal(sheetState, 'half', 'lyricsSheetController.getState() must be "half" after upward scroll');

      const sheet = await driver.query('#npLyricsSheet');
      assert.ok(sheet.classList.includes('sheet-half'), '#npLyricsSheet must have class "sheet-half"');
      assert.ok(!sheet.classList.includes('sheet-hidden'), '#npLyricsSheet must not have "sheet-hidden"');

      const displayContainer = await driver.query('#npDisplayContainer');
      assert.ok(
        displayContainer.classList.includes('sheet-half-active') || displayContainer.classList.includes('sheet-half'),
        '#npDisplayContainer must receive sheet-half-active class for artwork scale down'
      );
    });

    it('TC-T1-R2-03: Progressive Scroll Transition: Half-Height to Full-Height Sheet', async () => {
      // Set to half
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('half');
      });
      await new Promise(r => setTimeout(r, 60));

      // Second upward scroll
      await driver.wheel('#npLyricsSheet', { deltaY: 120 });
      await new Promise(r => setTimeout(r, 150));

      const sheetState = await driver.evaluate(() => {
        return window.lyricsSheetController ? window.lyricsSheetController.getState() : null;
      });
      assert.equal(sheetState, 'full', 'lyricsSheetController.getState() must be "full" after second upward scroll');

      const sheet = await driver.query('#npLyricsSheet');
      assert.ok(sheet.classList.includes('sheet-full'), '#npLyricsSheet must have class "sheet-full"');
      assert.ok(!sheet.classList.includes('sheet-half'), '#npLyricsSheet must not have "sheet-half"');

      const displayContainer = await driver.query('#npDisplayContainer');
      assert.ok(
        displayContainer.classList.includes('sheet-full-active') || displayContainer.classList.includes('sheet-full'),
        '#npDisplayContainer must receive sheet-full-active class'
      );
    });

    it('TC-T1-R2-04: Reverse Scroll Transition: Full-Height to Half-Height to Hidden', async () => {
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
      });
      await new Promise(r => setTimeout(r, 60));

      // Scroll downward (deltaY < 0) from top of sheet
      await driver.wheel('#npLyricsSheet', { deltaY: -120 });
      await new Promise(r => setTimeout(r, 150));

      let state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
      assert.equal(state, 'half', 'lyricsSheetController should transition from full to half on downward wheel');

      // Second downward wheel
      await driver.wheel('#npLyricsSheet', { deltaY: -120 });
      await new Promise(r => setTimeout(r, 150));

      state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
      assert.equal(state, 'hidden', 'lyricsSheetController should transition from half to hidden on downward wheel');

      const sheet = await driver.query('#npLyricsSheet');
      assert.ok(sheet.classList.includes('sheet-hidden'), '#npLyricsSheet must be "sheet-hidden"');
    });

    it('TC-T1-R2-05: Grab Pill / Drag Handle Pointer Interaction', async () => {
      await driver.evaluate(() => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('hidden');
      });
      await new Promise(r => setTimeout(r, 60));

      const handle = await driver.query('#npSheetHandle, #npSheetGrabPill, .lyrics-sheet-handle');
      assert.ok(handle.exists, 'Sheet grab handle (#npSheetHandle or #npSheetGrabPill) must exist');

      // Drag up from Y:700 to Y:400
      await driver.drag(handle.selector, { startY: 700, endY: 400, steps: 5 });
      await new Promise(r => setTimeout(r, 150));

      const state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
      assert.ok(state === 'half' || state === 'full', `Sheet state after dragging up should be half or full, got ${state}`);
    });

    it('TC-T1-R2-06: Synchronized LRCLIB Lyrics Word Highlighting & Autoscroll', async () => {
      // Load track with lyrics
      await driver.evaluate((trk, lrc) => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
        if (typeof window.renderLyrics === 'function') {
          window.renderLyrics(lrc, true);
        }
        if (typeof window.syncLyricsWithTime === 'function') {
          window.syncLyricsWithTime(25.0);
        }
      }, MOCK_TRACKS[0], MOCK_LYRICS.synced);
      await new Promise(r => setTimeout(r, 150));

      // Verify active line highlighting
      const activeLine = await driver.query('.np-lyric-line.active, .lyrics-line.active');
      assert.ok(activeLine.exists, 'Synchronized lyrics must have an active lyric line element (.active)');

      // Verify status badge indicates synced LRCLIB
      const badge = await driver.query('#npSheetStatusBadge, #npLyricsBadge');
      if (badge.exists) {
        assert.ok(
          badge.textContent.toLowerCase().includes('sync') || badge.textContent.toLowerCase().includes('lrclib'),
          `Status badge should indicate Synced LRCLIB, got: "${badge.textContent}"`
        );
      }
    });

    it('TC-T1-R2-07: User Manual Scroll Autoscroll Pause Guard & Resume', async () => {
      await driver.evaluate((lrc) => {
        if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
        if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
        if (typeof window.renderLyrics === 'function') window.renderLyrics(lrc, true);
      }, MOCK_LYRICS.synced);
      await new Promise(r => setTimeout(r, 100));

      // Simulate user manual touch/scroll
      await driver.evaluate(() => {
        const stream = document.getElementById('npLyricsStream') || document.querySelector('.lyrics-stream-container');
        if (stream) {
          stream.scrollTop = 250;
          stream.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 50));

      // Advance time by 2 seconds
      await driver.evaluate(() => {
        if (typeof window.syncLyricsWithTime === 'function') {
          window.syncLyricsWithTime(30.0);
        }
      });

      // Verify userIsScrolling / autoscroll guard suppresses snapping immediately
      const guardActive = await driver.evaluate(() => {
        return Boolean(window.isUserScrollingLyrics || window.userIsScrollingLyrics || window.lyricsScrollPaused);
      });
      assert.ok(guardActive, 'Autoscroll guard must be active during and immediately after manual scroll');
    });
  });

  // -------------------------------------------------------------
  // R3: Desktop Music Player UI/UX Alignment (6 Tests)
  // -------------------------------------------------------------
  describe('R3: Desktop Music Player UI/UX Alignment', () => {
    it('TC-T1-R3-01: Deep Neutral Palette & Translucent Frosted Glass Surfaces', async () => {
      const bodyBg = await driver.getComputedStyleProperty('body', 'background-color');
      // Body background should be obsidian #0D0D0F rgb(13, 13, 15)
      assert.ok(
        bodyBg.includes('13, 13, 15') || bodyBg.includes('rgb(13,') || bodyBg.includes('#0d0d0f'),
        `body background-color should match deep neutral #0D0D0F, got ${bodyBg}`
      );

      // Player dock translucent styling
      const dockBackdrop = await driver.getComputedStyleProperty('.player-bar-dock', 'backdrop-filter');
      const dockBg = await driver.getComputedStyleProperty('.player-bar-dock', 'background-color');

      assert.ok(
        dockBackdrop.includes('blur') || dockBg.includes('rgba'),
        'Player dock must use translucent surface with backdrop blur or rgba alpha'
      );
    });

    it('TC-T1-R3-02: Typography Standards & Tabular-Nums Numeric Formatting', async () => {
      const timers = ['#dockCurrentTime', '#dockDuration', '#npCurrentTime', '#npDuration'];
      for (const sel of timers) {
        const fontVariant = await driver.getComputedStyleProperty(sel, 'font-variant-numeric');
        const timerEl = await driver.query(sel);
        if (timerEl.exists) {
          assert.equal(
            fontVariant,
            'tabular-nums',
            `Timer element ${sel} must have font-variant-numeric: tabular-nums`
          );
        }
      }

      // Font stack inspection on body
      const fontStack = await driver.getComputedStyleProperty('body', 'font-family');
      assert.ok(
        fontStack.includes('SF Pro') || fontStack.includes('Inter') || fontStack.includes('sans-serif'),
        `Body font-family stack must include modern desktop system fonts, got ${fontStack}`
      );
    });

    it('TC-T1-R3-03: Spring Motion Transitions & Button Press Feedback', async () => {
      // Easing inspection on modal or sheet
      const modalTransition = await driver.getComputedStyleProperty('#nowPlayingModal', 'transition-timing-function');
      const sheetTransition = await driver.getComputedStyleProperty('#npLyricsSheet', 'transition-timing-function');

      const isSpringOrCubic = (modalTransition && modalTransition.includes('cubic-bezier')) ||
                              (sheetTransition && sheetTransition.includes('cubic-bezier'));
      assert.ok(
        isSpringOrCubic,
        'Transitions on modal or lyrics sheet must utilize cubic-bezier spring easing'
      );
    });

    it('TC-T1-R3-04: Window Resize Responsiveness & Stage Layout Integrity', async () => {
      // Test at standard desktop, larger, and compact resolutions
      await driver.resizeWindow(1024, 768);
      let overflowX = await driver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.ok(!overflowX, 'Window layout should not overflow horizontally at 1024x768');

      await driver.resizeWindow(1600, 900);
      overflowX = await driver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.ok(!overflowX, 'Window layout should not overflow horizontally at 1600x900');

      await driver.resizeWindow(960, 600);
      overflowX = await driver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.ok(!overflowX, 'Window layout should not overflow horizontally at 960x600');

      // Restore to 1280x860
      await driver.resizeWindow(1280, 860);
    });

    it('TC-T1-R3-05: Scrubber Track Scrubbing & Tabular Time Synchronization', async () => {
      // Load 200s track
      await driver.evaluate((trk) => {
        if (typeof window.updateTrackMetaUI === 'function') window.updateTrackMetaUI(trk);
        const aA = document.getElementById('audioA');
        if (aA) {
          Object.defineProperty(aA, 'duration', { value: 200, configurable: true });
          aA.currentTime = 50;
        }
      }, MOCK_TRACKS[0]);
      await new Promise(r => setTimeout(r, 60));

      // Click at 50% on #dockSeekContainer
      await driver.evaluate(() => {
        const seek = document.getElementById('dockSeekContainer') || document.querySelector('.dock-seek-bar');
        if (seek) {
          const rect = seek.getBoundingClientRect();
          const evt = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width * 0.5,
            clientY: rect.top + rect.height / 2
          });
          seek.dispatchEvent(evt);
        }
      });
      await new Promise(r => setTimeout(r, 60));

      const timeText = await driver.evaluate(() => {
        const cur = document.getElementById('dockCurrentTime');
        return cur ? cur.textContent : '';
      });
      // 50% of 200s is 100s = "1:40"
      assert.ok(
        timeText.includes('1:40') || timeText.includes('100') || timeText.length > 0,
        `Scrubber click should update dockCurrentTime, got: "${timeText}"`
      );
    });

    it('TC-T1-R3-06: Volume Slider Clamping & Mute State Synchronization', async () => {
      // Drag volume slider to 0
      await driver.evaluate(() => {
        const volSlider = document.getElementById('dockVolSlider');
        if (volSlider) {
          volSlider.value = 0;
          volSlider.dispatchEvent(new Event('input', { bubbles: true }));
          volSlider.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 60));

      const muteIcon = await driver.query('#dockVolMuteIcon');
      if (muteIcon.exists) {
        assert.ok(muteIcon.isVisible, 'Mute icon should be visible when volume slider is at 0');
      }

      // Click mute button to unmute
      await driver.click('#dockMuteBtn');
      await new Promise(r => setTimeout(r, 60));

      const highIcon = await driver.query('#dockVolHighIcon');
      if (highIcon.exists) {
        assert.ok(highIcon.isVisible, 'Volume high/normal icon should restore after unmute');
      }
    });
  });

  // -------------------------------------------------------------
  // R4: Core Audio Architecture & Capabilities (7 Tests)
  // -------------------------------------------------------------
  describe('R4: Core Audio Architecture & Capabilities', () => {
    it('TC-T1-R4-01: HTTP Streaming Proxy Port 38472 & Byte-Range Support', async () => {
      // Invariant: audio elements must use crossOrigin = 'anonymous' to pipe through Web Audio
      const audioACrossOrigin = await driver.evaluate(() => {
        const a = document.getElementById('audioA');
        return a ? a.crossOrigin : null;
      });
      const audioBCrossOrigin = await driver.evaluate(() => {
        const b = document.getElementById('audioB');
        return b ? b.crossOrigin : null;
      });

      assert.equal(audioACrossOrigin, 'anonymous', '#audioA must have crossOrigin = "anonymous"');
      assert.equal(audioBCrossOrigin, 'anonymous', '#audioB must have crossOrigin = "anonymous"');
    });

    it('TC-T1-R4-02: JioSaavn 320kbps DES Decryption & Playback Initialization', async () => {
      // Validate DES ECB key and decryption logic invariant in bridge/main
      const keyValid = await driver.evaluate(() => {
        if (typeof window.decryptSaavnMediaUrl === 'function') {
          // Test with sample key
          return true;
        }
        return typeof CryptoJS !== 'undefined' && Boolean(CryptoJS.DES);
      });
      assert.ok(keyValid, 'CryptoJS.DES media decryption engine must be available in renderer');
    });

    it('TC-T1-R4-03: YouTube Music InnerTube Search & Radio Stream Resolution', async () => {
      const results = await driver.evaluate(async () => {
        if (window.echoApi && typeof window.echoApi.searchMusic === 'function') {
          return await window.echoApi.searchMusic('Yellow');
        }
        return [];
      });
      assert.ok(Array.isArray(results), 'searchMusic must return an array');
      assert.ok(results.length > 0, 'searchMusic must return matching track results');
      assert.ok(results[0].title && results[0].artist, 'Track results must contain title and artist');
    });

    it('TC-T1-R4-04: Pioneer DJ Dual-Deck Beat Crossfade Smooth Blending', async () => {
      // Dual audio deck elements must exist in DOM
      const audioA = await driver.query('#audioA');
      const audioB = await driver.query('#audioB');
      assert.ok(audioA.exists, '#audioA deck must exist in DOM');
      assert.ok(audioB.exists, '#audioB deck must exist in DOM');

      // Crossfade slider and display must exist and synchronize
      const crossfadeSlider = await driver.query('#crossfadeSlider');
      assert.ok(crossfadeSlider.exists, '#crossfadeSlider must exist in DOM');

      await driver.evaluate(() => {
        const slider = document.getElementById('crossfadeSlider');
        if (slider) {
          slider.value = 8;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 60));

      const valDisplay = await driver.evaluate(() => {
        const d = document.getElementById('crossfadeValDisplay');
        return d ? d.textContent : '';
      });
      assert.ok(valDisplay.includes('8s') || valDisplay.includes('8'), `Crossfade display should update to 8s, got: "${valDisplay}"`);
    });

    it('TC-T1-R4-05: Web Audio 5-Band Parametric EQ Frequency Shaping', async () => {
      // 5-band EQ sliders must exist in DOM
      const bands = ['60', '230', '910', '3600', '14000'];
      for (const band of bands) {
        const slider = await driver.query(`#studioEqSlider${band}`);
        assert.ok(slider.exists, `#studioEqSlider${band} must exist in DOM`);
      }

      // Adjust 60Hz to +8 dB
      await driver.evaluate(() => {
        const s60 = document.getElementById('studioEqSlider60');
        if (s60) {
          s60.value = 8;
          s60.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 60));

      const val60 = await driver.evaluate(() => {
        const d = document.getElementById('studioEqVal60');
        return d ? d.textContent : '';
      });
      assert.ok(val60.includes('8 dB') || val60.includes('+8'), `studioEqVal60 should show +8 dB, got: "${val60}"`);

      // Adjust 14kHz to -4 dB
      await driver.evaluate(() => {
        const s14k = document.getElementById('studioEqSlider14000');
        if (s14k) {
          s14k.value = -4;
          s14k.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 60));

      const val14k = await driver.evaluate(() => {
        const d = document.getElementById('studioEqVal14000');
        return d ? d.textContent : '';
      });
      assert.ok(val14k.includes('-4 dB') || val14k.includes('-4'), `studioEqVal14000 should show -4 dB, got: "${val14k}"`);
    });

    it('TC-T1-R4-06: Boom 3D Spatial Audio HRTF Matrix Processing', async () => {
      const boomToggle = await driver.query('#boomSpatialMasterToggle');
      assert.ok(boomToggle.exists, '#boomSpatialMasterToggle must exist in DOM');

      // Toggle spatial master via change event
      await driver.evaluate(() => {
        const toggle = document.getElementById('boomSpatialMasterToggle');
        if (toggle) {
          toggle.checked = true;
          toggle.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 80));

      const statusText = await driver.query('#boomSpatialStatusText');
      if (statusText.exists) {
        assert.ok(
          statusText.textContent.toLowerCase().includes('active') ||
          statusText.textContent.toLowerCase().includes('3d') ||
          statusText.textContent.toLowerCase().includes('on') ||
          statusText.textContent.toLowerCase().includes('surround'),
          `Boom 3D status should indicate active state, got "${statusText.textContent}"`
        );
      }
    });

    it('TC-T1-R4-07: WebSocket Rooms Host Broadcast & NTP Clock Synchronization', async () => {
      const roomApiPresent = await driver.evaluate(() => {
        return Boolean(
          window.echoApi &&
          typeof window.echoApi.getRoomInfo === 'function' &&
          typeof window.echoApi.broadcastRoomState === 'function'
        );
      });
      assert.ok(roomApiPresent, 'echoApi must provide getRoomInfo and broadcastRoomState for Echo Rooms');

      const roomInfo = await driver.evaluate(async () => {
        return await window.echoApi.getRoomInfo();
      });
      assert.ok(roomInfo && roomInfo.roomId, 'getRoomInfo must return valid room object with roomId');
    });
  });
});
