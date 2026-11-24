const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const CryptoJS = require('crypto-js');
const { randomBytes, timingSafeEqual, createECDH, createDecipheriv, hkdfSync } = require('crypto');

const firebaseConfigPath = path.join(__dirname, 'firebase-hosting', 'firebase-config.json');
let firebaseWebConfig = null;
try {
  firebaseWebConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
} catch (e) {
  console.warn('[Firebase Auth] Web app config is not available yet.');
}

const firebaseHostingOrigin = 'https://melopair.web.app';
const firebaseSessionFile = () => path.join(app.getPath('userData'), 'firebase-session.enc');
const firebasePendingLoginFile = () => path.join(app.getPath('userData'), 'firebase-pending-login.enc');
let pendingFirebaseLogin = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const authUrl = argv.find(arg => /^echoplayer:\/\/auth(?:[/?#]|$)/i.test(arg));
    if (authUrl) void handleFirebaseAuthProtocol(authUrl);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  void handleFirebaseAuthProtocol(url);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  try {
    const logPath = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${err.stack || err}\n`);
  } catch (e) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

function decryptSaavnMediaUrl(enc) {
  if (!enc) return null;
  try {
    const key = CryptoJS.enc.Utf8.parse('38346581');
    const decrypted = CryptoJS.DES.decrypt({
      ciphertext: CryptoJS.enc.Base64.parse(enc)
    }, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    });
    const url = decrypted.toString(CryptoJS.enc.Utf8);
    return url ? url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4') : null;
  } catch (e) {
    return null;
  }
}

function searchSaavn(query) {
  return new Promise((resolve) => {
    const u = 'https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=1&n=25&q=' + encodeURIComponent(query);
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          const results = (j.results || []).map(r => {
            const enc = r.encrypted_media_url || r.more_info?.encrypted_media_url;
            const streamUrl = decryptSaavnMediaUrl(enc);
            const dur = parseInt(r.duration || r.more_info?.duration || 0, 10);
            const id = 'saavn_' + (r.id || r.song_id);
            if (streamUrl) {
              streamCache.set(id, {
                url: streamUrl,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.jiosaavn.com/' },
                source: 'saavn',
                timestamp: Date.now()
              });
            }
            const sec = dur > 0 ? dur : 210;
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return {
              id: id,
              title: (r.title || r.song || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'),
              artist: (r.subtitle || r.primary_artists || r.more_info?.artistMap?.primary_artists?.map(a => a.name).join(', ') || 'Unknown Artist').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'),
              album: (r.more_info?.album || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'),
              thumbnail: (r.image || '').replace('150x150', '500x500'),
              duration: sec,
              durationString: `${m}:${s < 10 ? '0' : ''}${s}`,
              streamUrl: streamUrl,
              isSong: true,
              isLossless: true
            };
          }).filter(r => r.title);
          resolve(results);
        } catch(e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

function resolveSaavnTrack(songId) {
  const pureId = songId.replace('saavn_', '');
  return new Promise((resolve) => {
    const u = `https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${pureId}&_format=json`;
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          const song = j[pureId];
          if (song && song.encrypted_media_url) {
            const url = decryptSaavnMediaUrl(song.encrypted_media_url);
            if (url) {
              streamCache.set(songId, {
                url,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.jiosaavn.com/' },
                source: 'saavn',
                timestamp: Date.now()
              });
              return resolve(url);
            }
          }
        } catch(e) {}
        resolve(null);
      });
    }).on('error', () => resolve(null));
  });
}

let mainWindow = null;
// Keep the production default stable; allow a side-by-side dev instance when
// the installed MeloPair app is already using the usual local proxy port.
let proxyPort = Number(process.env.MELOPAIR_PROXY_PORT) || 38472;
const streamCache = new Map();

// Echo Rooms / Party Sync State
function generate6DigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
let currentRoomId = generate6DigitCode();
let currentRoomTrack = null;
let currentRoomIsPlaying = false;
let currentRoomPosition = 0;
let currentRoomLyrics = [];
let currentRoomOutputLatencyMs = 0;
let currentRoomCrossfadeDurationMs = 0;
let currentRoomNextTrack = null;
let currentRoomIncomingTrack = null;
let currentRoomIncomingPosition = 0;
let currentRoomIsCrossfading = false;
let currentRoomCrossfadeProgress = 0;
let currentRoomStateAt = Date.now();

let roomPlaybackSequenceId = 0;
let roomPlaybackState = {
  roomCode: currentRoomId,
  hostConnected: true,
  track: null,
  streamUrl: null,
  trackId: null,
  isPlaying: false,
  positionSec: 0,
  hostSentAtMs: Date.now(),
  updatedAtMs: Date.now(),
  sequenceId: 0
};
let latestRoomState = roomPlaybackState;

const connectedClients = new Set();
let wss = null;
let roomSyncTickTimer = null;

function sanitizeFirebaseProfile(user) {
  if (!user || typeof user !== 'object') return null;
  return {
    uid: String(user.localId || user.uid || '').slice(0, 160),
    email: String(user.email || '').slice(0, 320),
    displayName: String(user.displayName || user.name || '').slice(0, 160),
    photoURL: String(user.photoUrl || user.photoURL || '').slice(0, 2048)
  };
}

async function saveFirebaseSession(session) {
  if (!safeStorage.isAsyncEncryptionAvailable || !(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Secure sign-in storage is unavailable on this computer.');
  }
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(session));
  const destination = firebaseSessionFile();
  const temporary = `${destination}.tmp`;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(temporary, encrypted, { mode: 0o600 });
  await fs.promises.rename(temporary, destination);
}

async function readFirebaseSession() {
  try {
    if (!safeStorage.isAsyncEncryptionAvailable || !(await safeStorage.isAsyncEncryptionAvailable())) return null;
    const encrypted = await fs.promises.readFile(firebaseSessionFile());
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    return JSON.parse(decrypted.result);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[Firebase Auth] Could not read the protected session:', e.message);
    return null;
  }
}

async function clearFirebaseSession() {
  try { await fs.promises.unlink(firebaseSessionFile()); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

async function savePendingFirebaseLogin(pending) {
  if (!safeStorage.isAsyncEncryptionAvailable || !(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Secure sign-in storage is unavailable on this computer.');
  }
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(pending));
  const destination = firebasePendingLoginFile();
  const temporary = `${destination}.tmp`;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(temporary, encrypted, { mode: 0o600 });
  await fs.promises.rename(temporary, destination);
}

async function readPendingFirebaseLogin() {
  try {
    if (!safeStorage.isAsyncEncryptionAvailable || !(await safeStorage.isAsyncEncryptionAvailable())) return null;
    const encrypted = await fs.promises.readFile(firebasePendingLoginFile());
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const pending = JSON.parse(decrypted.result);
    return pending && typeof pending.state === 'string' && Number.isFinite(pending.createdAt) ? pending : null;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Firebase Auth] Could not read the protected sign-in request:', error.message);
    return null;
  }
}

async function clearPendingFirebaseLogin() {
  try { await fs.promises.unlink(firebasePendingLoginFile()); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function refreshFirebaseSession(session) {
  if (!firebaseWebConfig?.apiKey || !session?.refreshToken) return null;
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorCode = String(data?.error?.message || '');
    if (/INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND/i.test(errorCode)) {
      await clearFirebaseSession();
      return null;
    }
    return { profile: session.profile || null, offline: true };
  }

  const lookupResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: data.id_token })
  });
  const lookup = await lookupResponse.json().catch(() => ({}));
  const user = Array.isArray(lookup.users) ? lookup.users[0] : null;
  if (!lookupResponse.ok || !user) return { profile: session.profile || null, offline: true };

  const profile = sanitizeFirebaseProfile(user);
  await saveFirebaseSession({ refreshToken: data.refresh_token || session.refreshToken, profile, idToken: data.id_token });
  return { profile: { ...profile, idToken: data.id_token }, offline: false };
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64');
}

async function acceptFirebaseSession(idToken, refreshToken) {
  if (!firebaseWebConfig?.apiKey) throw new Error('Firebase Web app configuration is missing.');
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000 ||
      typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 4096) {
    throw new Error('Firebase returned an incomplete sign-in session. Please try again.');
  }
  const lookupResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  const lookup = await lookupResponse.json().catch(() => ({}));
  const user = Array.isArray(lookup.users) ? lookup.users[0] : null;
  if (!lookupResponse.ok || !user) {
    const errorCode = String(lookup?.error?.message || `HTTP_${lookupResponse.status}`).split(/[ :]/, 1)[0].replace(/[^A-Z0-9_]/gi, '').slice(0, 48);
    console.error('[Firebase Auth] Firebase session verification failed:', { status: lookupResponse.status, code: errorCode });
    throw new Error(`Firebase could not verify the signed-in account (${errorCode || 'UNKNOWN'}). Please sign in again.`);
  }

  const profile = sanitizeFirebaseProfile(user);
  await saveFirebaseSession({ refreshToken, profile, idToken });
  return { ...profile, idToken };
}

async function handleFirebaseAuthProtocol(rawUrl) {
  let authUrl;
  try { authUrl = new URL(rawUrl); } catch (e) { return false; }
  if (authUrl.protocol !== 'echoplayer:' || authUrl.hostname !== 'auth') return false;

  const state = authUrl.searchParams.get('state') || '';
  const publicKey = decodeBase64Url(authUrl.searchParams.get('pub') || '');
  const iv = decodeBase64Url(authUrl.searchParams.get('iv') || '');
  const encryptedPayload = decodeBase64Url(authUrl.searchParams.get('data') || '');
  const pending = pendingFirebaseLogin || await readPendingFirebaseLogin();
  const expectedState = pending?.state || '';
  const receivedBuffer = Buffer.from(state);
  const expectedBuffer = Buffer.from(expectedState);
  const isValidState = expectedState && receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  const isFresh = pending && Date.now() - pending.createdAt < 10 * 60 * 1000;
  pendingFirebaseLogin = null;
  await clearPendingFirebaseLogin().catch(error => console.warn('[Firebase Auth] Could not clear the pending sign-in request:', error.message));

  if (!isValidState || !isFresh || publicKey.length !== 65 || iv.length !== 12 || encryptedPayload.length < 40 || encryptedPayload.length > 12000 || !pending?.privateKey) {
    const handoffState = {
      hasPendingRequest: Boolean(pending),
      stateMatches: Boolean(isValidState),
      requestFresh: Boolean(isFresh),
      hasPrivateKey: Boolean(pending?.privateKey),
      publicKeyBytes: publicKey.length,
      ivBytes: iv.length,
      encryptedBytes: encryptedPayload.length
    };
    console.warn('[Firebase Auth] Sign-in callback did not match the pending desktop request:', handoffState);
    try {
      const logPath = path.join(app.getPath('userData'), 'firebase-auth.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Callback rejected: ${JSON.stringify(handoffState)}\n`);
    } catch (logError) {
      console.warn('[Firebase Auth] Could not write callback diagnostics:', logError.message);
    }
    const message = !isValidState || !pending?.privateKey
      ? 'The sign-in page and app did not match. Close the sign-in tab and start again from the latest MeloPair app.'
      : !isFresh
        ? 'This sign-in took too long and expired. Start again from MeloPair.'
        : 'The sign-in page was out of date. Close it and start again from MeloPair.';
    mainWindow?.webContents.send('firebase-auth-result', { success: false, message });
    return true;
  }

  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(decodeBase64Url(pending.privateKey));
    const sharedSecret = ecdh.computeSecret(publicKey);
    const key = Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.from(state), Buffer.from('MeloPair Firebase sign-in v1'), 32));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(encryptedPayload.subarray(encryptedPayload.length - 16));
    const plaintext = Buffer.concat([
      decipher.update(encryptedPayload.subarray(0, encryptedPayload.length - 16)),
      decipher.final()
    ]).toString('utf8');
    const session = JSON.parse(plaintext);
    const profile = await acceptFirebaseSession(session.idToken, session.refreshToken);
    mainWindow?.webContents.send('firebase-auth-result', { success: true, user: profile });
  } catch (error) {
    console.error('[Firebase Auth] Secure sign-in handoff failed:', error.message);
    mainWindow?.webContents.send('firebase-auth-result', { success: false, message: error.message || 'Google sign-in failed.' });
  }
  return true;
}

function getLocalIpAddress() {
  return getLanIpv4Addresses()[0] || '127.0.0.1';
}

function getLanIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const iface of entries || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.') && !addresses.includes(iface.address)) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function getRoomAddressInfo(roomId = currentRoomId) {
  const lanAddresses = getLanIpv4Addresses();
  const localIp = lanAddresses[0] || '127.0.0.1';
  const lanJoinUrl = `http://${localIp}:${proxyPort}/room/${roomId}`;
  const tunnelJoinUrl = globalTunnelUrl ? `${globalTunnelUrl}/room/${roomId}` : null;
  const melopairDeepLink = `melopair://room/${roomId}`;
  return {
    localIp,
    lanAddresses,
    lanJoinUrl,
    tunnelJoinUrl,
    melopairDeepLink,
    joinUrl: melopairDeepLink
  };
}

const FIREBASE_RTDB_BASE = 'https://orbit-57cd6-default-rtdb.firebaseio.com';
let lastFirebaseSyncTime = 0;

function syncRoomMetaToFirebaseRtdb(roomId) {
  if (!roomId) return;
  try {
    const metaPayload = JSON.stringify({
      hostUid: 'windows_desktop_host',
      hostName: 'Echo Desktop (Windows)',
      createdAt: { '.sv': 'timestamp' },
      active: true
    });
    const url = new URL(`${FIREBASE_RTDB_BASE}/rooms/${roomId}/meta.json`);
    const req = https.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(metaPayload)
      },
      timeout: 3000
    }, (res) => { res.resume(); });
    req.on('error', () => {});
    req.write(metaPayload);
    req.end();

    const memberPayload = JSON.stringify({
      name: 'Echo Desktop (Windows)',
      platform: 'windows',
      joinedAt: { '.sv': 'timestamp' }
    });
    const memUrl = new URL(`${FIREBASE_RTDB_BASE}/rooms/${roomId}/members/windows_desktop_host.json`);
    const memReq = https.request(memUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(memberPayload)
      },
      timeout: 3000
    }, (res) => { res.resume(); });
    memReq.on('error', () => {});
    memReq.write(memberPayload);
    memReq.end();
  } catch (err) {
    // Non-blocking
  }
}

function syncRoomStateToFirebaseRtdb(roomId, data, force = false) {
  if (!roomId) return;
  const now = Date.now();
  if (!force && now - lastFirebaseSyncTime < 800) return;
  lastFirebaseSyncTime = now;

  try {
    const track = data.track || null;
    const isPlaying = Boolean(data.isPlaying);
    const positionSec = Number(data.positionSec != null ? data.positionSec : data.position) || 0;

    const payload = JSON.stringify({
      trackId: track ? String(track.id || track.videoId || '') : '',
      title: track ? String(track.title || '') : '',
      artist: track ? String(track.artist || 'Artist') : '',
      thumbnail: track ? String(track.artwork || track.thumbnail || '') : '',
      source: 'youtube',
      durationMs: Math.round((track?.duration || 0) * 1000),
      positionMs: Math.round(positionSec * 1000),
      isPlaying: isPlaying,
      updatedAt: { '.sv': 'timestamp' },
      updatedBy: 'windows_desktop_host',
      seq: Number(data.sequenceId || 1)
    });

    const url = new URL(`${FIREBASE_RTDB_BASE}/rooms/${roomId}/state.json`);
    const req = https.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 3000
    }, (res) => { res.resume(); });
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (err) {
    // Non-blocking
  }
}

function getLanRoomStreamUrl(trackId) {
  if (!trackId) return null;
  return `http://${getLocalIpAddress()}:${proxyPort}/stream?id=${encodeURIComponent(trackId)}`;
}

function getRoomStreamUrl(trackId) {
  if (!trackId) return null;
  return networkMode === 'global' && globalTunnelUrl
    ? `${globalTunnelUrl}/stream?id=${encodeURIComponent(trackId)}`
    : getLanRoomStreamUrl(trackId);
}


function activePositionCalc() {
  const timestamp = Date.now();
  const elapsed = currentRoomIsPlaying ? Math.max(0, (timestamp - currentRoomStateAt) / 1000) : 0;
  return Math.max(0, Number(currentRoomPosition) || 0) + elapsed;
}

function broadcastRoomPlaybackControl(action, details = {}) {
  const sequenceId = ++roomPlaybackSequenceId;
  const currentPos = activePositionCalc();
  roomPlaybackState = {
    roomCode: currentRoomId,
    hostConnected: true,
    track: currentRoomTrack,
    streamUrl: currentRoomTrack ? getRoomStreamUrl(currentRoomTrack.id) : null,
    trackId: currentRoomTrack?.id == null ? null : String(currentRoomTrack.id),
    isPlaying: action === 'play',
    positionSec: Number.isFinite(details.position) ? details.position : currentPos,
    hostSentAtMs: Date.now(),
    updatedAtMs: Date.now(),
    sequenceId
  };
  latestRoomState = { ...createRoomSnapshot('state_sync'), ...roomPlaybackState, type: 'state_sync', sequenceId };
  broadcastToRoom({
    type: 'playback-control',
    action, // 'play', 'pause', 'stop'
    sequenceId,
    timestamp: Date.now(),
    positionSec: roomPlaybackState.positionSec,
    track: currentRoomTrack
  });
}

function broadcastToRoom(payload) {
  const str = JSON.stringify(payload);
  for (const client of connectedClients) {
    if (client.readyState === 1 && client.roomId === currentRoomId) { // WebSocket.OPEN
      client.send(str);
    }
  }
}

function createRoomSnapshot(type = 'state_sync') {
  const timestamp = Date.now();
  const elapsed = currentRoomIsPlaying ? Math.max(0, (timestamp - currentRoomStateAt) / 1000) : 0;
  const position = Math.max(0, Number(currentRoomPosition) || 0) + elapsed;
  const incomingPosition = Math.max(0, Number(currentRoomIncomingPosition) || 0) + (currentRoomIsCrossfading ? elapsed : 0);
  const progress = currentRoomIsCrossfading && currentRoomCrossfadeDurationMs > 0
    ? Math.min(1, currentRoomCrossfadeProgress + elapsed * 1000 / currentRoomCrossfadeDurationMs)
    : currentRoomCrossfadeProgress;
  const withStream = track => track ? {
    ...track,
    streamUrl: getRoomStreamUrl(track.id),
    lanStreamUrl: getLanRoomStreamUrl(track.id)
  } : null;
  return {
    type,
    room: currentRoomId,
    roomCode: currentRoomId,
    hostConnected: true,
    track: withStream(currentRoomTrack),
    trackId: currentRoomTrack?.id == null ? null : String(currentRoomTrack.id),
    streamUrl: currentRoomTrack ? getRoomStreamUrl(currentRoomTrack.id) : null,
    nextTrack: withStream(currentRoomNextTrack),
    incomingTrack: withStream(currentRoomIncomingTrack),
    incomingPosition,
    isCrossfading: currentRoomIsCrossfading,
    crossfadeProgress: progress,
    crossfadeDurationMs: currentRoomCrossfadeDurationMs,
    isPlaying: currentRoomIsPlaying,
    currentTime: position,
    position,
    timestamp,
    hostTime: timestamp,
    hostSentAtMs: timestamp,
    positionSec: position,
    sequenceId: roomPlaybackSequenceId,
    outputLatencyMs: currentRoomOutputLatencyMs,
    lyrics: currentRoomLyrics
  };
}

function createRoomSyncTick(forceSnap = false) {
  const snapshot = createRoomSnapshot('room-sync-tick');
  const hostSentAtMs = Date.now();
  const sequenceId = ++roomPlaybackSequenceId;
  const positionSec = Number(snapshot.position) || 0;
  const trackId = snapshot.track?.id == null ? null : String(snapshot.track.id);
  const syncState = {
    ...snapshot,
    type: 'room-sync-tick',
    timestamp: hostSentAtMs,
    hostTime: hostSentAtMs,
    trackId,
    positionSec,
    hostSentAtMs,
    sequenceId,
    forceSnap: Boolean(forceSnap),
    roomPlaybackState: {
      track: snapshot.track,
      trackId,
      streamUrl: snapshot.track?.streamUrl || null,
      isPlaying: snapshot.isPlaying,
      positionSec,
      updatedAtMs: hostSentAtMs,
      hostSentAtMs,
      sequenceId
    }
  };
  latestRoomState = syncState;
  roomPlaybackState = {
    roomCode: currentRoomId,
    hostConnected: true,
    track: snapshot.track,
    streamUrl: snapshot.track?.streamUrl || null,
    trackId,
    isPlaying: snapshot.isPlaying,
    positionSec,
    hostSentAtMs,
    updatedAtMs: hostSentAtMs,
    sequenceId
  };
  return syncState;
}

function hasCurrentRoomClients() {
  return [...connectedClients].some(client => client.roomId === currentRoomId && client.readyState === 1);
}

function clearRoomSyncTickIfIdle() {
  if (hasCurrentRoomClients()) return;
  clearInterval(roomSyncTickTimer);
  roomSyncTickTimer = null;
}

function startRoomSyncTick() {
  if (roomSyncTickTimer) return;
  roomSyncTickTimer = setInterval(() => {
    if (!wss || !hasCurrentRoomClients()) {
      clearRoomSyncTickIfIdle();
      return;
    }
    broadcastToRoom(createRoomSyncTick(false));
  }, 5000);
  roomSyncTickTimer.unref?.();
}

// Follow redirects helper for YouTube GoogleVideo CDNs
function pipeWithRedirects(targetUrl, reqHeaders, clientResHandler, redirectCount = 0) {
  if (redirectCount > 6) {
    clientResHandler(new Error('Too many redirects'));
    return;
  }
  const parsed = new URL(targetUrl);
  const client = parsed.protocol === 'https:' ? https : http;

  const req = client.request(parsed, {
    method: 'GET',
    headers: reqHeaders
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let nextUrl = res.headers.location;
      if (!nextUrl.startsWith('http')) {
        nextUrl = new URL(nextUrl, targetUrl).href;
      }
      return pipeWithRedirects(nextUrl, reqHeaders, clientResHandler, redirectCount + 1);
    }
    clientResHandler(null, res);
  });

  req.on('error', (err) => clientResHandler(err));
  req.end();
}

// Local HTTP Audio Proxy & Echo Party Sync Server

// Whitelist and path traversal protection for static files served by local HTTP server
const ALLOWED_STATIC_FILES = new Map([
  ['satellite.html', { contentType: 'text/html; charset=utf-8' }],
  ['default-art.png', { contentType: 'image/png' }],
  ['jsQR.js', { contentType: 'application/javascript; charset=utf-8' }]
]);

function serveSecureStaticFile(fileName, res, corsHeaders) {
  if (!ALLOWED_STATIC_FILES.has(fileName)) {
    res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  const rootDir = path.resolve(__dirname);
  const targetPath = path.resolve(rootDir, fileName);
  if (!targetPath.startsWith(rootDir + path.sep)) {
    res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/plain' });
    return res.end('Access denied: path traversal attempt');
  }
  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const info = ALLOWED_STATIC_FILES.get(fileName);
  res.writeHead(200, { 'Content-Type': info.contentType });
  return fs.createReadStream(targetPath).pipe(res);
}

function startAudioProxy() {
  const server = http.createServer(async (req, res) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Bypass-Tunnel-Reminder',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Bypass-Tunnel-Reminder': 'true',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    };

    for (const [k, v] of Object.entries(corsHeaders)) {
      res.setHeader(k, v);
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders,
        'Access-Control-Max-Age': '86400'
      });
      return res.end();
    }

    const reqUrl = new URL(req.url, `http://localhost:${proxyPort}`);

    // 1. Mobile & Laptop Satellite Web Page
    if (reqUrl.pathname.startsWith('/room') || reqUrl.pathname === '/party' || reqUrl.pathname === '/satellite' || reqUrl.pathname === '/') {
      return serveSecureStaticFile('satellite.html', res, corsHeaders);
    }

    // 2. Default Artwork Asset
    if (reqUrl.pathname === '/default-art.png') {
      return serveSecureStaticFile('default-art.png', res, corsHeaders);
    }

    // 2b. Built-In QR Code Scanner Library (jsQR)
    if (reqUrl.pathname === '/jsQR.js') {
      return serveSecureStaticFile('jsQR.js', res, corsHeaders);
    }

    // 2c. REST API for Room Info & QR Code Generation
    if (reqUrl.pathname === '/api/room-info') {
      const addressInfo = getRoomAddressInfo();
      const { localIp, joinUrl } = addressInfo;
      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(joinUrl, {
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (e) {}

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({
        roomId: currentRoomId,
        localIp,
        lanAddresses: addressInfo.lanAddresses,
        port: proxyPort,
        lanJoinUrl: addressInfo.lanJoinUrl,
        tunnelJoinUrl: addressInfo.tunnelJoinUrl,
        joinUrl,
        qrDataUrl,
        networkMode,
        globalTunnelUrl
      }));
    }

    if (reqUrl.pathname === '/api/generate-qr') {
      const text = reqUrl.searchParams.get('text') || '';
      try {
        const qrDataUrl = await QRCode.toDataURL(text, {
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify({ qrDataUrl }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (reqUrl.pathname === '/api/stream-status') {
      const videoId = reqUrl.searchParams.get('id') || '';
      const reason = streamFailureReasons.get(videoId) || '';
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: !reason, reason }));
    }

    // 3. Local audio proxy. /stream remains an alias for existing Rooms clients;
    // /proxy-audio is used by normal desktop playback to inject extractor headers.
    if (reqUrl.pathname === '/stream' || reqUrl.pathname === '/proxy-audio') {
      const videoId = reqUrl.searchParams.get('id');
      const streamMetadata = {
        title: reqUrl.searchParams.get('title') || '',
        artist: reqUrl.searchParams.get('artist') || '',
        duration: Number(reqUrl.searchParams.get('duration')) || 0
      };
      console.log('[DIAG-AUDIO] HTTP', req.method, reqUrl.pathname, 'for videoId:', videoId, 'Range:', req.headers.range || 'full');
      if (!videoId) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'text/plain' });
        return res.end('Missing video id');
      }

      try {
        let streamInfo = await resolveStreamUrl(videoId, streamMetadata);
        if (!streamInfo) {
          const reason = streamFailureReasons.get(videoId) || 'No playable audio stream was returned by the available sources.';
          res.writeHead(502, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(`Audio stream unavailable: ${reason}`);
        }

        let didRefresh = false;
        const forwardAudio = (currentInfo) => {
          const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://www.youtube.com/'
          };
          Object.assign(headers, currentInfo.headers || {});
          if (req.headers.range) headers.Range = req.headers.range;

          pipeWithRedirects(currentInfo.url, headers, (err, clientRes) => {
            if (err || !clientRes) {
              const reason = err?.message || 'Upstream audio request failed.';
              streamFailureReasons.set(videoId, reason.slice(0, 360));
              appendStreamDebug(`Proxy request failed for videoId=${videoId}: ${reason}`);
              console.error('[Stream Proxy] Upstream audio request failed:', reason);
              if (!res.headersSent) {
                res.writeHead(502, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Audio proxy request failed: ${reason}`);
              }
              return;
            }

            if ([403, 410].includes(clientRes.statusCode) && !didRefresh && !videoId.startsWith('saavn_')) {
              didRefresh = true;
              clientRes.resume();
              streamCache.delete(videoId);
              resolveStreamUrl(videoId, streamMetadata, { forceRefresh: true }).then(refreshed => {
                if (refreshed && !res.destroyed) return forwardAudio(refreshed);
                const reason = `The upstream audio host returned HTTP ${clientRes.statusCode} after refreshing the stream.`;
                streamFailureReasons.set(videoId, reason);
                if (!res.headersSent) {
                  res.writeHead(clientRes.statusCode, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
                  res.end(reason);
                }
              }).catch(refreshError => {
                if (!res.headersSent) {
                  res.writeHead(502, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
                  res.end(`Audio stream refresh failed: ${refreshError.message}`);
                }
              });
              return;
            }

            if (clientRes.statusCode >= 400) {
              const reason = `The upstream audio host returned HTTP ${clientRes.statusCode}.`;
              streamFailureReasons.set(videoId, reason);
              appendStreamDebug(`Upstream HTTP ${clientRes.statusCode} for videoId=${videoId}.`);
            } else {
              streamFailureReasons.delete(videoId);
            }

            const proxyHeaders = {
              ...corsHeaders,
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0',
              'Content-Type': clientRes.headers['content-type'] || 'audio/webm',
              'Accept-Ranges': clientRes.headers['accept-ranges'] || 'bytes'
            };
            for (const headerName of ['content-length', 'content-range', 'last-modified', 'etag']) {
              if (clientRes.headers[headerName]) {
                proxyHeaders[headerName.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('-')] = clientRes.headers[headerName];
              }
            }
            res.writeHead(clientRes.statusCode || 200, proxyHeaders);
            if (req.method === 'HEAD') {
              clientRes.destroy();
              return res.end();
            }
            clientRes.pipe(res);
            req.on('close', () => clientRes.destroy());
          });
        };
        forwardAudio(streamInfo);
      } catch (err) {
        console.error('Stream resolution error:', err);
        if (!res.headersSent) {
          res.writeHead(502, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Error resolving audio: ${err.message}`);
        }
      }
    } else {
      res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  // Attach WebSocket Server for NTP Clock Sync & Room Orchestration
  try {
    wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
      connectedClients.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'join' || msg.type === 'join-room') {
            const requestedRoom = String(msg.room || '').trim().toUpperCase();
            if (requestedRoom !== currentRoomId) {
              ws.send(JSON.stringify({ type: 'room_error', message: 'Room code does not match this host.' }));
              ws.close(1008, 'Room code mismatch');
              return;
            }
            ws.roomId = requestedRoom;
            const joinState = {
              ...latestRoomState,
              ...createRoomSnapshot('state_sync'),
              type: 'state_sync',
              room: currentRoomId,
              roomCode: currentRoomId,
              hostConnected: true,
              hostSentAtMs: Date.now()
            };
            latestRoomState = joinState;
            ws.send(JSON.stringify(joinState));
            startRoomSyncTick();
            if (mainWindow && !mainWindow.isDestroyed()) {
              const count = [...connectedClients].filter(client => client.roomId === currentRoomId && client.readyState === 1).length;
              mainWindow.webContents.send('room-members-changed', count);
            }
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({
              type: 'pong',
              t1: msg.t1,
              pingSentAtMs: msg.pingSentAtMs,
              serverTime: Date.now(),
              timestamp: Date.now()
            }));
          } else if (msg.type === 'room-request-sync') {
            if (ws.roomId !== currentRoomId || ws.readyState !== 1) return;
            ws.send(JSON.stringify({
              ...createRoomSyncTick(true),
              clientSentAtMs: Number(msg.clientSentAtMs) || null
            }));
          } else if (msg.type === 'request_pulse') {
            const target = Date.now() + 300;
            broadcastToRoom({ type: 'pulse', targetServerTime: target });
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('trigger-sync-pulse', target);
            }
          } else if (msg.type === 'start_beep_fusion') {
            broadcastToRoom({ type: 'beep_fusion_start' });
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('beep-fusion-start');
            }
          } else if (msg.type === 'stop_beep_fusion') {
            broadcastToRoom({ type: 'beep_fusion_stop' });
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('beep-fusion-stop');
            }
          }
        } catch (e) {}
      });

      ws.on('close', () => {
        connectedClients.delete(ws);
        clearRoomSyncTickIfIdle();
        if (mainWindow && !mainWindow.isDestroyed()) {
          const count = [...connectedClients].filter(client => client.roomId === currentRoomId && client.readyState === 1).length;
          mainWindow.webContents.send('room-members-changed', count);
        }
      });
    });
    const roomHeartbeat = setInterval(() => {
      if (!wss) return;
      for (const ws of wss.clients) {
        if (ws.readyState !== 1) continue;
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 15000);
    roomHeartbeat.unref();
  } catch (err) {
    console.error('WebSocket Server startup error:', err);
  }

  server.on('error', (err) => {
    console.error('[Audio Proxy Server Error]', err);
    if (err.code === 'EADDRINUSE') {
      proxyPort++;
      console.warn(`Port in use, switching to ${proxyPort}...`);
      setTimeout(() => server.listen(proxyPort, '0.0.0.0'), 500);
    }
  });

  // Listen on 0.0.0.0 so both localhost and mobile devices on Wi-Fi can connect
  server.listen(proxyPort, '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log(`Echo Audio & Party Sync Server running on http://${localIp}:${proxyPort}`);
});
}

const YT_DLP_DLLS = ['vcruntime140.dll', 'msvcp140.dll'];
const streamFailureReasons = new Map();

function getBundledBinaryPath(name) {
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'bin', name);
    return fs.existsSync(packagedPath) ? packagedPath : null;
  }
  const devCandidates = [
    path.join(__dirname, name),
    path.join(__dirname, 'build_support', 'vc-runtime', name),
    path.join(__dirname, 'resources', 'bin', name)
  ];
  return devCandidates.find(candidate => fs.existsSync(candidate)) || null;
}

function ensureUserBinaries() {
  try {
    const userBinDir = path.join(app.getPath('userData'), 'bin');
    fs.mkdirSync(userBinDir, { recursive: true });
    for (const name of ['yt-dlp.exe', ...YT_DLP_DLLS]) {
      const bundledPath = getBundledBinaryPath(name);
      if (!bundledPath) {
        if (name === 'yt-dlp.exe') console.error('[yt-dlp] Bundled executable is missing from resources/bin.');
        continue;
      }
      const targetPath = path.join(userBinDir, name);
      const sourceSize = fs.statSync(bundledPath).size;
      const targetSize = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
      if (!targetSize || targetSize < sourceSize) {
        fs.copyFileSync(bundledPath, targetPath);
        console.log(`[Media Tools] Installed bundled ${name} into userData/bin.`);
      }
    }
    const ytDlpPath = path.join(userBinDir, 'yt-dlp.exe');
    return fs.existsSync(ytDlpPath) && fs.statSync(ytDlpPath).size > 50000 ? ytDlpPath : null;
  } catch (err) {
    console.error('[Media Tools] Could not prepare writable userData/bin:', err.message);
    return null;
  }
}

function getYtDlpPath() {
  // The executable and its VC++ runtime DLLs share a writable folder. This
  // avoids app.asar / Program Files execution and DLL search-path failures.
  return ensureUserBinaries();
}

function getFfmpegPath() {
  if (app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, 'bin', 'ffmpeg.exe');
    return fs.existsSync(bundledPath) ? bundledPath : null;
  }
  try {
    const devPath = require('ffmpeg-static');
    return devPath && fs.existsSync(devPath) ? devPath : null;
  } catch (err) {
    console.warn('[Offline Download] Unable to locate development FFmpeg:', err.message);
    return null;
  }
}

function getFfprobePath() {
  if (app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, 'bin', 'ffprobe.exe');
    return fs.existsSync(bundledPath) ? bundledPath : null;
  }
  try {
    const devPath = require('ffprobe-static')?.path;
    return devPath && fs.existsSync(devPath) ? devPath : null;
  } catch (err) {
    console.warn('[Offline Download] Unable to locate development ffprobe:', err.message);
    return null;
  }
}

const musicVideoTitlePattern = /\b(?:official\s+music\s+video|official\s+video|music\s+video|video\s+song|full\s+video|lyrical\s+video|teaser|trailer|jukebox|1\s*hour|mashup)\b/i;

function appendStreamDebug(message) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'stream-debug.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (error) {
    console.warn('[Stream Proxy] Could not write stream-debug.log:', error.message);
  }
}

function runYtDlpOnce(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const ytDlpCmd = getYtDlpPath();
    if (!ytDlpCmd) return resolve({ code: -1, stdout: '', stderr: 'Bundled yt-dlp.exe or its VC++ runtime is missing.' });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    const child = spawn(ytDlpCmd, args, { windowsHide: true, cwd: path.dirname(ytDlpCmd) });
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch (error) {}
    }, timeoutMs);
    child.stdout?.on('data', data => { stdout += data.toString(); });
    child.stderr?.on('data', data => { stderr += data.toString(); });
    child.on('error', error => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut }));
    child.on('close', code => finish({ code: timedOut ? -1 : code, stdout, stderr: timedOut ? `${stderr}\nProcess timed out after ${timeoutMs}ms.` : stderr, timedOut }));
  });
}

async function runYtDlp(args, timeoutMs = 15000) {
  const first = await runYtDlpOnce(args, timeoutMs);
  if (first.code === 0) return first;
  appendStreamDebug(`yt-dlp attempt 1 failed (exit=${first.code}, timeout=${Boolean(first.timedOut)}).\nargs=${args.join(' ')}\nstderr=${first.stderr || '(empty)'}`);
  if (args.includes('--force-ipv4')) return first;
  const retry = await runYtDlpOnce([...args, '--force-ipv4'], timeoutMs);
  if (retry.code !== 0) appendStreamDebug(`yt-dlp IPv4 retry failed (exit=${retry.code}, timeout=${Boolean(retry.timedOut)}).\nargs=${[...args, '--force-ipv4'].join(' ')}\nstderr=${retry.stderr || '(empty)'}`);
  return retry;
}

function parseYtDlpJson(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch (error) {}
  }
  return null;
}

function normalizeStreamResult(value, source = 'youtube') {
  if (!value) return null;
  if (typeof value === 'string') return { url: value, headers: {}, source };
  if (!value.url) return null;
  const allowedHeaders = new Set(['user-agent', 'referer', 'cookie', 'accept', 'accept-language', 'origin']);
  const headers = {};
  for (const [name, headerValue] of Object.entries(value.headers || value.http_headers || {})) {
    if (allowedHeaders.has(name.toLowerCase()) && typeof headerValue === 'string' && headerValue.trim()) {
      headers[name] = headerValue;
    }
  }
  return { url: value.url, headers, source: value.source || source, timestamp: value.timestamp || Date.now() };
}

function requestText(url, options = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const req = client.request(parsed, { method: options.method || 'GET', headers: options.headers || {} }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 6 * 1024 * 1024) req.destroy(new Error('Response exceeded 6 MB limit'));
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.on('close', () => clearTimeout(timer));
    req.end(options.body);
  });
}

async function resolveInnerTubeAudio(videoId) {
  try {
    const page = await requestText(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const apiKey = page.body.match(/\bINNERTUBE_API_KEY\s*["']?\s*[:=]\s*["']([^"']+)["']/)?.[1];
    if (!apiKey) throw new Error('YouTube page did not provide an InnerTube API key.');
    const clients = [
      { name: 'ANDROID', version: '20.10.38', userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' },
      { name: 'IOS', version: '20.10.4', userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)' }
    ];
    for (const client of clients) {
      const body = JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: { client: { clientName: client.name, clientVersion: client.version, hl: 'en', gl: 'US' } }
      });
      const response = await requestText(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Origin': 'https://www.youtube.com',
          'Referer': `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          'User-Agent': client.userAgent
        }
      });
      if (response.statusCode < 200 || response.statusCode >= 300) continue;
      const player = JSON.parse(response.body);
      const formats = (player.streamingData?.adaptiveFormats || []).filter(format =>
        String(format.mimeType || '').startsWith('audio/') && typeof format.url === 'string' && format.url.startsWith('http')
      );
      formats.sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
      const format = formats[0];
      if (format?.url) {
        return normalizeStreamResult({
          url: format.url,
          source: `innertube-${client.name.toLowerCase()}`,
          headers: {
            'User-Agent': client.userAgent,
            'Referer': `https://www.youtube.com/watch?v=${videoId}`
          }
        });
      }
    }
    throw new Error('InnerTube did not return a directly playable audio format.');
  } catch (error) {
    console.warn('[Stream Proxy] InnerTube audio fallback failed:', error.message);
    return null;
  }
}

function normalizeStreamArtist(artist = '') {
  return String(artist).split(/\s+(?:feat\.?|ft\.?|with|x)\s+|\s*&\s*|\s*,\s*/i)[0].trim().toLowerCase();
}

async function findOfficialAudioVideo(metadata = {}) {
  const title = String(metadata.title || '').replace(/\s*\((?:feat\.?|ft\.?|with)\s+[^)]*\)/i, '').trim();
  const artist = normalizeStreamArtist(metadata.artist || '');
  if (!title || !artist) return null;
  const wantedDuration = Number(metadata.duration) || 0;
  const query = `ytsearch6:${title} ${artist} official audio`;
  const result = await runYtDlp(['--dump-single-json', '--skip-download', '--no-warnings', '--no-playlist', query]);
  if (result.code !== 0 || !result.stdout.trim()) return null;
  try {
    const search = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
    const candidates = Array.isArray(search.entries) ? search.entries : [search];
    const viable = candidates.filter(item => item?.id && !musicVideoTitlePattern.test(item.title || '') &&
      (!wantedDuration || !item.duration || item.duration <= wantedDuration + 8));
    viable.sort((a, b) => {
      const aDuration = wantedDuration && a.duration ? Math.abs(a.duration - wantedDuration) : 9999;
      const bDuration = wantedDuration && b.duration ? Math.abs(b.duration - wantedDuration) : 9999;
      const aAudio = /official\s+audio|audio\s+track|lyrics/i.test(a.title || '') ? 1 : 0;
      const bAudio = /official\s+audio|audio\s+track|lyrics/i.test(b.title || '') ? 1 : 0;
      return bAudio - aAudio || aDuration - bDuration;
    });
    return viable[0]?.id || null;
  } catch (error) {
    console.warn('[Stream Proxy] Could not parse official-audio search results:', error.message);
    return null;
  }
}

async function resolveStreamUrl(videoId, metadata = {}, options = {}) {
  if (!videoId) return null;

  if (!options.forceRefresh && streamCache.has(videoId)) {
    const cached = streamCache.get(videoId);
    if (Date.now() - cached.timestamp < 1000 * 60 * 60 * 5) {
      console.log('[DIAG-AUDIO] resolveStreamUrl CACHE HIT for videoId:', videoId, 'source:', cached.source || 'cached');
      return normalizeStreamResult(cached);
    }
  }

  console.log('[DIAG-AUDIO] resolveStreamUrl CACHE MISS - resolving videoId:', videoId);

  if (videoId.startsWith('saavn_')) {
    const saavnUrl = await resolveSaavnTrack(videoId);
    if (saavnUrl) {
      const saavnInfo = normalizeStreamResult(streamCache.get(videoId) || {
        url: saavnUrl,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.jiosaavn.com/' },
        source: 'saavn',
        timestamp: Date.now()
      }, 'saavn');
      streamCache.set(videoId, saavnInfo);
      streamFailureReasons.delete(videoId);
      return saavnInfo;
    }
  }

  const metadataDuration = Number(metadata.duration) || 0;
  let selectedVideoId = videoId;
  if (metadataDuration > 0 && !String(videoId).startsWith('saavn_')) {
    const check = await runYtDlp(['--dump-single-json', '--skip-download', '--no-warnings', '--no-playlist', `https://www.youtube.com/watch?v=${videoId}`]);
    try {
      const details = JSON.parse(check.stdout.trim().split(/\r?\n/).pop());
      const oversized = Number(details.duration) > metadataDuration + 8;
      const isVideoTitle = musicVideoTitlePattern.test(details.title || '');
      if (oversized || isVideoTitle) {
        console.info('[Stream Proxy] Replacing non-audio/oversized result with official-audio search.', {
          videoId, title: details.title, duration: details.duration, expectedDuration: metadataDuration
        });
        selectedVideoId = await findOfficialAudioVideo(metadata) || '';
      }
    } catch (error) {
      console.debug('[Stream Proxy] Metadata guard unavailable; using the selected audio result:', error.message);
    }
    if (!selectedVideoId) return null;
  }

  const sourceUrl = `https://www.youtube.com/watch?v=${selectedVideoId}`;
  const args = [
    '--no-playlist', '--no-warnings',
    '-f', 'bestaudio[ext=m4a]/bestaudio[acodec*=mp4a]/bestaudio/best',
    '--extractor-args', 'youtube:player_client=android,ios,web',
    '-j', sourceUrl
  ];
  const result = await runYtDlp(args, 15000);
  const info = result.code === 0 ? parseYtDlpJson(result.stdout) : null;
  const selectedFormat = info?.requested_formats?.find(format => format?.url) || info?.requested_downloads?.find(format => format?.url) || info;
  const resolvedUrl = selectedFormat?.url || info?.url;
  if (resolvedUrl) {
    const streamInfo = normalizeStreamResult({
      url: resolvedUrl,
      headers: { ...(info?.http_headers || {}), ...(selectedFormat?.http_headers || {}) },
      source: 'yt-dlp',
      timestamp: Date.now()
    });
    streamCache.set(videoId, streamInfo);
    streamFailureReasons.delete(videoId);
    console.log('[Stream Proxy] Extracted audio stream for', videoId, 'from', selectedVideoId, 'via yt-dlp.');
    return streamInfo;
  }

  const ytDlpReason = result.stderr?.trim() || `yt-dlp exited with code ${result.code}.`;
  console.warn(`[Stream Proxy] yt-dlp audio extraction failed for ${videoId}:`, ytDlpReason.slice(0, 400));
  const innerTubeInfo = await resolveInnerTubeAudio(selectedVideoId);
  if (innerTubeInfo) {
    const streamInfo = { ...innerTubeInfo, timestamp: Date.now() };
    streamCache.set(videoId, streamInfo);
    streamFailureReasons.delete(videoId);
    console.info(`[Stream Proxy] InnerTube provided the audio fallback for ${videoId}.`);
    return streamInfo;
  }

  const reason = ytDlpReason.replace(/[\r\n]+/g, ' ').slice(0, 360);
  streamFailureReasons.set(videoId, reason);
  appendStreamDebug(`Audio resolution failed for videoId=${videoId}: ${reason}`);
  return null;
}

// Official YouTube Music InnerTube Search Engine (Lightning Fast & 100% Pure Music)
function searchYouTubeMusic(query) {
  const explicitVideoSearch = /\bvideo\b/i.test(String(query || ''));
  const songsParam = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'; // Pure Songs Filter Parameter
  const initialParams = explicitVideoSearch ? undefined : songsParam;

  return new Promise((resolve) => {
    function executeSearch(searchParams) {
      const payloadObj = {
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US'
          }
        },
        query: query
      };
      if (searchParams) {
        payloadObj.params = searchParams;
      }
      const postData = JSON.stringify(payloadObj);

      const req = https.request('https://music.youtube.com/youtubei/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://music.youtube.com',
          'Referer': 'https://music.youtube.com/'
        }
      }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const sections = json.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
            const tracks = [];
            const seenIds = new Set();

            // 1. Check Top Result card if present
            for (const sec of sections) {
              if (sec.musicCardShelfRenderer) {
                const card = sec.musicCardShelfRenderer;
                const title = card.title?.runs?.[0]?.text;
                const videoId = card.onTap?.watchEndpoint?.videoId 
                  || card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
                const subtitle = card.subtitle?.runs?.map(r => r.text).join('') || '';
                const thumb = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url;

                if (title && videoId && !seenIds.has(videoId)) {
                  seenIds.add(videoId);
                  const isSong = subtitle.toLowerCase().includes('song');
                  const durStr = extractDurationString(subtitle);
                  const durSec = extractDurationFromStr(durStr);
                  tracks.push({
                    id: videoId,
                    title: title,
                    artist: cleanArtistSubtitle(subtitle),
                    duration: durSec,
                    durationSec: durSec,
                    durationString: durStr,
                    thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    isSong: isSong,
                    isVideo: subtitle.toLowerCase().includes('video'),
                    musicVideoType: String(card.musicVideoType || card.onTap?.watchEndpoint?.musicVideoType || ''),
                    isTopResult: true
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

                const title = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
                const subtitleRuns = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
                const subtitle = subtitleRuns.map(r => r.text).join('');

                // Strict Music Filtering: Ignore podcast episodes, non-music long lectures
                const lowerSub = subtitle.toLowerCase();
                if (lowerSub.includes('episode') || lowerSub.includes('podcast')) continue;

                const watchEndpoint = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint
                  || item.doubleTapEndpoint?.watchEndpoint
                  || item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
                
                const videoId = watchEndpoint?.videoId || item.playlistItemData?.videoId;
                const thumb = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url;

                if (title && videoId && !seenIds.has(videoId)) {
                  seenIds.add(videoId);
                  const isSong = lowerSub.includes('song') || lowerSub.includes('track');
                  const isVideo = lowerSub.includes('video');
                  const musicVideoType = String(item.musicVideoType || watchEndpoint?.musicVideoType || '');
                  const durStr = extractDurationString(subtitle);
                  const durSec = extractDurationFromStr(durStr);

                  tracks.push({
                    id: videoId,
                    title: title,
                    artist: cleanArtistSubtitle(subtitle),
                    duration: durSec,
                    durationSec: durSec,
                    durationString: durStr,
                    thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    isSong: isSong,
                    isVideo: isVideo,
                    musicVideoType
                  });
                }
              }
            }

            // If strict filter yielded 0 tracks, retry without filter param
            if (tracks.length === 0 && searchParams) {
              return executeSearch(null);
            }

            // Prefer native audio tracks; if an ATV exists for a song, drop its OMV/UGC variants.
            const normalizeTitle = value => String(value || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
            const primaryArtist = value => normalizeStreamArtist(value);
            const audioKeys = new Set(tracks.filter(track => track.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV')
              .map(track => `${normalizeTitle(track.title)}|${primaryArtist(track.artist)}`));
            const filteredTracks = tracks.filter(track => {
              if (!explicitVideoSearch && musicVideoTitlePattern.test(track.title || '')) return false;
              const key = `${normalizeTitle(track.title)}|${primaryArtist(track.artist)}`;
              return !(audioKeys.has(key) && ['MUSIC_VIDEO_TYPE_OMV', 'MUSIC_VIDEO_TYPE_UGC'].includes(track.musicVideoType));
            });
            filteredTracks.sort((a, b) => {
              const aAudio = a.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' || a.isSong ? 1 : 0;
              const bAudio = b.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' || b.isSong ? 1 : 0;
              return bAudio - aAudio || Number(Boolean(b.isTopResult)) - Number(Boolean(a.isTopResult));
            });

            resolve(filteredTracks);
          } catch (e) {
            console.error('InnerTube parse error:', e);
            if (searchParams) return executeSearch(null);
            resolve([]);
          }
        });
      });

      req.on('error', (err) => {
        console.error('InnerTube request error:', err);
        if (searchParams) return executeSearch(null);
        resolve([]);
      });

      req.write(postData);
      req.end();
    }

    executeSearch(initialParams);
  });
}

// Official YouTube Music InnerTube Live Search Suggestions Engine
function getYouTubeMusicSuggestions(query) {
  return new Promise((resolve) => {
    const cleanQuery = String(query || '').trim();
    if (cleanQuery.length < 2) return resolve([]);

    const postData = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      input: cleanQuery
    });

    const req = https.request('https://music.youtube.com/youtubei/v1/music/get_search_suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/'
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const contents = json.contents || [];
          const list = [];
          for (const secElem of contents) {
            const renderer = secElem.searchSuggestionsSectionRenderer;
            if (!renderer || !Array.isArray(renderer.contents)) continue;
            for (const itemElem of renderer.contents) {
              const sRenderer = itemElem.searchSuggestionRenderer || itemElem.historySuggestionRenderer;
              if (!sRenderer) continue;
              const runs = sRenderer.suggestion?.runs || [];
              const text = runs.map(r => r.text || '').join('').trim();
              if (text && !list.includes(text)) {
                list.add ? list.add(text) : list.push(text);
              }
            }
          }
          resolve(list.slice(0, 10));
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.write(postData);
    req.end();
  });
}

function cleanArtistSubtitle(subtitle) {
  if (!subtitle) return 'Artist';
  let str = decodeHtmlEntities(subtitle)
    .replace(/^Song\s*•\s*/i, '')
    .replace(/^Video\s*•\s*/i, '')
    .replace(/^Episode\s*•\s*/i, '');

  const parts = str.split('•').map(p => p.trim()).filter(Boolean);
  const dateRegex = /^[A-Za-z]{3}\s*\d{1,2},?\s*\d{4}$/;
  const viewRegex = /^\d+(\.\d+)?[BBMK]?\s*views?$/i;
  const timeRegex = /^\d+:\d+$/;
  const filtered = parts.filter(p => !dateRegex.test(p) && !viewRegex.test(p) && !timeRegex.test(p) && !/^Episode$/i.test(p));

  let candidate = filtered.length > 0 ? filtered[0] : (parts[0] || 'Artist');
  return candidate
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim() || 'Artist';
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));
}

function extractDurationString(subtitle) {
  const match = subtitle.match(/(\d+:\d+)/);
  return match ? match[1] : '';
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    frame: false,
    show: true,
    backgroundColor: '#07080b',
    title: 'MeloPair',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[App Log]', message);
  });

  const isTestCrossfade = process.argv.includes('--test-crossfade');
  if (isTestCrossfade) {
    mainWindow.loadURL(`file://${path.join(__dirname, 'index.html')}?test_crossfade=1`);
  } else {
    mainWindow.loadFile('index.html');
  }

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-state', 'unmaximized'));
}

app.whenReady().then(() => {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  try {
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient('echoplayer', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('echoplayer');
    }
  } catch (e) {
    console.warn('[Firebase Auth] Could not register the EchoPlayer sign-in return link:', e.message);
  }
  ensureUserBinaries();
  startAudioProxy();
  createWindow();
  setTimeout(() => {
    checkGitHubReleases(false).then(info => {
      if (info && info.available && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { type: 'available', data: info });
      }
    }).catch(e => console.warn('[Updater] Auto-check error:', e));
  }, 6000);
  const startupAuthUrl = process.argv.find(arg => /^echoplayer:\/\/auth(?:[/?#]|$)/i.test(arg));
  if (startupAuthUrl && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => void handleFirebaseAuthProtocol(startupAuthUrl));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.handle('window-min', () => mainWindow?.minimize());
ipcMain.handle('window-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());

// Get streaming URL via local proxy with full CORS and byte-range headers
ipcMain.handle('get-stream-url', async (event, track) => {
  const metadata = typeof track === 'object' && track ? track : { id: track };
  const params = new URLSearchParams({ id: String(metadata.id || '') });
  if (metadata.title) params.set('title', String(metadata.title));
  if (metadata.artist) params.set('artist', String(metadata.artist));
  if (metadata.duration) params.set('duration', String(metadata.duration));
  return `http://127.0.0.1:${proxyPort}/proxy-audio?${params.toString()}`;
});

// Search music: YouTube Music library is PRIMARY + Saavn enrichment
ipcMain.handle('search-music', async (event, query) => {
  try {
    const [ytTracks, saavnTracks] = await Promise.all([
      searchYouTubeMusic(query).catch(() => []),
      searchSaavn(query).catch(() => [])
    ]);

    if (ytTracks && ytTracks.length > 0) {
      const combined = [...ytTracks];
      const seen = new Set(ytTracks.map(t => (t.title || '').toLowerCase().trim()));
      for (const st of (saavnTracks || [])) {
        const norm = (st.title || '').toLowerCase().trim();
        if (!seen.has(norm)) {
          combined.push(st);
          seen.add(norm);
        }
      }
      if (combined.length > 0 && combined[0].id) {
        console.log('[DIAG-AUDIO] [TRIGGER: search-music pre-resolution] Pre-resolving top 1:', combined[0].id, combined[0].title);
        resolveStreamUrl(combined[0].id).catch(() => {});
      }
      return combined;
    }

    if (saavnTracks && saavnTracks.length > 0) {
      return saavnTracks;
    }
  } catch (err) {
    console.warn('Search failed:', err);
  }
  return [];
});

// Live Search Suggestions: Real YouTube Music InnerTube Suggestions
ipcMain.handle('get-search-suggestions', async (event, query) => {
  try {
    return await getYouTubeMusicSuggestions(query);
  } catch (err) {
    return [];
  }
});

// Official YouTube Music Radio & Up Next Queue Engine
function getYouTubeMusicNextQueue(videoId, artist, title) {
  return new Promise((resolve) => {
    if (!videoId) {
      if (artist) return resolve(searchYouTubeMusic(`${artist} top songs`));
      return resolve([]);
    }

    const postData = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      videoId: videoId,
      playlistId: 'RDAMVM' + videoId,
      isAudioOnly: true
    });

    const req = https.request('https://music.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/'
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const queueItems = json.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];
          const tracks = [];
          const seenIds = new Set();
          seenIds.add(videoId);

          for (const item of queueItems) {
            const r = item.playlistPanelVideoRenderer;
            if (!r || !r.videoId || seenIds.has(r.videoId)) continue;
            seenIds.add(r.videoId);

            const itemTitle = r.title?.runs?.[0]?.text;
            const bylineRuns = r.longBylineText?.runs || [];
            const itemArtist = bylineRuns[0]?.text || 'Various Artists';
            const durationString = r.lengthText?.runs?.[0]?.text || '3:30';
            const thumb = r.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`;

            if (itemTitle && r.videoId) {
              tracks.push({
                id: r.videoId,
                title: itemTitle,
                artist: cleanArtistSubtitle(itemArtist),
                thumbnail: thumb,
                durationString: durationString,
                durationSec: extractDurationFromStr(durationString),
                isSong: true
              });
            }
          }

          if (tracks.length > 0) {
            return resolve(tracks);
          }

          // Fallback to searching artist songs if next is empty
          if (artist) {
            return resolve(searchYouTubeMusic(`${artist} songs`));
          }
          resolve([]);
        } catch (e) {
          console.error('Error parsing next queue:', e);
          if (artist) return resolve(searchYouTubeMusic(`${artist} songs`));
          resolve([]);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error fetching next queue:', err);
      if (artist) return resolve(searchYouTubeMusic(`${artist} songs`));
      resolve([]);
    });

    req.write(postData);
    req.end();
  });
}

function extractDurationFromStr(str) {
  if (!str) return 210;
  const parts = str.split(':').map(p => parseInt(p, 10));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 210;
}

// Autoplay / Related tracks (Real YouTube Music Radio Up Next)
ipcMain.handle('get-related-tracks', async (event, { videoId, artist, title }) => {
  return getYouTubeMusicNextQueue(videoId, artist, title);
});

// Fetch Synchronized Lyrics from LRCLIB (Enhanced Multi-pass Resolver)
function normalizeLyricsMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s*[\[(]\s*(?:(?:feat(?:uring)?|ft)\.?|with|official|remaster(?:ed)?)\b[^)\]]*[)\]]/giu, ' ')
    .replace(/\s*-\s*remaster(?:ed)?(?:\s+\d{4})?\b/giu, ' ')
    .replace(/\b(?:feat(?:uring)?|ft)\.?\s+.*$/iu, ' ')
    .replace(/\b(?:official(?:\s+(?:music\s+)?(?:audio|video|lyrics?))?|audio|video|visualizer|lyrics?|hd|4k)\b/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

function cleanLyricsTitle(value) {
  return String(value || '')
    .replace(/\|.*$/u, ' ')
    .replace(/\s*[\[(]\s*(?:(?:feat(?:uring)?|ft)\.?|with|official(?:\s+(?:music\s+)?(?:audio|video|lyrics?))?|lyrics?|audio|video|visualizer)[^\])]*[\])]/giu, ' ')
    .replace(/\s*-\s*(?:remaster(?:ed)?(?:\s+\d{4})?|lyric\s+video)\b.*$/iu, ' ')
    .replace(/\b(?:feat(?:uring)?|ft)\.?\s+.*$/iu, ' ')
    .replace(/\b(?:official\s+(?:music\s+)?(?:audio|video|lyrics?)|lyric\s+video|lyrics?)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/[\s.,!?;:]+$/u, '')
    .trim();
}

function getPrimaryLyricsArtist(value) {
  const artist = String(value || '')
    .replace(/^(?:Song|Video|Episode)\s*•\s*/iu, '')
    .replace(/\s*-\s*Topic$/iu, '')
    .replace(/\s*VEVO$/iu, '')
    .trim();
  return artist.split(/&|,|feat\.|ft\.| x /i)[0].trim();
}

function lyricsArtistMatches(expectedArtist, candidateArtist) {
  const expected = normalizeLyricsMatchText(expectedArtist);
  if (!expected || /^(?:unknown artist|various artists|artist)$/u.test(expected)) return true;
  const normalizedCandidate = normalizeLyricsMatchText(candidateArtist);
  const artistSeparators = /\s*(?:&|,|\/|;|\bfeat(?:uring)?\.?\b|\bft\.?\b|\bwith\b|\s+x\s+)\s*/iu;
  const candidateParts = String(candidateArtist || '')
    .split(artistSeparators)
    .map(normalizeLyricsMatchText)
    .filter(Boolean);
  const expectedTokens = expected.split(/\s+/u).filter(Boolean);
  const candidateTokens = normalizedCandidate.split(/\s+/u).filter(Boolean);
  const hasContiguousArtistCredit = expectedTokens.length > 0 && candidateTokens.some((_, start) =>
    expectedTokens.every((token, offset) => candidateTokens[start + offset] === token));
  return candidateParts.includes(expected) || normalizedCandidate === expected || hasContiguousArtistCredit;
}

function lyricsTitleSimilarity(expectedTitle, candidateTitle) {
  const expected = normalizeLyricsMatchText(expectedTitle);
  const candidate = normalizeLyricsMatchText(candidateTitle);
  if (!expected || !candidate) return 0;
  if (expected === candidate) return 1;
  const expectedWords = new Set(expected.split(/\s+/u));
  const candidateWords = new Set(candidate.split(/\s+/u));
  const overlap = [...expectedWords].filter(word => candidateWords.has(word)).length;
  return overlap / Math.max(expectedWords.size, candidateWords.size);
}

function lyricsRecordMatches(record, expectedTitle, expectedArtist) {
  if (lyricsTitleSimilarity(expectedTitle, record?.trackName) < 0.6) return false;
  if (!lyricsArtistMatches(expectedArtist, record?.artistName)) return false;
  if (!record?.syncedLyrics && !record?.plainLyrics) return false;
  return true;
}

function makeLyricsResponse(record, targetDuration, source = 'LRCLIB', hasManualOffset = false) {
  if (!record) return null;
  const recordDuration = Number(record.duration) || 0;
  const audioDuration = Number(targetDuration) || 0;
  const delta = audioDuration > 0 && recordDuration > 0 ? audioDuration - recordDuration : 0;
  const suggestedOffset = !hasManualOffset && Math.abs(delta) > 2 && Math.abs(delta) <= 15 ? -delta : 0;
  const lyrics = String(record.syncedLyrics || record.plainLyrics || '').trim();
  if (!lyrics) return null;
  return {
    synced: Boolean(record.syncedLyrics),
    lyrics: record.syncedLyrics || record.plainLyrics,
    plainLyrics: record.plainLyrics || null,
    trackName: record.trackName,
    artistName: record.artistName,
    duration: recordDuration,
    suggestedOffset,
    source
  };
}

// Priority 1 — Exact videoId Timed Captions (100% locked to the playing audio stream)
async function extractYouTubeTimedLyrics(videoId) {
  if (!videoId || typeof videoId !== 'string' || videoId.startsWith('saavn_') || videoId.startsWith('Dracula-')) {
    return null;
  }
  const ytDlpCmd = getYtDlpPath();
  if (!ytDlpCmd) return null;

  const tmpOut = path.join(app.getPath('userData'), `yt_lyr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { child.kill(); } catch (e) {}
        cleanup();
        resolve(null);
      }
    }, 8500);

    const cleanup = () => {
      try {
        const dir = path.dirname(tmpOut);
        const base = path.basename(tmpOut);
        const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
        files.forEach(f => {
          try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
        });
      } catch (e) {}
    };

    const child = spawn(ytDlpCmd, [
      '--no-update',
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang', 'en,hi,pa',
      '--sub-format', 'json3',
      '--skip-download',
      '-o', `${tmpOut}.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`
    ], { windowsHide: true, cwd: path.dirname(ytDlpCmd) });

    child.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve(null);
      }
    });

    child.on('close', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      try {
        const dir = path.dirname(tmpOut);
        const base = path.basename(tmpOut);
        const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
        if (files.length === 0) {
          cleanup();
          return resolve(null);
        }

        // Prefer non-translated/clean language file first
        const chosenFile = files.find(f => !f.includes('-') && !f.includes('auto')) || files[0];
        const content = fs.readFileSync(path.join(dir, chosenFile), 'utf8');
        cleanup();

        const json = JSON.parse(content);
        const events = json.events || [];
        const lines = [];

        for (const ev of events) {
          if (!ev.segs || ev.tStartMs == null) continue;
          let text = ev.segs.map(s => s.utf8 || '').join('').replace(/[\r\n]+/g, ' ').trim();
          text = text.replace(/\[(?:Music|Applause|Instrumental|♪.*?♪|♪+)\]/gi, '').replace(/[♪♩]/g, '').trim();
          if (text.length > 0) {
            const tSec = ev.tStartMs / 1000;
            const min = Math.floor(tSec / 60);
            const sec = (tSec % 60).toFixed(2).padStart(5, '0');
            lines.push(`[${String(min).padStart(2, '0')}:${sec}] ${text}`);
          }
        }

        if (lines.length > 0) {
          console.log(`[Lyrics] Priority 1 Success: Extracted ${lines.length} timed lines from YouTube captions for ${videoId}`);
          resolve({
            synced: true,
            lyrics: lines.join('\n'),
            source: 'YouTube Synced'
          });
        } else {
          resolve(null);
        }
      } catch (err) {
        cleanup();
        resolve(null);
      }
    });
  });
}

// Priority 2 — YouTube Music InnerTube Lyrics (MPLYt browseId)
async function fetchYouTubeMusicInnerTubeLyrics(videoId) {
  if (!videoId || typeof videoId !== 'string' || videoId.startsWith('saavn_') || videoId.startsWith('Dracula-')) {
    return null;
  }

  try {
    const browseId = await new Promise((resolve) => {
      const postData = JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US'
          }
        },
        videoId: videoId
      });

      const req = https.request('https://music.youtube.com/youtubei/v1/next', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://music.youtube.com',
          'Referer': 'https://music.youtube.com/'
        }
      }, (res) => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(b);
            const tabs = json.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
            const lyricsTab = tabs?.find(t => t.tabRenderer?.title?.toLowerCase?.() === 'lyrics');
            resolve(lyricsTab?.tabRenderer?.endpoint?.browseEndpoint?.browseId || null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.setTimeout(4000, () => req.destroy(new Error('YouTube Music lyrics request timed out')));
      req.on('error', () => resolve(null));
      req.write(postData);
      req.end();
    });

    if (!browseId) return null;

    return await new Promise((resolve) => {
      const postData = JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US'
          }
        },
        browseId: browseId
      });

      const req = https.request('https://music.youtube.com/youtubei/v1/browse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://music.youtube.com',
          'Referer': 'https://music.youtube.com/'
        }
      }, (res) => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(b);
            const contents = json.contents?.sectionListRenderer?.contents || [];
            for (const sec of contents) {
              const shelf = sec.musicDescriptionShelfRenderer;
              if (shelf?.description?.runs) {
                const text = shelf.description.runs.map(r => r.text || '').join('').trim();
                if (text && !text.toLowerCase().includes('lyrics not available')) {
                  console.log(`[Lyrics] Priority 2 Success: Retrieved YouTube Music InnerTube lyrics for ${videoId}`);
                  return resolve({
                    synced: false,
                    lyrics: text,
                    source: 'YouTube Music'
                  });
                }
              }
            }
            resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.setTimeout(4000, () => req.destroy(new Error('YouTube Music lyrics request timed out')));
      req.on('error', () => resolve(null));
      req.write(postData);
      req.end();
    });
  } catch (err) {
    return null;
  }
}

ipcMain.handle('get-lyrics', async (event, { title, artist, duration, videoId, trackId, source, hasManualLyricOffset }) => {
  const activeVideoId = (typeof videoId === 'string' && videoId.length >= 8 && !videoId.startsWith('saavn_') && !videoId.startsWith('Dracula-'))
    ? videoId
    : ((typeof trackId === 'string' && trackId.length >= 8 && !trackId.startsWith('saavn_') && !trackId.startsWith('Dracula-'))
        ? trackId
        : null);

  const cleanTitle = cleanLyricsTitle(title);
  const primaryArtist = getPrimaryLyricsArtist(artist);
  const targetDuration = Number(duration) || 0;
  const headers = { 'User-Agent': 'MeloPairDesktop/1.0.0' };
  const fetchLyricsJson = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    if (!cleanTitle || !primaryArtist) return { synced: false, lyrics: null };

    const records = [];
    // Step A / Tier 1: Exact metadata + duration lookup (matches within ±2s on LRCLIB)
    const exactUrl = new URL('https://lrclib.net/api/get');
    exactUrl.searchParams.set('track_name', cleanTitle);
    exactUrl.searchParams.set('artist_name', primaryArtist);
    if (targetDuration > 0) {
      exactUrl.searchParams.set('duration', String(Math.round(targetDuration)));
    }
    try {
      const record = await fetchLyricsJson(exactUrl);
      if (record && (record.syncedLyrics || record.plainLyrics) && lyricsRecordMatches(record, cleanTitle, primaryArtist)) {
        const exactResult = makeLyricsResponse(record, targetDuration, 'LRCLIB', Boolean(hasManualLyricOffset));
        if (exactResult?.synced) return exactResult;
        if (exactResult) records.push(record);
      }
    } catch (error) {
      console.warn('[Lyrics] LRCLIB Tier 1 exact lookup failed:', error.message);
    }

    // Step B / Tier 2 (if Tier 1 was 404): Search LRCLIB candidates by track_name & artist_name
    try {
      const tier2Url = new URL('https://lrclib.net/api/search');
      tier2Url.searchParams.set('track_name', cleanTitle);
      tier2Url.searchParams.set('artist_name', primaryArtist);
      const tier2Results = await fetchLyricsJson(tier2Url);
      if (Array.isArray(tier2Results)) records.push(...tier2Results);
    } catch (error) {
      console.warn('[Lyrics] LRCLIB Tier 2 search failed:', error.message);
    }

    // Tier 3 (if empty): Broader search with q=cleanTitle + ' ' + primaryArtist
    if (records.length === 0) {
      try {
        const tier3Url = new URL('https://lrclib.net/api/search');
        tier3Url.searchParams.set('q', `${cleanTitle} ${primaryArtist}`.trim());
        const tier3Results = await fetchLyricsJson(tier3Url);
        if (Array.isArray(tier3Results)) records.push(...tier3Results);
      } catch (error) {
        console.warn('[Lyrics] LRCLIB Tier 3 search failed:', error.message);
      }
    }

    const uniqueRecords = [...new Map(records.map(record => [
      `${normalizeLyricsMatchText(record.trackName)}|${normalizeLyricsMatchText(record.artistName)}|${Number(record.duration) || 0}`,
      record
    ])).values()];

    const scoreCandidate = (cand) => {
      let score = lyricsTitleSimilarity(cleanTitle, cand.trackName) * 100;
      if (cand.syncedLyrics && cand.syncedLyrics.trim().length > 0) {
        score += 1000;
      } else if (cand.plainLyrics && cand.plainLyrics.trim().length > 0) {
        score += 200;
      }
      if (targetDuration > 0 && Number(cand.duration) > 0) {
        // Linear duration delta penalty: -Math.abs(cand.duration - trackDurationSec) * 10
        // NEVER hard-reject the only available match just because duration differs by > 4s
        const delta = Math.abs(Number(cand.duration) - targetDuration);
        score -= delta * 10;
      }
      return score;
    };

    const candidates = uniqueRecords
      .filter(record => lyricsRecordMatches(record, cleanTitle, primaryArtist))
      .sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

    const selected = candidates[0];
    const lrclibResult = makeLyricsResponse(selected, targetDuration, 'LRCLIB', Boolean(hasManualLyricOffset));
    if (lrclibResult) return lrclibResult;

    // Tier 3a: JioSaavn lyrics for a known Saavn track, or a matching search
    // result that explicitly advertises lyrics. Transient failures are ignored.
    const parseSaavnLyrics = async (lyricsId) => {
      if (!lyricsId) return null;
      const url = new URL('https://www.jiosaavn.com/api.php');
      url.searchParams.set('__call', 'lyrics.getLyrics');
      url.searchParams.set('ctx', 'web6dot0');
      url.searchParams.set('api_version', '4');
      url.searchParams.set('_format', 'json');
      url.searchParams.set('_marker', '0');
      url.searchParams.set('lyrics_id', String(lyricsId));
      const body = await fetchLyricsJson(url);
      const text = String(body?.lyrics || '').replace(/<br\s*\/?\s*>/giu, '\n').replace(/<[^>]*>/gu, '').trim();
      return text ? { synced: false, lyrics: text, source: 'JioSaavn', duration: targetDuration } : null;
    };
    const saavnSongId = String(trackId || '').startsWith('saavn_') ? String(trackId).slice(7) : '';
    if (saavnSongId || String(source || '').toLowerCase().includes('saavn')) {
      try {
        const detailsUrl = new URL('https://www.jiosaavn.com/api.php');
        detailsUrl.searchParams.set('__call', 'song.getDetails');
        detailsUrl.searchParams.set('pids', saavnSongId);
        detailsUrl.searchParams.set('_format', 'json');
        const details = await fetchLyricsJson(detailsUrl);
        const song = details?.[saavnSongId] || Object.values(details || {})[0];
        if (song?.has_lyrics || song?.lyrics_id) {
          const saavnResult = await parseSaavnLyrics(song.lyrics_id || song.id || saavnSongId);
          if (saavnResult) return saavnResult;
        }
      } catch (error) {
        console.warn('[Lyrics] JioSaavn track lookup failed:', error.message);
      }
    }
    try {
      const saavnSearchUrl = new URL('https://www.jiosaavn.com/api.php');
      saavnSearchUrl.searchParams.set('__call', 'search.getResults');
      saavnSearchUrl.searchParams.set('_format', 'json');
      saavnSearchUrl.searchParams.set('_marker', '0');
      saavnSearchUrl.searchParams.set('cc', 'in');
      saavnSearchUrl.searchParams.set('p', '1');
      saavnSearchUrl.searchParams.set('n', '10');
      saavnSearchUrl.searchParams.set('q', `${cleanTitle} ${primaryArtist}`.trim());
      const saavnResults = await fetchLyricsJson(saavnSearchUrl);
      const songs = saavnResults?.results || saavnResults?.songs?.data || [];
      const saavnMatch = songs
        .filter(song => (song.has_lyrics || song.more_info?.has_lyrics || song.lyrics_id || song.more_info?.lyrics_id)
          && lyricsTitleSimilarity(cleanTitle, song.title || song.song) >= 0.6
          && lyricsArtistMatches(primaryArtist, song.subtitle || song.primary_artists || song.more_info?.artistMap?.primary_artists?.map(a => a.name).join(', ')))
        .sort((a, b) => lyricsTitleSimilarity(cleanTitle, b.title || b.song) - lyricsTitleSimilarity(cleanTitle, a.title || a.song))[0];
      const lyricsId = saavnMatch?.lyrics_id || saavnMatch?.more_info?.lyrics_id;
      if (lyricsId) {
        const saavnResult = await parseSaavnLyrics(lyricsId);
        if (saavnResult) return saavnResult;
      }
    } catch (error) {
      console.warn('[Lyrics] JioSaavn search fallback failed:', error.message);
    }

    // Tier 3b/c: captions for the exact playing YouTube video, then YouTube
    // Music's Lyrics tab for a plain-text fallback.
    if (activeVideoId) {
      try {
        const ytTimed = await extractYouTubeTimedLyrics(activeVideoId);
        if (ytTimed?.lyrics) {
          return { synced: true, lyrics: ytTimed.lyrics, source: ytTimed.source || 'YouTube Synced', duration: targetDuration };
        }
      } catch (error) {
        console.warn('[Lyrics] YouTube caption fallback failed:', error.message);
      }
      try {
        const ytMusic = await fetchYouTubeMusicInnerTubeLyrics(activeVideoId);
        if (ytMusic?.lyrics) {
          return { synced: false, lyrics: ytMusic.lyrics, source: ytMusic.source || 'YouTube Music', duration: targetDuration };
        }
      } catch (error) {
        console.warn('[Lyrics] YouTube Music fallback failed:', error.message);
      }
    }
  } catch (error) {
    console.error('[Lyrics] Lookup failed:', error);
  }
  return { synced: false, lyrics: null };
});

// Cache management
ipcMain.handle('clear-cache', () => {
  streamCache.clear();
  return { success: true };
});

// Download track offline to Music/EchoMusic
ipcMain.handle('download-track', async (event, { id, title, artist }) => {
  const safeId = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const musicDir = path.join(app.getPath('music'), 'EchoMusic');
  if (!safeId) {
    return { success: false, directory: musicDir, error: 'Invalid or missing YouTube ID.' };
  }
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
  }

  return new Promise((resolve) => {
    const ytDlpCmd = getYtDlpPath();
    if (!ytDlpCmd) {
      resolve({ success: false, directory: musicDir, error: 'Bundled yt-dlp.exe is missing.' });
      return;
    }
    const ffmpegPath = getFfmpegPath();
    const ffprobePath = getFfprobePath();
    if (!ffmpegPath || !ffprobePath) {
      resolve({ success: false, directory: musicDir, error: 'Bundled FFmpeg tools are missing.' });
      return;
    }
    const mediaToolPath = [path.dirname(ffmpegPath), path.dirname(ffprobePath), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter);
    const child = spawn(ytDlpCmd, [
      '--ffmpeg-location', ffmpegPath,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-thumbnail',
      '--add-metadata',
      '-o', path.join(musicDir, '%(title)s.%(ext)s'),
      '--',
      `https://www.youtube.com/watch?v=${safeId}`
    ], { windowsHide: true, cwd: path.dirname(ytDlpCmd), env: { ...process.env, PATH: mediaToolPath } });

    child.stdout.on('data', (d) => {
      const text = d.toString();
      const match = text.match(/\[download\]\s+([0-9.]+)%/);
      if (match && mainWindow) {
        mainWindow.webContents.send('download-progress', { id, percent: parseFloat(match[1]) });
      }
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, directory: musicDir });
    });

    child.on('error', () => {
      resolve({ success: false, directory: musicDir });
    });
  });
});

ipcMain.handle('open-download-dir', () => {
  const musicDir = path.join(app.getPath('music'), 'EchoMusic');
  if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
  shell.openPath(musicDir);
});

// ------------------------------------------------------------------------
// Local JSON Storage for Persistent User Data (Favorites, History, EQ & Settings)
// ------------------------------------------------------------------------
const userDataPath = app.getPath('userData');
const storageFilePath = path.join(userDataPath, 'echo_user_data.json');
const profileInitializationPath = path.join(userDataPath, 'hasInitializedFreshProfile.json');

async function writeProfileInitializationState(state) {
  await fs.promises.mkdir(userDataPath, { recursive: true });
  const tempPath = `${profileInitializationPath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
  await fs.promises.rename(tempPath, profileInitializationPath);
}

ipcMain.handle('initialize-fresh-profile', async (event, profileSignals = {}) => {
  let initializationState = null;
  try {
    initializationState = JSON.parse(await fs.promises.readFile(profileInitializationPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Profile] Could not read first-run marker:', error.message);
  }

  let savedProfile = null;
  try {
    savedProfile = JSON.parse(await fs.promises.readFile(storageFilePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Profile] Could not inspect saved profile:', error.message);
  }

  const existingAccountSession = fs.existsSync(firebaseSessionFile());
  const hasPriorProfile = Boolean(initializationState?.hasInitializedFreshProfile
    || savedProfile
    || profileSignals?.hasExistingProfile
    || existingAccountSession);
  const isFirstLaunch = !initializationState?.hasInitializedFreshProfile && !hasPriorProfile;

  if (isFirstLaunch) {
    // A genuinely new local profile must never inherit an account session from
    // copied app data or a stale Electron origin store.
    await clearFirebaseSession().catch(() => {});
    await clearPendingFirebaseLogin().catch(() => {});
    try {
      await event.sender.session.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers']
      });
    } catch (error) {
      console.warn('[Profile] Could not clear fresh-profile browser storage:', error.message);
    }
  }

  const isFreshInstall = initializationState?.freshInstall ?? isFirstLaunch;
  const onboardingComplete = profileSignals?.onboardingComplete === true
    || savedProfile?.onboardingDone === true
    || initializationState?.onboardingComplete === true;
  const nextState = {
    ...(initializationState || {}),
    hasInitializedFreshProfile: true,
    freshInstall: isFreshInstall,
    onboardingComplete,
    welcomeWizardPending: initializationState?.welcomeWizardPending === true
  };
  await writeProfileInitializationState(nextState);

  return {
    isFirstLaunch,
    showWelcomeWizard: isFirstLaunch || nextState.welcomeWizardPending || (isFreshInstall && !onboardingComplete)
  };
});

ipcMain.handle('mark-onboarding-complete', async (_event, completed) => {
  let state = {};
  try { state = JSON.parse(await fs.promises.readFile(profileInitializationPath, 'utf8')); } catch {}
  await writeProfileInitializationState({
    ...state,
    hasInitializedFreshProfile: true,
    freshInstall: Boolean(state.freshInstall),
    onboardingComplete: Boolean(completed),
    welcomeWizardPending: !completed
  });
  return true;
});

ipcMain.handle('load-user-data', async () => {
  try {
    if (fs.existsSync(storageFilePath)) {
      const raw = fs.readFileSync(storageFilePath, 'utf8');
      const data = JSON.parse(raw);
      console.log(`[Storage] Loaded persistent user data from: ${storageFilePath}`);
      return data;
    }
  } catch (err) {
    console.error('[Storage] Error loading user data:', err);
  }
  return null;
});

let saveUserDataQueue = Promise.resolve();
ipcMain.handle('save-user-data', async (event, data) => {
  saveUserDataQueue = saveUserDataQueue.then(async () => {
    try {
      if (!fs.existsSync(userDataPath)) {
        await fs.promises.mkdir(userDataPath, { recursive: true });
      }
      const tmpPath = storageFilePath + '.tmp';
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.promises.rename(tmpPath, storageFilePath);
      if (typeof data?.onboardingDone === 'boolean') {
        let profileState = {};
        try { profileState = JSON.parse(await fs.promises.readFile(profileInitializationPath, 'utf8')); } catch {}
        await writeProfileInitializationState({
          ...profileState,
          hasInitializedFreshProfile: true,
          freshInstall: Boolean(profileState.freshInstall),
          onboardingComplete: data.onboardingDone,
          welcomeWizardPending: !data.onboardingDone
        });
      }
      return true;
    } catch (err) {
      console.error('[Storage] Error saving user data asynchronously:', err);
      return false;
    }
  }).catch(err => {
    console.error('[Storage] saveUserDataQueue failure:', err);
    return false;
  });
  return saveUserDataQueue;
});

// ------------------------------------------------------------------------
// ECHO ROOMS / PARTY MULTI-DEVICE SYNC & GLOBAL TUNNEL (CLOUDFLARE/LOCALTUNNEL)
// ------------------------------------------------------------------------
let networkMode = 'local'; // 'local' | 'global'
let globalTunnelUrl = null;
let cloudflaredProc = null;
let tunnelStarting = false;
let localtunnelInstance = null;

function watchLocalTunnel(tunnel) {
  localtunnelInstance = tunnel;
  const markDisconnected = (reason) => {
    console.warn('[Tunnel] Localtunnel disconnected; LAN Rooms remain available:', reason || 'closed');
    if (localtunnelInstance === tunnel) {
      localtunnelInstance = null;
      globalTunnelUrl = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('room-network-changed', { networkMode, globalTunnelUrl, tunnelStarting: false });
    }
  };
  tunnel.on('error', error => markDisconnected(error?.message || error));
  tunnel.on('close', () => markDisconnected('closed'));
}

function getCloudflaredPath() {
  const userDataDir = app.getPath('userData');
  const extractedExe = path.join(userDataDir, 'cloudflared.exe');

  // 1. If already valid on disk in userData, use it
  if (fs.existsSync(extractedExe)) {
    try {
      if (fs.statSync(extractedExe).size > 10000000) {
        return extractedExe;
      }
    } catch (e) {}
  }

  // Always prepare the mutable tunnel binary under userData before spawning.
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'cloudflared.exe'),
    path.join(__dirname, 'cloudflared.exe'),
    path.join(process.resourcesPath || '', 'cloudflared.exe'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'cloudflared.exe')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        fs.copyFileSync(c, extractedExe);
        console.log('[Tunnel] Successfully extracted cloudflared to real disk:', extractedExe);
        return extractedExe;
      } catch (err) {
        console.warn('[Tunnel] Copy error for candidate:', c, err);
      }
    }
  }

  return null;
}

async function startGlobalTunnel() {
  if (globalTunnelUrl) return globalTunnelUrl;
  if (tunnelStarting) {
    while (tunnelStarting) {
      await new Promise(r => setTimeout(r, 200));
    }
    return globalTunnelUrl;
  }

  tunnelStarting = true;

  return new Promise((resolve) => {
    let resolved = false;
    let fallbackStarted = false;
    const timeout = setTimeout(() => void fallback('Cloudflared timed out after 35 seconds'), 35000);

    const fallback = async (reason) => {
      if (resolved || fallbackStarted) return;
      fallbackStarted = true;
      clearTimeout(timeout);
      console.warn(`[Tunnel] ${reason}; attempting localtunnel fallback. LAN Rooms remain available either way.`);
      try {
        const localtunnel = require('localtunnel');
        const tunnel = await localtunnel({ port: proxyPort, local_host: '127.0.0.1' });
        if (resolved) {
          tunnel.close?.();
          return;
        }
        watchLocalTunnel(tunnel);
        globalTunnelUrl = tunnel.url;
        resolved = true;
        tunnelStarting = false;
        console.log('[Tunnel] Localtunnel fallback active:', globalTunnelUrl);
        resolve(globalTunnelUrl);
      } catch (error) {
        resolved = true;
        tunnelStarting = false;
        console.error('[Tunnel] Localtunnel fallback error:', error);
        resolve(null);
      }
    };

    const cfPath = getCloudflaredPath();
    console.log('[Tunnel] Spawning cloudflared from:', cfPath);

    try {
      if (!cfPath) {
        void fallback('Bundled cloudflared.exe is unavailable');
        return;
      }
      cloudflaredProc = spawn(cfPath, ['tunnel', '--url', `http://127.0.0.1:${proxyPort}`]);

      const onData = (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[^\s|]+\.trycloudflare\.com/i);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          tunnelStarting = false;
          globalTunnelUrl = match[0];
          console.log('[Tunnel] Cloudflare Quick Tunnel active at:', globalTunnelUrl);
          resolve(globalTunnelUrl);
        }
      };

      if (cloudflaredProc.stdout) cloudflaredProc.stdout.on('data', onData);
      if (cloudflaredProc.stderr) cloudflaredProc.stderr.on('data', onData);

      cloudflaredProc.on('error', async (err) => {
        console.warn('[Tunnel] cloudflared spawn error:', err.message);
        void fallback(`Cloudflared could not start: ${err.message}`);
      });

      cloudflaredProc.on('close', (code) => {
        if (!resolved && !fallbackStarted) void fallback(`Cloudflared exited (${code}) before opening a tunnel`);
      });
    } catch (err) {
      void fallback(`Cloudflared setup failed: ${err.message}`);
    }
  });
}

function stopGlobalTunnel() {
  if (cloudflaredProc) {
    try { cloudflaredProc.kill(); } catch (e) {}
    cloudflaredProc = null;
  }
  if (localtunnelInstance) {
    try { localtunnelInstance.close(); } catch (e) {}
    localtunnelInstance = null;
  }
  globalTunnelUrl = null;
  tunnelStarting = false;
}

app.on('will-quit', () => {
  clearInterval(roomSyncTickTimer);
  roomSyncTickTimer = null;
  stopGlobalTunnel();
});

ipcMain.handle('get-room-info', async () => {
  const addressInfo = getRoomAddressInfo();
  const { localIp, joinUrl } = addressInfo;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      width: 260
    });
  } catch (err) {
    console.error('[Room] QR Generation error:', err);
  }
  return {
    roomId: currentRoomId,
    localIp,
    lanAddresses: addressInfo.lanAddresses,
    lanJoinUrl: addressInfo.lanJoinUrl,
    tunnelJoinUrl: addressInfo.tunnelJoinUrl,
    port: proxyPort,
    joinUrl,
    qrDataUrl,
    connectedCount: [...connectedClients].filter(client => client.roomId === currentRoomId && client.readyState === 1).length,
    networkMode,
    globalTunnelUrl,
    tunnelStarting
  };
});

ipcMain.handle('set-room-network-mode', async (event, mode) => {
  if (mode === 'global') {
    networkMode = 'global';
    if (!globalTunnelUrl) {
      await startGlobalTunnel();
    }
  } else {
    networkMode = 'local';
  }
  const addressInfo = getRoomAddressInfo();
  const { localIp, joinUrl } = addressInfo;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      width: 260
    });
  } catch (err) {}

  return {
    roomId: currentRoomId,
    joinUrl,
    qrDataUrl,
    networkMode,
    globalTunnelUrl,
    localIp,
    lanAddresses: addressInfo.lanAddresses,
    lanJoinUrl: addressInfo.lanJoinUrl,
    tunnelJoinUrl: addressInfo.tunnelJoinUrl,
    port: proxyPort
  };
});

ipcMain.handle('regenerate-room-id', async () => {
  currentRoomId = generate6DigitCode();
  clearRoomSyncTickIfIdle();
  syncRoomMetaToFirebaseRtdb(currentRoomId);
  const addressInfo = getRoomAddressInfo();
  const { localIp, joinUrl } = addressInfo;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      width: 260
    });
  } catch (err) {
    console.error('[Room] QR Generation error:', err);
  }
  return {
    roomId: currentRoomId,
    localIp,
    lanAddresses: addressInfo.lanAddresses,
    lanJoinUrl: addressInfo.lanJoinUrl,
    tunnelJoinUrl: addressInfo.tunnelJoinUrl,
    port: proxyPort,
    joinUrl,
    qrDataUrl,
    connectedCount: [...connectedClients].filter(client => client.roomId === currentRoomId && client.readyState === 1).length,
    networkMode,
    globalTunnelUrl
  };
});

ipcMain.handle('set-room-id', async (event, customCode) => {
  let cleaned = (customCode || '').toString().trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!cleaned || cleaned.length < 3) {
    cleaned = generate6DigitCode();
  }
  currentRoomId = cleaned;
  clearRoomSyncTickIfIdle();
  syncRoomMetaToFirebaseRtdb(currentRoomId);
  const addressInfo = getRoomAddressInfo();
  const { localIp, joinUrl } = addressInfo;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      width: 260
    });
  } catch (err) {
    console.error('[Room] QR Generation error:', err);
  }
  return {
    roomId: currentRoomId,
    localIp,
    lanAddresses: addressInfo.lanAddresses,
    lanJoinUrl: addressInfo.lanJoinUrl,
    tunnelJoinUrl: addressInfo.tunnelJoinUrl,
    port: proxyPort,
    joinUrl,
    qrDataUrl,
    connectedCount: [...connectedClients].filter(client => client.roomId === currentRoomId && client.readyState === 1).length,
    networkMode,
    globalTunnelUrl
  };
});

ipcMain.handle('open-external-url', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('firebase-auth-start', async () => {
  if (!firebaseWebConfig?.apiKey) throw new Error('Firebase configuration is not available.');
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const pending = {
    state: randomBytes(32).toString('hex'),
    createdAt: Date.now(),
    privateKey: ecdh.getPrivateKey().toString('base64url')
  };
  await savePendingFirebaseLogin(pending);
  pendingFirebaseLogin = pending;
  const signInUrl = new URL(firebaseHostingOrigin);
  signInUrl.searchParams.set('state', pending.state);
  signInUrl.searchParams.set('pub', ecdh.getPublicKey().toString('base64url'));
  try {
    await shell.openExternal(signInUrl.href);
    return true;
  } catch (error) {
    pendingFirebaseLogin = null;
    await clearPendingFirebaseLogin().catch(() => {});
    throw new Error('Could not open the Google sign-in page.');
  }
});

ipcMain.handle('firebase-auth-get-user', async () => {
  const session = await readFirebaseSession();
  if (!session) return null;
  try {
    const result = await refreshFirebaseSession(session);
    return result?.profile ? { ...result.profile, idToken: result.idToken || session.idToken, offline: Boolean(result.offline) } : null;
  } catch (error) {
    console.warn('[Firebase Auth] Session refresh unavailable:', error.message);
    return session.profile ? { ...session.profile, idToken: session.idToken, offline: true } : null;
  }
});

ipcMain.handle('firebase-auth-signout', async () => {
  pendingFirebaseLogin = null;
  await clearPendingFirebaseLogin().catch(() => {});
  await clearFirebaseSession();
  mainWindow?.webContents.send('firebase-auth-result', { success: true, user: null });
  return true;
});

ipcMain.handle('broadcast-room-state', (event, data) => {
  if (Object.prototype.hasOwnProperty.call(data, 'track')) {
    currentRoomTrack = data.track ? {
      ...data.track,
      streamUrl: getRoomStreamUrl(data.track.id),
      lanStreamUrl: getLanRoomStreamUrl(data.track.id)
    } : null;
  }
  currentRoomNextTrack = data.nextTrack || null;
  currentRoomIncomingTrack = data.incomingTrack || null;
  currentRoomIncomingPosition = Number.isFinite(data.incomingPosition) ? data.incomingPosition : 0;
  currentRoomIsCrossfading = Boolean(data.isCrossfading);
  currentRoomCrossfadeProgress = currentRoomIsCrossfading
    ? Math.max(0, Math.min(1, Number(data.crossfadeProgress) || 0))
    : 0;
  if (data.isPlaying !== undefined) currentRoomIsPlaying = data.isPlaying;
  if (data.position !== undefined) currentRoomPosition = data.position;
  currentRoomStateAt = Date.now();
  if (data.lyrics) currentRoomLyrics = data.lyrics;
  if (Number.isFinite(data.outputLatencyMs)) {
    currentRoomOutputLatencyMs = Math.max(0, Math.min(1000, data.outputLatencyMs));
  }
  if (Number.isFinite(data.crossfadeDurationMs)) {
    currentRoomCrossfadeDurationMs = Math.max(0, Math.min(30000, data.crossfadeDurationMs));
  }

  const snapshot = createRoomSnapshot(data.type || 'state_sync');
  const outgoingState = {
    ...snapshot,
    streamUrl: currentRoomTrack?.streamUrl || null,
    lanStreamUrl: currentRoomTrack?.lanStreamUrl || null,
    roomCode: currentRoomId,
    hostConnected: true,
    trackId: currentRoomTrack?.id == null ? null : String(currentRoomTrack.id),
    positionSec: Number(snapshot.position) || 0,
    hostSentAtMs: Date.now(),
    sequenceId: ++roomPlaybackSequenceId
  };
  latestRoomState = outgoingState;
  roomPlaybackState = {
    roomCode: currentRoomId,
    hostConnected: true,
    track: outgoingState.track,
    streamUrl: outgoingState.streamUrl,
    trackId: outgoingState.trackId,
    isPlaying: outgoingState.isPlaying,
    positionSec: outgoingState.positionSec,
    hostSentAtMs: outgoingState.hostSentAtMs,
    updatedAtMs: outgoingState.hostSentAtMs,
    sequenceId: outgoingState.sequenceId
  };
  broadcastToRoom(outgoingState);
  syncRoomStateToFirebaseRtdb(currentRoomId, outgoingState, Boolean(data.force || data.type === 'track_change'));
  return true;
});

ipcMain.handle('realign-room-devices', () => {
  broadcastToRoom(createRoomSyncTick(true));
  return true;
});

ipcMain.handle('send-room-sync-pulse', () => {
  const targetServerTime = Date.now() + 300;
  broadcastToRoom({ type: 'pulse', targetServerTime });
  return targetServerTime;
});

ipcMain.handle('import-playlist-metadata', async (event, url) => {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return { success: false, message: 'Please enter a valid playlist URL' };

  // 1. Spotify Playlist
  const spotifyMatch = rawUrl.match(/playlist\/([a-zA-Z0-9]+)/i);
  if (spotifyMatch) {
    const playlistId = spotifyMatch[1];
    return new Promise((resolve) => {
      const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
      https.get(embedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const nextIdx = body.indexOf('id="__NEXT_DATA__"');
            if (nextIdx === -1) {
              return resolve({ success: false, message: 'Could not extract playlist data from Spotify embed page.' });
            }
            const start = body.indexOf('>', nextIdx) + 1;
            const end = body.indexOf('</script>', start);
            const json = JSON.parse(body.slice(start, end));
            const entity = json?.props?.pageProps?.state?.data?.entity;
            const title = entity?.name || entity?.title || 'Spotify Playlist';
            const rawTracks = Array.isArray(entity?.trackList) ? entity.trackList : [];
            const tracks = rawTracks.map(t => ({
              title: String(t.title || '').trim(),
              artist: String(t.subtitle || '').trim(),
              durationSec: Math.round((Number(t.duration) || 210000) / 1000)
            })).filter(t => t.title);

            if (!tracks.length) {
              return resolve({ success: false, message: 'No tracks found in Spotify playlist.' });
            }
            resolve({ success: true, title, source: 'spotify', tracks });
          } catch (e) {
            resolve({ success: false, message: `Spotify parse error: ${e.message}` });
          }
        });
      }).on('error', err => {
        resolve({ success: false, message: `Network error reaching Spotify: ${err.message}` });
      });
    });
  }

  // 2. YouTube / YouTube Music Playlist
  const ytMatch = rawUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (ytMatch) {
    const listId = ytMatch[1];
    const browseId = listId.startsWith('VL') ? listId : 'VL' + listId;
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US'
          }
        },
        browseId
      });

      const req = https.request('https://music.youtube.com/youtubei/v1/browse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const title = data.microformat?.microformatDataRenderer?.title || 'YouTube Music Playlist';

            const extractRenderers = (obj) => {
              if (!obj || typeof obj !== 'object') return [];
              const list = [];
              if (obj.musicResponsiveListItemRenderer) list.push(obj.musicResponsiveListItemRenderer);
              for (const k of Object.keys(obj)) list.push(...extractRenderers(obj[k]));
              return list;
            };

            const renderers = extractRenderers(data.contents);
            const tracks = [];
            for (const item of renderers) {
              const cols = item.flexColumns || [];
              const trackTitle = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
              const artistRuns = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
              const artist = artistRuns.map(r => r.text).filter(t => t && t !== ' • ' && t !== ' & ').join(', ');
              const videoId = item.playlistItemData?.videoId || item.navigationEndpoint?.watchEndpoint?.videoId;
              const thumb = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;

              if (trackTitle) {
                tracks.push({
                  id: videoId || undefined,
                  title: trackTitle.trim(),
                  artist: artist ? artist.trim() : 'Unknown Artist',
                  thumbnail: thumb || undefined,
                  artwork: thumb || undefined,
                  source: 'innertube'
                });
              }
            }

            if (!tracks.length) {
              return resolve({ success: false, message: 'No tracks found in YouTube playlist or playlist is private.' });
            }
            resolve({ success: true, title, source: 'youtube', tracks });
          } catch (e) {
            resolve({ success: false, message: `YouTube Music parse error: ${e.message}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, message: `Network error reaching YouTube Music: ${err.message}` });
      });

      req.write(postData);
      req.end();
    });
  }

  return { success: false, message: 'Unrecognized URL. Please provide a Spotify or YouTube Music playlist link.' };
});

ipcMain.handle('export-lyric-card', async (event, { dataUrl, fileName }) => {
  try {
    const base64Data = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const safeName = (fileName || 'MeloPair_Lyric_Card.png').replace(/[^\w\s.-]/gi, '_');

    const defaultPath = path.join(app.getPath('pictures') || app.getPath('downloads'), safeName);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export 9:16 Kinetic Lyric Card',
      defaultPath,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    await fs.promises.writeFile(result.filePath, buffer);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// ---------------------------------------------------------------------------
// GitHub Releases In-App Updater for Desktop
// ---------------------------------------------------------------------------
let lastUpdateCheckTime = 0;
let cachedUpdateInfo = null;
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const parseParts = (v) => String(v).replace(/^v/i, '').trim().split('.').map(n => parseInt(n, 10) || 0);
  const r = parseParts(remote);
  const l = parseParts(local);
  for (let i = 0; i < Math.max(r.length, l.length, 3); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function checkGitHubReleases(manual = false) {
  return new Promise((resolve) => {
    const now = Date.now();
    if (!manual && cachedUpdateInfo && (now - lastUpdateCheckTime < UPDATE_CHECK_INTERVAL_MS)) {
      return resolve(cachedUpdateInfo);
    }

    const options = {
      hostname: 'api.github.com',
      path: '/repos/mohit4236b-svg/MeloPair/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': 'MeloPair-Desktop/' + app.getVersion(),
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn('[Updater] GitHub API returned status:', res.statusCode);
          return resolve({ available: false, currentVersion: app.getVersion(), error: `HTTP ${res.statusCode}` });
        }
        try {
          const release = JSON.parse(data);
          const rawTag = release.tag_name || release.name || '';
          const remoteVersion = rawTag.replace(/^v/i, '').trim();
          const currentVersion = app.getVersion();

          lastUpdateCheckTime = Date.now();

          if (isNewerVersion(remoteVersion, currentVersion)) {
            const assets = release.assets || [];
            const exeAsset = assets.find(a => (a.name || '').toLowerCase().endsWith('.exe')) || assets[0];
            const updateData = {
              available: true,
              version: remoteVersion,
              currentVersion: currentVersion,
              releaseNotes: release.body || 'New improvements and bug fixes.',
              downloadUrl: exeAsset ? exeAsset.browser_download_url : release.html_url,
              releasePageUrl: release.html_url,
              publishedAt: release.published_at || new Date().toISOString(),
              assetName: exeAsset ? exeAsset.name : `MeloPair-Setup-${remoteVersion}.exe`,
              assetSize: exeAsset ? exeAsset.size : 0
            };
            cachedUpdateInfo = updateData;
            return resolve(updateData);
          } else {
            const notAvail = { available: false, currentVersion: currentVersion };
            cachedUpdateInfo = notAvail;
            return resolve(notAvail);
          }
        } catch (e) {
          console.warn('[Updater] Failed to parse release response:', e);
          resolve({ available: false, currentVersion: app.getVersion(), error: e.message });
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[Updater] Network error checking releases:', err);
      resolve({ available: false, currentVersion: app.getVersion(), error: err.message });
    });

    req.end();
  });
}

function downloadFileWithRedirects(fileUrl, destPath, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    let parsed;
    try {
      parsed = new URL(fileUrl);
    } catch (e) {
      return reject(e);
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(fileUrl, {
      headers: {
        'User-Agent': 'MeloPair-Desktop/' + app.getVersion(),
        'Accept': 'application/octet-stream'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, fileUrl).href;
        }
        res.resume();
        return downloadFileWithRedirects(redirectUrl, destPath, onProgress, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Server returned HTTP ${res.statusCode}`));
      }
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && typeof onProgress === 'function') {
          const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          onProgress(pct, downloadedBytes, totalBytes);
        }
      });
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destPath));
      });
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

ipcMain.handle('check-for-updates', async (_event, manual = false) => {
  const info = await checkGitHubReleases(Boolean(manual));
  return info;
});

ipcMain.handle('download-update', async () => {
  if (!cachedUpdateInfo || !cachedUpdateInfo.available || !cachedUpdateInfo.downloadUrl) {
    return { success: false, error: 'No update available' };
  }
  const destName = cachedUpdateInfo.assetName || `MeloPair-Setup-${cachedUpdateInfo.version}.exe`;
  const destPath = path.join(app.getPath('temp'), destName);

  try {
    mainWindow?.webContents?.send('update-status', { type: 'progress', progress: 0 });
    await downloadFileWithRedirects(cachedUpdateInfo.downloadUrl, destPath, (pct, downloaded, total) => {
      mainWindow?.webContents?.send('update-status', { type: 'progress', progress: pct, downloaded, total });
    });
    mainWindow?.webContents?.send('update-status', { type: 'downloaded', filePath: destPath, version: cachedUpdateInfo.version });
    await shell.openPath(destPath);
    return { success: true, filePath: destPath };
  } catch (err) {
    console.error('[Updater] Download error:', err);
    mainWindow?.webContents?.send('update-status', { type: 'error', error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-update-url', async (_event, url) => {
  const targetUrl = url || cachedUpdateInfo?.releasePageUrl || 'https://github.com/mohit4236b-svg/MeloPair/releases';
  await shell.openExternal(targetUrl);
  return { success: true };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});
