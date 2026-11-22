const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
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
              streamCache.set(id, { url: streamUrl, timestamp: Date.now() });
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
              streamCache.set(songId, { url, timestamp: Date.now() });
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
  await saveFirebaseSession({ refreshToken: data.refresh_token || session.refreshToken, profile });
  return { profile, offline: false };
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
  await saveFirebaseSession({ refreshToken, profile });
  return profile;
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
  return {
    localIp,
    lanAddresses,
    lanJoinUrl,
    tunnelJoinUrl,
    joinUrl: networkMode === 'global' && tunnelJoinUrl ? tunnelJoinUrl : lanJoinUrl
  };
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

    // 3. Audio Streaming Proxy with Byte-Range Support & Universal CORS
    if (reqUrl.pathname === '/stream') {
      const videoId = reqUrl.searchParams.get('id');
      const streamMetadata = {
        title: reqUrl.searchParams.get('title') || '',
        artist: reqUrl.searchParams.get('artist') || '',
        duration: Number(reqUrl.searchParams.get('duration')) || 0
      };
      console.log('[DIAG-AUDIO] HTTP GET /stream for videoId:', videoId, 'Range:', req.headers.range || 'full');
      if (!videoId) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'text/plain' });
        return res.end('Missing video id');
      }

      try {
        const streamUrl = await resolveStreamUrl(videoId, streamMetadata);
        if (!streamUrl) {
          res.writeHead(502, { ...corsHeaders, 'Content-Type': 'text/plain' });
          return res.end('Unable to resolve audio stream');
        }

        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        };
        if (req.headers.range) {
          headers['Range'] = req.headers.range;
        }

        pipeWithRedirects(streamUrl, headers, (err, clientRes) => {
          if (err || !clientRes) {
            console.error('Stream pipe error:', err);
            if (!res.headersSent) {
              res.writeHead(500, { ...corsHeaders, 'Content-Type': 'text/plain' });
              res.end('Proxy streaming error');
            }
            return;
          }

          const proxyHeaders = {
            ...corsHeaders,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Type': clientRes.headers['content-type'] || 'audio/webm',
            'Accept-Ranges': 'bytes'
          };
          if (clientRes.headers['content-length']) {
            proxyHeaders['Content-Length'] = clientRes.headers['content-length'];
          }
          if (clientRes.headers['content-range']) {
            proxyHeaders['Content-Range'] = clientRes.headers['content-range'];
          }

          res.writeHead(clientRes.statusCode, proxyHeaders);
          clientRes.pipe(res);

          req.on('close', () => {
            clientRes.destroy();
          });
        });
      } catch (err) {
        console.error('Stream resolution error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'text/plain' });
          res.end('Error resolving audio');
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

function ensureYtDlpExtracted() {
  try {
    const userDataDir = app.getPath('userData');
    const targetPath = path.join(userDataDir, 'yt-dlp.exe');
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 50000) {
      return targetPath;
    }
    const sources = [
      path.join(process.resourcesPath || '', 'bin', 'yt-dlp.exe'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'yt-dlp.exe'),
      path.join(__dirname, 'yt-dlp.exe').replace('app.asar', 'app.asar.unpacked'),
      ...(!app.isPackaged ? [path.join(__dirname, 'yt-dlp.exe')] : [])
    ];
    for (const src of sources) {
      if (!src.includes('app.asar\\') && !src.includes('app.asar/') && fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, targetPath);
          console.log('[yt-dlp] Mirrored binary to userData:', targetPath);
          return targetPath;
        } catch (copyErr) {
          console.warn('[yt-dlp] Copy error:', copyErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[yt-dlp] ensureYtDlpExtracted warning:', err.message);
  }
  return null;
}

function getYtDlpPath() {
  // Prefer the writable userData copy so self-updates never target the
  // read-only installation directory or resources folder.
  try {
    const userDataExe = path.join(app.getPath('userData'), 'yt-dlp.exe');
    if (fs.existsSync(userDataExe) && fs.statSync(userDataExe).size > 50000) {
      return userDataExe;
    }
  } catch (e) {}

  // In packaged builds, copy the bundled extraResource into userData before
  // spawning it. Never depend on a developer PATH or run from app.asar.
  if (app.isPackaged) {
    const extracted = ensureYtDlpExtracted();
    if (extracted) return extracted;
    console.warn('[yt-dlp] Could not prepare writable userData copy.');
    return null;
  }

  // 3. Dev mode path (only if physically unbundled on disk, never within app.asar)
  if (!app.isPackaged) {
    const devPath = path.join(__dirname, 'yt-dlp.exe');
    if (fs.existsSync(devPath) && !devPath.includes('app.asar')) {
      return devPath;
    }
  }

  // 4. Mirror to userData if not yet present
  const extracted = ensureYtDlpExtracted();
  if (extracted) return extracted;

  // No developer-only Python path or unverified PATH command in production.
  return null;
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

function runYtDlp(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ytDlpCmd = getYtDlpPath();
    if (!ytDlpCmd) return resolve({ code: -1, stdout: '', stderr: 'Bundled yt-dlp.exe is missing.' });
    const child = spawn(ytDlpCmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', error => {
      clearTimeout(timeout);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
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

async function resolveStreamUrl(videoId, metadata = {}) {
  if (!videoId) return null;

  if (streamCache.has(videoId)) {
    const cached = streamCache.get(videoId);
    if (Date.now() - cached.timestamp < 1000 * 60 * 60 * 5) {
      console.log('[DIAG-AUDIO] resolveStreamUrl CACHE HIT for videoId:', videoId, 'cachedUrl:', cached.url.slice(0, 80) + '...');
      return cached.url;
    }
  }

  console.log('[DIAG-AUDIO] resolveStreamUrl CACHE MISS - resolving videoId:', videoId);

  if (videoId.startsWith('saavn_')) {
    const saavnUrl = await resolveSaavnTrack(videoId);
    if (saavnUrl) return saavnUrl;
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

  const result = await runYtDlp(['-f', 'ba/b', '-g', `https://www.youtube.com/watch?v=${selectedVideoId}`]);
  const url = result.stdout.trim().split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith('http'));
  if (result.code === 0 && url) {
    streamCache.set(videoId, { url, timestamp: Date.now() });
    console.log('[Stream Proxy] Extracted audio stream URL for', videoId, 'from', selectedVideoId);
    return url;
  }
  console.warn(`[Stream Proxy] yt-dlp exit ${result.code}:`, result.stderr.slice(0, 200));
  return null;
}

// Official YouTube Music InnerTube Search Engine (Lightning Fast & 100% Pure Music)
function searchYouTubeMusic(query) {
  const explicitVideoSearch = /\bvideo\b/i.test(String(query || ''));
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
      query: query
    });

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
          resolve([]);
        }
      });
    });

    req.on('error', (err) => {
      console.error('InnerTube request error:', err);
      resolve([]);
    });

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
  ensureYtDlpExtracted();
  startAudioProxy();
  createWindow();
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
  return `http://127.0.0.1:${proxyPort}/stream?${params.toString()}`;
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
    .replace(/\s*[\[(]\s*(?:(?:feat(?:uring)?|ft)\.?|with|official(?:\s+(?:music\s+)?(?:audio|video|lyrics?))?)[^\])]*[\])]/giu, ' ')
    .replace(/\s*-\s*(?:remaster(?:ed)?(?:\s+\d{4})?|lyric\s+video)\b.*$/iu, ' ')
    .replace(/\b(?:feat(?:uring)?|ft)\.?\s+.*$/iu, ' ')
    .replace(/\b(?:official\s+(?:music\s+)?(?:audio|video|lyrics?)|lyric\s+video)\b/giu, ' ')
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
  return artist.split(/\s*(?:&|,|\/|;|\bfeat(?:uring)?\.?\b|\bft\.?\b|\bwith\b|\s+x\s+)\s*/iu)[0].trim();
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
    ]);

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
    // Tier 1: exact metadata lookup, without duration filtering.
    const exactUrl = new URL('https://lrclib.net/api/get');
    exactUrl.searchParams.set('track_name', cleanTitle);
    exactUrl.searchParams.set('artist_name', primaryArtist);
    try {
      const record = await fetchLyricsJson(exactUrl);
      if (lyricsRecordMatches(record, cleanTitle, primaryArtist)) {
        const exactResult = makeLyricsResponse(record, targetDuration, 'LRCLIB', Boolean(hasManualLyricOffset));
        if (exactResult?.synced) return exactResult;
        if (exactResult) records.push(record);
      }
    } catch (error) {
      console.warn('[Lyrics] LRCLIB exact lookup failed:', error.message);
    }

    // Tier 2: run both LRCLIB search forms; duration is only a ranking signal,
    // never a reason to discard a valid lyric record.
    const searchUrls = [];
    const byFields = new URL('https://lrclib.net/api/search');
    byFields.searchParams.set('track_name', cleanTitle);
    byFields.searchParams.set('artist_name', primaryArtist);
    searchUrls.push(byFields);
    const byQuery = new URL('https://lrclib.net/api/search');
    byQuery.searchParams.set('q', `${cleanTitle} ${primaryArtist}`.trim());
    searchUrls.push(byQuery);

    for (const searchUrl of searchUrls) {
      try {
        const results = await fetchLyricsJson(searchUrl);
        if (Array.isArray(results)) records.push(...results);
      } catch (error) {
        console.warn('[Lyrics] LRCLIB search failed:', error.message);
      }
    }
    const uniqueRecords = [...new Map(records.map(record => [
      `${normalizeLyricsMatchText(record.trackName)}|${normalizeLyricsMatchText(record.artistName)}|${Number(record.duration) || 0}`,
      record
    ])).values()];
    const candidates = uniqueRecords
      .filter(record => lyricsRecordMatches(record, cleanTitle, primaryArtist))
      .sort((a, b) => {
        const syncedPriority = Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics));
        if (syncedPriority) return syncedPriority;
        const aDelta = targetDuration > 0 ? Math.abs((Number(a.duration) || 0) - targetDuration) : 0;
        const bDelta = targetDuration > 0 ? Math.abs((Number(b.duration) || 0) - targetDuration) : 0;
        if (aDelta !== bDelta) return aDelta - bDelta;
        return lyricsTitleSimilarity(cleanTitle, b.trackName) - lyricsTitleSimilarity(cleanTitle, a.trackName);
      });
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
    ], { env: { ...process.env, PATH: mediaToolPath } });

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
    return result?.profile ? { ...result.profile, offline: Boolean(result.offline) } : null;
  } catch (error) {
    console.warn('[Firebase Auth] Session refresh unavailable:', error.message);
    return session.profile ? { ...session.profile, offline: true } : null;
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
