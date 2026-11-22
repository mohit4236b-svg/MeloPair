import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

const button = document.getElementById('googleSignIn');
const status = document.getElementById('status');
const returnToApp = document.getElementById('returnToApp');
const signInUrl = new URL(location.href);
const state = signInUrl.searchParams.get('state');
const desktopPublicKey = signInUrl.searchParams.get('pub');

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function encryptSessionForDesktop(session) {
  const publicBytes = decodeBase64Url(desktopPublicKey);
  if (publicBytes.length !== 65) throw new Error('The desktop sign-in request is incomplete. Start again from MeloPair.');
  const desktopKey = await crypto.subtle.importKey('raw', publicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeralKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: desktopKey }, ephemeralKeys.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const encryptionKey = await crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(state),
    info: new TextEncoder().encode('MeloPair Firebase sign-in v1')
  }, hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, new TextEncoder().encode(JSON.stringify(session)));
  const publicKey = await crypto.subtle.exportKey('raw', ephemeralKeys.publicKey);
  return { pub: encodeBase64Url(publicKey), iv: encodeBase64Url(iv), data: encodeBase64Url(ciphertext) };
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

if (!state || !/^[a-f0-9]{64}$/i.test(state) || !desktopPublicKey) {
  button.disabled = true;
  setStatus('Open this sign-in page from MeloPair to continue.', true);
} else {
  try {
    const response = await fetch('/firebase-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load Firebase settings.');
    const config = await response.json();
    const auth = getAuth(initializeApp(config));
    await setPersistence(auth, inMemoryPersistence);

    button.addEventListener('click', async () => {
      button.disabled = true;
      setStatus('Opening Google sign-in…');
      try {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        const idToken = await result.user.getIdToken();
        const refreshToken = result?._tokenResponse?.refreshToken || result.user?.stsTokenManager?.refreshToken;
        if (!idToken || !refreshToken) throw new Error('Firebase did not return a complete sign-in session. Please try again.');
        const encrypted = await encryptSessionForDesktop({ idToken, refreshToken });
        const callback = new URL('echoplayer://auth');
        callback.searchParams.set('state', state);
        callback.searchParams.set('pub', encrypted.pub);
        callback.searchParams.set('iv', encrypted.iv);
        callback.searchParams.set('data', encrypted.data);
        if (returnToApp) returnToApp.href = callback.href;
        setStatus('Signed in. Returning to MeloPair… If asked, allow the browser to open the app.');
        history.replaceState(null, '', '/');
        location.replace(callback.href);
        setTimeout(() => {
          button.disabled = false;
          if (returnToApp) returnToApp.hidden = false;
          setStatus('If MeloPair did not open, use the button below to return to the app.', true);
        }, 2500);
      } catch (error) {
        button.disabled = false;
        if (error?.code === 'auth/popup-closed-by-user') {
          setStatus('Sign-in was cancelled. You can try again.');
        } else {
          console.error('MeloPair Google sign-in failed:', error);
          setStatus('Google sign-in failed. Please try again.', true);
        }
      }
    });
  } catch (error) {
    console.error('MeloPair sign-in setup failed:', error);
    button.disabled = true;
    setStatus('Sign-in could not be initialized. Please try again later.', true);
  }
}
