/**
 * Deterministic Test Fixtures for EchoPlayerDesktop E2E Test Suite
 * Hardware agnostic, offline, reproducible fixtures for tracks, LRC lyrics, room state, and audio.
 */

function createSilentWavDataUrl(durationSeconds = 2, sampleRate = 8000) {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = Buffer.alloc(44 + numSamples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byte rate
  buffer.writeUInt16LE(1, 32); // block align
  buffer.writeUInt16LE(8, 34); // 8-bit
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples, 40);
  buffer.fill(128, 44); // 128 is mid-level silence for 8-bit unsigned PCM
  return 'data:audio/wav;base64,' + buffer.toString('base64');
}

const SILENT_AUDIO_URL = createSilentWavDataUrl(3);

const MOCK_TRACKS = [
  {
    id: 'trk_1',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'pop'
  },
  {
    id: 'trk_2',
    title: 'Espresso',
    artist: 'Sabrina Carpenter',
    album: 'Short n Sweet',
    duration: 175,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'pop'
  },
  {
    id: 'trk_3',
    title: 'Levitating',
    artist: 'Dua Lipa',
    album: 'Future Nostalgia',
    duration: 203,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'dance'
  },
  {
    id: 'trk_4',
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    duration: 269,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'rock'
  },
  {
    id: 'trk_5',
    title: 'Starboy',
    artist: 'The Weeknd',
    album: 'Starboy',
    duration: 230,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'rnb'
  },
  {
    id: 'trk_6',
    title: 'Kesariya',
    artist: 'Arijit Singh',
    album: 'Brahmastra',
    duration: 268,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'bollywood'
  },
  {
    id: 'trk_multilingual',
    title: 'ਕੇਸਰੀ - तेरी मिट्टी (Teri Mitti)',
    artist: 'B Praak',
    album: 'Kesari',
    duration: 315,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'bollywood'
  },
  {
    id: 'trk_long_title',
    title: "When You Believe - From The Prince of Egypt / Original Motion Picture Soundtrack / Remastered 2024 Anniversary Edition",
    artist: 'Whitney Houston & Mariah Carey',
    album: 'Original Motion Picture Soundtrack',
    duration: 272,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'soundtrack'
  },
  {
    id: 'trk_zero_dur',
    title: 'Zero Duration Track',
    artist: 'Silence',
    album: 'Void',
    duration: 0,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'ambient'
  },
  {
    id: 'trk_live',
    title: 'Echo Ambient Live Stream',
    artist: 'Echo Live Radio',
    album: 'Live 24/7',
    duration: Infinity,
    thumbnail: 'default-art.png',
    url: SILENT_AUDIO_URL,
    genre: 'live'
  }
];

const MOCK_LYRICS = {
  synced: `[00:00.00] Echo Ambient Intro
[00:05.00] I've been on my own for long enough
[00:10.00] Maybe you can show me how to love, maybe
[00:15.00] I'm going through withdrawals
[00:20.00] You don't even have to do too much
[00:25.00] You can turn me on with just a touch, baby
[00:30.00] I look around and Sin City's cold and empty
[00:35.00] No one's around to judge me
[00:40.00] I can't see clearly when you're gone
[00:45.00] I said, ooh, I'm blinded by the lights
[00:50.00] No, I can't sleep until I feel your touch`,

  plain: `First plain lyric verse
Second plain lyric verse without timestamps
The chorus starts right here
And continues to the end smoothly`,

  corrupted: `[99:99.99] Corrupted future timestamp
[-01:00.00] Negative timestamp
[invalid-tag] Line with no numeric timestamp
[00:05.00] Valid second chronological line
[00:02.00] Out of order first valid line
Just plain text without brackets`,

  empty: ''
};

const MOCK_ROOM_INFO = {
  roomId: '849201',
  hostAddress: '127.0.0.1:38473',
  networkMode: 'lan',
  members: 2
};

const MOCK_USER_DATA = {
  favorites: ['trk_1', 'trk_2'],
  history: ['trk_1'],
  downloaded: ['trk_3'],
  settings: {
    theme: 'crimson',
    crossfadeDuration: 6
  }
};

const MOCK_BOOM3D_SETTINGS = {
  enabled: true,
  width: 175,
  bass: 7.5,
  elevation: 45,
  nightMode: false
};

module.exports = {
  createSilentWavDataUrl,
  SILENT_AUDIO_URL,
  MOCK_TRACKS,
  MOCK_LYRICS,
  MOCK_ROOM_INFO,
  MOCK_USER_DATA,
  MOCK_BOOM3D_SETTINGS
};
