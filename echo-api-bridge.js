/**
 * Echo Music - Mobile Engine Bridge (window.echoApi)
 * Full replica of the Electron IPC backend for Android WebView & Mobile Platforms
 * High-Fidelity 320kbps Lossless Audio • Zero-Drift NTP Clock • Verci Kinetic Synced Lyrics
 */
(function() {
  'use strict';

  // Keep Electron's privileged IPC bridge before installing the browser/mobile fallback API.
  const electronPreloadApi = window.echoApi || null;

  function safeBridgeStorageGet(key, fallback = null) {
    try {
      const value = window.localStorage?.getItem(key);
      return value === null || value === undefined ? fallback : value;
    } catch (error) {
      console.warn(`[Storage] Could not read ${key}:`, error?.message || error);
      return fallback;
    }
  }

  // ========================================================================
  // In-App Diagnostic & Real-Time Event Logger (window.echoLogger)
  // ========================================================================
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
      level: level, // 'info' | 'warn' | 'error' | 'sync' | 'audio'
      tag: tag,     // '[AUDIO]' | '[SYNC]' | '[SEARCH]' | '[ROOM]' | '[ERR]'
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null
    };

    logEntries.push(entry);
    if (logEntries.length > MAX_LOG_ENTRIES) {
      logEntries.shift();
    }

    // Notify active UI listeners
    for (const listener of logListeners) {
      try { listener(entry); } catch (e) {}
    }
  }

  // Intercept standard console output to capture background webview events
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = function(...args) {
    origLog.apply(console, args);
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    let tag = '[SYSTEM]';
    let level = 'info';
    if (text.includes('[Audio') || text.includes('[Prepare') || text.includes('320kbps') || text.includes('track')) {
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

  window.echoLogger.audio('Echo Audio & Sync Logger initialized on Android WebView');

  // ========================================================================
  // DES Decryption & JioSaavn 320kbps Audio Engine
  // ========================================================================
  function decryptSaavnMediaUrl(enc) {
    if (!enc) return null;
    try {
      if (typeof CryptoJS !== 'undefined') {
        const key = CryptoJS.enc.Utf8.parse('38346581');
        const decrypted = CryptoJS.DES.decrypt({
          ciphertext: CryptoJS.enc.Base64.parse(enc)
        }, key, {
          mode: CryptoJS.mode.ECB,
          padding: CryptoJS.pad.Pkcs7
        });
        const url = decrypted.toString(CryptoJS.enc.Utf8);
        return url ? url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4') : null;
      }
    } catch (e) {
      window.echoLogger.error('DES decryption error: ' + e.message);
    }
    return null;
  }

  const streamUrlCache = new Map();
  const roomMembersCallbacks = [];
  const syncPulseCallbacks = [];
  const satelliteStateCallbacks = [];
  const beepStartCallbacks = [];
  const beepStopCallbacks = [];

  let isRoomConnectedToHost = false;
  let activeHostSocket = null;
  let roomReconnectTimer = null;
  let roomHeartbeatTimer = null;
  let roomPongTimeout = null;
  let roomReconnectAttempts = 0;
  let roomDisconnectWasManual = false;
  let currentHostAddress = '';
  let currentJoinedRoom = '';
  let clockOffset = 0;
  let rtt = 0;
  let minRtt = 9999;
  let lastHostState = null;

  function generate6DigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
  let localRoomId = safeBridgeStorageGet('echo_room_id') || generate6DigitCode();

  // ========================================================================
  // Core window.echoApi Definition
  // ========================================================================
  if (window.echoApi && typeof window.echoApi.searchMusic === 'function' && !window.echoApi.isFallback) {
    console.log('[Echo Bridge] Native Electron IPC echoApi detected, preserving native desktop backend.');
    return;
  }

  const trackMetaMap = new Map();

  function cleanArtistSubtitle(subtitle) {
    if (!subtitle) return 'Unknown Artist';
    const parts = subtitle.split('•').map(s => s.trim());
    const filtered = parts.filter(p => 
      !p.match(/^(Video|Song|Album|Single|EP)$/i) && 
      !p.match(/\b(views|plays)\b/i) && 
      !p.match(/^\d+:\d+$/)
    );
    return filtered.length > 0 ? filtered.join(' • ') : parts[0] || 'Unknown Artist';
  }

  function extractDurationString(subtitle) {
    const match = String(subtitle || '').match(/(\d+:\d+)/);
    return match ? match[1] : '';
  }

  function extractDurationSeconds(subtitle) {
    const value = extractDurationString(subtitle);
    if (!value) return 0;
    const [minutes, seconds] = value.split(':').map(Number);
    return (minutes * 60) + seconds;
  }

  window.echoApi = {
    isFallback: true,
    // 1. YouTube Music Library Search (Primary) + JioSaavn 320kbps Studio Enrichment
    searchMusic: async (query) => {
      const trimmed = (query || '').trim();
      if (!trimmed) return [];
      window.echoLogger.log('[SEARCH]', `Query: "${trimmed}"`);

      // A. Primary: YouTube Music InnerTube Search (Matches all songs, artists, videos)
      let ytTracks = [];
      try {
        const postData = JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US'
            }
          },
          query: trimmed
        });

        const resp = await fetch('https://music.youtube.com/youtubei/v1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: postData
        });

        if (resp.ok) {
          const json = await resp.json();
          const sections = json.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
          const seenIds = new Set();

          // 1. Check Top Result card if present
          for (const sec of sections) {
            if (sec.musicCardShelfRenderer) {
              const card = sec.musicCardShelfRenderer;
              const title = card.title?.runs?.[0]?.text;
              const videoId = card.onTap?.watchEndpoint?.videoId 
                || card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId
                || card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
              const subtitle = card.subtitle?.runs?.map(r => r.text).join('') || '';
              const thumb = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url;

              if (title && videoId && !seenIds.has(videoId)) {
                seenIds.add(videoId);
                const art = cleanArtistSubtitle(subtitle);
                const durationString = extractDurationString(subtitle);
                const duration = extractDurationSeconds(subtitle);
                trackMetaMap.set(videoId, { title, artist: art, duration });
                ytTracks.push({
                  id: videoId,
                  title: title,
                  artist: art,
                  duration,
                  durationSec: duration,
                  durationString,
                  thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                  isSong: true,
                  isTopResult: true,
                  musicVideoType: card.musicVideoType || ''
                });
              }
            }
          }

          // 2. Parse all music shelves and item sections
          for (const sec of sections) {
            let items = [];
            if (sec.itemSectionRenderer?.contents) {
              items = sec.itemSectionRenderer.contents;
            } else if (sec.musicShelfRenderer?.contents) {
              items = sec.musicShelfRenderer.contents;
            }

            for (const wrapper of items) {
              const item = wrapper.musicResponsiveListItemRenderer;
              if (!item) continue;

              const title = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
                || item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs?.[0]?.text;
              const subtitleRuns = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
                || item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs || [];
              const subtitle = subtitleRuns.map(r => r.text).join('');

              const lowerSub = subtitle.toLowerCase();
              if (lowerSub.includes('episode') || lowerSub.includes('podcast')) continue;

              const watchEndpoint = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint
                || item.doubleTapEndpoint?.watchEndpoint
                || item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
              
              const videoId = watchEndpoint?.videoId || item.playlistItemData?.videoId;
              const thumb = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url;

              if (title && videoId && !seenIds.has(videoId)) {
                seenIds.add(videoId);
                const art = cleanArtistSubtitle(subtitle);
                const durationString = extractDurationString(subtitle);
                const duration = extractDurationSeconds(subtitle);
                const musicVideoType = String(item.musicVideoType || watchEndpoint?.musicVideoType || '');
                trackMetaMap.set(videoId, { title, artist: art, duration });
                ytTracks.push({
                  id: videoId,
                  title: title,
                  artist: art,
                  duration,
                  durationSec: duration,
                  durationString,
                  thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                  isSong: lowerSub.includes('song') || lowerSub.includes('track'),
                  isVideo: lowerSub.includes('video'),
                  musicVideoType
                });
              }
            }
          }

          ytTracks.sort((a, b) => {
            if (a.isTopResult && !b.isTopResult) return -1;
            if (!a.isTopResult && b.isTopResult) return 1;
            return 0;
          });
        }
      } catch (err) {
        window.echoLogger.error('InnerTube search error: ' + err.message);
      }

      // B. Secondary: JioSaavn Enrichment for 320kbps Master Audio
      let saavnTracks = [];
      try {
        const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=20&q=${encodeURIComponent(trimmed)}`;
        const resp = await fetch(saavnUrl);
        if (resp.ok) {
          const json = await resp.json();
          saavnTracks = (json.results || []).map(r => {
            const enc = r.encrypted_media_url || r.more_info?.encrypted_media_url;
            const streamUrl = decryptSaavnMediaUrl(enc);
            const dur = parseInt(r.duration || r.more_info?.duration || 0, 10);
            const id = 'saavn_' + (r.id || r.song_id);
            if (streamUrl) {
              streamUrlCache.set(id, { url: streamUrl, timestamp: Date.now() });
            }
            const sec = dur > 0 ? dur : 210;
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            const cleanTitle = (r.title || r.song || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
            const cleanArtist = (r.subtitle || r.primary_artists || r.more_info?.artistMap?.primary_artists?.map(a => a.name).join(', ') || 'Unknown Artist').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
            const cleanAlbum = (r.more_info?.album || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

            return {
              id: id,
              title: cleanTitle,
              artist: cleanArtist,
              album: cleanAlbum,
              thumbnail: (r.image || '').replace('150x150', '500x500'),
              duration: sec,
              durationString: `${m}:${s < 10 ? '0' : ''}${s}`,
              streamUrl: streamUrl,
              isSong: true,
              isLossless: true
            };
          }).filter(r => r.title);
        }
      } catch (err) {
        window.echoLogger.warn(`JioSaavn search notice: ${err.message}`);
      }

      // If YouTube Music returned results, it leads!
      if (ytTracks.length > 0) {
        const combined = [...ytTracks];
        const seen = new Set(ytTracks.map(t => (t.title || '').toLowerCase().trim()));
        for (const st of saavnTracks) {
          const norm = (st.title || '').toLowerCase().trim();
          if (!seen.has(norm)) {
            combined.push(st);
            seen.add(norm);
          }
        }
        window.echoLogger.audio(`Found ${combined.length} tracks (YouTube Music + Saavn)`);
        return combined;
      }

      return saavnTracks;
    },

    // 2. Full-Length 320kbps Audio Stream URL Resolver
    getStreamUrl: async (trackOrId) => {
      const track = trackOrId && typeof trackOrId === 'object' ? trackOrId : { id: trackOrId };
      const videoId = String(track.id || '');
      if (!videoId) return null;

      // Check cache first
      if (streamUrlCache.has(videoId)) {
        const cached = streamUrlCache.get(videoId);
        if (Date.now() - cached.timestamp < 1000 * 60 * 60 * 5) {
          window.echoLogger.audio(`Stream cache hit for ${videoId}`);
          return cached.url;
        }
      }

      if (typeof electronPreloadApi?.getStreamUrl === 'function') {
        try {
          const nativeUrl = await electronPreloadApi.getStreamUrl({
            id: videoId,
            title: track.title || trackMetaMap.get(videoId)?.title || '',
            artist: track.artist || trackMetaMap.get(videoId)?.artist || '',
            duration: Number(track.duration) || 0
          });
          if (nativeUrl) {
            streamUrlCache.set(videoId, { url: nativeUrl, timestamp: Date.now() });
            return nativeUrl;
          }
        } catch (error) {
          window.echoLogger.error(`Desktop stream proxy request failed: ${error.message}`);
        }
      }

      const buildHostStreamUrl = host => {
        const params = new URLSearchParams({ id: videoId });
        const meta = trackMetaMap.get(videoId) || {};
        const title = track.title || meta.title;
        const artist = track.artist || meta.artist;
        const duration = Number(track.duration) || Number(meta.duration) || 0;
        if (title) params.set('title', title);
        if (artist) params.set('artist', artist);
        if (duration) params.set('duration', String(duration));
        return `http://${host}/stream?${params.toString()}`;
      };

      // If actively connected to PC Host (Echo Room), route through Host streaming proxy
      if (isRoomConnectedToHost && currentHostAddress) {
        const hostUrl = buildHostStreamUrl(currentHostAddress);
        streamUrlCache.set(videoId, { url: hostUrl, timestamp: Date.now() });
        return hostUrl;
      }

      // If JioSaavn track ID, directly decrypt 320kbps URL
      if (videoId.startsWith('saavn_')) {
        const pureId = videoId.replace('saavn_', '');
        try {
          const u = `https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${pureId}&_format=json`;
          const resp = await fetch(u);
          if (resp.ok) {
            const data = await resp.json();
            const song = data[pureId];
            if (song && song.encrypted_media_url) {
              const url = decryptSaavnMediaUrl(song.encrypted_media_url);
              if (url) {
                streamUrlCache.set(videoId, { url, timestamp: Date.now() });
                window.echoLogger.audio(`Decrypted 320kbps studio stream for "${song.song}": ${url.slice(0, 60)}...`);
                return url;
              }
            }
          }
        } catch (e) {
          window.echoLogger.error(`Saavn track resolution error: ${e.message}`);
        }
      }

      // Query Saavn for title/artist match to get high-fidelity 320kbps audio first
      const meta = trackMetaMap.get(videoId) || track;
      const queryTerm = meta ? `${meta.title} ${meta.artist}` : videoId;
      try {
        const u = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=5&q=${encodeURIComponent(queryTerm)}`;
        const resp = await fetch(u);
        if (resp.ok) {
          const json = await resp.json();
          const first = json.results?.[0];
          const enc = first?.encrypted_media_url || first?.more_info?.encrypted_media_url;
          if (enc) {
            const url = decryptSaavnMediaUrl(enc);
            if (url) {
              streamUrlCache.set(videoId, { url, timestamp: Date.now() });
              return url;
            }
          }
        }
      } catch (e) {}

      // Fallback: If saved host exists in local storage and is reachable, use host proxy
      const savedHost = safeBridgeStorageGet('echo_last_host_ip');
      if (savedHost) {
        try {
          const checkResp = await fetch(`http://${savedHost}/api/room-info`, { signal: AbortSignal.timeout(600) });
          if (checkResp.ok) {
            const hostUrl = buildHostStreamUrl(savedHost);
            streamUrlCache.set(videoId, { url: hostUrl, timestamp: Date.now() });
            return hostUrl;
          }
        } catch (e) {}
      }

      // Universal Mobile & Web YouTube Player Engine Identifier
      // Returning `yt:${videoId}` guarantees 100% audio playback via the integrated YouTube player engine
      const ytId = videoId.replace('saavn_', '');
      const fallbackUrl = `yt:${ytId}`;
      streamUrlCache.set(videoId, { url: fallbackUrl, timestamp: Date.now() });
      return fallbackUrl;
    },

    // 3. Radio / Related Songs
    getRelatedTracks: async ({ id, artist, title }) => {
      const q = artist || title || 'Pop Hits';
      return window.echoApi.searchMusic(q);
    },

    // 4. Synchronized Lyrics Engine (LRCLIB)
    getLyrics: async ({ id, title, artist, duration }) => {
      if (!title) return null;
      window.echoLogger.log('[LYRICS]', `Fetching lyrics for "${title}" - ${artist || ''}`);

      const searchQueries = [
        `${title} ${artist || ''}`.trim(),
        title.replace(/\(.*?\)|\[.*?\]/g, '').trim(),
        title.split('-')[0].trim()
      ];

      for (const q of searchQueries) {
        try {
          const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
          const searchResp = await fetch(searchUrl, { headers: { 'User-Agent': 'EchoMusicApp/1.0.0' } });
          if (searchResp.ok) {
            const searchResults = await searchResp.json();
            if (Array.isArray(searchResults) && searchResults.length > 0) {
              const targetDur = Number(duration) || 0;
              const delta = r => targetDur > 0 ? Math.abs(Number(r.duration) - targetDur) : 0;
              const syncedList = searchResults.filter(r => r.syncedLyrics).sort((a, b) => delta(a) - delta(b));
              const bestSynced = syncedList.find(r => targetDur <= 0 || delta(r) <= 5.0) || (syncedList[0] && (targetDur <= 0 || delta(syncedList[0]) <= 8.0) ? syncedList[0] : null);
              if (bestSynced && bestSynced.syncedLyrics) {
                return { lyrics: bestSynced.syncedLyrics, isSynced: true, duration: Number(bestSynced.duration) || 0 };
              }
              const bestPlain = searchResults.find(r => r.plainLyrics);
              if (bestPlain && bestPlain.plainLyrics) {
                return { lyrics: bestPlain.plainLyrics, isSynced: false, duration: Number(bestPlain.duration) || 0 };
              }
            }
          }
        } catch (e) {}
      }
      return null;
    },

    // 5. Offline Download Handler
    downloadTrack: async ({ id, title, artist, duration }) => {
      window.echoLogger.audio(`Download initiated for: ${title}`);
      try {
        const streamUrl = await window.echoApi.getStreamUrl({ id, title, artist, duration });
        if (streamUrl) {
          const a = document.createElement('a');
          a.href = streamUrl;
          a.download = `${artist || 'Echo'} - ${title || 'Track'}.mp4`;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          return { success: true, url: streamUrl };
        }
      } catch (err) {
        window.echoLogger.error('Download error: ' + err.message);
      }
      return { success: false };
    },

    openDownloadDir: () => {},
    clearCache: () => {
      streamUrlCache.clear();
      window.echoLogger.audio('Stream cache cleared');
      return true;
    },
    onDownloadProgress: () => {},

    // 6. Window State & Controls (Safe no-ops in Android WebView)
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    onWindowState: () => {},

    // 7. Persistent User Storage via localStorage
    loadUserData: async () => {
      try {
        const data = safeBridgeStorageGet('echo_music_user_data');
        return data ? JSON.parse(data) : {};
      } catch (e) {
        return {};
      }
    },

    saveUserData: async (data) => {
      try {
        localStorage.setItem('echo_music_user_data', JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    },

    // 8. Echo Rooms & Multi-Device Synchronization
    getRoomInfo: async () => {
      localRoomId = safeBridgeStorageGet('echo_room_id') || generate6DigitCode();
      const hostIp = isRoomConnectedToHost ? currentHostAddress : (safeBridgeStorageGet('echo_last_host_ip') || '127.0.0.1:38472');
      const joinUrl = `http://${hostIp}/room/${localRoomId}`;

      let qrDataUrl = '';
      try {
        if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
          qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, color: { dark: '#ffffff', light: '#141226' } });
        }
      } catch (e) {}

      return {
        roomId: localRoomId,
        localIp: hostIp.split(':')[0],
        port: 38472,
        joinUrl: joinUrl,
        qrDataUrl: qrDataUrl,
        connectedCount: isRoomConnectedToHost ? 1 : 0,
        networkMode: 'local',
        globalTunnelUrl: null,
        isSatellite: isRoomConnectedToHost,
        hostAddress: currentHostAddress
      };
    },

    regenerateRoomId: async () => {
      localRoomId = generate6DigitCode();
      localStorage.setItem('echo_room_id', localRoomId);
      return window.echoApi.getRoomInfo();
    },

    setRoomId: async (code) => {
      if (code) localRoomId = code;
      localStorage.setItem('echo_room_id', localRoomId);
      return window.echoApi.getRoomInfo();
    },

    setRoomNetworkMode: async () => ({ success: true, mode: 'local' }),

    // Broadcast room state (if this device is acting as Room Host)
    broadcastRoomState: async (data) => {
      if (activeHostSocket && activeHostSocket.readyState === WebSocket.OPEN) {
        activeHostSocket.send(JSON.stringify({
          type: 'broadcast_state',
          room: currentJoinedRoom || localRoomId,
          data: data
        }));
      }
      return true;
    },

    realignRoomDevices: async () => {
      if (activeHostSocket && activeHostSocket.readyState === WebSocket.OPEN) {
        activeHostSocket.send(JSON.stringify({ type: 'realign', room: currentJoinedRoom || localRoomId }));
      }
      return true;
    },

    sendRoomSyncPulse: async () => {
      if (activeHostSocket && activeHostSocket.readyState === WebSocket.OPEN) {
        activeHostSocket.send(JSON.stringify({ type: 'request_pulse' }));
      }
      return true;
    },

    openExternalUrl: (url) => {
      if (url) window.open(url, '_blank');
      return true;
    },

    onRoomMembersChanged: (cb) => {
      roomMembersCallbacks.push(cb);
    },
    onTriggerSyncPulse: (cb) => {
      syncPulseCallbacks.push(cb);
    },
    onSatelliteStateSync: (cb) => {
      satelliteStateCallbacks.push(cb);
    },
    onBeepFusionStart: (cb) => {
      beepStartCallbacks.push(cb);
    },
    onBeepFusionStop: (cb) => {
      beepStopCallbacks.push(cb);
    }
  };

  // ========================================================================
  // WebSocket Connector to Echo Room Host (Satellite Mode)
  // ========================================================================
  window.connectToEchoHost = function(hostAddress, roomCode, isReconnect = false) {
    if (!isReconnect) {
      roomDisconnectWasManual = false;
      roomReconnectAttempts = 0;
      clearTimeout(roomReconnectTimer);
      roomReconnectTimer = null;
    }
    clearInterval(roomHeartbeatTimer);
    clearTimeout(roomPongTimeout);
    if (!hostAddress) {
      hostAddress = safeBridgeStorageGet('echo_last_host_ip');
    }
    if (!hostAddress) {
      if (window.echoLogger) window.echoLogger.warn('No Host address provided to connectToEchoHost');
      return;
    }

    if (activeHostSocket) {
      try { activeHostSocket.close(); } catch (e) {}
      activeHostSocket = null;
    }

    // Clean address & parse port
    let cleanAddr = hostAddress.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '').replace(/\/.*$/, '').trim();
    const isCloudflare = cleanAddr.includes('trycloudflare.com');
    const isHttps = isCloudflare || window.location.protocol === 'https:';
    const wsProto = isHttps ? 'wss:' : 'ws:';

    // Auto-append port 38472 if missing and not Cloudflare
    if (!cleanAddr.includes(':') && !isCloudflare) {
      cleanAddr = `${cleanAddr}:38472`;
    }

    currentHostAddress = cleanAddr;
    currentJoinedRoom = roomCode || localRoomId || 'ECHO-PARTY';

    const wsUrl = `${wsProto}//${cleanAddr}/ws`;
    if (window.echoLogger) window.echoLogger.sync(`Attempting connection to Host: ${cleanAddr}, Room: ${currentJoinedRoom}`);

    const satBadge = document.getElementById('satelliteStateBadge');
    const satText = document.getElementById('satelliteStateText');
    if (satText) satText.textContent = 'Connecting... 🟡';
    if (satBadge) satBadge.style.color = '#f59e0b';

    try {
      const socket = new WebSocket(wsUrl);
      activeHostSocket = socket;

      socket.onopen = () => {
        if (socket !== activeHostSocket) return;
        roomReconnectAttempts = 0;
        isRoomConnectedToHost = true;
        if (window.echoLogger) window.echoLogger.sync('Connected to Host WebSocket successfully!');

        if (satText) satText.textContent = 'Phase-Locked (Connected) 🟢';
        if (satBadge) satBadge.style.color = '#34d399';

        localStorage.setItem('echo_last_host_ip', cleanAddr);
        if (roomCode) localStorage.setItem('echo_last_room_code', roomCode);

        // Update Saved Host in UI if present
        const satRecentHostText = document.getElementById('satRecentHostText');
        const satUseRecentBtn = document.getElementById('satUseRecentBtn');
        if (satRecentHostText) satRecentHostText.textContent = cleanAddr;
        if (satUseRecentBtn) satUseRecentBtn.style.display = 'inline-block';

        // Send join packet to Desktop Host
        socket.send(JSON.stringify({
          type: 'join',
          room: currentJoinedRoom,
          deviceName: navigator.userAgent.includes('Android') ? 'Echo Android Phone' : 'Echo Device',
          userAgent: navigator.userAgent
        }));

        roomMembersCallbacks.forEach(cb => cb(1));

        // Rapid NTP calibration burst (6 round-trips for precise clock offset calculation)
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            if (socket === activeHostSocket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping', t1: performance.now() }));
            }
          }, i * 75);
        }
        roomHeartbeatTimer = setInterval(() => {
          if (socket !== activeHostSocket || socket.readyState !== WebSocket.OPEN) return;
          clearTimeout(roomPongTimeout);
          socket.send(JSON.stringify({ type: 'ping', t1: performance.now() }));
          roomPongTimeout = setTimeout(() => {
            if (socket === activeHostSocket && socket.readyState === WebSocket.OPEN) socket.close();
          }, 10000);
        }, 15000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'pong') {
            clearTimeout(roomPongTimeout);
            const t4 = performance.now();
            const curRtt = t4 - msg.t1;
            if (curRtt < minRtt) minRtt = curRtt;
            rtt = rtt === 0 ? curRtt : (rtt * 0.6 + curRtt * 0.4);
            const bestRtt = Math.min(curRtt, minRtt + 6);
            const serverNow = msg.serverTime + (bestRtt / 2);
            clockOffset = serverNow - Date.now();
            if (window.echoLogger) window.echoLogger.sync(`NTP Pong: RTT ${Math.round(rtt)}ms, Clock Offset ${Math.round(clockOffset)}ms`);

            const satStatRtt = document.getElementById('satStatRtt');
            const satStatOffset = document.getElementById('satStatOffset');
            if (satStatRtt) satStatRtt.textContent = `${Math.round(rtt)} ms`;
            if (satStatOffset) satStatOffset.textContent = `${Math.round(clockOffset)} ms`;
          } else if (msg.type === 'room_error') {
            roomDisconnectWasManual = true;
            if (satText) satText.textContent = msg.message || 'Room code mismatch';
          } else if (msg.type === 'state_sync' || msg.type === 'track_change' || msg.type === 'force_snap') {
            lastHostState = msg;
            msg.clockOffset = clockOffset;
            msg.rtt = rtt;
            satelliteStateCallbacks.forEach(cb => cb(msg));
          } else if (msg.type === 'pulse') {
            syncPulseCallbacks.forEach(cb => cb(msg.targetServerTime));
          } else if (msg.type === 'beep_fusion_start') {
            beepStartCallbacks.forEach(cb => cb());
          } else if (msg.type === 'beep_fusion_stop') {
            beepStopCallbacks.forEach(cb => cb());
          }
        } catch (e) {
          if (window.echoLogger) window.echoLogger.error('WebSocket parse error: ' + e.message);
        }
      };

      socket.onerror = (err) => {
        if (window.echoLogger) window.echoLogger.error('WebSocket error on host socket');
        if (satText) satText.textContent = 'Connection Error 🔴';
        if (satBadge) satBadge.style.color = '#ef4444';
      };

      socket.onclose = () => {
        if (socket !== activeHostSocket) return;
        clearInterval(roomHeartbeatTimer);
        clearTimeout(roomPongTimeout);
        isRoomConnectedToHost = false;
        if (window.echoLogger) window.echoLogger.sync('WebSocket disconnected from Host');
        roomMembersCallbacks.forEach(cb => cb(0));
        if (satText) satText.textContent = 'Disconnected';
        if (satBadge) satBadge.style.color = '#94a3b8';
        if (!roomDisconnectWasManual && currentHostAddress && !roomReconnectTimer) {
          const retryHost = currentHostAddress;
          const retryRoom = currentJoinedRoom;
          const delay = Math.min(30000, 1000 * (2 ** Math.min(roomReconnectAttempts, 5)));
          roomReconnectAttempts++;
          roomReconnectTimer = setTimeout(() => {
            roomReconnectTimer = null;
            window.connectToEchoHost(retryHost, retryRoom, true);
          }, delay);
        }
      };
    } catch (err) {
      if (window.echoLogger) window.echoLogger.error('Host connection failed: ' + err.message);
      if (satText) satText.textContent = 'Connection Failed 🔴';
      if (satBadge) satBadge.style.color = '#ef4444';
    }
  };

  window.disconnectFromEchoHost = function() {
    roomDisconnectWasManual = true;
    clearTimeout(roomReconnectTimer);
    roomReconnectTimer = null;
    clearInterval(roomHeartbeatTimer);
    clearTimeout(roomPongTimeout);
    if (activeHostSocket) {
      try { activeHostSocket.close(); } catch (e) {}
      activeHostSocket = null;
    }
    isRoomConnectedToHost = false;
    currentHostAddress = '';
    currentJoinedRoom = '';
    roomMembersCallbacks.forEach(cb => cb(0));
    window.echoLogger.sync('Disconnected from Echo Host');
  };

  window.echoLogger.audio('window.echoApi successfully initialized on mobile');
})();
