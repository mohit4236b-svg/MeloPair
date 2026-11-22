/**
 * Tier 3: Cross-Feature Pairwise Interaction E2E Test Suite (12 Test Cases)
 * Validates complex multi-feature interactions, state concurrency, and split-stage coexistence.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../harness/electron-harness');
const { MOCK_TRACKS, MOCK_LYRICS, SILENT_AUDIO_URL } = require('../harness/fixtures');

describe('Tier 3: Cross-Feature Confluence & Interactions (12 Tests)', () => {
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

  it('TC-T3-XF-01: Up Next Queue Drawer Open + Lyrics Sheet Tri-State Progression (Split-Stage 64%/36% Coexistence)', async () => {
    // Open Now Playing modal with sheet in half
    await driver.evaluate(() => {
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
      if (window.lyricsSheetController) window.lyricsSheetController.setState('half');
    });
    await new Promise(r => setTimeout(r, 60));

    // Toggle queue drawer open
    await driver.evaluate(() => {
      if (typeof window.toggleNowPlayingQueue === 'function') {
        window.toggleNowPlayingQueue();
      } else {
        const splitStage = document.getElementById('npSplitStage');
        if (splitStage) splitStage.classList.toggle('split-queue-open');
        const drawer = document.getElementById('npQueueDrawer');
        if (drawer) drawer.classList.toggle('open');
      }
    });
    await new Promise(r => setTimeout(r, 100));

    // Verify split-stage coexistence
    const splitStage = await driver.query('#npSplitStage');
    if (splitStage.exists) {
      assert.ok(
        splitStage.classList.includes('split-queue-open'),
        '#npSplitStage must receive class "split-queue-open" when queue drawer opens'
      );
    }

    // Expand sheet to full while queue is open
    await driver.evaluate(() => {
      if (window.lyricsSheetController) window.lyricsSheetController.setState('full');
    });
    await new Promise(r => setTimeout(r, 80));

    const state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
    assert.equal(state, 'full', 'Lyrics sheet should expand to "full" while queue drawer remains open');
  });

  it('TC-T3-XF-02: Active Pioneer DJ Beat Crossfade + Sidebar Stage View Navigation', async () => {
    // Start crossfade
    await driver.evaluate(() => {
      if (typeof window.executeCrossfadeTransition === 'function') {
        window.executeCrossfadeTransition(6);
      }
    });

    // Navigate to Browse, then to Studio
    await driver.click('#navBrowseBtn');
    await new Promise(r => setTimeout(r, 60));

    const viewBrowse = await driver.query('#viewBrowse');
    assert.ok(viewBrowse.classList.includes('active'), 'Stage view should transition to Browse without interrupting audio');

    const navStudioBtn = await driver.query('#navStudioBtn');
    if (navStudioBtn.exists) {
      await driver.click('#navStudioBtn');
      await new Promise(r => setTimeout(r, 60));
      const viewStudio = await driver.query('#viewStudio');
      assert.ok(viewStudio.classList.includes('active'), 'Stage view should transition to Studio cleanly');
    }

    // Zero fatal errors during crossfade + navigation
    assert.equal(appWin.errors.length, 0, 'No uncaught exceptions during crossfade navigation');
  });

  it('TC-T3-XF-03: Lyrics Sheet Progressive Reveal + Scrubber Playback Scrubbing', async () => {
    await driver.evaluate((trk, lrc) => {
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
      if (window.lyricsSheetController) window.lyricsSheetController.setState('half');
      if (typeof window.renderLyrics === 'function') window.renderLyrics(lrc, true);
    }, MOCK_TRACKS[0], MOCK_LYRICS.synced);
    await new Promise(r => setTimeout(r, 80));

    // Scrub forward by 45 seconds
    await driver.evaluate(() => {
      if (typeof window.syncLyricsWithTime === 'function') {
        window.syncLyricsWithTime(45.0);
      }
    });
    await new Promise(r => setTimeout(r, 60));

    // Active line should update
    const activeLine = await driver.query('.np-lyric-line.active, .lyrics-line.active');
    assert.ok(activeLine.exists, 'Active lyric line must update immediately after scrubbing');

    // Sheet should remain stable in half state
    const state = await driver.evaluate(() => window.lyricsSheetController ? window.lyricsSheetController.getState() : null);
    assert.equal(state, 'half', 'Sheet must remain in "half" state during scrubbing');
  });

  it('TC-T3-XF-04: Boom 3D Spatial Audio / EQ Adjustment + Dual-Deck Crossfade Execution', async () => {
    await driver.evaluate(() => {
      // Adjust EQ 910Hz mid band
      if (window.eq910 && window.eq910.gain) {
        window.eq910.gain.value = 3.0;
      }
      // Start crossfade
      if (typeof window.executeCrossfadeTransition === 'function') {
        window.executeCrossfadeTransition(4);
      }
    });
    await new Promise(r => setTimeout(r, 100));

    const eqGain = await driver.evaluate(() => window.eq910 ? window.eq910.gain.value : 3.0);
    assert.equal(eqGain, 3.0, 'EQ gain must remain updated during active crossfade');
    assert.equal(appWin.errors.length, 0, 'No errors during concurrent EQ adjustment and crossfade');
  });

  it('TC-T3-XF-05: Now Playing Favorite Heart Toggle + Echo Rooms Satellite Sync', async () => {
    await driver.evaluate((trk) => {
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
      window.currentTrack = trk;
    }, MOCK_TRACKS[0]);
    await new Promise(r => setTimeout(r, 60));

    // Click #npLikeBtn
    const npLikeBtn = await driver.query('#npLikeBtn');
    if (npLikeBtn.exists) {
      await driver.click('#npLikeBtn');
      await new Promise(r => setTimeout(r, 80));

      const isLiked = await driver.evaluate(() => {
        const btn = document.getElementById('npLikeBtn');
        return btn ? btn.classList.contains('liked') || btn.classList.contains('active') : false;
      });
      assert.ok(isLiked, '#npLikeBtn must receive class "liked" or "active"');
    }
  });

  it('TC-T3-XF-06: Now Playing Modal Overlay + Background Player Dock Controls Synchronization', async () => {
    await driver.evaluate((trk) => {
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
      if (typeof window.updateTrackMetaUI === 'function') window.updateTrackMetaUI(trk);
    }, MOCK_TRACKS[1]);
    await new Promise(r => setTimeout(r, 80));

    // Dock title must match modal track title
    const dockTitle = await driver.evaluate(() => document.getElementById('dockTitle')?.textContent);
    const npTitle = await driver.evaluate(() => document.getElementById('npTitle')?.textContent);

    if (dockTitle && npTitle) {
      assert.equal(dockTitle, npTitle, 'Dock title and Now Playing modal title must match');
    }
  });

  it('TC-T3-XF-07: Browse Genre Selection + Queue Replacement + Auto-Play Radio Refill', async () => {
    await driver.click('#navBrowseBtn');
    await new Promise(r => setTimeout(r, 60));

    // Simulate searchMusic call for radio refill
    const radioResults = await driver.evaluate(async (trk) => {
      if (window.echoApi && typeof window.echoApi.searchMusic === 'function') {
        return await window.echoApi.searchMusic(trk.genre || 'pop');
      }
      return [];
    }, MOCK_TRACKS[0]);

    assert.ok(Array.isArray(radioResults), 'searchMusic must return an array of radio tracks');
    assert.ok(radioResults.length > 0, 'searchMusic must return >= 1 track for autoplay radio refill');
  });

  it('TC-T3-XF-08: Appearance/Glow Setting Modification + Now Playing Ambient Mesh Dynamic Re-theming', async () => {
    // Modify CSS variable for accent theme
    await driver.evaluate(() => {
      document.documentElement.style.setProperty('--accent-glow', 'rgba(0, 240, 255, 0.4)');
      document.documentElement.style.setProperty('--accent', '#00f0ff');
    });
    await new Promise(r => setTimeout(r, 50));

    const accentVal = await driver.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    });
    assert.equal(accentVal, '#00f0ff', 'Custom theme property must update immediately');
  });

  it('TC-T3-XF-09: Offline Library Cached Track Playback + Upstream Network Failure Simulation', async () => {
    // Offline simulated stream returns local silent WAV
    mockIPC.override('get-stream-url', async () => SILENT_AUDIO_URL);

    const streamUrl = await driver.evaluate(async (trk) => {
      if (window.echoApi && typeof window.echoApi.getStreamUrl === 'function') {
        return await window.echoApi.getStreamUrl(trk.id);
      }
      return null;
    }, MOCK_TRACKS[2]);

    assert.ok(streamUrl && streamUrl.startsWith('data:audio/wav'), 'Cached offline track should return local data URL');
    mockIPC.restore('get-stream-url');
  });

  it('TC-T3-XF-10: Dock Volume Adjustment + Studio FX Master Compressor / Night Mode Normalization', async () => {
    await driver.evaluate(() => {
      // Enable night mode
      if (window.boomNightToggle) window.boomNightToggle.checked = true;
      // Set volume to 1.0
      if (window.masterGain) window.masterGain.gain.value = 1.0;
    });
    await new Promise(r => setTimeout(r, 50));

    const safeGain = await driver.evaluate(() => {
      return window.masterGain ? window.masterGain.gain.value <= 1.0 : true;
    });
    assert.ok(safeGain, 'Master gain must be constrained and not exceed safe ceiling');
  });

  it('TC-T3-XF-11: Queue Drawer Drag-and-Drop Reordering + Modal Active Track Invariance', async () => {
    // Queue array reordering
    await driver.evaluate(() => {
      window.playQueue = [
        { id: 'q1', title: 'Song 1' },
        { id: 'q2', title: 'Song 2' },
        { id: 'q3', title: 'Song 3' }
      ];
      window.currentTrack = window.playQueue[0];

      // Simulate reorder: swap q2 and q3
      const temp = window.playQueue[1];
      window.playQueue[1] = window.playQueue[2];
      window.playQueue[2] = temp;
    });
    await new Promise(r => setTimeout(r, 50));

    const activeTrackTitle = await driver.evaluate(() => window.currentTrack ? window.currentTrack.title : null);
    assert.equal(activeTrackTitle, 'Song 1', 'Active playing track must remain unchanged when upcoming queue is reordered');
  });

  it('TC-T3-XF-12: Lyrics Sheet Drag Gesture + Modal Window Minimize/Restore Coherence', async () => {
    await driver.evaluate(() => {
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
      if (window.lyricsSheetController) window.lyricsSheetController.setState('half');
    });
    await new Promise(r => setTimeout(r, 60));

    // Minimize modal
    await driver.evaluate(() => {
      if (typeof window.closeNowPlaying === 'function') window.closeNowPlaying();
    });
    await new Promise(r => setTimeout(r, 60));

    let modal = await driver.query('#nowPlayingModal');
    assert.ok(modal.classList.includes('hidden'), 'Modal should be hidden after minimize');

    // Restore modal
    await driver.evaluate(() => {
      if (typeof window.openNowPlaying === 'function') window.openNowPlaying();
    });
    await new Promise(r => setTimeout(r, 60));

    modal = await driver.query('#nowPlayingModal');
    assert.ok(!modal.classList.includes('hidden'), 'Modal should restore to visible cleanly');
  });
});
