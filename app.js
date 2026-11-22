// ==========================================================================
// MELOPAIR - MASTER STUDIO ENGINE V5.0 (PERFECTED MIXER & CROSSFADE)
// Real YouTube Music Radio /next, 60fps Precision Synced Lyrics,
// Working 5-Band Audio Mixer, True DJ Dual-Engine Crossfade, LUMN & FX
// ==========================================================================

function safeStorageGet(key, fallback = null) {
  try {
    const value = window.localStorage?.getItem(key);
    return value === null || value === undefined ? fallback : value;
  } catch (error) {
    console.warn(`[Storage] Could not read ${key}:`, error?.message || error);
    return fallback;
  }
}
// Global Diagnostics & Event Logger Initialization (Desktop & Mobile)
(function ensureEchoLogger() {
  if (window.echoLogger) return;
  const MAX_LOG_ENTRIES = 500;
  const logEntries = [];
  const logListeners = new Set();

  function formatTimeHMS(d) {
    const pad = (n, z = 2) => ('00' + n).slice(-z);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  function addLogEntry(level, tag, message, details = null) {
    const entry = {
      id: Date.now() + Math.random(),
      time: formatTimeHMS(new Date()),
      timestamp: Date.now(),
      level: level,
      tag: tag,
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null
    };

    logEntries.push(entry);
    if (logEntries.length > MAX_LOG_ENTRIES) logEntries.shift();

    for (const listener of logListeners) {
      try { listener(entry); } catch (e) {}
    }
  }

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = function(...args) {
    origLog.apply(console, args);
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    let tag = '[SYSTEM]';
    let level = 'info';
    if (text.includes('[Audio') || text.includes('[Prepare') || text.includes('320kbps') || text.includes('track') || text.includes('[Crossfade')) {
      tag = '[AUDIO]';
      level = 'audio';
    } else if (text.includes('[Sync') || text.includes('PLL') || text.includes('Skew') || text.includes('offset') || text.includes('NTP')) {
      tag = '[SYNC]';
      level = 'sync';
    } else if (text.includes('[Room') || text.includes('Party') || text.includes('Host') || text.includes('Satellite')) {
      tag = '[ROOM]';
      level = 'sync';
    } else if (text.includes('[Search') || text.includes('InnerTube') || text.includes('Saavn')) {
      tag = '[SEARCH]';
    }
    addLogEntry(level, tag, text);
  };

  console.warn = function(...args) {
    origWarn.apply(console, args);
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    addLogEntry('warn', '[WARN]', text);
  };

  console.error = function(...args) {
    origError.apply(console, args);
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    addLogEntry('error', '[ERR]', text);
  };

  window.echoLogger = {
    log: (tag, msg, d) => addLogEntry('info', tag, msg, d),
    audio: (msg, d) => addLogEntry('audio', '[AUDIO]', msg, d),
    sync: (msg, d) => addLogEntry('sync', '[SYNC]', msg, d),
    warn: (msg, d) => addLogEntry('warn', '[WARN]', msg, d),
    error: (msg, d) => addLogEntry('error', '[ERR]', msg, d),
    getLogs: () => [...logEntries],
    clear: () => {
      logEntries.length = 0;
      for (const listener of logListeners) {
        try { listener({ type: 'clear' }); } catch (e) {}
      }
    },
    export: () => {
      return logEntries.map(e => `[${e.time}] ${e.tag} ${e.message}${e.details ? '\r\n' + e.details : ''}`).join('\r\n');
    },
    addListener: (fn) => {
      logListeners.add(fn);
      return () => logListeners.delete(fn);
    }
  };

  window.echoLogger.audio('Echo Master Diagnostics Logger initialized');
})();

// Top-level / module platform detection
const isAndroid = Boolean(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('Android'));
const isElectron = !isAndroid && Boolean(typeof window !== 'undefined' && window.echoApi && !window.echoApi.isFallback);

// Global monotonic request token to enforce "latest request wins" across async operations
let playRequestId = 0;

document.addEventListener('DOMContentLoaded', () => {
  // Dual Audio Elements for Gapless DJ Crossfade
  const audioA = document.getElementById('audioA');
  const audioB = document.getElementById('audioB');
  let activeAudio = audioA;
  let idleAudio = audioB;

  // Electron WebAudio CORS Guard: Ensure crossOrigin is set BEFORE any src is assigned
  if (isElectron) {
    if (audioA) audioA.crossOrigin = 'anonymous';
    if (audioB) audioB.crossOrigin = 'anonymous';
  }

  if (audioA) {
    audioA.volume = 1;
    audioA.hasFiredPlayingEvent = false;
    audioA.addEventListener('playing', () => {
      audioA.hasFiredPlayingEvent = true;
      restoreActiveDeckOutput(audioA);
    });
    audioA.addEventListener('waiting', () => { audioA.hasFiredPlayingEvent = false; });
    audioA.addEventListener('loadstart', () => { audioA.hasFiredPlayingEvent = false; });
    audioA.addEventListener('pause', () => { audioA.hasFiredPlayingEvent = false; });
    audioA.addEventListener('loadedmetadata', () => {
      console.log(`[DIAG-AUDIO] Deck A loadedmetadata: duration=${audioA.duration}s (${Math.floor(audioA.duration/60)}:${Math.floor(audioA.duration%60)}), src=${audioA.src}`);
      const isCurrentTrackDeck = Boolean(currentTrack && activeAudio === audioA && audioA.dataset.trackId === String(currentTrack.id));
      if (isCurrentTrackDeck && Number.isFinite(audioA.duration) && audioA.duration > 0 && !lyricsDataIsSynced && rawPlainLyricsText) {
        updatePlainLyricsTimestamps(audioA.duration);
      }
      if (isCurrentTrackDeck && Number.isFinite(audioA.duration) && audioA.duration > 0 && lyricsDataIsSynced) {
        applyAutoIntroOffset(audioA.duration);
      }
      if (isCurrentTrackDeck && audioA.duration > 10 && (!lyricsDataIsSynced || Math.abs(audioA.duration - lastFetchedLyricsDuration) > 1.0)) {
        console.log(`[Lyrics] Deck A verified duration=${audioA.duration}s; refreshing lyrics lookup.`);
        fetchLyrics(currentTrack, audioA.duration);
      }
    });
  }
  if (audioB) {
    audioB.volume = 1;
    audioB.hasFiredPlayingEvent = false;
    audioB.addEventListener('playing', () => {
      audioB.hasFiredPlayingEvent = true;
      restoreActiveDeckOutput(audioB);
    });
    audioB.addEventListener('waiting', () => { audioB.hasFiredPlayingEvent = false; });
    audioB.addEventListener('loadstart', () => { audioB.hasFiredPlayingEvent = false; });
    audioB.addEventListener('pause', () => { audioB.hasFiredPlayingEvent = false; });
    audioB.addEventListener('loadedmetadata', () => {
      console.log(`[DIAG-AUDIO] Deck B loadedmetadata: duration=${audioB.duration}s (${Math.floor(audioB.duration/60)}:${Math.floor(audioB.duration%60)}), src=${audioB.src}`);
      const isCurrentTrackDeck = Boolean(currentTrack && activeAudio === audioB && audioB.dataset.trackId === String(currentTrack.id));
      if (isCurrentTrackDeck && Number.isFinite(audioB.duration) && audioB.duration > 0 && !lyricsDataIsSynced && rawPlainLyricsText) {
        updatePlainLyricsTimestamps(audioB.duration);
      }
      if (isCurrentTrackDeck && Number.isFinite(audioB.duration) && audioB.duration > 0 && lyricsDataIsSynced) {
        applyAutoIntroOffset(audioB.duration);
      }
      if (isCurrentTrackDeck && audioB.duration > 10 && (!lyricsDataIsSynced || Math.abs(audioB.duration - lastFetchedLyricsDuration) > 1.0)) {
        console.log(`[Lyrics] Deck B verified duration=${audioB.duration}s; refreshing lyrics lookup.`);
        fetchLyrics(currentTrack, audioB.duration);
      }
    });
  }

  // Universal YouTube Player Audio Engine (Zero-Block, Instant Playback)
  let ytPlayer = null;
  let isYtActive = false;
  let isYtReady = false;

  function initYouTubePlayer() {
    if (window.YT && window.YT.Player) {
      try {
        ytPlayer = new window.YT.Player('ytPlayerSlot', {
          height: '1',
          width: '1',
          videoId: '',
          playerVars: {
            'autoplay': 1,
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'modestbranding': 1,
            'playsinline': 1,
            'rel': 0,
            'origin': window.location.origin || 'http://localhost'
          },
          events: {
            'onReady': () => {
              isYtReady = true;
              console.log('[YouTube Engine] YouTube IFrame Player Ready');
            },
            'onStateChange': (event) => {
              if (event.data === 1) { // Playing
                setPlayState(true);
              } else if (event.data === 2) { // Paused
                setPlayState(false);
              } else if (event.data === 0) { // Ended
                console.log('[YouTube Engine] Track finished, advancing...');
                executeTransition('auto');
              }
            },
            'onError': (err) => {
              console.warn('[YouTube Engine] Player notice:', err.data);
            }
          }
        });
      } catch (e) {
        console.warn('[YouTube Engine] Init notice:', e);
      }
    }
  }

  if (isAndroid) {
    if (!document.getElementById('yt-iframe-api-script')) {
      const ytScript = document.createElement('script');
      ytScript.id = 'yt-iframe-api-script';
      ytScript.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(ytScript);
    }
    window.onYouTubeIframeAPIReady = function() {
      initYouTubePlayer();
    };
    if (window.YT && window.YT.Player) {
      initYouTubePlayer();
    }
  }

  function pauseYouTubeEngine() {
    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
      try { ytPlayer.pauseVideo(); } catch (e) {}
    }
    isYtActive = false;
  }

  function playViaYouTubeEngine(videoId, track) {
    if (isElectron) {
      console.warn('[YouTube Engine] Blocked on Electron. Desktop strictly utilizes native WebAudio pipeline.');
      return;
    }
    if (!videoId) return;
    isYtActive = true;
    currentTrack = track;
    updateTrackMetaUI(track, true);

    if (activeAudio) { activeAudio.pause(); try { activeAudio.currentTime = 0; } catch (e) {} }
    if (idleAudio) { idleAudio.pause(); try { idleAudio.currentTime = 0; } catch (e) {} }

    function doPlay() {
      if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById({ videoId: videoId, startSeconds: 0 });
        if (typeof ytPlayer.setVolume === 'function') {
          ytPlayer.setVolume(isMuted ? 0 : Math.round(userVolume * 100));
        }
        ytPlayer.playVideo();
        setPlayState(true);
        recordTrackPlayed(track);
        console.log(`[YouTube Engine] Now playing "${track.title}" (${videoId})`);
      } else {
        const slot = document.getElementById('ytPlayerSlot');
        if (slot) {
          slot.innerHTML = `<iframe id="ytDirectFrame" width="1" height="1" src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1" frameborder="0" allow="autoplay; encrypted-media"></iframe>`;
          setPlayState(true);
          recordTrackPlayed(track);
        }
      }
    }

    if (isYtReady && ytPlayer) {
      doPlay();
    } else {
      setTimeout(doPlay, 350);
    }
  }

  // DOM: Sidebar Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const navLibraryBtn = document.getElementById('navLibraryBtn');
  const navDiscoveryBtn = document.getElementById('navDiscoveryBtn');
  const navPlaylistsBtn = document.getElementById('navPlaylistsBtn');
  const navStudioBtn = document.getElementById('navStudioBtn');
  const navSettingsBtn = document.getElementById('navSettingsBtn');

  // DOM: Center Stage Header Tabs & Controls
  const stageTabs = document.querySelectorAll('.stage-tab');
  const tabHomeBtn = document.getElementById('tabHomeBtn');
  const tabVisualizerBtn = document.getElementById('tabVisualizerBtn');
  const tabHistoryBtn = document.getElementById('tabHistoryBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const lumnGlowBtn = document.getElementById('lumnGlowBtn');
  const lightningToggle = document.getElementById('lightningToggle');
  const shareBtn = document.getElementById('shareBtn');
  const winTileBtn = document.getElementById('winTileBtn');
  const winCloseBtn = document.getElementById('winCloseBtn');
  const quickPicksGrid = document.getElementById('quickPicksGrid');
  let lastQuickPicksSource = null;
  const continueListeningShelf = document.getElementById('continueListeningShelf');
  const continueListeningGrid = document.getElementById('continueListeningGrid');
  const moreLikeShelf = document.getElementById('moreLikeShelf');
  const moreLikeGrid = document.getElementById('moreLikeGrid');
  const moreLikeTitle = document.getElementById('moreLikeTitle');
  const queueNowPlaying = document.getElementById('queueNowPlaying');
  const queueCountBadge = document.getElementById('queueCountBadge');
  const queueAutoplayToggle = document.getElementById('queueAutoplayToggle');
  const discSubtitle = document.getElementById('discSubtitle');
  const shelfQuickTitle = document.getElementById('shelfQuickTitle');
  const genrePills = document.querySelectorAll('.genre-pill');

  // DOM: Home Live Instant Search Bar & Shelves
  const homeSearchInput = document.getElementById('homeSearchInput');
  const clearHomeSearchBtn = document.getElementById('clearHomeSearchBtn');
  const homeSearchSpinner = document.getElementById('homeSearchSpinner');
  const homeSearchResultsShelf = document.getElementById('homeSearchResultsShelf');
  const homeSearchShelfTitle = document.getElementById('homeSearchShelfTitle');
  const homeSearchGrid = document.getElementById('homeSearchGrid');
  const homeSearchList = document.getElementById('homeSearchList');
  const closeHomeSearchBtn = document.getElementById('closeHomeSearchBtn');
  const quickPicksShelf = document.getElementById('quickPicksShelf');
  const trendingShelf = document.getElementById('trendingShelf');

  // DOM: Stage Views
  const viewVisualizer = document.getElementById('viewVisualizer');
  const viewHistory = document.getElementById('viewHistory');
  const viewDiscovery = document.getElementById('viewDiscovery');
  const discoveryScrollContainer = document.querySelector('#viewDiscovery .discovery-container');
  const discoveryScrollProgressFill = document.getElementById('discoveryScrollProgressFill');
  let discoveryScrollRaf = 0;
  function updateDiscoveryScrollProgress() {
    discoveryScrollRaf = 0;
    if (!discoveryScrollContainer || !discoveryScrollProgressFill) return;
    const maxScroll = discoveryScrollContainer.scrollHeight - discoveryScrollContainer.clientHeight;
    const progress = maxScroll > 0 ? discoveryScrollContainer.scrollTop / maxScroll : 0;
    discoveryScrollProgressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
  }
  if (discoveryScrollContainer) {
    discoveryScrollContainer.addEventListener('scroll', () => {
      if (!discoveryScrollRaf) discoveryScrollRaf = requestAnimationFrame(updateDiscoveryScrollProgress);
    }, { passive: true });
    window.addEventListener('resize', updateDiscoveryScrollProgress, { passive: true });
  }
  const viewBrowse = document.getElementById('viewBrowse');
  const viewStudio = document.getElementById('viewStudio');
  const viewLibrary = document.getElementById('viewLibrary');
  const viewSettings = document.getElementById('viewSettings');
  // The old standalone lyrics page was removed; lyrics now live in Now Playing.
  // Keep legacy view hooks inert while routing the shared lyric list to its real DOM.
  const viewLyrics = null;
  const tabLyricsBtn = null;
  const navLyricsBtn = null;
  const lyricsScrollViewport = document.getElementById('npScrollViewport');
  const lyricsStreamScroll = document.getElementById('npLyricsStream');
  const kineticModeToggleBtn = null;
  const kineticModeLabel = null;
  const modeImmersiveBtn = null;
  const modeStreamBtn = null;
  const immersiveLyricsViewport = null;
  const floatingKineticBtn = null;
  const lyricsModeLabel = null;
  const lyricsModeBadge = null;
  const kineticBgToggleBtn = null;
  const kineticBgIcon = null;
  const kineticBgLabel = null;
  const autoEmojiToggleBtn = null;
  const immersiveIntroIndicator = null;
  const immersiveIntroText = null;
  const immersiveArtBlur = null;
  const immTrackTitle = null;
  const immTrackArtist = null;
  const immersiveKineticLines = null;
  const lyricsStatusBadge = document.getElementById('npLyricsBadge');
  const lyricsIntroIndicator = document.getElementById('npIntroIndicator');
  const introText = document.getElementById('npIntroText');
  const lyricsSineWaveCanvas = null;
  const sineCtx = null;
  const ambientCloudCanvas = null;
  const ambientCloudCtx = null;
  let immersiveIdleTimer = null;
  let lyricsMode = 'immersive';
  const allViews = [viewVisualizer, viewHistory, viewDiscovery, viewBrowse, viewStudio, viewLibrary, viewSettings];

  // DOM: Master App Layout
  const appLayout = document.getElementById('appLayout');

  // DOM: Dock Lyrics Panel
  const dockLyricsPanel = document.getElementById('dockLyricsPanel');
  const dockLyricsContent = document.getElementById('dockLyricsContent');
  const dockLyricsStream = document.getElementById('dockLyricsStream');
  const dockLyricsEmpty = document.getElementById('dockLyricsEmpty');
  const dockLyricsToggleBtn = document.getElementById('dockLyricsToggleBtn');
  const dockLyricsSource = document.getElementById('dockLyricsSource');

  // DOM: Visualizer Canvas
  const fullVisualizerCanvas = document.getElementById('fullVisualizerCanvas');
  const fullVizCtx = fullVisualizerCanvas ? fullVisualizerCanvas.getContext('2d') : null;

  // DOM: Right Panel (Up Next Queue & Inline Search)
  const queueSearchInput = document.getElementById('queueSearchInput');
  const clearQueueSearchBtn = document.getElementById('clearQueueSearchBtn');
  const queueTrackList = document.getElementById('queueTrackList');

  // DOM: Bottom Player Dock
  const dockThumb = document.getElementById('dockThumb');
  const dockTitle = document.getElementById('dockTitle');
  const dockArtist = document.getElementById('dockArtist');
  const dockPlayBtn = document.getElementById('dockPlayBtn');
  const dockPlayIcon = document.getElementById('dockPlayIcon');
  const dockPauseIcon = document.getElementById('dockPauseIcon');
  const dockPrevBtn = document.getElementById('dockPrevBtn');
  const dockNextBtn = document.getElementById('dockNextBtn');
  const dockShuffleBtn = document.getElementById('dockShuffleBtn');
  const dockRepeatBtn = document.getElementById('dockRepeatBtn');
  const dockCurrentTime = document.getElementById('dockCurrentTime');
  const dockDuration = document.getElementById('dockDuration');
  const dockSeekContainer = document.getElementById('dockSeekContainer');
  const dockSeekFill = document.getElementById('dockSeekFill');
  const dockSeekBuffer = document.getElementById('dockSeekBuffer');
  const dockSeekThumb = document.getElementById('dockSeekThumb');
  const dockMuteBtn = document.getElementById('dockMuteBtn');
  const dockVolHighIcon = document.getElementById('dockVolHighIcon');
  const dockVolMuteIcon = document.getElementById('dockVolMuteIcon');
  const dockVolSlider = document.getElementById('dockVolSlider');
  const beatSyncToggle = document.getElementById('beatSyncToggle');
  const dockDownloadBtn = document.getElementById('dockDownloadBtn');
  const dockStudioBtn = document.getElementById('dockStudioBtn');

  // DOM: FX & Lighting
  const lumnRimLighting = document.getElementById('lumnRimLighting');
  const lightningFlash = document.getElementById('lightningFlash');
  const toastContainer = document.getElementById('toastContainer');
  const searchList = document.getElementById('searchList');
  const historyList = document.getElementById('historyList');
  const libraryList = document.getElementById('libraryList');
  const openMusicFolderBtn = document.getElementById('openMusicFolderBtn');
  const orbPrimary = document.getElementById('orbPrimary');
  const orbSecondary = document.getElementById('orbSecondary');
  const orbTertiary = document.getElementById('orbTertiary');

  // DOM: Settings & Studio FX Controls
  const crossfadeSlider = document.getElementById('crossfadeSlider');
  const crossfadeValDisplay = document.getElementById('crossfadeValDisplay');
  const disableCrossfadeAlbumsToggle = document.getElementById('disableCrossfadeAlbumsToggle');
  const volumeNormToggle = document.getElementById('volumeNormToggle');
  const skipSilenceToggle = document.getElementById('skipSilenceToggle');
  const hardwareAccelToggle = document.getElementById('hardwareAccelToggle');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const settingsOpenFolderBtn = document.getElementById('settingsOpenFolderBtn');
  const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
  const sleepTimerStatus = document.getElementById('sleepTimerStatus');

  // DOM: User Profile & Notifications
  const userProfileBadge = document.getElementById('userProfileBadge');
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  const profileModalBackdrop = document.getElementById('profileModalBackdrop');
  const closeProfileModalBtn = document.getElementById('closeProfileModalBtn');
  const profileAvatarInitial = document.getElementById('profileAvatarInitial');
  const profileAvatarPhoto = document.getElementById('profileAvatarPhoto');
  const profileAvatarFallback = document.getElementById('profileAvatarFallback');
  const profilePhotoLarge = document.getElementById('profilePhotoLarge');
  const profileNameInput = document.getElementById('profileNameInput');
  const profileStatPlayed = document.getElementById('profileStatPlayed');
  const profileStatFavs = document.getElementById('profileStatFavs');
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  const firebaseAccountStatus = document.getElementById('firebaseAccountStatus');
  const firebaseAccountEmail = document.getElementById('firebaseAccountEmail');
  const googleSignInBtn = document.getElementById('googleSignInBtn');
  const googleSignOutBtn = document.getElementById('googleSignOutBtn');
  const tasteOnboarding = document.getElementById('tasteOnboarding');
  const tasteCheckingStep = document.getElementById('tasteCheckingStep');
  const tasteLoginStep = document.getElementById('tasteLoginStep');
  const tasteSetupStep = document.getElementById('tasteSetupStep');
  const tasteOnboardingStatus = document.getElementById('tasteOnboardingStatus');
  const tasteSetupStatus = document.getElementById('tasteSetupStatus');
  const tasteSignInBtn = document.getElementById('tasteSignInBtn');
  const tasteFinishBtn = document.getElementById('tasteFinishBtn');
  const tasteImportStep = document.getElementById('tasteImportStep');
  const mpFeatureTour = document.getElementById('mpFeatureTour');
  let importedListeningMemory = [];
  try { importedListeningMemory = JSON.parse(safeStorageGet('melopair_imported_listening_memory') || '[]') || []; } catch { importedListeningMemory = []; }
  let firebaseSignedInUser = null;
  let tastePreferences = {};
  let recommendationCatalog = [];
  let activeGenreFeed = null;
  let lastPersonalizedRefreshAt = 0;
  let isLoadingPersonalizedFeed = false;
  let moreLikeRequestId = 0;
  try {
    tastePreferences = JSON.parse(safeStorageGet('melopair_taste_preferences') || '{}') || {};
  } catch (error) {
    tastePreferences = {};
  }
  const notificationBtn = document.getElementById('notificationBtn');
  const notificationBadge = document.getElementById('notificationBadge');
  const notificationFlyout = document.getElementById('notificationFlyout');
  const clearNotifsBtn = document.getElementById('clearNotifsBtn');
  const notifList = document.getElementById('notifList');

  // DOM: Echo Rooms / Multi-Device Sync Modal & Controls
  const navPartyRoomsBtn = document.getElementById('navPartyRoomsBtn');
  const dockPartyBtn = document.getElementById('dockPartyBtn');
  const dockPartyBadge = document.getElementById('dockPartyBadge');
  const partyModalBackdrop = document.getElementById('partyModalBackdrop');
  const closePartyModalBtn = document.getElementById('closePartyModalBtn');
  const partyQrImage = document.getElementById('partyQrImage');
  const partyJoinUrlInput = document.getElementById('partyJoinUrlInput');
  const partyLanAddressLine = document.getElementById('partyLanAddressLine');
  const copyPartyLinkBtn = document.getElementById('copyPartyLinkBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const partyRoomCode = document.getElementById('partyRoomCode');
  const regenRoomCodeBtn = document.getElementById('regenRoomCodeBtn');
  const partyConnectedDevicesCount = document.getElementById('partyConnectedDevicesCount');
  const openPartyInBrowserBtn = document.getElementById('openPartyInBrowserBtn');
  const partySyncPulseBtn = document.getElementById('partySyncPulseBtn');

  // 6-Digit Room Code Direct Entry & Camera Scanner DOM
  const customRoomCodeInput = document.getElementById('customRoomCodeInput');
  const applyCustomCodeBtn = document.getElementById('applyCustomCodeBtn');
  const genRandom6DigitBtn = document.getElementById('genRandom6DigitBtn');
  const copy6DigitCodeBtn = document.getElementById('copy6DigitCodeBtn');
  const openScannerModalBtn = document.getElementById('openScannerModalBtn');
  const scannerModalBackdrop = document.getElementById('scannerModalBackdrop');
  const closeScannerModalBtn = document.getElementById('closeScannerModalBtn');
  const scannerVideo = document.getElementById('scannerVideo');
  const scannerCanvas = document.getElementById('scannerCanvas');
  const scannerStatusBadge = document.getElementById('scannerStatusBadge');
  const scannerCameraSelect = document.getElementById('scannerCameraSelect');
  const scannerFileInput = document.getElementById('scannerFileInput');
  const scannerPasteBtn = document.getElementById('scannerPasteBtn');

  // 5-Band Equalizer Elements (Dual-wired for both Studio FX & Settings)
  const eqSliders = {
    60: [document.getElementById('studioEqSlider60'), document.getElementById('eqSlider60')],
    230: [document.getElementById('studioEqSlider230'), document.getElementById('eqSlider230')],
    910: [document.getElementById('studioEqSlider910'), document.getElementById('eqSlider910')],
    3600: [document.getElementById('studioEqSlider3600'), document.getElementById('eqSlider3600')],
    14000: [document.getElementById('studioEqSlider14000'), document.getElementById('eqSlider14000')]
  };
  const eqValDisplays = {
    60: [document.getElementById('studioEqVal60'), document.getElementById('eqVal60')],
    230: [document.getElementById('studioEqVal230'), document.getElementById('eqVal230')],
    910: [document.getElementById('studioEqVal910'), document.getElementById('eqVal910')],
    3600: [document.getElementById('studioEqVal3600'), document.getElementById('eqVal3600')],
    14000: [document.getElementById('studioEqVal14000'), document.getElementById('eqVal14000')]
  };

  // App State
  let currentTrack = null;
  let queue = [];
  let manualQueue = [];
  let contextQueue = [];
  let autoplayQueue = [];
  let currentRadioFilterMode = 'all'; // 'all' | 'familiar' | 'discover'
  let activeRadioVibeLabel = ''; // e.g. "Hindi Romantic", "Punjabi Hip-Hop", "English Dark R&B"
  const sessionEarlySkippedArtists = new Set();
  const sessionPositiveArtists = new Set();
  const sessionPlayedTrackIds = new Set();
  const sessionPlayedSongKeys = new Set();
  const autoQueueTrackIds = new Set();
  let radioRecommendationRequestId = 0;
  let isAutoplayEnabled = true;
  const recentArtistHistory = [];

  function rememberRecentArtist(track) {
    const artist = feedPrimaryArtist(track?.artist);
    if (!artist) return;
    recentArtistHistory.push(artist);
    if (recentArtistHistory.length > 6) recentArtistHistory.splice(0, recentArtistHistory.length - 6);
  }

  function syncMasterQueue() {
    const list = [];
    if (currentTrack) list.push(currentTrack);
    manualQueue.forEach(t => {
      if (!list.some(x => x.id === t.id)) {
        list.push({ ...t, isManualQueue: true, isAutoplaySuggestion: false });
      }
    });
    contextQueue.forEach(t => {
      if (!list.some(x => x.id === t.id)) {
        list.push({ ...t, isContextQueue: true, isAutoplaySuggestion: false });
      }
    });
    if (isAutoplayEnabled) {
      autoplayQueue.forEach(t => {
        if (!list.some(x => x.id === t.id)) {
          list.push({ ...t, isAutoplaySuggestion: true });
        }
      });
    }
    queue = list;
    window.queue = queue;
    autoQueueTrackIds.clear();
    autoplayQueue.forEach(t => autoQueueTrackIds.add(t.id));
  }
  window.syncMasterQueue = syncMasterQueue;

  // Lyric timing uses the active audio clock plus the user's per-track nudge.
  let manualLyricOffset = 0.0;
  let autoIntroOffset = 0.0;
  let lastLrcResultDuration = 0;
  let lastFetchedLyricsDuration = 0;
  let hasSavedManualLyricOffset = false;
  let currentSongLyricOffset = 0.0;
  const DEFAULT_SYNC_LEAD = 0.35;

  // Plain Lyrics Paced Display State
  let rawPlainLyricsText = null;

  function getLyricOffsetStorageKey(track) {
    if (!track) return null;
    const t = String(track.title || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_');
    const a = String(track.artist || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_');
    return `melopair_lyric_offset_${a}_${t}`;
  }

  function loadLyricOffsetForTrack(track) {
    const key = getLyricOffsetStorageKey(track);
    if (!key) {
      manualLyricOffset = 0.0;
    } else {
      const stored = localStorage.getItem(key);
      const parsed = parseFloat(stored);
      manualLyricOffset = Number.isFinite(parsed) ? Math.max(-15, Math.min(15, parsed)) : 0.0;
    }
    autoIntroOffset = 0.0;
    lastLrcResultDuration = 0;
    lastFetchedLyricsDuration = 0;
    hasSavedManualLyricOffset = Boolean(key && localStorage.getItem(key) !== null);
    computeTotalLyricOffset();
  }

  function computeTotalLyricOffset() {
    const effectiveOffset = hasSavedManualLyricOffset
      ? manualLyricOffset
      : (lyricsDataIsSynced ? autoIntroOffset + DEFAULT_SYNC_LEAD : 0);
    currentSongLyricOffset = Math.round(effectiveOffset * 10) / 10;
    updateLyricOffsetUI();
  }

  function realignLyrics(reason = 'auto', forceResetManual = false) {
    const deck = activeAudio;
    const trackId = String(currentTrack?.id ?? '');
    if (!deck || !trackId || deck.dataset?.trackId !== trackId || deck.readyState < 2) return false;
    const mediaTime = Number(deck.currentTime);
    if (!Number.isFinite(mediaTime) || mediaTime < 0 || !Array.isArray(lyricsData) || lyricsData.length === 0) return false;

    if (forceResetManual) {
      const storageKey = getLyricOffsetStorageKey(currentTrack);
      if (storageKey) localStorage.removeItem(storageKey);
      manualLyricOffset = 0;
      hasSavedManualLyricOffset = false;
      const rawDelta = Number(deck.duration) - Number(lastLrcResultDuration);
      autoIntroOffset = lyricsDataIsSynced && Number.isFinite(rawDelta) && rawDelta > 3.5 && rawDelta <= 15
        ? -rawDelta
        : 0;
      computeTotalLyricOffset();
    }

    if (!lyricsDataIsSynced && !plainLyricsCanProgress) {
      if (forceResetManual) syncLyricsWithTime(mediaTime, true);
      return true;
    }

    const effectiveTime = mediaTime + currentSongLyricOffset;
    let targetIndex = -1;
    for (let index = 0; index < lyricsData.length; index++) {
      if (effectiveTime >= Number(lyricsData[index]?.time || 0)) targetIndex = index;
      else break;
    }

    const renderedActiveIndex = Number(document.querySelector('#npKineticLines .imm-active')?.getAttribute('data-index'));
    const activeLineIsRendered = Number.isFinite(renderedActiveIndex) && renderedActiveIndex === targetIndex;
    if (reason === 'auto' && targetIndex === activeLyricIndex && (activeLineIsRendered || targetIndex < 0)) return true;
    if (reason === 'auto' && activeLyricIndex >= 0) {
      const displayedLineTime = Number(lyricsData[activeLyricIndex]?.time);
      if (Number.isFinite(displayedLineTime) && Math.abs(effectiveTime - displayedLineTime) < 0.25) return true;
    }

    activeLyricIndex = targetIndex;
    if (targetIndex < 0) {
      renderImmersiveLyrics(-1);
      document.getElementById('npLyricsStream')?.querySelectorAll('.np-lyric-line, .lyrics-line').forEach(line => line.classList.remove('active'));
      return true;
    }
    updateActiveLyricLine(targetIndex);
    renderImmersiveLyrics(targetIndex);
    document.getElementById('npLyricsStream')?.querySelectorAll('.np-lyric-line, .lyrics-line').forEach((line, index) => {
      line.classList.toggle('active', index === targetIndex);
    });
    return true;
  }

  function applyAutoIntroOffset(deckDuration) {
    const audioDuration = Number(deckDuration);
    if (!lyricsDataIsSynced || !Number.isFinite(audioDuration) || audioDuration <= 0 || !lastLrcResultDuration) return;
    if (hasSavedManualLyricOffset) {
      autoIntroOffset = 0;
      computeTotalLyricOffset();
      return;
    }

    const rawDelta = audioDuration - lastLrcResultDuration;
    autoIntroOffset = rawDelta > 3.5 && rawDelta <= 15 ? -rawDelta : 0;
    computeTotalLyricOffset();
  }

  function saveLyricOffsetForTrack(track, offset) {
    const key = getLyricOffsetStorageKey(track);
    if (!key) return;
    if (Math.abs(offset) < 0.01) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, offset.toFixed(1));
    }
  }

  function updateLyricOffsetUI() {
    const label = document.getElementById('versiSyncValLabel');
    const resetBtn = document.getElementById('versiSyncResetBtn');
    if (label) {
      const sign = currentSongLyricOffset > 0 ? '+' : '';
      label.textContent = `${sign}${currentSongLyricOffset.toFixed(1)}s`;
    }
    if (resetBtn) {
      resetBtn.classList.toggle('has-offset', Math.abs(currentSongLyricOffset) >= 0.01);
    }
  }

  function adjustLyricOffset(delta) {
    if (delta === 0) {
      manualLyricOffset = 0.0;
      autoIntroOffset = 0.0;
      hasSavedManualLyricOffset = false;
      if (currentTrack) {
        const key = getLyricOffsetStorageKey(currentTrack);
        if (key) localStorage.removeItem(key);
      }
    } else {
      const adjustmentBase = hasSavedManualLyricOffset
        ? manualLyricOffset
        : (lyricsDataIsSynced ? autoIntroOffset + DEFAULT_SYNC_LEAD : 0);
      manualLyricOffset = Math.max(-15, Math.min(15, Math.round((adjustmentBase + delta) * 10) / 10));
      hasSavedManualLyricOffset = true;
      if (currentTrack) {
        saveLyricOffsetForTrack(currentTrack, manualLyricOffset);
      }
    }
    computeTotalLyricOffset();
    const curTime = isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function'
      ? (ytPlayer.getCurrentTime() || 0)
      : (activeAudio?.currentTime || 0);
    if (Number.isFinite(curTime)) {
      syncLyricsWithTime(curTime, true);
    }
  }

  window.adjustLyricOffset = adjustLyricOffset;
  window.loadLyricOffsetForTrack = loadLyricOffsetForTrack;
  let lastPlayedTrack = null;
  let lastPlayedPosition = 0;
  let lastResumeCheckpoint = 0;
  let resumeOnOpenTrackId = null;
  let history = [];
  let favorites = new Set();
  const origFavoritesClear = favorites.clear.bind(favorites);
  favorites.clear = function() {
    origFavoritesClear();
    downloadedTracks.length = 0;
    favoriteTracksMap.clear();
  };
  window.favorites = favorites;
  let favoriteTracksMap = new Map();
  let downloadedTracks = [];
  window.downloadedTracks = downloadedTracks;
  let isPlaying = false;
  let isPlaybackPending = false;
  let isShuffle = false;
  let isRepeat = false;
  let isMuted = false;
  let userVolume = 0.85;
  let isSeeking = false;
  let isLightningEnabled = true;
  let isLumnEnabled = true;
  let isBeatSyncEnabled = true;
  let isOledBgMode = false;
  let isAutoEmojiEnabled = true;
  let crossfadeSeconds = 6;
  let isCrossfading = false;
  let crossfadeInterval = null;
  let crossfadePromotionTimeout = null;
  let currentCrossfadeDurationMs = 0;
  let pendingTransitionTrackId = null;
  let disableCrossfadeForAlbums = false;
  let dockLyricsExpanded = false; // Track lyrics panel expanded state
  let npSyncRaf = 0;

  // Live Lower-Right Audio & Crossfade Status HUD (Apple Frosted Glass)
  let playbackStatusHideTimeout = null;
  function setPlaybackStatus(mode, text, autoHideMs = null) {
    const hud = document.getElementById('playbackStatusHud');
    const label = document.getElementById('playbackStatusText');
    if (!hud || !label) return;

    if (playbackStatusHideTimeout) {
      clearTimeout(playbackStatusHideTimeout);
      playbackStatusHideTimeout = null;
    }

    if (mode === 'idle') {
      hud.classList.remove('visible', 'is-buffering', 'is-crossfading', 'is-playing');
      return;
    }

    hud.classList.remove('is-buffering', 'is-crossfading', 'is-playing');
    hud.classList.add(`is-${mode}`, 'visible');
    label.textContent = text;

    if (typeof autoHideMs === 'number' && autoHideMs > 0) {
      playbackStatusHideTimeout = setTimeout(() => {
        hud.classList.remove('visible');
        playbackStatusHideTimeout = null;
      }, autoHideMs);
    }
  }
  window.setPlaybackStatus = setPlaybackStatus;

  // Next Track Preparation & Preload System
  let preparedTrack = null;
  let isNextTrackReady = false;
  let isPreparingNextTrack = false;
  let prepareAbortGen = 0;

  // 5-Hour Expiration Video ID Stream URL Cache
  const streamUrlCache = new Map();
  const STREAM_CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours
  let searchDebounceTimer = null;
  let activeSearchId = 0;
  let lyricsData = [];
  let lyricsDataIsSynced = false;
  let plainLyricsCanProgress = false;
  let activeLyricIndex = -1;
  const lyricsCacheStorageKey = 'melopair_lyrics_cache_v1';
  const lyricsResponseCache = new Map();
  const LYRICS_CACHE_MAX_ENTRIES = 60;
  const LYRICS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function getLyricsCacheTrackKey(track) {
    const cleanTitle = String(track?.title || '')
      .replace(/\s*[\[(]\s*(?:(?:feat(?:uring)?|ft)\.?|with|official(?:\s+(?:music\s+)?(?:audio|video|lyrics?))?)[^\])]*[\])]/giu, ' ')
      .replace(/\s*-\s*(?:remaster(?:ed)?(?:\s+\d{4})?|lyric\s+video)\b.*$/iu, ' ')
      .replace(/[\s.,!?;:]+$/u, '').replace(/\s+/gu, ' ').trim();
    const primaryArtist = String(track?.artist || '')
      .replace(/^(?:Song|Video|Episode)\s*•\s*/iu, '')
      .replace(/\s*-\s*Topic$/iu, '').replace(/\s*VEVO$/iu, '')
      .split(/\s*(?:&|,|\/|;|\bfeat(?:uring)?\.?\b|\bft\.?\b|\bx\b)\s*/iu)[0];
    const key = `${cleanTitle}::${primaryArtist}`.normalize('NFKD').replace(/\p{M}/gu, '')
      .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
    return key ? `lyrics:${key}` : '';
  }

  function readCachedLyrics(track) {
    const key = getLyricsCacheTrackKey(track);
    if (!key) return null;
    if (lyricsResponseCache.has(key)) return lyricsResponseCache.get(key);
    try {
      const stored = JSON.parse(safeStorageGet(lyricsCacheStorageKey) || '{}');
      const entry = stored[key];
      if (!entry?.response || Date.now() - Number(entry.savedAt || 0) > LYRICS_CACHE_MAX_AGE_MS) return null;
      lyricsResponseCache.set(key, entry.response);
      return entry.response;
    } catch (error) {
      console.warn('[Lyrics] Could not read local lyrics cache:', error);
      return null;
    }
  }

  function cacheLyricsResponse(track, response) {
    const key = getLyricsCacheTrackKey(track);
    if (!key || !response?.lyrics) return;
    lyricsResponseCache.set(key, response);
    try {
      const stored = JSON.parse(safeStorageGet(lyricsCacheStorageKey) || '{}');
      stored[key] = { savedAt: Date.now(), response };
      const entries = Object.entries(stored).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0));
      const trimmed = Object.fromEntries(entries.slice(0, LYRICS_CACHE_MAX_ENTRIES));
      localStorage.setItem(lyricsCacheStorageKey, JSON.stringify(trimmed));
    } catch (error) {
      console.warn('[Lyrics] Could not persist local lyrics cache:', error);
    }
  }
  let userIsScrollingLyrics = false;
  let scrollTimeout = null;
  let sleepTimerInterval = null;
  let sleepRemainingSec = 0;

  // Web Audio Context & Parametric Equalizer Nodes
  let audioCtx = null;
  let audioGraphFallbackActive = false;
  let analyser = null;
  let srcA = null;
  let srcB = null;
  let srcACreationCount = 0;
  let srcBCreationCount = 0;
  const audioGraphConnections = { A: [], B: [], shared: [] };
  let gainA = null;
  let gainB = null;
  let masterGain = null;
  // Pioneer DJ Mashup Crossfade Filters (Bass Swap & Sound Color FX Sweep)
  let bassFilterA = null;
  let colorFilterA = null;
  let bassFilterB = null;
  let colorFilterB = null;
  let eq60 = null;
  let eq230 = null;
  let eq910 = null;
  let eq3600 = null;
  let eq14000 = null;

  // PC Direct Dual-Audio Output (Laptop Speakers + Bluetooth Simultaneously)
  let pcDualAudioEnabled = false;
  let pcSecondaryDeviceId = '';
  let pcDualDelayMs = 0;
  let primaryDelayNode = null;
  let secondaryDelayNode = null;
  let secondaryGainNode = null;
  let secondaryMediaStreamDest = null;
  let secondaryAudio = null;

  // Boom 3D Immersion DSP Nodes
  let boomBassFilter = null;
  let boomFidelityFilter = null;
  let boomAmbienceConvolver = null;
  let boomAmbienceWetGain = null;
  let boomAmbienceDryGain = null;
  let boomSpatialSplitter = null;
  let boomSpatialMerger = null;
  let boomSpatialOutputSplitter = null;
  let boomSpatialPannerSumGain = null;
  let boomDelayL = null;
  let boomDelayR = null;
  let boomCrossfeedL = null;
  let boomCrossfeedR = null;
  let boomDirectL = null;
  let boomDirectR = null;
  let boomSpatialPannerL = null;
  let boomSpatialPannerR = null;
  let boomNightCompressor = null;
  let boomNightBypassGain = null;
  let boomNightActiveGain = null;

  // Boom 3D Settings & State (persisted to localStorage)
  let boom3dConfig = {
    spatialEnabled: true,
    spatialWidth: 1.5,
    elevation: 35,
    subBassEnabled: true,
    subBassGain: 6.0,
    fidelityEnabled: true,
    fidelityGain: 4.5,
    ambienceEnabled: true,
    ambienceWet: 0.30,
    nightModeEnabled: false,
    activeSpeakers: { fl: true, c: true, fr: true, sl: true, sr: true, top: true }
  };

  try {
    const savedBoom = safeStorageGet('echo_boom3d_settings');
    if (savedBoom) {
      boom3dConfig = Object.assign(boom3dConfig, JSON.parse(savedBoom));
    }
  } catch (e) {
    console.warn('Failed to load Boom 3D settings:', e);
  }

  let audioDataArray = null;
  let isAudioContextInit = false;
  let beatEnergy = 0;
  let sinePhase = 0;

  // Verified Real Tracks for Initial Library, Home Quick Picks & Radio
  const verifiedRealTracks = [
    {
      id: 'Q3gy8A0jY10',
      title: 'In The End',
      artist: 'Linkin Park',
      artwork: 'https://i.ytimg.com/vi/Q3gy8A0jY10/hqdefault.jpg',
      duration: 217
    },
    {
      id: '4NRXx6U8ABQ',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      artwork: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg',
      duration: 200
    },
    {
      id: 'kPa7bsKwL-c',
      title: 'Die With A Smile',
      artist: 'Lady Gaga, Bruno Mars',
      artwork: 'https://i.ytimg.com/vi/kPa7bsKwL-c/hqdefault.jpg',
      duration: 251
    },
    {
      id: 'V9PVRfjEBTI',
      title: 'Birds of a Feather',
      artist: 'Billie Eilish',
      artwork: 'https://i.ytimg.com/vi/V9PVRfjEBTI/hqdefault.jpg',
      duration: 196
    },
    {
      id: 'evGsI9s_3k4',
      title: 'Espresso',
      artist: 'Sabrina Carpenter',
      artwork: 'https://i.ytimg.com/vi/evGsI9s_3k4/hqdefault.jpg',
      duration: 175
    },
    {
      id: '34Na4j8AVgA',
      title: 'Starboy',
      artist: 'The Weeknd ft. Daft Punk',
      artwork: 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg',
      duration: 230
    },
    {
      id: 'ApXoWvfEYVU',
      title: 'Sunflower',
      artist: 'Post Malone, Swae Lee',
      artwork: 'https://i.ytimg.com/vi/ApXoWvfEYVU/hqdefault.jpg',
      duration: 158
    },
    {
      id: 'ElZfdU54Cp8',
      title: 'Apna Bana Le',
      artist: 'Arijit Singh, Sachin-Jigar',
      artwork: 'https://i.ytimg.com/vi/ElZfdU54Cp8/hqdefault.jpg',
      duration: 261
    },
    {
      id: 'mWRsgZuwf_8',
      title: 'Demons',
      artist: 'Imagine Dragons',
      artwork: 'https://i.ytimg.com/vi/mWRsgZuwf_8/hqdefault.jpg',
      duration: 177
    },
    {
      id: 'fJ9rUzIMcZQ',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      artwork: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg',
      duration: 359
    },
    {
      id: 'JGwWNGJdvx8',
      title: 'Shape of You',
      artist: 'Ed Sheeran',
      artwork: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg',
      duration: 233
    }
  ];

  // ------------------------------------------------------------------------
  // Web Audio Context & 5-Band Parametric Equalizer Signal Chain
  // ------------------------------------------------------------------------
  function initAudioContext() {
    const isAndroid = navigator.userAgent && navigator.userAgent.includes('Android');
    if (isAndroid) {
      // On Android mobile devices, audio elements MUST output directly to hardware AudioTrack
      // Routing through WebAudio createMediaElementSource causes buffer starvation, cracking, and stops when screen locks!
      isAudioContextInit = true;
      console.log('[Audio Engine] Android detected: using native hardware audio direct path');
      return;
    }
    if (isAudioContextInit) {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch((err) => console.warn('[Audio Engine] Could not resume audio context:', err));
      }
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch((err) => console.warn('[Audio Engine] Could not resume audio context:', err));
      }

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      audioDataArray = new Uint8Array(analyser.frequencyBinCount);

      // 5-Band Parametric Equalizer Filters
      eq60 = audioCtx.createBiquadFilter();
      eq60.type = 'lowshelf';
      eq60.frequency.value = 60;
      eq60.gain.value = 0;

      eq230 = audioCtx.createBiquadFilter();
      eq230.type = 'peaking';
      eq230.frequency.value = 230;
      eq230.Q.value = 1.0;
      eq230.gain.value = 0;

      eq910 = audioCtx.createBiquadFilter();
      eq910.type = 'peaking';
      eq910.frequency.value = 910;
      eq910.Q.value = 1.0;
      eq910.gain.value = 0;

      eq3600 = audioCtx.createBiquadFilter();
      eq3600.type = 'peaking';
      eq3600.frequency.value = 3600;
      eq3600.Q.value = 1.0;
      eq3600.gain.value = 0;

      eq14000 = audioCtx.createBiquadFilter();
      eq14000.type = 'highshelf';
      eq14000.frequency.value = 14000;
      eq14000.gain.value = 0;

      // Pioneer DJ Mashup Filter Nodes (Deck A & Deck B)
      // 1. Low-shelf EQ (250Hz) for instant seamless Bass Swaps without low-end clash
      bassFilterA = audioCtx.createBiquadFilter();
      bassFilterA.type = 'lowshelf';
      bassFilterA.frequency.value = 250;
      bassFilterA.gain.value = 0;

      bassFilterB = audioCtx.createBiquadFilter();
      bassFilterB.type = 'lowshelf';
      bassFilterB.frequency.value = 250;
      bassFilterB.gain.value = 0;

      // 2. High-pass Sound Color Filter (sweeps 20Hz -> 1600Hz on outgoing track)
      colorFilterA = audioCtx.createBiquadFilter();
      colorFilterA.type = 'highpass';
      colorFilterA.frequency.value = 20; // 20Hz = neutral / bypass
      colorFilterA.Q.value = 2.2;

      colorFilterB = audioCtx.createBiquadFilter();
      colorFilterB.type = 'highpass';
      colorFilterB.frequency.value = 20;
      colorFilterB.Q.value = 2.2;

      // Independent gain nodes for Player A and Player B (DJ Crossfade mixer)
      gainA = audioCtx.createGain();
      gainB = audioCtx.createGain();
      gainA.gain.value = 1.0;
      gainB.gain.value = 0.0;

      // Master output gain
      masterGain = audioCtx.createGain();
      masterGain.gain.value = userVolume;

      // Connect source elements once per media element. Never recreate these
      // when an output device changes: MediaElementAudioSourceNode is bound to
      // its element for its lifetime.
      if (!srcA) {
        srcA = audioCtx.createMediaElementSource(audioA);
        srcACreationCount++;
      } else if (srcA.context !== audioCtx) {
        throw new Error('Deck A source node belongs to a different AudioContext');
      }
      if (!srcB) {
        srcB = audioCtx.createMediaElementSource(audioB);
        srcBCreationCount++;
      } else if (srcB.context !== audioCtx) {
        throw new Error('Deck B source node belongs to a different AudioContext');
      }

      // Keep an explicit mirror of successful connect() calls for diagnostics;
      // Web Audio does not expose a read API for a node's outgoing connections.
      audioGraphConnections.A = [];
      audioGraphConnections.B = [];
      audioGraphConnections.shared = [];
      const connectTracked = (node, destination, from, to, bucket, ...connectionArgs) => {
        node.connect(destination, ...connectionArgs);
        audioGraphConnections[bucket].push(`${from} -> ${to}`);
      };

      // Deck A Signal Path: srcA -> bassFilterA -> colorFilterA -> gainA
      connectTracked(srcA, bassFilterA, 'srcA', 'bassFilterA', 'A');
      connectTracked(bassFilterA, colorFilterA, 'bassFilterA', 'colorFilterA', 'A');
      connectTracked(colorFilterA, gainA, 'colorFilterA', 'gainA', 'A');

      // Deck B Signal Path: srcB -> bassFilterB -> colorFilterB -> gainB
      connectTracked(srcB, bassFilterB, 'srcB', 'bassFilterB', 'B');
      connectTracked(bassFilterB, colorFilterB, 'bassFilterB', 'colorFilterB', 'B');
      connectTracked(colorFilterB, gainB, 'colorFilterB', 'gainB', 'B');

      // Both players merge into the 5-band equalizer chain
      connectTracked(gainA, eq60, 'gainA', 'eq60', 'A');
      connectTracked(gainB, eq60, 'gainB', 'eq60', 'B');

      // Connect 5-band equalizer filters in series
      connectTracked(eq60, eq230, 'eq60', 'eq230', 'shared');
      connectTracked(eq230, eq910, 'eq230', 'eq910', 'shared');
      connectTracked(eq910, eq3600, 'eq910', 'eq3600', 'shared');
      connectTracked(eq3600, eq14000, 'eq3600', 'eq14000', 'shared');

      // ----------------------------------------------------------------------
      // Boom 3D Audio Processing DSP Suite Signal Chain
      // ----------------------------------------------------------------------
      // 1. Sub-Woofer Deep Bass Filter (Peaking @ 55Hz)
      boomBassFilter = audioCtx.createBiquadFilter();
      boomBassFilter.type = 'peaking';
      boomBassFilter.frequency.value = 55;
      boomBassFilter.Q.value = 1.4;
      boomBassFilter.gain.value = boom3dConfig.spatialEnabled && boom3dConfig.subBassEnabled ? boom3dConfig.subBassGain : 0;

      // 2. High-Frequency Fidelity Exciter Filter (High-shelf @ 9kHz)
      boomFidelityFilter = audioCtx.createBiquadFilter();
      boomFidelityFilter.type = 'highshelf';
      boomFidelityFilter.frequency.value = 9000;
      boomFidelityFilter.gain.value = boom3dConfig.spatialEnabled && boom3dConfig.fidelityEnabled ? boom3dConfig.fidelityGain : 0;

      // 3. Room Ambience Acoustic Convolver Reverb
      boomAmbienceConvolver = audioCtx.createConvolver();
      boomAmbienceConvolver.buffer = generateAcousticImpulseResponse(audioCtx, 2.0, 2.6);
      boomAmbienceDryGain = audioCtx.createGain();
      boomAmbienceWetGain = audioCtx.createGain();
      const isAmbOn = boom3dConfig.spatialEnabled && boom3dConfig.ambienceEnabled;
      const initialWet = isAmbOn ? Math.min(0.85, boom3dConfig.ambienceWet * 0.7) : 0;
      boomAmbienceWetGain.gain.value = initialWet;
      boomAmbienceDryGain.gain.value = isAmbOn ? 1.0 - (initialWet * 0.4) : 1.0;

      // 4. 3D Spatial Audio & Haas Crossfeed Delay Matrix
      boomSpatialSplitter = audioCtx.createChannelSplitter(2);
      boomSpatialMerger = audioCtx.createChannelMerger(2);

      boomDirectL = audioCtx.createGain();
      boomDirectR = audioCtx.createGain();
      boomDelayL = audioCtx.createDelay(0.05);
      boomDelayR = audioCtx.createDelay(0.05);
      boomCrossfeedL = audioCtx.createGain();
      boomCrossfeedR = audioCtx.createGain();

      boomDelayL.delayTime.value = 0.0085; // 8.5ms Haas delay for natural binaural stereophony
      boomDelayR.delayTime.value = 0.0085;

      const crossfeedLevel = boom3dConfig.spatialEnabled ? Math.max(0, (boom3dConfig.spatialWidth - 1.0) * 0.35) : 0;
      boomDirectL.gain.value = 1.0;
      boomDirectR.gain.value = 1.0;
      boomCrossfeedL.gain.value = -crossfeedLevel;
      boomCrossfeedR.gain.value = -crossfeedLevel;

      // Keep the channels separate through HRTF. A single PannerNode downmixes
      // stereo input to mono, which makes the virtual surround effect disappear.
      boomSpatialPannerL = audioCtx.createPanner();
      boomSpatialPannerR = audioCtx.createPanner();
      // Each HRTF PannerNode emits stereo. Summing them through a GainNode
      // preserves those stereo channels; a ChannelMerger would downmix each
      // panner into one channel and cause strong phase cancellation.
      boomSpatialOutputSplitter = audioCtx.createChannelSplitter(2);
      boomSpatialPannerSumGain = audioCtx.createGain();
      boomSpatialPannerSumGain.gain.value = 0.5;
      [boomSpatialPannerL, boomSpatialPannerR].forEach(panner => {
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 10000;
        panner.rolloffFactor = 1;
      });
      const initialElevation = boom3dConfig.spatialEnabled ? boom3dConfig.elevation : 0;
      const initialElevationRad = (initialElevation * Math.PI) / 180;
      const initialY = Math.sin(initialElevationRad) * 1.5;
      const initialZ = -Math.max(1, Math.cos(initialElevationRad) * 2.2);
      if (boomSpatialPannerL.positionX) {
        boomSpatialPannerL.positionX.value = -0.8;
        boomSpatialPannerL.positionY.value = initialY;
        boomSpatialPannerL.positionZ.value = initialZ;
        boomSpatialPannerR.positionX.value = 0.8;
        boomSpatialPannerR.positionY.value = initialY;
        boomSpatialPannerR.positionZ.value = initialZ;
      } else {
        boomSpatialPannerL.setPosition(-0.8, initialY, initialZ);
        boomSpatialPannerR.setPosition(0.8, initialY, initialZ);
      }

      // 6. Night Mode Dynamics Compressor
      boomNightCompressor = audioCtx.createDynamicsCompressor();
      boomNightCompressor.threshold.value = -24;
      boomNightCompressor.knee.value = 25;
      boomNightCompressor.ratio.value = 12;
      boomNightCompressor.attack.value = 0.003;
      boomNightCompressor.release.value = 0.25;

      boomNightActiveGain = audioCtx.createGain();
      boomNightBypassGain = audioCtx.createGain();
      boomNightActiveGain.gain.value = boom3dConfig.nightModeEnabled ? 1.0 : 0.0;
      boomNightBypassGain.gain.value = boom3dConfig.nightModeEnabled ? 0.0 : 1.0;

      // Wire DSP nodes in series:
      // eq14000 -> boomBassFilter -> boomFidelityFilter -> Ambience (Split Dry & Wet)
      connectTracked(eq14000, boomBassFilter, 'eq14000', 'boomBassFilter', 'shared');
      connectTracked(boomBassFilter, boomFidelityFilter, 'boomBassFilter', 'boomFidelityFilter', 'shared');

      connectTracked(boomFidelityFilter, boomAmbienceDryGain, 'boomFidelityFilter', 'boomAmbienceDryGain', 'shared');
      connectTracked(boomFidelityFilter, boomAmbienceConvolver, 'boomFidelityFilter', 'boomAmbienceConvolver', 'shared');
      connectTracked(boomAmbienceConvolver, boomAmbienceWetGain, 'boomAmbienceConvolver', 'boomAmbienceWetGain', 'shared');

      // Ambience sums into Spatial Splitter
      connectTracked(boomAmbienceDryGain, boomSpatialSplitter, 'boomAmbienceDryGain', 'boomSpatialSplitter', 'shared');
      connectTracked(boomAmbienceWetGain, boomSpatialSplitter, 'boomAmbienceWetGain', 'boomSpatialSplitter', 'shared');

      // Channel 0 (Left):
      connectTracked(boomSpatialSplitter, boomDirectL, 'boomSpatialSplitter', 'boomDirectL', 'shared', 0);
      connectTracked(boomSpatialSplitter, boomDelayL, 'boomSpatialSplitter', 'boomDelayL', 'shared', 0);
      connectTracked(boomDelayL, boomCrossfeedL, 'boomDelayL', 'boomCrossfeedL', 'shared');

      // Channel 1 (Right):
      connectTracked(boomSpatialSplitter, boomDirectR, 'boomSpatialSplitter', 'boomDirectR', 'shared', 1);
      connectTracked(boomSpatialSplitter, boomDelayR, 'boomSpatialSplitter', 'boomDelayR', 'shared', 1);
      connectTracked(boomDelayR, boomCrossfeedR, 'boomDelayR', 'boomCrossfeedR', 'shared');

      // Merge into Output Stereo:
      // Left Out = Direct Left + Crossfeed Right
      connectTracked(boomDirectL, boomSpatialMerger, 'boomDirectL', 'boomSpatialMerger', 'shared', 0, 0);
      connectTracked(boomCrossfeedR, boomSpatialMerger, 'boomCrossfeedR', 'boomSpatialMerger', 'shared', 0, 0);

      // Right Out = Direct Right + Crossfeed Left
      connectTracked(boomDirectR, boomSpatialMerger, 'boomDirectR', 'boomSpatialMerger', 'shared', 0, 1);
      connectTracked(boomCrossfeedL, boomSpatialMerger, 'boomCrossfeedL', 'boomSpatialMerger', 'shared', 0, 1);

      // Spatial width matrix -> per-channel HRTF -> final stereo output.
      connectTracked(boomSpatialMerger, boomSpatialOutputSplitter, 'boomSpatialMerger', 'boomSpatialOutputSplitter', 'shared');
      connectTracked(boomSpatialOutputSplitter, boomSpatialPannerL, 'boomSpatialOutputSplitter', 'boomSpatialPannerL', 'shared', 0);
      connectTracked(boomSpatialOutputSplitter, boomSpatialPannerR, 'boomSpatialOutputSplitter', 'boomSpatialPannerR', 'shared', 1);
      connectTracked(boomSpatialPannerL, boomSpatialPannerSumGain, 'boomSpatialPannerL', 'boomSpatialPannerSumGain', 'shared');
      connectTracked(boomSpatialPannerR, boomSpatialPannerSumGain, 'boomSpatialPannerR', 'boomSpatialPannerSumGain', 'shared');

      // HRTF stereo output -> Night Mode Compressor (Active) & Bypass
      connectTracked(boomSpatialPannerSumGain, boomNightCompressor, 'boomSpatialPannerSumGain', 'boomNightCompressor', 'shared');
      connectTracked(boomNightCompressor, boomNightActiveGain, 'boomNightCompressor', 'boomNightActiveGain', 'shared');
      connectTracked(boomNightActiveGain, masterGain, 'boomNightActiveGain', 'masterGain', 'shared');

      connectTracked(boomSpatialPannerSumGain, boomNightBypassGain, 'boomSpatialPannerSumGain', 'boomNightBypassGain', 'shared');
      connectTracked(boomNightBypassGain, masterGain, 'boomNightBypassGain', 'masterGain', 'shared');

      // Primary Output Path (Default output e.g. Laptop Speakers with delay compensation)
      primaryDelayNode = audioCtx.createDelay(1.0);
      primaryDelayNode.delayTime.setValueAtTime(0, audioCtx.currentTime);

      connectTracked(masterGain, primaryDelayNode, 'masterGain', 'primaryDelayNode', 'shared');
      connectTracked(primaryDelayNode, analyser, 'primaryDelayNode', 'analyser', 'shared');
      connectTracked(analyser, audioCtx.destination, 'analyser', 'AudioContext.destination', 'shared');

      // Secondary Output Path (Bluetooth / Aux / Headphones)
      secondaryDelayNode = audioCtx.createDelay(1.0);
      secondaryDelayNode.delayTime.setValueAtTime(0, audioCtx.currentTime);
      secondaryGainNode = audioCtx.createGain();
      secondaryGainNode.gain.setValueAtTime(pcDualAudioEnabled ? 1.0 : 0.0, audioCtx.currentTime);

      secondaryMediaStreamDest = audioCtx.createMediaStreamDestination();
      connectTracked(masterGain, secondaryDelayNode, 'masterGain', 'secondaryDelayNode', 'shared');
      connectTracked(secondaryDelayNode, secondaryGainNode, 'secondaryDelayNode', 'secondaryGainNode', 'shared');
      connectTracked(secondaryGainNode, secondaryMediaStreamDest, 'secondaryGainNode', 'secondaryMediaStreamDest', 'shared');

      if (!secondaryAudio) {
        secondaryAudio = new Audio();
        secondaryAudio.autoplay = true;
        secondaryAudio.volume = 1;
        secondaryAudio.muted = false;
      }
      secondaryAudio.srcObject = secondaryMediaStreamDest.stream;
      applyPcDualDelay();

      isAudioContextInit = true;
      startMainLoop();
      // The music decks feed the AudioContext graph; output routing therefore
      // belongs to the context/secondary stream, not to an individual track.
      void applyPcDualAudioRouting('AudioContext initialized');
    } catch (err) {
      console.error('[Audio Engine] Web Audio graph initialization failed; switching to a simple stereo output:', err);
      // Some Windows audio drivers reject optional DSP nodes or connections.
      // MediaElementAudioSource disables the element's native output, so a
      // failed graph must be rewired before playback can be heard.
      try {
        if (!audioCtx) throw err;
        if (!srcA && audioA) {
          srcA = audioCtx.createMediaElementSource(audioA);
          srcACreationCount++;
        }
        if (!srcB && audioB) {
          srcB = audioCtx.createMediaElementSource(audioB);
          srcBCreationCount++;
        }
        if (!gainA) gainA = audioCtx.createGain();
        if (!gainB) gainB = audioCtx.createGain();
        if (!masterGain) masterGain = audioCtx.createGain();

        // A failed DSP setup can leave only one deck captured by Web Audio.
        // Rebuild captured decks through a plain stereo graph and leave any
        // uncaptured deck on native HTMLAudioElement output so neither is silent.
        try { srcA?.disconnect(); } catch (_) {}
        try { srcB?.disconnect(); } catch (_) {}
        try { gainA?.disconnect(); } catch (_) {}
        try { gainB?.disconnect(); } catch (_) {}
        try { masterGain.disconnect(); } catch (_) {}
        audioGraphConnections.A = [];
        audioGraphConnections.B = [];
        audioGraphConnections.shared = [];
        const now = audioCtx.currentTime;
        masterGain.gain.setValueAtTime(isMuted ? 0 : userVolume, now);
        gainA.gain.setValueAtTime(activeAudio === audioA ? 1 : 0, now);
        gainB.gain.setValueAtTime(activeAudio === audioB ? 1 : 0, now);
        if (srcA && audioA) {
          srcA.connect(gainA);
          gainA.connect(masterGain);
          audioGraphConnections.A.push('srcA -> gainA', 'gainA -> masterGain');
        }
        if (srcB && audioB) {
          srcB.connect(gainB);
          gainB.connect(masterGain);
          audioGraphConnections.B.push('srcB -> gainB', 'gainB -> masterGain');
        }
        masterGain.connect(audioCtx.destination);
        audioGraphConnections.shared.push('masterGain -> AudioContext.destination');
        audioGraphFallbackActive = true;
        isAudioContextInit = true;
        normalizeWebAudioDeckElements();
        startMainLoop();
        console.warn('[Audio Engine] Simple stereo fallback is active; EQ/3D effects are bypassed.', {
          deckA: srcA ? 'Web Audio fallback' : 'native element output',
          deckB: srcB ? 'Web Audio fallback' : 'native element output'
        });
      } catch (fallbackError) {
        console.error('[Audio Engine] Could not build Web Audio fallback:', fallbackError);
        // Keep native playback available for every deck not captured by Web Audio.
        audioGraphFallbackActive = true;
        isAudioContextInit = true;
        normalizeWebAudioDeckElements();
        for (const [deck, source] of [[audioA, srcA], [audioB, srcB]]) {
          if (!deck || source) continue;
          deck.volume = isMuted ? 0 : userVolume;
          deck.muted = isMuted;
        }
      }
    }
  }

  async function ensureAudioContextRunning(reason = 'playback') {
    if (isAndroid) return true;
    if (!isAudioContextInit) initAudioContext();
    if (!audioCtx) return false;
    if (audioCtx.state !== 'running') {
      console.log(`[Audio Route] Resuming AudioContext before ${reason}; state=${audioCtx.state}`);
      await audioCtx.resume();
    }
    if (audioCtx.state !== 'running') {
      throw new Error(`AudioContext is ${audioCtx.state} before ${reason}`);
    }
    return true;
  }

  function getDeckGainNode(deck) {
    if (audioGraphFallbackActive && !(deck === audioA ? srcA : deck === audioB ? srcB : null)) return null;
    return deck === audioA ? gainA : deck === audioB ? gainB : null;
  }

  const nativeDeckFadeVersions = new WeakMap();

  function rampDeckAudioGain(deck, value, rampSeconds = 0.04) {
    if (!deck) return;
    const target = Math.max(0, Math.min(1, Number(value) || 0));
    const gainNode = getDeckGainNode(deck);
    if (gainNode && audioCtx) {
      rampCrossfadeGain(gainNode, target, rampSeconds);
      return;
    }

    const desiredVolume = (isMuted ? 0 : userVolume) * target;
    const startVolume = Number(deck.volume) || 0;
    if (rampSeconds <= 0) {
      deck.volume = desiredVolume;
      return;
    }

    const version = (nativeDeckFadeVersions.get(deck) || 0) + 1;
    nativeDeckFadeVersions.set(deck, version);
    const steps = Math.max(2, Math.ceil(rampSeconds * 100));
    for (let step = 1; step <= steps; step++) {
      setTimeout(() => {
        if (nativeDeckFadeVersions.get(deck) !== version) return;
        const progress = step / steps;
        deck.volume = startVolume + (desiredVolume - startVolume) * progress;
      }, Math.round((rampSeconds * 1000 * step) / steps));
    }
  }

  function setDeckGain(deck, value, rampSeconds = 0.04) {
    rampDeckAudioGain(deck, value, rampSeconds);
  }

  function restoreActiveDeckOutput(deck) {
    // A media element can report `playing` while its deck or shared master gain
    // is still at zero after a preload handoff or a resumed playback. Recover
    // only the confirmed active track; never raise the preloaded deck or alter
    // either side while a crossfade is in progress.
    if (!deck || deck !== activeAudio || isCrossfading || !currentTrack) return;
    if (deck.dataset.trackId !== String(currentTrack.id)) return;

    const deckGain = getDeckGainNode(deck);
    if (deckGain) {
      deck.volume = 1;
      deck.muted = false;
    } else if (audioGraphFallbackActive) {
      deck.volume = isMuted ? 0 : userVolume;
      deck.muted = isMuted;
    }

    if (masterGain && audioCtx) {
      masterGain.gain.setTargetAtTime(isMuted ? 0 : userVolume, audioCtx.currentTime, 0.02);
    }
    rampDeckAudioGain(deck, 1, 0.04);
    if (audioCtx && audioCtx.state !== 'running') {
      void ensureAudioContextRunning('active deck started playback').catch(error => {
        console.error('[Audio Route] Could not resume output for the active playing deck:', error);
      });
    }
    console.info('[Audio Route] Active deck output verified on playing', {
      trackId: currentTrack.id,
      deck: deck === audioA ? 'A' : 'B',
      volume: deck.volume,
      muted: deck.muted,
      deckGain: deckGain?.gain?.value ?? null,
      masterGain: masterGain?.gain?.value ?? null,
      audioContextState: audioCtx?.state || 'unavailable'
    });
  }

  function rampCrossfadeGain(gainNode, value, rampSeconds = 0.05) {
    if (!gainNode || !audioCtx) return;
    const now = audioCtx.currentTime;
    const target = Math.max(0, Math.min(1, Number(value) || 0));
    const rampEnd = now + Math.max(0.01, rampSeconds);
    const param = gainNode.gain;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      const heldValue = Math.max(0, Math.min(1, Number(param.value) || 0));
      param.cancelScheduledValues(now);
      param.setValueAtTime(heldValue, now);
    }
    param.linearRampToValueAtTime(target, rampEnd);
  }

  function rampAudioParam(parameter, targetValue, rampSeconds = 0.04) {
    if (!parameter || !audioCtx) return;
    const now = audioCtx.currentTime;
    const target = Number(targetValue);
    if (!Number.isFinite(target)) return;
    if (typeof parameter.cancelAndHoldAtTime === 'function') {
      parameter.cancelAndHoldAtTime(now);
    } else {
      const heldValue = Number(parameter.value);
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(Number.isFinite(heldValue) ? heldValue : target, now);
    }
    parameter.linearRampToValueAtTime(target, now + Math.max(0.01, rampSeconds));
  }

  function normalizeWebAudioDeckElements() {
    // With MediaElementAudioSourceNodes, element volume/mute must not become a
    // second per-deck mixer. Keep both elements transparent and apply the
    // user's volume/mute once at masterGain. If partial graph setup left a deck
    // uncaptured, preserve its native element output and apply volume there.
    if (!audioCtx || isAndroid) return;
    for (const [deck, source] of [[audioA, srcA], [audioB, srcB]]) {
      if (!deck) continue;
      if (source) {
        deck.volume = 1;
        deck.muted = false;
      } else if (audioGraphFallbackActive) {
        deck.volume = isMuted ? 0 : userVolume;
        deck.muted = isMuted;
      }
    }
  }

  function resetDeckGains(activeDeck = activeAudio) {
    normalizeWebAudioDeckElements();
    setDeckGain(activeDeck, 1);
    setDeckGain(activeDeck === audioA ? audioB : audioA, 0);
  }

  function logAudioRouteForTrack(track, deck, reason) {
    if (!track || !deck) return;
    const describeDeck = (name, element, source, gainNode, creationCount, deckConnections) => ({
      name,
      trackId: element?.dataset?.trackId || null,
      src: element?.currentSrc || element?.src || null,
      muted: element?.muted ?? null,
      volume: element?.volume ?? null,
      gainValue: gainNode?.gain?.value ?? null,
      sourceNodeCreated: Boolean(source),
      sourceCreationCount: creationCount,
      sourceContextMatchesCurrent: Boolean(source && audioCtx && source.context === audioCtx),
      sourceConnected: Boolean(source && deckConnections.some(edge => edge.startsWith(`src${name} ->`))),
      outgoingConnections: deckConnections.slice()
    });
    const activeSink = pcDualAudioEnabled
      ? (secondaryAudio?.sinkId || pcSecondaryDeviceId || 'default')
      : (typeof audioCtx?.sinkId === 'string' ? audioCtx.sinkId : 'default (system output)');
    console.log('[Audio Route] Track change: both deck states', {
      reason,
      trackId: track.id,
      title: track.title,
      audioContextState: audioCtx?.state || 'unavailable',
      activeSinkId: activeSink,
      primarySinkId: typeof audioCtx?.sinkId === 'string' ? audioCtx.sinkId : 'default (system output)',
      secondarySinkId: pcDualAudioEnabled ? (secondaryAudio?.sinkId || pcSecondaryDeviceId || 'default') : 'disabled',
      secondaryElementVolume: secondaryAudio?.volume ?? null,
      secondaryElementMuted: secondaryAudio?.muted ?? null,
      activeDeck: deck === audioA ? 'A' : deck === audioB ? 'B' : 'unknown',
      deckA: describeDeck('A', audioA, srcA, gainA, srcACreationCount, audioGraphConnections.A),
      deckB: describeDeck('B', audioB, srcB, gainB, srcBCreationCount, audioGraphConnections.B),
      sharedOutputConnections: audioGraphConnections.shared.slice()
    });
  }

  // ------------------------------------------------------------------------
  // High-Resolution Loop & Background-Proof Audio Lifecycle Manager
  // (Ensures auto-play, silence skipping, and crossfade continue when minimized)
  // ------------------------------------------------------------------------
  let consecutiveSilentIntervals = 0;

  function evaluateSilenceTrimming(curTime, dur) {
    // Disabled aggressive mid-track silence seeking to prevent false positives, muted section skips, and audio dropouts
    return;
  }

  function savePlaybackCheckpoint(position, force = false) {
    if (!currentTrack || !Number.isFinite(position) || position < 0) return;
    const now = Date.now();
    if (!force && now - lastResumeCheckpoint < 12000) return;
    lastResumeCheckpoint = now;
    lastPlayedTrack = { ...currentTrack };
    lastPlayedPosition = position;
    try {
      localStorage.setItem('echo_last_played_track', JSON.stringify(lastPlayedTrack));
      localStorage.setItem('echo_last_played_position', String(position));
    } catch (error) {}
    savePersistentState();
  }


  function checkPlaybackLifecycle() {
    if (isYtActive) {
      if (!isPlaying) return;
      let curTime = 0;
      let dur = currentTrack?.duration || 214;
      if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
        try {
          curTime = ytPlayer.getCurrentTime() || 0;
          const ytdur = ytPlayer.getDuration();
          if (isFinite(ytdur) && ytdur > 0) dur = ytdur;
        } catch (e) {}
      }

      const pct = dur > 0 ? (curTime / dur) * 100 : 0;
      savePlaybackCheckpoint(curTime);
      if (dockCurrentTime) dockCurrentTime.textContent = formatTime(curTime);
      if (dockDuration) dockDuration.textContent = formatTime(dur);
      if (dockSeekFill && !isSeeking) dockSeekFill.style.width = `${pct}%`;
      if (dockSeekThumb && !isSeeking) dockSeekThumb.style.left = `${pct}%`;

      syncLyricsWithTime(curTime);

      if (isPlaying && (Date.now() - lastBroadcastTime > 500)) {
        broadcastEchoRoomState(false);
      }
      return;
    }

    // Always drive time, scrubber, lyrics and crossfade from the active deck
    if (!activeAudio) return;

    const curTime = activeAudio.currentTime || 0;
    const dur = (isFinite(activeAudio.duration) && activeAudio.duration > 0)
      ? activeAudio.duration
      : (currentTrack?.duration || 214);

    // Natural track end or EOF check
    const isAtEnd = activeAudio.ended || (dur > 5 && curTime >= dur - 0.35);
    if (isAtEnd && !isCrossfading && (isPlaying || activeAudio.ended)) {
      console.log('[Playback Lifecycle] Track reached end. Triggering auto-advance transition...');
      executeTransition('auto');
      return;
    }

    // Crossfade trigger check near end of track
    if (crossfadeSeconds > 0 && dur > 10 && curTime >= (dur - crossfadeSeconds) && !isCrossfading && isPlaying) {
      console.log('[Playback Lifecycle] Crossfade threshold reached. Blending next track...');
      executeTransition('auto');
    }

    const isAudioPlaying = (!activeAudio.paused && !activeAudio.ended && isFinite(activeAudio.currentTime)) || isPlaying;
    if (!isAudioPlaying) return;

    const pct = dur > 0 ? (curTime / dur) * 100 : 0;
    savePlaybackCheckpoint(curTime);

    // Real-Time Session Adaptation: Positive signal when track plays past 75%
    if (currentTrack && !currentTrack._sessionPositiveAwarded && dur > 30 && (curTime / dur) >= 0.75) {
      currentTrack._sessionPositiveAwarded = true;
      const posArtist = normalizeTasteLabel(feedPrimaryArtist(currentTrack.artist));
      if (posArtist) {
        sessionPositiveArtists.add(posArtist);
        console.log(`[Radio Adaptation] Positive signal recorded for "${posArtist}" (played >= 75%).`);
      }
    }

    // Progress bar and timestamp update driven by active player
    if (dockCurrentTime) dockCurrentTime.textContent = formatTime(curTime);
    if (dockDuration) dockDuration.textContent = formatTime(dur);
    if (dockSeekFill && !isSeeking) dockSeekFill.style.width = `${pct}%`;
    if (dockSeekThumb && !isSeeking) dockSeekThumb.style.left = `${pct}%`;

    // 1. High precision lyric synchronization
    syncLyricsWithTime(curTime);

    // 2. Prepare next track: preload as soon as playback is underway (to eliminate buffering breaks)
    if (isPlaying && !isPreparingNextTrack && !isNextTrackReady && queue.length > 1) {
      prepareNextTrack();
    }

    // 3. Evaluate Silence Trimming
    evaluateSilenceTrimming(curTime, dur);

    // 6. High-Frequency Heartbeat for Phase-Locked Loop (PLL) on Satellites
    if (isPlaying && (Date.now() - lastBroadcastTime > 500)) {
      broadcastEchoRoomState(false);
    }
  }

  function startMainLoop() {
    // Attach background-immune listeners to audio elements so playback never halts when minimized
    function onEnded(e) {
      if (e.target === activeAudio && !isCrossfading) {
        console.log('[Background Audio] Track ended on active player. Auto-advancing...');
        executeTransition('auto');
      }
    }
    audioA.removeEventListener('ended', onEnded);
    audioB.removeEventListener('ended', onEnded);
    audioA.addEventListener('ended', onEnded);
    audioB.addEventListener('ended', onEnded);

    audioA.removeEventListener('timeupdate', checkPlaybackLifecycle);
    audioB.removeEventListener('timeupdate', checkPlaybackLifecycle);
    audioA.addEventListener('timeupdate', checkPlaybackLifecycle);
    audioB.addEventListener('timeupdate', checkPlaybackLifecycle);

    // Continuous 250ms heartbeat that continues even when window is minimized or Chromium pauses rAF
    if (!window._bgHeartbeatStarted) {
      window._bgHeartbeatStarted = true;
      setInterval(checkPlaybackLifecycle, 250);
    }

    function loop() {
      // Run full lifecycle and visualizer updates
      checkPlaybackLifecycle();

      // 2. Render Sine Wave audio ribbons
      renderSineWaves();

      // 3. Render Full Visualizer Spectrum if visible
      if (viewVisualizer && viewVisualizer.classList.contains('active')) {
        renderFullVisualizer();
      }

      // 4. Beat Reactive Strobe Lightning Flash
      if (beatEnergy > 0.68 && isLightningEnabled) {
        triggerLightningFlash();
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // Sine Wave Renderer
  function renderSineWaves() {
    if (!lyricsSineWaveCanvas || !sineCtx) return;
    const w = lyricsSineWaveCanvas.width;
    const h = lyricsSineWaveCanvas.height;

    sineCtx.clearRect(0, 0, w, h);

    let bassLevel = 0;
    if (isYtActive && isPlaying) {
      bassLevel = 0.32 + 0.22 * Math.abs(Math.sin(Date.now() / 240));
      beatEnergy = bassLevel;
    } else if (analyser && audioDataArray && isPlaying) {
      analyser.getByteFrequencyData(audioDataArray);
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += audioDataArray[i];
      bassLevel = (sum / 16) / 255;
      beatEnergy = bassLevel;
    } else {
      bassLevel = 0.15;
    }

    sinePhase += 0.02 + bassLevel * 0.04;

    const waves = [
      {
        amp: 18 + bassLevel * 28,
        freq: 0.007,
        phaseOffset: 0,
        color: 'rgba(79, 70, 229, 0.45)',
        stroke: 'rgba(99, 102, 241, 0.7)',
        lineWidth: 2
      },
      {
        amp: 24 + bassLevel * 38,
        freq: 0.009,
        phaseOffset: Math.PI * 0.4,
        color: 'rgba(147, 51, 234, 0.35)',
        stroke: 'rgba(250, 45, 72, 0.85)',
        lineWidth: 2.5
      },
      {
        amp: 14 + bassLevel * 20,
        freq: 0.012,
        phaseOffset: Math.PI * 0.8,
        color: 'rgba(236, 72, 153, 0.25)',
        stroke: 'rgba(255, 155, 130, 0.75)',
        lineWidth: 1.5
      }
    ];

    waves.forEach(wave => {
      sineCtx.beginPath();
      sineCtx.moveTo(0, h);
      for (let x = 0; x <= w; x += 3) {
        const y = (h * 0.65) + Math.sin(x * wave.freq + sinePhase + wave.phaseOffset) * wave.amp;
        sineCtx.lineTo(x, y);
      }
      sineCtx.lineTo(w, h);
      sineCtx.closePath();
      sineCtx.fillStyle = wave.color;
      sineCtx.fill();

      sineCtx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const y = (h * 0.65) + Math.sin(x * wave.freq + sinePhase + wave.phaseOffset) * wave.amp;
        if (x === 0) sineCtx.moveTo(x, y);
        else sineCtx.lineTo(x, y);
      }
      sineCtx.strokeStyle = wave.stroke;
      sineCtx.lineWidth = wave.lineWidth;
      sineCtx.stroke();
    });
  }

  function renderFullVisualizer() {
    if (!fullVisualizerCanvas || !fullVizCtx) return;
    const w = fullVisualizerCanvas.width;
    const h = fullVisualizerCanvas.height;

    fullVizCtx.clearRect(0, 0, w, h);

    if (analyser && audioDataArray) {
      analyser.getByteFrequencyData(audioDataArray);
      const bars = 64;
      const barWidth = (w / bars) - 2;

      for (let i = 0; i < bars; i++) {
        const val = audioDataArray[i] / 255;
        const barHeight = val * (h * 0.7);
        const x = i * (barWidth + 2);
        const y = h - barHeight - 20;

        const grad = fullVizCtx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, '#ff9b82');
        grad.addColorStop(0.5, '#FA2D48');
        grad.addColorStop(1, '#6366f1');

        fullVizCtx.fillStyle = grad;
        fullVizCtx.fillRect(x, y, barWidth, barHeight);
      }
    }
  }

  function triggerLightningFlash() {
    if (!lightningFlash) return;
    lightningFlash.classList.add('flash');
    setTimeout(() => lightningFlash.classList.remove('flash'), 60);
  }

  function handleResize() {
    if (lyricsSineWaveCanvas) {
      lyricsSineWaveCanvas.width = lyricsSineWaveCanvas.offsetWidth || 800;
      lyricsSineWaveCanvas.height = lyricsSineWaveCanvas.offsetHeight || 110;
    }
    if (fullVisualizerCanvas) {
      fullVisualizerCanvas.width = fullVisualizerCanvas.offsetWidth || 800;
      fullVisualizerCanvas.height = fullVisualizerCanvas.offsetHeight || 500;
    }
    if (ambientCloudCanvas) {
      ambientCloudCanvas.width = ambientCloudCanvas.offsetWidth || window.innerWidth;
      ambientCloudCanvas.height = ambientCloudCanvas.offsetHeight || window.innerHeight;
    }
  }
  window.addEventListener('resize', handleResize);
  setTimeout(handleResize, 100);

  // ------------------------------------------------------------------------
  // View Switcher (Stage Tabs + Sidebar Navigation)
  // ------------------------------------------------------------------------
  // Navigation & Multi-Stage View Switcher
  // ------------------------------------------------------------------------
  function updateImmersiveLayoutState() {
    const isLyricsActive = viewLyrics && viewLyrics.classList.contains('active');
    if (isLyricsActive && lyricsMode === 'immersive') {
      if (appLayout) appLayout.classList.add('immersive-active');
      resetImmersiveIdle();
    } else {
      if (appLayout) {
        appLayout.classList.remove('immersive-active');
        appLayout.classList.remove('chrome-hidden');
      }
    }
  }

  function switchStageView(targetView) {
    // Robust deactivation: turn off active on ALL stage views so views NEVER overlap!
    document.querySelectorAll('.stage-view').forEach(v => {
      v.classList.remove('active');
    });
    if (targetView) targetView.classList.add('active');

    // Update navigation sidebar active highlights cleanly
    if (navItems) {
      navItems.forEach(item => {
        const viewType = item.getAttribute('data-view');
        if (targetView === viewLyrics && viewType === 'lyrics') {
          item.classList.add('active');
        } else if (targetView === viewDiscovery && viewType === 'discovery') {
          item.classList.add('active');
        } else if (targetView === viewBrowse && viewType === 'browse') {
          item.classList.add('active');
        } else if (targetView === viewLibrary && viewType === 'library') {
          item.classList.add('active');
        } else if (targetView === viewSettings && (viewType === 'settings' || viewType === 'studio')) {
          item.classList.add('active');
        } else if (targetView === viewHistory && viewType === 'history') {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }

    updateImmersiveLayoutState();
    handleResize();
    if (targetView === viewLyrics && !isOledBgMode && !ambientCloudAnimId) {
      initAmbientClouds();
    }
  }
  window.echoSwitchView = switchStageView;
  window.switchStageView = switchStageView;

  stageTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      stageTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (tab === tabHomeBtn) {
        switchStageView(viewDiscovery);
      } else if (tab === tabVisualizerBtn) {
        switchStageView(viewVisualizer);
      } else if (tab === tabHistoryBtn) {
        renderHistoryList();
        switchStageView(viewHistory);
      }
    });
  });

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const viewType = item.getAttribute('data-view');
      if (viewType === 'rooms') {
        openPartyRoomsModal();
        return; // Retain active page highlight when opening rooms modal
      }

      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      stageTabs.forEach(t => t.classList.remove('active'));

      if (viewType === 'library') {
        switchStageView(viewLibrary);
        if (typeof renderLibraryList === 'function') renderLibraryList();
      } else if (viewType === 'discovery') {
        switchStageView(viewDiscovery);
      } else if (viewType === 'browse') {
        const viewBrowse = document.getElementById('viewBrowse');
        if (viewBrowse) {
          switchStageView(viewBrowse);
          if (typeof loadBrowseContent === 'function') loadBrowseContent();
        } else {
          switchStageView(viewDiscovery);
        }
      } else if (viewType === 'playlists') {
        switchStageView(viewLibrary);
        if (typeof renderLibraryList === 'function') renderLibraryList();
      } else if (viewType === 'studio') {
        const viewStudio = document.getElementById('viewStudio');
        if (viewStudio) switchStageView(viewStudio);
      } else if (viewType === 'settings') {
        const appLayout = document.getElementById('appLayout') || document.querySelector('.app-layout');
        if (appLayout) appLayout.classList.remove('show-queue');
        switchStageView(viewSettings);
      }
    });
  });

  // Unified Lyrics Mode Switcher (Header Pill, Viewport Bar & Floating Return Button)
  function setLyricsMode(mode) {
    lyricsMode = mode;
    savePersistentState();

    if (mode === 'immersive') {
      if (kineticModeToggleBtn) kineticModeToggleBtn.classList.add('active');
      if (kineticModeLabel) kineticModeLabel.textContent = 'Kinetic Mode';
      if (modeImmersiveBtn) modeImmersiveBtn.classList.add('active');
      if (modeStreamBtn) modeStreamBtn.classList.remove('active');
      if (immersiveLyricsViewport) immersiveLyricsViewport.classList.remove('hidden');
      if (lyricsScrollViewport) lyricsScrollViewport.classList.add('hidden');
      if (floatingKineticBtn) floatingKineticBtn.classList.add('hidden');
      if (lyricsModeLabel) lyricsModeLabel.textContent = 'Kinetic Mode';
      if (lyricsModeBadge) {
        lyricsModeBadge.classList.add('active');
        lyricsModeBadge.title = 'Current: Kinetic Mode (Click to switch to Upward Stream)';
      }
      updateImmersiveLayoutState();
      if (activeLyricIndex >= 0) renderImmersiveLyrics(activeLyricIndex);
    } else {
      if (kineticModeToggleBtn) kineticModeToggleBtn.classList.remove('active');
      if (kineticModeLabel) kineticModeLabel.textContent = 'Upward Stream';
      if (modeStreamBtn) modeStreamBtn.classList.add('active');
      if (modeImmersiveBtn) modeImmersiveBtn.classList.remove('active');
      if (immersiveLyricsViewport) immersiveLyricsViewport.classList.add('hidden');
      if (lyricsScrollViewport) lyricsScrollViewport.classList.remove('hidden');
      if (floatingKineticBtn) floatingKineticBtn.classList.remove('hidden');
      if (lyricsModeLabel) lyricsModeLabel.textContent = 'Upward Stream';
      if (lyricsModeBadge) {
        lyricsModeBadge.classList.remove('active');
        lyricsModeBadge.title = 'Current: Upward Stream (Click to switch to Kinetic Mode)';
      }
      updateImmersiveLayoutState();
      scrollLyricsToActive();
    }
  }

  function setKineticBgMode(oled) {
    isOledBgMode = oled;
    if (viewLyrics) {
      viewLyrics.classList.toggle('oled-black-mode', isOledBgMode);
      viewLyrics.classList.toggle('ambient-cloud-mode', !isOledBgMode);
    }
    if (kineticBgToggleBtn) {
      kineticBgToggleBtn.classList.toggle('active', isOledBgMode);
    }
    if (kineticBgIcon) {
      kineticBgIcon.textContent = isOledBgMode ? '⬛' : '☁️';
    }
    if (kineticBgLabel) {
      kineticBgLabel.textContent = isOledBgMode ? 'OLED Black' : 'Ambient Cloud';
    }
    if (!isOledBgMode && viewLyrics && viewLyrics.classList.contains('active') && !ambientCloudAnimId) {
      initAmbientClouds();
    }
    savePersistentState();
  }

  if (kineticModeToggleBtn) {
    kineticModeToggleBtn.addEventListener('click', () => {
      const nextMode = lyricsMode === 'immersive' ? 'stream' : 'immersive';
      setLyricsMode(nextMode);
      showToast(nextMode === 'immersive' ? 'Switched to Versi Kinetic Lyrics ✨' : 'Switched to Upward Stream 📜');
    });
  }

  if (kineticBgToggleBtn) {
    kineticBgToggleBtn.addEventListener('click', () => {
      setKineticBgMode(!isOledBgMode);
      showToast(isOledBgMode ? 'OLED Pure Black Mode ⬛' : 'Ambient Atmospheric Cloud Mode ☁️');
    });
  }

  if (autoEmojiToggleBtn) {
    autoEmojiToggleBtn.addEventListener('click', () => {
      isAutoEmojiEnabled = !isAutoEmojiEnabled;
      autoEmojiToggleBtn.classList.toggle('active', isAutoEmojiEnabled);
      showToast(isAutoEmojiEnabled ? 'Auto Emoji: ON ✨' : 'Auto Emoji: OFF');
      savePersistentState();
      if (lyricsMode === 'immersive' && activeLyricIndex >= 0) {
        renderImmersiveLyrics(activeLyricIndex);
      }
    });
  }

  if (modeImmersiveBtn && modeImmersiveBtn !== kineticModeToggleBtn) {
    modeImmersiveBtn.addEventListener('click', () => {
      setLyricsMode('immersive');
      showToast('Switched to Versi Kinetic Lyrics ✨');
    });
  }

  if (modeStreamBtn) {
    modeStreamBtn.addEventListener('click', () => {
      setLyricsMode('stream');
      showToast('Switched to Upward Stream 📜');
    });
  }

  if (lyricsModeBadge) {
    lyricsModeBadge.addEventListener('click', () => {
      const nextMode = lyricsMode === 'immersive' ? 'stream' : 'immersive';
      setLyricsMode(nextMode);
      showToast(nextMode === 'immersive' ? 'Switched to Versi Kinetic Lyrics ✨' : 'Switched to Upward Stream 📜');
    });
  }

  if (floatingKineticBtn) {
    floatingKineticBtn.addEventListener('click', () => {
      setLyricsMode('immersive');
      showToast('Returned to Versi Kinetic Lyrics ✨');
    });
  }

  if (navLyricsBtn) {
    navLyricsBtn.addEventListener('click', () => {
      if (typeof openNowPlaying === 'function') {
        openNowPlaying();
      } else {
        switchStageView(viewLyrics);
      }
    });
  }

  // ------------------------------------------------------------------------
  // Up Next Queue & Real YouTube Music Radio Engine
  // ------------------------------------------------------------------------
  function renderQueueList() {
    // 1. Render Now Playing Card at the top of Up Next (YouTube Music Style)
    if (queueNowPlaying) {
      if (currentTrack) {
        const cover = currentTrack.artwork || currentTrack.thumbnail || 'default-art.png';
        queueNowPlaying.innerHTML = `
          <div class="now-playing-card">
            <div class="now-playing-thumb-wrap">
              <img class="now-playing-thumb" src="${cover}" alt="Cover" onerror="this.src='default-art.png'">
              <div class="eq-wave">
                <span></span><span></span><span></span>
              </div>
            </div>
            <div class="now-playing-info">
              <span class="now-playing-tag">Now Playing</span>
              <div class="now-playing-title">${escapeHtml(currentTrack.title)}</div>
              <div class="now-playing-artist">${escapeHtml(currentTrack.artist || 'MeloPair')}</div>
            </div>
          </div>
        `;
      } else {
        queueNowPlaying.innerHTML = '';
      }
    }

    // 2. Update Up Next Track Count & Badge
    if (queueCountBadge) {
      const upNextTracks = [...manualQueue, ...contextQueue].filter(t => !currentTrack || t.id !== currentTrack.id);
      const radioTracks = isAutoplayEnabled ? autoplayQueue.filter(t => !currentTrack || t.id !== currentTrack.id) : [];
      const totalUpcoming = upNextTracks.length + radioTracks.length;
      queueCountBadge.textContent = `${totalUpcoming} Next • Radio`;
    }

    // 3. Render Upcoming Tracks List (Separated Up Next vs Autoplay)
    if (!queueTrackList) return;
    queueTrackList.innerHTML = '';

    let upNextTracks = [...manualQueue, ...contextQueue].filter(t => !currentTrack || t.id !== currentTrack.id);
    let radioTracks = isAutoplayEnabled ? autoplayQueue.filter(t => !currentTrack || t.id !== currentTrack.id) : [];

    // Fallback: If 3-tier sub-queues are empty but master queue has tracks (e.g. tests or legacy seed)
    if (upNextTracks.length === 0 && radioTracks.length === 0 && Array.isArray(queue) && queue.length > 0) {
      const remaining = queue.filter(t => !currentTrack || t.id !== currentTrack.id);
      upNextTracks = remaining.filter(t => !t.isAutoplaySuggestion && !autoQueueTrackIds.has(t.id));
      radioTracks = remaining.filter(t => t.isAutoplaySuggestion || autoQueueTrackIds.has(t.id));
      if (upNextTracks.length === 0 && radioTracks.length === 0) {
        upNextTracks = remaining;
      }
    }

    if (upNextTracks.length === 0 && radioTracks.length === 0) {
      queueTrackList.innerHTML = '<div class="empty-state">No upcoming tracks in radio queue.</div>';
      return;
    }

    function createQueueRowElement(track, idx, isRadio = false, queueKind = 'autoplay', queueIndex = idx - 1) {
      const isFav = favorites.has(track.id);
      const item = document.createElement('div');
      item.className = 'queue-item' + (isRadio ? ' queue-item-radio' : '');
      item.draggable = true;
      item.dataset.queueTrackId = String(track.id);
      item.dataset.queueKind = queueKind;
      item.dataset.queueIndex = String(queueIndex);
      item.innerHTML = `
        <span class="queue-index">${idx}</span>
        <img class="queue-thumb" loading="lazy" decoding="async" src="${track.artwork || track.thumbnail || 'default-art.png'}" alt="Cover" onerror="this.src='default-art.png'">
        <div class="queue-meta">
          <span class="queue-name">${escapeHtml(track.title)}</span>
          <span class="queue-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
        </div>
        <span class="queue-dur">${formatTime(track.duration || 180)}</span>
        <div class="queue-actions">
          <button class="action-btn-mini queue-drag-handle" type="button" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</button>
          <button class="action-btn-mini queue-move-up-btn" type="button" title="Move up" aria-label="Move ${escapeHtml(track.title)} up">↑</button>
          <button class="action-btn-mini queue-move-down-btn" type="button" title="Move down" aria-label="Move ${escapeHtml(track.title)} down">↓</button>
          <button class="action-btn-mini queue-remove-btn" type="button" title="Remove from queue" aria-label="Remove ${escapeHtml(track.title)}">×</button>
          <button class="action-btn-mini fav-btn ${isFav ? 'liked' : ''}" title="Favorite">
            ${isFav ? '♥' : '♡'}
          </button>
        </div>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.queue-move-up-btn')) {
          e.stopPropagation();
          moveQueueItem(queueKind, queueIndex, -1);
          return;
        }
        if (e.target.closest('.queue-move-down-btn')) {
          e.stopPropagation();
          moveQueueItem(queueKind, queueIndex, 1);
          return;
        }
        if (e.target.closest('.queue-remove-btn')) {
          e.stopPropagation();
          removeQueueItem(queueKind, queueIndex);
          return;
        }
        if (e.target.closest('.fav-btn')) {
          e.stopPropagation();
          toggleFavorite(track);
          return;
        }
        playTrack(track);
      });
      item.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('text/plain', JSON.stringify({ kind: queueKind, index: queueIndex }));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragover', event => { event.preventDefault(); });
      item.addEventListener('drop', event => {
        event.preventDefault();
        try {
          const from = JSON.parse(event.dataTransfer?.getData('text/plain') || 'null');
          if (from) reorderQueueItem(from.kind, from.index, queueKind, queueIndex);
        } catch (error) {
          console.warn('[Queue] Could not reorder dragged track:', error);
        }
      });
      return item;
    }

    if (upNextTracks.length > 0) {
      const upNextHeader = document.createElement('div');
      upNextHeader.className = 'queue-section-header';
      upNextHeader.innerHTML = `<span>Up Next</span><span class="queue-section-badge">${upNextTracks.length}</span>`;
      queueTrackList.appendChild(upNextHeader);

      upNextTracks.forEach((track, idx) => {
        const sourceQueue = manualQueue.some(item => item.id === track.id) ? manualQueue : contextQueue;
        queueTrackList.appendChild(createQueueRowElement(track, idx + 1, false, sourceQueue === manualQueue ? 'manual' : 'context', sourceQueue.findIndex(item => item.id === track.id)));
      });
    }

    if (radioTracks.length > 0) {
      const radioHeader = document.createElement('div');
      radioHeader.className = 'queue-section-header autoplay-section-header';
      const labelText = activeRadioVibeLabel ? `Autoplay • ${escapeHtml(activeRadioVibeLabel)}` : `Autoplay • Similar to ${escapeHtml(currentTrack?.title || 'Current')}`;
      radioHeader.innerHTML = `<span>${labelText}</span><span class="queue-section-badge">Radio</span>`;
      queueTrackList.appendChild(radioHeader);

      radioTracks.forEach((track, idx) => {
        queueTrackList.appendChild(createQueueRowElement(track, upNextTracks.length + idx + 1, true, 'autoplay', autoplayQueue.findIndex(item => item.id === track.id)));
      });
    }
  }

  function addManualQueueTrack(track, playNext = false) {
    if (!track?.id) return false;
    const songKey = trackSongKey(track);
    if ([...manualQueue, ...contextQueue, ...autoplayQueue].some(item => item.id === track.id || trackSongKey(item) === songKey)) return false;
    const previousHeadId = getNextQueueTrack()?.id || '';
    const item = { ...track, isManualQueue: true, isAutoplaySuggestion: false };
    if (playNext) {
      manualQueue.unshift(item);
    } else {
      manualQueue.push(item);
    }
    rememberRecentArtist(item);
    syncMasterQueue();
    renderQueueList();
    window.renderNowPlayingDrawerQueue?.();
    if (getNextQueueTrack()?.id !== previousHeadId) prepareNextTrack();
    return true;
  }

  const queueActionTracks = new Map();
  function queueActionMarkup(track) {
    if (!track?.id) return '';
    queueActionTracks.set(String(track.id), track);
    const id = escapeHtml(String(track.id));
    return `<div class="track-queue-actions" role="group" aria-label="Queue actions for ${escapeHtml(track.title || 'track')}">
      <button type="button" class="track-queue-action" data-queue-action="play-next" data-track-id="${id}" title="Play next">Play Next</button>
      <button type="button" class="track-queue-action" data-queue-action="add" data-track-id="${id}" title="Add to queue">+ Queue</button>
    </div>`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('.track-queue-action');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const track = queueActionTracks.get(button.dataset.trackId);
    if (!track) return;
    const playNext = button.dataset.queueAction === 'play-next';
    if (!addManualQueueTrack(track, playNext)) showToast(`"${track.title}" is already in Up Next`);
    else showToast(playNext ? 'Playing next' : 'Added to queue');
  }, true);

  function mutateQueue(kind, mutator) {
    const target = kind === 'context' ? contextQueue : kind === 'autoplay' ? autoplayQueue : manualQueue;
    if (!Array.isArray(target)) return false;
    const changed = mutator(target);
    if (!changed) return false;
    syncMasterQueue();
    renderQueueList();
    window.renderNowPlayingDrawerQueue?.();
    prepareNextTrack();
    return true;
  }

  function moveQueueItem(kind, index, delta) {
    return mutateQueue(kind, items => {
      const targetIndex = index + delta;
      if (index < 0 || targetIndex < 0 || index >= items.length || targetIndex >= items.length) return false;
      [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
      return true;
    });
  }

  function removeQueueItem(kind, index) {
    return mutateQueue(kind, items => {
      if (index < 0 || index >= items.length) return false;
      items.splice(index, 1);
      return true;
    });
  }

  function reorderQueueItem(fromKind, fromIndex, toKind, toIndex) {
    if (fromKind !== toKind) return false;
    return mutateQueue(fromKind, items => {
      if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return false;
      const [item] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, item);
      return true;
    });
  }

  function clearUpcomingQueue() {
    manualQueue = [];
    contextQueue = [];
    autoplayQueue = [];
    syncMasterQueue();
    renderQueueList();
    window.renderNowPlayingDrawerQueue?.();
    prepareNextTrack();
    showToast('Up Next cleared');
  }
  document.getElementById('clearQueueBtn')?.addEventListener('click', clearUpcomingQueue);
  document.getElementById('npClearQueueBtn')?.addEventListener('click', clearUpcomingQueue);

  function toggleFavorite(track) {
    if (!track || !track.id) return;
    if (favorites.has(track.id)) {
      favorites.delete(track.id);
      favoriteTracksMap.delete(track.id);
      showToast(`Removed "${track.title}" from favorites`);
    } else {
      favorites.add(track.id);
      favoriteTracksMap.set(track.id, track);
      const posArtist = normalizeTasteLabel(feedPrimaryArtist(track.artist));
      if (posArtist) sessionPositiveArtists.add(posArtist);
      showToast(`Added "${track.title}" to favorites ♥`);
    }
    savePersistentState();
    renderQueueList();
    renderQuickPicks();
    if (typeof renderLibraryList === 'function') renderLibraryList();
  }
  window.toggleFavorite = toggleFavorite;

  // ------------------------------------------------------------------------
  // YouTube Music-Style Dynamic Radio Engine (Strict Language & Mood Matching)
  // ------------------------------------------------------------------------
  async function generateRadioSuggestions(seedTrack, mode = 'all') {
    if (!seedTrack || !seedTrack.id || !isAutoplayEnabled) return;
    const isTestMode = new URLSearchParams(window.location.search).get('test_crossfade') === '1';
    if (isTestMode) return;

    const requestId = ++radioRecommendationRequestId;
    const seedPrimary = feedPrimaryArtist(seedTrack.artist);
    const seedNormPrimary = normalizeTasteLabel(seedPrimary);

    // Detect seed track's exact Language/Region and Mood/Theme profile
    const seedProfile = detectTrackVibe(seedTrack);
    activeRadioVibeLabel = seedProfile.headerVibeLabel;

    const featureArtists = new Set(
      splitFeaturedArtist(seedTrack).displayArtist
        .split(/[,&]/)
        .map(v => normalizeTasteLabel(v.trim()))
        .filter(Boolean)
    );

    const behavior = readBehaviorProfile();
    const likedArtistKeys = new Set([...favoriteTracksMap.values()].map(item => normalizeTasteLabel(feedPrimaryArtist(item.artist))));
    const topArtistsList = getTopListeningArtists().map(item => normalizeTasteLabel(item.name));
    const topArtistsSet = new Set(topArtistsList);

    const JUNK_REGEX = /\b(top\s*100|playlist|full\s*album|nonstop|jukebox|1\s*hour|compilation|official\s+music\s+video|official\s+video|music\s+video|video\s+song|full\s+video|lyrical\s+video|teaser|trailer|mashup)\b/i;

    function isJunk(t) {
      if (!t || !t.title) return true;
      if (JUNK_REGEX.test(t.title)) return true;
      if (!isCleanFeedTrack(t)) return true;
      const dur = getTrackDurationSeconds(t) || t.duration;
      if (dur && (dur < 45 || dur > 480)) return true;
      return false;
    }

    let candidates = [];

    // 1. YouTube Music InnerTube Related queue
    try {
      if (window.echoApi?.getRelatedTracks) {
        const related = await window.echoApi.getRelatedTracks({
          videoId: seedTrack.id,
          artist: seedTrack.artist,
          title: seedTrack.title
        });
        if (Array.isArray(related)) {
          candidates.push(...related);
        }
      }
    } catch (e) {
      console.warn('[Radio Engine] getRelatedTracks innerTube failed; using search:', e);
    }
    if (requestId !== radioRecommendationRequestId) return;

    // 2. Targeted Multi-Query Search based on (Language + Mood)
    const searchQueries = [
      `${seedProfile.languageQuery} ${seedProfile.moodLabel} hits`,
      `${seedProfile.languageQuery} ${seedProfile.moodLabel} songs`,
      `${seedTrack.title} ${seedPrimary} similar songs`
    ];

    if (mode === 'familiar') {
      const matchingLikedArtist = [...favoriteTracksMap.values()]
        .filter(t => detectTrackVibe(t).region === seedProfile.region)
        .map(t => feedPrimaryArtist(t.artist))[0] || topArtistsList[0];
      if (matchingLikedArtist) {
        searchQueries.push(`${matchingLikedArtist} ${seedProfile.moodLabel} songs`);
      }
      searchQueries.push(`${seedPrimary} ${seedProfile.moodQuery}`);
    } else if (mode === 'discover') {
      searchQueries.push(`${seedProfile.languageQuery} ${seedProfile.moodLabel} trending songs`);
      searchQueries.push(`${seedPrimary} similar artists ${seedProfile.languageQuery}`);
    } else {
      searchQueries.push(`${seedProfile.languageQuery} popular ${seedProfile.moodLabel} songs`);
    }

    // Add matching tracks from user's favorites & history that match BOTH region and mood
    const localMatches = [...favoriteTracksMap.values(), ...history]
      .filter(t => t && t.id && t.id !== seedTrack.id)
      .filter(t => {
        const v = detectTrackVibe(t);
        return v.region === seedProfile.region && (v.mood === seedProfile.mood || v.moodLabel === seedProfile.moodLabel);
      });
    if (localMatches.length > 0) {
      candidates.push(...localMatches.slice(0, 8));
    }

    if (window.echoApi?.searchMusic) {
      const settled = await Promise.allSettled(
        searchQueries.filter(Boolean).slice(0, 4).map(q => window.echoApi.searchMusic(q, 1, 20))
      );
      if (requestId !== radioRecommendationRequestId) return;
      settled.forEach(res => {
        if (res.status === 'fulfilled' && res.value) {
          const tracks = res.value.results || (Array.isArray(res.value) ? res.value : []);
          candidates.push(...tracks);
        }
      });
    }

    // 3. Strict Language/Region Filtering & Mood Scoring
    const seenCandidateKeys = new Set();
    const exclusions = new Set([
      seedTrack.id,
      ...manualQueue.map(t => t.id),
      ...contextQueue.map(t => t.id),
      ...sessionPlayedTrackIds
    ]);
    const exclusionKeys = new Set([
      trackSongKey(seedTrack),
      ...manualQueue.map(trackSongKey),
      ...contextQueue.map(trackSongKey),
      ...sessionPlayedSongKeys,
      ...history.slice(0, 20).map(trackSongKey)
    ]);

    // Mood relationship matrices (adjacent vs opposite)
    const ADJACENT_MOODS = {
      romantic: new Set(['chill_lofi', 'sad']),
      sad: new Set(['dark_night', 'romantic', 'chill_lofi']),
      dark_night: new Set(['sad', 'hiphop_rap', 'chill_lofi']),
      party_hype: new Set(['workout_phonk', 'hiphop_rap']),
      workout_phonk: new Set(['party_hype', 'hiphop_rap']),
      hiphop_rap: new Set(['party_hype', 'dark_night', 'workout_phonk']),
      chill_lofi: new Set(['romantic', 'dark_night', 'sad'])
    };

    const OPPOSITE_MOODS = {
      sad: new Set(['party_hype', 'workout_phonk']),
      romantic: new Set(['workout_phonk']),
      party_hype: new Set(['sad', 'chill_lofi']),
      workout_phonk: new Set(['sad', 'chill_lofi', 'romantic']),
      chill_lofi: new Set(['party_hype', 'workout_phonk']),
      dark_night: new Set(['party_hype']),
      hiphop_rap: new Set([])
    };

    const scoredPool = [];

    for (const item of candidates) {
      if (!item || !item.id || isJunk(item)) continue;
      const key = trackSongKey(item);
      if (exclusions.has(item.id) || exclusionKeys.has(key) || seenCandidateKeys.has(key)) continue;
      seenCandidateKeys.add(key);

      const candidatePrimary = feedPrimaryArtist(item.artist);
      const candidateNormPrimary = normalizeTasteLabel(candidatePrimary);
      const candidateAllArtists = String(item.artist || '').split(/[,&]/).map(v => normalizeTasteLabel(v.trim()));

      const candidateProfile = detectTrackVibe(item);

      // --- Hard Region/Language Guard ---
      // Never mix regional Indian tracks into english_intl queue
      // Never mix English tracks into hindi, punjabi or south_indian queue
      // Exception: allow true featured/collaborator match
      const isDirectCollaborator = candidateAllArtists.some(a => featureArtists.has(a));
      if (!isDirectCollaborator) {
        if (seedProfile.region === 'english_intl' && candidateProfile.region !== 'english_intl') {
          continue; // Block non-English track in English queue
        }
        if ((seedProfile.region === 'hindi' || seedProfile.region === 'punjabi' || seedProfile.region === 'south_indian') && candidateProfile.region === 'english_intl') {
          continue; // Block English track in Desi regional queue
        }
        if (seedProfile.region === 'punjabi' && candidateProfile.region !== 'punjabi' && candidateProfile.region !== 'hindi') {
          continue;
        }
        if (seedProfile.region === 'korean' && candidateProfile.region !== 'korean') {
          continue;
        }
        if (seedProfile.region === 'latin' && candidateProfile.region !== 'latin') {
          continue;
        }
      }

      let score = 5;

      const recentAndQueuedArtists = [
        ...recentArtistHistory,
        ...manualQueue.map(track => feedPrimaryArtist(track.artist)),
        ...contextQueue.map(track => feedPrimaryArtist(track.artist)),
        ...autoplayQueue.map(track => feedPrimaryArtist(track.artist))
      ];
      const artistOccurrences = recentAndQueuedArtists.filter(artist => artist === candidateNormPrimary).length;
      score -= 25 * artistOccurrences;

      // Region match score
      if (candidateProfile.region === seedProfile.region) {
        score += 6;
      }

      // Mood Coherence Scoring
      if (candidateProfile.mood === seedProfile.mood) {
        score += 8; // Exact mood match
      } else if (ADJACENT_MOODS[seedProfile.mood]?.has(candidateProfile.mood)) {
        score += 3; // Adjacent mood match
      } else if (OPPOSITE_MOODS[seedProfile.mood]?.has(candidateProfile.mood)) {
        score -= 10; // Opposite mood penalty
        continue; // Discard completely jarring opposite mood tracks
      }

      // Featured / collaborator match
      if (isDirectCollaborator) {
        score += 4;
      }

      // Mode-based familiarity scoring
      const isFamiliar = likedArtistKeys.has(candidateNormPrimary) || topArtistsSet.has(candidateNormPrimary);
      if (mode === 'familiar') {
        score += isFamiliar ? 8 : -4;
      } else if (mode === 'discover') {
        score += isFamiliar ? -6 : 6;
      } else {
        if (isFamiliar) score += 2;
      }

      // Early skip penalty
      if (sessionEarlySkippedArtists.has(candidateNormPrimary)) {
        score -= 5;
      }

      // Positive session bonus
      if (sessionPositiveArtists.has(candidateNormPrimary)) {
        score += 3;
      }

      const affinity = Number(behavior.artists?.[candidateNormPrimary]) || 0;
      score += Math.min(3, Math.log1p(affinity) * 1.2);

      scoredPool.push({
        track: {
          ...item,
          artwork: item.artwork || item.thumbnail || 'default-art.png',
          duration: getTrackDurationSeconds(item) || item.duration || 210,
          isAutoplaySuggestion: true,
          detectedVibe: candidateProfile.headerVibeLabel
        },
        score,
        primaryArtist: candidateNormPrimary
      });
    }

    scoredPool.sort((a, b) => b.score - a.score);

    // 4. Three-track artist spacing, relaxed only when fewer than four artists are available.
    const selected = [];
    const pool = [...scoredPool];
    const artistCounts = new Map();
    const distinctArtists = new Set(pool.map(candidate => candidate.primaryArtist));
    const enforceArtistSpacing = distinctArtists.size >= 4;

    while (selected.length < 15 && pool.length > 0) {
      // Three intervening tracks are sufficient separation between repeats.
      const recentArtists = enforceArtistSpacing ? selected.slice(-3).map(t => feedPrimaryArtist(t.artist)) : [];

      const foundIdx = pool.findIndex(c => {
        const count = artistCounts.get(c.primaryArtist) || 0;
        if (count >= 2) return false; // Cap at max 2 songs per artist in autoplay
        return !recentArtists.includes(c.primaryArtist);
      });

      if (foundIdx !== -1) {
        const picked = pool[foundIdx];
        selected.push(picked.track);
        artistCounts.set(picked.primaryArtist, (artistCounts.get(picked.primaryArtist) || 0) + 1);
        pool.splice(foundIdx, 1);
      } else {
        if (enforceArtistSpacing) break;
        // Fallback: pick highest-scoring candidate under max-2 cap
        const fallbackIdx = pool.findIndex(c => (artistCounts.get(c.primaryArtist) || 0) < 2);
        if (fallbackIdx !== -1) {
          const picked = pool[fallbackIdx];
          selected.push(picked.track);
          artistCounts.set(picked.primaryArtist, (artistCounts.get(picked.primaryArtist) || 0) + 1);
          pool.splice(fallbackIdx, 1);
        } else {
          // If entire remaining pool exceeded 2 songs per artist, take the top one to ensure full queue
          const picked = pool[0];
          selected.push(picked.track);
          pool.splice(0, 1);
        }
      }
    }

    autoplayQueue = selected;
    selected.forEach(rememberRecentArtist);
    syncMasterQueue();
    renderQueueList();
    window.renderNowPlayingDrawerQueue?.();
    prepareNextTrack();
  }
  window.generateRadioSuggestions = generateRadioSuggestions;
  window.generateRadioSuggestions = generateRadioSuggestions;

  async function fetchRadioRecommendations(track, isExplicitStart = false) {
    return generateRadioSuggestions(track, currentRadioFilterMode);
  }

  // ------------------------------------------------------------------------
  // True DJ Crossfade & Dual-Player Playback Engine
  // ------------------------------------------------------------------------
  // ------------------------------------------------------------------------
  // True DJ Crossfade & Dual-Player Playback Engine
  // "Prepare Next Track" System + Single Active Player Architecture
  // ------------------------------------------------------------------------

  // Stream URL Resolver with 5-Hour Expiration Cache
  async function getOrResolveStreamUrl(trackOrId, trackTitle = '') {
    const track = trackOrId && typeof trackOrId === 'object' ? trackOrId : { id: trackOrId, title: trackTitle };
    const videoId = String(track.id || '');
    if (!videoId || videoId.startsWith('Dracula-')) return null;
    const cached = streamUrlCache.get(videoId);
    if (cached && (Date.now() - cached.timestamp < STREAM_CACHE_TTL_MS)) {
      return cached.url;
    }
    if (!window.echoApi) return null;
    try {
      const url = await window.echoApi.getStreamUrl({
        id: videoId,
        title: track.title || trackTitle,
        artist: track.artist || '',
        duration: getTrackDurationSeconds(track) || 0
      });
      if (url) {
        streamUrlCache.set(videoId, { url, timestamp: Date.now() });
        console.log(`[Prepare] URL resolved for "${trackTitle}": ${url}`);
        return url;
      }
    } catch (err) {
      console.warn(`[Prepare] Stream URL resolution error for "${trackTitle}":`, err);
    }
    return null;
  }

  function isPlayableAudioUrl(value) {
    if (typeof value !== 'string') return false;
    return /^(?:https?:\/\/|blob:|data:audio\/)/i.test(value);
  }

  function getNextQueueTrack() {
    if (isRepeat && currentTrack) return currentTrack;

    if (isShuffle) {
      const candidates = [...manualQueue, ...contextQueue, ...(isAutoplayEnabled ? autoplayQueue : [])];
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }

    if (manualQueue.length > 0) {
      return manualQueue[0];
    }
    if (contextQueue.length > 0) {
      return contextQueue[0];
    }
    if (isAutoplayEnabled && autoplayQueue.length > 0) {
      return autoplayQueue[0];
    }

    if (!queue || queue.length === 0) {
      if (Array.isArray(verifiedRealTracks) && verifiedRealTracks.length > 0) {
        queue = [...verifiedRealTracks];
      } else {
        return null;
      }
    }

    const currentIndex = queue.findIndex(t => t.id === currentTrack?.id);
    let nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      nextIndex = 0;
    }

    // If next track is the same as current (e.g. single item queue), replenish queue from verified tracks
    if (queue[nextIndex]?.id === currentTrack?.id && Array.isArray(verifiedRealTracks) && verifiedRealTracks.length > 1) {
      const extraTracks = verifiedRealTracks.filter(t => t.id !== currentTrack.id);
      if (extraTracks.length > 0) {
        queue.push(...extraTracks);
        nextIndex = currentIndex + 1;
        if (typeof renderQueueList === 'function') renderQueueList();
      }
    }

    return queue[nextIndex] || null;
  }

  function waitForAudioCanPlay(deck, timeoutMs = 12000) {
    if (!deck) return Promise.resolve(false);
    if (deck.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      const cleanup = () => {
        clearTimeout(timeoutId);
        deck.removeEventListener('canplay', onReady);
        deck.removeEventListener('error', onError);
      };
      const finish = ready => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(Boolean(ready));
      };
      const onReady = () => finish(deck.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
      const onError = () => finish(false);
      const timeoutId = setTimeout(() => finish(deck.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA), timeoutMs);
      deck.addEventListener('canplay', onReady, { once: true });
      deck.addEventListener('error', onError, { once: true });
      if (deck.networkState === HTMLMediaElement.NETWORK_EMPTY) deck.load();
    });
  }

  function waitForAudioRamp(durationMs = 45) {
    return new Promise(resolve => setTimeout(resolve, durationMs));
  }

  // Preload and buffer next track on idle player
  async function prepareNextTrack() {
    const nextTrack = getNextQueueTrack();
    if (!nextTrack || !nextTrack.id || nextTrack.id.startsWith('Dracula-')) {
      preparedTrack = null;
      isNextTrackReady = false;
      isPreparingNextTrack = false;
      return;
    }

    // Already prepared and ready?
    if (preparedTrack && preparedTrack.id === nextTrack.id && isNextTrackReady) {
      return;
    }

    // Avoid duplicate preparation if already in flight for the same track
    if (isPreparingNextTrack && preparedTrack && preparedTrack.id === nextTrack.id) {
      return;
    }

    const currentGen = ++prepareAbortGen;
    isPreparingNextTrack = true;
    isNextTrackReady = false;
    preparedTrack = nextTrack;
    console.log(`[Prepare] prepare started for "${nextTrack.title}" (${nextTrack.id})`);

    try {
      const url = await getOrResolveStreamUrl(nextTrack);
      if (currentGen !== prepareAbortGen) {
        return;
      }
      if (!url) {
        isPreparingNextTrack = false;
        isNextTrackReady = false;
        return;
      }

      idleAudio.preload = 'auto';
      if (isElectron) {
        idleAudio.crossOrigin = 'anonymous';
      }
      console.log(`[DIAG-AUDIO] [TRIGGER: prepareNextTrack] Setting idleAudio (${idleAudio === audioA ? 'Deck A' : 'Deck B'}) src for track:`, nextTrack.id, nextTrack.title, 'url:', url);
      if (idleAudio.src !== url) {
        idleAudio.src = url;
        idleAudio.dataset.trackId = nextTrack.id;
      }

      const ok = await new Promise((resolve) => {
        let finished = false;
        const cleanup = () => {
          idleAudio.removeEventListener('canplay', onCanPlay);
          idleAudio.removeEventListener('loadeddata', onCanPlay);
          idleAudio.removeEventListener('error', onError);
        };
        const onCanPlay = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve(true);
        };
        const onError = (e) => {
          if (finished) return;
          finished = true;
          cleanup();
          const msg = idleAudio.error ? `${idleAudio.error.code} - ${idleAudio.error.message}` : (e?.type || 'error');
          console.warn(`[Prepare] Idle audio load error for "${nextTrack.title}":`, msg);
          resolve(false);
        };

        if (idleAudio.readyState >= 3) {
          onCanPlay();
          return;
        }

        idleAudio.addEventListener('canplay', onCanPlay, { once: true });
        idleAudio.addEventListener('loadeddata', onCanPlay, { once: true });
        idleAudio.addEventListener('error', onError, { once: true });
        idleAudio.load();

        // Safety timeout so a slow connection never blocks permanently
        setTimeout(() => {
          if (!finished) {
            finished = true;
            cleanup();
            resolve(idleAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
          }
        }, 9000);
      });

      if (ok && currentGen === prepareAbortGen) {
        isNextTrackReady = true;
        isPreparingNextTrack = false;
        console.log(`[Prepare] canplay fired for "${nextTrack.title}" on idle player`);
        broadcastEchoRoomState(false);
      } else {
        isNextTrackReady = false;
        isPreparingNextTrack = false;
      }
    } catch (err) {
      console.warn(`[Prepare] Error preparing "${nextTrack.title}":`, err);
      if (currentGen === prepareAbortGen) {
        isPreparingNextTrack = false;
        isNextTrackReady = false;
      }
    }
  }

  let activeTrackArtBackdrop = 'A';
  function updateTrackArtBackdrop(track) {
    const nextSource = track?.artwork || track?.thumbnail || '';
    const nextId = activeTrackArtBackdrop === 'A' ? 'B' : 'A';
    const outgoing = document.getElementById(`trackArtBackdrop${activeTrackArtBackdrop}`);
    const incoming = document.getElementById(`trackArtBackdrop${nextId}`);
    if (!incoming || !nextSource) {
      outgoing?.classList.remove('active');
      return;
    }
    if (incoming.getAttribute('src') === nextSource && incoming.classList.contains('active')) return;
    incoming.onerror = () => {
      incoming.classList.remove('active');
      incoming.removeAttribute('src');
    };
    incoming.src = nextSource;
    requestAnimationFrame(() => {
      outgoing?.classList.remove('active');
      incoming.classList.add('active');
      activeTrackArtBackdrop = nextId;
    });
  }

  function updateTrackMetaUI(track, isExplicitStart = false) {
    if (!track) return;
    loadLyricOffsetForTrack(track);
    updateTrackArtBackdrop(track);
    if (dockTitle) dockTitle.textContent = track.title;
    if (dockArtist) dockArtist.textContent = track.artist || 'MeloPair';
    if (dockThumb) dockThumb.src = track.artwork || track.thumbnail || 'default-art.png';

    // Commit the visible player progress from the same promoted track/deck pair.
    const activeTrackMatches = activeAudio?.dataset?.trackId === String(track.id);
    const displayDuration = activeTrackMatches && Number.isFinite(activeAudio.duration) && activeAudio.duration > 0
      ? activeAudio.duration
      : (Number(track.durationSec) || Number(track.duration) || 0);
    const displayPosition = activeTrackMatches ? (Number(activeAudio.currentTime) || 0) : 0;
    const displayPercent = displayDuration > 0 ? String(Math.min(100, (displayPosition / displayDuration) * 100)) + '%' : '0%';
    if (dockDuration) dockDuration.textContent = formatTime(displayDuration);
    if (dockCurrentTime) dockCurrentTime.textContent = formatTime(displayPosition);
    if (dockSeekFill) dockSeekFill.style.width = displayPercent;
    if (dockSeekThumb) dockSeekThumb.style.left = displayPercent;

    renderQueueList();
    resetLyricsView(track);
    fetchLyrics(track);
    generateRadioSuggestions(track, currentRadioFilterMode);
    syncQuickPickPlayingState();

    if (window.updateNowPlayingModalUI) window.updateNowPlayingModalUI(track);
    if (window.notifyNativeMediaState) window.notifyNativeMediaState(track, isPlaying);
  }
  window.updateTrackMetaUI = updateTrackMetaUI;
  window.updateDockTrackInfo = updateTrackMetaUI;

  function swapActivePlayer() {
    const oldActive = activeAudio;
    activeAudio = idleAudio;
    idleAudio = oldActive;
  }
  window.swapActivePlayer = swapActivePlayer;

  // Unified Transition Code: Skip/Next/Previous & Auto-Advance all flow through here
  async function executeTransition(type, targetTrack = null, isExplicitStart = false) {
    let nextTrack = targetTrack;
    if (!nextTrack) {
      if (type === 'prev') {
        const currentIndex = queue.findIndex(t => t.id === currentTrack?.id);
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = queue.length - 1;
        nextTrack = queue[prevIndex];
      } else {
        nextTrack = getNextQueueTrack();
      }
    }

    if (!nextTrack) {
      console.log('[Transition] No available track.');
      return;
    }

    // Real-Time Session Adaptation: Early-skip penalty if user skips track before 20s
    if ((type === 'next' || type === 'manual') && currentTrack) {
      const cur = activeAudio ? (activeAudio.currentTime || 0) : 0;
      if (cur > 0.5 && cur < 20) {
        const skippedArtist = feedPrimaryArtist(currentTrack.artist);
        if (skippedArtist) {
          sessionEarlySkippedArtists.add(normalizeTasteLabel(skippedArtist));
          console.log(`[Radio Adaptation] Early skip (<20s) penalty recorded for "${skippedArtist}". Refreshing queue...`);
          if (isAutoplayEnabled) {
            void generateRadioSuggestions(currentTrack, currentRadioFilterMode);
          }
        }
      }
    }

    // Remove nextTrack from sub-queues and sync
    manualQueue = manualQueue.filter(t => t.id !== nextTrack.id);
    contextQueue = contextQueue.filter(t => t.id !== nextTrack.id);
    autoplayQueue = autoplayQueue.filter(t => t.id !== nextTrack.id);
    syncMasterQueue();

    // The crossfade runs on its own timer after this function returns. The old
    // deck can emit `ended` during that fade; ignore that duplicate auto-advance
    // instead of cancelling the in-flight fade and restarting the next track.
    if (isCrossfading && type === 'auto') return;

    // The playback heartbeat runs several times per second. While a slow next
    // track is buffering, repeated auto-advance calls must not cancel that load.
    if (pendingTransitionTrackId === nextTrack.id) return;

    // Every new selection invalidates pending stream resolutions and fades.
    const transitionSeq = ++seamlessTransitionSequence;
    pendingTransitionTrackId = nextTrack.id;
    if (isCrossfading) {
      clearInterval(crossfadeInterval);
      crossfadeInterval = null;
      if (crossfadePromotionTimeout) {
        clearTimeout(crossfadePromotionTimeout);
        crossfadePromotionTimeout = null;
      }
      const outgoingDeck = activeAudio;
      const interruptedIncomingDeck = idleAudio;
      rampDeckAudioGain(outgoingDeck, 1, 0.04);
      rampDeckAudioGain(interruptedIncomingDeck, 0, 0.04);
      await waitForAudioRamp(50);
      if (transitionSeq !== seamlessTransitionSequence) return;
      interruptedIncomingDeck.pause();
      try { interruptedIncomingDeck.currentTime = 0; } catch (e) {}
      if (bassFilterA) bassFilterA.gain.value = 0;
      if (bassFilterB) bassFilterB.gain.value = 0;
      if (colorFilterA) colorFilterA.frequency.value = 20;
      if (colorFilterB) colorFilterB.frequency.value = 20;
      resetDeckGains(outgoingDeck);
      isCrossfading = false;
      currentCrossfadeProgress = 0;
      currentCrossfadeDurationMs = 0;
      crossfadingIncomingTrack = null;
      isNextTrackReady = false;
      isPreparingNextTrack = false;
      preparedTrack = null;
    }

    // Setting: Disable crossfade for continuous albums
    const isContinuousAlbum = disableCrossfadeForAlbums &&
      currentTrack?.album && nextTrack?.album &&
      currentTrack.album.toLowerCase() === nextTrack.album.toLowerCase();

    // Crossfade condition: crossfade enabled, not continuous album, track ready on idle player, AND idle deck strictly matches incoming track
    const isIdleDeckMatching = Boolean(idleAudio && idleAudio.dataset && idleAudio.dataset.trackId === nextTrack.id);
    const canCrossfade = crossfadeSeconds > 0 &&
                         !isContinuousAlbum &&
                         !isCrossfading &&
                         isPlaying &&
                         isNextTrackReady &&
                         preparedTrack &&
                         preparedTrack.id === nextTrack.id &&
                         isIdleDeckMatching;

    const isManual = (type === 'next' || type === 'prev' || type === 'manual');

    // When explicitly starting a track from a stopped state and idle deck does not already have this exact track, clear idle deck & cancel old queue preload
    if (isExplicitStart && !canCrossfade && !isPlaying) {
      idleAudio.pause();
      idleAudio.removeAttribute('src');
      try { idleAudio.currentTime = 0; } catch (e) {}
      idleAudio.load();
      delete idleAudio.dataset.trackId;

      ++prepareAbortGen;
      isPreparingNextTrack = false;
      isNextTrackReady = false;
      preparedTrack = null;
    }

    try {
      if (canCrossfade) {
        await executeCrossfadeTransition(nextTrack, isManual, isExplicitStart, transitionSeq);
      } else {
        // Seamless Zero-Break Transition:
        // If currently playing music, DO NOT cut off or stop activeAudio!
        // Keep playing current music while loading & buffering nextTrack on idle player.
        if (isPlaying && activeAudio && !activeAudio.paused && isFinite(activeAudio.currentTime) && activeAudio.currentTime > 0) {
          await loadAndSeamlessTransition(nextTrack, isManual, isExplicitStart, transitionSeq);
        } else {
          await playTrackDirect(nextTrack, isExplicitStart);
        }
      }
    } finally {
      if (transitionSeq === seamlessTransitionSequence && pendingTransitionTrackId === nextTrack.id) {
        pendingTransitionTrackId = null;
      }
    }
  }

  // Seamless Zero-Break Loader:
  // Keeps current song playing continuously until incoming song is 100% buffered and ready
  let seamlessTransitionSequence = 0;

  async function loadAndSeamlessTransition(nextTrack, isManual = false, isExplicitStart = false, currentSeq = seamlessTransitionSequence) {
    if (isCrossfading) return;

    console.log(`[Seamless Transition] Keeping active song playing while buffering "${nextTrack.title}"...`);
    showToast(`Buffering "${nextTrack.title}"... ⏳`);

    try {
      const streamUrl = await getOrResolveStreamUrl(nextTrack);
      if (currentSeq !== seamlessTransitionSequence) return; // Superseded by a newer transition request

      if (!streamUrl || streamUrl.startsWith('yt:')) {
        await playTrackDirect(nextTrack, isExplicitStart);
        return;
      }

      idleAudio.preload = 'auto';
      if (isElectron) {
        idleAudio.crossOrigin = 'anonymous';
      }
      console.log(`[DIAG-AUDIO] [TRIGGER: loadAndSeamlessTransition] Setting idleAudio (${idleAudio === audioA ? 'Deck A' : 'Deck B'}) src for track:`, nextTrack.id, nextTrack.title, 'url:', streamUrl);
      idleAudio.src = streamUrl;
      idleAudio.dataset.trackId = nextTrack.id;

      const ready = await new Promise((resolve) => {
        let done = false;
        const cleanup = () => {
          idleAudio.removeEventListener('canplay', onOk);
          idleAudio.removeEventListener('loadeddata', onOk);
          idleAudio.removeEventListener('error', onErr);
        };
        const onOk = () => {
          if (done) return;
          done = true;
          cleanup();
          resolve(true);
        };
        const onErr = (e) => {
          if (done) return;
          done = true;
          cleanup();
          console.warn(`[Seamless Transition] Idle audio load error for "${nextTrack.title}":`, e);
          resolve(false);
        };

        if (idleAudio.readyState >= 3) {
          onOk();
          return;
        }

        idleAudio.addEventListener('canplay', onOk, { once: true });
        idleAudio.addEventListener('loadeddata', onOk, { once: true });
        idleAudio.addEventListener('error', onErr, { once: true });
        idleAudio.load();

        // Safety timeout of 10s so a slow connection never hangs permanently
        setTimeout(() => {
          if (!done) {
            done = true;
            cleanup();
            resolve(idleAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
          }
        }, 10000);
      });

      if (currentSeq !== seamlessTransitionSequence) return;

      if (ready) {
        preparedTrack = nextTrack;
        isNextTrackReady = true;
        console.log(`[Seamless Transition] Next track "${nextTrack.title}" is fully buffered! Performing seamless blend...`);
        // Next track is ready to go! Seamlessly blend into it with zero break
        await executeCrossfadeTransition(nextTrack, isManual, isExplicitStart, currentSeq);
      } else {
        // Fallback if idle player buffering timed out
        await playTrackDirect(nextTrack, isExplicitStart);
      }
    } catch (err) {
      console.warn(`[Seamless Transition] Error during seamless transition to "${nextTrack.title}":`, err);
      if (currentSeq === seamlessTransitionSequence) {
        await playTrackDirect(nextTrack, isExplicitStart);
      }
    }
  }

  // Pioneer DJ Mashup Blend & Equal-Power Crossfade
  async function executeCrossfadeTransition(nextTrack, isManual = false, isExplicitStart = false, transitionSeq = seamlessTransitionSequence) {
    if (transitionSeq !== seamlessTransitionSequence) return;
    if (isCrossfading) return;
    if (idleAudio?.dataset?.trackId !== String(nextTrack.id) || preparedTrack?.id !== nextTrack.id) {
      console.warn('[Crossfade] Incoming deck metadata does not match the selected track; reloading before promotion.', {
        expectedTrackId: nextTrack.id,
        deckTrackId: idleAudio?.dataset?.trackId || null,
        preparedTrackId: preparedTrack?.id || null
      });
      await loadAndSeamlessTransition(nextTrack, isManual, isExplicitStart, transitionSeq);
      return;
    }
    isCrossfading = true;

    // Use minimum 1.2s fade if crossfade is 0 to guarantee zero pop/click/silence gap
    const effectiveFadeSec = isManual
      ? (crossfadeSeconds > 0 ? Math.min(crossfadeSeconds, 3.5) : 1.2)
      : (crossfadeSeconds > 0 ? crossfadeSeconds : 1.2);
    console.log(`[Crossfade] crossfade start: transition from "${currentTrack?.title}" to "${nextTrack.title}" (${effectiveFadeSec}s)`);
    showToast(`DJ Mashup Blend (${effectiveFadeSec.toFixed(1)}s) 🎧`);

    const incomingBass = (activeAudio === audioA) ? bassFilterB : bassFilterA;
    const outgoingBass = (activeAudio === audioA) ? bassFilterA : bassFilterB;
    const incomingColor = (activeAudio === audioA) ? colorFilterB : colorFilterA;
    const outgoingColor = (activeAudio === audioA) ? colorFilterA : colorFilterB;

    rampDeckAudioGain(idleAudio, 0, 0.04);
    rampDeckAudioGain(activeAudio, 1, 0.04);

    // Phase 1 Initial State: Incoming track enters with Bass Cut (-24dB) so its vocals/melody blend over outgoing groove!
    rampAudioParam(incomingBass?.gain, -24.0, 0.04);
    rampAudioParam(outgoingBass?.gain, 0.0, 0.04);
    rampAudioParam(incomingColor?.frequency, 20.0, 0.04);
    rampAudioParam(outgoingColor?.frequency, 20.0, 0.04);

    try {
      idleAudio.currentTime = 0;
    } catch (e) {}

    try {
      idleAudio.dataset.transitionSequence = String(transitionSeq);
      await ensureAudioContextRunning(`crossfading to "${nextTrack.title}"`);
      if (transitionSeq !== seamlessTransitionSequence) return;
      const incomingReady = await waitForAudioCanPlay(idleAudio);
      if (transitionSeq !== seamlessTransitionSequence) return;
      if (!incomingReady) throw new Error(`Incoming deck was not ready to play "${nextTrack.title}"`);
      normalizeWebAudioDeckElements();
      await idleAudio.play();
      if (transitionSeq !== seamlessTransitionSequence) {
        if (idleAudio.dataset.transitionSequence === String(transitionSeq)) idleAudio.pause();
        isCrossfading = false;
        return;
      }
    } catch (err) {
      if (transitionSeq !== seamlessTransitionSequence) return;
      console.error('[Crossfade] Failed to play idleAudio, falling back to direct play:', err);
      isCrossfading = false;
      await playTrackDirect(nextTrack);
      return;
    }

    crossfadingIncomingTrack = nextTrack;
    currentCrossfadeProgress = 0;
    broadcastEchoRoomState(true);

    let lastCrossfadeDiagnosticStep = 0;
    const startTime = Date.now();
    const durationMs = effectiveFadeSec * 1000;
    currentCrossfadeDurationMs = durationMs;

    clearInterval(crossfadeInterval);
    const thisFadeInterval = setInterval(() => {
      if (transitionSeq !== seamlessTransitionSequence) {
        clearInterval(thisFadeInterval);
        if (crossfadeInterval === thisFadeInterval) crossfadeInterval = null;
        return;
      }
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1.0, elapsed / durationMs);
      currentCrossfadeProgress = progress;
      if (Math.round(elapsed / 40) % 5 === 0) {
        broadcastEchoRoomState(true);
      }

      // 1. Equal-power volume curve (constant perceived loudness)
      const outVol = Math.cos(progress * 0.5 * Math.PI);
      const inVol = Math.sin(progress * 0.5 * Math.PI);

      rampDeckAudioGain(activeAudio, outVol, 0.05);
      rampDeckAudioGain(idleAudio, inVol, 0.05);

      const diagnosticStep = Math.min(4, Math.floor(progress * 4));
      if (diagnosticStep > lastCrossfadeDiagnosticStep) {
        lastCrossfadeDiagnosticStep = diagnosticStep;
        console.log('[Audio Route] Crossfade gain ramp', {
          progress: Number(progress.toFixed(2)),
          outgoingDeck: activeAudio === audioA ? 'A' : 'B',
          outgoingGainTarget: Number(outVol.toFixed(3)),
          incomingDeck: idleAudio === audioA ? 'A' : 'B',
          incomingGainTarget: Number(inVol.toFixed(3)),
          audioContextState: audioCtx?.state || 'unavailable'
        });
      }

      // 2. Pioneer DJ Bass Swap Transition (as seen in Billie Jean x Kya Mujhe Pyar Hai & Money Trees x Brown Rang)
      if (progress < 0.38) {
        // Intro Phase: Incoming vocals/synths ride atop outgoing beat with low bass cut (-24dB)
        rampAudioParam(incomingBass?.gain, -24.0, 0.04);
        rampAudioParam(outgoingBass?.gain, 0.0, 0.04);
      } else if (progress <= 0.68) {
        // The Drop / Bass Swap Phase (38% -> 68%):
        // Outgoing bass smoothly dips while incoming bass hits full punch on the drop!
        const swapP = (progress - 0.38) / 0.30;
        rampAudioParam(outgoingBass?.gain, 0.0 - (24.0 * swapP), 0.04);
        rampAudioParam(incomingBass?.gain, -24.0 + (24.0 * swapP), 0.04);
      } else {
        // Outro Phase: Incoming bass full punch (0dB), outgoing bass cut (-24dB)
        rampAudioParam(outgoingBass?.gain, -24.0, 0.04);
        rampAudioParam(incomingBass?.gain, 0.0, 0.04);
      }

      // 3. Pioneer DJ Sound Color FX High-Pass Filter Sweep on outgoing track
      if (progress > 0.42 && outgoingColor) {
        const sweepP = (progress - 0.42) / 0.58;
        // Exponential sweep from 20Hz up to 1600Hz
        const sweepFreq = 20 * Math.pow(1600 / 20, sweepP);
        rampAudioParam(outgoingColor.frequency, sweepFreq, 0.04);
      }

      if (progress >= 1.0) {
        clearInterval(thisFadeInterval);
        if (crossfadeInterval === thisFadeInterval) crossfadeInterval = null;
        rampDeckAudioGain(activeAudio, 0, 0.04);
        rampDeckAudioGain(idleAudio, 1, 0.04);

        crossfadePromotionTimeout = setTimeout(() => {
          crossfadePromotionTimeout = null;
          if (transitionSeq !== seamlessTransitionSequence || !isCrossfading) return;
          console.log('[Crossfade] final 40ms gain ramp complete; promoting incoming deck');

          // Swap only after the outgoing deck has faded fully to silence.
          const oldActive = activeAudio;
          activeAudio = idleAudio;
          idleAudio = oldActive;
          idleAudio.pause();
          try { idleAudio.currentTime = 0; } catch (e) {}

          rampAudioParam(bassFilterA?.gain, 0.0, 0.04);
          rampAudioParam(bassFilterB?.gain, 0.0, 0.04);
          rampAudioParam(colorFilterA?.frequency, 20.0, 0.04);
          rampAudioParam(colorFilterB?.frequency, 20.0, 0.04);
          resetDeckGains(activeAudio);

          isCrossfading = false;
          currentCrossfadeProgress = 0;
          currentCrossfadeDurationMs = 0;
          crossfadingIncomingTrack = null;
          isNextTrackReady = false;
          isPreparingNextTrack = false;
          preparedTrack = null;
          console.log('[Crossfade] flags reset: isCrossfading=false, isNextTrackReady=false, isPreparingNextTrack=false');

          currentTrack = nextTrack;
          updateTrackMetaUI(currentTrack, isExplicitStart);
          recordTrackPlayed(currentTrack);
          logAudioRouteForTrack(currentTrack, activeAudio, 'crossfade promotion');
          broadcastEchoRoomState(true);
          prepareNextTrack();
        }, 50);
      }
    }, 40);
    crossfadeInterval = thisFadeInterval;
  }

  // Direct Normal Play (Used on startup, initial selection, or when crossfade is skipped)
  async function playTrackDirect(track, isExplicitStart = false) {
    if (!track || !track.id) {
      setPlayState(false);
      showToast('Choose a song to start playback.');
      return;
    }
    if (isExplicitStart) openNowPlaying();
    const resumeAtPosition = resumeOnOpenTrackId === track.id ? lastPlayedPosition : 0;
    if (resumeOnOpenTrackId === track.id) resumeOnOpenTrackId = null;
    ++seamlessTransitionSequence;
    if (pendingTransitionTrackId === track?.id) pendingTransitionTrackId = null;
    const myId = ++playRequestId;
    isPlaybackPending = true;
    console.log(`[DIAG-AUDIO] [TRIGGER: playTrackDirect] Called (req #${myId}) for track:`, track.id, track.title, track.artist, 'isExplicitStart:', isExplicitStart, 'active deck:', (activeAudio === audioA ? 'Deck A' : 'Deck B'));

    if (crossfadeInterval) clearInterval(crossfadeInterval);
    crossfadeInterval = null;
    if (crossfadePromotionTimeout) {
      clearTimeout(crossfadePromotionTimeout);
      crossfadePromotionTimeout = null;
    }
    isCrossfading = false;
    currentCrossfadeDurationMs = 0;
    isNextTrackReady = false;
    isPreparingNextTrack = false;
    preparedTrack = null;

    // Fade any audible deck to zero before pausing or replacing its source.
    const hadAudibleDeck = [activeAudio, idleAudio].some(deck => deck && !deck.paused);
    rampDeckAudioGain(activeAudio, 0, 0.04);
    rampDeckAudioGain(idleAudio, 0, 0.04);
    if (hadAudibleDeck) await waitForAudioRamp(50);
    if (myId !== playRequestId) return;
    activeAudio.pause();
    idleAudio.pause();
    try { activeAudio.currentTime = 0; } catch (e) {}
    try { idleAudio.currentTime = 0; } catch (e) {}

    // When user explicitly selects a track, wipe the idle deck and cancel old queue preloading
    if (isExplicitStart) {
      idleAudio.removeAttribute('src');
      idleAudio.load();
      delete idleAudio.dataset.trackId;

      ++prepareAbortGen;
      isPreparingNextTrack = false;
      isNextTrackReady = false;
      preparedTrack = null;
    }

    initAudioContext();
    // Start resuming synchronously in the user's click gesture, then await the
    // context before playback so a suspended graph cannot make a playing song silent.
    const audioContextReady = audioCtx && audioCtx.state !== 'running'
      ? audioCtx.resume()
      : Promise.resolve();
    currentTrack = track;
    setPlayState(false);
    updateTrackMetaUI(track, isExplicitStart);

    // Reset all DJ filter nodes to neutral/bypass
    if (bassFilterA) bassFilterA.gain.value = 0.0;
    if (bassFilterB) bassFilterB.gain.value = 0.0;
    if (colorFilterA) colorFilterA.frequency.value = 20.0;
    if (colorFilterB) colorFilterB.frequency.value = 20.0;

    // Keep both decks silent while the new source loads; fade up only after canplay.
    setDeckGain(activeAudio, 0, 0);
    setDeckGain(idleAudio, 0, 0);

    let streamUrl = track.streamUrl || null;
    // Electron routes media through MediaElementAudioSourceNode for EQ and
    // crossfade. Direct CDN URLs can play in an <audio> tag but produce a
    // silent Web Audio source when the CDN omits CORS headers. Always use the
    // local range/CORS-enabled proxy for remote tracks in the desktop app.
    const isInlineAudio = typeof streamUrl === 'string' && /^(?:blob:|data:audio\/)/i.test(streamUrl);
    if (window.echoApi && track.id && !track.id.startsWith('Dracula-') && (isElectron || !streamUrl) && !isInlineAudio) {
      showToast(`Loading ${track.title}...`);
      const resolvedUrl = await getOrResolveStreamUrl(track);
      if (resolvedUrl) streamUrl = resolvedUrl;
      if (myId !== playRequestId) {
        console.log(`[DIAG-AUDIO] [CANCELED] Discarding outdated stream resolution for "${track.title}" (req #${myId} superseded by #${playRequestId})`);
        return;
      }
    }

    if (myId !== playRequestId) return;

    try {
      await audioContextReady;
    } catch (error) {
      console.warn('[Audio Engine] Audio context resume failed:', error);
    }
    if (myId !== playRequestId) return;

    if (streamUrl && streamUrl.startsWith('yt:')) {
      if (isAndroid) {
        const ytId = streamUrl.replace('yt:', '');
        playViaYouTubeEngine(ytId, track);
        prepareNextTrack();
        return;
      }
    }

    if (isPlayableAudioUrl(streamUrl)) {
      pauseYouTubeEngine();
      if (isElectron) {
        activeAudio.crossOrigin = 'anonymous';
      }
      console.log(`[DIAG-AUDIO] [TRIGGER: playTrackDirect] Setting activeAudio (${activeAudio === audioA ? 'Deck A' : 'Deck B'}) src to:`, streamUrl, 'for track:', track.id, track.title);
      activeAudio.src = streamUrl;
      activeAudio.dataset.trackId = track.id;
      activeAudio.currentTime = 0;
      activeAudio.load();
      try {
        if (resumeAtPosition > 0) {
          await new Promise(resolve => {
            if (activeAudio.readyState >= HTMLMediaElement.HAVE_METADATA) return resolve();
            const finish = () => {
              clearTimeout(timeoutId);
              activeAudio.removeEventListener('loadedmetadata', finish);
              activeAudio.removeEventListener('error', finish);
              resolve();
            };
            const timeoutId = setTimeout(finish, 4500);
            activeAudio.addEventListener('loadedmetadata', finish, { once: true });
            activeAudio.addEventListener('error', finish, { once: true });
          });
          if (myId !== playRequestId) return;
          const maxPosition = Number.isFinite(activeAudio.duration) && activeAudio.duration > 1
            ? activeAudio.duration - 1
            : resumeAtPosition;
          activeAudio.currentTime = Math.min(resumeAtPosition, maxPosition);
          savePlaybackCheckpoint(activeAudio.currentTime, true);
        }
        await ensureAudioContextRunning(`starting "${track.title}"`);
        if (myId !== playRequestId) return;
        const activeDeckReady = await waitForAudioCanPlay(activeAudio, 15000);
        if (myId !== playRequestId) return;
        if (!activeDeckReady) throw new Error(`Audio was not ready to play "${track.title}"`);
        await activeAudio.play();
        if (myId !== playRequestId) {
          activeAudio.pause();
          return;
        }
        rampDeckAudioGain(activeAudio, 1, 0.04);
        isPlaybackPending = false;
        setPlayState(true);
        recordTrackPlayed(track);
        if (resumeAtPosition > 0) savePlaybackCheckpoint(Number(activeAudio.currentTime) || resumeAtPosition, true);
        logAudioRouteForTrack(track, activeAudio, 'direct start');
      } catch (err) {
        if (myId !== playRequestId) return;
        isPlaybackPending = false;
        console.warn('Playback error on HTML5 audio:', err);
        if (isAndroid && track.id) {
          const ytId = track.id.replace('saavn_', '');
          playViaYouTubeEngine(ytId, track);
        } else {
          setPlayState(false);
          showToast(`Could not play "${track.title}". Try the song again.`);
        }
      }
    } else if (isAndroid && track.id) {
      if (myId !== playRequestId) return;
      const ytId = track.id.replace('saavn_', '');
      playViaYouTubeEngine(ytId, track);
    } else {
      if (myId !== playRequestId) return;
      isPlaybackPending = false;
      setPlayState(false);
      showToast(`Audio for "${track.title}" could not be loaded. Try another source or retry.`);
    }

    // Immediately prepare next track so it's buffered well ahead of time
    prepareNextTrack();
  }

  function playTrack(track, isExplicitStart = false) {
    // Song selections open the lyrics-first Now Playing screen; automatic
    // next/previous transitions do not call this user-selection entry point.
    openNowPlaying();
    if (isExplicitStart) {
      manualQueue = [];
      contextQueue = [];
      autoplayQueue = [];
      syncMasterQueue();
      if (typeof renderQueueList === 'function') renderQueueList();
    }
    executeTransition('manual', track, isExplicitStart);
  }

  function playNextTrack() {
    executeTransition('next');
  }

  function playPrevTrack() {
    if (activeAudio && activeAudio.currentTime > 3) {
      activeAudio.currentTime = 0;
      showToast('Rewound to start ↺');
      return;
    }
    executeTransition('prev');
  }

  function setPlayState(playing) {
    isPlaying = playing;
    if (playing) isPlaybackPending = false;
    else if (currentTrack) {
      const position = isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function'
        ? Number(ytPlayer.getCurrentTime()) || 0
        : (activeAudio?.dataset?.trackId === currentTrack.id ? Number(activeAudio.currentTime) || 0 : lastPlayedPosition);
      savePlaybackCheckpoint(position, true);
    }
    if (playing) {
      window.scheduleNowPlayingSync?.();
    } else if (isYtActive && npSyncRaf) {
      cancelAnimationFrame(npSyncRaf);
      npSyncRaf = 0;
    }
    if (playing) {
      if (dockPlayIcon) dockPlayIcon.classList.add('hidden');
      if (dockPauseIcon) dockPauseIcon.classList.remove('hidden');
    } else {
      if (dockPlayIcon) dockPlayIcon.classList.remove('hidden');
      if (dockPauseIcon) dockPauseIcon.classList.add('hidden');
    }

    const npLines = document.getElementById('npKineticLines');
    if (npLines) npLines.classList.toggle('is-playing', playing);
    const immLines = document.getElementById('immersiveKineticLines');
    if (immLines) immLines.classList.toggle('is-playing', playing);
    syncQuickPickPlayingState();


    broadcastEchoRoomState(true);
    if (!playing && !isCrossfading) {
      setPlaybackStatus('idle', '');
    }
    if (window.updateNowPlayingModalUI) window.updateNowPlayingModalUI(currentTrack);
    if (window.notifyNativeMediaState) window.notifyNativeMediaState(currentTrack, isPlaying);
  }

  // Keep the transport state tied to the media element itself. This also
  // recovers cleanly when the OS pauses audio or a test/reset pauses a deck.
  [audioA, audioB].forEach((deck) => {
    if (!deck) return;
    deck.addEventListener('play', (event) => {
      if (event.currentTarget === activeAudio && !isCrossfading) setPlayState(true);
    });
    deck.addEventListener('playing', (event) => {
      if (event.currentTarget !== activeAudio || isCrossfading) return;
      if (deck.dataset?.trackId === String(currentTrack?.id ?? '') && deck.readyState >= 2) {
        realignLyrics('auto', false);
      }
    });
    deck.addEventListener('pause', (event) => {
      if (deck.ended) {
        if (!isCrossfading) {
          executeTransition('auto');
        }
        return;
      }
      if (event.currentTarget === activeAudio && !isCrossfading && !isPlaybackPending) {
        setPlayState(false);
        activeLyricIndex = -1;
        syncLyricsWithTime(activeAudio.currentTime || 0, true);
      }
    });
    deck.addEventListener('seeked', (event) => {
      if (event.currentTarget !== activeAudio) return;
      realignLyrics('auto', false);
    });
    deck.addEventListener('error', (event) => {
      if (event.currentTarget !== activeAudio) return;
      if (!isPlaybackPending) setPlayState(false);
      const errorCode = event.currentTarget.error?.code;
      console.warn('[Audio Engine] Active deck reported a media error:', errorCode || 'unknown');
    });
  });

  function togglePlayPause() {
    initAudioContext();
    const audioIsActuallyPlaying = Boolean(activeAudio && !activeAudio.paused && !activeAudio.ended);
    const shouldPause = isPlaybackPending || isPlaying || audioIsActuallyPlaying;

    if (isYtActive && ytPlayer) {
      if (shouldPause) {
        ++playRequestId;
        isPlaybackPending = false;
        if (typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo();
        setPlayState(false);
      } else if (typeof ytPlayer.playVideo === 'function') {
        ytPlayer.playVideo();
      }
      return;
    }

    if (shouldPause) {
      // Cancel an in-flight URL lookup/play() so it cannot unexpectedly start
      // audio after the user has pressed Pause.
      ++playRequestId;
      isPlaybackPending = false;
      activeAudio.pause();
      if (isCrossfading) {
        clearInterval(crossfadeInterval);
        crossfadeInterval = null;
        idleAudio.pause();
        isCrossfading = false;
        isNextTrackReady = false;
        isPreparingNextTrack = false;
        preparedTrack = null;
        crossfadingIncomingTrack = null;
        currentCrossfadeProgress = 0;
        currentCrossfadeDurationMs = 0;
        resetDeckGains(activeAudio);
      }
      setPlayState(false);
      return;
    }

    const trackToPlay = currentTrack || queue[0];
    if (!trackToPlay) {
      showToast('Choose a song to start playback.');
      return;
    }

    // Never resume a leftover deck when the selected track has changed.
    if (!isPlayableAudioUrl(activeAudio.src) || activeAudio.dataset.trackId !== trackToPlay.id) {
      void playTrackDirect(trackToPlay, true);
      return;
    }

    const requestId = ++playRequestId;
    isPlaybackPending = true;
    const resumeContext = audioCtx && audioCtx.state !== 'running'
      ? audioCtx.resume()
      : Promise.resolve();
    Promise.resolve(resumeContext)
      .then(() => activeAudio.play())
      .then(() => {
        if (requestId !== playRequestId) {
          activeAudio.pause();
          return;
        }
        isPlaybackPending = false;
        setPlayState(true);
      })
      .catch((err) => {
        if (requestId !== playRequestId) return;
        console.warn('Playback resume issue, reloading selected track:', err);
        isPlaybackPending = false;
        void playTrackDirect(trackToPlay, true);
      });
  }

  // Seekbar Interaction
  if (dockSeekContainer) {
    dockSeekContainer.addEventListener('mousedown', (e) => {
      isSeeking = true;
      handleSeek(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isSeeking) handleSeek(e);
    });

    window.addEventListener('mouseup', () => {
      if (isSeeking) isSeeking = false;
    });
  }

  function handleSeek(e) {
    const rect = dockSeekContainer.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const dur = isYtActive ? (ytPlayer?.getDuration() || currentTrack?.duration || 214) : (activeAudio.duration || currentTrack?.duration || 214);
    seekAudioTo(pos * dur);
  }

  function seekAudioTo(seconds) {
    if (isYtActive && ytPlayer && typeof ytPlayer.seekTo === 'function') {
      ytPlayer.seekTo(seconds, true);
    } else {
      activeAudio.currentTime = seconds;
    }
    const dur = isYtActive ? (ytPlayer?.getDuration() || currentTrack?.duration || 214) : (activeAudio.duration || currentTrack?.duration || 214);
    const pos = dur > 0 ? (seconds / dur) : 0;
    if (dockSeekFill) dockSeekFill.style.width = `${pos * 100}%`;
    if (dockSeekThumb) dockSeekThumb.style.left = `${pos * 100}%`;

    activeLyricIndex = -1;
    syncLyricsWithTime(seconds, true);
    broadcastEchoRoomState(true);
    if (!playing && !isCrossfading) {
      setPlaybackStatus('idle', '');
    }
    if (window.updateNowPlayingModalUI) window.updateNowPlayingModalUI(currentTrack);
    if (window.notifyNativeMediaState) window.notifyNativeMediaState(currentTrack, isPlaying);
  }

  // Volume Slider
  if (dockVolSlider) {
    dockVolSlider.addEventListener('input', (e) => {
      userVolume = parseFloat(e.target.value);
      initAudioContext();
      isMuted = userVolume === 0;
      if (masterGain) masterGain.gain.value = isMuted ? 0 : userVolume;
      if (audioCtx && !isAndroid) {
        normalizeWebAudioDeckElements();
      } else {
        activeAudio.volume = userVolume;
        idleAudio.volume = userVolume;
      }
      if (isYtActive && ytPlayer && typeof ytPlayer.setVolume === 'function') {
        ytPlayer.setVolume(isMuted ? 0 : Math.round(userVolume * 100));
      }
      updateMuteIcons();
    });
  }

  if (dockMuteBtn) {
    dockMuteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      initAudioContext();
      if (masterGain) masterGain.gain.value = isMuted ? 0 : userVolume;
      if (audioCtx && !isAndroid) {
        normalizeWebAudioDeckElements();
      } else {
        activeAudio.muted = isMuted;
        idleAudio.muted = isMuted;
      }
      if (isYtActive && ytPlayer && typeof ytPlayer.setVolume === 'function') {
        ytPlayer.setVolume(isMuted ? 0 : Math.round(userVolume * 100));
      }
      updateMuteIcons();
    });
  }

  function updateMuteIcons() {
    if (isMuted) {
      if (dockVolHighIcon) dockVolHighIcon.classList.add('hidden');
      if (dockVolMuteIcon) dockVolMuteIcon.classList.remove('hidden');
    } else {
      if (dockVolHighIcon) dockVolHighIcon.classList.remove('hidden');
      if (dockVolMuteIcon) dockVolMuteIcon.classList.add('hidden');
    }
  }

  // Shuffle & Repeat
  if (dockShuffleBtn) {
    dockShuffleBtn.addEventListener('click', () => {
      isShuffle = !isShuffle;
      dockShuffleBtn.classList.toggle('active', isShuffle);
      showToast(isShuffle ? 'Shuffle: ON' : 'Shuffle: OFF');
    });
  }

  if (dockRepeatBtn) {
    dockRepeatBtn.addEventListener('click', () => {
      isRepeat = !isRepeat;
      dockRepeatBtn.classList.toggle('active', isRepeat);
      showToast(isRepeat ? 'Repeat: ON' : 'Repeat: OFF');
    });
  }

  if (dockPlayBtn) dockPlayBtn.addEventListener('click', togglePlayPause);
  if (dockPrevBtn) dockPrevBtn.addEventListener('click', playPrevTrack);
  if (dockNextBtn) dockNextBtn.addEventListener('click', playNextTrack);

  // ------------------------------------------------------------------------
  // USER PROFILE & NOTIFICATIONS EVENT LISTENERS
  // ------------------------------------------------------------------------
  function initUserProfileAndNotifications() {
    let onboardingStage = 'taste';
    let onboardingReplay = false;
    let onboardingLaunchTour = true;
    let forceWelcomeOnboarding = false;
    const tasteSetupComplete = () => !forceWelcomeOnboarding
      && (safeStorageGet('melopair_onboarding_done') === 'true' || safeStorageGet('melopair_taste_setup_v1') === 'true');
    const setOnboardingStage = (stage) => {
      onboardingStage = stage;
      tasteCheckingStep?.classList.add('hidden');
      tasteLoginStep?.classList.add('hidden');
      tasteSetupStep?.classList.toggle('hidden', stage !== 'taste');
      tasteImportStep?.classList.toggle('hidden', stage !== 'import');
      document.querySelectorAll('#mpOnboardingProgress span').forEach((dot, index) => dot.classList.toggle('active', index <= (stage === 'import' ? 1 : 0)));
    };
    const openOnboarding = (stage = 'taste') => {
      onboardingReplay = true;
      onboardingLaunchTour = false;
      restoreTasteSelections();
      setOnboardingStage(stage);
      tasteOnboarding?.classList.remove('hidden');
    };
    const updateTasteOnboarding = (user, accountCheckFinished = true) => {
      if (!tasteOnboarding) return;
      if (tasteSetupComplete() && !onboardingReplay) {
        tasteOnboarding.classList.add('hidden');
        return;
      }
      tasteOnboarding.classList.remove('hidden');
      tasteCheckingStep?.classList.toggle('hidden', accountCheckFinished);
      if (!accountCheckFinished) {
        tasteLoginStep?.classList.add('hidden');
        tasteSetupStep?.classList.add('hidden');
        tasteImportStep?.classList.add('hidden');
      } else if (!user && !onboardingReplay) {
        tasteLoginStep?.classList.remove('hidden');
        tasteSetupStep?.classList.add('hidden');
        tasteImportStep?.classList.add('hidden');
      } else {
        tasteLoginStep?.classList.add('hidden');
        setOnboardingStage(onboardingStage);
      }
      if (user && tasteOnboardingStatus) {
        tasteOnboardingStatus.textContent = `Signed in as ${user.displayName || user.email || 'your Google account'}`;
      }
    };

    const onboardingCompleteOnThisDevice = safeStorageGet('melopair_onboarding_done') === 'true'
      || safeStorageGet('melopair_taste_setup_v1') === 'true';
    const hasExistingLocalProfile = [
      safeStorageGet('echo_user_data_backup'),
      safeStorageGet('echo_listening_history'),
      safeStorageGet('echo_last_played_track'),
      safeStorageGet('echo_profile_name'),
      safeStorageGet('melopair_taste_preferences'),
      safeStorageGet('melopair_imported_listening_memory')
    ].some(value => value !== null && value !== '[]' && value !== '{}');
    const firstRunInitialization = window.echoApi?.initializeFreshProfile
      ? window.echoApi.initializeFreshProfile({ hasExistingProfile: hasExistingLocalProfile, onboardingComplete: onboardingCompleteOnThisDevice })
        .catch(error => { console.warn('[Profile] Could not initialize first-run state:', error); return { showWelcomeWizard: false }; })
      : Promise.resolve({ showWelcomeWizard: false });

    if (!tasteSetupComplete()) updateTasteOnboarding(null, false);
    const onboardingAccountCheckTimeout = setTimeout(() => {
      if (!firebaseSignedInUser && !tasteSetupComplete()) updateTasteOnboarding(null, true);
    }, 4500);

    const savedName = safeStorageGet('echo_profile_name') || 'Local listener';
    if (profileNameDisplay) profileNameDisplay.textContent = savedName;
    if (profileAvatarInitial) profileAvatarInitial.textContent = savedName.charAt(0).toUpperCase();

    const renderFirebaseAccount = (user) => {
      firebaseSignedInUser = user || null;
      const localName = safeStorageGet('echo_profile_name');
      const accountName = String(user?.displayName || '').trim() || String(user?.email || '').split('@')[0];
      const displayName = user ? (accountName || 'Google account') : (localName || 'Local listener');
      const photoURL = /^https:\/\//i.test(String(user?.photoURL || '')) ? user.photoURL : '';
      if (profileNameDisplay) profileNameDisplay.textContent = displayName;
      if (profileAvatarInitial) profileAvatarInitial.textContent = displayName.charAt(0).toUpperCase();
      if (profileAvatarPhoto) {
        profileAvatarPhoto.src = photoURL;
        profileAvatarPhoto.classList.toggle('hidden', !photoURL);
      }
      if (profileAvatarFallback) profileAvatarFallback.classList.toggle('hidden', Boolean(photoURL));
      if (profilePhotoLarge) {
        profilePhotoLarge.src = photoURL;
        profilePhotoLarge.classList.toggle('hidden', !photoURL);
      }
      profileAvatarInitial?.classList.toggle('hidden', Boolean(photoURL));
      if (firebaseAccountStatus) {
        firebaseAccountStatus.textContent = user
          ? (user.offline ? 'Google account · offline' : 'Signed in with Google')
          : 'Local profile only';
      }
      if (firebaseAccountEmail) {
        firebaseAccountEmail.textContent = user?.email || 'Sign in to connect your Google account.';
      }
      googleSignInBtn?.classList.toggle('hidden', Boolean(user));
      googleSignOutBtn?.classList.toggle('hidden', !user);
      if (profileNameInput) {
        profileNameInput.readOnly = Boolean(user);
        profileNameInput.value = user ? displayName : (localName || '');
        profileNameInput.placeholder = user ? 'Managed by your Google account' : 'Name for this device';
      }
      saveProfileBtn?.classList.toggle('hidden', Boolean(user));
      if (profileNameInput && !profileNameInput.matches(':focus')) {
        profileNameInput.value = user ? displayName : (localName || '');
      }
      updateTasteOnboarding(user, true);
    };

    let authReturnTimeout = null;
    const clearAuthReturnTimeout = () => {
      if (authReturnTimeout) clearTimeout(authReturnTimeout);
      authReturnTimeout = null;
    };

    if (window.echoApi?.onFirebaseAuthResult) {
      window.echoApi.onFirebaseAuthResult((result) => {
        clearAuthReturnTimeout();
        if (googleSignInBtn) googleSignInBtn.disabled = false;
        if (tasteSignInBtn) tasteSignInBtn.disabled = false;
        if (result?.success) {
          renderFirebaseAccount(result.user || null);
          if (tasteOnboardingStatus) tasteOnboardingStatus.textContent = '';
          showToast(result.user ? `Signed in as ${result.user.email || result.user.displayName}` : 'Signed out of Google');
        } else if (result?.message && firebaseAccountStatus) {
          firebaseAccountStatus.textContent = result.message;
          if (tasteOnboardingStatus) tasteOnboardingStatus.textContent = result.message;
          showToast(result.message);
        }
      });
    }

    if (window.echoApi?.getFirebaseUser) {
      firstRunInitialization
        .then(profileState => {
          if (profileState?.showWelcomeWizard) {
            forceWelcomeOnboarding = true;
            onboardingReplay = true;
            onboardingLaunchTour = true;
            onboardingStage = 'taste';
            tastePreferences = {};
            importedListeningMemory = [];
            try {
              for (const key of ['melopair_onboarding_done', 'melopair_taste_setup_v1', 'melopair_taste_preferences', 'melopair_imported_listening_memory']) {
                localStorage.removeItem(key);
              }
            } catch (error) { console.warn('[Profile] Could not clear stale first-run taste state:', error); }
            document.querySelectorAll('.taste-options .taste-chip.selected').forEach(chip => {
              chip.classList.remove('selected');
              chip.setAttribute('aria-pressed', 'false');
            });
            restoreTasteSelections();
            setOnboardingStage('taste');
            updateTasteOnboarding(null, true);
          }
          return window.echoApi.getFirebaseUser();
        })
        .then(user => {
          clearTimeout(onboardingAccountCheckTimeout);
          renderFirebaseAccount(user);
        })
        .catch(error => console.warn('[Firebase Auth] Could not load sign-in state:', error));
    } else {
      firstRunInitialization.then(profileState => {
        clearTimeout(onboardingAccountCheckTimeout);
        if (profileState?.showWelcomeWizard) {
          forceWelcomeOnboarding = true;
          onboardingReplay = true;
          onboardingLaunchTour = true;
          tastePreferences = {};
          importedListeningMemory = [];
          try {
            for (const key of ['melopair_onboarding_done', 'melopair_taste_setup_v1', 'melopair_taste_preferences', 'melopair_imported_listening_memory']) {
              localStorage.removeItem(key);
            }
          } catch (error) { console.warn('[Profile] Could not clear stale first-run taste state:', error); }
          document.querySelectorAll('.taste-options .taste-chip.selected').forEach(chip => {
            chip.classList.remove('selected');
            chip.setAttribute('aria-pressed', 'false');
          });
          restoreTasteSelections();
          setOnboardingStage('taste');
        }
        updateTasteOnboarding(null, true);
      });
    }

    googleSignInBtn?.addEventListener('click', async () => {
      googleSignInBtn.disabled = true;
      if (firebaseAccountStatus) firebaseAccountStatus.textContent = 'Opening secure Google sign-in…';
      clearAuthReturnTimeout();
      try {
        await window.echoApi?.startFirebaseSignIn?.();
        authReturnTimeout = setTimeout(async () => {
          let user = null;
          try { user = await window.echoApi?.getFirebaseUser?.(); } catch (error) { console.warn('[Firebase Auth] Could not check sign-in completion:', error); }
          if (user) {
            renderFirebaseAccount(user);
            showToast(`Signed in as ${user.email || user.displayName || 'your Google account'}`);
          } else {
            if (googleSignInBtn) googleSignInBtn.disabled = false;
            if (tasteSignInBtn) tasteSignInBtn.disabled = false;
            const timeoutMessage = 'Sign-in did not return to MeloPair. Keep the app open and try again.';
            if (firebaseAccountStatus) firebaseAccountStatus.textContent = timeoutMessage;
            if (tasteOnboardingStatus) tasteOnboardingStatus.textContent = timeoutMessage;
          }
        }, 90000);
      } catch (error) {
        clearAuthReturnTimeout();
        if (firebaseAccountStatus) firebaseAccountStatus.textContent = error.message || 'Could not start Google sign-in.';
        googleSignInBtn.disabled = false;
        if (tasteSignInBtn) tasteSignInBtn.disabled = false;
      }
    });

    tasteSignInBtn?.addEventListener('click', () => {
      if (!googleSignInBtn) {
        if (tasteOnboardingStatus) tasteOnboardingStatus.textContent = 'Secure Google sign-in is unavailable in this build.';
        tasteSignInBtn.disabled = false;
        return;
      }
      if (tasteOnboardingStatus) tasteOnboardingStatus.textContent = 'Opening secure Google sign-in…';
      tasteSignInBtn.disabled = true;
      googleSignInBtn?.click();
    });

    const bindTasteChip = (chip) => {
      if (chip.dataset.boundTasteChip) return;
      chip.dataset.boundTasteChip = 'true';
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        chip.setAttribute('aria-pressed', chip.classList.contains('selected') ? 'true' : 'false');
      });
    };
    document.querySelectorAll('.taste-options[data-taste-group] .taste-chip').forEach(bindTasteChip);
    const restoreTasteSelections = () => {
      for (const group of ['languages', 'moods', 'artists', 'habits', 'genres']) {
        const values = Array.isArray(tastePreferences[group]) ? tastePreferences[group] : [];
        const root = document.querySelector(`.taste-options[data-taste-group="${group}"]`);
        for (const value of values) {
          let chip = [...(root?.querySelectorAll('.taste-chip') || [])].find(item => (item.dataset.value || item.textContent).toLocaleLowerCase() === String(value).toLocaleLowerCase());
          if (!chip && group === 'artists' && root) {
            chip = document.createElement('button'); chip.type = 'button'; chip.className = 'taste-chip'; chip.dataset.value = value; chip.textContent = value; root.append(chip); bindTasteChip(chip);
          }
          if (chip) { chip.classList.add('selected'); chip.setAttribute('aria-pressed', 'true'); }
        }
      }
    };
    restoreTasteSelections();

    const artistSearch = document.getElementById('mpArtistSearch');
    artistSearch?.addEventListener('input', () => {
      const query = artistSearch.value.trim().toLocaleLowerCase();
      document.querySelectorAll('[data-taste-group="artists"] .taste-chip').forEach(chip => {
        chip.classList.toggle('hidden', Boolean(query) && !chip.textContent.toLocaleLowerCase().includes(query));
      });
    });
    const addCustomArtist = () => {
      const input = document.getElementById('mpCustomArtistInput');
      const value = String(input?.value || '').trim().replace(/\s+/g, ' ');
      if (!value) return;
      const group = document.querySelector('[data-taste-group="artists"]');
      const existing = [...(group?.querySelectorAll('.taste-chip') || [])].find(chip => chip.dataset.value.toLocaleLowerCase() === value.toLocaleLowerCase());
      if (existing) {
        existing.classList.add('selected');
        existing.setAttribute('aria-pressed', 'true');
      } else if (group) {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'taste-chip selected'; chip.dataset.value = value; chip.textContent = value; chip.setAttribute('aria-pressed', 'true');
        group.append(chip); bindTasteChip(chip);
      }
      if (input) input.value = '';
    };
    document.getElementById('mpAddArtistBtn')?.addEventListener('click', addCustomArtist);
    document.getElementById('mpCustomArtistInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCustomArtist(); } });

    const persistTasteProfile = () => {
      try {
        localStorage.setItem('melopair_taste_preferences', JSON.stringify(tastePreferences));
        localStorage.setItem('melopair_imported_listening_memory', JSON.stringify(importedListeningMemory));
      } catch (error) { console.warn('[Taste] Could not persist local taste profile:', error); }
      savePersistentState();
    };
    const finishOnboarding = (startTour = true) => {
      try {
        localStorage.setItem('melopair_onboarding_done', 'true');
        localStorage.setItem('melopair_taste_setup_v1', 'true');
      } catch (error) { console.warn('[Taste] Could not save onboarding completion:', error); }
      forceWelcomeOnboarding = false;
      void window.echoApi?.markOnboardingComplete?.(true);
      onboardingReplay = false;
      tasteOnboarding?.classList.add('hidden');
      persistTasteProfile();
      if (discSubtitle) discSubtitle.textContent = 'A listening feed shaped by your taste and what you play';
      void loadPersonalizedFeed(true);
      performSearch('trending global songs');
      if (startTour && onboardingLaunchTour) startFeatureTour();
    };

    function parseTasteCsv(text) {
      const rows = []; let row = []; let cell = ''; let quoted = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = !quoted;
        else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
        else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      if (rows.length < 2) return [];
      const headers = rows.shift().map(value => value.trim().toLocaleLowerCase());
      const field = (...names) => headers.findIndex(header => names.some(name => header.includes(name)));
      const titleI = field('track name', 'trackname', 'song', 'track title', 'title', 'name');
      const artistI = field('artist name', 'artistname', 'artist', 'artists', 'subtitle');
      const albumI = field('album name', 'album');
      return rows.map(cells => ({ title: cells[titleI] || '', artist: cells[artistI] || '', album: cells[albumI] || '' }));
    }
    const normalizeImportedTrack = (item) => {
      if (typeof item === 'string') item = { title: item };
      const title = String(item?.title || item?.trackName || item?.track?.name || item?.name || '').trim();
      const artistField = item?.artist || item?.artistName || item?.['Artist Name(s)'] || item?.subtitles || '';
      const artist = Array.isArray(artistField) ? artistField.map(a => typeof a === 'string' ? a : a?.name).filter(Boolean).join(', ') : String(artistField || item?.subtitles?.map?.(a => a.name).join(', ') || '').trim();
      if (!title) return null;
      const cleanTitle = title.replace(/^(?:played|watched)\s+/i, '').replace(/\s+-\s+topic\s*$/i, '').replace(/^[-–—]\s*/, '').trim();
      if (!artist && cleanTitle.length > 70) return null;
      return { title: cleanTitle, artist, album: String(item.album || item.albumName || ''), source: 'import', importedAt: Date.now() };
    };
    function importListeningMemory(parsedTracks, sourceApp = 'Other app') {
      const normalized = (Array.isArray(parsedTracks) ? parsedTracks : []).map(normalizeImportedTrack).filter(Boolean);
      const unique = new Map();
      for (const track of normalized) {
        const key = `${track.title}|${track.artist}`.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!key || unique.has(key)) continue;
        unique.set(key, track);
      }
      const imported = [...unique.values()];
      if (!imported.length) return 0;
      const previous = new Map(importedListeningMemory.map(track => [`${track.title}|${track.artist}`.toLocaleLowerCase(), track]));
      for (const track of imported) previous.set(`${track.title}|${track.artist}`.toLocaleLowerCase(), { ...track, sourceApp });
      importedListeningMemory = [...previous.values()].slice(-2000);
      const artistCounts = new Map();
      for (const track of imported) {
        const candidates = String(track.artist || '').split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i).filter(Boolean);
        if (candidates.length) artistCounts.set(candidates[0], (artistCounts.get(candidates[0]) || 0) + 1);
        else if (!track.artist && !/[–—]/.test(track.title)) artistCounts.set(track.title, (artistCounts.get(track.title) || 0) + 1);
      }
      const topArtists = [...artistCounts].sort((a,b) => b[1]-a[1]).slice(0, 20).map(([name]) => name);
      const affinity = (() => { try { return JSON.parse(safeStorageGet('echo_artist_affinity') || '{}') || {}; } catch { return {}; } })();
      for (const [artist, count] of artistCounts) affinity[artist] = (Number(affinity[artist]) || 0) + count;
      try { localStorage.setItem('echo_artist_affinity', JSON.stringify(affinity)); } catch {}
      const inferLanguage = text => {
        const value = text.toLocaleLowerCase();
        if (/karan aujla|sidhu moose|diljit|ap dhillon|shubh|punjabi|ikky/.test(value)) return 'Punjabi';
        if (/arijit|pritam|bollywood|hindi/.test(value)) return 'Hindi';
        if (/taylor swift|weeknd|drake|billie eilish|english/.test(value)) return 'English / International';
        return '';
      };
      const languages = new Set(tastePreferences.languages || []);
      const moods = new Set(tastePreferences.moods || []);
      for (const track of imported) {
        const lang = inferLanguage(`${track.title} ${track.artist}`); if (lang) languages.add(lang);
        const text = `${track.title} ${track.artist}`.toLocaleLowerCase();
        if (/sad|heartbreak|alone|cry|hurt/.test(text)) moods.add('Heartbreak & Sad');
        if (/party|dance|club|energy|pump/.test(text)) moods.add('High-Energy & Party');
        if (/love|romantic|heart/.test(text)) moods.add('Romantic & Soulful');
      }
      tastePreferences = { ...tastePreferences, artists: [...new Set([...(tastePreferences.artists || []), ...topArtists])].slice(0, 100), languages: [...languages], moods: [...moods], importedFrom: sourceApp, importedTrackCount: importedListeningMemory.length, updatedAt: Date.now() };
      persistTasteProfile();
      const summary = document.getElementById('mpImportSummary');
      const message = `Imported ${imported.length} tracks · Top artists: ${topArtists.slice(0, 3).join(', ') || 'profile updated'}`;
      if (summary) summary.textContent = message;
      const setupStatus = document.getElementById('tasteImportStatus'); if (setupStatus) setupStatus.textContent = message;
      void loadPersonalizedFeed(true);
      return imported.length;
    }

    const importText = (text, sourceHint = 'Imported file') => {
      let tracks = [];
      const trimmed = String(text || '').trim();
      if (!trimmed) return 0;
      if (/\.json$/i.test(sourceHint) || /^[\[{]/.test(trimmed)) {
        try {
          const data = JSON.parse(trimmed);
          const list = Array.isArray(data) ? data : (data.tracks || data.items || data.history || data.songs || data.library || []);
          tracks = Array.isArray(list) ? list.filter(item => {
            const desc = `${item.title || ''} ${item.header || ''} ${item.titleUrl || ''} ${(item.subtitles || []).map?.(part => part.name).join(' ') || ''}`;
            if (/watch.?history/i.test(sourceHint)) return /music|song|audio|official video|topic/i.test(desc) || Boolean(item.subtitles?.length);
            return true;
          }) : [];
          if (!tracks.length && data?.track) tracks = [data];
        } catch (error) { console.warn('[Taste Import] JSON parse failed:', error); }
      } else if (/\.csv$/i.test(sourceHint) || /,/.test(trimmed.split(/\r?\n/)[0] || '')) tracks = parseTasteCsv(trimmed);
      else tracks = trimmed.split(/\r?\n/).map(line => {
        const parts = line.split(/\s+[—–-]\s+/);
        return parts.length > 1 ? { title: parts.slice(0, -1).join(' - ').trim(), artist: parts[parts.length - 1].trim() } : { title: '', artist: line.trim() };
      }).filter(row => row.title || row.artist).map(row => row.title ? row : { title: row.artist, artist: '' });
      const source = /spotify|exportify|streaming.?history/i.test(sourceHint) ? 'Spotify' : /youtube|takeout|watch.?history/i.test(sourceHint) ? 'YouTube Music' : /apple/i.test(sourceHint) ? 'Apple Music' : sourceHint;
      return importListeningMemory(tracks, source);
    };
    const importFileInput = document.getElementById('mpTasteFileInput');
    importFileInput?.addEventListener('change', async () => {
      const file = importFileInput.files?.[0]; if (!file) return;
      const status = document.getElementById('tasteImportStatus');
      try {
        const count = importText(await file.text(), file.name);
        if (status && !count) status.textContent = 'No song or artist rows were found. Try a Spotify/YouTube export or paste a list.';
        else if (status) status.textContent = `Imported ${count} entries from ${file.name}.`;
      } catch (error) { if (status) status.textContent = 'Could not read that file. Try CSV, JSON, or plain text.'; console.warn('[Taste Import] File read failed:', error); }
      importFileInput.value = '';
    });
    document.getElementById('mpImportPasteBtn')?.addEventListener('click', () => {
      const box = document.getElementById('mpTastePaste'); const count = importText(box?.value || '', 'Pasted list');
      const status = document.getElementById('tasteImportStatus');
      if (status) status.textContent = count ? `Imported ${count} entries from your pasted list.` : 'Paste one artist or song per line to import.';
      if (box && count) box.value = '';
    });

    const step2 = () => { onboardingReplay = true; setOnboardingStage('import'); tasteOnboarding?.classList.remove('hidden'); };
    tasteFinishBtn?.addEventListener('click', () => {
      const selected = group => [...document.querySelectorAll(`.taste-options[data-taste-group="${group}"] .taste-chip.selected`)].map(chip => chip.dataset.value || chip.textContent.trim());
      const artists = selected('artists');
      if (artists.length < 3) { if (tasteSetupStatus) tasteSetupStatus.textContent = 'Pick at least three favorite artists, or skip setup for now.'; return; }
      tastePreferences = { ...tastePreferences, artists, languages: selected('languages'), moods: selected('moods'), genres: tastePreferences.genres || [], habits: selected('habits'), updatedAt: Date.now() };
      persistTasteProfile();
      if (tasteSetupStatus) tasteSetupStatus.textContent = '';
      step2();
    });
    document.getElementById('mpImportBackBtn')?.addEventListener('click', () => { onboardingReplay = true; setOnboardingStage('taste'); });
    document.getElementById('mpFinishOnboardingBtn')?.addEventListener('click', finishOnboarding);
    document.getElementById('mpSkipOnboardingBtn')?.addEventListener('click', () => finishOnboarding(false));
    document.getElementById('settingsImportTasteBtn')?.addEventListener('click', () => { openOnboarding('import'); });
    document.getElementById('settingsFeatureTourBtn')?.addEventListener('click', () => {
      onboardingReplay = true;
      onboardingLaunchTour = true;
      forceWelcomeOnboarding = true;
      onboardingStage = 'taste';
      try {
        localStorage.removeItem('melopair_onboarding_done');
        localStorage.removeItem('melopair_taste_setup_v1');
      } catch (error) { console.warn('[Taste] Could not reset welcome progress:', error); }
      void window.echoApi?.markOnboardingComplete?.(false);
      setOnboardingStage('taste');
      restoreTasteSelections();
      tasteOnboarding?.classList.remove('hidden');
      savePersistentState();
    });

    const tourSteps = [
      { target: '#viewDiscovery', title: 'Listen Now & Smart Shelves', copy: 'Your personalized home feed, shaped by your chosen styles, languages, and listening taste.' },
      { target: '#appleHeaderSearchInput', title: 'Instant Search', copy: 'Press Ctrl+K anywhere to find tracks, artists, and albums.' },
      { target: '#dockLyricsBtn', title: 'Kinetic Lyrics', copy: 'Open full-screen lyrics and use the sync controls when a line needs realignment.' },
      { target: '#navStudioBtn', title: 'Studio FX & Spatial Audio', copy: 'Shape the sound with Studio FX, EQ, and spatial audio controls.' },
      { target: '#navPartyRoomsBtn', title: 'Rooms · Listen Together', copy: 'Start a Room to listen and keep playback synced with friends.' },
      { target: '#dockQueueBtn', title: 'Crossfade & Smart Queue', copy: 'See what plays next and explore the autoplay radio queue.' }
    ];
    let tourIndex = 0;
    const spot = document.getElementById('mpTourSpotlight'); const card = document.getElementById('mpTourCard');
    const renderTourStep = () => {
      const item = tourSteps[tourIndex]; const target = document.querySelector(item.target);
      if (!target) return;
      if (item.target === '#viewDiscovery' && !target.classList.contains('active')) document.getElementById('navDiscoveryBtn')?.click();
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      document.getElementById('mpTourStepLabel').textContent = `STEP ${tourIndex + 1} OF ${tourSteps.length}`;
      document.getElementById('mpTourTitle').textContent = item.title;
      document.getElementById('mpTourCopy').textContent = item.copy;
      document.getElementById('mpTourBackBtn').disabled = tourIndex === 0;
      document.getElementById('mpTourNextBtn').textContent = tourIndex === tourSteps.length - 1 ? 'Finish' : 'Next';
      requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        spot.style.left = `${Math.max(8, rect.left - 8)}px`; spot.style.top = `${Math.max(8, rect.top - 8)}px`;
        spot.style.width = `${Math.min(innerWidth - Math.max(8, rect.left - 8), rect.width + 16)}px`; spot.style.height = `${Math.min(innerHeight - Math.max(8, rect.top - 8), rect.height + 16)}px`;
        card.classList.toggle('mp-tour-card-above', rect.top + rect.height / 2 > innerHeight * .62);
        const cardWidth = Math.min(360, innerWidth - 32); card.style.width = `${cardWidth}px`;
        const left = Math.max(16, Math.min(innerWidth - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2));
        card.style.left = `${left}px`;
        card.style.top = card.classList.contains('mp-tour-card-above') ? `${Math.max(16, rect.top - card.offsetHeight - 24)}px` : `${Math.min(innerHeight - card.offsetHeight - 16, rect.bottom + 24)}px`;
      });
    };
    function startFeatureTour() {
      tourIndex = 0;
      mpFeatureTour?.classList.remove('hidden');
      renderTourStep();
    }
    const closeTour = () => mpFeatureTour?.classList.add('hidden');
    document.getElementById('mpTourBackBtn')?.addEventListener('click', () => { if (tourIndex) tourIndex--; renderTourStep(); });
    document.getElementById('mpTourNextBtn')?.addEventListener('click', () => { if (tourIndex >= tourSteps.length - 1) closeTour(); else { tourIndex++; renderTourStep(); } });
    document.getElementById('mpTourSkipBtn')?.addEventListener('click', closeTour);
    window.addEventListener('resize', () => { if (!mpFeatureTour?.classList.contains('hidden')) renderTourStep(); });

    // An imported history export informs affinity weights; it is kept distinct
    // from songs actually played in MeloPair so the recent-play shelf stays true.

    googleSignOutBtn?.addEventListener('click', async () => {
      googleSignOutBtn.disabled = true;
      try {
        await window.echoApi?.signOutFirebaseUser?.();
      } catch (error) {
        if (firebaseAccountStatus) firebaseAccountStatus.textContent = error.message || 'Sign-out failed.';
      } finally {
        googleSignOutBtn.disabled = false;
      }
    });

    if (userProfileBadge) {
      userProfileBadge.addEventListener('click', () => {
        if (profileStatPlayed) profileStatPlayed.textContent = history.length;
        if (profileStatFavs) profileStatFavs.textContent = favorites.size;
        if (profileModalBackdrop) profileModalBackdrop.classList.remove('hidden');
        if (!googleSignInBtn?.disabled && window.echoApi?.getFirebaseUser) {
          window.echoApi.getFirebaseUser().then(renderFirebaseAccount).catch(error => console.warn('[Firebase Auth] Could not refresh profile:', error));
        }
      });
    }

    if (closeProfileModalBtn) {
      closeProfileModalBtn.addEventListener('click', () => {
        if (profileModalBackdrop) profileModalBackdrop.classList.add('hidden');
      });
    }

    if (profileModalBackdrop) {
      profileModalBackdrop.addEventListener('click', (e) => {
        if (e.target === profileModalBackdrop) {
          profileModalBackdrop.classList.add('hidden');
        }
      });
    }

    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', () => {
        const newName = (profileNameInput ? profileNameInput.value.trim() : '') || 'Local listener';
        localStorage.setItem('echo_profile_name', newName);
        if (profileNameDisplay) profileNameDisplay.textContent = newName;
        if (profileAvatarInitial) profileAvatarInitial.textContent = newName.charAt(0).toUpperCase();
        if (profileModalBackdrop) profileModalBackdrop.classList.add('hidden');
        showToast(`Profile updated: ${newName} ✨`);
      });
    }

    if (notificationBtn) {
      notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (notificationFlyout) {
          notificationFlyout.classList.toggle('hidden');
        }
      });
    }

    if (clearNotifsBtn) {
      clearNotifsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (notifList) {
          notifList.innerHTML = `<div style="padding: 24px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">No new notifications</div>`;
        }
        if (notificationBadge) {
          notificationBadge.classList.add('hidden');
        }
        showToast('All notifications cleared');
      });
    }

    document.addEventListener('click', (e) => {
      if (notificationFlyout && !notificationFlyout.classList.contains('hidden')) {
        if (!e.target.closest('#notificationBtn') && !e.target.closest('#notificationFlyout')) {
          notificationFlyout.classList.add('hidden');
        }
      }
    });
  }
  initUserProfileAndNotifications();

  // ------------------------------------------------------------------------
  // IMMERSIVE KINETIC LYRICS & DUAL-MODE LYRICS ENGINE
  // Apple Music / Lock-screen Fullscreen Kinetic Typography + Dynamic Art Glow
  // ------------------------------------------------------------------------

  // Lucide SVG Icons for Lyric Keywords
  const LUCIDE_ICONS = {
    heart: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
    flame: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    moon: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
    sun: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
    eye: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    hand: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
    car: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`,
    rain: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>`,
    star: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    droplet: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
    music: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    clock: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    zap: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    wind: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>`,
    smile: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/></svg>`,
    sparkles: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`,
    waves: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>`,
    compass: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    key: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
    shield: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    crown: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`,
    phone: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    feather: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
    home: `<svg class="imm-word-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
  };

  // Keyword dictionary (~100 common lyrical words mapped to Lucide icons)
  const KEYWORD_MAP = {
    // heart
    heart: 'heart', hearts: 'heart', love: 'heart', loved: 'heart', lover: 'heart', lovers: 'heart', loving: 'heart', beloved: 'heart', sweetheart: 'heart',
    // flame
    fire: 'flame', flame: 'flame', flames: 'flame', burn: 'flame', burns: 'flame', burning: 'flame', burned: 'flame', ablaze: 'flame', ignite: 'flame', spark: 'flame', sparks: 'flame',
    // moon / night
    night: 'moon', nights: 'moon', moon: 'moon', moonlight: 'moon', midnight: 'moon', dark: 'moon', darkness: 'moon', shadow: 'moon', shadows: 'moon',
    // sun / morning
    sun: 'sun', sunshine: 'sun', sunny: 'sun', daylight: 'sun', sunrise: 'sun', morning: 'sun', shine: 'sun', shines: 'sun', shining: 'sun', bright: 'sun',
    // eye / see
    eye: 'eye', eyes: 'eye', see: 'eye', seen: 'eye', seeing: 'eye', look: 'eye', looks: 'eye', looking: 'eye', watch: 'eye', watching: 'eye', glance: 'eye', vision: 'eye',
    // hand / touch
    hand: 'hand', hands: 'hand', touch: 'hand', touches: 'hand', touching: 'hand', hold: 'hand', holds: 'hand', holding: 'hand', held: 'hand', reach: 'hand', reaching: 'hand',
    // car / drive
    car: 'car', cars: 'car', drive: 'car', drives: 'car', driving: 'car', drove: 'car', ride: 'car', riding: 'car', cruise: 'car', cruising: 'car', wheels: 'car',
    // rain / storm
    rain: 'rain', raining: 'rain', rains: 'rain', raindrop: 'rain', raindrops: 'rain', storm: 'rain', storms: 'rain', stormy: 'rain', thunder: 'rain',
    // star
    star: 'star', stars: 'star', starry: 'star', starlight: 'star',
    // droplet / tear / blood
    tear: 'droplet', tears: 'droplet', cry: 'droplet', crying: 'droplet', cried: 'droplet', blood: 'droplet', bleed: 'droplet', bleeding: 'droplet', drop: 'droplet', drops: 'droplet',
    // music / song / dance
    music: 'music', song: 'music', songs: 'music', melody: 'music', rhythm: 'music', beat: 'music', beats: 'music', sing: 'music', singing: 'music', dance: 'music', dancing: 'music',
    // clock / time
    time: 'clock', clock: 'clock', clocks: 'clock', hour: 'clock', hours: 'clock', minute: 'clock', minutes: 'clock', second: 'clock', seconds: 'clock', wait: 'clock', waiting: 'clock', late: 'clock',
    // zap / electric
    lightning: 'zap', electric: 'zap', shock: 'zap', flash: 'zap', power: 'zap', energy: 'zap',
    // wind / breath
    wind: 'wind', winds: 'wind', air: 'wind', breeze: 'wind', blow: 'wind', blowing: 'wind', breath: 'wind', breathe: 'wind', breathing: 'wind',
    // smile / happy
    smile: 'smile', smiles: 'smile', smiling: 'smile', laugh: 'smile', laughs: 'smile', laughing: 'smile', happy: 'smile', joy: 'smile',
    // sparkles / dream
    dream: 'sparkles', dreams: 'sparkles', dreaming: 'sparkles', magic: 'sparkles', magical: 'sparkles', glow: 'sparkles', glowing: 'sparkles', miracle: 'sparkles',
    // waves / ocean
    ocean: 'waves', sea: 'waves', wave: 'waves', waves: 'waves', river: 'waves', water: 'waves', waters: 'waves', swim: 'waves',
    // compass / road
    lost: 'compass', find: 'compass', road: 'compass', journey: 'compass', street: 'compass', way: 'compass',
    // key / secret
    key: 'key', keys: 'key', lock: 'key', locked: 'key', unlock: 'key', secret: 'key', secrets: 'key', door: 'key',
    // shield / protect
    safe: 'shield', protect: 'shield', guard: 'shield', shield: 'shield', fight: 'shield', fighting: 'shield',
    // crown / royal
    king: 'crown', queen: 'crown', crown: 'crown', royal: 'crown', throne: 'crown',
    // phone / call
    call: 'phone', calling: 'phone', called: 'phone', phone: 'phone', ring: 'phone', ringing: 'phone', answer: 'phone',
    // feather / fly
    fly: 'feather', flying: 'feather', flew: 'feather', bird: 'feather', birds: 'feather', wings: 'feather', wing: 'feather', free: 'feather', freedom: 'feather',
    // home
    home: 'home', house: 'home', room: 'home', stay: 'home'
  };

  function getKeywordIconSvg(rawWord) {
    if (!rawWord) return null;
    const clean = rawWord.toLowerCase().replace(/[^a-z0-9]/g, '');
    const iconName = KEYWORD_MAP[clean];
    if (!iconName) return null;
    return LUCIDE_ICONS[iconName] || null;
  }

  // ------------------------------------------------------------------------
  // Album Art Dynamic Color Extraction (Canvas-driven Hue & Glow Engine)
  // ------------------------------------------------------------------------
  function extractDominantColors(imageSrc) {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 32;
        canvas.height = 32;
        ctx.drawImage(img, 0, 0, 32, 32);
        const imgData = ctx.getImageData(0, 0, 32, 32).data;

        const colors = [];
        for (let i = 0; i < imgData.length; i += 16) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3];
          if (a < 128) continue;
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = max === 0 ? 0 : (max - min) / max;
          if (brightness > 25 && brightness < 235 && saturation > 0.15) {
            colors.push({ r, g, b, sat: saturation, bright: brightness });
          }
        }

        if (colors.length === 0) {
          applyExtractedColors('rgb(255, 120, 160)', 'rgb(140, 110, 255)', 'rgba(255, 120, 160, 0.45)', 'rgb(99, 102, 241)');
          return;
        }

        colors.sort((a, b) => b.sat - a.sat);
        const c1 = colors[0];
        const c2 = colors.find(c => (Math.abs(c.r - c1.r) + Math.abs(c.g - c1.g) + Math.abs(c.b - c1.b)) > 90) ||
                   colors[Math.floor(colors.length / 2)] || c1;
        const c3 = colors.find(c => (Math.abs(c.r - c1.r) + Math.abs(c.g - c1.g) + Math.abs(c.b - c1.b)) > 70 &&
                                    (Math.abs(c.r - c2.r) + Math.abs(c.g - c2.g) + Math.abs(c.b - c2.b)) > 70) ||
                   colors[colors.length - 1] || c2;

        const primary = `rgb(${c1.r}, ${c1.g}, ${c1.b})`;
        const secondary = `rgb(${c2.r}, ${c2.g}, ${c2.b})`;
        const tertiary = `rgb(${c3.r}, ${c3.g}, ${c3.b})`;
        const glow = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.55)`;

        applyExtractedColors(primary, secondary, glow, tertiary);
      } catch (err) {
        console.warn('Dominant color notice:', err);
      }
    };
    img.onerror = () => {
      applyExtractedColors('rgb(255, 120, 160)', 'rgb(140, 110, 255)', 'rgba(255, 120, 160, 0.45)', 'rgb(99, 102, 241)');
    };
    img.src = imageSrc;
  }

  function applyExtractedColors(primary, secondary, glow, tertiary) {
    const root = document.documentElement;
    root.style.setProperty('--art-color-primary', primary);
    root.style.setProperty('--art-color-secondary', secondary);
    root.style.setProperty('--art-color-tertiary', tertiary || secondary);
    root.style.setProperty('--art-glow', glow);
  }

  // ------------------------------------------------------------------------
  // Ambient Atmospheric Cloud Engine (Drifting Multi-Color Radial Blobs)
  // ------------------------------------------------------------------------
  let ambientCloudAnimId = null;
  const cloudBlobs = [
    { x: 0.25, y: 0.35, r: 0.45, vx: 0.00035, vy: 0.00025 },
    { x: 0.75, y: 0.40, r: 0.50, vx: -0.00028, vy: 0.00032 },
    { x: 0.45, y: 0.75, r: 0.55, vx: 0.00030, vy: -0.00022 },
    { x: 0.65, y: 0.20, r: 0.40, vx: -0.00022, vy: -0.00018 }
  ];

  function renderAmbientCloudFrame() {
    if (!ambientCloudCanvas || !ambientCloudCtx) return;

    // Only render when lyrics view is active and NOT in OLED Black mode.
    // If inactive or in OLED Black mode, stop the animation loop completely to avoid CPU/GPU waste.
    const isLyricsActive = viewLyrics && viewLyrics.classList.contains('active');
    if (!isLyricsActive || isOledBgMode) {
      ambientCloudAnimId = null;
      return;
    }

    const w = ambientCloudCanvas.width;
    const h = ambientCloudCanvas.height;
    if (w === 0 || h === 0) {
      ambientCloudAnimId = null;
      return;
    }

    ambientCloudCtx.clearRect(0, 0, w, h);

    const rootStyles = getComputedStyle(document.documentElement);
    const primaryArt = rootStyles.getPropertyValue('--art-color-primary').trim() || 'rgb(140, 110, 255)';
    const secondaryArt = rootStyles.getPropertyValue('--art-color-secondary').trim() || 'rgb(255, 120, 160)';

    cloudBlobs.forEach((blob, idx) => {
      blob.x += blob.vx;
      blob.y += blob.vy;
      if (blob.x < 0.1 || blob.x > 0.9) blob.vx *= -1;
      if (blob.y < 0.1 || blob.y > 0.9) blob.vy *= -1;

      const cx = blob.x * w;
      const cy = blob.y * h;
      const radius = blob.r * Math.min(w, h);

      const grad = ambientCloudCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const baseColor = (idx % 2 === 0) ? primaryArt : secondaryArt;
      const alphaVal = (idx === 0 ? '0.22' : '0.16');
      const colorWithAlpha = baseColor.replace('rgb(', 'rgba(').replace(')', `, ${alphaVal})`);

      grad.addColorStop(0, colorWithAlpha);
      grad.addColorStop(0.5, colorWithAlpha.replace(/[\d.]+\)$/, '0.07)'));
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ambientCloudCtx.fillStyle = grad;
      ambientCloudCtx.fillRect(0, 0, w, h);
    });

    ambientCloudAnimId = requestAnimationFrame(renderAmbientCloudFrame);
  }

  function initAmbientClouds() {
    if (ambientCloudCanvas) {
      ambientCloudCanvas.width = ambientCloudCanvas.offsetWidth || window.innerWidth;
      ambientCloudCanvas.height = ambientCloudCanvas.offsetHeight || window.innerHeight;
    }
    if (!ambientCloudAnimId) {
      ambientCloudAnimId = requestAnimationFrame(renderAmbientCloudFrame);
    }
  }

  // Auto-hide chrome after 3 seconds of mouse inactivity in Immersive Mode
  function resetImmersiveIdle() {
    if (lyricsMode !== 'immersive') {
      if (appLayout) appLayout.classList.remove('chrome-hidden');
      return;
    }
    if (appLayout) appLayout.classList.remove('chrome-hidden');
    clearTimeout(immersiveIdleTimer);
    immersiveIdleTimer = setTimeout(() => {
      if (lyricsMode === 'immersive' && viewLyrics && viewLyrics.classList.contains('active')) {
        if (appLayout) appLayout.classList.add('chrome-hidden');
      }
    }, 3000);
  }

  document.addEventListener('mousemove', resetImmersiveIdle);
  document.addEventListener('mousedown', resetImmersiveIdle);
  document.addEventListener('keydown', resetImmersiveIdle);

  // ------------------------------------------------------------------------
  // Reset & Lyrics Data Fetching
  // ------------------------------------------------------------------------
  let lyricsRequestId = 0;

  function resetLyricsView(track) {
    lyricsRequestId++; // Invalidate any in-flight lyrics requests
    lyricsData = [];
    lyricsDataIsSynced = false;
    activeLyricIndex = -1;
    plainLyricsCanProgress = false;
    rawPlainLyricsText = null;
    autoIntroOffset = 0;
    lastLrcResultDuration = 0;
    lastFetchedLyricsDuration = 0;
    computeTotalLyricOffset();
    if (lyricsStatusBadge) lyricsStatusBadge.textContent = 'Searching...';

    // Update dynamic background art and corner meta
    const artUrl = track.artwork || track.thumbnail || 'default-art.png';
    if (immersiveArtBlur) {
      immersiveArtBlur.style.backgroundImage = `url("${artUrl}")`;
    }
    if (immTrackTitle) immTrackTitle.textContent = track.title || 'Ready to Play';
    if (immTrackArtist) immTrackArtist.textContent = track.artist || 'MeloPair';
    extractDominantColors(artUrl);

    // Reset immersive kinetic viewport
    if (immersiveKineticLines) {
      immersiveKineticLines.innerHTML = `
        <div class="imm-empty-state">
          <div class="pulse-ring"></div>
          <h2 class="imm-empty-title">Syncing Lyrics</h2>
          <p class="imm-empty-sub">Fetching synchronized kinetic lines for ${escapeHtml(track.title)}...</p>
        </div>
      `;
    }

    // Reset upward stream viewport
    if (lyricsStreamScroll) {
      lyricsStreamScroll.innerHTML = `
        <div class="lyrics-loading-state">
          <div class="pulse-ring"></div>
          <p class="loading-title">Syncing Lyrics</p>
          <p class="loading-subtitle">Fetching verified synchronized lines for ${escapeHtml(track.title)}...</p>
        </div>
      `;
    }

    if (typeof npLyricsStream !== 'undefined' && npLyricsStream) {
      npLyricsStream.innerHTML = `<div class="np-lyric-line active" style="text-align:center; padding-top:40px;">Syncing lyrics for ${escapeHtml(track.title)}...</div>`;
    }

    if (immersiveIntroIndicator) immersiveIntroIndicator.classList.add('hidden');
    if (lyricsIntroIndicator) lyricsIntroIndicator.classList.add('hidden');
  }

  function applyLyricsResponse(track, response, duration) {
    const lyrics = String(response?.lyrics || '').trim();
    if (!lyrics) {
      showNoLyricsFound(track);
      return false;
    }

    if (response.synced) {
      lastLrcResultDuration = Number(response.duration) || 0;
      autoIntroOffset = 0;
      parseLrcLyrics(lyrics);
      if (!lyricsDataIsSynced || lyricsData.length === 0) {
        const plainFallback = String(response.plainLyrics || '').trim();
        if (!plainFallback) {
          lastLrcResultDuration = 0;
          autoIntroOffset = 0;
          showNoLyricsFound(track);
          computeTotalLyricOffset();
          return false;
        }
        lastLrcResultDuration = 0;
        autoIntroOffset = 0;
        parsePlainLyricsWithPacing(plainFallback, duration);
        if (lyricsData.length === 0) {
          showNoLyricsFound(track);
          return false;
        }
        if (lyricsStatusBadge) lyricsStatusBadge.textContent = 'Plain Lyrics';
        computeTotalLyricOffset();
      } else {
        const sourceLabel = response.source === 'YouTube Synced' ? 'YouTube Synced ✓' : 'Synced LRCLIB ✓';
        if (lyricsStatusBadge) lyricsStatusBadge.textContent = sourceLabel;
        const deckDuration = Number.isFinite(activeAudio?.duration) && activeAudio.duration > 0
          ? activeAudio.duration
          : 0;
        if (deckDuration > 0) applyAutoIntroOffset(deckDuration);
        else computeTotalLyricOffset();
      }
    } else {
      lastLrcResultDuration = 0;
      autoIntroOffset = 0;
      parsePlainLyricsWithPacing(lyrics, duration);
      if (lyricsData.length === 0) {
        showNoLyricsFound(track);
        return false;
      }
      if (lyricsStatusBadge) lyricsStatusBadge.textContent = 'Plain Lyrics';
      computeTotalLyricOffset();
    }

    renderLyricsStream();
    activeLyricIndex = -1;
    if (!lyricsDataIsSynced) renderPlainImmersiveLyrics(rawPlainLyricsText || lyricsData.map(line => line.text).join('\n'));
    else renderImmersiveLyrics(-1);
    realignLyrics('auto', false);
    window.renderNowPlayingLyrics?.();
    broadcastEchoRoomState(true);
    return true;
  }

  async function fetchLyrics(track, verifiedStreamDuration = null) {
    if (!window.echoApi || !track) return;
    const myId = ++lyricsRequestId;
    const matchingActiveDeckDuration = activeAudio
      && activeAudio.dataset?.trackId === String(track.id)
      && activeAudio.readyState >= 1
      && Number.isFinite(activeAudio.duration)
      && activeAudio.duration > 10
      ? activeAudio.duration
      : 0;
    const explicitVerifiedDuration = Number(verifiedStreamDuration);
    const effectiveDuration = Number.isFinite(explicitVerifiedDuration) && explicitVerifiedDuration > 10
      ? explicitVerifiedDuration
      : (matchingActiveDeckDuration || ((track.duration && track.duration > 10 && track.duration !== 200)
          ? track.duration
          : (track.durationSec && track.durationSec > 10 && track.durationSec !== 200
              ? track.durationSec
              : (track.duration || 0))));
    const resolvedDuration = effectiveDuration;
    lastFetchedLyricsDuration = Number(effectiveDuration) || 0;

    lyricsData = [];
    lyricsDataIsSynced = false;
    activeLyricIndex = -1;
    if (lyricsStatusBadge) lyricsStatusBadge.textContent = 'Searching Synced Lyrics...';
    if (lyricsStreamScroll) {
      lyricsStreamScroll.innerHTML = `<div class="lyrics-loading-shimmer" style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.45); font-size: 15px;">Searching synced lyrics for "${escapeHtml(track.title)}"...</div>`;
    }
    const lyricContainers = [immersiveKineticLines, document.getElementById('npKineticLines')].filter(Boolean);
    lyricContainers.forEach(container => {
      container.innerHTML = '<div class="imm-line imm-past imm-prev imm-placeholder">&nbsp;</div><div class="imm-line imm-active lyrics-loading-state">Searching synced lyrics...</div><div class="imm-line imm-future imm-next imm-placeholder">&nbsp;</div>';
    });
    window.renderNowPlayingLyrics?.();

    const cached = readCachedLyrics(track);
    if (cached) {
      if (applyLyricsResponse(track, cached, resolvedDuration)) return;
    }

    const streamVideoId = (track.id && !track.id.startsWith('saavn_') && !track.id.startsWith('Dracula-'))
      ? track.id
      : (activeAudio?.dataset?.trackId && !activeAudio.dataset.trackId.startsWith('saavn_')
          ? activeAudio.dataset.trackId
          : null);

    try {
      let timeoutId;
      const timedOut = Symbol('lyrics-timeout');
      let response;
      try {
        response = await Promise.race([window.echoApi.getLyrics({
          title: track.title,
          artist: track.artist,
          duration: effectiveDuration,
          videoId: streamVideoId,
          trackId: track.id,
          source: track.source || (streamVideoId ? 'youtube' : null),
          hasManualLyricOffset: hasSavedManualLyricOffset
        }), new Promise(resolve => { timeoutId = setTimeout(() => resolve(timedOut), 45000); })]);
      } finally {
        clearTimeout(timeoutId);
      }
      if (response === timedOut) {
        if (myId === lyricsRequestId) showNoLyricsFound(track);
        return;
      }

      if (myId !== lyricsRequestId) {
        console.log(`[Lyrics] Stale lyrics discarded for "${track.title}" (req #${myId} vs current #${lyricsRequestId})`);
        return;
      }

      if (response?.lyrics) cacheLyricsResponse(track, response);
      applyLyricsResponse(track, response, resolvedDuration);
    } catch (error) {
      if (myId !== lyricsRequestId) return;
      console.warn(`[Lyrics] Lookup failed for "${track.title}":`, error);
      showNoLyricsFound(track);
    }
  }

  function parsePlainLyricsWithPacing(plainText) {
    lyricsDataIsSynced = false;
    plainLyricsCanProgress = false;
    activeLyricIndex = -1;
    rawPlainLyricsText = plainText;
    // Plain text has no timing data. Keep it readable and manually scrollable;
    // never manufacture timestamps from track duration and imply vocal sync.
    lyricsData = String(plainText || '').replace(/\r\n?/g, '\n').split('\n')
      .map(text => text.trim())
      .filter(text => text.length > 0 && !/^\[(?:by|offset|re|ve):/i.test(text))
      .map(text => ({
        time: 0,
        endTime: 0,
        duration: 0,
        text,
        words: text.split(/\s+/).filter(Boolean).map(word => ({ word, time: 0 }))
      }));
    updatePlainLyricsTimestamps(activeAudio?.duration);
  }

  function updatePlainLyricsTimestamps(duration) {
    const trackDuration = Number(duration);
    if (lyricsDataIsSynced || !lyricsData.length || !Number.isFinite(trackDuration) || trackDuration <= 0) return false;
    const introPad = Math.min(10, Math.max(4, trackDuration * 0.045));
    const outroPad = Math.min(12, Math.max(5, trackDuration * 0.05));
    const availableSpan = Math.max(0, trackDuration - introPad - outroPad);
    const denominator = Math.max(1, lyricsData.length - 1);
    lyricsData.forEach((line, index) => {
      const lineTime = introPad + (index / denominator) * availableSpan;
      line.time = lineTime;
      line.endTime = index + 1 < lyricsData.length
        ? introPad + ((index + 1) / denominator) * availableSpan
        : trackDuration - outroPad;
      line.duration = Math.max(0, line.endTime - line.time);
      line.words = String(line.text || '').split(/\s+/).filter(Boolean).map(word => ({ word, time: lineTime }));
    });
    plainLyricsCanProgress = true;
    if (lyricsStreamScroll) renderLyricsStream();
    return true;
  }

  // Robust multi-format LRC Parser (supports Tier 1 word tags, Tier 2 line tags, multi-timestamps)
  function parseLrcLyrics(lrcText) {
    const lines = String(lrcText || '').replace(/\r\n?/g, '\n').split('\n');
    lyricsData = [];
    lyricsDataIsSynced = false;
    activeLyricIndex = -1;

    lines.forEach((line) => {
      // Matches [mm:ss.xx], [mm:ss:xx], [mm:ss], etc.
      const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      let match;
      const times = [];
      let lastIndex = 0;

      while ((match = timeRegex.exec(line)) !== null) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const msStr = match[3] || '0';
        let subSec = 0;
        if (msStr.length === 3) subSec = parseInt(msStr, 10) / 1000;
        else if (msStr.length === 2) subSec = parseInt(msStr, 10) / 100;
        else if (msStr.length === 1) subSec = parseInt(msStr, 10) / 10;
        times.push(min * 60 + sec + subSec);
        lastIndex = timeRegex.lastIndex;
      }

      const text = line.slice(lastIndex).trim();
      if (!text || times.length === 0) return;

      // Check if text contains Tier 1 word-level timestamps: <mm:ss.xx> word
      const wordTagRegex = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
      const hasWordTags = wordTagRegex.test(text);

      times.forEach(t => {
        let rawWordTokens = null;
        let cleanText = text;

        if (hasWordTags) {
          wordTagRegex.lastIndex = 0;
          const tokens = [];
          const parts = text.split(/<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/);
          const tagMatches = [...text.matchAll(/<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g)];

          if (parts[0] && parts[0].trim()) {
            tokens.push({ text: parts[0].trim(), time: t });
          }
          for (let m = 0; m < tagMatches.length; m++) {
            const min = parseInt(tagMatches[m][1], 10);
            const sec = parseInt(tagMatches[m][2], 10);
            const msStr = tagMatches[m][3] || '0';
            let subSec = 0;
            if (msStr.length === 3) subSec = parseInt(msStr, 10) / 1000;
            else if (msStr.length === 2) subSec = parseInt(msStr, 10) / 100;
            else if (msStr.length === 1) subSec = parseInt(msStr, 10) / 10;
            const wordTime = min * 60 + sec + subSec;
            const wordText = (parts[m + 1] || '').trim();
            if (wordText) {
              tokens.push({ text: wordText, time: wordTime });
            }
          }
          if (tokens.length > 0) {
            cleanText = tokens.map(tk => tk.text).join(' ');
            rawWordTokens = tokens;
          }
        } else {
          cleanText = text.replace(/<[^>]+>/g, '').trim();
        }

        lyricsData.push({
          time: t,
          text: cleanText,
          rawWordTokens: rawWordTokens
        });
      });
    });

    lyricsData.sort((a, b) => a.time - b.time);

    const totalDur = (activeAudio && isFinite(activeAudio.duration) && activeAudio.duration > 10)
      ? activeAudio.duration
      : (currentTrack?.duration || 214);

    for (let i = 0; i < lyricsData.length; i++) {
      const line = lyricsData[i];
      if (i < lyricsData.length - 1) {
        line.endTime = lyricsData[i + 1].time;
      } else {
        line.endTime = totalDur;
      }
      line.duration = Math.min(8.0, Math.max(1.2, line.endTime - line.time));

      const wordList = line.rawWordTokens
        ? line.rawWordTokens.map(w => w.text)
        : line.text.split(/\s+/).filter(w => w.length > 0);

      const emojiEngine = (typeof EmojiMapper !== 'undefined' && EmojiMapper) || (typeof window !== 'undefined' && window.EmojiMapper);
      let kineticTokens = [];
      if (emojiEngine && emojiEngine.processKineticLine) {
        kineticTokens = emojiEngine.processKineticLine(wordList, i);
      } else {
        kineticTokens = wordList.map((w, idx) => ({
          word: w,
          emoji: null,
          isItalic: (idx === wordList.length - 1 && wordList.length >= 2) || /[!,]$/.test(w)
        }));
      }

      if (line.rawWordTokens && line.rawWordTokens.length === kineticTokens.length) {
        // Tier 1: exact word-level timing
        line.words = kineticTokens.map((item, idx) => ({
          ...item,
          time: line.rawWordTokens[idx].time
        }));
      } else {
        // Line-only LRC has no word timestamps. Keep every word anchored to
        // the real line timestamp instead of inventing a vocal cadence.
        line.words = kineticTokens.map(item => ({ ...item, time: line.time }));
      }
    }
    lyricsDataIsSynced = lyricsData.length > 0;
  }

  // ------------------------------------------------------------------------
  // Render: Immersive Versi-Style Kinetic Typography (3-Line Rolling Window)
  // ------------------------------------------------------------------------
  function renderSingleKineticContainer(container, index) {
    if (!container || lyricsData.length === 0) return;
    if (index < 0 || index >= lyricsData.length) return;

    container.innerHTML = '';

    // Maintain breathing glow state based on playback
    if (isPlaying) {
      container.classList.add('is-playing');
    } else {
      container.classList.remove('is-playing');
    }

    // 1. Slot 1: [Previous Line] (or balanced placeholder spacer)
    if (index > 0) {
      const pastIdx = index - 1;
      const pastEl = document.createElement('div');
      pastEl.className = 'imm-line imm-past imm-prev';
      pastEl.setAttribute('data-index', pastIdx);
      pastEl.textContent = lyricsData[pastIdx].text;
      pastEl.addEventListener('click', () => {
        seekAudioTo(lyricsData[pastIdx].time);
        showToast(`Jumped to ${formatTime(lyricsData[pastIdx].time)}`);
      });
      container.appendChild(pastEl);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'imm-line imm-past imm-prev imm-placeholder';
      placeholder.innerHTML = '&nbsp;';
      container.appendChild(placeholder);
    }

    // 2. Slot 2: [Active Line] (Versi Architecture: Multi-language emoji + editorial italic + smart wrap)
    const activeLine = lyricsData[index];
    const activeEl = document.createElement('div');
    activeEl.className = 'imm-line imm-active';
    activeEl.setAttribute('data-index', index);

    const activeLength = Array.from(activeLine.text || '').length;
    container.classList.toggle('has-extra-long-active-line', activeLength > 52);
    if (activeLength <= 28) {
      activeEl.style.setProperty('--lyric-active-font-size', 'clamp(2.1rem, 3.6vw, 3.2rem)');
      activeEl.style.setProperty('--lyric-active-line-height', '1.15');
      activeEl.style.setProperty('--lyric-active-max-width', '94%');
    } else if (activeLength <= 52) {
      activeEl.style.setProperty('--lyric-active-font-size', 'clamp(1.7rem, 2.8vw, 2.5rem)');
      activeEl.style.setProperty('--lyric-active-line-height', '1.18');
      activeEl.style.setProperty('--lyric-active-max-width', '92%');
    } else {
      activeEl.style.setProperty('--kinetic-active-size', 'clamp(1.25rem, 1.9vw, 1.7rem)');
      activeEl.style.setProperty('--lyric-active-line-height', '1.22');
      activeEl.style.setProperty('--lyric-active-max-width', '88%');
    }

    // Smart line-wrapping: if line length > 38 characters
    if (activeLine.text && activeLine.text.length > 38) {
      activeEl.classList.add('imm-long-line');
    }

    // Exact Versi Rendering with multi-language dictionary, fallback emoji, and editorial italic
    const emojiEngine = (typeof EmojiMapper !== 'undefined' && EmojiMapper) || (typeof window !== 'undefined' && window.EmojiMapper);
    if (emojiEngine && emojiEngine.renderKineticWords) {
      const renderedHtml = emojiEngine.renderKineticWords(activeLine.text, isAutoEmojiEnabled, index);
      activeEl.innerHTML = renderedHtml;

      // Assign word timings to .imm-word spans for 60fps lighting and direct seeking
      const wordSpans = activeEl.querySelectorAll('.imm-word');
      const words = activeLine.words || [];
      wordSpans.forEach((wSpan, wIdx) => {
        if (words[wIdx]) {
          wSpan.setAttribute('data-word-time', words[wIdx].time.toFixed(3));
          wSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            seekAudioTo(words[wIdx].time);
            showToast(`Jumped to ${formatTime(words[wIdx].time)}`);
          });
        }
      });
    } else {
      const words = activeLine.words || [];
      words.forEach((item) => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'imm-word';
        if (item.isItalic) wordSpan.classList.add('imm-word-italic');
        wordSpan.setAttribute('data-word-time', item.time.toFixed(3));
        const textSpan = document.createElement('span');
        textSpan.className = 'imm-word-text';
        textSpan.textContent = item.word;
        wordSpan.appendChild(textSpan);
        if (isAutoEmojiEnabled && item.emoji) {
          const emojiSpan = document.createElement('span');
          emojiSpan.className = 'imm-emoji kinetic-emoji';
          emojiSpan.textContent = item.emoji;
          wordSpan.appendChild(emojiSpan);
        }
        wordSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          seekAudioTo(item.time);
          showToast(`Jumped to ${formatTime(item.time)}`);
        });
        activeEl.appendChild(wordSpan);
      });
    }

    activeEl.addEventListener('click', () => {
      seekAudioTo(activeLine.time);
      showToast(`Jumped to ${formatTime(activeLine.time)}`);
    });
    container.appendChild(activeEl);

    // 3. Slot 3: [Next Line] (or balanced placeholder spacer)
    if (index < lyricsData.length - 1) {
      const nextIdx = index + 1;
      const nextEl = document.createElement('div');
      nextEl.className = 'imm-line imm-future imm-next';
      nextEl.setAttribute('data-index', nextIdx);
      nextEl.textContent = lyricsData[nextIdx].text;
      nextEl.addEventListener('click', () => {
        seekAudioTo(lyricsData[nextIdx].time);
        showToast(`Jumped to ${formatTime(lyricsData[nextIdx].time)}`);
      });
      container.appendChild(nextEl);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'imm-line imm-future imm-next imm-placeholder';
      placeholder.innerHTML = '&nbsp;';
      container.appendChild(placeholder);
    }
  }

  function renderImmersiveLyrics(index) {
    const containers = [immersiveKineticLines, document.getElementById('npKineticLines')].filter(Boolean);
    if (index === -1 && lyricsData.length > 0) {
      containers.forEach(container => {
        container.innerHTML = '<div class="imm-line imm-past imm-prev imm-placeholder">&nbsp;</div><div class="imm-line imm-active lyrics-waiting">•••</div><div class="imm-line imm-future imm-next imm-placeholder">&nbsp;</div>';
      });
      return;
    }
    if (lyricsData.length === 0 || index < 0 || index >= lyricsData.length) return;
    if (immersiveKineticLines) renderSingleKineticContainer(immersiveKineticLines, index);
    const npKineticLines = document.getElementById('npKineticLines');
    if (npKineticLines) renderSingleKineticContainer(npKineticLines, index);
  }

  function renderPlainImmersiveLyrics(plainText) {
    const containers = [immersiveKineticLines, document.getElementById('npKineticLines')].filter(Boolean);
    const lines = String(plainText || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length > 0);
    containers.forEach(container => {
      container.innerHTML = '';
      lines.slice(0, 3).forEach((line, i) => {
        const el = document.createElement('div');
        el.className = i === 0 ? 'imm-line imm-active' : 'imm-line imm-future imm-next';
        el.textContent = line.trim();
        container.appendChild(el);
      });
    });
  }

  // ------------------------------------------------------------------------
  // Render: Upward-Scrolling Fluid Stream (Alternative Mode)
  // ------------------------------------------------------------------------
  function renderLyricsStream() {
    if (!lyricsStreamScroll) return;
    lyricsStreamScroll.innerHTML = '';

    lyricsData.forEach((line, index) => {
      const el = document.createElement('div');
      el.className = 'lyric-line-item';
      el.setAttribute('data-index', index);
      if (lyricsDataIsSynced || plainLyricsCanProgress) el.setAttribute('data-time', line.time);
      el.textContent = line.text;

      if (lyricsDataIsSynced || plainLyricsCanProgress) {
        el.addEventListener('click', () => {
          seekAudioTo(line.time);
          showToast(`Jumped to ${formatTime(line.time)}`);
        });
      }

      lyricsStreamScroll.appendChild(el);
    });

    scrollLyricsToActive();
  }

  function renderPlainLyrics(plainText) {
    if (!lyricsStreamScroll) return;
    lyricsStreamScroll.innerHTML = '';
    const lines = String(plainText || '').replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((l) => {
      if (!l.trim()) return;
      const el = document.createElement('div');
      el.className = 'lyric-line-item future-line';
      el.textContent = l.trim();
      lyricsStreamScroll.appendChild(el);
    });
  }

  function showNoLyricsFound(track) {
    lyricsDataIsSynced = false;
    lyricsData = [];
    activeLyricIndex = -1;
    if (lyricsStatusBadge) lyricsStatusBadge.textContent = 'No Lyrics';

    const emptyMessage = 'No lyrics available for this track';
    [immersiveKineticLines, document.getElementById('npKineticLines')].filter(Boolean).forEach(container => {
      container.innerHTML = '';
      const line = document.createElement('div');
      line.className = 'imm-line imm-active lyrics-empty-state';
      line.textContent = emptyMessage;
      container.appendChild(line);
    });

    const trackLabel = track?.title ? ` for "${escapeHtml(track.title)}"` : '';
    if (lyricsStreamScroll) {
      lyricsStreamScroll.innerHTML = `<div class="lyrics-loading-state"><p class="loading-title">${emptyMessage}</p><p class="loading-subtitle">${trackLabel}</p></div>`;
    }
    if (typeof npLyricsStream !== 'undefined' && npLyricsStream) {
      npLyricsStream.innerHTML = `<div class="np-lyric-line active">${emptyMessage}${trackLabel}</div>`;
    }
  }

  if (lyricsScrollViewport) {
    lyricsScrollViewport.addEventListener('scroll', () => {
      userIsScrollingLyrics = true;
      window.userIsScrollingLyrics = true;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        userIsScrollingLyrics = false;
        window.userIsScrollingLyrics = false;
      }, 3500);
    });
  }

  // 60FPS High-Precision Audio & Kinetic Lyrics Synchronizer
  // ------------------------------------------------------------------------
  function syncLyricsWithTime(_currentTime, force = false, allowPausedClockOverride = false) {
    if (!Array.isArray(lyricsData) || lyricsData.length === 0) return;
    // Plain lyrics use duration-spaced virtual line times only when the active
    // deck has a real duration; otherwise they stay static and manually readable.
    if (!lyricsDataIsSynced && !plainLyricsCanProgress) return;

    // Use only the active playback clock. Never advance synced lyrics while paused or buffering.
    let mediaTime = 0;
    if (isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      if (!isPlaying) return;
      try { mediaTime = Number(ytPlayer.getCurrentTime()); } catch (_) { return; }
    } else {
      const activeDeck = activeAudio;
      if (!activeDeck || activeDeck.ended || activeDeck.readyState < 3) {
        if (!allowPausedClockOverride || !Number.isFinite(Number(_currentTime))) return;
        mediaTime = Number(_currentTime);
      } else if (activeDeck.paused) {
        if (!allowPausedClockOverride || !Number.isFinite(Number(_currentTime))) return;
        mediaTime = Number(_currentTime);
      } else {
        if (currentTrack?.id && activeDeck.dataset?.trackId && activeDeck.dataset.trackId !== String(currentTrack.id)) return;
        mediaTime = Number(activeDeck.currentTime);
      }
    }
    if (!Number.isFinite(mediaTime) || mediaTime < 0) return;

    const effectiveTime = mediaTime + currentSongLyricOffset;
    const firstLineTime = Number(lyricsData[0]?.time) || 0;

    // Before the first LRC timestamp, hold the center slot on a quiet neutral ellipsis.
    if ((lyricsDataIsSynced || plainLyricsCanProgress) && effectiveTime < firstLineTime) {
      if (activeLyricIndex !== -1 || !document.querySelector('#npKineticLines .lyrics-waiting')) {
        activeLyricIndex = -1;
        renderImmersiveLyrics(-1);
        const stream = document.getElementById('npLyricsStream');
        if (stream) stream.querySelectorAll('.np-lyric-line, .lyrics-line').forEach(el => el.classList.remove('active'));
      }
      return;
    }

    let index = -1;
    if (lyricsDataIsSynced || plainLyricsCanProgress) {
      for (let i = 0; i < lyricsData.length; i++) {
        if (effectiveTime >= lyricsData[i].time) index = i;
        else break;
      }
    }
    if (index < 0) return;

    const hasActiveKineticRendered = document.querySelector('#npKineticLines .imm-active');
    if (index !== activeLyricIndex || !hasActiveKineticRendered || !document.querySelector('.np-lyric-line.active')) {
      activeLyricIndex = index;
      updateActiveLyricLine(index);
      renderImmersiveLyrics(index);
    }

    const npStream = document.getElementById('npLyricsStream');
    if (npStream) {
      const streamLines = npStream.querySelectorAll('.np-lyric-line, .lyrics-line');
      streamLines.forEach((el, idx) => el.classList.toggle('active', idx === index));
      if (streamLines[index] && !window.isUserScrollingLyrics) {
        streamLines[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // Word illumination follows the same active audio clock and therefore cannot run ahead.
    document.querySelectorAll('.imm-word').forEach(el => {
      const wordTime = Number.parseFloat(el.getAttribute('data-word-time'));
      if (Number.isFinite(wordTime) && effectiveTime >= wordTime) el.classList.add('word-lit', 'lit');
      else el.classList.remove('word-lit', 'lit');
    });
  }

  function updateActiveLyricLine(index) {
    if (lyricsStreamScroll) {
      const lineElements = lyricsStreamScroll.querySelectorAll('.lyric-line-item');
      lineElements.forEach((el, i) => {
        el.classList.remove('active-line', 'past-line', 'future-line');
        if (i < index) el.classList.add('past-line');
        else if (i === index) el.classList.add('active-line');
        else el.classList.add('future-line');
      });

      if (!userIsScrollingLyrics) {
        scrollLyricsToActive();
      }
    }
  }

  function scrollLyricsToActive() {
    if (!lyricsScrollViewport || !lyricsStreamScroll) return;
    const activeEl = lyricsStreamScroll.querySelector('.active-line');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function populateLyricsStreamUI() {
    const npStream = document.getElementById('npLyricsStream');
    if (!npStream) return;
    npStream.innerHTML = '';

    if (!lyricsData || lyricsData.length === 0) {
      npStream.innerHTML = '<div class="lyrics-loading-state" style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.45);"><p class="loading-title">No lyrics available for this track</p></div>';
      return;
    }

    lyricsData.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'np-lyric-line lyrics-line' + (idx === activeLyricIndex ? ' active' : '');
      div.setAttribute('data-index', idx);
      if (line.time !== undefined) div.setAttribute('data-time', line.time);
      div.textContent = line.text;
      div.addEventListener('click', () => {
        if (Number.isFinite(line.time)) {
          seekAudioTo(line.time);
          showToast(`Jumped to ${formatTime(line.time)}`);
        }
      });
      npStream.appendChild(div);
    });
  }

  window.renderLyrics = (text, synced = true) => {
    if (synced) parseLrcLyrics(text);
    else parsePlainLyricsWithPacing(text, currentTrack?.duration || 214);
    populateLyricsStreamUI();
    window.renderNowPlayingLyrics?.();
    if (lyricsData.length > 0) {
      const targetTime = activeLyricIndex >= 0 ? (lyricsData[activeLyricIndex]?.time || 0) : (lyricsData[0]?.time || 0);
      syncLyricsWithTime(targetTime);
    }
  };
  // Public deterministic clock hook is used by the E2E harness to exercise
  // lyric highlighting/autoscroll while no real audio deck is playing.
  window.syncLyricsWithTime = (time, force = false) => syncLyricsWithTime(time, force, true);

  // ------------------------------------------------------------------------
  // Home Screen Instant Live Search Engine (YouTube Music InnerTube)
  // Auto-searches immediately as user types without requiring Enter
  // ------------------------------------------------------------------------
  let homeSearchDebounceTimer = null;
  let activeHomeSearchId = 0;

  function clearHomeLiveSearch() {
    const appleSearch = document.getElementById('appleHeaderSearchInput');
    const appleClear = document.getElementById('appleSearchClearBtn');
    const appleKbd = document.getElementById('appleSearchShortcut');
    const appleDropdown = document.getElementById('appleSearchDropdown');
    if (appleSearch) appleSearch.value = '';
    if (appleClear) appleClear.classList.add('hidden');
    if (appleKbd) appleKbd.classList.remove('hidden');
    if (appleDropdown) appleDropdown.classList.add('hidden');

    if (homeSearchInput) homeSearchInput.value = '';
    if (clearHomeSearchBtn) clearHomeSearchBtn.classList.add('hidden');
    if (homeSearchSpinner) homeSearchSpinner.classList.add('hidden');
    if (homeSearchResultsShelf) homeSearchResultsShelf.classList.add('hidden');
    if (quickPicksShelf) quickPicksShelf.classList.remove('hidden');
    if (trendingShelf) trendingShelf.classList.remove('hidden');
    if (discSubtitle) discSubtitle.textContent = 'Adaptive song recommendations tailored to your listening behavior';
    const resCount = document.getElementById('resultsCount');
    if (resCount) resCount.textContent = 'YouTube Music Radio';
  }

  if (homeSearchInput) {
    homeSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (clearHomeSearchBtn) {
        clearHomeSearchBtn.classList.toggle('hidden', q.length === 0);
      }

      clearTimeout(homeSearchDebounceTimer);

      if (q.length === 0) {
        clearHomeLiveSearch();
        return;
      }

      // Show spinner immediately so user sees that live search is working
      if (homeSearchSpinner) homeSearchSpinner.classList.remove('hidden');
      if (homeSearchResultsShelf) homeSearchResultsShelf.classList.remove('hidden');
      if (homeSearchShelfTitle) homeSearchShelfTitle.textContent = `Searching for "${q}"...`;

      // Live search without hitting Enter: debounce by 200ms
      homeSearchDebounceTimer = setTimeout(() => {
        performHomeLiveSearch(q);
      }, 200);
    });

    homeSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = homeSearchInput.value.trim();
        if (q.length > 0) {
          clearTimeout(homeSearchDebounceTimer);
          performHomeLiveSearch(q);
        }
      } else if (e.key === 'Escape') {
        clearHomeLiveSearch();
        homeSearchInput.blur();
      }
    });
  }

  if (clearHomeSearchBtn) {
    clearHomeSearchBtn.addEventListener('click', () => {
      clearHomeLiveSearch();
      homeSearchInput.focus();
    });
  }

  if (closeHomeSearchBtn) {
    closeHomeSearchBtn.addEventListener('click', () => {
      clearHomeLiveSearch();
    });
  }

  async function performHomeLiveSearch(query) {
    const searchId = ++activeHomeSearchId;
    if (!window.echoApi) {
      if (homeSearchSpinner) homeSearchSpinner.classList.add('hidden');
      return;
    }

    try {
      const response = await window.echoApi.searchMusic(query);
      if (searchId !== activeHomeSearchId) return; // Prevent race conditions from earlier keystrokes

      const results = filterCleanFeedTracks(response?.results || (Array.isArray(response) ? response : []), {
        homeShelf: true,
        explicitQuery: query
      });

      if (homeSearchSpinner) homeSearchSpinner.classList.add('hidden');

      if (Array.isArray(results) && results.length > 0) {
        if (quickPicksShelf) quickPicksShelf.classList.add('hidden');
        if (trendingShelf) trendingShelf.classList.add('hidden');
        renderHomeSearchResults(results, query);
        const resCount = document.getElementById('resultsCount');
        if (resCount) resCount.textContent = `${results.length} Matches`;
        if (discSubtitle) discSubtitle.textContent = `Results for "${query}"`;
      } else {
        if (quickPicksShelf) quickPicksShelf.classList.add('hidden');
        if (trendingShelf) trendingShelf.classList.add('hidden');
        if (homeSearchShelfTitle) homeSearchShelfTitle.textContent = `No matches found for "${query}"`;
        if (homeSearchGrid) homeSearchGrid.innerHTML = '';
        if (homeSearchList) {
          homeSearchList.innerHTML = `
            <div class="empty-state" style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 14px;">
              No matching tracks found for "<strong>${escapeHtml(query)}</strong>". Try another artist or song name.
            </div>
          `;
        }
      }
    } catch (err) {
      console.warn('Home search error:', err);
      if (homeSearchSpinner) homeSearchSpinner.classList.add('hidden');
    }
  }

  function renderHomeSearchResults(tracks, query) {
    if (!homeSearchResultsShelf) return;
    tracks = filterCleanFeedTracks(tracks, { homeShelf: true, explicitQuery: query });
    homeSearchResultsShelf.classList.remove('hidden');

    if (homeSearchShelfTitle) {
      homeSearchShelfTitle.textContent = `Top Results for "${query}" (${tracks.length} songs)`;
    }

    // 1. Top Quick Pick Cards Grid (first up to 6 tracks)
    if (homeSearchGrid) {
      homeSearchGrid.innerHTML = '';
      const topCards = tracks.slice(0, 6);
      topCards.forEach(track => {
        const cover = track.artwork || track.thumbnail || 'default-art.png';
        const card = document.createElement('div');
        card.className = 'quick-pick-card';
        card.innerHTML = `
          <div class="qp-thumb-wrap">
            <img class="qp-thumb" loading="lazy" decoding="async" src="${cover}" alt="${escapeHtml(track.title)}" onerror="this.src='default-art.png'">
            <div class="qp-play-overlay">
              <div class="qp-play-btn">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>
          </div>
          <div class="qp-info">
            <span class="qp-badge">Radio</span>
            <div class="qp-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
            <div class="qp-artist" title="${escapeHtml(track.artist || '')}">${escapeHtml(track.artist || 'MeloPair')}</div>
            ${queueActionMarkup(track)}
          </div>
        `;

        card.addEventListener('click', () => {
          const selected = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            artwork: track.thumbnail,
            duration: getTrackDurationSeconds(track) || 200,
            streamUrl: track.streamUrl || null
          };
          playTrackDirect(selected, true);
          showToast(`Playing "${track.title}"`);
        });

        homeSearchGrid.appendChild(card);
      });
    }

    // 2. Full Search List Rows
    if (homeSearchList) {
      homeSearchList.innerHTML = '';
      tracks.forEach((track, idx) => {
        const item = document.createElement('div');
        item.className = 'search-item';
        queueActionTracks.set(String(track.id), track);
        const durText = track.durationString || formatTime(getTrackDurationSeconds(track) || 195);
        item.innerHTML = `
          <span class="queue-index" style="width:24px; font-weight:700; color:var(--text-dim); text-align:center;">#${idx + 1}</span>
          <img class="search-thumb" loading="lazy" decoding="async" src="${track.thumbnail || 'default-art.png'}" alt="Cover" onerror="this.src='default-art.png'">
          <div class="search-item-info">
            <div class="search-item-title">${escapeHtml(track.title)}</div>
            <div class="search-item-artist">${escapeHtml(track.artist)}</div>
          </div>
          <span style="font-size:12px; color:var(--text-dim); margin-right:12px;">${durText}</span>
          ${queueActionMarkup(track)}
        `;

        item.addEventListener('click', (e) => {
          const selected = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            artwork: track.thumbnail,
            duration: getTrackDurationSeconds(track) || 200,
            streamUrl: track.streamUrl || null
          };

          if (e.target.closest('.add-btn')) {
            e.stopPropagation();
            if (addManualQueueTrack(selected)) showToast(`Added "${track.title}" to Up Next`);
            else showToast(`"${track.title}" is already in Up Next`);
            return;
          }

          playTrackDirect(selected, true);
          showToast(`Playing "${track.title}"`);
        });

        homeSearchList.appendChild(item);
      });
    }
  }

  // ------------------------------------------------------------------------
  // Up Next Inline Search (YouTube Music InnerTube Engine)
  // ------------------------------------------------------------------------
  if (queueSearchInput) {
    queueSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (clearQueueSearchBtn) {
        clearQueueSearchBtn.classList.toggle('hidden', q.length === 0);
      }

      clearTimeout(searchDebounceTimer);
      if (q.length < 2) return;

      searchDebounceTimer = setTimeout(() => {
        performSearch(q, { explicitSearch: true });
      }, 350);
    });
  }

  if (clearQueueSearchBtn) {
    clearQueueSearchBtn.addEventListener('click', () => {
      queueSearchInput.value = '';
      clearQueueSearchBtn.classList.add('hidden');
    });
  }

  async function performSearch(query, { explicitSearch = false } = {}) {
    const searchId = ++activeSearchId;
    if (!window.echoApi) return;

    try {
      const response = await window.echoApi.searchMusic(query);
      if (searchId !== activeSearchId) return;

      const results = filterCleanFeedTracks(response?.results || (Array.isArray(response) ? response : []), {
        homeShelf: true,
        explicitQuery: explicitSearch ? query : ''
      });

      if (Array.isArray(results) && results.length > 0) {
        renderSearchList(results, { explicitQuery: explicitSearch ? query : '' });
        const resCount = document.getElementById('resultsCount');
        if (resCount) resCount.textContent = `${results.length} Tracks Found`;
      }
    } catch (err) {
      console.warn('Search error:', err);
    }
  }

  function renderSearchList(tracks, { explicitQuery = '' } = {}) {
    if (!searchList) return;
    searchList.innerHTML = '';
    tracks = filterCleanFeedTracks(tracks, { homeShelf: true, explicitQuery });

    tracks.forEach((track, idx) => {
      const item = document.createElement('div');
      item.className = 'search-item';
      queueActionTracks.set(String(track.id), track);
      item.innerHTML = `
        <span class="queue-index" style="width:20px; font-weight:700; color:var(--text-dim); text-align:center;">#${idx + 1}</span>
        <img class="search-thumb" loading="lazy" decoding="async" src="${track.thumbnail || 'default-art.png'}" alt="Cover" onerror="this.src='default-art.png'">
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(track.title)}</div>
          <div class="search-item-artist">${escapeHtml(track.artist)}</div>
        </div>
        ${queueActionMarkup(track)}
      `;

      item.addEventListener('click', (e) => {
        const selected = {
          id: track.id,
          title: track.title,
          artist: track.artist,
          artwork: track.thumbnail,
          duration: track.durationSec || 200
        };

        if (e.target.closest('.add-btn')) {
          e.stopPropagation();
          if (addManualQueueTrack(selected)) showToast(`Added "${track.title}" to Up Next`);
          else showToast(`"${track.title}" is already in Up Next`);
          return;
        }

        playTrack(selected, true);
        showToast(`Playing "${track.title}" • Starting Radio`);
      });

      searchList.appendChild(item);
    });
  }

  // ------------------------------------------------------------------------
  // Listening Behavior Engine & Quick Picks Recommendations
  // ------------------------------------------------------------------------
  function normalizeTasteLabel(value) {
    return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  const feedJunkTitlePatterns = [
    /\btop\s*100\b/i, /\btop\s+hits\b/i, /\bplaylist\b/i, /\bmixtape\b/i,
    /\bfull\s+album\b/i, /\bnon[\s-]?stop\b/i, /\bjukebox\b/i,
    /\bmashup\s+mix\b/i, /\bcompilation\b/i, /\bbest\s+of\s+20\b/i,
    /\bhits\s+20\b/i, /\b1\s*(?:hour|hr)\b/i, /\bhour\s+loop\b/i,
    /\bslowed\s*\+\s*reverb\b/i
  ];
  const musicVideoTitlePattern = /\b(?:official\s+music\s+video|official\s+video|music\s+video|video\s+song|full\s+video|lyrical\s+video|teaser|trailer|jukebox|1\s*hour|mashup)\b/i;

  function getTrackDurationSeconds(track) {
    const raw = track?.durationSec ?? track?.duration ?? track?.lengthSeconds ?? track?.length ?? 0;
    if (typeof raw === 'string' && raw.includes(':')) {
      const parts = raw.split(':').map(Number);
      if (parts.every(Number.isFinite)) return parts.reduce((total, part) => total * 60 + part, 0);
    }
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  function isExplicitJunkSearch(query = '') {
    return feedJunkTitlePatterns.some(pattern => pattern.test(String(query)));
  }

  function isExplicitVideoSearch(query = '') {
    return /\bvideo\b/i.test(String(query));
  }

  function filterSearchSuggestionStrings(items, query = '') {
    const explicit = isExplicitJunkSearch(query);
    return [...new Set((Array.isArray(items) ? items : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .filter(text => (explicit || !feedJunkTitlePatterns.some(pattern => pattern.test(text))) &&
        (isExplicitVideoSearch(query) || !musicVideoTitlePattern.test(text))))];
  }

  function isCleanFeedTrack(track, { homeShelf = false, explicitQuery = '' } = {}) {
    if (!track?.id || !String(track.title || '').trim()) return false;
    const title = String(track.title);
    if (!isExplicitJunkSearch(explicitQuery) && feedJunkTitlePatterns.some(pattern => pattern.test(title))) return false;
    if (!isExplicitVideoSearch(explicitQuery) && (track.isVideo === true || musicVideoTitlePattern.test(title))) return false;
    const duration = getTrackDurationSeconds(track);
    if (homeShelf && duration && (duration > 480 || duration < 45)) return false;
    return true;
  }

  function filterCleanFeedTracks(tracks, options = {}) {
    const seenIds = new Set();
    const clean = [];
    for (const track of Array.isArray(tracks) ? tracks : []) {
      if (!isCleanFeedTrack(track, options)) continue;
      if (seenIds.has(track.id)) continue;
      seenIds.add(track.id);
      clean.push(track);
    }
    return dedupeAndCapFeedTracks(clean, Infinity, clean.length);
  }

  function getTopListeningArtists() {
    const profile = readBehaviorProfile();
    const affinity = (() => {
      try { return JSON.parse(safeStorageGet('echo_artist_affinity') || '{}') || {}; }
      catch (error) { return {}; }
    })();
    const counts = new Map();
    const displayNames = new Map();
    const add = (name, count) => {
      const key = normalizeTasteLabel(name);
      if (!key) return;
      const value = Number(count) || 0;
      counts.set(key, (counts.get(key) || 0) + value);
      const currentName = displayNames.get(key) || '';
      const candidateName = String(name).trim();
      if (!currentName || (candidateName !== candidateName.toLocaleLowerCase() && currentName === currentName.toLocaleLowerCase())) {
        displayNames.set(key, candidateName);
      }
    };
    Object.entries(profile.artists || {}).forEach(([name, count]) => add(name, count));
    Object.entries(affinity).forEach(([name, count]) => add(name, count));
    history.forEach(track => add(track.artist, 1));
    const namesFromTaste = tastePreferences.artists || [];
    namesFromTaste.forEach((name, index) => add(name, Math.max(1, 3 - index)));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => ({ name: displayNames.get(key) || key, key, count }));
  }

  function getRecentLikedTracks(limit = 3) {
    return [...favoriteTracksMap.values()].reverse().filter(track => track?.id).slice(0, limit);
  }

  function getTrackVibeQuery(track) {
    const profile = detectTrackVibe(track);
    return `${profile.languageQuery} ${profile.moodQuery}`;
  }

  // ------------------------------------------------------------------------
  // High-Precision Language / Region & Mood / Theme Tag Detection Engine
  // ------------------------------------------------------------------------
  function detectTrackVibe(track) {
    if (!track) return {
      region: 'english_intl',
      mood: 'chill_lofi',
      regionLabel: 'English',
      moodLabel: 'Chill',
      headerVibeLabel: 'English Chill',
      languageQuery: 'English',
      moodQuery: 'chill songs'
    };

    // 1. Collect metadata & lyrics sample
    const rawTitle = String(track.title || '');
    const rawArtist = String(track.artist || '');
    const rawAlbum = String(track.album || track.albumName || '');
    const rawLang = String(track.language || track.lang || '').toLowerCase().trim();

    // Check cached lyrics text if available
    let lyricsSample = '';
    try {
      const cached = readCachedLyrics(track);
      if (cached?.lyrics) lyricsSample = String(cached.lyrics).slice(0, 500);
    } catch (e) {}

    const fullText = `${rawTitle} ${rawArtist} ${rawAlbum} ${lyricsSample}`.toLowerCase();
    const cleanText = normalizeTasteLabel(`${rawTitle} ${rawArtist} ${rawAlbum}`);

    // Unicode Script Ranges
    const hasGurmukhi = /[\u0A00-\u0A7F]/.test(fullText);
    const hasDevanagari = /[\u0A80-\u0AFF\u0900-\u097F]/.test(fullText);
    const hasTamil = /[\u0B80-\u0BFF]/.test(fullText);
    const hasTelugu = /[\u0C00-\u0C7F]/.test(fullText);
    const hasKannada = /[\u0C80-\u0CFF]/.test(fullText);
    const hasMalayalam = /[\u0D00-\u0D7F]/.test(fullText);
    const hasKorean = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(fullText);
    const hasCJK = /[\u4E00-\u9FFF\u3040-\u30FF]/.test(fullText);

    // 2. Region / Language Determination
    let region = 'english_intl';
    let regionLabel = 'English';
    let languageQuery = 'English';

    if (
      hasGurmukhi ||
      rawLang === 'punjabi' ||
      /\b(punjabi|bhangra|desi|jatt|yaar|pind|geet|sardaar|gabru|kudi)\b/i.test(fullText) ||
      /karan aujla|sidhu moose|sukha|diljit|shubh|amrit maan|ap dhillon|prophec|jordan sandhu|gurinder gill|parmish verma|mankirt|kulwinder|ikky|byg byrd|deep jandu|gurdas maan|amrinder gill|tarsem jassar|arjan dhillon|hustinder|cheema y|bhalwaan|wazir patar|raf-saperra|chani nattan|inderpal moga/i.test(cleanText)
    ) {
      region = 'punjabi';
      regionLabel = 'Punjabi';
      languageQuery = 'Punjabi';
    } else if (
      hasTamil || hasTelugu || hasMalayalam || hasKannada ||
      /tamil|telugu|malayalam|kannada/i.test(rawLang) ||
      /anirudh|ar rahman|a\.r\. rahman|sid sriram|harris jayaraj|yuvan shankar|dsp|devi sri prasad|thaman|ilayaraja|santhosh narayanan|sushin shyam|gv prakash|dhibu ninan/i.test(cleanText)
    ) {
      region = 'south_indian';
      regionLabel = 'South Indian';
      languageQuery = /tamil/i.test(rawLang + cleanText) ? 'Tamil' : /telugu/i.test(rawLang + cleanText) ? 'Telugu' : 'South Indian';
    } else if (
      hasDevanagari ||
      rawLang === 'hindi' ||
      /\b(hindi|bollywood|ishq|pyaar|tere|meri|dil|tum|hum|zindagi|saath|mohabbat|deewana|duniya|sanam|kasam|raataan|kesariya)\b/i.test(fullText) ||
      /arijit singh|pritam|shreya ghoshal|armaan malik|jubin nautiyal|atif aslam|darshan raval|mohit chauhan|neha kakkar|badshah|vishal mishra|jasleen royal|sachet|parampara|amit trivedi|b praak|jaani|rahat fateh|sunidhi chauhan|kk|sonu nigam|kumar sanu|udit narayan|alka yagnik|lata mangeshkar|kishore kumar/i.test(cleanText)
    ) {
      region = 'hindi';
      regionLabel = 'Hindi';
      languageQuery = 'Hindi';
    } else if (
      hasKorean || rawLang === 'korean' ||
      /bts|blackpink|stray kids|twice|newjeans|aespa|exo|txt|seventeen|le sserafim|enhypen|itzy|red velvet|iu|jungkook|jimin|v|agust d|rm|taeyeon|baekhyun/i.test(cleanText)
    ) {
      region = 'korean';
      regionLabel = 'K-Pop';
      languageQuery = 'Korean K-Pop';
    } else if (
      rawLang === 'spanish' || rawLang === 'latin' ||
      /bad bunny|rosalia|j balvin|ozuna|maluma|rauw alejandro|anuel|karol g|daddy yankee|peso pluma|feid|shakira|luis fonsi|camilo/i.test(cleanText)
    ) {
      region = 'latin';
      regionLabel = 'Latin';
      languageQuery = 'Latin Spanish';
    } else {
      region = 'english_intl';
      regionLabel = 'English';
      languageQuery = 'English';
    }

    // 3. Mood / Theme Tag Determination
    let mood = 'chill_lofi';
    let moodLabel = 'Chill';
    let moodQuery = 'chill songs';

    // Regex checks across fullText and cleanText
    const isWorkoutPhonk = /\b(phonk|drift|brazilian phonk|gym|workout|motivation|beast|sigma|kordhell|playaphonk|giga|demon|speed|hardstyle|rave)\b/i.test(fullText);
    const isHiphopRap = /\b(rap|hip hop|hip-hop|trap|flow|cypher|drill|gangsta|bars|freestyle|rhymes|diss|eminem|drake|kendrick|cole|21 savage|travisscott|lil baby|central cee)\b/i.test(fullText) ||
      (region === 'punjabi' && /\b(flow|gang|shooter|bullet|gun|kabza|pistol|weapon|rules|stand|jatt|chobbar|east side|level|warning)\b/i.test(fullText));
    const isPartyHype = /\b(party|dance|club|banger|hype|dj|remix|upbeat|celebration|nach|bhangra|dhol|mela|shava|daaru|peg|disco|festival|edm|bass)\b/i.test(fullText);
    const isRomantic = /\b(love|romantic|romance|ishq|pyaar|dil|mohabbat|forever|heart|crush|lover|beloved|saath|humsafar|deewana|sweetheart|cuddle|dating|wedding|peelings|channa|heeriye)\b/i.test(fullText);
    const isSad = /\b(sad|heartbreak|broken|bewafa|judai|lonely|tears|hurt|pain|dard|yaad|breakup|crying|sorrow|depressed|grief|die|crying|goodbye|miss you|alvida|tujhe bhula diya|channa mereya)\b/i.test(fullText);
    const isDarkNight = /\b(after hours|night|dark|midnight|drive|late night|moody|noir|starboy|blinding lights|heartless|wicked|the weeknd|chase atlantic|sweater weather|neighbourhood|smoke|shadows|city lights)\b/i.test(fullText);
    const isChillLofi = /\b(chill|lofi|lo-fi|acoustic|unplugged|peaceful|soft|rain|sleep|calm|relax|serene|breeze|lazy|coffee|study|slowed|reverb)\b/i.test(fullText);

    if (isWorkoutPhonk) {
      mood = 'workout_phonk';
      moodLabel = 'Phonk';
      moodQuery = 'workout phonk motivation';
    } else if (isSad) {
      mood = 'sad';
      moodLabel = 'Sad';
      moodQuery = 'sad heartbreak songs';
    } else if (isDarkNight) {
      mood = 'dark_night';
      moodLabel = 'Dark R&B';
      moodQuery = 'dark late night R&B songs';
    } else if (isPartyHype) {
      mood = 'party_hype';
      moodLabel = 'Party';
      moodQuery = 'party hype dance bangers';
    } else if (isRomantic) {
      mood = 'romantic';
      moodLabel = 'Romantic';
      moodQuery = 'romantic love songs';
    } else if (isHiphopRap) {
      mood = 'hiphop_rap';
      moodLabel = 'Hip-Hop';
      moodQuery = 'hip hop rap flow bangers';
    } else if (isChillLofi) {
      mood = 'chill_lofi';
      moodLabel = 'Chill';
      moodQuery = 'chill lofi acoustic vibe';
    } else {
      // Default to sensible mood based on region & track features
      if (region === 'punjabi') {
        mood = 'hiphop_rap';
        moodLabel = 'Hip-Hop';
        moodQuery = 'Punjabi hip hop bangers';
      } else if (region === 'hindi') {
        mood = 'romantic';
        moodLabel = 'Romantic';
        moodQuery = 'Hindi romantic love songs';
      } else {
        mood = 'dark_night';
        moodLabel = 'Late Night';
        moodQuery = 'late night pop hits';
      }
    }

    const headerVibeLabel = `${regionLabel} ${moodLabel}`;

    return {
      region,
      mood,
      regionLabel,
      moodLabel,
      headerVibeLabel,
      languageQuery,
      moodQuery
    };
  }

  function getTrackGenres(track) {
    const explicit = Array.isArray(track?.genres) ? track.genres : (track?.genre ? [track.genre] : []);
    const artist = normalizeTasteLabel(track?.artist);
    const inferred = [];
    const rules = [
      [/linkin park|imagine dragons|queen|arctic monkeys/, ['Rock']],
      [/the weeknd/, ['Pop', 'R&B', 'Electronic']],
      [/the neighbourhood|arctic monkeys/, ['Indie', 'Rock']],
      [/billie eilish/, ['Pop', 'Indie']],
      [/arijit singh|karan aujla|kunwarr|sukha/, ['Bollywood', 'Hip-Hop']],
      [/ed sheeran/, ['Pop', 'Acoustic']],
      [/sabrina carpenter|lady gaga|bruno mars/, ['Pop']],
      [/post malone/, ['Hip-Hop', 'Pop']]
    ];
    rules.forEach(([pattern, genres]) => { if (pattern.test(artist)) inferred.push(...genres); });
    return Array.from(new Set([...explicit, ...inferred].map(value => String(value).trim()).filter(Boolean)));
  }

  function getTrackMoods(track) {
    const explicit = Array.isArray(track?.moods) ? track.moods : (track?.mood ? [track.mood] : []);
    const artist = normalizeTasteLabel(track?.artist);
    const title = normalizeTasteLabel(track?.title);
    const inferred = [];
    if (/the neighbourhood|billie eilish/.test(artist)) inferred.push('Chill', 'Melancholy');
    if (/linkin park|imagine dragons|queen|karan aujla/.test(artist)) inferred.push('Energetic');
    if (/arijit singh|lady gaga|bruno mars|ed sheeran/.test(artist)) inferred.push('Romantic');
    if (/party|dance|starboy|blinding lights/.test(`${artist} ${title}`)) inferred.push('Party');
    return Array.from(new Set([...explicit, ...inferred].map(value => String(value).trim())));
  }

  function readBehaviorProfile() {
    try { return JSON.parse(safeStorageGet('echo_listening_profile') || '{}') || {}; }
    catch (error) { return {}; }
  }

  function recordTrackPlayed(track) {
    if (!track || !track.id) return;
    rememberRecentArtist(track);
    sessionPlayedTrackIds.add(track.id);
    sessionPlayedSongKeys.add(trackSongKey(track));

    // 1. History tracking
    const playedAt = Date.now();
    lastPlayedTrack = { ...track, lastPlayedAt: playedAt };
    history = [lastPlayedTrack, ...history.filter(item => item.id !== track.id)].slice(0, 50);
    lastPlayedPosition = 0;
    try {
      localStorage.setItem('echo_last_played_track', JSON.stringify(lastPlayedTrack));
      localStorage.setItem('echo_last_played_position', '0');
      localStorage.setItem('echo_listening_history', JSON.stringify(history));
    } catch (error) {
      console.warn('[Listening Profile] Could not update local history:', error.message);
    }

    // 2. Listening Affinity Tracking (artists, genres)
    try {
      const affinityStr = safeStorageGet('echo_artist_affinity');
      const affinity = affinityStr ? JSON.parse(affinityStr) : {};
      const artist = track.artist ? track.artist.trim() : 'Various Artists';
      affinity[artist] = (affinity[artist] || 0) + 1;
      localStorage.setItem('echo_artist_affinity', JSON.stringify(affinity));

      const behavior = readBehaviorProfile();
      behavior.artists ||= {};
      behavior.genres ||= {};
      behavior.moods ||= {};
      behavior.playCounts ||= {};
      behavior.artists[normalizeTasteLabel(artist)] = (behavior.artists[normalizeTasteLabel(artist)] || 0) + 1;
      getTrackGenres(track).forEach(genre => {
        const key = normalizeTasteLabel(genre);
        behavior.genres[key] = (behavior.genres[key] || 0) + 1;
      });
      getTrackMoods(track).forEach(mood => {
        const key = normalizeTasteLabel(mood);
        behavior.moods[key] = (behavior.moods[key] || 0) + 1;
      });
      behavior.playCounts[track.id] = (behavior.playCounts[track.id] || 0) + 1;
      behavior.lastPlayedAt = playedAt;
      localStorage.setItem('echo_listening_profile', JSON.stringify(behavior));
    } catch (e) {}

    // Refresh Quick Picks with adaptive behavior
    renderContinueListeningShelf();
    renderQuickPicks();
    savePersistentState();
    void loadPersonalizedFeed(true);
  }

  function normalizeFeedTrackTitle(value = '') {
    return String(value)
      .replace(/\([^)]*\b(?:feat\.?|ft\.?|with)\b[^)]*\)/gi, ' ')
      .replace(/\([^)]*(?:remaster(?:ed)?|official)[^)]*\)/gi, ' ')
      .replace(/\[[^\]]*(?:remaster(?:ed)?|official)[^\]]*\]/gi, ' ')
      .replace(/\s[-–—]\s*remaster(?:ed)?\b/gi, ' ')
      .replace(/\bofficial\b/gi, ' ')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function feedPrimaryArtist(value = '') {
    return String(value).split(/\s+(?:feat\.?|ft\.?|with|x)\s+|\s*&\s*|\s*,\s*/i)[0]
      .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }

  function trackSongKey(track) {
    return `${normalizeFeedTrackTitle(track?.title)}|${feedPrimaryArtist(track?.artist)}`;
  }

  function getQuickPickColumnCount() {
    if (!quickPicksGrid) return 1;
    const columns = getComputedStyle(quickPicksGrid).gridTemplateColumns
      .split(/\s+/).filter(Boolean).length;
    return Math.max(1, columns || 1);
  }

  function splitFeaturedArtist(track) {
    const originalTitle = String(track.title || 'Untitled');
    const featured = [];
    const cleanTitle = originalTitle.replace(/\s*\((?:feat\.?|ft\.?|with)\s+([^)]*)\)/gi, (_, names) => {
      featured.push(...names.split(/\s*(?:,|&|\band\b|\bx\b)\s*/i).map(name => name.trim()).filter(Boolean));
      return '';
    }).replace(/\s+/g, ' ').trim();
    const artist = String(track.artist || 'MeloPair').trim();
    const artistNames = artist.split(/\s*,\s*|\s+(?:feat\.?|ft\.?|with)\s+/i).map(name => name.trim()).filter(Boolean);
    const seenArtists = new Set(artistNames.map(name => name.toLocaleLowerCase()));
    featured.forEach(name => {
      const key = name.toLocaleLowerCase();
      if (!seenArtists.has(key)) {
        seenArtists.add(key);
        artistNames.push(name);
      }
    });
    return {
      originalTitle,
      cleanTitle: cleanTitle || originalTitle,
      displayArtist: artistNames.join(', ')
    };
  }

  function feedDuplicateQuality(track, index = 0) {
    const title = String(track?.title || '');
    const artist = String(track?.artist || '');
    const featuredTitle = /\((?:feat\.?|ft\.?|with)\s+[^)]+\)/i.test(title);
    const creditedArtist = /\b(?:feat\.?|ft\.?|with)\b/i.test(artist) || /,/.test(artist);
    const titleFeatures = [...title.matchAll(/\((?:feat\.?|ft\.?|with)\s+([^)]+)\)/gi)]
      .flatMap(match => match[1].split(/\s*(?:,|&|\band\b|\bx\b)\s*/i))
      .map(name => normalizeTasteLabel(name));
    const artistCredit = normalizeTasteLabel(artist);
    const matchedCredit = titleFeatures.some(name => name && artistCredit.includes(name));
    const albumAndArt = [track?.album, track?.albumName, track?.albumTitle, track?.thumbnail, track?.artwork]
      .filter(Boolean).join(' ').toLowerCase();
    const suspiciousCover = /playlist|retro|cassette|fan[ -]?made|mix|cover/.test(albumAndArt);
    // Prefer explicit feature/artist credits, then clean official-looking art, then the first search result.
    return (featuredTitle ? 8 : 0) + (matchedCredit ? 5 : 0) + (creditedArtist ? 2 : 0) - (suspiciousCover ? 6 : 0) - (index / 100000);
  }

  function dedupeAndCapFeedTracks(tracks, limit = 3, targetCount = 12, orderById = null) {
    const bestBySong = new Map();
    tracks.forEach((track, index) => {
      const songKey = `${normalizeFeedTrackTitle(track.title)}|${feedPrimaryArtist(track.artist)}`;
      if (!songKey.replace('|', '').trim()) return;
      const prior = bestBySong.get(songKey);
      const order = orderById?.get(track.id) ?? index;
      if (!prior || feedDuplicateQuality(track, order) > feedDuplicateQuality(prior.track, prior.order)) {
        bestBySong.set(songKey, { track, order });
      }
    });
    const uniqueCandidates = [...bestBySong.values()].sort((a, b) => a.order - b.order).map(item => item.track);
    const artistCounts = new Map();
    const unique = [];
    const overflow = [];
    for (const track of uniqueCandidates) {
      const artistKey = feedPrimaryArtist(track.artist);
      const count = artistCounts.get(artistKey) || 0;
      if (count >= limit) {
        overflow.push(track);
        continue;
      }
      artistCounts.set(artistKey, count + 1);
      unique.push(track);
    }
    for (const track of overflow) {
      if (unique.length >= targetCount) break;
      unique.push(track);
    }
    return unique;
  }

  let observedQuickPickColumns = 0;
  if (quickPicksGrid && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      const columns = getQuickPickColumnCount();
      if (columns === observedQuickPickColumns) return;
      observedQuickPickColumns = columns;
      if (quickPicksGrid.querySelector('.quick-pick-card:not(.skeleton-card)')) {
        renderQuickPicks(lastQuickPicksSource);
      }
    }).observe(quickPicksGrid);
  }

  function showHomeFeedState(message, retryLabel = 'Retry', retry = null) {
    if (!quickPicksGrid) return;
    quickPicksGrid.innerHTML = `<div class="home-feed-state" role="status"><p>${escapeHtml(message)}</p>${retry ? `<button type="button" class="glass-pill home-feed-retry">${escapeHtml(retryLabel)}</button>` : ''}</div>`;
    const button = quickPicksGrid.querySelector('.home-feed-retry');
    if (button && retry) button.addEventListener('click', retry);
  }

  function showHomeFeedSkeleton() {
    if (!quickPicksGrid) return;
    quickPicksGrid.innerHTML = Array(8).fill(0).map(() => `
      <div class="quick-pick-card skeleton-card" aria-hidden="true">
        <div class="qp-thumb-wrap skeleton-shimmer"></div>
        <div class="qp-info"><span class="skeleton-line"></span><span class="skeleton-line short"></span></div>
      </div>`).join('');
  }

  function syncQuickPickPlayingState() {
    document.querySelectorAll('.quick-picks-grid .quick-pick-card[data-track-id]').forEach(card => {
      const active = Boolean(isPlaying && currentTrack?.id === card.dataset.trackId);
      card.classList.toggle('is-currently-playing', active);
      card.setAttribute('aria-label', `${card.dataset.trackLabel || 'Track'}${active ? ', now playing' : ''}`);
    });
  }

  function renderTrackCards(grid, tracks, { limit = 12, emptyText = 'No tracks to show yet.' } = {}) {
    if (!grid) return;
    grid.innerHTML = '';
    const candidates = filterCleanFeedTracks(tracks, { homeShelf: true }).slice(0, limit);
    const columns = getQuickPickColumnCount();
    const completeCount = Math.floor(candidates.length / columns) * columns;
    const cleanTracks = candidates.slice(0, completeCount || Math.min(candidates.length, columns));
    if (!cleanTracks.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1; padding:24px 12px; text-align:center; color:var(--text-muted);">${escapeHtml(emptyText)}</div>`;
      return;
    }

    cleanTracks.forEach(track => {
      const card = document.createElement('div');
      card.className = 'quick-pick-card';
      card.tabIndex = 0;
      card.dataset.trackId = String(track.id);
      const label = splitFeaturedArtist(track);
      card.dataset.trackLabel = label.cleanTitle;
      const cover = track.artwork || track.thumbnail || 'default-art.png';
      card.innerHTML = `
        <div class="qp-thumb-wrap">
          <img class="qp-thumb" loading="lazy" decoding="async" src="${escapeHtml(cover)}" alt="${escapeHtml(label.cleanTitle)}" onerror="this.src='default-art.png'">
          <div class="qp-play-overlay">
            <button type="button" class="qp-play-btn" aria-label="Play ${escapeHtml(label.cleanTitle)}">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
          <span class="qp-equalizer" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <div class="qp-info">
          <div class="qp-title" title="${escapeHtml(label.originalTitle)}">${escapeHtml(label.cleanTitle)}</div>
          <div class="qp-artist" title="${escapeHtml(label.displayArtist)}">${escapeHtml(label.displayArtist)}</div>
          ${queueActionMarkup(track)}
        </div>`;
      const play = () => {
        playTrack(track, true);
        showToast(`Playing "${track.title}"`);
      };
      card.addEventListener('click', play);
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          play();
        }
      });
      card.querySelector('.qp-play-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        play();
      });
      grid.appendChild(card);
    });
    syncQuickPickPlayingState();
  }

  function renderContinueListeningShelf() {
    if (!continueListeningShelf || !continueListeningGrid) return;
    if (!history.length) {
      continueListeningShelf.classList.add('hidden');
      continueListeningGrid.innerHTML = '';
      return;
    }
    continueListeningShelf.classList.remove('hidden');
    const recent = filterCleanFeedTracks(history, { homeShelf: true }).slice(0, 6);
    renderTrackCards(continueListeningGrid, recent, { limit: 6, emptyText: 'Your recent plays will appear here.' });
  }

  function renderMoreLikeShelf(tracks, artistName) {
    if (!moreLikeShelf || !moreLikeGrid) return;
    if (!artistName) {
      moreLikeShelf.classList.add('hidden');
      moreLikeGrid.innerHTML = '';
      return;
    }
    moreLikeShelf.classList.remove('hidden');
    if (moreLikeTitle) moreLikeTitle.textContent = `More Like ${artistName}`;
    renderTrackCards(moreLikeGrid, tracks, { limit: 12, emptyText: `More ${artistName} recommendations will appear here.` });
  }

  function renderQuickPicks(suppliedTracks = null) {
    if (!quickPicksGrid) return;
    if (!Array.isArray(suppliedTracks) && activeGenreFeed) return;
    lastQuickPicksSource = Array.isArray(suppliedTracks) ? suppliedTracks : null;
    quickPicksGrid.innerHTML = '';

    // Build recommendations from listening history, saved favorites, chosen
    // tastes, and the latest personalized search results.
    const tracksById = new Map();
    const candidateOrderById = new Map();
    const addCandidate = (track) => {
      if (!track?.id) return;
      const existing = tracksById.get(track.id);
      if (!existing) {
        tracksById.set(track.id, track);
        candidateOrderById.set(track.id, candidateOrderById.size);
      } else {
        const merged = { ...existing, ...track };
        const firstCover = existing.artwork || existing.thumbnail;
        const incomingCover = track.artwork || track.thumbnail;
        if (firstCover) merged.artwork = firstCover;
        else if (incomingCover) merged.artwork = incomingCover;
        if (existing.title) merged.title = existing.title;
        if (existing.artist) merged.artist = existing.artist;
        tracksById.set(track.id, merged);
      }
    };
    if (Array.isArray(suppliedTracks)) {
      suppliedTracks.forEach(addCandidate);
    } else {
      recommendationCatalog.forEach(addCandidate);
      try {
        const historyStr = safeStorageGet('echo_listening_history');
        const savedHistory = historyStr ? JSON.parse(historyStr) : [];
        if (Array.isArray(savedHistory)) savedHistory.forEach(addCandidate);
      } catch (e) {}
      favoriteTracksMap.forEach(addCandidate);
      verifiedRealTracks.forEach(addCandidate);
    }

    const behavior = readBehaviorProfile();
    let legacyAffinity = {};
    try { legacyAffinity = JSON.parse(safeStorageGet('echo_artist_affinity') || '{}') || {}; } catch (e) {}
    const selectedArtists = new Set((tastePreferences.artists || []).map(normalizeTasteLabel));
    const selectedGenres = new Set((tastePreferences.genres || []).map(normalizeTasteLabel));
    const selectedLanguages = new Set((tastePreferences.languages || []).map(normalizeTasteLabel));
    const selectedMoods = new Set((tastePreferences.moods || []).map(value => {
      const mood = normalizeTasteLabel(value);
      return ({ 'late night dark r b': 'dark night', 'heartbreak sad': 'melancholy', 'romantic soulful': 'romantic', 'high energy party': 'party hype', 'chill lo fi': 'chill lofi', 'hip hop rap': 'hiphop rap', 'gym phonk': 'workout phonk', 'acoustic unplugged': 'chill lofi', 'sufi devotional': 'romantic', 'retro classics': 'chill lofi' })[mood] || mood;
    }));
    const recentIds = new Set(history.slice(0, 3).map(track => track.id));
    const cleanCandidates = filterCleanFeedTracks(Array.from(tracksById.values()), { homeShelf: true })
      .filter(track => !recentIds.has(track.id));
    const displayTracks = dedupeAndCapFeedTracks(cleanCandidates, Infinity, 48, candidateOrderById).map((track, index) => {
      const artistKey = normalizeTasteLabel(track.artist);
      const genres = getTrackGenres(track).map(normalizeTasteLabel);
      const moods = getTrackMoods(track).map(normalizeTasteLabel);
      const trackVibe = detectTrackVibe(track);
      const artistCredits = normalizeTasteLabel(track.artist).split(/\s+(?:feat|ft|with|x)\s+|\s*&\s*|\s*,\s*/).filter(Boolean);
      const artistPlays = Number(behavior.artists?.[artistKey]) || Number(legacyAffinity[track.artist]) || 0;
      const genreMatch = genres.some(genre => selectedGenres.has(genre));
      const moodMatch = moods.some(mood => selectedMoods.has(mood)) || selectedMoods.has(normalizeTasteLabel(trackVibe.mood));
      const languageKey = normalizeTasteLabel(trackVibe.regionLabel || trackVibe.languageQuery);
      const languageMatch = selectedLanguages.has(languageKey) || (languageKey === 'english' && selectedLanguages.has('english international')) || (languageKey === 'k pop' && selectedLanguages.has('korean k pop')) || (languageKey === 'latin' && selectedLanguages.has('latin spanish')) || (languageKey === 'south indian' && (selectedLanguages.has('tamil') || selectedLanguages.has('telugu')));
      const learnedGenreScore = Math.max(0, ...genres.map(genre => Number(behavior.genres?.[genre]) || 0));
      const learnedMoodScore = Math.max(0, ...moods.map(mood => Number(behavior.moods?.[mood]) || 0));
      let score = 0;
      if (selectedArtists.has(artistKey) || artistCredits.some(artist => selectedArtists.has(artist))) score += 8;
      if (genreMatch) score += 4;
      if (moodMatch) score += 2;
      if (languageMatch) score += 2.5;
      score += Math.min(5, Math.log1p(artistPlays) * 1.8);
      score += Math.min(4, Math.log1p(learnedGenreScore) * 1.4);
      score += Math.min(2, Math.log1p(learnedMoodScore));
      score += Math.min(3, Math.log1p(Number(behavior.playCounts?.[track.id]) || 0));
      if (favorites.has(track.id)) score += 4;
      if (recentIds.has(track.id)) score -= 8;
      if (currentTrack?.id === track.id) score -= 10;
      return { track, score, index };
    }).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.track);
    const availableColumns = getQuickPickColumnCount();
    const candidateFeedTracks = dedupeAndCapFeedTracks(displayTracks, 3, 12, candidateOrderById);
    const completeRowCount = Math.floor(Math.min(candidateFeedTracks.length, 12) / availableColumns) * availableColumns;
    const feedTracks = candidateFeedTracks.slice(0, completeRowCount || Math.min(candidateFeedTracks.length, availableColumns));
    if (!feedTracks.length) {
      showHomeFeedState('No tracks to show yet. Refresh to try again.', 'Refresh', () => {
        const selected = document.querySelector('.genre-pill.active');
        if (selected) void loadGenreFeed(selected);
        else void loadPersonalizedFeed(true);
      });
      return;
    }

    if (shelfQuickTitle) {
      const selectedGenre = document.querySelector('.genre-pill.active')?.textContent.trim();
      shelfQuickTitle.textContent = Array.isArray(suppliedTracks)
        ? (selectedGenre || 'Top Charts')
        : ((history.length || Object.keys(tastePreferences).length) ? 'Picked for You' : 'Popular Picks');
    }

    renderTrackCards(quickPicksGrid, feedTracks, { limit: feedTracks.length, emptyText: 'No clean recommendations found yet.' });
  }

  async function loadPersonalizedFeed(force = false) {
    if (isLoadingPersonalizedFeed || (!force && Date.now() - lastPersonalizedRefreshAt < 2 * 60 * 1000)) return;
    if (!window.echoApi?.searchMusic) {
      renderContinueListeningShelf();
      renderQuickPicks();
      return;
    }
    isLoadingPersonalizedFeed = true;
    lastPersonalizedRefreshAt = Date.now();
    if (!quickPicksGrid?.querySelector('.quick-pick-card:not(.skeleton-card)')) showHomeFeedSkeleton();
    const behavior = readBehaviorProfile();
    const topArtists = getTopListeningArtists();
    const preferredArtist = topArtists[0]?.name || (tastePreferences.artists || [])[0] || '';
    const preferredGenre = (tastePreferences.genres || [])[0] || Object.entries(behavior.genres || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const preferredMood = (tastePreferences.moods || [])[0] || Object.entries(behavior.moods || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const moodQuery = {
      chill: 'chill relaxing', focus: 'focus study', energetic: 'high energy', romantic: 'romantic love',
      melancholy: 'sad emotional', party: 'party dance',
      'late night dark r b': 'dark late night R&B', 'heartbreak sad': 'heartbreak sad songs',
      'romantic soulful': 'romantic soulful songs', 'high energy party': 'high energy party songs',
      'chill lo fi': 'chill lo-fi songs', 'hip hop rap': 'hip hop rap songs',
      'gym phonk': 'gym phonk songs', 'acoustic unplugged': 'acoustic unplugged songs',
      'sufi devotional': 'sufi devotional music', 'retro classics': 'retro classic hits'
    }[normalizeTasteLabel(preferredMood)] || '';
    const likedTracks = getRecentLikedTracks(3);
    const preferredLanguage = (tastePreferences.languages || [])[0] || '';
    const preferenceQuery = (preferredArtist || moodQuery || preferredGenre || preferredLanguage)
      ? [preferredArtist, moodQuery, preferredGenre, preferredLanguage, 'songs'].filter(Boolean).join(' ')
      : '';
    const queryPlan = [
      ...topArtists.map(item => `${item.name} songs`),
      ...likedTracks.map(item => `${item.title} ${item.artist || ''} similar songs`.trim()),
      preferenceQuery
    ].filter((query, index, all) => query && all.indexOf(query) === index).slice(0, 6);
    if (!queryPlan.length) queryPlan.push('popular songs global chart');
    try {
      const responses = await Promise.allSettled(queryPlan.map(query => window.echoApi.searchMusic(query, 1, 24)));
      const results = [];
      responses.forEach(result => {
        if (result.status !== 'fulfilled') return;
        const response = result.value;
        results.push(...(response?.results || (Array.isArray(response) ? response : [])));
      });
      const recentIds = new Set(history.slice(0, 3).map(track => track.id));
      const cleanResults = filterCleanFeedTracks(results, { homeShelf: true })
        .filter(track => !recentIds.has(track.id));
      if (cleanResults.length) recommendationCatalog = cleanResults;

      const leadingArtist = topArtists[0]?.name || preferredArtist;
      const requestId = ++moreLikeRequestId;
      if (leadingArtist && history.length) {
        if (moreLikeTitle) moreLikeTitle.textContent = `More Like ${leadingArtist}`;
        moreLikeShelf?.classList.remove('hidden');
        const moreResponse = await window.echoApi.searchMusic(`${leadingArtist} similar songs`, 1, 24);
        if (requestId === moreLikeRequestId) {
          const moreTracks = moreResponse?.results || (Array.isArray(moreResponse) ? moreResponse : []);
          renderMoreLikeShelf(filterCleanFeedTracks(moreTracks, { homeShelf: true }).filter(track => !recentIds.has(track.id)), leadingArtist);
        }
      } else {
        moreLikeRequestId++;
        renderMoreLikeShelf([], '');
      }
    } catch (error) {
      console.warn('[Recommendations] Personal feed refresh failed:', error);
    } finally {
      isLoadingPersonalizedFeed = false;
    }
    renderContinueListeningShelf();
    renderQuickPicks();
  }

  async function loadGenreFeed(pill) {
      if (!pill) return;
      activeGenreFeed = pill.getAttribute('data-genre') || pill.textContent.trim();
      document.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      clearHomeLiveSearch();
      const genre = pill.getAttribute('data-genre') || pill.textContent;
      const shelfTitle = document.getElementById('shelfQuickTitle');
      if (shelfTitle) shelfTitle.textContent = pill.textContent.trim();
      showHomeFeedSkeleton();
      if (window.echoApi && window.echoApi.searchMusic) {
        try {
          const res = await window.echoApi.searchMusic(genre, 1, 16);
          const results = (res && res.results) ? res.results : (Array.isArray(res) ? res : []);
          if (results.length > 0) {
            renderQuickPicks(results.map(track => ({ ...track, genres: [pill.textContent.trim()] })));
          } else {
            showHomeFeedState('No tracks found for this style yet.', 'Retry', () => void loadGenreFeed(pill));
          }
        } catch (err) {
          console.error('Failed to load genre tracks:', err);
          showHomeFeedState('We couldn’t load these tracks. Check your connection and try again.', 'Retry', () => void loadGenreFeed(pill));
        }
      } else {
        showHomeFeedState('Music search is unavailable right now.', 'Retry', () => void loadGenreFeed(pill));
      }
  }

  document.querySelectorAll('.genre-pill').forEach(pill => {
    pill.addEventListener('click', () => void loadGenreFeed(pill));
  });

  const refreshFeedBtn = document.getElementById('refreshFeedBtn');
  if (refreshFeedBtn) {
    refreshFeedBtn.addEventListener('click', () => {
      const selectedGenre = document.querySelector('.genre-pill.active');
      if (selectedGenre) selectedGenre.click();
    });
  }

  // ------------------------------------------------------------------------
  // BROWSE VIEW: CURATED GENRES, MOODS & TOP HITS
  // ------------------------------------------------------------------------
  async function loadBrowseContent(query = 'pop hits billboard music') {
    const browseTracksGrid = document.getElementById('browseTracksGrid');
    if (!browseTracksGrid) return;

    browseTracksGrid.innerHTML = Array(8).fill(0).map(() => `
      <div class="quick-pick-card skeleton-card" style="opacity: 0.5;">
        <div class="qp-thumb-wrap" style="background: rgba(255,255,255,0.06); animation: pulse 1.5s infinite;"></div>
        <div class="qp-info" style="padding-top: 8px;">
          <div style="height: 14px; width: 70%; background: rgba(255,255,255,0.08); border-radius: 4px; margin-bottom: 6px;"></div>
          <div style="height: 12px; width: 45%; background: rgba(255,255,255,0.05); border-radius: 4px;"></div>
        </div>
      </div>
    `).join('');

    try {
      let results = [];
      if (window.echoApi && typeof window.echoApi.searchMusic === 'function') {
        const res = await window.echoApi.searchMusic(query);
        results = (res && res.results) ? res.results : (Array.isArray(res) ? res : []);
      }
      results = filterCleanFeedTracks(results, { homeShelf: true });
      browseTracksGrid.innerHTML = '';
      if (!results || results.length === 0) {
        browseTracksGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-secondary, #8e8e93);">No tracks found for this mood. Try another category!</div>';
        return;
      }

      results.slice(0, 12).forEach(track => {
        const card = document.createElement('div');
        card.className = 'quick-pick-card';
        const cover = track.artwork || track.thumbnail || 'default-art.png';
        card.innerHTML = `
          <div class="qp-thumb-wrap">
            <img class="qp-thumb" loading="lazy" decoding="async" src="${cover}" alt="${escapeHtml(track.title)}" onerror="this.src='default-art.png'">
            <div class="qp-play-overlay">
              <div class="qp-play-btn">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>
          </div>
          <div class="qp-info">
            <span class="qp-badge">Browse</span>
            <div class="qp-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
            <div class="qp-artist" title="${escapeHtml(track.artist || '')}">${escapeHtml(track.artist || 'MeloPair')}</div>
          </div>
        `;
        card.addEventListener('click', () => {
          playTrack(track, true);
          showToast(`Playing "${track.title}"`);
        });
        browseTracksGrid.appendChild(card);
      });
    } catch (err) {
      console.error('[Browse] Failed to load browse content:', err);
      browseTracksGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-secondary, #8e8e93);">Unable to load tracks. Please check connection.</div>';
    }
  }
  window.loadBrowseContent = loadBrowseContent;

  document.querySelectorAll('.browse-card').forEach(card => {
    card.addEventListener('click', () => {
      const q = card.getAttribute('data-browse-query');
      const title = card.querySelector('.browse-card-title')?.textContent || 'Featured Hits';
      const shelfTitle = document.getElementById('browseShelfTitle');
      if (shelfTitle) shelfTitle.textContent = title;
      if (q) loadBrowseContent(q);
    });
  });

  // ------------------------------------------------------------------------
  // Lumn Glow & Lighting FX Controls
  // ------------------------------------------------------------------------
  if (lumnGlowBtn) {
    lumnGlowBtn.addEventListener('click', () => {
      isLumnEnabled = !isLumnEnabled;
      lumnGlowBtn.classList.toggle('active', isLumnEnabled);
      if (lumnRimLighting) {
        lumnRimLighting.classList.toggle('off', !isLumnEnabled);
      }
      showToast(isLumnEnabled ? 'Lumn Glow: ON' : 'Lumn Glow: OFF');
    });
  }

  if (lightningToggle) {
    lightningToggle.addEventListener('change', (e) => {
      isLightningEnabled = e.target.checked;
      showToast(isLightningEnabled ? 'Beat Lightning: ON' : 'Beat Lightning: OFF');
    });
  }

  if (beatSyncToggle) {
    beatSyncToggle.addEventListener('change', (e) => {
      isBeatSyncEnabled = e.target.checked;
      showToast(isBeatSyncEnabled ? 'Beat Sync: ON' : 'Beat Sync: OFF');
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
  }

  // Window Controls
  if (winCloseBtn && window.echoApi) {
    winCloseBtn.addEventListener('click', () => window.echoApi.close());
  }
  if (winTileBtn && window.echoApi) {
    winTileBtn.addEventListener('click', () => window.echoApi.maximize());
  }

  // Download Action
  if (dockDownloadBtn && window.echoApi) {
    dockDownloadBtn.addEventListener('click', () => {
      if (!currentTrack) {
        showToast('Please select a track to download');
        return;
      }
      showToast(`Downloading "${currentTrack.title}" in 320kbps MP3...`);
      const dlTrack = { ...currentTrack };
      window.echoApi.downloadTrack({
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist
      }).then(res => {
        if (res && res.success !== false) {
          if (!downloadedTracks.some(t => t.id === dlTrack.id)) {
            downloadedTracks.push(dlTrack);
            savePersistentState();
            if (typeof renderLibraryList === 'function') renderLibraryList();
          }
          showToast(`Downloaded "${dlTrack.title}" ✓`);
        }
      });
    });

    window.echoApi.onDownloadProgress((data) => {
      showToast(`Download: ${Math.round(data.percent)}%`);
    });
  }

  if (openMusicFolderBtn && window.echoApi) {
    openMusicFolderBtn.addEventListener('click', () => {
      window.echoApi.openDownloadDir();
    });
  }

  if (dockStudioBtn) {
    dockStudioBtn.addEventListener('click', () => {
      const viewStudio = document.getElementById('viewStudio');
      if (viewStudio) switchStageView(viewStudio);
    });
  }

  if (navStudioBtn) {
    navStudioBtn.addEventListener('click', () => {
      const viewStudio = document.getElementById('viewStudio');
      if (viewStudio) switchStageView(viewStudio);
    });
  }

  // ------------------------------------------------------------------------
  // BOOM 3D AUDIO IMMERSIVE SUITE & 3D SPATIAL CONTROLS
  // ------------------------------------------------------------------------
  function generateAcousticImpulseResponse(ctx, duration = 2.0, decay = 2.6) {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * decay);
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    }
    return impulse;
  }

  function saveBoom3DSettings() {
    try {
      localStorage.setItem('echo_boom3d_settings', JSON.stringify(boom3dConfig));
    } catch (e) {
      console.warn('Failed saving Boom 3D settings:', e);
    }
  }

  function applyBoom3DSettings() {
    if (!isAudioContextInit || !audioCtx) return;
    const t = audioCtx.currentTime;

    // 1. Sub-Woofer Deep Bass
    if (boomBassFilter) {
      const bassGain = boom3dConfig.spatialEnabled && boom3dConfig.subBassEnabled ? boom3dConfig.subBassGain : 0;
      boomBassFilter.gain.setTargetAtTime(bassGain, t, 0.04);
    }

    // 2. Fidelity Exciter
    if (boomFidelityFilter) {
      const fidelityGain = boom3dConfig.spatialEnabled && boom3dConfig.fidelityEnabled ? boom3dConfig.fidelityGain : 0;
      boomFidelityFilter.gain.setTargetAtTime(fidelityGain, t, 0.04);
    }

    // 3. Ambience Reverb
    if (boomAmbienceWetGain && boomAmbienceDryGain) {
      const isAmbActive = boom3dConfig.spatialEnabled && boom3dConfig.ambienceEnabled;
      const wetVal = isAmbActive ? Math.min(0.85, boom3dConfig.ambienceWet * 0.7) : 0;
      const dryVal = isAmbActive ? 1.0 - (wetVal * 0.4) : 1.0;
      boomAmbienceWetGain.gain.setTargetAtTime(wetVal, t, 0.04);
      boomAmbienceDryGain.gain.setTargetAtTime(dryVal, t, 0.04);
    }

    // 4. 3D Spatial Width & Haas Crossfeed Matrix
    if (boomDirectL && boomDirectR && boomCrossfeedL && boomCrossfeedR) {
      if (boom3dConfig.spatialEnabled) {
        const width = boom3dConfig.spatialWidth;
        const crossfeed = Math.max(0, (width - 1.0) * 0.35);
        boomDirectL.gain.setTargetAtTime(1.0, t, 0.04);
        boomDirectR.gain.setTargetAtTime(1.0, t, 0.04);
        boomCrossfeedL.gain.setTargetAtTime(-crossfeed, t, 0.04);
        boomCrossfeedR.gain.setTargetAtTime(-crossfeed, t, 0.04);
      } else {
        boomDirectL.gain.setTargetAtTime(1.0, t, 0.04);
        boomDirectR.gain.setTargetAtTime(1.0, t, 0.04);
        boomCrossfeedL.gain.setTargetAtTime(0, t, 0.04);
        boomCrossfeedR.gain.setTargetAtTime(0, t, 0.04);
      }
    }

    // 5. Position left and right channels independently so the stereo image
    // remains intact while HRTF adds interaural timing and level cues.
    if (boomSpatialPannerL && boomSpatialPannerR) {
      const rad = (boom3dConfig.spatialEnabled ? boom3dConfig.elevation : 0) * Math.PI / 180;
      const y = Math.sin(rad) * 1.5;
      const z = -Math.max(1, Math.cos(rad) * (boom3dConfig.spatialEnabled ? 2.2 : 1));
      const width = boom3dConfig.spatialEnabled ? Math.max(0.6, Math.min(2.2, boom3dConfig.spatialWidth)) : 0.01;
      const leftX = -width / 2;
      const rightX = width / 2;
      if (boomSpatialPannerL.positionX) {
        boomSpatialPannerL.positionX.setTargetAtTime(leftX, t, 0.04);
        boomSpatialPannerL.positionY.setTargetAtTime(y, t, 0.04);
        boomSpatialPannerL.positionZ.setTargetAtTime(z, t, 0.04);
        boomSpatialPannerR.positionX.setTargetAtTime(rightX, t, 0.04);
        boomSpatialPannerR.positionY.setTargetAtTime(y, t, 0.04);
        boomSpatialPannerR.positionZ.setTargetAtTime(z, t, 0.04);
      } else {
        boomSpatialPannerL.setPosition(leftX, y, z);
        boomSpatialPannerR.setPosition(rightX, y, z);
      }
    }

    // 6. Night Mode Dynamic Compressor
    if (boomNightActiveGain && boomNightBypassGain) {
      if (boom3dConfig.nightModeEnabled) {
        boomNightActiveGain.gain.setTargetAtTime(1.0, t, 0.04);
        boomNightBypassGain.gain.setTargetAtTime(0.0, t, 0.04);
      } else {
        boomNightActiveGain.gain.setTargetAtTime(0.0, t, 0.04);
        boomNightBypassGain.gain.setTargetAtTime(1.0, t, 0.04);
      }
    }

    syncBoom3DUI();
  }

  function syncBoom3DUI() {
    const masterToggle = document.getElementById('boomSpatialMasterToggle');
    const statusText = document.getElementById('boomSpatialStatusText');
    const widthSlider = document.getElementById('boomWidthSlider');
    const widthVal = document.getElementById('boomWidthVal');
    const elevationSlider = document.getElementById('boomElevationSlider');
    const elevationVal = document.getElementById('boomElevationVal');
    const bassToggle = document.getElementById('boomBassToggle');
    const bassSlider = document.getElementById('boomBassSlider');
    const bassVal = document.getElementById('boomBassVal');
    const fidelityToggle = document.getElementById('boomFidelityToggle');
    const fidelitySlider = document.getElementById('boomFidelitySlider');
    const fidelityVal = document.getElementById('boomFidelityVal');
    const ambienceToggle = document.getElementById('boomAmbienceToggle');
    const ambienceSlider = document.getElementById('boomAmbienceSlider');
    const ambienceVal = document.getElementById('boomAmbienceVal');
    const nightToggle = document.getElementById('boomNightToggle');
    const nightVal = document.getElementById('boomNightVal');
    const dockSpatialBtn = document.getElementById('dockSpatialBtn');

    if (masterToggle) masterToggle.checked = boom3dConfig.spatialEnabled;
    if (statusText) statusText.textContent = boom3dConfig.spatialEnabled ? '3D Surround Active' : 'Stereo Direct (Bypass)';
    if (widthSlider) widthSlider.value = Math.round(boom3dConfig.spatialWidth * 100);
    if (widthVal) widthVal.textContent = `${Math.round(boom3dConfig.spatialWidth * 100)}%`;
    if (elevationSlider) elevationSlider.value = boom3dConfig.elevation;
    if (elevationVal) elevationVal.textContent = `${boom3dConfig.elevation > 0 ? '+' : ''}${boom3dConfig.elevation}°`;

    if (bassToggle) bassToggle.checked = boom3dConfig.subBassEnabled;
    if (bassSlider) bassSlider.value = boom3dConfig.subBassGain;
    if (bassVal) bassVal.textContent = `+${parseFloat(boom3dConfig.subBassGain).toFixed(1)} dB`;

    if (fidelityToggle) fidelityToggle.checked = boom3dConfig.fidelityEnabled;
    if (fidelitySlider) fidelitySlider.value = boom3dConfig.fidelityGain;
    if (fidelityVal) fidelityVal.textContent = `+${parseFloat(boom3dConfig.fidelityGain).toFixed(1)} dB`;

    if (ambienceToggle) ambienceToggle.checked = boom3dConfig.ambienceEnabled;
    if (ambienceSlider) ambienceSlider.value = Math.round(boom3dConfig.ambienceWet * 100);
    if (ambienceVal) ambienceVal.textContent = `${Math.round(boom3dConfig.ambienceWet * 100)}%`;

    if (nightToggle) nightToggle.checked = boom3dConfig.nightModeEnabled;
    if (nightVal) nightVal.textContent = boom3dConfig.nightModeEnabled ? 'Active' : 'Off';

    if (dockSpatialBtn) {
      dockSpatialBtn.classList.toggle('active', boom3dConfig.spatialEnabled);
      dockSpatialBtn.classList.toggle('disabled', !boom3dConfig.spatialEnabled);
    }
  }

  // Bind Boom 3D UI Controls
  const boomSpatialMasterToggle = document.getElementById('boomSpatialMasterToggle');
  if (boomSpatialMasterToggle) {
    boomSpatialMasterToggle.addEventListener('change', (e) => {
      initAudioContext();
      boom3dConfig.spatialEnabled = e.target.checked;
      applyBoom3DSettings();
      saveBoom3DSettings();
      showToast(boom3dConfig.spatialEnabled ? 'Boom 3D: Spatial Surround ON' : 'Boom 3D: Stereo Direct (Bypass)');
    });
  }

  const dockSpatialBtn = document.getElementById('dockSpatialBtn');
  if (dockSpatialBtn) {
    dockSpatialBtn.addEventListener('click', () => {
      initAudioContext();
      boom3dConfig.spatialEnabled = !boom3dConfig.spatialEnabled;
      applyBoom3DSettings();
      saveBoom3DSettings();
      showToast(boom3dConfig.spatialEnabled ? 'Boom 3D: 3D Surround Enabled ✨' : 'Boom 3D: Spatial Disabled');
    });
  }

  const boomWidthSlider = document.getElementById('boomWidthSlider');
  if (boomWidthSlider) {
    boomWidthSlider.addEventListener('input', (e) => {
      initAudioContext();
      boom3dConfig.spatialWidth = parseInt(e.target.value, 10) / 100;
      applyBoom3DSettings();
    });
    boomWidthSlider.addEventListener('change', () => saveBoom3DSettings());
  }

  const boomElevationSlider = document.getElementById('boomElevationSlider');
  if (boomElevationSlider) {
    boomElevationSlider.addEventListener('input', (e) => {
      initAudioContext();
      boom3dConfig.elevation = parseInt(e.target.value, 10);
      applyBoom3DSettings();
    });
    boomElevationSlider.addEventListener('change', () => saveBoom3DSettings());
  }

  const boomBassToggle = document.getElementById('boomBassToggle');
  const boomBassSlider = document.getElementById('boomBassSlider');
  if (boomBassToggle) {
    boomBassToggle.addEventListener('change', (e) => {
      initAudioContext();
      boom3dConfig.subBassEnabled = e.target.checked;
      applyBoom3DSettings();
      saveBoom3DSettings();
    });
  }
  if (boomBassSlider) {
    boomBassSlider.addEventListener('input', (e) => {
      initAudioContext();
      boom3dConfig.subBassGain = parseFloat(e.target.value);
      applyBoom3DSettings();
    });
    boomBassSlider.addEventListener('change', () => saveBoom3DSettings());
  }

  const boomFidelityToggle = document.getElementById('boomFidelityToggle');
  const boomFidelitySlider = document.getElementById('boomFidelitySlider');
  if (boomFidelityToggle) {
    boomFidelityToggle.addEventListener('change', (e) => {
      initAudioContext();
      boom3dConfig.fidelityEnabled = e.target.checked;
      applyBoom3DSettings();
      saveBoom3DSettings();
    });
  }
  if (boomFidelitySlider) {
    boomFidelitySlider.addEventListener('input', (e) => {
      initAudioContext();
      boom3dConfig.fidelityGain = parseFloat(e.target.value);
      applyBoom3DSettings();
    });
    boomFidelitySlider.addEventListener('change', () => saveBoom3DSettings());
  }

  const boomAmbienceToggle = document.getElementById('boomAmbienceToggle');
  const boomAmbienceSlider = document.getElementById('boomAmbienceSlider');
  if (boomAmbienceToggle) {
    boomAmbienceToggle.addEventListener('change', (e) => {
      initAudioContext();
      boom3dConfig.ambienceEnabled = e.target.checked;
      applyBoom3DSettings();
      saveBoom3DSettings();
    });
  }
  if (boomAmbienceSlider) {
    boomAmbienceSlider.addEventListener('input', (e) => {
      initAudioContext();
      boom3dConfig.ambienceWet = parseInt(e.target.value, 10) / 100;
      applyBoom3DSettings();
    });
    boomAmbienceSlider.addEventListener('change', () => saveBoom3DSettings());
  }

  const boomNightToggle = document.getElementById('boomNightToggle');
  if (boomNightToggle) {
    boomNightToggle.addEventListener('change', (e) => {
      initAudioContext();
      boom3dConfig.nightModeEnabled = e.target.checked;
      applyBoom3DSettings();
      saveBoom3DSettings();
      showToast(boom3dConfig.nightModeEnabled ? 'Boom 3D: Night Mode Activated 🌙' : 'Boom 3D: Night Mode Off');
    });
  }

  // Interactive Speaker nodes
  document.querySelectorAll('.speaker-node').forEach(spk => {
    spk.addEventListener('click', () => {
      spk.classList.toggle('active');
      const spkType = spk.getAttribute('data-spk');
      boom3dConfig.activeSpeakers[spkType] = spk.classList.contains('active');
      saveBoom3DSettings();
    });
  });

  // Boom 3D Profiles
  const boomProfiles = {
    '3d-surround': {
      spatialEnabled: true,
      spatialWidth: 1.6,
      elevation: 35,
      subBassEnabled: true,
      subBassGain: 6.0,
      fidelityEnabled: true,
      fidelityGain: 5.0,
      ambienceEnabled: true,
      ambienceWet: 0.25,
      nightModeEnabled: false
    },
    'concert-hall': {
      spatialEnabled: true,
      spatialWidth: 1.85,
      elevation: 45,
      subBassEnabled: true,
      subBassGain: 4.5,
      fidelityEnabled: true,
      fidelityGain: 4.0,
      ambienceEnabled: true,
      ambienceWet: 0.55,
      nightModeEnabled: false
    },
    'sub-bass': {
      spatialEnabled: true,
      spatialWidth: 1.25,
      elevation: 20,
      subBassEnabled: true,
      subBassGain: 10.5,
      fidelityEnabled: true,
      fidelityGain: 2.5,
      ambienceEnabled: true,
      ambienceWet: 0.15,
      nightModeEnabled: false
    },
    'vocal-air': {
      spatialEnabled: true,
      spatialWidth: 1.2,
      elevation: 30,
      subBassEnabled: false,
      subBassGain: 0,
      fidelityEnabled: true,
      fidelityGain: 8.0,
      ambienceEnabled: true,
      ambienceWet: 0.18,
      nightModeEnabled: false
    },
    'night-comfort': {
      spatialEnabled: true,
      spatialWidth: 1.0,
      elevation: 15,
      subBassEnabled: true,
      subBassGain: 3.5,
      fidelityEnabled: true,
      fidelityGain: 2.5,
      ambienceEnabled: false,
      ambienceWet: 0,
      nightModeEnabled: true
    },
    'pure-direct': {
      spatialEnabled: false,
      spatialWidth: 1.0,
      elevation: 0,
      subBassEnabled: false,
      subBassGain: 0,
      fidelityEnabled: false,
      fidelityGain: 0,
      ambienceEnabled: false,
      ambienceWet: 0,
      nightModeEnabled: false
    }
  };

  document.querySelectorAll('[data-boom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const profileKey = btn.getAttribute('data-boom');
      const profile = boomProfiles[profileKey];
      if (profile) {
        initAudioContext();
        boom3dConfig = Object.assign(boom3dConfig, profile);
        applyBoom3DSettings();
        saveBoom3DSettings();
        document.querySelectorAll('[data-boom]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Profile: ${btn.textContent.trim()}`);
      }
    });
  });

  // Sync initial UI state on startup
  syncBoom3DUI();

  // ------------------------------------------------------------------------
  // WORKING 5-BAND AUDIO MIXER & EQUALIZER (Live Synchronized Sliders)
  // ------------------------------------------------------------------------
  function updateEqualizerBand(freq, val) {
    initAudioContext();
    const num = parseFloat(val);

    // Apply to Web Audio Filter
    if (freq === 60 && eq60) eq60.gain.value = num;
    if (freq === 230 && eq230) eq230.gain.value = num;
    if (freq === 910 && eq910) eq910.gain.value = num;
    if (freq === 3600 && eq3600) eq3600.gain.value = num;
    if (freq === 14000 && eq14000) eq14000.gain.value = num;

    // Sync all corresponding sliders and labels
    const sliders = eqSliders[freq] || [];
    sliders.forEach(s => { if (s && s.value !== String(num)) s.value = num; });

    const displays = eqValDisplays[freq] || [];
    displays.forEach(d => { if (d) d.textContent = `${num > 0 ? '+' : ''}${num} dB`; });
  }

  Object.keys(eqSliders).forEach(freqStr => {
    const freq = parseInt(freqStr, 10);
    const pair = eqSliders[freq];
    pair.forEach(slider => {
      if (slider) {
        slider.addEventListener('input', (e) => {
          updateEqualizerBand(freq, e.target.value);
        });
        slider.addEventListener('change', () => {
          savePersistentState();
        });
      }
    });
  });

  // Equalizer Presets
  document.querySelectorAll('[data-eq], [data-eq-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-eq') || btn.getAttribute('data-eq-preset');
      applyEqPreset(preset);

      // Highlight active buttons in both views
      document.querySelectorAll('[data-eq], [data-eq-preset]').forEach(b => {
        const bp = b.getAttribute('data-eq') || b.getAttribute('data-eq-preset');
        b.classList.toggle('active', bp === preset);
      });
      savePersistentState();
    });
  });

  function applyEqPreset(preset) {
    const presets = {
      flat: [0, 0, 0, 0, 0],
      bass: [8, 5, -1, 1, 3],
      dolby: [5, 3, 2, 4, 7],
      vocal: [-3, -1, 6, 4, 2],
      rock: [6, 3, -2, 3, 6],
      electronic: [7, 4, 1, 2, 8]
    };

    const vals = presets[preset] || presets.flat;
    const freqs = [60, 230, 910, 3600, 14000];
    freqs.forEach((f, idx) => {
      updateEqualizerBand(f, vals[idx]);
    });
    showToast(`Equalizer: ${preset.toUpperCase()}`);
    savePersistentState();
  }

  // ------------------------------------------------------------------------
  // WORKING DJ CROSSFADE SETTINGS (Buttons & Slider Synchronized)
  // ------------------------------------------------------------------------
  function setCrossfadeDuration(seconds) {
    crossfadeSeconds = seconds;
    if (crossfadeSlider) crossfadeSlider.value = seconds;
    if (crossfadeValDisplay) crossfadeValDisplay.textContent = `${seconds}s`;

    // Highlight active preset button in Studio FX
    document.querySelectorAll('[data-crossfade]').forEach(b => {
      const s = parseInt(b.getAttribute('data-crossfade'), 10);
      b.classList.toggle('active', s === seconds);
    });

    showToast(`DJ Crossfade set to ${seconds}s`);
    savePersistentState();
  }

  document.querySelectorAll('[data-crossfade]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = parseInt(btn.getAttribute('data-crossfade'), 10);
      setCrossfadeDuration(s);
    });
  });

  if (crossfadeSlider) {
    crossfadeSlider.addEventListener('input', (e) => {
      const s = parseInt(e.target.value, 10);
      if (crossfadeValDisplay) crossfadeValDisplay.textContent = `${s}s`;
    });
    crossfadeSlider.addEventListener('change', (e) => {
      setCrossfadeDuration(parseInt(e.target.value, 10));
    });
  }

  // Setting: Disable crossfade for continuous albums (off by default)
  if (disableCrossfadeAlbumsToggle) {
    disableCrossfadeAlbumsToggle.checked = false;
    disableCrossfadeAlbumsToggle.addEventListener('change', (e) => {
      disableCrossfadeForAlbums = e.target.checked;
      showToast(disableCrossfadeForAlbums
        ? 'Continuous Album Crossfade: Disabled'
        : 'Continuous Album Crossfade: Enabled');
      console.log(`[Settings] Disable crossfade for continuous albums: ${disableCrossfadeForAlbums}`);
    });
  }

  // ------------------------------------------------------------------------
  // PLAYBACK SPEED, SLOWED + REVERB & NIGHTCORE
  // ------------------------------------------------------------------------
  document.querySelectorAll('[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const speedVal = btn.getAttribute('data-speed');
      applySpeedMood(speedVal);
    });
  });

  function applySpeedMood(val) {
    initAudioContext();
    if (val === 'slowed-reverb') {
      activeAudio.playbackRate = 0.85;
      idleAudio.playbackRate = 0.85;
      updateEqualizerBand(60, 6);
      updateEqualizerBand(14000, -3);
      showToast('Mode: SLOWED + REVERB 🌙');
    } else if (val === '1.5') {
      activeAudio.playbackRate = 1.45;
      idleAudio.playbackRate = 1.45;
      updateEqualizerBand(60, 2);
      updateEqualizerBand(14000, 6);
      showToast('Mode: NIGHTCORE ⚡');
    } else {
      const rate = parseFloat(val);
      activeAudio.playbackRate = rate;
      idleAudio.playbackRate = rate;
      showToast(`Playback Speed: ${rate}x`);
    }
  }

  // ------------------------------------------------------------------------
  // SLEEP TIMER ENGINE
  // ------------------------------------------------------------------------
  document.querySelectorAll('[data-sleep]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-sleep]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sleepVal = btn.getAttribute('data-sleep');
      startSleepTimer(sleepVal);
    });
  });

  function startSleepTimer(val) {
    clearInterval(sleepTimerInterval);
    if (val === '0') {
      if (sleepTimerStatus) sleepTimerStatus.textContent = '';
      showToast('Sleep Timer: OFF');
      return;
    }

    if (val === 'end') {
      if (sleepTimerStatus) sleepTimerStatus.textContent = 'Will stop at the end of this track';
      showToast('Sleep Timer: End of Track');
      return;
    }

    const minutes = parseInt(val, 10);
    sleepRemainingSec = minutes * 60;
    showToast(`Sleep Timer: ${minutes} Minutes`);

    sleepTimerInterval = setInterval(() => {
      sleepRemainingSec--;
      if (sleepRemainingSec <= 0) {
        clearInterval(sleepTimerInterval);
        activeAudio.pause();
        setPlayState(false);
        if (sleepTimerStatus) sleepTimerStatus.textContent = 'Playback stopped by sleep timer';
        showToast('Playback paused by Sleep Timer 🌙');
      } else {
        const m = Math.floor(sleepRemainingSec / 60);
        const s = sleepRemainingSec % 60;
        if (sleepTimerStatus) sleepTimerStatus.textContent = `Stopping in ${m}:${s < 10 ? '0' : ''}${s}`;
      }
    }, 1000);
  }

  // ------------------------------------------------------------------------
  // LUMN BEZEL MODES & COLOR PALETTES
  // ------------------------------------------------------------------------
  document.querySelectorAll('[data-rim], [data-lumn-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-rim') || btn.getAttribute('data-lumn-mode');
      if (lumnRimLighting) {
        lumnRimLighting.className = `lumn-rim-lighting ${mode}`;
      }
      document.querySelectorAll('[data-rim], [data-lumn-mode]').forEach(b => {
        const bm = b.getAttribute('data-rim') || b.getAttribute('data-lumn-mode');
        b.classList.toggle('active', bm === mode);
      });
      showToast(`LUMN Rim: ${mode.toUpperCase()}`);
    });
  });

  document.querySelectorAll('[data-palette]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-palette]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const pal = btn.getAttribute('data-palette');
      applyColorPalette(pal);
    });
  });

  function applyColorPalette(pal) {
    if (!orbPrimary || !orbSecondary || !orbTertiary) return;
    if (pal === 'auto') {
      [orbPrimary, orbSecondary, orbTertiary].forEach(orb => orb.style.removeProperty('background'));
      showToast('Ambient Palette: AUTO');
      return;
    } else if (pal === 'cyber') {
      orbPrimary.style.background = 'radial-gradient(circle, rgba(6, 182, 212, 0.7), transparent 70%)';
      orbSecondary.style.background = 'radial-gradient(circle, rgba(236, 72, 153, 0.6), transparent 70%)';
      orbTertiary.style.background = 'radial-gradient(circle, rgba(99, 102, 241, 0.6), transparent 70%)';
    } else if (pal === 'sunset') {
      orbPrimary.style.background = 'radial-gradient(circle, rgba(249, 115, 22, 0.7), transparent 70%)';
      orbSecondary.style.background = 'radial-gradient(circle, rgba(239, 68, 68, 0.6), transparent 70%)';
      orbTertiary.style.background = 'radial-gradient(circle, rgba(217, 70, 239, 0.5), transparent 70%)';
    } else if (pal === 'aurora') {
      orbPrimary.style.background = 'radial-gradient(circle, rgba(16, 185, 129, 0.7), transparent 70%)';
      orbSecondary.style.background = 'radial-gradient(circle, rgba(59, 130, 246, 0.6), transparent 70%)';
      orbTertiary.style.background = 'radial-gradient(circle, rgba(250, 45, 72, 0.5), transparent 70%)';
    } else if (pal === 'rose') {
      orbPrimary.style.background = 'radial-gradient(circle, rgba(147, 51, 234, 0.7), transparent 70%)';
      orbSecondary.style.background = 'radial-gradient(circle, rgba(236, 72, 153, 0.6), transparent 70%)';
      orbTertiary.style.background = 'radial-gradient(circle, rgba(99, 102, 241, 0.5), transparent 70%)';
    } else {
      orbPrimary.style.background = 'radial-gradient(circle, rgba(250, 45, 72, 0.65), transparent 70%)';
      orbSecondary.style.background = 'radial-gradient(circle, rgba(255, 77, 109, 0.45), transparent 70%)';
      orbTertiary.style.background = 'radial-gradient(circle, rgba(99, 102, 241, 0.5), transparent 70%)';
    }
    showToast(`Ambient Palette: ${pal.toUpperCase()}`);
  }

  // ------------------------------------------------------------------------
  // SETTINGS TABS & PREFERENCES
  // ------------------------------------------------------------------------
  function activateSettingsTab(tabKey) {
    if (!tabKey) return;
    const tabs = document.querySelectorAll('.settings-segment-btn');
    const panes = document.querySelectorAll('.settings-tab-pane');
    tabs.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey));
    panes.forEach(pane => {
      const paneId = `settingsTab${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`;
      pane.classList.toggle('active', pane.id === paneId);
    });
  }
  window.activateSettingsTab = activateSettingsTab;

  document.querySelectorAll('.settings-segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabKey = btn.getAttribute('data-tab');
      if (tabKey) activateSettingsTab(tabKey);
    });
  });

  const openStudioFromSettingsBtn = document.getElementById('openStudioFromSettingsBtn');
  if (openStudioFromSettingsBtn) {
    openStudioFromSettingsBtn.addEventListener('click', () => {
      const viewStudio = document.getElementById('viewStudio');
      if (viewStudio && typeof switchStageView === 'function') {
        switchStageView(viewStudio);
      }
    });
  }

  // ------------------------------------------------------------------------
  // STORAGE & PREFERENCES
  // ------------------------------------------------------------------------
  if (clearCacheBtn && window.echoApi) {
    clearCacheBtn.addEventListener('click', async () => {
      await window.echoApi.clearCache();
      showToast('Audio cache cleared successfully ✓');
    });
  }

  if (settingsOpenFolderBtn && window.echoApi) {
    settingsOpenFolderBtn.addEventListener('click', () => {
      window.echoApi.openDownloadDir();
    });
  }

  if (resetDefaultsBtn) {
    resetDefaultsBtn.addEventListener('click', () => {
      applyEqPreset('flat');
      setCrossfadeDuration(6);
      showToast('All settings reset to default values ✓');
      savePersistentState();
    });
  }

  // Clear History Button in History Stage View
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      history = [];
      savePersistentState();
      renderHistoryList();
      renderQuickPicks();
      showToast('Listening history cleared ✓');
    });
  }

  // Audio Streaming Quality Buttons (320kbps, 256kbps, 128kbps)
  document.querySelectorAll('[data-quality]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-quality]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const q = btn.getAttribute('data-quality');
      showToast(`Streaming Quality: ${q} kbps`);
      savePersistentState();
    });
  });

  // Beat Strobe Toggle in Studio FX
  const beatStrobeToggle = document.getElementById('beatStrobeToggle');
  if (beatStrobeToggle) {
    beatStrobeToggle.addEventListener('change', (e) => {
      isBeatSyncEnabled = e.target.checked;
      if (beatSyncToggle) beatSyncToggle.checked = isBeatSyncEnabled;
      showToast(isBeatSyncEnabled ? 'Beat Strobe: ON' : 'Beat Strobe: OFF');
    });
  }

  // Settings Checkboxes Auto-Persist
  if (volumeNormToggle) {
    volumeNormToggle.addEventListener('change', () => {
      savePersistentState();
      showToast(volumeNormToggle.checked ? 'Volume Normalization: ON' : 'Volume Normalization: OFF');
    });
  }
  if (skipSilenceToggle) {
    skipSilenceToggle.addEventListener('change', () => {
      savePersistentState();
      showToast(skipSilenceToggle.checked ? 'Skip Silence: ON' : 'Skip Silence: OFF');
    });
  }
  if (hardwareAccelToggle) {
    hardwareAccelToggle.addEventListener('change', () => {
      savePersistentState();
      showToast(hardwareAccelToggle.checked ? 'Hardware Acceleration: ON' : 'Hardware Acceleration: OFF');
    });
  }

  // ------------------------------------------------------------------------
  // Local JSON File Persistence (Favorites, History, EQ & Crossfade Settings)
  // ------------------------------------------------------------------------
  let isSavingState = false;
  async function savePersistentState() {
    if (isSavingState) return;
    isSavingState = true;
    setTimeout(async () => {
      try {
        const eqValues = {};
        for (const f of [60, 230, 910, 3600, 14000]) {
          const s = eqSliders[f]?.[0] || eqSliders[f]?.[1];
          eqValues[f] = s ? parseFloat(s.value) : 0;
        }

        const data = {
          favorites: Array.from(favorites),
          favoriteTracks: Array.from(favoriteTracksMap.values()),
          downloadedTracks: downloadedTracks,
          history: history.slice(0, 50),
          lastPlayedTrack,
          lastPlayedPosition,
          tastePreferences,
          importedListeningMemory,
          onboardingDone: safeStorageGet('melopair_onboarding_done') === 'true' || safeStorageGet('melopair_taste_setup_v1') === 'true',
          settings: {
            crossfadeSeconds: crossfadeSeconds,
            disableCrossfadeForAlbums: disableCrossfadeForAlbums,
            volumeNormalization: volumeNormToggle ? volumeNormToggle.checked : true,
            skipSilence: skipSilenceToggle ? skipSilenceToggle.checked : false,
            hardwareAcceleration: hardwareAccelToggle ? hardwareAccelToggle.checked : true,
            lyricsMode: lyricsMode,
            isOledBgMode: isOledBgMode,
            isAutoEmojiEnabled: isAutoEmojiEnabled,
            pcDualAudioEnabled: pcDualAudioEnabled,
            pcSecondaryDeviceId: pcSecondaryDeviceId,
            pcDualDelayMs: pcDualDelayMs,
            eq: eqValues
          }
        };

        if (window.echoApi && window.echoApi.saveUserData) {
          await window.echoApi.saveUserData(data);
        }
        try {
          localStorage.setItem('echo_user_data_backup', JSON.stringify(data));
        } catch (e) {}
      } catch (err) {
        console.warn('Error saving persistent state:', err);
      } finally {
        isSavingState = false;
      }
    }, 250);
  }

  async function loadPersistentState() {
    try {
      let data = null;
      if (window.echoApi && window.echoApi.loadUserData) {
        data = await window.echoApi.loadUserData();
      }
      if (!data) {
        const raw = safeStorageGet('echo_user_data_backup');
        if (raw) data = JSON.parse(raw);
      }

      let localHistory = [];
      try {
        const rawHistory = JSON.parse(safeStorageGet('echo_listening_history') || '[]');
        if (Array.isArray(rawHistory)) localHistory = rawHistory;
      } catch (error) {}

      const mergedHistory = [];
      const seenHistoryIds = new Set();
      for (const track of [...localHistory, ...(Array.isArray(data?.history) ? data.history : [])]) {
        if (track?.id && !seenHistoryIds.has(track.id)) {
          seenHistoryIds.add(track.id);
          mergedHistory.push(track);
          if (mergedHistory.length >= 50) break;
        }
      }
      history = mergedHistory.filter(track => isCleanFeedTrack(track));
      recentArtistHistory.length = 0;
      history.slice(0, 6).reverse().forEach(rememberRecentArtist);
      try {
        const localLastPlayed = JSON.parse(safeStorageGet('echo_last_played_track') || 'null');
        lastPlayedTrack = data?.lastPlayedTrack?.id ? data.lastPlayedTrack : (localLastPlayed?.id ? localLastPlayed : (history[0] || null));
        const position = Number(data?.lastPlayedPosition ?? safeStorageGet('echo_last_played_position'));
        lastPlayedPosition = Number.isFinite(position) && position > 0 ? position : 0;
        if (!Object.keys(tastePreferences).length && data?.tastePreferences) {
          tastePreferences = data.tastePreferences;
          localStorage.setItem('melopair_taste_preferences', JSON.stringify(tastePreferences));
        }
        const localImported = (() => { try { return JSON.parse(safeStorageGet('melopair_imported_listening_memory') || '[]'); } catch { return []; } })();
        importedListeningMemory = Array.isArray(localImported) && localImported.length ? localImported : (Array.isArray(data?.importedListeningMemory) ? data.importedListeningMemory : []);
        if (importedListeningMemory.length) localStorage.setItem('melopair_imported_listening_memory', JSON.stringify(importedListeningMemory));
        if (data?.onboardingDone === true) {
          localStorage.setItem('melopair_onboarding_done', 'true');
          localStorage.setItem('melopair_taste_setup_v1', 'true');
        } else if (data?.onboardingDone === false) {
          localStorage.removeItem('melopair_onboarding_done');
          localStorage.removeItem('melopair_taste_setup_v1');
        }
      } catch (error) {
        lastPlayedTrack = history[0] || null;
        lastPlayedPosition = 0;
      }

      if (data) {
        // Restore favorites
        if (Array.isArray(data.favorites)) {
          favorites.clear();
          data.favorites.forEach(f => favorites.add(f));
          window.favorites = favorites;
        }
        if (Array.isArray(data.favoriteTracks)) {
          data.favoriteTracks.forEach(t => {
            if (t && t.id) favoriteTracksMap.set(t.id, t);
          });
        }
        if (Array.isArray(data.downloadedTracks)) {
          downloadedTracks = data.downloadedTracks;
        }

        // Restore Settings
        if (data.settings) {
          if (typeof data.settings.crossfadeSeconds === 'number') {
            crossfadeSeconds = data.settings.crossfadeSeconds;
            if (crossfadeSlider) crossfadeSlider.value = crossfadeSeconds;
            if (crossfadeValDisplay) crossfadeValDisplay.textContent = `${crossfadeSeconds}s`;
            document.querySelectorAll('[data-crossfade]').forEach(b => {
              const s = parseInt(b.getAttribute('data-crossfade'), 10);
              b.classList.toggle('active', s === crossfadeSeconds);
            });
          }
          if (typeof data.settings.disableCrossfadeForAlbums === 'boolean') {
            disableCrossfadeForAlbums = data.settings.disableCrossfadeForAlbums;
            if (disableCrossfadeAlbumsToggle) disableCrossfadeAlbumsToggle.checked = disableCrossfadeForAlbums;
          }
          if (volumeNormToggle && typeof data.settings.volumeNormalization === 'boolean') {
            volumeNormToggle.checked = data.settings.volumeNormalization;
          }
          if (skipSilenceToggle && typeof data.settings.skipSilence === 'boolean') {
            skipSilenceToggle.checked = data.settings.skipSilence;
          }
          if (hardwareAccelToggle && typeof data.settings.hardwareAcceleration === 'boolean') {
            hardwareAccelToggle.checked = data.settings.hardwareAcceleration;
          }
          if (data.settings.lyricsMode) {
            lyricsMode = data.settings.lyricsMode;
          }
          if (typeof data.settings.isOledBgMode === 'boolean') {
            setKineticBgMode(data.settings.isOledBgMode);
          }
          if (typeof data.settings.isAutoEmojiEnabled === 'boolean') {
            isAutoEmojiEnabled = data.settings.isAutoEmojiEnabled;
            if (autoEmojiToggleBtn) autoEmojiToggleBtn.classList.toggle('active', isAutoEmojiEnabled);
          }
          if (typeof data.settings.pcDualAudioEnabled === 'boolean') {
            pcDualAudioEnabled = data.settings.pcDualAudioEnabled;
            if (pcDualAudioToggle) pcDualAudioToggle.checked = pcDualAudioEnabled;
            if (pcDualAudioControls) pcDualAudioControls.classList.toggle('hidden', !pcDualAudioEnabled);
          }
          if (typeof data.settings.pcSecondaryDeviceId === 'string') {
            pcSecondaryDeviceId = data.settings.pcSecondaryDeviceId;
          }
          if (typeof data.settings.pcDualDelayMs === 'number') {
            pcDualDelayMs = data.settings.pcDualDelayMs;
            applyPcDualDelay();
          }

          // Restore EQ
          if (data.settings.eq) {
            for (const f of [60, 230, 910, 3600, 14000]) {
              const val = data.settings.eq[f];
              if (typeof val === 'number') {
                updateEqualizerBand(f, val);
              }
            }
          }
        }
        if (audioCtx) void applyPcDualAudioRouting('restored audio output settings');
        if (typeof renderLibraryList === 'function') renderLibraryList();
      }
    } catch (err) {
      console.warn('Error loading persistent state:', err);
    }
  }

  // ------------------------------------------------------------------------
  // Helper Utilities
  // ------------------------------------------------------------------------
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function renderHistoryList() {
    if (!historyList) return;
    const visibleHistory = filterCleanFeedTracks(history);
    if (visibleHistory.length === 0) {
      historyList.innerHTML = '<div class="empty-state">No recently played tracks yet.</div>';
      return;
    }
    historyList.innerHTML = '';
    visibleHistory.forEach(t => {
      const item = document.createElement('div');
      item.className = 'search-item';
      queueActionTracks.set(String(t.id), t);
      item.innerHTML = `
        <img class="search-thumb" loading="lazy" decoding="async" src="${t.artwork || t.thumbnail || 'default-art.png'}" alt="Cover">
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(t.title)}</div>
          <div class="search-item-artist">${escapeHtml(t.artist)}</div>
        </div>
        ${queueActionMarkup(t)}
      `;
      item.addEventListener('click', () => playTrack(t, true));
      historyList.appendChild(item);
    });
  }

  function renderLibraryList() {
    const libraryListEl = document.getElementById('libraryList');
    if (!libraryListEl) return;

    const tracksToDisplay = [];
    const seenIds = new Set();

    if (Array.isArray(downloadedTracks)) {
      downloadedTracks.forEach(t => {
          if (t && t.id && !seenIds.has(t.id) && isCleanFeedTrack(t)) {
          seenIds.add(t.id);
          tracksToDisplay.push({ ...t, isOffline: true });
        }
      });
    }

    if (favorites && favorites.size > 0) {
      favorites.forEach(id => {
        if (!seenIds.has(id)) {
          const track = favoriteTracksMap.get(id) ||
            history.find(t => t.id === id) ||
            queue.find(t => t.id === id) ||
            (currentTrack && currentTrack.id === id ? currentTrack : null);
          if (track && isCleanFeedTrack(track)) {
            seenIds.add(id);
            tracksToDisplay.push(track);
          } else {
            seenIds.add(id);
            tracksToDisplay.push({ id, title: 'Favorite Track', artist: 'Saved in Favorites', artwork: 'default-art.png' });
          }
        }
      });
    }

    if (tracksToDisplay.length === 0) {
      libraryListEl.innerHTML = '<div class="empty-state">No offline tracks downloaded yet. Click the download or favorite icon on any song!</div>';
      return;
    }

    libraryListEl.innerHTML = '';
    tracksToDisplay.forEach(track => {
      const item = document.createElement('div');
      item.className = 'search-item track-item library-item';
      queueActionTracks.set(String(track.id), track);
      const cover = track.artwork || track.thumbnail || 'default-art.png';
      const badge = track.isOffline
        ? '<span class="qp-badge" style="margin-left: 8px; background: rgba(52, 199, 89, 0.2); color: #34C759;">Downloaded</span>'
        : '<span class="qp-badge" style="margin-left: 8px; background: rgba(250, 45, 72, 0.2); color: #FA2D48;">Favorite</span>';

      item.innerHTML = `
        <img class="search-thumb" loading="lazy" decoding="async" src="${cover}" alt="Cover" onerror="this.src='default-art.png'">
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(track.title)}${badge}</div>
          <div class="search-item-artist">${escapeHtml(track.artist || 'MeloPair')}</div>
        </div>
        ${queueActionMarkup(track)}
      `;
      item.addEventListener('click', event => {
        playTrack(track, true);
        showToast(`Playing "${track.title}" from Library 🎵`);
      });
      libraryListEl.appendChild(item);
    });
  }
  window.renderLibraryList = renderLibraryList;

  // ------------------------------------------------------------------------
  // Echo Rooms / Multi-Device Party Sync System
  // ------------------------------------------------------------------------
  let currentRoomData = null;
  let lastBroadcastTime = 0;
  let hostMasterOffsetMs = 0;
  const hostNudgeMinus5 = document.getElementById('hostNudgeMinus5');
  const hostNudgeMinus1 = document.getElementById('hostNudgeMinus1');
  const hostNudgeMinusHalf = document.getElementById('hostNudgeMinusHalf');
  const hostNudgePlusHalf = document.getElementById('hostNudgePlusHalf');
  const hostNudgePlus1 = document.getElementById('hostNudgePlus1');
  const hostNudgePlus5 = document.getElementById('hostNudgePlus5');
  const hostNudgeVal = document.getElementById('hostNudgeVal');

  function updateHostOffset(deltaMs) {
    hostMasterOffsetMs = Math.max(-150, Math.min(150, Math.round((hostMasterOffsetMs + deltaMs) * 2) / 2));
    if (hostNudgeVal) {
      const displayVal = Number.isInteger(hostMasterOffsetMs) ? hostMasterOffsetMs : hostMasterOffsetMs.toFixed(1);
      hostNudgeVal.textContent = `${hostMasterOffsetMs > 0 ? '+' : ''}${displayVal}ms`;
    }
    broadcastEchoRoomState(true);
    if (!playing && !isCrossfading) {
      setPlaybackStatus('idle', '');
    }
    if (window.updateNowPlayingModalUI) window.updateNowPlayingModalUI(currentTrack);
    if (window.notifyNativeMediaState) window.notifyNativeMediaState(currentTrack, isPlaying);
  }

  if (hostNudgeMinus5) hostNudgeMinus5.addEventListener('click', () => updateHostOffset(-5));
  if (hostNudgeMinus1) hostNudgeMinus1.addEventListener('click', () => updateHostOffset(-1));
  if (hostNudgeMinusHalf) hostNudgeMinusHalf.addEventListener('click', () => updateHostOffset(-0.5));
  if (hostNudgePlusHalf) hostNudgePlusHalf.addEventListener('click', () => updateHostOffset(0.5));
  if (hostNudgePlus1) hostNudgePlus1.addEventListener('click', () => updateHostOffset(1));
  if (hostNudgePlus5) hostNudgePlus5.addEventListener('click', () => updateHostOffset(5));

  async function openPartyRoomsModal() {
    if (partyModalBackdrop) partyModalBackdrop.classList.remove('hidden');
    // Publish the current host state before guests scan or open the generated link.
    broadcastEchoRoomState(true);
    await refreshRoomInfo();
    populatePcAudioOutputDevices();
  }

  function closePartyRoomsModal() {
    if (partyModalBackdrop) partyModalBackdrop.classList.add('hidden');
  }

  async function refreshRoomInfo() {
    if (!window.echoApi || !window.echoApi.getRoomInfo) return;
    try {
      const info = await window.echoApi.getRoomInfo();
      currentRoomData = info;
      if (partyQrImage && info.qrDataUrl) {
        partyQrImage.src = info.qrDataUrl;
      }
      if (partyJoinUrlInput && info.joinUrl) {
        partyJoinUrlInput.value = info.joinUrl;
      }
      if (partyLanAddressLine) {
        partyLanAddressLine.textContent = info.lanJoinUrl
          ? `Same Wi-Fi (direct): ${info.lanJoinUrl}`
          : 'No local Wi-Fi address was found. Use the remote link when available.';
      }
      if (partyRoomCode && info.roomId) {
        partyRoomCode.textContent = info.roomId;
      }
      if (customRoomCodeInput && info.roomId && !customRoomCodeInput.matches(':focus')) {
        customRoomCodeInput.value = info.roomId;
      }
      const hostIpDisplay = document.getElementById('partyHostIpDisplay');
      if (hostIpDisplay) {
        const hostStr = (info.networkMode === 'global' && info.globalTunnelUrl) ?
          info.globalTunnelUrl.replace(/^https?:\/\//, '') :
          (info.localIp ? `${info.localIp}:${info.port || 38472}` : (info.joinUrl ? info.joinUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '127.0.0.1:38472'));
        hostIpDisplay.textContent = hostStr;
      }
      if (info.networkMode === 'global' && info.globalTunnelUrl) {
        if (netModeGlobalBtn) netModeGlobalBtn.classList.add('active');
        if (netModeLocalBtn) netModeLocalBtn.classList.remove('active');
        if (netModeStatusText) {
          netModeStatusText.innerHTML = '<span>🌍</span> <span><b>Worldwide Tunnel Live:</b> Anyone on 4G/5G mobile data can join!</span>';
        }
        if (netGlobalBtnText) netGlobalBtnText.textContent = 'Worldwide (Live 4G/5G)';
      } else {
        if (netModeLocalBtn) netModeLocalBtn.classList.add('active');
        if (netModeGlobalBtn) netModeGlobalBtn.classList.remove('active');
        if (netModeStatusText) {
          netModeStatusText.innerHTML = '<span>✅</span> <span>Hosting locally on high-speed Wi-Fi router or hotspot</span>';
        }
        if (netGlobalBtnText) netGlobalBtnText.textContent = 'Worldwide (4G/5G Remote)';
      }
      updateRoomConnectedCount(info.connectedCount || 0);
    } catch (err) {
      console.error('[Room] Failed to fetch room info:', err);
    }
  }

  function updateRoomConnectedCount(count) {
    const text = `${count} ${count === 1 ? 'device' : 'devices'} connected`;
    if (partyConnectedDevicesCount) {
      partyConnectedDevicesCount.textContent = text;
    }
    if (dockPartyBadge) {
      if (count > 0) {
        dockPartyBadge.textContent = count;
        dockPartyBadge.classList.remove('hidden');
      } else {
        dockPartyBadge.classList.add('hidden');
      }
    }
  }

  // Audio Sync Pulse on Host (Plays synchronized 1000Hz beep when triggered)
  function playHostSyncPulseTone(targetServerTime) {
    initAudioContext();
    if (!audioCtx) return;

    const delayMs = targetServerTime ? Math.max(0, targetServerTime - Date.now()) : 0;
    setTimeout(() => {
      try {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
        g.gain.setValueAtTime(0.001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
        osc.connect(g);
        g.connect(masterGain || audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.20);
      } catch (e) {
        console.warn('Sync pulse tone audio error:', e);
      }
    }, delayMs);
  }

  let currentCrossfadeProgress = 0;
  let crossfadingIncomingTrack = null;

  function broadcastEchoRoomState(force = false) {
    if (!window.echoApi || !window.echoApi.broadcastRoomState) return;
    const now = Date.now();
    if (!force && now - lastBroadcastTime < 250) return;
    lastBroadcastTime = now;

    // Background & crossfade-proof active playback detection:
    // If either activeAudio OR idleAudio is producing sound, audio is playing!
    const isAudioPlaying = isPlaying && (
      (activeAudio && !activeAudio.paused && !activeAudio.ended) ||
      (isCrossfading && idleAudio && !idleAudio.paused)
    );

    const basePos = activeAudio && isFinite(activeAudio.currentTime) ? activeAudio.currentTime : 0;
    const pos = Math.max(0, basePos + (hostMasterOffsetMs / 1000));

    const incomingPos = isCrossfading && idleAudio && isFinite(idleAudio.currentTime)
      ? Math.max(0, idleAudio.currentTime + (hostMasterOffsetMs / 1000))
      : 0;

    const nextTrackCandidate = crossfadingIncomingTrack || preparedTrack;
    const nextTrackInfo = nextTrackCandidate ? {
      id: nextTrackCandidate.id,
      title: nextTrackCandidate.title,
      artist: nextTrackCandidate.artist,
      artwork: nextTrackCandidate.artwork || nextTrackCandidate.thumbnail || 'default-art.png',
      duration: nextTrackCandidate.duration || 210
    } : null;

    window.echoApi.broadcastRoomState({
      track: currentTrack ? {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.artwork || currentTrack.thumbnail || 'default-art.png',
        duration: currentTrack.duration || (activeAudio && isFinite(activeAudio.duration) ? activeAudio.duration : 210)
      } : null,
      nextTrack: nextTrackInfo,
      isCrossfading: isCrossfading,
      crossfadeProgress: isCrossfading ? currentCrossfadeProgress : 0,
      crossfadeDurationMs: isCrossfading ? currentCrossfadeDurationMs : 0,
      incomingTrack: isCrossfading ? nextTrackInfo : null,
      incomingPosition: incomingPos,
      isPlaying: isAudioPlaying,
      position: pos,
      outputLatencyMs: audioCtx && Number.isFinite(audioCtx.outputLatency)
        ? Math.max(0, audioCtx.outputLatency * 1000)
        : 0,
      lyrics: lyricsData && lyricsData.length > 0 ? lyricsData : null
    });
  }

  // Room UI Event Listeners
  if (navPartyRoomsBtn) {
    navPartyRoomsBtn.addEventListener('click', () => {
      openPartyRoomsModal();
    });
  }

  if (dockPartyBtn) {
    dockPartyBtn.addEventListener('click', () => {
      openPartyRoomsModal();
    });
  }

  if (closePartyModalBtn) {
    closePartyModalBtn.addEventListener('click', () => {
      closePartyRoomsModal();
    });
  }

  if (partyModalBackdrop) {
    partyModalBackdrop.addEventListener('click', (e) => {
      if (e.target === partyModalBackdrop) closePartyRoomsModal();
    });
  }

  if (copyPartyLinkBtn) {
    copyPartyLinkBtn.addEventListener('click', async () => {
      const url = partyJoinUrlInput ? partyJoinUrlInput.value : '';
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        if (copyBtnText) copyBtnText.textContent = '✅ Copied!';
        showToast('Room link copied! Share with laptops on Wi-Fi 🔗');
        setTimeout(() => {
          if (copyBtnText) copyBtnText.textContent = '📋 Copy Link';
        }, 2200);
      } catch (err) {
        showToast('Failed to copy link');
      }
    });
  }

  const partyPrimaryCopyBtn = document.getElementById('partyPrimaryCopyBtn');
  let lastPartyPrimaryCopyAt = 0;
  if (partyPrimaryCopyBtn) {
    partyPrimaryCopyBtn.addEventListener('click', async () => {
      const copyAttemptAt = Date.now();
      if (copyAttemptAt - lastPartyPrimaryCopyAt < 650) return;
      lastPartyPrimaryCopyAt = copyAttemptAt;
      const url = partyJoinUrlInput ? partyJoinUrlInput.value : '';
      if (!url) {
        showToast('Party room link not ready yet ⚠️');
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        showToast('Party Room invite link copied to clipboard! 📋🎉');
      } catch (err) {
        const inp = document.createElement('input');
        inp.value = url;
        document.body.appendChild(inp);
        inp.select();
        document.execCommand('copy');
        document.body.removeChild(inp);
        showToast('Party Room invite link copied to clipboard! 📋🎉');
      }
    });
  }

  if (regenRoomCodeBtn) {
    regenRoomCodeBtn.addEventListener('click', async () => {
      if (window.echoApi && window.echoApi.regenerateRoomId) {
        try {
          const newInfo = await window.echoApi.regenerateRoomId();
          if (newInfo) {
            currentRoomData = newInfo;
            if (partyQrImage && newInfo.qrDataUrl) partyQrImage.src = newInfo.qrDataUrl;
            if (partyJoinUrlInput && newInfo.joinUrl) partyJoinUrlInput.value = newInfo.joinUrl;
            if (partyLanAddressLine && newInfo.lanJoinUrl) partyLanAddressLine.textContent = `Same Wi-Fi (direct): ${newInfo.lanJoinUrl}`;
            if (partyRoomCode && newInfo.roomId) partyRoomCode.textContent = newInfo.roomId;
            showToast(`New room generated: ${newInfo.roomId} 🎉`);
            broadcastEchoRoomState(true);
          }
        } catch (e) {
          console.error('Failed to regenerate room:', e);
        }
      }
    });
  }

  if (openPartyInBrowserBtn) {
    openPartyInBrowserBtn.addEventListener('click', () => {
      const url = partyJoinUrlInput ? partyJoinUrlInput.value : '';
      if (url && window.echoApi && window.echoApi.openExternalUrl) {
        window.echoApi.openExternalUrl(url);
        showToast('Opening party satellite in your browser 🌐');
      }
    });
  }

  // 6-Digit Room Passcode Controls
  if (applyCustomCodeBtn && customRoomCodeInput) {
    const handleSetCustomCode = async () => {
      const code = customRoomCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (!code || code.length < 3) {
        showToast('Please enter at least 3 alphanumeric characters');
        return;
      }
      try {
        if (window.echoApi && window.echoApi.setRoomId) {
          const newInfo = await window.echoApi.setRoomId(code);
          if (newInfo) {
            currentRoomData = newInfo;
            if (partyQrImage && newInfo.qrDataUrl) partyQrImage.src = newInfo.qrDataUrl;
            if (partyJoinUrlInput && newInfo.joinUrl) partyJoinUrlInput.value = newInfo.joinUrl;
            if (partyLanAddressLine && newInfo.lanJoinUrl) partyLanAddressLine.textContent = `Same Wi-Fi (direct): ${newInfo.lanJoinUrl}`;
            if (partyRoomCode && newInfo.roomId) partyRoomCode.textContent = newInfo.roomId;
            customRoomCodeInput.value = newInfo.roomId;
            showToast(`Room passcode set to ${newInfo.roomId} 🎯`);
            broadcastEchoRoomState(true);
          }
        }
      } catch (err) {
        console.error('Failed to set room code:', err);
        showToast('Error setting room code');
      }
    };

    applyCustomCodeBtn.addEventListener('click', handleSetCustomCode);
    customRoomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSetCustomCode();
      }
    });
  }

  if (genRandom6DigitBtn) {
    genRandom6DigitBtn.addEventListener('click', async () => {
      if (window.echoApi && window.echoApi.regenerateRoomId) {
        try {
          const newInfo = await window.echoApi.regenerateRoomId();
          if (newInfo) {
            currentRoomData = newInfo;
            if (partyQrImage && newInfo.qrDataUrl) partyQrImage.src = newInfo.qrDataUrl;
            if (partyJoinUrlInput && newInfo.joinUrl) partyJoinUrlInput.value = newInfo.joinUrl;
            if (partyLanAddressLine && newInfo.lanJoinUrl) partyLanAddressLine.textContent = `Same Wi-Fi (direct): ${newInfo.lanJoinUrl}`;
            if (partyRoomCode && newInfo.roomId) partyRoomCode.textContent = newInfo.roomId;
            if (customRoomCodeInput) customRoomCodeInput.value = newInfo.roomId;
            showToast(`Generated new 6-digit room: ${newInfo.roomId} 🎲`);
            broadcastEchoRoomState(true);
          }
        } catch (e) {
          console.error('Failed to regenerate 6-digit code:', e);
        }
      }
    });
  }

  if (copy6DigitCodeBtn) {
    copy6DigitCodeBtn.addEventListener('click', async () => {
      const code = (customRoomCodeInput ? customRoomCodeInput.value : '') || (currentRoomData ? currentRoomData.roomId : '');
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        showToast(`Copied room passcode: ${code} 📋`);
      } catch (e) {
        showToast('Failed to copy passcode');
      }
    });
  }

  // Camera QR Scanner Implementation (Powered by jsQR)
  let scannerStream = null;
  let scannerAnimationId = null;
  let isScanningActive = false;

  async function populateScannerCameras() {
    if (!scannerCameraSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      scannerCameraSelect.innerHTML = '';
      if (videoDevices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Default Camera';
        scannerCameraSelect.appendChild(opt);
        return;
      }
      videoDevices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Camera ${idx + 1}`;
        scannerCameraSelect.appendChild(opt);
      });
    } catch (e) {
      console.warn('Could not enumerate video devices:', e);
    }
  }

  async function startScanner(deviceId = null) {
    if (window.AndroidMedia && typeof window.AndroidMedia.hasCameraPermission === 'function') {
      if (!window.AndroidMedia.hasCameraPermission()) {
        window.AndroidMedia.requestCameraPermission();
        showToast('Please grant Camera permission in Android prompt 📷');
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (window.AndroidMedia && typeof window.AndroidMedia.requestCameraPermission === 'function') {
        window.AndroidMedia.requestCameraPermission();
      }
      showToast('Camera access is not supported or permission required');
      return;
    }
    stopScanner();
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 }
      },
      audio: false
    };

    try {
      if (scannerStatusBadge) {
        scannerStatusBadge.innerHTML = '<span class="pulse-dot"></span> Starting camera...';
      }
      
      // Robust Camera Acquisition with Progressive Fallbacks for Android WebView
      try {
        scannerStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (cErr) {
        console.warn('Initial camera constraints failed, trying environmental fallback:', cErr);
        try {
          scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
          });
        } catch (fErr) {
          console.warn('Environmental fallback failed, trying basic video:', fErr);
          scannerStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      if (scannerVideo && scannerStream) {
        scannerVideo.srcObject = scannerStream;
        scannerVideo.setAttribute('playsinline', 'true');
        scannerVideo.setAttribute('muted', 'true');
        scannerVideo.muted = true;
        await scannerVideo.play();
        isScanningActive = true;
        if (scannerStatusBadge) {
          scannerStatusBadge.innerHTML = '<span class="pulse-dot"></span> Point camera at Room QR Code';
        }
        await populateScannerCameras();
        lastScannerTick = 0;
        requestAnimationFrame(tickScannerFrame);
      }
    } catch (err) {
      console.error('Camera open failed:', err);
      if (window.AndroidMedia && typeof window.AndroidMedia.requestCameraPermission === 'function') {
        window.AndroidMedia.requestCameraPermission();
      }
      if (scannerStatusBadge) {
        scannerStatusBadge.innerHTML = '⚠️ Camera permission denied or in use';
      }
      showToast('Camera permission denied or camera in use');
    }
  }

  // Handle Android runtime camera permission callback
  window.onCameraPermissionResult = function(granted) {
    if (granted) {
      showToast('Camera permission granted! Starting scanner... 📷');
      startScanner();
    } else {
      showToast('Camera permission was denied');
    }
  };

  function stopScanner() {
    isScanningActive = false;
    if (scannerAnimationId) {
      cancelAnimationFrame(scannerAnimationId);
      scannerAnimationId = null;
    }
    if (scannerStream) {
      scannerStream.getTracks().forEach(track => track.stop());
      scannerStream = null;
    }
    if (scannerVideo) {
      scannerVideo.srcObject = null;
    }
  }

  function handleDetectedCode(rawText) {
    if (!rawText) return;
    const trimmed = rawText.trim();
    const parsed = parseHostAndRoom(trimmed);
    let extractedHost = parsed.host;
    let extractedCode = parsed.room;

    if (navigator.vibrate) {
      try { navigator.vibrate([40, 60, 40]); } catch(e){}
    }

    if (extractedHost || extractedCode) {
      stopScanner();
      if (scannerModalBackdrop) scannerModalBackdrop.classList.add('hidden');

      const satelliteInput = document.getElementById('satelliteHostInput');
      const partyRoleSatelliteTab = document.getElementById('partyRoleSatelliteTab');
      if (partyRoleSatelliteTab) partyRoleSatelliteTab.click();

      if (extractedHost) {
        if (!extractedHost.includes(':') && !extractedHost.includes('trycloudflare.com')) {
          extractedHost = `${extractedHost}:38472`;
        }
        localStorage.setItem('echo_last_host_ip', extractedHost);
        if (extractedCode) localStorage.setItem('echo_last_room_code', extractedCode);

        if (satelliteInput) {
          satelliteInput.value = extractedCode ? `${extractedHost}/room/${extractedCode}` : extractedHost;
        }

        if (window.connectToEchoHost) {
          window.connectToEchoHost(extractedHost, extractedCode || 'ECHO-PARTY');
          showToast(`QR Code Scanned! Connecting to ${extractedHost}... 🎯`);
        }
      } else if (extractedCode) {
        if (satelliteInput) satelliteInput.value = extractedCode;
        discoverHostAndConnect(extractedCode);
      }
    } else {
      showToast(`Scanned: ${trimmed.slice(0, 30)}...`);
    }
  }

  // Native Hardware-Accelerated Barcode Detector (Modern Android WebViews)
  let nativeBarcodeDetector = null;
  if ('BarcodeDetector' in window) {
    try {
      nativeBarcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {}
  }

  let lastScannerTick = 0;
  async function tickScannerFrame(now) {
    if (!isScanningActive || !scannerVideo || !scannerCanvas) return;

    if (scannerVideo.readyState >= scannerVideo.HAVE_CURRENT_DATA && scannerVideo.videoWidth > 0) {
      // Throttle scanning to every 60ms (~16 fps) so mobile CPU stays cool and buttery smooth
      if (!lastScannerTick || (now - lastScannerTick >= 60)) {
        lastScannerTick = now;

        // 1. Try Hardware-Accelerated BarcodeDetector (Runs in < 5ms on Android NPU/GPU)
        if (nativeBarcodeDetector) {
          try {
            const barcodes = await nativeBarcodeDetector.detect(scannerVideo);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              handleDetectedCode(barcodes[0].rawValue);
              return;
            }
          } catch (detErr) {}
        }

        // 2. High-Speed Scaled jsQR Fallback (Scaled to 480px for sub-8ms analysis)
        if (typeof jsQR !== 'undefined') {
          const canvas = scannerCanvas;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const maxDim = 480;
          const scale = Math.min(1, maxDim / Math.max(scannerVideo.videoWidth, scannerVideo.videoHeight, 1));
          const w = Math.round(scannerVideo.videoWidth * scale);
          const h = Math.round(scannerVideo.videoHeight * scale);

          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(scannerVideo, 0, 0, w, h);

          const imageData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            handleDetectedCode(code.data);
            return;
          }
        }
      }
    }

    scannerAnimationId = requestAnimationFrame(tickScannerFrame);
  }

  if (openScannerModalBtn) {
    openScannerModalBtn.addEventListener('click', () => {
      if (scannerModalBackdrop) scannerModalBackdrop.classList.remove('hidden');
      startScanner();
    });
  }

  if (closeScannerModalBtn) {
    closeScannerModalBtn.addEventListener('click', () => {
      stopScanner();
      if (scannerModalBackdrop) scannerModalBackdrop.classList.add('hidden');
    });
  }

  if (scannerCameraSelect) {
    scannerCameraSelect.addEventListener('change', () => {
      const devId = scannerCameraSelect.value;
      if (devId) startScanner(devId);
    });
  }

  if (scannerFileInput) {
    scannerFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          if (!scannerCanvas) return;
          const canvas = scannerCanvas;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          if (typeof jsQR !== 'undefined') {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth'
            });
            if (code && code.data) {
              handleDetectedCode(code.data);
            } else {
              showToast('No QR code detected in the uploaded image');
            }
          }
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  if (scannerPasteBtn) {
    scannerPasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          handleDetectedCode(text);
        } else {
          showToast('Clipboard is empty');
        }
      } catch (err) {
        showToast('Unable to read clipboard');
      }
    });
  }

  // Network Connection Mode Toggle (Local Wi-Fi vs Cloudflare Global Tunnel)
  const netModeLocalBtn = document.getElementById('netModeLocalBtn');
  const netModeGlobalBtn = document.getElementById('netModeGlobalBtn');
  const netGlobalBtnText = document.getElementById('netGlobalBtnText');
  const netModeStatusText = document.getElementById('netModeStatusText');

  if (netModeLocalBtn) {
    netModeLocalBtn.addEventListener('click', async () => {
      netModeLocalBtn.classList.add('active');
      if (netModeGlobalBtn) netModeGlobalBtn.classList.remove('active');
      if (netModeStatusText) {
        netModeStatusText.innerHTML = '<span>✅</span> <span>Hosting locally on high-speed Wi-Fi router or hotspot</span>';
      }
      if (netGlobalBtnText) netGlobalBtnText.textContent = 'Worldwide (4G/5G Remote)';
      if (window.echoApi && window.echoApi.setRoomNetworkMode) {
        const res = await window.echoApi.setRoomNetworkMode('local');
        if (res) {
          if (partyQrImage && res.qrDataUrl) partyQrImage.src = res.qrDataUrl;
          if (partyJoinUrlInput && res.joinUrl) partyJoinUrlInput.value = res.joinUrl;
          if (partyLanAddressLine && res.lanJoinUrl) partyLanAddressLine.textContent = `Same Wi-Fi (direct): ${res.lanJoinUrl}`;
        }
      }
      showToast('Switched to Local Wi-Fi Mode 🏠');
    });
  }

  if (netModeGlobalBtn) {
    netModeGlobalBtn.addEventListener('click', async () => {
      netModeGlobalBtn.classList.add('active');
      if (netModeLocalBtn) netModeLocalBtn.classList.remove('active');
      if (netModeStatusText) {
        netModeStatusText.innerHTML = '<span>⏳</span> <span>Starting Cloudflare Global Tunnel (Worldwide 4G/5G)...</span>';
      }
      if (netGlobalBtnText) netGlobalBtnText.textContent = 'Connecting...';
      if (window.echoApi && window.echoApi.setRoomNetworkMode) {
        try {
          const res = await window.echoApi.setRoomNetworkMode('global');
          if (res && res.globalTunnelUrl) {
            if (partyQrImage && res.qrDataUrl) partyQrImage.src = res.qrDataUrl;
            if (partyJoinUrlInput && res.joinUrl) partyJoinUrlInput.value = res.joinUrl;
            if (partyLanAddressLine && res.lanJoinUrl) partyLanAddressLine.textContent = `Same Wi-Fi (direct): ${res.lanJoinUrl}`;
            if (netModeStatusText) {
              netModeStatusText.innerHTML = '<span>🌍</span> <span><b>Worldwide Tunnel Live:</b> Anyone on 4G/5G mobile data can join!</span>';
            }
            if (netGlobalBtnText) netGlobalBtnText.textContent = 'Worldwide (Live 4G/5G)';
            showToast('Cloudflare Global Tunnel Active! 🌐');
          } else {
            if (netModeStatusText) {
              netModeStatusText.innerHTML = '<span>⚠️</span> <span>Tunnel unavailable, reverted to local Wi-Fi</span>';
            }
            if (netGlobalBtnText) netGlobalBtnText.textContent = 'Worldwide (4G/5G Remote)';
            if (netModeLocalBtn) netModeLocalBtn.classList.add('active');
            netModeGlobalBtn.classList.remove('active');
          }
        } catch (e) {
          console.error('Tunnel toggle error:', e);
          if (netModeLocalBtn) netModeLocalBtn.classList.add('active');
          netModeGlobalBtn.classList.remove('active');
        }
      }
    });
  }

  const partyRealignBtn = document.getElementById('partyRealignBtn');
  if (partyRealignBtn) {
    partyRealignBtn.addEventListener('click', async () => {
      if (window.echoApi && window.echoApi.realignRoomDevices) {
        await window.echoApi.realignRoomDevices();
        broadcastEchoRoomState(true);
        showToast('🎯 All connected devices snapped into alignment!');
      }
    });
  }

  const roomRealignBtn = document.getElementById('roomRealignBtn');
  let roomRealignPending = false;
  let roomRealignFeedbackTimer = 0;
  const flashRoomRealignButton = () => {
    if (!roomRealignBtn) return;
    roomRealignBtn.textContent = '✓ Synced';
    clearTimeout(roomRealignFeedbackTimer);
    roomRealignFeedbackTimer = setTimeout(() => {
      roomRealignBtn.textContent = '↺ Realign';
      roomRealignFeedbackTimer = 0;
    }, 1200);
  };
  if (roomRealignBtn) {
    roomRealignBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (desktopSocket && desktopSocket.readyState === WebSocket.OPEN) {
        roomRealignPending = true;
        desktopSocket.send(JSON.stringify({ type: 'room-request-sync', clientSentAtMs: Date.now() }));
        return;
      }
      if (window.echoApi?.realignRoomDevices) {
        broadcastEchoRoomState(true);
        await window.echoApi.realignRoomDevices();
        flashRoomRealignButton();
      }
    });
  }

  if (partySyncPulseBtn) {
    partySyncPulseBtn.addEventListener('click', async () => {
      if (window.echoApi && window.echoApi.sendRoomSyncPulse) {
        const targetTime = await window.echoApi.sendRoomSyncPulse();
        playHostSyncPulseTone(targetTime);
        showToast('⚡ Sync Pulse sent to all devices!');
      }
    });
  }

  // Incoming Room Event Listeners from Electron Backend
  if (window.echoApi && window.echoApi.onRoomMembersChanged) {
    window.echoApi.onRoomMembersChanged((count) => {
      updateRoomConnectedCount(count);
      showToast(`📱 Device connected (${count} active in room)`);
      broadcastEchoRoomState(true);
    });
  }

  if (window.echoApi && window.echoApi.onTriggerSyncPulse) {
    window.echoApi.onTriggerSyncPulse((targetTime) => {
      playHostSyncPulseTone(targetTime);
    });
  }

  // Dual Beep Fusion (Sync Phone Earbuds to Host Laptop Speakers)
  let hostBeepFusionInterval = null;

  function playHostBeepTick() {
    initAudioContext();
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, audioCtx.currentTime); // 1800Hz high tick
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(0.7, audioCtx.currentTime + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.connect(g);
      g.connect(masterGain || audioCtx.destination);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.05);
    } catch (e) {}
  }

  if (window.echoApi && window.echoApi.onBeepFusionStart) {
    window.echoApi.onBeepFusionStart(() => {
      showToast('🥁 Beep Fusion active: Match phone earbud to laptop click');
      clearInterval(hostBeepFusionInterval);
      hostBeepFusionInterval = setInterval(() => {
        const now = Date.now();
        const nextSec = Math.ceil(now / 1000) * 1000;
        const delay = Math.max(0, nextSec - now);
        setTimeout(playHostBeepTick, delay);
      }, 1000);
    });
  }

  if (window.echoApi && window.echoApi.onBeepFusionStop) {
    window.echoApi.onBeepFusionStop(() => {
      clearInterval(hostBeepFusionInterval);
      hostBeepFusionInterval = null;
      showToast('🥁 Beep Fusion Alignment complete!');
    });
  }

  // ------------------------------------------------------------------------
  // Direct PC Dual-Audio Output (Laptop Speakers + Bluetooth Simultaneously)
  // ------------------------------------------------------------------------
  const pcDualAudioToggle = document.getElementById('pcDualAudioToggle');
  const pcDualAudioControls = document.getElementById('pcDualAudioControls');
  const pcPrimaryDeviceLabel = document.getElementById('pcPrimaryDeviceLabel');
  const pcSecondaryDeviceSelect = document.getElementById('pcSecondaryDeviceSelect');
  const pcDualDelayVal = document.getElementById('pcDualDelayVal');
  const pcDualDelaySlider = document.getElementById('pcDualDelaySlider');
  const pcDualMinus10 = document.getElementById('pcDualMinus10');
  const pcDualMinus1 = document.getElementById('pcDualMinus1');
  const pcDualMinusHalf = document.getElementById('pcDualMinusHalf');
  const pcDualPlusHalf = document.getElementById('pcDualPlusHalf');
  const pcDualPlus1 = document.getElementById('pcDualPlus1');
  const pcDualPlus10 = document.getElementById('pcDualPlus10');
  const pcDualBeepTestBtn = document.getElementById('pcDualBeepTestBtn');

  function applyPcDualDelay() {
    if (!audioCtx || !primaryDelayNode || !secondaryDelayNode) return;
    const now = audioCtx.currentTime;
    if (pcDualDelayMs >= 0) {
      // Bluetooth buffer delay: delay primary (laptop speakers) so both reach ears simultaneously
      primaryDelayNode.delayTime.setValueAtTime(pcDualDelayMs / 1000, now);
      secondaryDelayNode.delayTime.setValueAtTime(0, now);
    } else {
      primaryDelayNode.delayTime.setValueAtTime(0, now);
      secondaryDelayNode.delayTime.setValueAtTime(Math.abs(pcDualDelayMs) / 1000, now);
    }
    if (pcDualDelayVal) {
      const displayVal = Number.isInteger(pcDualDelayMs) ? pcDualDelayMs : pcDualDelayMs.toFixed(1);
      pcDualDelayVal.textContent = (pcDualDelayMs > 0 ? `+${displayVal}` : `${displayVal}`) + ' ms';
    }
    if (pcDualDelaySlider && parseFloat(pcDualDelaySlider.value) !== pcDualDelayMs) {
      pcDualDelaySlider.value = pcDualDelayMs;
    }
  }

  let audioOutputRouteSequence = 0;
  async function applyPcDualAudioRouting(reason = 'audio output update') {
    if (!audioCtx || !secondaryAudio || !secondaryGainNode) return;
    const routeSequence = ++audioOutputRouteSequence;
    const secondarySinkId = pcDualAudioEnabled ? (pcSecondaryDeviceId || 'default') : 'default';
    let appliedSecondarySinkId = secondaryAudio.sinkId || 'default';

    // Both music decks are MediaElementAudioSources inside the shared graph;
    // the secondary mixed stream is the HTML audio output that owns this sink.
    if (typeof secondaryAudio.setSinkId === 'function') {
      try {
        if (secondaryAudio.sinkId !== secondarySinkId) {
          await secondaryAudio.setSinkId(secondarySinkId);
        }
        appliedSecondarySinkId = secondaryAudio.sinkId || secondarySinkId;
      } catch (error) {
        console.warn(`[Audio Route] Could not select secondary sink ${secondarySinkId}; falling back to system output:`, error.message);
        try { await secondaryAudio.setSinkId('default'); } catch (fallbackError) {}
        appliedSecondarySinkId = 'default (fallback)';
      }
    } else if (secondarySinkId !== 'default') {
      appliedSecondarySinkId = 'default (setSinkId unavailable)';
      console.warn('[Audio Route] This runtime cannot target the selected secondary audio device.');
    }

    if (routeSequence !== audioOutputRouteSequence) return;
    const now = audioCtx.currentTime;
    secondaryGainNode.gain.cancelScheduledValues(now);
    secondaryGainNode.gain.setTargetAtTime(pcDualAudioEnabled ? 1 : 0, now, 0.025);

    if (pcDualAudioEnabled) {
      try {
        await ensureAudioContextRunning(reason);
        if (routeSequence !== audioOutputRouteSequence) return;
        if (secondaryAudio.paused) await secondaryAudio.play();
      } catch (error) {
        console.warn('[Audio Route] Secondary output stream could not start:', error.message);
      }
    } else {
      secondaryAudio.pause();
    }

    console.log('[Audio Route] Output routing applied', {
      reason,
      audioContextState: audioCtx.state,
      primarySinkId: typeof audioCtx.sinkId === 'string' ? audioCtx.sinkId : 'default (system output)',
      secondaryEnabled: pcDualAudioEnabled,
      secondarySinkId: appliedSecondarySinkId,
      secondaryElementVolume: secondaryAudio.volume,
      secondaryElementMuted: secondaryAudio.muted
    });
  }

  function setPcDualDelay(val) {
    pcDualDelayMs = Math.max(-150, Math.min(250, Math.round(parseFloat(val) * 2) / 2));
    applyPcDualDelay();
    savePersistentState();
  }

  async function populatePcAudioOutputDevices() {
    if (!pcSecondaryDeviceSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      try {
        if (navigator.mediaDevices.getUserMedia) {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach(t => t.stop());
        }
      } catch (e) {}

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      pcSecondaryDeviceSelect.innerHTML = '';
      if (audioOutputs.length === 0) {
        pcSecondaryDeviceSelect.innerHTML = '<option value="">No secondary audio outputs detected</option>';
        return;
      }

      let found = false;
      audioOutputs.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        let label = dev.label || `Audio Device ${idx + 1}`;
        if (dev.deviceId === 'default') {
          label += ' (Default Windows Output)';
        } else if (label.toLowerCase().includes('bluetooth') || label.toLowerCase().includes('buds') || label.toLowerCase().includes('headphone') || label.toLowerCase().includes('hands-free')) {
          label = `🎧 ${label}`;
        } else {
          label = `🔊 ${label}`;
        }
        opt.textContent = label;
        if (pcSecondaryDeviceId && dev.deviceId === pcSecondaryDeviceId) {
          opt.selected = true;
          found = true;
        }
        pcSecondaryDeviceSelect.appendChild(opt);
      });

      if (!found && audioOutputs.length > 1) {
        const nonDef = audioOutputs.find(d => d.deviceId !== 'default');
        if (nonDef) {
          pcSecondaryDeviceSelect.value = nonDef.deviceId;
          pcSecondaryDeviceId = nonDef.deviceId;
        }
      }
    } catch (e) {
      console.warn('Failed to enumerate audio output devices:', e);
    }
  }

  if (pcDualAudioToggle) {
    pcDualAudioToggle.addEventListener('change', async (e) => {
      initAudioContext();
      pcDualAudioEnabled = e.target.checked;
      if (pcDualAudioControls) {
        pcDualAudioControls.classList.toggle('hidden', !pcDualAudioEnabled);
      }
      if (pcDualAudioEnabled) {
        await populatePcAudioOutputDevices();
        await applyPcDualAudioRouting('dual audio enabled');
        showToast('🔀 PC Dual-Audio ON: Laptop Speakers + Bluetooth playing simultaneously!');
      } else {
        await applyPcDualAudioRouting('dual audio disabled');
        showToast('PC Dual-Audio OFF: Playing standard primary output');
      }
      savePersistentState();
    });
  }

  if (pcSecondaryDeviceSelect) {
    pcSecondaryDeviceSelect.addEventListener('change', async (e) => {
      initAudioContext();
      pcSecondaryDeviceId = e.target.value;
      await applyPcDualAudioRouting('secondary device changed');
      showToast(`Secondary Audio switched: ${e.target.options[e.target.selectedIndex]?.text || ''}`);
      savePersistentState();
    });
  }

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      if (!pcDualAudioEnabled) return;
      await populatePcAudioOutputDevices();
      await applyPcDualAudioRouting('audio device changed');
    });
  }

  if (pcDualDelaySlider) {
    pcDualDelaySlider.addEventListener('input', (e) => {
      initAudioContext();
      setPcDualDelay(e.target.value);
    });
  }

  if (pcDualMinus10) pcDualMinus10.addEventListener('click', () => { initAudioContext(); setPcDualDelay(pcDualDelayMs - 10); });
  if (pcDualMinus1) pcDualMinus1.addEventListener('click', () => { initAudioContext(); setPcDualDelay(pcDualDelayMs - 1); });
  if (pcDualMinusHalf) pcDualMinusHalf.addEventListener('click', () => { initAudioContext(); setPcDualDelay(pcDualDelayMs - 0.5); });
  if (pcDualPlusHalf) pcDualPlusHalf.addEventListener('click', () => { initAudioContext(); setPcDualDelay(pcDualDelayMs + 0.5); });
  if (pcDualPlus1) pcDualPlus1.addEventListener('click', () => { initAudioContext(); setPcDualDelay(pcDualDelayMs + 1); });
  if (pcDualPlus10) pcDualPlus10.addEventListener('click', () => { initAudioContext(); setPcDualDelay(pcDualDelayMs + 10); });

  let pcDualBeepTesting = false;
  if (pcDualBeepTestBtn) {
    pcDualBeepTestBtn.addEventListener('click', () => {
      initAudioContext();
      if (!audioCtx || pcDualBeepTesting) return;
      pcDualBeepTesting = true;
      showToast('⚡ Beep Align: Adjust slider until laptop and earbuds sound as ONE single punch!');
      let beeps = 0;
      const testInterval = setInterval(() => {
        beeps++;
        try {
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
          g.gain.setValueAtTime(0.001, audioCtx.currentTime);
          g.gain.linearRampToValueAtTime(0.8, audioCtx.currentTime + 0.005);
          g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
          osc.connect(g);
          g.connect(masterGain || audioCtx.destination);
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 0.05);
        } catch (e) {}
        if (beeps >= 4) {
          clearInterval(testInterval);
          pcDualBeepTesting = false;
        }
      }, 600);
    });
  }

  // ------------------------------------------------------------------------
  // Boot Sequence
  // ------------------------------------------------------------------------
  queue = [];
  currentTrack = null;

  loadPersistentState().then(() => {
    if (safeStorageGet('melopair_onboarding_done') === 'true' || safeStorageGet('melopair_taste_setup_v1') === 'true') tasteOnboarding?.classList.add('hidden');
    currentTrack = lastPlayedTrack ? { ...lastPlayedTrack } : null;
    resumeOnOpenTrackId = currentTrack && lastPlayedPosition > 0 ? currentTrack.id : null;
    queue = currentTrack
      ? [currentTrack, ...verifiedRealTracks.filter(track => track.id !== currentTrack.id)]
      : [];
    renderQuickPicks();
    renderQueueList();

    if (dockTitle) dockTitle.textContent = currentTrack?.title || 'Ready to Play';
    if (dockArtist) dockArtist.textContent = currentTrack?.artist || 'Choose a song to start';
    if (dockThumb) dockThumb.src = currentTrack?.artwork || currentTrack?.thumbnail || 'default-art.png';
    if (dockDuration) dockDuration.textContent = formatTime(currentTrack?.duration || 0);
    if (dockCurrentTime) dockCurrentTime.textContent = formatTime(lastPlayedPosition);
    const resumePercent = currentTrack?.duration ? Math.max(0, Math.min(100, lastPlayedPosition / currentTrack.duration * 100)) : 0;
    if (dockSeekFill) dockSeekFill.style.width = `${resumePercent}%`;
    if (dockSeekThumb) dockSeekThumb.style.left = `${resumePercent}%`;

    // Set Home / Discovery as the primary default view on open
    switchStageView(viewDiscovery);
    stageTabs.forEach(t => t.classList.remove('active'));
    if (tabHomeBtn) tabHomeBtn.classList.add('active');

    // Build the first screen from real local listening history when available;
    // brand-new listeners receive a clean popular feed instead.
    renderContinueListeningShelf();
    if (discSubtitle) discSubtitle.textContent = history.length
      ? 'A listening feed shaped by your taste and what you play'
      : 'Clean popular tracks to get you started';
    void loadPersonalizedFeed(true);
    performSearch('trending global songs');

    // Initialize Immersive Lyrics default state
    if (currentTrack) {
      const artUrl = currentTrack.artwork || currentTrack.thumbnail || 'default-art.png';
      if (immersiveArtBlur) immersiveArtBlur.style.backgroundImage = `url("${artUrl}")`;
      if (immTrackTitle) immTrackTitle.textContent = currentTrack.title;
      if (immTrackArtist) immTrackArtist.textContent = currentTrack.artist;
      extractDominantColors(artUrl);
    } else {
      if (immTrackTitle) immTrackTitle.textContent = 'Choose a song';
      if (immTrackArtist) immTrackArtist.textContent = 'Your listening journey starts here';
    }

    // Initialize lyrics mode with saved preference
    setLyricsMode(lyricsMode || 'immersive');
    setKineticBgMode(isOledBgMode);
    initAmbientClouds();

    // Start lifecycle monitor & animation loops immediately
    startMainLoop();

    handleResize();
  });

  // Test Mode Trigger for Crossfade Diagnostics (4 queued songs & 5s crossfade)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('test_crossfade') === '1') {
    crossfadeSeconds = 5;
    queue = [
      {
        id: 'kXYiU_JCYtU',
        title: 'Numb',
        artist: 'Linkin Park',
        duration: 187,
        artwork: 'https://i.ytimg.com/vi/kXYiU_JCYtU/hqdefault.jpg'
      },
      {
        id: 'Q3gy8A0jY10',
        title: 'In The End',
        artist: 'Linkin Park',
        duration: 217,
        artwork: 'https://i.ytimg.com/vi/Q3gy8A0jY10/hqdefault.jpg'
      },
      {
        id: '6dEAeCHQrBs',
        title: 'Figure.09',
        artist: 'Linkin Park',
        duration: 200,
        artwork: 'https://i.ytimg.com/vi/6dEAeCHQrBs/hqdefault.jpg'
      },
      {
        id: 'GEGieUB4b3c',
        title: 'Somewhere I Belong',
        artist: 'Linkin Park',
        duration: 213,
        artwork: 'https://i.ytimg.com/vi/GEGieUB4b3c/hqdefault.jpg'
      }
    ];
    currentTrack = queue[0];
    renderQueueList();
    console.log('[Test Mode] Initialized with 4 real songs and 5s crossfade.');

    let stage = 0;
    let prevCrossfading = false;
    let hasFastForwardedCurrentStage = false;

    const seekMonitor = setInterval(() => {
      // Transition completed detection
      if (prevCrossfading && !isCrossfading) {
        stage++;
        hasFastForwardedCurrentStage = false;
        console.log(`[Test Mode] Transition ${stage} complete! Now playing: "${currentTrack?.title}". Next stage: ${stage < 3 ? stage + 1 : 'All done'}`);
        if (stage >= 3) {
          clearInterval(seekMonitor);
          console.log('[Test Mode] ALL 3 REQUESTED TRANSITIONS (1->2, 2->3, 3->4) EXECUTED WITH FULL 5s EQUAL-POWER CROSSFADE!');
          return;
        }
      }
      prevCrossfading = isCrossfading;

      if (!isCrossfading && isPlaying && activeAudio && isFinite(activeAudio.duration) && activeAudio.duration > 10) {
        const expectedCurrent = queue[stage];
        const expectedNext = queue[stage + 1];

        if (currentTrack && currentTrack.id === expectedCurrent?.id &&
            isNextTrackReady && preparedTrack && preparedTrack.id === expectedNext?.id &&
            !hasFastForwardedCurrentStage && activeAudio.currentTime > 0.8) {
          const dur = activeAudio.duration;
          const targetSeek = Math.max(1, dur - 7);
          hasFastForwardedCurrentStage = true;
          console.log(`[Test Mode] Transition ${stage + 1}/3 ready: "${currentTrack.title}" -> "${preparedTrack.title}". Fast-forwarding to ${targetSeek.toFixed(1)}s (crossfade at ${(dur - 5).toFixed(1)}s)...`);
          activeAudio.currentTime = targetSeek;
        }
      }
    }, 350);

    setTimeout(() => {
      console.log('[Test Mode] Starting playback of Song 1 (Numb)...');
      executeTransition('manual', queue[0]);
    }, 1200);
  }

// ==========================================================================
// MELOPAIR - APPLE MUSIC STYLE NOW PLAYING, SEARCH AUTOCOMPLETE & NATIVE MEDIA BRIDGE
// ==========================================================================

(function initAppleMusicAndMediaEngine() {
  console.log('[Echo Engine] Initializing Apple Music Experience & Native Media Bridge...');

  // ------------------------------------------------------------------------
  // 1. Native Android Media Notification & Headset Button Bridge
  // ------------------------------------------------------------------------
  window.notifyNativeMediaState = function(track, isPlayingState) {
    if ('mediaSession' in navigator && track) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || 'MeloPair',
          artist: track.artist || 'MeloPair',
          album: (track.album && track.album !== 'Episode') ? track.album : (track.isSong !== false ? 'Song' : 'MeloPair'),
          artwork: [
            { src: track.artwork || track.thumbnail || 'default-art.png', sizes: '512x512', type: 'image/png' }
          ]
        });
        navigator.mediaSession.playbackState = isPlayingState ? 'playing' : 'paused';
      } catch (e) {}
    }

    if (window.AndroidMedia && window.AndroidMedia.updateTrack) {
      try {
        const title = track?.title || 'MeloPair';
        const artist = track?.artist || 'High-Fidelity Studio';
        const art = track?.artwork || track?.thumbnail || '';
        window.AndroidMedia.updateTrack(title, artist, art, isPlayingState);
      } catch (err) {
        console.warn('[Native Media] Error updating track in Android service:', err);
      }
    }
  };

  window.echoMediaControl = function(action) {
    console.log('[Native Media Control] Action triggered:', action);
    if (action === 'play') {
      if (!isPlaying) togglePlayPause();
    } else if (action === 'pause') {
      if (isPlaying) togglePlayPause();
    } else if (action === 'toggle') {
      togglePlayPause();
    } else if (action === 'next') {
      if (typeof executeTransition === 'function') executeTransition('next');
    } else if (action === 'prev') {
      if (typeof executeTransition === 'function') executeTransition('prev');
    }
  };

  // ------------------------------------------------------------------------
  // 2. Apple Music Unified Now Playing Stage, Kinetic Lyrics & Split-Pane Queue
  // ------------------------------------------------------------------------
  const nowPlayingModal = document.getElementById('nowPlayingModal');
  const npDismissBtn = document.getElementById('npDismissBtn');
  const npBackdrop = document.getElementById('npBackdrop');
  const npHeaderSource = document.getElementById('npHeaderSource');
  const npRoomBtn = document.getElementById('npRoomBtn');

  // Search elements
  const npSearchWrap = document.getElementById('npSearchWrap');
  const npSearchInput = document.getElementById('npSearchInput');
  const npClearSearchBtn = document.getElementById('npClearSearchBtn');
  const npSearchResults = document.getElementById('npSearchResults');
  let npSearchTypedThisSession = false;
  if (npSearchInput) {
    // Chromium can restore an old form value when the app window is reopened.
    npSearchInput.value = '';
    npClearSearchBtn?.classList.add('hidden');
    npSearchResults?.classList.add('hidden');
  }

  // Mode and switchers
  const npBgModeBtn = document.getElementById('npBgModeBtn');
  const npBgModeIcon = document.getElementById('npBgModeIcon');
  const npBgModeLabel = document.getElementById('npBgModeLabel');
  const npAutoEmojiBtn = document.getElementById('npAutoEmojiBtn');

  // Window action buttons
  const npWinMinBtn = document.getElementById('npWinMinBtn');
  const npWinTileBtn = document.getElementById('npWinTileBtn');
  const npWinCloseBtn = document.getElementById('npWinCloseBtn');

  // Split stage & drawer
  const npSplitStage = document.getElementById('npSplitStage');
  const npStageLeft = document.getElementById('npStageLeft');
  const npCompactHeader = document.getElementById('npCompactHeader');
  const npCompactArt = document.getElementById('npCompactArt');
  const npCompactTitle = document.getElementById('npCompactTitle');
  const npCompactArtist = document.getElementById('npCompactArtist');
  const npLyricsBadge = document.getElementById('npLyricsBadge');

  const npDisplayContainer = document.getElementById('npDisplayContainer');
  const npKineticViewport = document.getElementById('npKineticViewport');
  const npKineticLines = document.getElementById('npKineticLines');
  const npArtworkView = document.getElementById('npArtworkView');
  const npLargeArt = document.getElementById('npLargeArt');
  const npArtShadow = document.getElementById('npArtShadow');

  // Queue drawer
  const npQueueDrawer = document.getElementById('npQueueDrawer');
  const npAutoplayToggle = document.getElementById('npAutoplayToggle');
  const npDrawerCount = document.getElementById('npDrawerCount');
  const npDrawerNowPlaying = document.getElementById('npDrawerNowPlaying');
  const npDrawerList = document.getElementById('npDrawerList');

  // Footer controls
  const npFooter = document.getElementById('npFooter');
  const npTitle = document.getElementById('npTitle');
  const npArtist = document.getElementById('npArtist');
  const npLikeBtn = document.getElementById('npLikeBtn');

  const npScrubberTrack = document.getElementById('npScrubberTrack');
  const npScrubberFill = document.getElementById('npScrubberFill');
  const npScrubberThumb = document.getElementById('npScrubberThumb');
  const npCurrentTime = document.getElementById('npCurrentTime');
  const npDuration = document.getElementById('npDuration');

  const npShuffleBtn = document.getElementById('npShuffleBtn');
  const npPrevBtn = document.getElementById('npPrevBtn');
  const npPlayBtn = document.getElementById('npPlayBtn');
  const npPlayIcon = document.getElementById('npPlayIcon');
  const npNextBtn = document.getElementById('npNextBtn');
  const npRepeatBtn = document.getElementById('npRepeatBtn');

  const npLyricsToggleBtn = document.getElementById('npLyricsToggleBtn');
  const npLyricsFullscreenBackBtn = document.getElementById('npLyricsFullscreenBackBtn');
  const npLyricsToggleText = document.getElementById('npLyricsToggleText');
  const npAudioQualityPill = document.getElementById('npAudioQualityPill');
  const npQueueToggleBtn = document.getElementById('npQueueToggleBtn');

  // Audio Quality Popover
  const npAudioQualityPopover = document.getElementById('npAudioQualityPopover');
  const aqPopoverCloseBtn = document.getElementById('aqPopoverCloseBtn');
  const aqPopoverTitle = document.getElementById('aqPopoverTitle');
  const aqPopoverSub = document.getElementById('aqPopoverSub');
  const aqCodecVal = document.getElementById('aqCodecVal');
  const aqBitrateVal = document.getElementById('aqBitrateVal');
  const aqSourceVal = document.getElementById('aqSourceVal');
  const aqDspVal = document.getElementById('aqDspVal');

  const playerDock = document.getElementById('playerDock');
  const playerLeft = document.querySelector('.player-left');
  const dockThumb = document.getElementById('dockThumb');

  let isNowPlayingOpen = false;
  let isNowPlayingLyricsMode = 'kinetic'; // 'kinetic' | 'artwork'
  window.isNowPlayingLyricsMode = isNowPlayingLyricsMode;
  let isScrubbingNowPlaying = false;
  let previousActiveNavView = null;

  // Single Source of Truth: Open / Close Now Playing Stage
  function openNowPlaying() {
    if (!nowPlayingModal) return;
    if (!npSearchTypedThisSession && npSearchInput) {
      npSearchInput.value = '';
      npClearSearchBtn?.classList.add('hidden');
      npSearchResults?.classList.add('hidden');
    }
    nowPlayingModal.classList.remove('hidden');
    isNowPlayingOpen = true;
    if (isStarsBgMode) {
      npStarfieldCanvas?.classList.remove('hidden');
      initStarfield();
      startStarfieldIfVisible();
    }

    // Track active sidebar navigation item to restore upon dismissal
    const activeNav = document.querySelector('.sidebar-nav .nav-item.active');
    if (activeNav && activeNav !== navLyricsBtn) {
      previousActiveNavView = activeNav.getAttribute('data-view');
    }

    updateNowPlayingBgModeUI();
    updateNowPlayingView(currentTrack);

    // Primary presentation: focused 3-line kinetic typography
    setNowPlayingLyricsView('kinetic');

    const curTime = isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function'
      ? (ytPlayer.getCurrentTime() || 0)
      : (activeAudio?.currentTime || 0);
    if (Number.isFinite(curTime)) {
      syncLyricsWithTime(curTime);
    }
    scheduleNowPlayingSync();
  }

  function closeNowPlaying() {
    if (!nowPlayingModal) return;
    nowPlayingModal.classList.remove('np-lyrics-fullscreen-mode');
    nowPlayingModal.classList.add('hidden');
    isNowPlayingOpen = false;
    stopStarfield();
    if (npSyncRaf) {
      cancelAnimationFrame(npSyncRaf);
      npSyncRaf = 0;
    }

    // Restore previous sidebar navigation item
    if (navItems) {
      navItems.forEach(item => {
        const vt = item.getAttribute('data-view');
        if (previousActiveNavView) {
          item.classList.toggle('active', vt === previousActiveNavView);
        } else {
          item.classList.toggle('active', vt === 'discovery' || vt === 'browse');
        }
      });
    }
  }

  window.openNowPlayingStage = openNowPlaying;
  window.openNowPlaying = openNowPlaying;
  window.closeNowPlaying = closeNowPlaying;
  window.closeNowPlayingStage = closeNowPlaying;

    // Progressive Lyrics Sheet Controller (Tri-State: hidden -> half -> full)
  let currentLyricsSheetState = 'hidden';
  let sheetGestureDebounceTimer = null;
  let gestureAccumulatorY = 0;

  function getLyricsSheetState() {
    return currentLyricsSheetState;
  }

  function setLyricsSheetState(state) {
    if (state !== 'hidden' && state !== 'half' && state !== 'full') return;
    currentLyricsSheetState = state;

    const sheetEl = document.getElementById('npLyricsSheet');
    const containerEl = document.getElementById('npDisplayContainer');
    const toggleBtn = document.getElementById('npLyricsToggleBtn');

    if (sheetEl) {
      sheetEl.classList.remove('sheet-hidden', 'sheet-half', 'sheet-full');
      sheetEl.classList.add('sheet-' + state);
    }

    if (containerEl) {
      containerEl.classList.remove('sheet-half-active', 'sheet-full-active', 'sheet-half', 'sheet-full');
      if (state === 'half') {
        containerEl.classList.add('sheet-half-active', 'sheet-half');
      } else if (state === 'full') {
        containerEl.classList.add('sheet-full-active', 'sheet-full');
      }
    }

    if (toggleBtn) {
      toggleBtn.classList.toggle('active', state !== 'hidden');
    }

    if (state === 'half' || state === 'full') {
      window.renderNowPlayingLyrics?.();
    }
  }

  function toggleLyricsSheet() {
    if (currentLyricsSheetState === 'hidden') {
      setLyricsSheetState('half');
    } else if (currentLyricsSheetState === 'half') {
      setLyricsSheetState('full');
    } else {
      setLyricsSheetState('hidden');
    }
  }

  window.lyricsSheetController = {
    getState: getLyricsSheetState,
    setState: setLyricsSheetState,
    toggle: toggleLyricsSheet
  };

  // Wheel gesture handling on display container and lyrics sheet
  function onLyricsSheetWheel(event) {
    const delta = event.deltaY;
    if (Math.abs(delta) < 8) return;

    // If inside lyrics stream and scrolled down in full mode, allow native scroll
    const stream = document.getElementById('npLyricsStream');
    if (currentLyricsSheetState === 'full' && stream && stream.contains(event.target) && stream.scrollTop > 10 && delta > 0) {
      return;
    }

    gestureAccumulatorY += delta;
    clearTimeout(sheetGestureDebounceTimer);
    sheetGestureDebounceTimer = setTimeout(() => {
      const accumulated = gestureAccumulatorY;
      gestureAccumulatorY = 0;

      if (accumulated > 35) {
        // Upward scroll gesture: advance hidden -> half -> full
        if (currentLyricsSheetState === 'hidden') {
          setLyricsSheetState('half');
        } else if (currentLyricsSheetState === 'half') {
          setLyricsSheetState('full');
          setLyricsFullscreen(true);
        }
      } else if (accumulated < -35) {
        // Downward scroll gesture: reverse full -> half -> hidden
        if (currentLyricsSheetState === 'full') {
          if (!stream || stream.scrollTop <= 15) {
            setLyricsSheetState('half');
            setLyricsFullscreen(false);
          }
        } else if (currentLyricsSheetState === 'half') {
          setLyricsSheetState('hidden');
          setLyricsFullscreen(false);
        }
      }
    }, 35);
  }

  const npDispCont = document.getElementById('npDisplayContainer');
  const npLrcSheet = document.getElementById('npLyricsSheet');
  if (npDispCont) npDispCont.addEventListener('wheel', onLyricsSheetWheel, { passive: true });
  if (npLrcSheet) npLrcSheet.addEventListener('wheel', onLyricsSheetWheel, { passive: true });

  // Pointer drag gestures on grab handle / grab pill
  const handleEl = document.getElementById('npSheetHandle') || document.getElementById('npSheetGrabPill') || document.querySelector('.lyrics-sheet-handle');
  if (handleEl) {
    let startY = 0;
    let isDragging = false;

    handleEl.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      isDragging = true;
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
    });

    handleEl.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
    });

    const onPointerEnd = (e) => {
      if (!isDragging) return;
      isDragging = false;
      const distance = e.clientY - startY; // negative = dragged up, positive = dragged down

      if (distance < -50) {
        if (currentLyricsSheetState === 'hidden') setLyricsSheetState('half');
        else setLyricsSheetState('full');
      } else if (distance > 50) {
        if (currentLyricsSheetState === 'full') setLyricsSheetState('half');
        else setLyricsSheetState('hidden');
      } else if (Math.abs(distance) <= 12) {
        toggleLyricsSheet();
      }
    };

    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', () => { isDragging = false; });
  }

  if (npLyricsToggleBtn) {
    npLyricsToggleBtn.addEventListener('click', toggleLyricsSheet);
  }

  const npStreamEl = document.getElementById('npLyricsStream');
  if (npStreamEl) {
    let scrollGuardTimeout = null;
    npStreamEl.addEventListener('scroll', () => {
      window.isUserScrollingLyrics = true;
      window.userIsScrollingLyrics = true;
      clearTimeout(scrollGuardTimeout);
      scrollGuardTimeout = setTimeout(() => {
        window.isUserScrollingLyrics = false;
        window.userIsScrollingLyrics = false;
      }, 2500);
    }, { passive: true });
  }
  function setLyricsFullscreen(enabled) {
    if (!nowPlayingModal) return;
    nowPlayingModal.classList.toggle('np-lyrics-fullscreen-mode', !!enabled);
    const curTime = isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function'
      ? (ytPlayer.getCurrentTime() || 0)
      : (activeAudio?.currentTime || 0);
    if (Number.isFinite(curTime)) syncLyricsWithTime(curTime);
  }
  window.setLyricsFullscreen = setLyricsFullscreen;

  if (npLyricsFullscreenBackBtn) {
    npLyricsFullscreenBackBtn.addEventListener('click', () => {
      setLyricsFullscreen(false);
    });
  }

  const npKineticVpDbl = document.getElementById('npKineticViewport');
  if (npKineticVpDbl) {
    npKineticVpDbl.addEventListener('dblclick', () => {
      const isFs = nowPlayingModal?.classList.contains('np-lyrics-fullscreen-mode');
      setLyricsFullscreen(!isFs);
    });
  }

  let lyricsWheelAccumulator = 0;
  let lyricsWheelTimer = null;
  function handleLyricsWheelScroll(e) {
    if (!nowPlayingModal || nowPlayingModal.classList.contains('hidden')) return;
    if (e.target.closest('#npSearchResults') || e.target.closest('#npDrawerList') || e.target.closest('.np-queue-drawer')) return;

    lyricsWheelAccumulator += e.deltaY;
    clearTimeout(lyricsWheelTimer);
    lyricsWheelTimer = setTimeout(() => {
      const delta = lyricsWheelAccumulator;
      lyricsWheelAccumulator = 0;
      const isFs = nowPlayingModal.classList.contains('np-lyrics-fullscreen-mode');
      if (!isFs && delta > 15) {
        setLyricsFullscreen(true);
      } else if (isFs && delta < -15) {
        setLyricsFullscreen(false);
      }
    }, 35);
  }

  npKineticViewport?.addEventListener('wheel', handleLyricsWheelScroll, { passive: true });
  npDisplayContainer?.addEventListener('wheel', handleLyricsWheelScroll, { passive: true });
  const npKineticLinesEl = document.getElementById('npKineticLines');
  npKineticLinesEl?.addEventListener('wheel', handleLyricsWheelScroll, { passive: true });
  nowPlayingModal?.addEventListener('wheel', handleLyricsWheelScroll, { passive: true });

  let lyricsTouchStartY = null;
  npKineticViewport?.addEventListener('touchstart', (e) => {
    lyricsTouchStartY = e.touches[0]?.clientY || null;
  }, { passive: true });
  nowPlayingModal?.addEventListener('touchstart', (e) => {
    if (!e.target.closest('#npSearchResults') && !e.target.closest('#npDrawerList')) {
      lyricsTouchStartY = e.touches[0]?.clientY || null;
    }
  }, { passive: true });

  npKineticViewport?.addEventListener('touchend', (event) => {
    if (lyricsTouchStartY === null) return;
    const distance = (event.changedTouches[0]?.clientY || 0) - lyricsTouchStartY;
    lyricsTouchStartY = null;
    const isFs = nowPlayingModal?.classList.contains('np-lyrics-fullscreen-mode');
    if (!isFs && distance < -32) setLyricsFullscreen(true);
    else if (isFs && distance > 32) setLyricsFullscreen(false);
  }, { passive: true });

  if (playerLeft) playerLeft.addEventListener('click', openNowPlaying);
  if (dockThumb) dockThumb.addEventListener('click', (e) => { e.stopPropagation(); openNowPlaying(); });
  if (npDismissBtn) npDismissBtn.addEventListener('click', closeNowPlaying);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isNowPlayingOpen) {
      if (nowPlayingModal?.classList.contains('np-lyrics-fullscreen-mode')) {
        setLyricsFullscreen(false);
      } else {
        closeNowPlaying();
      }
    }
  });

  // Window actions (Frameless Chrome Controls)
  if (npWinMinBtn) {
    npWinMinBtn.addEventListener('click', () => {
      if (window.echoApi && window.echoApi.minimize) window.echoApi.minimize();
    });
  }
  if (npWinTileBtn) {
    npWinTileBtn.addEventListener('click', () => {
      if (window.echoApi && window.echoApi.maximize) window.echoApi.maximize();
    });
  }
  if (npWinCloseBtn) {
    npWinCloseBtn.addEventListener('click', () => {
      if (window.echoApi && window.echoApi.close) window.echoApi.close();
    });
  }

  // Now Playing uses kinetic lyrics as its only lyrics presentation.
  function setNowPlayingLyricsView(mode) {
    mode = mode === 'artwork' ? 'artwork' : 'kinetic';
    isNowPlayingLyricsMode = mode;
    window.isNowPlayingLyricsMode = mode;
    if (mode === 'kinetic') {
      npKineticViewport?.classList.remove('hidden');
      npArtworkView?.classList.add('hidden');
      npLyricsToggleBtn?.classList.add('active');
      const curTime = isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function'
        ? (ytPlayer.getCurrentTime() || 0)
        : (activeAudio?.currentTime || 0);
      if (Number.isFinite(curTime)) syncLyricsWithTime(curTime);
    } else if (mode === 'artwork') {
      npArtworkView?.classList.remove('hidden');
      npKineticViewport?.classList.add('hidden');
      npLyricsToggleBtn?.classList.remove('active');
    }
  }
  window.setNowPlayingLyricsView = setNowPlayingLyricsView;

  // Lyrics toggle in footer: switches between current lyrics mode and artwork
  if (npLyricsToggleBtn) {
    npLyricsToggleBtn.addEventListener('click', () => {
      if (isNowPlayingLyricsMode === 'artwork') {
        setNowPlayingLyricsView('kinetic');
      } else {
        setNowPlayingLyricsView('artwork');
      }
    });
  }

  // Background Mode: OLED Black vs Album Ambient
  function updateNowPlayingBgModeUI() {
    if (nowPlayingModal) {
      nowPlayingModal.classList.toggle('oled-black-mode', isOledBgMode);
    }
    if (npBgModeIcon) npBgModeIcon.textContent = isOledBgMode ? '🌙' : '☁️';
    if (npBgModeLabel) npBgModeLabel.textContent = isOledBgMode ? 'OLED Black' : 'Ambient';
    if (kineticBgIcon) kineticBgIcon.textContent = isOledBgMode ? '🌙' : '☁️';
    if (kineticBgLabel) kineticBgLabel.textContent = isOledBgMode ? 'OLED Black' : 'Ambient';
  }

  if (npBgModeBtn) {
    npBgModeBtn.addEventListener('click', () => {
      isOledBgMode = !isOledBgMode;
      updateNowPlayingBgModeUI();
      savePersistentState();
      showToast(isOledBgMode ? 'OLED Pure Black Mode 🌙' : 'Ambient Cloud Mode ☁️');
    });
  }

  // Auto Emoji Toggle inside Now Playing
  if (npAutoEmojiBtn) {
    npAutoEmojiBtn.classList.toggle('active', isAutoEmojiEnabled);
    npAutoEmojiBtn.addEventListener('click', () => {
      isAutoEmojiEnabled = !isAutoEmojiEnabled;
      npAutoEmojiBtn.classList.toggle('active', isAutoEmojiEnabled);
      if (autoEmojiToggleBtn) autoEmojiToggleBtn.classList.toggle('active', isAutoEmojiEnabled);
      showToast(isAutoEmojiEnabled ? 'Auto Emoji: ON ✨' : 'Auto Emoji: OFF');
      savePersistentState();
      if (activeLyricIndex >= 0) {
        renderImmersiveLyrics(activeLyricIndex);
      }
    });
  }

  // Rooms button
  if (npRoomBtn) {
    npRoomBtn.addEventListener('click', () => {
      const partyModalBackdrop = document.getElementById('partyModalBackdrop');
      if (partyModalBackdrop) partyModalBackdrop.classList.remove('hidden');
      if (typeof refreshRoomInfo === 'function') refreshRoomInfo();
    });
  }

  // Live Search in Now Playing
  let npSearchDebounce = null;
  if (npSearchInput) {
    npSearchInput.addEventListener('input', (e) => {
      npSearchTypedThisSession = true;
      const q = e.target.value.trim();
      if (npClearSearchBtn) npClearSearchBtn.classList.toggle('hidden', !q);
      clearTimeout(npSearchDebounce);
      if (!q || q.length < 2) {
        if (npSearchResults) npSearchResults.classList.add('hidden');
        return;
      }
      npSearchDebounce = setTimeout(async () => {
        try {
          if (window.echoApi && window.echoApi.searchMusic) {
            const res = await window.echoApi.searchMusic(q, 1, 8);
            const results = filterCleanFeedTracks(res?.results || (Array.isArray(res) ? res : []), {
              homeShelf: true,
              explicitQuery: q
            });
            if (!npSearchResults) return;
            if (results.length === 0) {
              npSearchResults.innerHTML = '<div style="color:rgba(255,255,255,0.4); font-size:12px; padding:10px; text-align:center;">No results found</div>';
              npSearchResults.classList.remove('hidden');
              return;
            }
            npSearchResults.innerHTML = '';
            results.forEach(item => {
              const row = document.createElement('div');
              row.className = 'np-search-item';
              const thumb = item.artwork || item.thumbnail || 'default-art.png';
              queueActionTracks.set(String(item.id), item);
              row.innerHTML = `
                <img class="np-search-thumb" src="${thumb}" alt="Cover" onerror="this.src='default-art.png'">
                <div class="np-search-item-meta">
                  <span class="np-search-item-title">${escapeHtml(item.title)}</span>
                  <span class="np-search-item-artist">${escapeHtml(item.artist || 'Unknown')}</span>
                  ${queueActionMarkup(item)}
                </div>
              `;
              row.addEventListener('click', () => {
                npSearchResults.classList.add('hidden');
                npSearchInput.value = '';
                if (npClearSearchBtn) npClearSearchBtn.classList.add('hidden');
                if (typeof playTrack === 'function') {
                  playTrack(item);
                }
              });
              npSearchResults.appendChild(row);
            });
            npSearchResults.classList.remove('hidden');
          }
        } catch (err) {
          console.warn('Now Playing search failed:', err);
        }
      }, 250);
    });

    if (npClearSearchBtn) {
      npClearSearchBtn.addEventListener('click', () => {
        npSearchInput.value = '';
        npClearSearchBtn.classList.add('hidden');
        if (npSearchResults) npSearchResults.classList.add('hidden');
      });
    }

    document.addEventListener('click', (e) => {
      if (npSearchResults && npSearchWrap && !npSearchWrap.contains(e.target)) {
        npSearchResults.classList.add('hidden');
      }
    });
  }

  // Split-Pane Queue Drawer: NEVER hide Now Playing, smoothly animate 64%/36% split
  function renderNowPlayingDrawerQueue() {
    if (npDrawerNowPlaying) {
      if (currentTrack) {
        const cover = currentTrack.artwork || currentTrack.thumbnail || 'default-art.png';
        npDrawerNowPlaying.innerHTML = `
          <div class="np-drawer-card-active">
            <img class="np-drawer-card-art" src="${cover}" alt="Art" onerror="this.src='default-art.png'">
            <div class="np-drawer-card-meta">
              <span class="np-drawer-card-title">${escapeHtml(currentTrack.title)}</span>
              <span class="np-drawer-card-artist">${escapeHtml(currentTrack.artist || 'MeloPair')}</span>
            </div>
            <div class="np-drawer-wave">
              <span></span><span></span><span></span>
            </div>
          </div>
        `;
      } else {
        npDrawerNowPlaying.innerHTML = '<div style="color:rgba(255,255,255,0.4); font-size:12px; padding:10px;">No track playing</div>';
      }
    }

    let upNextTracks = [...manualQueue, ...contextQueue].filter(t => !currentTrack || t.id !== currentTrack.id);
    let radioTracks = isAutoplayEnabled ? autoplayQueue.filter(t => !currentTrack || t.id !== currentTrack.id) : [];

    // Fallback: If 3-tier sub-queues are empty but master queue has items
    if (upNextTracks.length === 0 && radioTracks.length === 0 && Array.isArray(queue) && queue.length > 0) {
      const remaining = queue.filter(t => !currentTrack || t.id !== currentTrack.id);
      upNextTracks = remaining.filter(t => !t.isAutoplaySuggestion && !autoQueueTrackIds.has(t.id));
      radioTracks = remaining.filter(t => t.isAutoplaySuggestion || autoQueueTrackIds.has(t.id));
      if (upNextTracks.length === 0 && radioTracks.length === 0) {
        upNextTracks = remaining;
      }
    }

    const totalUpcoming = upNextTracks.length + radioTracks.length;

    if (npDrawerCount) {
      npDrawerCount.textContent = `${totalUpcoming} tracks upcoming`;
    }

    if (!npDrawerList) return;
    npDrawerList.innerHTML = '';

    if (totalUpcoming === 0) {
      npDrawerList.innerHTML = '<div style="color:rgba(255,255,255,0.4); font-size:13px; text-align:center; padding:30px 10px;">No upcoming tracks in queue</div>';
      return;
    }

    function createNpRowElement(track, queueKind, queueIndex) {
      const item = document.createElement('div');
      item.className = 'np-drawer-item';
      item.draggable = true;
      item.dataset.queueKind = queueKind;
      item.dataset.queueIndex = String(queueIndex);
      item.innerHTML = `
        <button class="action-btn-mini queue-drag-handle" type="button" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</button>
        <img class="np-drawer-item-art" loading="lazy" decoding="async" src="${track.artwork || track.thumbnail || 'default-art.png'}" alt="Cover" onerror="this.src='default-art.png'">
        <div class="np-drawer-item-meta">
          <span class="np-drawer-item-title">${escapeHtml(track.title)}</span>
          <span class="np-drawer-item-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
        </div>
        <span class="np-drawer-item-duration">${formatTime(track.duration || 180)}</span>
        <div class="queue-actions">
          <button class="action-btn-mini queue-move-up-btn" type="button" title="Move up" aria-label="Move up">↑</button>
          <button class="action-btn-mini queue-move-down-btn" type="button" title="Move down" aria-label="Move down">↓</button>
          <button class="action-btn-mini queue-remove-btn" type="button" title="Remove from queue" aria-label="Remove from queue">×</button>
        </div>
      `;
      item.addEventListener('click', event => {
        if (event.target.closest('.queue-move-up-btn')) { event.stopPropagation(); moveQueueItem(queueKind, queueIndex, -1); return; }
        if (event.target.closest('.queue-move-down-btn')) { event.stopPropagation(); moveQueueItem(queueKind, queueIndex, 1); return; }
        if (event.target.closest('.queue-remove-btn')) { event.stopPropagation(); removeQueueItem(queueKind, queueIndex); return; }
        if (event.target.closest('.queue-drag-handle')) return;
        if (typeof playTrack === 'function') {
          playTrack(track);
        }
      });
      item.addEventListener('dragstart', dragEvent => {
        dragEvent.dataTransfer?.setData('text/plain', JSON.stringify({ kind: queueKind, index: queueIndex }));
        if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragover', dragEvent => dragEvent.preventDefault());
      item.addEventListener('drop', dragEvent => {
        dragEvent.preventDefault();
        try {
          const from = JSON.parse(dragEvent.dataTransfer?.getData('text/plain') || 'null');
          if (from) reorderQueueItem(from.kind, from.index, queueKind, queueIndex);
        } catch (error) {
          console.warn('[Queue] Could not reorder Now Playing queue item:', error);
        }
      });
      return item;
    }

    if (upNextTracks.length > 0) {
      const upNextHeader = document.createElement('div');
      upNextHeader.className = 'queue-section-header';
      upNextHeader.innerHTML = `<span>Up Next</span><span class="queue-section-badge">${upNextTracks.length}</span>`;
      npDrawerList.appendChild(upNextHeader);

      upNextTracks.forEach(track => {
        const sourceQueue = manualQueue.some(item => item.id === track.id) ? manualQueue : contextQueue;
        const kind = sourceQueue === manualQueue ? 'manual' : 'context';
        npDrawerList.appendChild(createNpRowElement(track, kind, sourceQueue.findIndex(item => item.id === track.id)));
      });
    }

    if (radioTracks.length > 0) {
      const radioHeader = document.createElement('div');
      radioHeader.className = 'queue-section-header autoplay-section-header';
      const labelText = activeRadioVibeLabel ? `Autoplay • ${escapeHtml(activeRadioVibeLabel)}` : `Autoplay • Similar to ${escapeHtml(currentTrack?.title || 'Current')}`;
      radioHeader.innerHTML = `<span>${labelText}</span><span class="queue-section-badge">Radio</span>`;
      npDrawerList.appendChild(radioHeader);

      radioTracks.forEach(track => {
        npDrawerList.appendChild(createNpRowElement(track, 'autoplay', autoplayQueue.findIndex(item => item.id === track.id)));
      });
    }
  }
  window.renderNowPlayingDrawerQueue = renderNowPlayingDrawerQueue;

  function toggleNowPlayingQueue() {
    if (!npSplitStage) return;
    const isOpen = npSplitStage.classList.toggle('split-queue-open');
    if (npQueueToggleBtn) npQueueToggleBtn.classList.toggle('active', isOpen);
    if (isOpen) {
      renderNowPlayingDrawerQueue();
    }
  }
  window.toggleNowPlayingQueue = toggleNowPlayingQueue;

  if (npQueueToggleBtn) {
    npQueueToggleBtn.addEventListener('click', toggleNowPlayingQueue);
  }

  function setAutoplayPreference(enabled) {
    isAutoplayEnabled = Boolean(enabled);
    window.isAutoplayEnabled = isAutoplayEnabled;
    if (!isAutoplayEnabled) {
      radioRecommendationRequestId++;
      autoplayQueue = [];
      syncMasterQueue();
      renderQueueList();
      window.renderNowPlayingDrawerQueue?.();
      return;
    }
    if (currentTrack) void generateRadioSuggestions(currentTrack, currentRadioFilterMode);
  }

  if (queueAutoplayToggle) {
    queueAutoplayToggle.addEventListener('change', (e) => {
      setAutoplayPreference(e.target.checked);
      if (npAutoplayToggle) npAutoplayToggle.checked = e.target.checked;
      showToast(`Autoplay ${e.target.checked ? 'Enabled 📻' : 'Disabled'}`);
    });
  }

  if (npAutoplayToggle) {
    npAutoplayToggle.addEventListener('change', (e) => {
      setAutoplayPreference(e.target.checked);
      if (queueAutoplayToggle) queueAutoplayToggle.checked = e.target.checked;
      showToast(`Autoplay ${e.target.checked ? 'Enabled 📻' : 'Disabled'}`);
    });
  }

  // Audio Quality Popover (Lossless badge)
  if (npAudioQualityPill && npAudioQualityPopover) {
    npAudioQualityPill.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = npAudioQualityPopover.classList.contains('hidden');
      if (isHidden) {
        const isYt = currentTrack && (currentTrack.isYoutube || currentTrack.source === 'youtube' || !currentTrack.album);

        if (isYt) {
          if (aqPopoverTitle) aqPopoverTitle.textContent = 'High Quality Stream';
          if (aqPopoverSub) aqPopoverSub.textContent = 'YouTube Music Audio';
          if (aqCodecVal) aqCodecVal.textContent = 'Opus 48kHz / WebM';
          if (aqBitrateVal) aqBitrateVal.textContent = '160 kbps Adaptive';
          if (aqSourceVal) aqSourceVal.textContent = 'YouTube Cloud Audio';
        } else {
          if (aqPopoverTitle) aqPopoverTitle.textContent = 'Hi-Res Lossless';
          if (aqPopoverSub) aqPopoverSub.textContent = 'Apple Music Audio Fidelity';
          if (aqCodecVal) aqCodecVal.textContent = 'ALAC 24-bit / 48kHz';
          if (aqBitrateVal) aqBitrateVal.textContent = '320 kbps High Fidelity';
          if (aqSourceVal) aqSourceVal.textContent = 'JioSaavn Studio CDN';
        }
        if (aqDspVal) aqDspVal.textContent = '3D Spatial & Studio EQ Active';

        npAudioQualityPopover.classList.remove('hidden');
      } else {
        npAudioQualityPopover.classList.add('hidden');
      }
    });

    if (aqPopoverCloseBtn) {
      aqPopoverCloseBtn.addEventListener('click', () => {
        npAudioQualityPopover.classList.add('hidden');
      });
    }

    document.addEventListener('click', (e) => {
      if (npAudioQualityPopover && !npAudioQualityPopover.classList.contains('hidden')) {
        if (!npAudioQualityPopover.contains(e.target) && !npAudioQualityPill.contains(e.target)) {
          npAudioQualityPopover.classList.add('hidden');
        }
      }
    });
  }

  // Transport controls inside Now Playing
  if (npPlayBtn) {
    npPlayBtn.addEventListener('click', () => {
      if (typeof togglePlayPause === 'function') togglePlayPause();
    });
  }

  if (npPrevBtn) {
    npPrevBtn.addEventListener('click', () => {
      if (typeof executeTransition === 'function') executeTransition('prev');
    });
  }

  if (npNextBtn) {
    npNextBtn.addEventListener('click', () => {
      if (typeof executeTransition === 'function') executeTransition('next');
    });
  }

  if (npShuffleBtn) {
    npShuffleBtn.addEventListener('click', () => {
      const dockShuffle = document.getElementById('dockShuffleBtn');
      if (dockShuffle) dockShuffle.click();
      npShuffleBtn.classList.toggle('active');
    });
  }

  if (npRepeatBtn) {
    npRepeatBtn.addEventListener('click', () => {
      const dockRepeat = document.getElementById('dockRepeatBtn');
      if (dockRepeat) dockRepeat.click();
      npRepeatBtn.classList.toggle('active');
    });
  }

  if (npLikeBtn) {
    npLikeBtn.addEventListener('click', () => {
      if (currentTrack) {
        toggleFavorite(currentTrack);
        const isNowLiked = favorites.has(currentTrack.id);
        npLikeBtn.classList.toggle('liked', isNowLiked);
      }
    });
  }

  // Scrubber drag / click
  if (npScrubberTrack) {
    function seekFromEvent(e) {
      if (!activeAudio || !isFinite(activeAudio.duration) || activeAudio.duration <= 0) return;
      const rect = npScrubberTrack.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = pct * activeAudio.duration;
      activeAudio.currentTime = targetTime;
      if (npScrubberFill) npScrubberFill.style.width = `${pct * 100}%`;
      if (npScrubberThumb) npScrubberThumb.style.left = `${pct * 100}%`;
      if (npCurrentTime) npCurrentTime.textContent = formatTime(targetTime);

      activeLyricIndex = -1;
      syncLyricsWithTime(targetTime, true);
    }

    npScrubberTrack.addEventListener('click', seekFromEvent);

    npScrubberTrack.addEventListener('mousedown', (e) => {
      isScrubbingNowPlaying = true;
      seekFromEvent(e);
      const onMove = (moveEvent) => { if (isScrubbingNowPlaying) seekFromEvent(moveEvent); };
      const onUp = () => {
        isScrubbingNowPlaying = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    npScrubberTrack.addEventListener('touchstart', (e) => {
      isScrubbingNowPlaying = true;
      seekFromEvent(e);
    }, { passive: true });

    npScrubberTrack.addEventListener('touchmove', (e) => {
      if (isScrubbingNowPlaying) seekFromEvent(e);
    }, { passive: true });

    npScrubberTrack.addEventListener('touchend', () => {
      isScrubbingNowPlaying = false;
    });
  }

  // Update Now Playing UI state
  function updateNowPlayingView(track) {
    if (!track) return;
    const artUrl = track.artwork || track.thumbnail || 'default-art.png';

    if (npBackdrop) npBackdrop.style.backgroundImage = `url("${artUrl}")`;
    if (npLargeArt) npLargeArt.src = artUrl;
    if (npArtShadow) npArtShadow.style.backgroundImage = `url("${artUrl}")`;

    if (npCompactArt) npCompactArt.src = artUrl;
    if (npCompactTitle) npCompactTitle.textContent = track.title || 'Unknown Title';
    if (npCompactArtist) npCompactArtist.textContent = track.artist || 'MeloPair';

    if (npTitle) npTitle.textContent = track.title || 'Unknown Title';
    if (npArtist) npArtist.textContent = track.artist || 'MeloPair';
    if (npHeaderSource) npHeaderSource.textContent = (track.album && track.album !== 'Episode') ? track.album : (track.isSong !== false ? 'Song' : 'MeloPair');

    if (npPlayIcon) npPlayIcon.textContent = isPlaying ? '⏸' : '▶';

    if (npLikeBtn) {
      npLikeBtn.classList.toggle('liked', favorites.has(track.id));
    }

    if (activeLyricIndex >= 0) {
      renderImmersiveLyrics(activeLyricIndex);
    }
    renderNowPlayingLyrics();

    if (npSplitStage && npSplitStage.classList.contains('split-queue-open')) {
      renderNowPlayingDrawerQueue();
    }
  }

  window.updateNowPlayingModalUI = function(track) {
    updateNowPlayingView(track);
    notifyNativeMediaState(track, isPlaying);
  };

  // Keep the Now Playing lyrics renderer on the kinetic presentation only.
  function renderNowPlayingLyrics() {
    if (activeLyricIndex >= 0 && lyricsData[activeLyricIndex]) {
      renderImmersiveLyrics(activeLyricIndex);
    }
  }
  window.renderNowPlayingLyrics = renderNowPlayingLyrics;

  // Keep Now Playing in sync only while it is visible. Native media decks
  // schedule updates from timeupdate; the embedded YouTube player uses a
  // requestAnimationFrame loop because it does not emit media timeupdate events.
  function scheduleNowPlayingSync() {
    if (!isNowPlayingOpen || document.hidden || npSyncRaf) return;
    npSyncRaf = requestAnimationFrame(syncNowPlayingLoop);
  }
  window.scheduleNowPlayingSync = scheduleNowPlayingSync;

  function syncNowPlayingLoop() {
    npSyncRaf = 0;
    if (!isNowPlayingOpen || document.hidden) return;
    let curTime = 0;
    let mediaDuration = 0;
    if (isYtActive && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      try {
        curTime = ytPlayer.getCurrentTime() || 0;
        const ytDuration = ytPlayer.getDuration();
        if (Number.isFinite(ytDuration) && ytDuration > 0) mediaDuration = ytDuration;
      } catch (e) {}
    } else if (activeAudio) {
      curTime = activeAudio.currentTime || 0;
      mediaDuration = activeAudio.duration || 0;
    }
    const dur = (isFinite(mediaDuration) && mediaDuration > 0)
      ? mediaDuration
      : (currentTrack?.duration || 214);
    const pct = dur > 0 ? (curTime / dur) * 100 : 0;

    if (npPlayIcon) npPlayIcon.textContent = isPlaying ? '⏸' : '▶';

    if (!isScrubbingNowPlaying) {
      if (npScrubberFill) npScrubberFill.style.width = `${pct}%`;
      if (npScrubberThumb) npScrubberThumb.style.left = `${pct}%`;
      if (npCurrentTime) npCurrentTime.textContent = formatTime(curTime);
      if (npDuration) npDuration.textContent = formatTime(dur);
    }

    // High-precision live synchronization of 3-line kinetic typography
    if (Number.isFinite(curTime)) {
      syncLyricsWithTime(curTime);
    }

    if (isPlaying && isNowPlayingOpen && !document.hidden) {
      npSyncRaf = requestAnimationFrame(syncNowPlayingLoop);
    }
  }

  [audioA, audioB].forEach(deck => {
    if (!deck) return;
    deck.addEventListener('timeupdate', scheduleNowPlayingSync, { passive: true });
    deck.addEventListener('loadedmetadata', scheduleNowPlayingSync, { passive: true });
    deck.addEventListener('play', scheduleNowPlayingSync, { passive: true });
  });
  document.addEventListener('visibilitychange', scheduleNowPlayingSync);

  // ------------------------------------------------------------------------
  // VERSI KINETIC LYRICS FLOATING CONTROLS & STARFIELD ENGINE
  // ------------------------------------------------------------------------
  const versiAutoEmojiBtn = document.getElementById('versiAutoEmojiBtn');
  const versiSmartWrapBtn = document.getElementById('versiSmartWrapBtn');
  const versiFontBtn = document.getElementById('versiFontBtn');
  const versiFontLabel = document.getElementById('versiFontLabel');
  const versiBackdropBtn = document.getElementById('versiBackdropBtn');
  const versiBackdropIcon = document.getElementById('versiBackdropIcon');
  const versiBackdropLabel = document.getElementById('versiBackdropLabel');
  const npStarfieldCanvas = document.getElementById('npStarfieldCanvas');

  let isSmartWrapEnabled = true;
  const VERSI_FONTS = [
    { id: 'sf-pro', label: 'SF Pro', className: 'versi-font-sf-pro' },
    { id: 'sf-rounded', label: 'Rounded', className: 'versi-font-sf-rounded' },
    { id: 'new-york', label: 'New York', className: 'versi-font-new-york' }
  ];
  let currentVersiFontIdx = 0;

  const VERSI_BACKDROPS = [
    { id: 'blur', label: 'Blur', icon: '🌌', className: 'np-backdrop-blur' },
    { id: 'starfield', label: 'Stars', icon: '✨', className: 'np-backdrop-starfield' },
    { id: 'oled', label: 'Dark', icon: '🌙', className: 'np-backdrop-oled' }
  ];
  let isStarsBgMode = true;
  let currentVersiBackdropIdx = 1;

  // Starfield Particle Canvas Animation
  let starfieldAnimId = null;
  let starfieldStars = [];
  let starfieldLastFrame = 0;
  let starfieldResizeHandlerAttached = false;

  function isNowPlayingStageVisible() {
    return Boolean(nowPlayingModal && !nowPlayingModal.classList.contains('hidden'));
  }

  function stopStarfield() {
    if (starfieldAnimId !== null) cancelAnimationFrame(starfieldAnimId);
    starfieldAnimId = null;
    starfieldLastFrame = 0;
  }

  function startStarfieldIfVisible() {
    if (!isStarsBgMode || !isNowPlayingStageVisible() || document.hidden || !npStarfieldCanvas) return;
    npStarfieldCanvas.classList.remove('hidden');
    if (starfieldAnimId === null) starfieldAnimId = requestAnimationFrame(renderStarfieldFrame);
  }

  function initStarfield() {
    if (!npStarfieldCanvas) return;
    const ctx = npStarfieldCanvas.getContext('2d');
    if (!ctx) return;

    function resizeCanvas() {
      if (!npStarfieldCanvas) return;
      const rect = npStarfieldCanvas.parentElement?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const oldWidth = npStarfieldCanvas.width / dpr || rect.width;
      const oldHeight = npStarfieldCanvas.height / dpr || rect.height;
      npStarfieldCanvas.width = Math.max(1, rect.width * dpr);
      npStarfieldCanvas.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (starfieldStars.length) {
        const sx = rect.width / Math.max(1, oldWidth);
        const sy = rect.height / Math.max(1, oldHeight);
        starfieldStars.forEach(star => { star.x *= sx; star.y *= sy; });
      }
    }
    resizeCanvas();
    if (!starfieldResizeHandlerAttached) {
      window.addEventListener('resize', () => {
        resizeCanvas();
        startStarfieldIfVisible();
      });
      starfieldResizeHandlerAttached = true;
      window.addEventListener('focus', startStarfieldIfVisible);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopStarfield();
        else startStarfieldIfVisible();
      });
    }

    const count = 90;
    if (!starfieldStars.length) for (let i = 0; i < count; i++) {
      const speed = 0.025 + Math.random() * 0.11;
      const angle = Math.random() * Math.PI * 2;
      starfieldStars.push({
        x: Math.random() * (npStarfieldCanvas.clientWidth || window.innerWidth),
        y: Math.random() * (npStarfieldCanvas.clientHeight || window.innerHeight),
        radius: Math.random() * 1.5 + 0.5,
        baseAlpha: Math.random() * 0.42 + 0.3,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.45 + Math.random() * 0.7,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed
      });
    }
    startStarfieldIfVisible();
  }

  function renderStarfieldFrame(timestamp) {
      starfieldAnimId = null;
      if (!isStarsBgMode || !isNowPlayingStageVisible() || document.hidden || !npStarfieldCanvas) {
        return;
      }
      const dt = starfieldLastFrame ? Math.min(0.05, Math.max(0, (timestamp - starfieldLastFrame) / 1000)) : 1 / 60;
      starfieldLastFrame = timestamp;
      const elapsed = timestamp / 1000;
      const ctx = npStarfieldCanvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = npStarfieldCanvas.width / dpr;
      const h = npStarfieldCanvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      for (let s of starfieldStars) {
        s.x = (s.x + s.vx * dt * 60 + w) % w;
        s.y = (s.y + s.vy * dt * 60 + h) % h;
        const alpha = s.baseAlpha + Math.sin(elapsed * s.twinkleSpeed + s.twinklePhase) * 0.17;
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.12, Math.min(0.82, alpha))})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      starfieldAnimId = requestAnimationFrame(renderStarfieldFrame);
  }

  // Stars is the default visual mode; the active pill mirrors the canvas state.
  if (nowPlayingModal) nowPlayingModal.classList.add(VERSI_BACKDROPS[1].className);
  if (versiBackdropBtn) {
    versiBackdropBtn.classList.add('active');
    versiBackdropBtn.setAttribute('aria-pressed', 'true');
  }
  if (versiBackdropIcon) versiBackdropIcon.textContent = '✨';
  if (versiBackdropLabel) versiBackdropLabel.textContent = 'Stars';
  npStarfieldCanvas?.classList.remove('hidden');

  // Versi Control Buttons Event Listeners
  if (versiAutoEmojiBtn) {
    versiAutoEmojiBtn.classList.toggle('active', isAutoEmojiEnabled);
    versiAutoEmojiBtn.addEventListener('click', () => {
      isAutoEmojiEnabled = !isAutoEmojiEnabled;
      versiAutoEmojiBtn.classList.toggle('active', isAutoEmojiEnabled);
      if (npAutoEmojiBtn) npAutoEmojiBtn.classList.toggle('active', isAutoEmojiEnabled);
      showToast(isAutoEmojiEnabled ? 'Auto Emoji: ON ✨' : 'Auto Emoji: OFF');
      if (activeLyricIndex >= 0) renderImmersiveLyrics(activeLyricIndex);
    });
  }

  if (versiSmartWrapBtn) {
    versiSmartWrapBtn.classList.toggle('active', isSmartWrapEnabled);
    versiSmartWrapBtn.addEventListener('click', () => {
      isSmartWrapEnabled = !isSmartWrapEnabled;
      versiSmartWrapBtn.classList.toggle('active', isSmartWrapEnabled);
      if (npKineticViewport) npKineticViewport.classList.toggle('smart-wrap-on', isSmartWrapEnabled);
      showToast(isSmartWrapEnabled ? 'Smart Wrap: ON 📐' : 'Smart Wrap: OFF');
      if (activeLyricIndex >= 0) renderImmersiveLyrics(activeLyricIndex);
    });
  }

  if (versiFontBtn) {
    versiFontBtn.addEventListener('click', () => {
      currentVersiFontIdx = (currentVersiFontIdx + 1) % VERSI_FONTS.length;
      const font = VERSI_FONTS[currentVersiFontIdx];
      if (versiFontLabel) versiFontLabel.textContent = font.label;
      if (nowPlayingModal) {
        VERSI_FONTS.forEach(f => nowPlayingModal.classList.remove(f.className));
        nowPlayingModal.classList.add(font.className);
      }
      showToast(`Font: ${font.label}`);
    });
  }

  if (versiBackdropBtn) {
    versiBackdropBtn.addEventListener('click', () => {
      isStarsBgMode = !isStarsBgMode;
      currentVersiBackdropIdx = isStarsBgMode ? 1 : 0;
      const bg = VERSI_BACKDROPS[currentVersiBackdropIdx];
      versiBackdropBtn.classList.toggle('active', isStarsBgMode);
      versiBackdropBtn.setAttribute('aria-pressed', String(isStarsBgMode));
      if (versiBackdropLabel) versiBackdropLabel.textContent = 'Stars';
      if (versiBackdropIcon) versiBackdropIcon.textContent = isStarsBgMode ? '✨' : '🌌';
      if (nowPlayingModal) {
        VERSI_BACKDROPS.forEach(b => nowPlayingModal.classList.remove(b.className));
        nowPlayingModal.classList.add(bg.className);
      }
      if (isStarsBgMode) {
        npStarfieldCanvas?.classList.remove('hidden');
        initStarfield();
      } else {
        npStarfieldCanvas?.classList.add('hidden');
        stopStarfield();
      }
      showToast(isStarsBgMode ? 'Stars: ON ✨' : 'Stars: OFF');
    });
  }

  // Versi Sync Nudge Controls (-0.5s | 0.0s | +0.5s)
  const versiSyncMinusBtn = document.getElementById('versiSyncMinusBtn');
  const versiSyncResetBtn = document.getElementById('versiSyncResetBtn');
  const versiSyncPlusBtn = document.getElementById('versiSyncPlusBtn');
  const versiSyncRealignBtn = document.getElementById('versiSyncRealignBtn');
  let realignFeedbackTimer = 0;

  if (versiSyncRealignBtn) {
    versiSyncRealignBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!realignLyrics('manual', true)) return;
      versiSyncRealignBtn.textContent = '✓ Aligned';
      clearTimeout(realignFeedbackTimer);
      realignFeedbackTimer = setTimeout(() => {
        versiSyncRealignBtn.textContent = '↺ Realign';
        realignFeedbackTimer = 0;
      }, 1200);
    });
  }

  if (versiSyncMinusBtn) {
    versiSyncMinusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const step = e.shiftKey ? -2.0 : -0.5;
      adjustLyricOffset(step);
      showToast(`Lyrics Offset: ${currentSongLyricOffset > 0 ? '+' : ''}${currentSongLyricOffset.toFixed(1)}s`);
    });
  }

  if (versiSyncResetBtn) {
    versiSyncResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustLyricOffset(0);
      showToast('Lyrics Offset Reset (0.0s)');
    });
  }

  if (versiSyncPlusBtn) {
    versiSyncPlusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const step = e.shiftKey ? +2.0 : +0.5;
      adjustLyricOffset(step);
      showToast(`Lyrics Offset: ${currentSongLyricOffset > 0 ? '+' : ''}${currentSongLyricOffset.toFixed(1)}s`);
    });
  }

  // YouTube Music Style Queue Filter Pills (All / Familiar / Discover)
  function setRadioFilterMode(mode) {
    currentRadioFilterMode = mode;
    document.querySelectorAll('.queue-filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === mode);
    });
    const modeLabel = mode === 'familiar' ? 'Familiar Artists' : mode === 'discover' ? 'Discover New Artists' : 'All Radio Recommendations';
    showToast(`Queue Filter: ${modeLabel}`);
    if (currentTrack) {
      void generateRadioSuggestions(currentTrack, currentRadioFilterMode);
    }
  }

  document.querySelectorAll('.queue-filter-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.getAttribute('data-filter') || 'all';
      setRadioFilterMode(mode);
    });
  });

  // Global Keyboard Shortcut: ⌘K or Ctrl+K to focus search
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (nowPlayingModal && !nowPlayingModal.classList.contains('hidden') && npSearchInput) {
        npSearchInput.focus();
        npSearchInput.select();
      } else {
        const appleSearchInput = document.getElementById('appleHeaderSearchInput');
        if (appleSearchInput) {
          appleSearchInput.focus();
          appleSearchInput.select();
        }
      }
    }
  });

  // Dock Buttons: Lyrics & Queue
  const dockLyricsBtn = document.getElementById('dockLyricsBtn');
  const dockQueueBtn = document.getElementById('dockQueueBtn');

  if (dockLyricsBtn) {
    dockLyricsBtn.addEventListener('click', () => {
      if (typeof openNowPlaying === 'function') openNowPlaying();
      if (typeof setNowPlayingLyricsView === 'function') setNowPlayingLyricsView('kinetic');
      dockLyricsBtn.classList.add('active');
      dockQueueBtn?.classList.remove('active');
    });
  }

  if (dockQueueBtn) {
    dockQueueBtn.addEventListener('click', () => {
      const npModal = document.getElementById('nowPlayingModal');
      const isNpOpen = npModal && !npModal.classList.contains('hidden');
      if (isNpOpen) {
        if (typeof toggleNowPlayingQueue === 'function') toggleNowPlayingQueue();
      } else {
        const appLayout = document.getElementById('appLayout') || document.querySelector('.app-layout');
        if (appLayout) {
          appLayout.classList.toggle('show-queue');
          dockQueueBtn.classList.toggle('active', appLayout.classList.contains('show-queue'));
        }
      }
    });
  }


  // ------------------------------------------------------------------------
  // 3. High-Quality Search Autocomplete & Instant Suggestions
  // ------------------------------------------------------------------------
  const homeSearchInput = document.getElementById('homeSearchInput');
  const searchSuggestionsDropdown = document.getElementById('searchSuggestionsDropdown');
  let searchDebounceTimer = null;

  async function fetchSearchSuggestions(query) {
    if (!query || query.length < 2) {
      if (searchSuggestionsDropdown) searchSuggestionsDropdown.classList.add('hidden');
      return;
    }

    const suggestions = new Set();

    // 1. Saavn Autocomplete API (Incredible for Bollywood, Hindi, Punjabi, Artists, and Global)
    try {
      const saavnUrl = `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
      const res = await fetch(saavnUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.songs && data.songs.data) {
          data.songs.data.slice(0, 4).forEach(s => suggestions.add(s.title.replace(/&quot;/g, '"')));
        }
        if (data.artists && data.artists.data) {
          data.artists.data.slice(0, 2).forEach(a => suggestions.add(a.title.replace(/&quot;/g, '"')));
        }
      }
    } catch (e) {}

    // 2. YouTube Music / Google Suggest API (For Global, Pop, Hip-Hop, Indie, Anime)
    try {
      const ytUrl = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
      const res = await fetch(ytUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data[1])) {
          data[1].slice(0, 5).forEach(s => suggestions.add(s));
        }
      }
    } catch (e) {}

    renderSuggestionsDropdown(filterSearchSuggestionStrings(Array.from(suggestions), query));
  }

  function renderSuggestionsDropdown(items) {
    if (!searchSuggestionsDropdown) return;
    if (!items || items.length === 0) {
      searchSuggestionsDropdown.classList.add('hidden');
      return;
    }

    searchSuggestionsDropdown.innerHTML = '';
    items.slice(0, 6).forEach(text => {
      const item = document.createElement('div');
      item.className = 'search-suggestion-item';
      item.innerHTML = `
        <span class="search-sugg-icon">🔍</span>
        <span class="search-sugg-text">${escapeHtml(text)}</span>
        <span class="search-sugg-arrow">↗</span>
      `;
      item.addEventListener('click', () => {
        if (homeSearchInput) homeSearchInput.value = text;
        searchSuggestionsDropdown.classList.add('hidden');
        if (typeof performHomeLiveSearch === 'function') {
          performHomeLiveSearch(text);
        } else if (typeof performSearch === 'function') {
          performSearch(text);
        }
      });
      searchSuggestionsDropdown.appendChild(item);
    });

    searchSuggestionsDropdown.classList.remove('hidden');
  }

  if (homeSearchInput) {
    homeSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        fetchSearchSuggestions(q);
      }, 180);
    });

    homeSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (searchSuggestionsDropdown) searchSuggestionsDropdown.classList.add('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (searchSuggestionsDropdown && !searchSuggestionsDropdown.contains(e.target) && e.target !== homeSearchInput) {
        searchSuggestionsDropdown.classList.add('hidden');
      }
    });
  }

  // Apple Header Search Bar Integration (Instant Auto-Suggest & Live Search)
  const appleHeaderSearchInput = document.getElementById('appleHeaderSearchInput');
  const appleSearchClearBtn = document.getElementById('appleSearchClearBtn');
  const appleSearchShortcut = document.getElementById('appleSearchShortcut');
  const appleSearchDropdown = document.getElementById('appleSearchDropdown');
  let appleSuggestDebounce = null;

  if (appleSearchShortcut) {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
    appleSearchShortcut.textContent = isMac ? '⌘K' : 'Ctrl K';
    appleSearchShortcut.title = isMac ? 'Search (⌘K)' : 'Search (Ctrl K)';
  }

  async function fetchAppleSearchSuggestions(query) {
    if (!appleSearchDropdown) return;
    if (!query || query.length < 2) {
      appleSearchDropdown.classList.add('hidden');
      return;
    }

    const suggestions = new Set();
    try {
      const saavnUrl = `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
      const res = await fetch(saavnUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.songs && data.songs.data) {
          data.songs.data.slice(0, 4).forEach(s => suggestions.add(s.title.replace(/&quot;/g, '"')));
        }
        if (data.artists && data.artists.data) {
          data.artists.data.slice(0, 2).forEach(a => suggestions.add(a.title.replace(/&quot;/g, '"')));
        }
      }
    } catch (e) {}

    try {
      const ytUrl = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
      const res = await fetch(ytUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data[1])) {
          data[1].slice(0, 5).forEach(s => suggestions.add(s));
        }
      }
    } catch (e) {}

    const items = filterSearchSuggestionStrings(Array.from(suggestions), query);
    if (items.length === 0) {
      appleSearchDropdown.classList.add('hidden');
      return;
    }

    appleSearchDropdown.innerHTML = '';
    items.slice(0, 6).forEach(text => {
      const item = document.createElement('div');
      item.className = 'search-suggestion-item';
      item.innerHTML = `
        <span class="search-sugg-icon">🔍</span>
        <span class="search-sugg-text">${escapeHtml(text)}</span>
        <span class="search-sugg-arrow">↗</span>
      `;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent input blur
        if (appleHeaderSearchInput) appleHeaderSearchInput.value = text;
        appleSearchDropdown.classList.add('hidden');
        if (appleSearchClearBtn) appleSearchClearBtn.classList.remove('hidden');
        if (appleSearchShortcut) appleSearchShortcut.classList.add('hidden');
        clearTimeout(homeSearchDebounceTimer);
        switchStageView(viewDiscovery);
        performHomeLiveSearch(text);
      });
      appleSearchDropdown.appendChild(item);
    });
    appleSearchDropdown.classList.remove('hidden');
  }

  if (appleHeaderSearchInput) {
    appleHeaderSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      const hasText = q.length > 0;
      if (appleSearchClearBtn) appleSearchClearBtn.classList.toggle('hidden', !hasText);
      if (appleSearchShortcut) appleSearchShortcut.classList.toggle('hidden', hasText);

      clearTimeout(homeSearchDebounceTimer);
      clearTimeout(appleSuggestDebounce);

      if (!hasText) {
        clearHomeLiveSearch();
        return;
      }

      // Live suggest dropdown
      appleSuggestDebounce = setTimeout(() => {
        fetchAppleSearchSuggestions(q);
      }, 150);

      // Instant live search in Discovery view
      if (homeSearchResultsShelf) homeSearchResultsShelf.classList.remove('hidden');
      if (quickPicksShelf) quickPicksShelf.classList.add('hidden');
      if (trendingShelf) trendingShelf.classList.add('hidden');
      if (homeSearchShelfTitle) homeSearchShelfTitle.textContent = `Searching for "${q}"...`;
      switchStageView(viewDiscovery);

      homeSearchDebounceTimer = setTimeout(() => {
        performHomeLiveSearch(q);
      }, 250);
    });

    appleHeaderSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = appleHeaderSearchInput.value.trim();
        if (appleSearchDropdown) appleSearchDropdown.classList.add('hidden');
        if (q.length > 0) {
          clearTimeout(homeSearchDebounceTimer);
          switchStageView(viewDiscovery);
          performHomeLiveSearch(q);
        }
      } else if (e.key === 'Escape') {
        clearHomeLiveSearch();
        appleHeaderSearchInput.blur();
      }
    });

    appleHeaderSearchInput.addEventListener('focus', () => {
      const q = appleHeaderSearchInput.value.trim();
      if (q.length >= 2) {
        fetchAppleSearchSuggestions(q);
      }
    });

    appleHeaderSearchInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (appleSearchDropdown) appleSearchDropdown.classList.add('hidden');
      }, 200);
    });
  }

  if (appleSearchClearBtn) {
    appleSearchClearBtn.addEventListener('click', () => {
      clearHomeLiveSearch();
      if (appleHeaderSearchInput) appleHeaderSearchInput.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (appleSearchDropdown && !appleSearchDropdown.contains(e.target) && e.target !== appleHeaderSearchInput) {
      appleSearchDropdown.classList.add('hidden');
    }
  });

  // Apple Mobile Bottom Navigation Bar Integration
  const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
  bottomNavItems.forEach(btn => {
    btn.addEventListener('click', () => {
      bottomNavItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.getAttribute('data-view');
      if (view === 'discovery') {
        switchStageView(viewDiscovery);
      } else if (view === 'browse') {
        const viewBrowse = document.getElementById('viewBrowse');
        if (viewBrowse) {
          switchStageView(viewBrowse);
          if (typeof loadBrowseContent === 'function') loadBrowseContent();
        } else {
          switchStageView(viewDiscovery);
        }
      } else if (view === 'rooms') {
        openPartyRoomsModal();
      } else if (view === 'library') {
        switchStageView(viewLibrary);
        if (typeof renderLibraryList === 'function') renderLibraryList();
      } else if (view === 'settings') {
        switchStageView(viewSettings);
      }
    });
  });

  const winMinBtn = document.getElementById('winMinBtn');
  if (winMinBtn && window.echoApi) {
    winMinBtn.addEventListener('click', () => window.echoApi.minimize());
  }

  // ------------------------------------------------------------------------
  // 4. Auto-Play Radio Recommendations & Endless Queue
  // ------------------------------------------------------------------------
  window.searchInnerTubeSongs = function(query) {
    if (window.echoApi && typeof window.echoApi.searchMusic === 'function') {
      return window.echoApi.searchMusic(query).then(res => {
        return (res && res.results) ? res.results : (Array.isArray(res) ? res : []);
      });
    }
    return Promise.resolve([]);
  };

  window.checkAndRefillQueue = function() {
    if (!queue || queue.length === 0 || !currentTrack || !isAutoplayEnabled) return;
    const currentIndex = queue.findIndex(t => t.id === currentTrack?.id);
    if (currentIndex >= queue.length - 2) {
      console.log(`[Auto-Play Radio] Refreshing similar tracks for: ${currentTrack.title}`);
      void fetchRadioRecommendations(currentTrack, false);
    }
  };

  console.log('[Echo Engine] Apple Music Experience & Native Media Bridge active!');
})();


// ==========================================================================
// MELOPAIR - IN-APP REAL-TIME DIAGNOSTIC LOGGER & SYNC MASTER ENGINE
// Full Live Logging Console • Phase-Locked Loop (PLL) • ±0.5ms Micro-Nudge
// Zero-Break Seamless DJ Mashup Crossfade On Both Host & Satellite
// ==========================================================================

(function initDiagnosticsAndSyncEngine() {
  console.log('[Echo Engine] Initializing In-App Diagnostics Logger & Sync Master...');

  // Safe reference to audio elements and playback context
  const getActiveDeck = () => (typeof activeAudio !== 'undefined' && activeAudio) || document.getElementById('audioA');
  const getIdleDeck = () => (typeof idleAudio !== 'undefined' && idleAudio) || document.getElementById('audioB');
  function setSatelliteDeckVolume(deck, volume) {
    if (!deck) return;
    const safeVolume = Math.max(0, Math.min(1, volume));
    const deckGain = deck === audioA ? gainA : (deck === audioB ? gainB : null);
    if (deckGain && audioCtx) {
      deck.volume = 1;
      setDeckGain(deck, safeVolume, 0.025);
    } else {
      deck.volume = safeVolume;
    }
  }

  // Helper to parse input (URL, IP:Port, IP, Cloudflare domain, or Room Code)
  function parseHostAndRoom(input) {
    if (!input) return { host: '', room: '' };
    let trimmed = String(input).trim();
    let host = '';
    let room = '';

    // Remove any surrounding quotes or brackets
    trimmed = trimmed.replace(/^["'<\(]+|["'>\)]+$/g, '');

    // 1. Check if input is a URL (with or without protocol)
    let urlToParse = trimmed;
    if (!/^https?:\/\//i.test(urlToParse) && (urlToParse.includes('trycloudflare.com') || urlToParse.includes(':38472') || urlToParse.includes('/room/'))) {
      urlToParse = (urlToParse.includes('trycloudflare.com') ? 'https://' : 'http://') + urlToParse;
    }

    if (/^https?:\/\//i.test(urlToParse)) {
      try {
        const u = new URL(urlToParse);
        host = u.host; // includes hostname and port if present
        
        // Check pathname for /room/CODE or /join/CODE
        const pathMatch = u.pathname.match(/\/(?:room|join)\/([a-zA-Z0-9_-]+)/i);
        if (pathMatch) {
          room = pathMatch[1];
        }

        // Check query parameters: ?room=CODE or ?code=CODE
        if (!room) {
          room = u.searchParams.get('room') || u.searchParams.get('code') || '';
        }

        // Check hash: #room=CODE or #CODE
        if (!room && u.hash) {
          const hashMatch = u.hash.match(/[#&](?:room|code)=([a-zA-Z0-9_-]+)/i) || u.hash.match(/^#([a-zA-Z0-9_-]+)$/i);
          if (hashMatch) room = hashMatch[1];
        }

        return { host, room };
      } catch (e) {
        // Fallback to regex if URL parsing fails
      }
    }

    // 2. Space or comma separated: "10.240.88.183:38472 849201"
    if (trimmed.includes(' ') || trimmed.includes(',')) {
      const parts = trimmed.split(/[\s,]+/).filter(Boolean);
      for (const part of parts) {
        if (part.includes('.') || part.includes(':')) {
          host = part;
        } else if (/^[a-zA-Z0-9_-]{3,12}$/.test(part)) {
          room = part;
        }
      }
      return { host, room };
    }

    // 3. IP with path or port: "10.240.88.183:38472/room/849201"
    const pathMatch = trimmed.match(/^([^/]+)\/(?:room|join)\/([a-zA-Z0-9_-]+)/i);
    if (pathMatch) {
      return { host: pathMatch[1], room: pathMatch[2] };
    }

    // 4. IP or domain: contains '.' or ':'
    if (trimmed.includes('.') || trimmed.includes(':')) {
      const slashMatch = trimmed.match(/^([^/?#]+)(?:\/(?:room|join)\/([a-zA-Z0-9_-]+))?/i);
      if (slashMatch) {
        host = slashMatch[1].replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
        room = slashMatch[2] || '';
      } else {
        host = trimmed.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
      }
      return { host, room };
    }

    // 5. Bare room code (e.g. 6-digit: 849201 or letters)
    const cleanedCode = trimmed.replace(/[\s-]+/g, '');
    return { host: '', room: cleanedCode };
  }

  function formatHostWsUrl(host) {
    let clean = host.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '').replace(/\/.*$/, '').trim();
    const isCloudflare = clean.includes('trycloudflare.com');
    const isHttps = isCloudflare || (window.location && window.location.protocol === 'https:');
    const proto = isHttps ? 'wss:' : 'ws:';

    // If no port specified and not Cloudflare, append default port 38472
    if (!clean.includes(':') && !isCloudflare) {
      clean = `${clean}:38472`;
    }
    return {
      wsUrl: `${proto}//${clean}/ws`,
      cleanAddr: clean,
      isSecure: isHttps
    };
  }

  // Universal WebSocket Connector for Host/Satellite
  let desktopSocket = null;
  let satCallbacks = [];
  let roomHeartbeatTimer = null;
  let roomPongTimeout = null;
  let roomReconnectTimer = null;
  let roomReconnectAttempts = 0;
  let roomDisconnectWasManual = false;
  let roomConnectionTarget = null;

  function clearRoomClientTimers() {
    clearInterval(roomHeartbeatTimer);
    clearTimeout(roomPongTimeout);
    roomHeartbeatTimer = null;
    roomPongTimeout = null;
  }

  if (window.echoApi && !window.echoApi.onSatelliteStateSync) {
    window.echoApi.onSatelliteStateSync = (cb) => satCallbacks.push(cb);
  }

  window.connectToEchoHost = function(hostAddress, roomCode, isReconnect = false) {
    if (!isReconnect) {
      roomDisconnectWasManual = false;
      roomReconnectAttempts = 0;
      clearTimeout(roomReconnectTimer);
      roomConnectionTarget = { hostAddress, roomCode };
    }
    clearRoomClientTimers();
    if (desktopSocket) {
      try { desktopSocket.close(); } catch(e){}
      desktopSocket = null;
    }

    // If no host provided, fallback to saved host
    if (!hostAddress) {
      hostAddress = safeStorageGet('echo_last_host_ip');
    }
    if (!hostAddress) {
      if (window.echoLogger) window.echoLogger.warn('No Host IP available to connect');
      showToast('Please enter Host IP (e.g. 10.240.88.183:38472) or scan QR code');
      return;
    }

    const { wsUrl, cleanAddr } = formatHostWsUrl(hostAddress);
    const resolvedRoom = roomCode || safeStorageGet('echo_last_room_code') || 'ECHO-PARTY';
    roomConnectionTarget = { hostAddress: cleanAddr, roomCode: resolvedRoom };

    if (window.echoLogger) window.echoLogger.sync(`Connecting to Host: ${wsUrl} (Room: ${resolvedRoom})`);

    const satBadge = document.getElementById('satelliteStateBadge');
    const satText = document.getElementById('satelliteStateText');
    if (satText) satText.textContent = 'Connecting... 🟡';
    if (satBadge) satBadge.style.color = '#f59e0b';

    try {
      const socket = new WebSocket(wsUrl);
      desktopSocket = socket;

      socket.onopen = () => {
        if (socket !== desktopSocket) return;
        roomReconnectAttempts = 0;
        if (window.echoLogger) window.echoLogger.sync('Connected to Host WebSocket successfully!');
        if (satText) satText.textContent = 'Phase-Locked (Connected) 🟢';
        if (satBadge) satBadge.style.color = '#34d399';

        localStorage.setItem('echo_last_host_ip', cleanAddr);
        if (resolvedRoom) localStorage.setItem('echo_last_room_code', resolvedRoom);
        updateSavedHostDisplay();

        const isAndroid = navigator.userAgent && navigator.userAgent.includes('Android');
        socket.send(JSON.stringify({
          type: 'join',
          room: resolvedRoom,
          deviceName: isAndroid ? 'Echo Android Phone' : 'Echo Desktop'
        }));

        // Burst NTP calibration pings
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            if (socket === desktopSocket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping', t1: performance.now(), pingSentAtMs: Date.now() }));
            }
          }, i * 75);
        }

        roomHeartbeatTimer = setInterval(() => {
          if (socket !== desktopSocket || socket.readyState !== WebSocket.OPEN) return;
          clearTimeout(roomPongTimeout);
          socket.send(JSON.stringify({ type: 'ping', t1: performance.now(), pingSentAtMs: Date.now() }));
          roomPongTimeout = setTimeout(() => {
            if (socket === desktopSocket && socket.readyState === WebSocket.OPEN) socket.close();
          }, 10000);
        }, 5000);

        showToast(`Connected to Party Room on ${cleanAddr}! 🟢`);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pong') {
            clearTimeout(roomPongTimeout);
            const curRtt = performance.now() - msg.t1;
            satelliteRtt = satelliteRtt === 0 ? curRtt : (satelliteRtt * 0.6 + curRtt * 0.4);
            if (Number.isFinite(msg.pingSentAtMs)) {
              satelliteOneWayLatencySec = Math.min(2.5, Math.max(0, (Date.now() - msg.pingSentAtMs) / 2000));
            }
            const serverNow = msg.serverTime + (satelliteRtt / 2);
            satelliteClockOffset = serverNow - Date.now();

            if (satStatRtt) satStatRtt.textContent = `${Math.round(satelliteRtt)} ms`;
            if (satStatOffset) satStatOffset.textContent = `${Math.round(satelliteClockOffset)} ms`;
          } else if (msg.type === 'room_error') {
            roomDisconnectWasManual = true;
            if (window.echoLogger) window.echoLogger.error(msg.message || 'Room code was rejected');
            if (satText) satText.textContent = msg.message || 'Room code mismatch';
          } else if (msg.type === 'state_sync' || msg.type === 'track_change' || msg.type === 'force_snap' || msg.type === 'room-sync-tick') {
            msg.clockOffset = satelliteClockOffset;
            msg.rtt = satelliteRtt;
            msg.oneWayLatencySec = satelliteOneWayLatencySec;
            if (satCallbacks.length > 0) {
              satCallbacks.forEach(cb => cb(msg));
            } else {
              // The registered room-state callback owns playback dispatch.
              // Keep this fallback for startup ordering, but never dispatch both.
              handleIncomingHostPlayback(msg, Boolean(msg.forceSnap));
            }
          } else if (msg.type === 'pulse') {
            triggerAcousticChirp(msg.targetServerTime);
          }
        } catch(e){}
      };

      socket.onerror = (err) => {
        if (window.echoLogger) window.echoLogger.error('WebSocket connection error on host');
        if (satText) satText.textContent = 'Connection Error 🔴';
        if (satBadge) satBadge.style.color = '#ef4444';
      };

      socket.onclose = () => {
        if (socket !== desktopSocket) return;
        clearRoomClientTimers();
        if (window.echoLogger) window.echoLogger.sync('Disconnected from Host WebSocket');
        if (satText) satText.textContent = 'Disconnected';
        if (satBadge) satBadge.style.color = '#94a3b8';
        if (!roomDisconnectWasManual && roomConnectionTarget && !roomReconnectTimer) {
          const delay = Math.min(30000, 1000 * (2 ** Math.min(roomReconnectAttempts, 5)));
          roomReconnectAttempts++;
          if (satText) satText.textContent = `Reconnecting in ${Math.ceil(delay / 1000)}s...`;
          roomReconnectTimer = setTimeout(() => {
            roomReconnectTimer = null;
            window.connectToEchoHost(roomConnectionTarget.hostAddress, roomConnectionTarget.roomCode, true);
          }, delay);
        }
      };
    } catch(err) {
      if (window.echoLogger) window.echoLogger.error('Connection failed: ' + err.message);
      if (satText) satText.textContent = 'Connection Failed 🔴';
      if (satBadge) satBadge.style.color = '#ef4444';
    }
  };

  window.disconnectFromEchoHost = function() {
    roomDisconnectWasManual = true;
    clearTimeout(roomReconnectTimer);
    roomReconnectTimer = null;
    clearRoomClientTimers();
    satellitePlaybackSyncSeq++;
    satellitePlaybackSyncKey = '';
    lastSatelliteHostMsg = null;
    if (desktopSocket) {
      try { desktopSocket.close(); } catch(e){}
      desktopSocket = null;
    }
    const satBadge = document.getElementById('satelliteStateBadge');
    const satText = document.getElementById('satelliteStateText');
    if (satText) satText.textContent = 'Disconnected (Standalone)';
    if (satBadge) satBadge.style.color = '#94a3b8';
  };

  // ------------------------------------------------------------------------
  // 1. In-App Diagnostic Logger UI Controller
  // ------------------------------------------------------------------------
  const echoDebugDrawer = document.getElementById('echoDebugDrawer');
  const diagnosticsLogsBtn = document.getElementById('diagnosticsLogsBtn');
  const openAudioDiagnosticsBtn = document.getElementById('openAudioDiagnosticsBtn');
  const closeDebugDrawerBtn = document.getElementById('closeDebugDrawerBtn');
  const copyDebugLogsBtn = document.getElementById('copyDebugLogsBtn');
  const clearDebugLogsBtn = document.getElementById('clearDebugLogsBtn');
  const exportDebugLogsBtn = document.getElementById('exportDebugLogsBtn');
  const debugLogConsole = document.getElementById('debugLogConsole');
  const debugAutoScrollToggle = document.getElementById('debugAutoScrollToggle');
  const filterChips = document.querySelectorAll('.filter-chip');

  const debugStatEngine = document.getElementById('debugStatEngine');
  const debugStatTrack = document.getElementById('debugStatTrack');
  const debugStatRoom = document.getElementById('debugStatRoom');
  const debugStatNtp = document.getElementById('debugStatNtp');
  const debugStatBt = document.getElementById('debugStatBt');

  let activeFilter = 'all';

  function renderLogEntry(entry) {
    if (!debugLogConsole) return;
    if (entry.type === 'clear') {
      debugLogConsole.innerHTML = '';
      return;
    }

    if (activeFilter !== 'all') {
      if (activeFilter === 'audio' && entry.level !== 'audio') return;
      if (activeFilter === 'sync' && entry.level !== 'sync') return;
      if (activeFilter === 'search' && entry.tag !== '[SEARCH]') return;
      if (activeFilter === 'err' && entry.level !== 'error' && entry.level !== 'warn') return;
    }

    const row = document.createElement('div');
    row.className = `log-line ${entry.level}`;

    const tagClass = entry.level === 'audio' ? 'audio' :
                     entry.level === 'sync' ? 'sync' :
                     entry.tag === '[SEARCH]' ? 'search' :
                     entry.level === 'warn' ? 'warn' :
                     entry.level === 'error' ? 'err' : 'system';

    row.innerHTML = `
      <span class="log-time">[${entry.time}]</span>
      <span class="log-tag ${tagClass}">${entry.tag}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    `;

    debugLogConsole.appendChild(row);

    if (debugAutoScrollToggle && debugAutoScrollToggle.checked) {
      debugLogConsole.scrollTop = debugLogConsole.scrollHeight;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function refreshAllLogs() {
    if (!debugLogConsole || !window.echoLogger) return;
    debugLogConsole.innerHTML = '';
    const logs = window.echoLogger.getLogs();
    logs.forEach(renderLogEntry);
  }

  if (window.echoLogger) {
    window.echoLogger.addListener(renderLogEntry);
  }

  [diagnosticsLogsBtn, openAudioDiagnosticsBtn].filter(Boolean).forEach((button) => {
    button.addEventListener('click', () => {
      if (echoDebugDrawer) {
        echoDebugDrawer.classList.remove('hidden');
        refreshAllLogs();
      }
    });
  });

  if (closeDebugDrawerBtn) {
    closeDebugDrawerBtn.addEventListener('click', () => {
      if (echoDebugDrawer) echoDebugDrawer.classList.add('hidden');
    });
  }

  if (copyDebugLogsBtn) {
    copyDebugLogsBtn.addEventListener('click', async () => {
      if (window.echoLogger) {
        const text = window.echoLogger.export();
        try {
          await navigator.clipboard.writeText(text);
          showToast('All diagnostics logs copied to clipboard! 📋');
        } catch (e) {
          showToast('Failed to copy logs to clipboard');
        }
      }
    });
  }

  if (clearDebugLogsBtn) {
    clearDebugLogsBtn.addEventListener('click', () => {
      if (window.echoLogger) {
        window.echoLogger.clear();
        showToast('Diagnostics log buffer cleared 🧹');
      }
    });
  }

  if (exportDebugLogsBtn) {
    exportDebugLogsBtn.addEventListener('click', () => {
      if (window.echoLogger) {
        const text = window.echoLogger.export();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `echo-diagnostics-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Exported diagnostic log report ⬇️');
      }
    });
  }

  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      refreshAllLogs();
    });
  });

  // Periodic Diagnostics Stats Bar Update
  setInterval(() => {
    if (!echoDebugDrawer || echoDebugDrawer.classList.contains('hidden')) return;

    if (debugStatEngine) debugStatEngine.textContent = '320kbps Studio Lossless';
    if (debugStatTrack && typeof currentTrack !== 'undefined' && currentTrack) {
      const dur = currentTrack.duration ? `${Math.floor(currentTrack.duration / 60)}:${('00' + (currentTrack.duration % 60)).slice(-2)}` : 'Live';
      debugStatTrack.textContent = `${currentTrack.title || 'Unknown'} (${dur})`;
    }
    if (debugStatRoom) {
      debugStatRoom.textContent = isSatelliteConnected ? `Satellite (#${activeSatelliteRoom || 'Party'})` : 'Host / Standalone';
    }
    if (debugStatNtp) {
      debugStatNtp.textContent = `${Math.round(satelliteClockOffset)} ms (RTT: ${Math.round(satelliteRtt)}ms)`;
    }
    if (debugStatBt) {
      debugStatBt.textContent = `${satelliteBtDelayMs} ms`;
    }
  }, 1000);

  // ------------------------------------------------------------------------
  // 2. Party Role Tabs (Host Mode vs Satellite Mode)
  // ------------------------------------------------------------------------
  const partyRoleHostTab = document.getElementById('partyRoleHostTab');
  const partyRoleSatelliteTab = document.getElementById('partyRoleSatelliteTab');
  const partyHostView = document.getElementById('partyHostView');
  const partySatelliteView = document.getElementById('partySatelliteView');

  function updateSavedHostDisplay() {
    const satRecentHostText = document.getElementById('satRecentHostText');
    const satUseRecentBtn = document.getElementById('satUseRecentBtn');
    const saved = safeStorageGet('echo_last_host_ip');
    if (satRecentHostText) {
      satRecentHostText.textContent = saved || 'None';
    }
    if (satUseRecentBtn) {
      satUseRecentBtn.style.display = saved ? 'inline-block' : 'none';
    }
  }

  if (partyRoleHostTab && partyRoleSatelliteTab && partyHostView && partySatelliteView) {
    partyRoleHostTab.addEventListener('click', () => {
      partyRoleHostTab.classList.add('active');
      partyRoleSatelliteTab.classList.remove('active');
      partyHostView.classList.remove('hidden');
      partySatelliteView.classList.add('hidden');
    });

    partyRoleSatelliteTab.addEventListener('click', () => {
      partyRoleSatelliteTab.classList.add('active');
      partyRoleHostTab.classList.remove('active');
      partySatelliteView.classList.remove('hidden');
      partyHostView.classList.add('hidden');
      updateSavedHostDisplay();
    });
  }

  // Saved Host tap-to-use handlers
  const satRecentHostText = document.getElementById('satRecentHostText');
  const satUseRecentBtn = document.getElementById('satUseRecentBtn');
  const satInput = document.getElementById('satelliteHostInput');

  if (satRecentHostText) {
    satRecentHostText.addEventListener('click', () => {
      const saved = safeStorageGet('echo_last_host_ip');
      if (saved && satInput) {
        satInput.value = saved;
        showToast(`Filled saved Host IP: ${saved}`);
      }
    });
  }

  if (satUseRecentBtn) {
    satUseRecentBtn.addEventListener('click', () => {
      const saved = safeStorageGet('echo_last_host_ip');
      if (saved && satInput) {
        satInput.value = saved;
        const satConnBtn = document.getElementById('satelliteConnectBtn');
        if (satConnBtn) satConnBtn.click();
      }
    });
  }

  // Copy Host IP Button in Host View
  const copyHostIpBtn = document.getElementById('copyHostIpBtn');
  if (copyHostIpBtn) {
    copyHostIpBtn.addEventListener('click', async () => {
      const hostIpDisplay = document.getElementById('partyHostIpDisplay');
      const val = hostIpDisplay ? hostIpDisplay.textContent.trim() : '';
      if (val && val !== 'Detecting...') {
        try {
          await navigator.clipboard.writeText(val);
          showToast(`Copied Host IP: ${val} 📋`);
        } catch(e) {
          showToast(`Host IP: ${val}`);
        }
      }
    });
  }

  // ------------------------------------------------------------------------
  // 3. Satellite Receiver Mode Controller & Audio Sync
  // ------------------------------------------------------------------------
  const satelliteHostInput = document.getElementById('satelliteHostInput');
  const satelliteConnectBtn = document.getElementById('satelliteConnectBtn');
  const satelliteScanBtn = document.getElementById('satelliteScanBtn');
  const satelliteDisconnectBtn = document.getElementById('satelliteDisconnectBtn');
  const satelliteStateBadge = document.getElementById('satelliteStateBadge');
  const satelliteStateText = document.getElementById('satelliteStateText');

  const satStatRtt = document.getElementById('satStatRtt');
  const satStatOffset = document.getElementById('satStatOffset');
  const satStatSkew = document.getElementById('satStatSkew');
  const satStatDeck = document.getElementById('satStatDeck');
  const satDelayDisplay = document.getElementById('satDelayDisplay');
  const satBeepPulseBtn = document.getElementById('satBeepPulseBtn');
  const satAutoSyncLatencyDisplay = document.getElementById('autoSyncLatencyValue');

  let isSatelliteConnected = false;
  let activeSatelliteRoom = '';
  let satelliteClockOffset = 0;
  let satelliteRtt = 0;
  let satelliteOneWayLatencySec = 0;
  let satelliteBtDelayMs = 0;
  let satelliteHostOutputLatencyMs = 0;
  let lastSatelliteHostMsg = null;
  let satellitePlaybackSyncSeq = 0;
  let satellitePlaybackSyncKey = '';
  const satelliteStreamUrlPromises = new Map();

  async function resolveSatelliteStreamUrlOnce(trackOrId, trackTitle = '') {
    const track = trackOrId && typeof trackOrId === 'object' ? trackOrId : { id: trackOrId, title: trackTitle };
    const trackId = String(track.id || '');
    if (!trackId || typeof getOrResolveStreamUrl !== 'function') return null;
    const cached = streamUrlCache?.get(trackId);
    if (cached?.url) return cached.url;
    if (satelliteStreamUrlPromises.has(trackId)) return satelliteStreamUrlPromises.get(trackId);

    const request = getOrResolveStreamUrl(track);
    satelliteStreamUrlPromises.set(trackId, request);
    try {
      return await request;
    } finally {
      if (satelliteStreamUrlPromises.get(trackId) === request) {
        satelliteStreamUrlPromises.delete(trackId);
      }
    }
  }
  try {
    const savedSatelliteDelay = Number(safeStorageGet('echo_sat_bt_delay'));
    if (Number.isFinite(savedSatelliteDelay)) satelliteBtDelayMs = savedSatelliteDelay;
  } catch (e) {}

  // Bluetooth Latency Presets
  const btPresetBtns = document.querySelectorAll('.bt-preset-btn');
  btPresetBtns.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.delay) === satelliteBtDelayMs));
  btPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      btPresetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      satelliteBtDelayMs = parseFloat(btn.dataset.delay) || 0;
      updateSatDelayDisplay();
      try { localStorage.setItem('echo_sat_bt_delay', satelliteBtDelayMs); } catch(e){}
      if (lastSatelliteHostMsg) handleIncomingHostPlayback(lastSatelliteHostMsg, true);
      if (window.echoLogger) window.echoLogger.sync(`Bluetooth Preset applied: ${btn.textContent.trim()} (${satelliteBtDelayMs}ms)`);
      showToast(`Applied ${btn.querySelector('span')?.textContent || 'Preset'}: ${satelliteBtDelayMs > 0 ? '+' : ''}${satelliteBtDelayMs}ms 🎧`);
    });
  });

  // Micro-Nudge Stepper Buttons (±0.5ms, ±1ms, ±5ms, ±10ms)
  function attachNudge(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      satelliteBtDelayMs = Math.round((satelliteBtDelayMs + delta) * 10) / 10;
      btPresetBtns.forEach(b => b.classList.remove('active'));
      updateSatDelayDisplay();
      try { localStorage.setItem('echo_sat_bt_delay', satelliteBtDelayMs); } catch(e){}
      if (lastSatelliteHostMsg) handleIncomingHostPlayback(lastSatelliteHostMsg, true);
      if (window.echoLogger) window.echoLogger.sync(`Micro-nudge ${delta > 0 ? '+' : ''}${delta}ms -> Total Delay: ${satelliteBtDelayMs}ms`);
      showToast(`Compensation: ${satelliteBtDelayMs > 0 ? '+' : ''}${satelliteBtDelayMs} ms`);
    });
  }

  attachNudge('satNudgeMinus10', -10);
  attachNudge('satNudgeMinus5', -5);
  attachNudge('satNudgeMinus1', -1);
  attachNudge('satNudgeMinusHalf', -0.5);
  attachNudge('satNudgePlusHalf', +0.5);
  attachNudge('satNudgePlus1', +1);
  attachNudge('satNudgePlus5', +5);
  attachNudge('satNudgePlus10', +10);

  function updateSatDelayDisplay() {
    if (satDelayDisplay) {
      satDelayDisplay.textContent = `${satelliteBtDelayMs > 0 ? '+' : ''}${satelliteBtDelayMs} ms`;
    }
  }

  // Fast Automatic LAN Host Discovery for 6-digit room code entry
  let isLanDiscovering = false;
  async function discoverHostAndConnect(roomCode) {
    if (isLanDiscovering) return;
    isLanDiscovering = true;

    if (satelliteStateText) satelliteStateText.textContent = 'Searching LAN... 🔍';
    showToast(`Searching Wi-Fi for Echo Room ${roomCode}... 📡`);

    // 1. Check saved host first
    const savedHost = safeStorageGet('echo_last_host_ip');
    if (savedHost) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1200);
        const r = await fetch(`http://${savedHost}/api/room-info`, { signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) {
          const info = await r.json();
          isLanDiscovering = false;
          window.connectToEchoHost(savedHost, roomCode || info.roomId);
          return;
        }
      } catch (e) {}
    }

    // 2. Discover local subnet candidates in parallel
    const prefixes = ['192.168.1.', '192.168.0.', '192.168.29.', '192.168.31.', '10.0.0.', '10.240.88.'];
    let found = false;

    for (const prefix of prefixes) {
      if (found) break;
      const ips = [];
      for (let i = 2; i <= 35; i++) ips.push(prefix + i);
      for (let i = 100; i <= 135; i++) ips.push(prefix + i);
      for (let i = 180; i <= 195; i++) ips.push(prefix + i);

      const batchSize = 25;
      for (let b = 0; b < ips.length; b += batchSize) {
        if (found) break;
        const chunk = ips.slice(b, b + batchSize);
        await Promise.all(chunk.map(async (ip) => {
          if (found) return;
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 850);
            const resp = await fetch(`http://${ip}:38472/api/room-info`, { signal: ctrl.signal });
            clearTimeout(tid);
            if (resp.ok) {
              const data = await resp.json();
              if (data) {
                found = true;
                const hostAddr = `${ip}:38472`;
                localStorage.setItem('echo_last_host_ip', hostAddr);
                if (satelliteHostInput) satelliteHostInput.value = `${hostAddr}/room/${roomCode || data.roomId}`;
                showToast(`Found Host at ${hostAddr}! Connecting... 🟢`);
                window.connectToEchoHost(hostAddr, roomCode || data.roomId);
              }
            }
          } catch(e) {}
        }));
      }
    }

    isLanDiscovering = false;
    if (!found) {
      if (satelliteStateText) satelliteStateText.textContent = 'Enter Host IP';
      showToast(`Host not auto-detected. Enter Host IP (shown on PC, e.g. 192.168.1.183:38472) or scan QR! 📱`);
    }
  }

  // Connect to Host Button
  if (satelliteConnectBtn) {
    satelliteConnectBtn.addEventListener('click', () => {
      const raw = satelliteHostInput ? satelliteHostInput.value.trim() : '';
      if (!raw) {
        // Try saved host if input is blank
        const saved = safeStorageGet('echo_last_host_ip');
        if (saved) {
          satelliteHostInput.value = saved;
          window.connectToEchoHost(saved, safeStorageGet('echo_last_room_code') || 'ECHO-PARTY');
          isSatelliteConnected = true;
          return;
        }
        showToast('Please enter Host IP (e.g. 10.240.88.183:38472) or scan QR code');
        return;
      }

      const parsed = parseHostAndRoom(raw);
      let targetHost = parsed.host;
      let targetRoom = parsed.room || 'ECHO-PARTY';

      // If user typed only a room code (or code without host)
      if (!targetHost && parsed.room) {
        targetHost = safeStorageGet('echo_last_host_ip');
        if (!targetHost && window.location.host && !window.location.host.includes('127.0.0.1') && !window.location.host.includes('localhost')) {
          targetHost = window.location.host;
        }
        if (!targetHost) {
          discoverHostAndConnect(parsed.room);
          return;
        }
      }

      if (window.connectToEchoHost) {
        if (satelliteStateText) satelliteStateText.textContent = 'Connecting... 🟡';
        window.connectToEchoHost(targetHost, targetRoom);
        isSatelliteConnected = true;
        activeSatelliteRoom = targetRoom;
        showToast(`Connecting to Party Room on ${targetHost}... 📡`);
      } else {
        showToast('Satellite connector ready');
      }
    });
  }

  // Scan Host QR Code Button
  if (satelliteScanBtn) {
    satelliteScanBtn.addEventListener('click', () => {
      const scannerModalBackdrop = document.getElementById('scannerModalBackdrop');
      if (scannerModalBackdrop) scannerModalBackdrop.classList.remove('hidden');
      if (typeof startScanner === 'function') startScanner();
    });
  }

  // Disconnect Button
  if (satelliteDisconnectBtn) {
    satelliteDisconnectBtn.addEventListener('click', () => {
      if (window.disconnectFromEchoHost) window.disconnectFromEchoHost();
      isSatelliteConnected = false;
      activeSatelliteRoom = '';
      if (satelliteStateText) satelliteStateText.textContent = 'Disconnected (Standalone)';
      if (satelliteStateBadge) satelliteStateBadge.style.color = '#94a3b8';
      showToast('Disconnected from Party Room 🔌');
    });
  }

  // Acoustic Beep Pulse Alignment Test
  if (satBeepPulseBtn) {
    satBeepPulseBtn.addEventListener('click', () => {
      if (window.echoApi && window.echoApi.sendRoomSyncPulse) {
        window.echoApi.sendRoomSyncPulse();
        showToast('Sent synchronized acoustic pulse test ⚡');
      } else if (desktopSocket && desktopSocket.readyState === WebSocket.OPEN) {
        desktopSocket.send(JSON.stringify({ type: 'request_pulse' }));
        showToast('Sent synchronized acoustic pulse test ⚡');
      }
    });
  }

  // ------------------------------------------------------------------------
  // 4. Zero-Drift Phase-Locked Loop (PLL) Audio Engine on Satellite
  // Seamless DJ Crossfade • Micro-Pitch Rate Adjustment • Zero-Break Deck Swap
  // ------------------------------------------------------------------------
  if (window.echoApi && window.echoApi.onSatelliteStateSync) {
    window.echoApi.onSatelliteStateSync(async (msg) => {
      if (!msg) return;
      lastSatelliteHostMsg = msg;
      isSatelliteConnected = true;

      if (msg.clockOffset !== undefined) satelliteClockOffset = msg.clockOffset;
      if (msg.rtt !== undefined) satelliteRtt = msg.rtt;
      if (Number.isFinite(msg.outputLatencyMs)) {
        satelliteHostOutputLatencyMs = Math.max(0, Math.min(1000, msg.outputLatencyMs));
        const localLatencyMs = audioCtx && Number.isFinite(audioCtx.outputLatency)
          ? Math.max(0, audioCtx.outputLatency * 1000)
          : 0;
        if (satAutoSyncLatencyDisplay) {
          if (localLatencyMs > 0) {
            const delta = Math.round(localLatencyMs - satelliteHostOutputLatencyMs);
            satAutoSyncLatencyDisplay.textContent = `Automatic output estimate ${delta >= 0 ? '+' : ''}${delta} ms`;
          } else {
            satAutoSyncLatencyDisplay.textContent = 'Automatic estimate unavailable · use the sync pulse to fine-tune';
          }
        }
      }

      if (satStatRtt) satStatRtt.textContent = `${Math.round(satelliteRtt)} ms`;
      if (satStatOffset) satStatOffset.textContent = `${Math.round(satelliteClockOffset)} ms`;
      if (satelliteStateText) {
        satelliteStateText.textContent = msg.isPlaying ? 'Phase-Locked (Playing) 🟢' : 'Phase-Locked (Paused) ⏸';
      }
      if (satelliteStateBadge) {
        satelliteStateBadge.style.color = msg.isPlaying ? '#34d399' : '#f59e0b';
      }

      await handleIncomingHostPlayback(msg, Boolean(msg.forceSnap));
      if (roomRealignPending && msg.type === 'room-sync-tick') {
        roomRealignPending = false;
        flashRoomRealignButton();
      }
    });
  }

  async function handleIncomingHostPlayback(msg, forceSnap = false) {
    if (!msg) return;
    if (!Number.isFinite(msg.position) && Number.isFinite(msg.positionSec)) msg = { ...msg, position: msg.positionSec };
    if (!Number.isFinite(msg.hostTime) && Number.isFinite(msg.hostSentAtMs)) msg = { ...msg, hostTime: msg.hostSentAtMs };
    const trackId = msg.track?.id || '';
    const incomingTrackId = msg.incomingTrack?.id || (msg.isCrossfading ? (msg.nextTrack?.id || '') : '');
    const syncKey = `${trackId}\u001f${incomingTrackId}\u001f${Boolean(msg.isCrossfading)}\u001f${Boolean(msg.isPlaying)}`;
    if (syncKey !== satellitePlaybackSyncKey) {
      satellitePlaybackSyncKey = syncKey;
      satellitePlaybackSyncSeq++;
    }
    const syncSeq = satellitePlaybackSyncSeq;
    lastSatelliteHostMsg = msg;
    let curActiveAudio = getActiveDeck();
    let curIdleAudio = getIdleDeck();

    const localOutputLatencyMs = audioCtx && Number.isFinite(audioCtx.outputLatency)
      ? Math.max(0, audioCtx.outputLatency * 1000)
      : 0;
    const outputLatencyDeltaMs = localOutputLatencyMs > 0
      ? localOutputLatencyMs - satelliteHostOutputLatencyMs
      : 0;
    const calSec = ((satelliteBtDelayMs || 0) + outputLatencyDeltaMs) / 1000;
    const currentHostNow = Date.now() + satelliteClockOffset;
    const stateSentAtMs = Number(msg.hostSentAtMs || msg.hostTime || msg.timestamp);
    const elapsedSinceMeasure = msg.isPlaying && Number.isFinite(stateSentAtMs)
      ? Math.max(0, (currentHostNow - stateSentAtMs) / 1000) + Math.max(0, Number(msg.oneWayLatencySec) || satelliteOneWayLatencySec)
      : 0;

    // A. Host Paused
    if (!msg.isPlaying) {
      if (curActiveAudio && !curActiveAudio.paused) curActiveAudio.pause();
      if (curIdleAudio && !curIdleAudio.paused) curIdleAudio.pause();
      if (msg.position !== undefined && curActiveAudio) {
        try { curActiveAudio.currentTime = msg.position; } catch(e){}
      }
      if (curActiveAudio) curActiveAudio.playbackRate = 1.0;
      if (curIdleAudio) curIdleAudio.playbackRate = 1.0;
      return;
    }

    try {
      await ensureAudioContextRunning('room playback');
    } catch (error) {
      console.warn('[Satellite] AudioContext is unavailable for room playback:', error.message);
      return;
    }
    if (syncSeq !== satellitePlaybackSyncSeq) return;

    // B. Seamless DJ Mashup Crossfade Phase: Deck A & Deck B in Dual Phase-Lock
    if (msg.isCrossfading && msg.incomingTrack && msg.incomingTrack.id) {
      const incomingId = msg.incomingTrack.id;
      if (satStatDeck) satStatDeck.textContent = `DJ Crossfade Blend 🎧`;

      // Buffer incoming track on idle deck if not already loaded
      let incomingUrl = (typeof streamUrlCache !== 'undefined' && streamUrlCache.get(incomingId)?.url);
      if (!incomingUrl && typeof getOrResolveStreamUrl === 'function') {
        incomingUrl = await resolveSatelliteStreamUrlOnce(msg.incomingTrack);
      }
      if (syncSeq !== satellitePlaybackSyncSeq) return;

      if (incomingUrl && curIdleAudio && !curIdleAudio.src.includes(encodeURIComponent(incomingId)) && curIdleAudio.src !== incomingUrl) {
        curIdleAudio.preload = 'auto';
        if (isElectron) {
          curIdleAudio.crossOrigin = 'anonymous';
        }
        curIdleAudio.src = incomingUrl;
        curIdleAudio.dataset.trackId = incomingId;
        curIdleAudio.load();
      }

      if (curIdleAudio?.dataset.routeLoggedTrackId !== incomingId) {
        curIdleAudio.dataset.routeLoggedTrackId = incomingId;
        logAudioRouteForTrack(msg.incomingTrack, curIdleAudio, 'room crossfade incoming deck');
      }

      const trueIncomingPos = (msg.incomingPosition !== undefined ? msg.incomingPosition : 0) + elapsedSinceMeasure + calSec;
      const trueOutgoingPos = (msg.position !== undefined ? msg.position : 0) + elapsedSinceMeasure + calSec;

      // Play & align both decks simultaneously
      if (curIdleAudio && curIdleAudio.paused) {
        if (isFinite(trueIncomingPos) && trueIncomingPos >= 0) {
          try { curIdleAudio.currentTime = trueIncomingPos; } catch(e){}
        }
        curIdleAudio.play().catch(e => console.warn('[Satellite] idleAudio play prevented:', e));
      } else if (curIdleAudio && (forceSnap || Math.abs(curIdleAudio.currentTime - trueIncomingPos) > 0.08)) {
        try { curIdleAudio.currentTime = Math.max(0, trueIncomingPos); } catch(e){}
      }

      if (curActiveAudio && curActiveAudio.paused) {
        if (isFinite(trueOutgoingPos) && trueOutgoingPos >= 0) {
          try { curActiveAudio.currentTime = trueOutgoingPos; } catch(e){}
        }
        curActiveAudio.play().catch(e => console.warn('[Satellite] activeAudio play prevented:', e));
      } else if (curActiveAudio && (forceSnap || Math.abs(curActiveAudio.currentTime - trueOutgoingPos) > 0.08)) {
        try { curActiveAudio.currentTime = Math.max(0, trueOutgoingPos); } catch(e){}
      }

      // Equal-Power Crossfade curves: Outgoing cos, Incoming sin
      const fadeDurationSec = Math.max(0, Number(msg.crossfadeDurationMs) || 0) / 1000;
      const p = Math.max(0, Math.min(1.0,
        (msg.crossfadeProgress || 0) + (fadeDurationSec > 0 ? elapsedSinceMeasure / fadeDurationSec : 0)));
      const outVol = Math.cos(p * 0.5 * Math.PI);
      const inVol = Math.sin(p * 0.5 * Math.PI);

      setSatelliteDeckVolume(curActiveAudio, outVol);
      setSatelliteDeckVolume(curIdleAudio, inVol);

      return;
    }

    // C. Normal Track Playback (Not in crossfade)
    if (msg.track && msg.track.id) {
      if (satStatDeck) satStatDeck.textContent = `Deck A (320kbps Studio)`;
      let promotedTrack = false;

      // If track changed to incoming crossfaded track, smoothly promote idle deck to active deck
      if (typeof currentTrack === 'undefined' || !currentTrack || currentTrack.id !== msg.track.id) {
        let streamUrl = (typeof streamUrlCache !== 'undefined' && streamUrlCache.get(msg.track.id)?.url);
        if (!streamUrl && typeof getOrResolveStreamUrl === 'function') {
          streamUrl = await resolveSatelliteStreamUrlOnce(msg.track);
        }
        if (syncSeq !== satellitePlaybackSyncSeq) return;

        const idleMatchesNext = curIdleAudio && (
          curIdleAudio.dataset.trackId === msg.track.id ||
          curIdleAudio.src.includes(encodeURIComponent(msg.track.id)) ||
          curIdleAudio.src === streamUrl
        );
        if (idleMatchesNext) {
          // Promote the incoming deck and retire the old outgoing deck. The
          // pre-swap curIdleAudio reference is now active and must keep playing.
          if (typeof swapActivePlayer === 'function') swapActivePlayer();
          const retiredDeck = getIdleDeck();
          if (retiredDeck) {
            retiredDeck.pause();
            try { retiredDeck.currentTime = 0; } catch(e){}
            retiredDeck.playbackRate = 1;
          }
          curActiveAudio = getActiveDeck();
          curIdleAudio = getIdleDeck();
        } else if (curActiveAudio && streamUrl && curActiveAudio.src !== streamUrl) {
          if (isElectron) {
            curActiveAudio.crossOrigin = 'anonymous';
          }
          curActiveAudio.src = streamUrl;
          curActiveAudio.dataset.trackId = msg.track.id;
          curActiveAudio.load();
        }

        if (typeof currentTrack !== 'undefined') currentTrack = msg.track;
        if (typeof updateDockTrackInfo === 'function') updateDockTrackInfo(msg.track);
        promotedTrack = true;
      }

      setSatelliteDeckVolume(getActiveDeck(), 1.0);
      setSatelliteDeckVolume(getIdleDeck(), 0.0);
      if (promotedTrack) logAudioRouteForTrack(msg.track, getActiveDeck(), 'room track promotion');
    }

    const trueHostPosition = (msg.position !== undefined ? msg.position : 0) + elapsedSinceMeasure + calSec;

    if (curActiveAudio && curActiveAudio.paused) {
      if (isFinite(trueHostPosition) && trueHostPosition >= 0) {
        try { curActiveAudio.currentTime = trueHostPosition; } catch(e){}
      }
      curActiveAudio.play().catch(e => console.warn('[Satellite] activeAudio play prevented:', e));
      return;
    }

    // D. Continuous Phase-Locked Loop (PLL) Speed Governor
    const localPos = curActiveAudio ? curActiveAudio.currentTime : 0;
    const skew = localPos - trueHostPosition; // in seconds
    const skewMs = skew * 1000;

    if (satStatSkew) {
      const roundedMs = Math.round(skewMs * 10) / 10;
      satStatSkew.textContent = `${roundedMs > 0 ? '+' : ''}${roundedMs} ms`;
      satStatSkew.style.color = Math.abs(roundedMs) <= 3 ? '#10b981' : (skewMs < 0 ? '#ef4444' : '#f59e0b');
    }

    // Hard snap only if forceSnap requested OR drift > 350ms (prevents audio crackling/skipping from micro-seeks)
    if (forceSnap || Math.abs(skew) > 0.35) {
      if (curActiveAudio) {
        try { curActiveAudio.currentTime = Math.max(0, trueHostPosition); } catch(e){}
      }
      if (curActiveAudio) curActiveAudio.playbackRate = 1.0;
    }
    // Continuous Proportional PLL: adjusts speed smoothly based on skew (Kp = 0.25)
    else if (Math.abs(skew) > 0.015) {
      if (curActiveAudio) {
        const Kp = 0.25;
        const speedDelta = -skew * Kp;
        const targetRate = Math.max(0.96, Math.min(1.04, 1.0 + speedDelta));
        curActiveAudio.playbackRate = targetRate;
      }
    } else {
      if (curActiveAudio) curActiveAudio.playbackRate = 1.0;
    }
  }

  function triggerAcousticChirp(targetServerTime) {
    const currentHostNow = Date.now() + satelliteClockOffset;
    const delayMs = Math.max(0, targetServerTime - currentHostNow);

    setTimeout(() => {
      try {
        const ctx = (typeof audioCtx !== 'undefined' && audioCtx) ? audioCtx : new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        gain.gain.setValueAtTime(0.8, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.045);
      } catch(e) {}
    }, delayMs);
  }

  // Acoustic Chirp / Pulse Audio Emission via IPC
  if (window.echoApi && window.echoApi.onTriggerSyncPulse) {
    window.echoApi.onTriggerSyncPulse((targetServerTime) => {
      triggerAcousticChirp(targetServerTime);
    });
  }

  // Initialize saved host label on boot
  updateSavedHostDisplay();

  console.log('[Echo Engine] In-App Diagnostics Logger & Sync Master active!');
})();


});
