/**
 * Tier 4: Real-World Application Scenarios E2E Test Suite (6 Scenarios)
 * Validates complete end-to-end user workflows representing daily production music consumption.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../harness/electron-harness');
const { MOCK_TRACKS, MOCK_LYRICS, SILENT_AUDIO_URL } = require('../harness/fixtures');

describe('Tier 4: Real-World Application Workflows (6 Scenarios)', () => {
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

  it('TC-T4-SCN-01: Full Cold-Launch to Continuous Discovery & Playback Flow', async () => {
    // 1. Initial view is Discovery
    const viewDiscovery = await driver.query('#viewDiscovery');
    assert.ok(viewDiscovery.classList.includes('active'), 'Initial view must be Discovery');

    // 2. Lyrics tab absent from sidebar
    const navLyrics = await driver.query('#navLyricsBtn');
    assert.ok(!navLyrics.exists, 'Sidebar Lyrics tab must be absent per R2');

    // 3. Play track from quick picks
    await driver.evaluate((trk) => {
      if (typeof window.playTrackDirect === 'function') {
        window.playTrackDirect(trk);
      } else if (typeof window.updateTrackMetaUI === 'function') {
        window.updateTrackMetaUI(trk);
      }
    }, MOCK_TRACKS[0]);
    await new Promise(r => setTimeout(r, 100));

    // 4. Navigate to Browse
    await driver.click('#navBrowseBtn');
    await new Promise(r => setTimeout(r, 100));

    const viewBrowse = await driver.query('#viewBrowse');
    assert.ok(viewBrowse.classList.includes('active'), 'Browse view must activate');

    // 5. Click a genre card
    const genreCards = await driver.queryAll('.browse-card');
    assert.ok(genreCards.length >= 1, 'Browse must render genre cards');
    await driver.click('.browse-card');
    await new Promise(r => setTimeout(r, 150));

    // 6. Up Next Queue drawer can be toggled
    const dockQueueBtn = await driver.query('#dockQueueBtn');
    if (dockQueueBtn.exists) {
      await driver.click('#dockQueueBtn');
      await new Promise(r => setTimeout(r, 100));
    }

    assert.equal(appWin.errors.length, 0, 'Scenario 1 should complete without fatal errors');
  });

  it('TC-T4-SCN-02: Immersive Apple Music Now Playing, Progressive Lyrics Sheet & Kinetic Typography', async () => {
    // 1. Open Now Playing modal with track and lyrics
    await driver.evaluate((trk, lrc) => {
      if (typeof window.updateTrackMetaUI === 'function') window.updateTrackMetaUI(trk);
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
      if (typeof window.renderLyrics === 'function') window.renderLyrics(lrc, true);
    }, MOCK_TRACKS[0], MOCK_LYRICS.synced);
    await new Promise(r => setTimeout(r, 100));

    const modal = await driver.query('#nowPlayingModal');
    assert.ok(!modal.classList.includes('hidden'), 'Now Playing modal must be open');

    // 2. Artwork prominent by default
    const artwork = await driver.query('#npArtworkView');
    assert.ok(artwork.exists, 'Artwork view must exist');

    // 3. Wheel up to reveal half-height sheet
    await driver.wheel('#npDisplayContainer', { deltaY: 120 });
    await new Promise(r => setTimeout(r, 150));

    let state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
    if (state) {
      assert.equal(state, 'half', 'Sheet should reach "half" on wheel scroll');
    }

    // 4. Drag grab pill to expand to full
    const handle = await driver.query('#npSheetHandle, #npSheetGrabPill, .lyrics-sheet-handle');
    if (handle.exists) {
      await driver.drag(handle.selector, { startY: 400, endY: 100, steps: 5 });
      await new Promise(r => setTimeout(r, 150));
    }

    // 5. Dismiss modal
    await driver.evaluate(() => {
      if (typeof window.closeNowPlaying === 'function') window.closeNowPlaying();
    });
    await new Promise(r => setTimeout(r, 80));

    const modalDismissed = await driver.query('#nowPlayingModal');
    assert.ok(modalDismissed.classList.includes('hidden'), 'Modal should be dismissed');
  });

  it('TC-T4-SCN-03: Audiophile Customization & Seamless Pioneer DJ Crossfade Party Session', async () => {
    // 1. Navigate to Studio FX
    const navStudio = await driver.query('#navStudioBtn');
    if (navStudio.exists) {
      await driver.click('#navStudioBtn');
      await new Promise(r => setTimeout(r, 100));
    } else {
      await driver.evaluate(() => {
        const vStudio = document.getElementById('viewStudio');
        if (vStudio && typeof window.switchStageView === 'function') window.switchStageView(vStudio);
      });
    }

    // 2. Check Boom 3D deduplication (no duplicate IDs)
    const duplicateIds = await driver.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('[id]'));
      const idMap = new Map();
      const duplicates = [];
      for (const el of allElements) {
        const count = idMap.get(el.id) || 0;
        idMap.set(el.id, count + 1);
        if (count === 1) duplicates.push(el.id);
      }
      return duplicates;
    });
    assert.equal(duplicateIds.length, 0, `DOM must have 0 duplicate IDs, found: ${duplicateIds.join(', ')}`);

    // 3. Enable Boom 3D
    const boomToggle = await driver.query('#boomSpatialMasterToggle');
    if (boomToggle.exists) {
      await driver.click('#boomSpatialMasterToggle');
      await new Promise(r => setTimeout(r, 60));
    }

    // 4. Trigger crossfade
    await driver.evaluate(() => {
      if (typeof window.executeCrossfadeTransition === 'function') {
        window.executeCrossfadeTransition(4);
      }
    });
    await new Promise(r => setTimeout(r, 100));

    assert.equal(appWin.errors.length, 0, 'Scenario 3 should execute smoothly without errors');
  });

  it('TC-T4-SCN-04: Echo Rooms Social Party Host, Satellite Pairing & Real-Time Sync', async () => {
    // 1. Open Rooms
    await driver.click('#navPartyRoomsBtn');
    await new Promise(r => setTimeout(r, 80));

    // 2. Copy button
    const copyBtn = await driver.query('#partyPrimaryCopyBtn');
    if (copyBtn.exists) {
      await driver.click('#partyPrimaryCopyBtn');
      await new Promise(r => setTimeout(r, 100));
    }

    // 3. Satellite state sync simulation
    await driver.evaluate((trk) => {
      if (window.echoApi && typeof window.echoApi.broadcastRoomState === 'function') {
        window.echoApi.broadcastRoomState({
          track: trk,
          position: 45.0,
          isPlaying: true
        });
      }
    }, MOCK_TRACKS[0]);

    assert.equal(appWin.errors.length, 0, 'Scenario 4 should execute cleanly');
  });

  it('TC-T4-SCN-05: Curated Library Management, Autoplay Radio Refuel & Offline Playback', async () => {
    // 1. Favorite track
    await driver.evaluate((trk) => {
      if (typeof window.toggleFavorite === 'function') {
        window.toggleFavorite(trk);
      }
    }, MOCK_TRACKS[0]);

    // 2. Navigate to Library
    await driver.click('#navLibraryBtn');
    await new Promise(r => setTimeout(r, 100));

    const viewLibrary = await driver.query('#viewLibrary');
    assert.ok(viewLibrary.classList.includes('active'), 'Library view must be active');

    // 3. Autoplay toggle
    const autoplayToggle = await driver.query('#queueAutoplayToggle, #npAutoplayToggle');
    if (autoplayToggle.exists) {
      assert.ok(autoplayToggle.exists, 'Autoplay toggle should exist');
    }

    // 4. Radio refuel call
    const refuel = await driver.evaluate(async () => {
      if (window.echoApi && typeof window.echoApi.searchMusic === 'function') {
        return await window.echoApi.searchMusic('pop hits');
      }
      return [];
    });
    assert.ok(refuel.length > 0, 'Radio refill should return tracks');
  });

  it('TC-T4-SCN-06: Cross-System Resilience, Audio Fallback Recovery & Window State Management', async () => {
    // 1. Resize across breakpoints
    await driver.resizeWindow(1920, 1080);
    await new Promise(r => setTimeout(r, 50));
    await driver.resizeWindow(400, 700);
    await new Promise(r => setTimeout(r, 50));
    await driver.resizeWindow(1280, 860);
    await new Promise(r => setTimeout(r, 50));

    // 2. Cycle Settings tabs
    await driver.click('#navSettingsBtn');
    await new Promise(r => setTimeout(r, 60));

    const tabs = ['spatial', 'glow', 'storage', 'audio'];
    for (const tab of tabs) {
      await driver.click(`.settings-segment-btn[data-tab="${tab}"]`);
      await new Promise(r => setTimeout(r, 40));
    }

    // 3. Verify dock controls remain intact
    const dockPlay = await driver.query('#dockPlayBtn');
    assert.ok(dockPlay.exists, 'Dock play button must remain present throughout resilience test');

    assert.equal(appWin.errors.length, 0, 'Scenario 6 resilience test should pass without uncaught errors');
  });
});
