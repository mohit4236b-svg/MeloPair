/**
 * emojiMapper.js - Exact "Versi" Kinetic Typography Engine & Multilingual Emoji Injector
 * Supports English, Hindi (Devanagari), Hinglish, Punjabi (Gurmukhi), and universal lyrics.
 * Unicode-safe punctuation stripping, inline emoji placement, and editorial italic accent.
 */

(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (typeof root === 'object' && root) {
    root.EmojiMapper = exported;
  }
  if (typeof window !== 'undefined') {
    window.EmojiMapper = exported;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.EmojiMapper = exported;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Exact Multi-Language Dictionary specified for Versi Kinetic Lyrics Engine
  const EMOJI_DICTIONARY = [
    // 1. Home / Room / Space
    {
      keywords: ['vacuum', 'cleaner', 'house', 'home', 'room', 'ghar', 'kamra', 'घर', 'कमरा', 'मकान'],
      emoji: '🏠'
    },
    // 2. Car / Road / Travel
    {
      keywords: ['car', 'ford', 'drive', 'ride', 'road', 'highway', 'gaadi', 'gaddi', 'sadak', 'गाड़ी', 'सड़क', 'कार'],
      emoji: '🚗'
    },
    // 3. Clothing / Fashion
    {
      keywords: ['shirt', 'blouse', 'dress', 'coat', 'sweater', 'kapde', 'kurta', 'कपड़े', 'कुर्ता'],
      emoji: '👕'
    },
    // 4. Coffee / Tea
    {
      keywords: ['coffee', 'hot', 'tea', 'cup', 'chai', 'चाय', 'कॉफ़ी'],
      emoji: '☕'
    },
    // 5. Love / Heart / Romance
    {
      keywords: [
        'love', 'loved', 'loving', 'heart', 'wanna', 'yours', 'baby', 'babe', 'babydoll', 'kiss',
        'sweetheart', 'darling', 'pyaar', 'pyar', 'ishq', 'mohabbat', 'dil', 'jaan', 'sohniye',
        'प्यार', 'इश्क़', 'दिल', 'जान', 'मोहब्बत', 'सोनिया', 'ਸੋਹਣੀਏ', 'ਸੋਹਣੀ', 'ਪਿਆਰ', 'ਦਿਲ', 'ਜਾਨ', 'ਇਸ਼ਕ'
      ],
      emoji: '❤️'
    },
    // 6. Breath / Wind / Air
    {
      keywords: ['breathin', 'breathe', 'dust', 'air', 'wind', 'hawa', 'saans', 'हवा', 'साँस', 'सांस'],
      emoji: '💨'
    },
    // 7. Rain / Tears / Sadness / Pain
    {
      keywords: [
        'rust', 'rain', 'tears', 'cry', 'sad', 'pain', 'baarish', 'barsaat', 'aansu', 'dard', 'rona',
        'बारिश', 'आँसू', 'दर्द', 'रोना', 'बरसात'
      ],
      emoji: '🌧️'
    },
    // 8. Secrets / Mind / Dreams / Thoughts
    {
      keywords: [
        'secrets', 'mind', 'think', 'thought', 'dream', 'head', 'khwab', 'sapna', 'soch',
        'सोचा', 'ख्वाब', 'सपना', 'सोच'
      ],
      emoji: '💭'
    },
    // 9. Eyes / Sight / Vision
    {
      keywords: [
        'eyes', 'eye', 'see', 'look', 'watch', 'aankh', 'aankhein', 'aankhen', 'nazar', 'naina',
        'आँखें', 'आँख', 'नज़र', 'नयना', 'नयन'
      ],
      emoji: '👀'
    },
    // 10. Night / Moon / Stars / Sky
    {
      keywords: [
        'night', 'moon', 'star', 'stars', 'sky', 'dark', 'raat', 'chaand', 'chand', 'sitare', 'aasmaan',
        'रात', 'चाँद', 'तारे', 'सितारे', 'आसमान'
      ],
      emoji: '🌙'
    },
    // 11. Sun / Morning / Light
    {
      keywords: ['sun', 'morning', 'light', 'shine', 'subah', 'dhoop', 'roshni', 'सूरज', 'रोशनी', 'धूप', 'सुबह'],
      emoji: '✨'
    },
    // 12. Fire / Burn / Flame
    {
      keywords: ['fire', 'burn', 'flame', 'aag', 'junoon', 'jalna', 'आग', 'जुनून', 'जलना'],
      emoji: '🔥'
    },
    // 13. Dance / Move / Party
    {
      keywords: ['dance', 'move', 'groove', 'party', 'nach', 'nachna', 'bhangra', 'नाच', 'डांस', 'भांगड़ा'],
      emoji: '💃'
    },
    // 14. Music / Song / Sing / Beat
    {
      keywords: ['music', 'song', 'sing', 'beat', 'rhythm', 'gaana', 'geet', 'dhun', 'संगीत', 'गाना', 'गीत', 'धुन'],
      emoji: '🎶'
    },
    // 15. Time / Wait / Clock
    {
      keywords: ['time', 'wait', 'clock', 'forever', 'waqt', 'pal', 'lamha', 'ghadi', 'deir', 'intezaar', 'इंतज़ार', 'वक्त', 'पल', 'लम्हा'],
      emoji: '⏳'
    },
    // 16. Phone / Call / Talking
    {
      keywords: [
        'phone', 'call', 'calling', 'ring', 'ringing', 'dial', 'number', 'fone', 'phon',
        'hello', 'talk', 'gal', 'baat', 'bol', 'bolna', 'sun', 'suno', 'awaaz', 'कॉल', 'बात', 'फोन', 'फ़ोन'
      ],
      emoji: '📱'
    },
    // 17. Money / Wealth / Cash
    {
      keywords: [
        'money', 'cash', 'rich', 'dollar', 'dollars', 'paisa', 'paise', 'crore', 'lakh',
        'daulat', 'kuttda', 'kamm', 'bills', 'paid', 'rupiye', 'rupaye', 'पैसा', 'पैसे', 'रुपया'
      ],
      emoji: '💸'
    },
    // 18. Guns / Weapons / Street Power
    {
      keywords: [
        'asle', 'asla', 'gun', 'guns', 'shot', 'bullet', 'bullets', 'shoot', 'fire',
        'rifle', 'pistol', 'bandook', 'goli', 'raund', 'hathyar', 'gang', 'jatt', 'dabka', 'shonk', 'bandookan',
        'ਸ਼ੌਂਕ', 'ਸ਼ੌਂਕੀ', 'ਅਸਲਾ', 'ਬੰਦੂਕ', 'ਜੱਟ', 'ਹਥਿਆਰ'
      ],
      emoji: '🔫'
    },
    // 19. Friends / Brotherhood / Mother / Family
    {
      keywords: [
        'bebe', 'maa', 'mom', 'mother', 'baapu', 'papa', 'dad', 'family',
        'yaar', 'yaari', 'dost', 'dosti', 'bhai', 'veere', 'bro', 'friends', 'crew',
        'ਬੇਬੇ', 'ਮਾਂ', 'ਬਾਪੂ', 'ਯਾਰ', 'ਯਾਰੀ', 'ਵੀਰੇ', 'ਦੋਸਤ'
      ],
      emoji: '🫂'
    },
    // 20. Queen / King / Crown / Boss / Beauty
    {
      keywords: [
        'goriye', 'kudi', 'kudiye', 'queen', 'king', 'crown', 'boss', 'badshah', 'hukum', 'rani', 'raja',
        'ਗੋਰੀਏ', 'ਕੁੜੀ', 'ਰਾਣੀ', 'ਰਾਜਾ', 'ਜਿੱਤ', 'ਜਿੱਤਾਂ'
      ],
      emoji: '👑'
    },
    // 21. Drink / Cheers / Party
    {
      keywords: [
        'drink', 'drinks', 'peg', 'daru', 'daaru', 'wine', 'beer', 'sharab', 'bottle', 'glass', 'cheers', 'नशा', 'दारू', 'शराब'
      ],
      emoji: '🥂'
    },
    // 22. Vibe / Chill / Calm / Glow
    {
      keywords: [
        'vibe', 'chill', 'sukoon', 'magic', 'shining', 'glow', 'easy', 'behave', 'shanti', 'सुकून', 'शांति',
        'ਹੱਸ', 'ਹੱਸਕੇ', 'ਰੌਣਕ'
      ],
      emoji: '✨'
    }
  ];

  // Guaranteed subtle fallback mood emojis (vibrant, colorful, and clearly visible across all displays)
  const GUARANTEED_FALLBACK_EMOJIS = ['✨', '🔥', '❤️', '⚡', '🎵', '👑'];

  /**
   * Unicode-aware word normalization (strips surrounding punctuation, preserves Devanagari & Gurmukhi)
   * NEVER uses \W which strips non-Latin Indic characters!
   */
  function normalizeWord(rawWord) {
    if (!rawWord) return '';
    return rawWord
      .replace(/^[^\p{L}\p{N}]+/gu, '')
      .replace(/[^\p{L}\p{N}]+$/gu, '')
      .toLowerCase();
  }

  /**
   * Tests if a string contains non-Latin characters (Devanagari, Gurmukhi, Arabic, etc.)
   */
  function isNonLatinText(text) {
    if (!text) return false;
    return /[^\u0000-\u007F]/.test(text);
  }

  /**
   * Look up matching emoji for a word
   */
  function getEmojiForWord(word) {
    const clean = normalizeWord(word);
    if (!clean || clean.length < 2) return null;

    for (let i = 0; i < EMOJI_DICTIONARY.length; i++) {
      if (EMOJI_DICTIONARY[i].keywords.includes(clean)) {
        return EMOJI_DICTIONARY[i].emoji;
      }
    }
    return null;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * EXACT VERSI ENGINE: renderKineticWords(text, autoEmoji, lineIndex)
   * Used exclusively for Slot 2 (Active Current Line).
   * - Splits words by whitespace
   * - Strips punctuation safely using Unicode \p{L}\p{N}
   * - Injects matched emoji inline right before the word
   * - Limits to at most 2 inline emojis per line
   * - Applies Guaranteed Fallback Rule if autoEmoji is on and no words matched
   * - Applies Editorial Italic Accent on the last word (with faux skewX(-6deg) for Devanagari/Gurmukhi)
   */
  function renderKineticWords(text, autoEmoji = true, lineIndex = 0) {
    if (!text || typeof text !== 'string') return '';
    const rawTokens = text.trim().split(/\s+/).filter(w => w.length > 0);
    if (rawTokens.length === 0) return '';

    let matchedEmojiIndices = new Map();
    let inlineCount = 0;
    const maxInlineEmojis = 2;
    const usedEmojisInLine = new Set();

    if (autoEmoji) {
      for (let i = 0; i < rawTokens.length; i++) {
        if (inlineCount >= maxInlineEmojis) break;
        const matched = getEmojiForWord(rawTokens[i]);
        if (matched && !usedEmojisInLine.has(matched)) {
          usedEmojisInLine.add(matched);
          matchedEmojiIndices.set(i, matched);
          inlineCount++;
        }
      }

      // Guaranteed Fallback Rule: If autoEmoji is enabled and NO word matched dictionary,
      // prepend a subtle mood emoji at the start of the line!
      if (inlineCount === 0 && rawTokens.length > 0) {
        const fallbackEmoji = GUARANTEED_FALLBACK_EMOJIS[Math.abs(lineIndex) % GUARANTEED_FALLBACK_EMOJIS.length];
        matchedEmojiIndices.set(0, fallbackEmoji);
        inlineCount++;
      }
    }

    const lastIdx = rawTokens.length - 1;
    let html = '';

    for (let i = 0; i < rawTokens.length; i++) {
      const token = rawTokens[i];
      const hasInlineEmoji = matchedEmojiIndices.has(i);
      const isLastWord = (i === lastIdx);

      html += '<span class="versi-word-wrap">';

      // Injected Emoji right before word
      if (hasInlineEmoji) {
        const emojiChar = matchedEmojiIndices.get(i);
        html += `<span class="versi-inline-emoji" aria-hidden="true">${emojiChar}</span>`;
      }

      // Word element with editorial accent on the last word
      if (isLastWord) {
        const nonLatin = isNonLatinText(token);
        const transformStyle = nonLatin ? 'display: inline-block; transform: skewX(-6deg);' : '';
        html += `<span class="imm-word imm-word-last versi-editorial-italic" style="font-style: italic; font-weight: 900; ${transformStyle}">${escapeHtml(token)}</span>`;
      } else {
        html += `<span class="imm-word">${escapeHtml(token)}</span>`;
      }

      html += '</span> ';
    }

    return html.trim();
  }

  /**
   * Backwards-compatible line processor for structured token arrays
   */
  function processKineticLine(words, lineIndex = 0) {
    if (!Array.isArray(words) || words.length === 0) return [];
    const text = words.join(' ');
    const rendered = renderKineticWords(text, true, lineIndex);

    const lastIdx = words.length - 1;
    return words.map((w, idx) => {
      const isLastWord = (idx === lastIdx && words.length >= 2);
      const nonLatin = isNonLatinText(w);
      return {
        word: w,
        emoji: getEmojiForWord(w),
        isItalic: isLastWord,
        isNonLatin: nonLatin
      };
    });
  }

  return {
    getEmojiForWord,
    renderKineticWords,
    processKineticLine,
    normalizeWord,
    isNonLatinText,
    EMOJI_DICTIONARY,
    GUARANTEED_FALLBACK_EMOJIS
  };
});
