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
    // 1. Broken Heart / Separation / Breakup
    {
      keywords: [
        'broken', 'heartbreak', 'heartbroken', 'toot', 'tuta', 'tut', 'tutgi', 'tutiya',
        'ਟੁੱਟ', 'ਟੁੱਟਿਆ', 'ਟੁੱਟਗੀ', 'ਟੁੱਟੇ', 'ਟੁੱਟਾ', 'ਟੁਟਿਆ', 'ਟੁਟਗੀ',
        'टूट', 'टूटा', 'टूटी', 'टूटते'
      ],
      emoji: '💔'
    },
    // 2. Love / Romance
    {
      keywords: [
        'pyar', 'pyaar', 'love', 'ishq', 'mohabbat',
        'ਪਿਆਰ', 'प्यार', 'ਇਸ਼ਕ', 'मोहब्बत'
      ],
      emoji: '💘'
    },
    // 3. Heart / Soul / Life
    {
      keywords: [
        'heart', 'dil', 'jaan', 'wanna', 'yours', 'baby', 'babe', 'babydoll', 'kiss',
        'sweetheart', 'darling', 'sohniye',
        'ਦਿਲ', 'ਜਾਨ', 'ਸੋਹਣੀਏ', 'ਸੋਹਣੀ', 'दिल', 'जान', 'सोनिया'
      ],
      emoji: '❤️'
    },
    // 4. Fire / Flame / Burn / Passion
    {
      keywords: [
        'fire', 'burn', 'flame', 'aag', 'junoon', 'jalna',
        'ਅੱਗ', 'ਅੱਗਾਂ', 'ਜਨੂਨ', 'ਜਲਨਾ', 'आग', 'जुनून', 'जलना'
      ],
      emoji: '🔥'
    },
    // 5. Night / Moon / Sky / Stars
    {
      keywords: [
        'night', 'moon', 'star', 'stars', 'sky', 'dark', 'raat', 'chaand', 'chand', 'sitare', 'aasmaan',
        'ਰਾਤ', 'ਚੰਦ', 'ਤਾਰੇ', 'ਅਸਮਾਨ', 'रात', 'चाँद', 'तारे', 'सितारे', 'आसमान'
      ],
      emoji: '🌙'
    },
    // 6. King / Crown / Boss / Pride
    {
      keywords: [
        'king', 'crown', 'queen', 'boss', 'badshah', 'hukum', 'sher', 'rani', 'raja',
        'ਤਾਜ', 'ਸ਼ੇਰ', 'ਰਾਜਾ', 'ਰਾਣੀ', 'ਜਿੱਤ', 'ਜਿੱਤਾਂ', 'राजा', 'रानी', 'बादशाह', 'ताज', 'शेर'
      ],
      emoji: '👑'
    },
    // 7. Time / Clock / Waiting
    {
      keywords: [
        'time', 'wait', 'clock', 'forever', 'waqt', 'samay', 'pal', 'lamha', 'ghadi', 'deir', 'intezaar',
        'ਸਮਾਂ', 'ਵਕਤ', 'ਪਲ', 'ਲੰਘਿਆ', 'ਇੰਤਜ਼ਾਰ', 'समय', 'वक्त', 'वक़्त', 'पल', 'लम्हा', 'इंतज़ार'
      ],
      emoji: '⏳'
    },
    // 8. Eyes / Sight / Vision
    {
      keywords: [
        'eyes', 'eye', 'see', 'look', 'watch', 'aankh', 'aankhein', 'aankhen', 'nazar', 'naina', 'akh', 'akhan',
        'ਅੱਖ', 'ਅੱਖਾਂ', 'ਆਖ', 'नज़र', 'आँखें', 'आँख', 'आंख', 'नयना', 'नयन'
      ],
      emoji: '👀'
    },
    // 9. Home / Village / House
    {
      keywords: [
        'home', 'house', 'room', 'pind', 'village', 'ghar', 'kamra', 'vacuum', 'cleaner',
        'ਪਿੰਡ', 'ਪਿੰਡਾਂ', 'ਘਰ', 'ਕਮਰਾ', 'घर', 'कमरा', 'मकान', 'गांव', 'गाँव'
      ],
      emoji: '🏡'
    },
    // 10. Car / Vehicle / Road / Travel
    {
      keywords: [
        'car', 'drive', 'ride', 'road', 'highway', 'ford', 'gaadi', 'gaddi', 'sadak',
        'ਗੱਡੀ', 'ਸੜਕ', 'ਕਾਰ', 'गाड़ी', 'सड़क', 'कार'
      ],
      emoji: '🚘'
    },
    // 11. Money / Wealth / Cash
    {
      keywords: [
        'money', 'cash', 'rich', 'dollar', 'dollars', 'paisa', 'paise', 'crore', 'lakh', 'daulat', 'rupaye',
        'ਪੈਸਾ', 'ਪੈਸੇ', 'ਦੌਲਤ', 'ਕਰੋੜ', 'पैसा', 'पैसे', 'रुपया', 'दौलत'
      ],
      emoji: '💸'
    },
    // 12. God / Blessing / Faith / Prayer
    {
      keywords: [
        'god', 'rab', 'rabb', 'babe', 'baba', 'waheguru', 'bhagwan', 'bless', 'prayer', 'dua',
        'ਰੱਬ', 'ਰੱਬਾ', 'ਬਾਬੇ', 'ਬਾਬਾ', 'ਵਾਹਿਗੁਰੂ', 'भगवान', 'रब', 'दुआ', 'प्रार्थना'
      ],
      emoji: '🙏'
    },
    // 13. Music / Song / Melody / Beat
    {
      keywords: [
        'music', 'song', 'sing', 'beat', 'rhythm', 'gaana', 'geet', 'dhun', 'sangeet',
        'ਸੰਗੀਤ', 'ਗੀਤ', 'ਗਾਣਾ', 'ਧੁਨ', 'संगीत', 'गाना', 'गीत', 'धुन'
      ],
      emoji: '🎵'
    },
    // 14. Clothing / Fashion
    {
      keywords: ['shirt', 'blouse', 'dress', 'coat', 'sweater', 'kapde', 'kurta', 'ਕੱਪੜੇ', 'ਕੁੜਤਾ', 'कपड़े', 'कुर्ता'],
      emoji: '👕'
    },
    // 15. Coffee / Tea
    {
      keywords: ['coffee', 'hot', 'tea', 'cup', 'chai', 'ਚਾਹ', 'चाय', 'कॉफ़ी'],
      emoji: '☕'
    },
    // 16. Breath / Wind / Air
    {
      keywords: ['breathin', 'breathe', 'dust', 'air', 'wind', 'hawa', 'saans', 'ਹਵਾ', 'ਸਾਹ', 'हवा', 'साँस', 'सांस'],
      emoji: '💨'
    },
    // 17. Rain / Tears / Sadness
    {
      keywords: [
        'rust', 'rain', 'tears', 'cry', 'sad', 'pain', 'baarish', 'barsaat', 'aansu', 'dard', 'rona',
        'ਮੀਂਹ', 'ਅੱਥਰੂ', 'ਦਰਦ', 'ਰੋਣਾ', 'बारिश', 'आँसू', 'दर्द', 'रोना', 'बरसात'
      ],
      emoji: '🌧️'
    },
    // 18. Secrets / Mind / Dreams / Thoughts
    {
      keywords: [
        'secrets', 'mind', 'think', 'thought', 'dream', 'head', 'khwab', 'sapna', 'soch',
        'ਸੋਚ', 'ਸੁਪਨਾ', 'ਖ਼ਵਾਬ', 'सोचा', 'ख्वाब', 'सपना', 'सोच'
      ],
      emoji: '💭'
    },
    // 19. Sun / Morning / Light
    {
      keywords: ['sun', 'morning', 'light', 'shine', 'subah', 'dhoop', 'roshni', 'ਸੂਰਜ', 'ਰੋਸ਼ਨੀ', 'ਸਵੇਰ', 'सूरज', 'रोशनी', 'धूप', 'सुबह'],
      emoji: '✨'
    },
    // 20. Dance / Move / Party
    {
      keywords: ['dance', 'move', 'groove', 'party', 'nach', 'nachna', 'bhangra', 'ਨੱਚ', 'ਭੰਗੜਾ', 'ਨਾਚ', 'डांस', 'भांगड़ा'],
      emoji: '💃'
    },
    // 21. Phone / Call / Talking
    {
      keywords: [
        'phone', 'call', 'calling', 'ring', 'ringing', 'dial', 'number', 'fone', 'phon',
        'hello', 'talk', 'gal', 'baat', 'bol', 'bolna', 'sun', 'suno', 'awaaz',
        'ਗੱਲ', 'ਬੋਲ', 'ਸੁਣ', 'ਆਵਾਜ਼', 'कॉल', 'बात', 'फोन', 'फ़ोन'
      ],
      emoji: '📱'
    },
    // 22. Guns / Weapons / Street Power
    {
      keywords: [
        'asle', 'asla', 'gun', 'guns', 'shot', 'bullet', 'bullets', 'shoot',
        'rifle', 'pistol', 'bandook', 'goli', 'raund', 'hathyar', 'gang', 'jatt', 'dabka', 'shonk', 'bandookan',
        'ਸ਼ੌਂਕ', 'ਸ਼ੌਂਕੀ', 'ਅਸਲਾ', 'ਬੰਦੂਕ', 'ਜੱਟ', 'ਹਥਿਆਰ'
      ],
      emoji: '🔫'
    },
    // 23. Friends / Brotherhood / Mother / Family
    {
      keywords: [
        'bebe', 'maa', 'mom', 'mother', 'baapu', 'papa', 'dad', 'family',
        'yaar', 'yaari', 'dost', 'dosti', 'bhai', 'veere', 'bro', 'friends', 'crew',
        'ਬੇਬੇ', 'ਮਾਂ', 'ਬਾਪੂ', 'ਯਾਰ', 'ਯਾਰੀ', 'ਵੀਰੇ', 'ਦੋਸਤ'
      ],
      emoji: '🫂'
    },
    // 24. Drink / Cheers / Party
    {
      keywords: [
        'drink', 'drinks', 'peg', 'daru', 'daaru', 'wine', 'beer', 'sharab', 'bottle', 'glass', 'cheers',
        'ਦਾਰੂ', 'ਸ਼ਰਾਬ', 'ਪੈੱਗ', 'नशा', 'दारू', 'शराब'
      ],
      emoji: '🥂'
    },
    // 25. Vibe / Chill / Calm / Glow
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
   * Always includes \p{M} so vowel signs and combining marks are NEVER stripped!
   */
  function normalizeWord(rawWord) {
    if (!rawWord) return '';
    return rawWord
      .replace(/^[^\p{L}\p{M}\p{N}]+/gu, '')
      .replace(/[^\p{L}\p{M}\p{N}]+$/gu, '')
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

  /**
   * Unicode-safe string line decorator.
   * Prepends matched emoji with a space before the word, capped at 1-2 emojis per line.
   * Preserves sentence word order and never mutates or slices inside Indic characters or combining matras.
   */
  function decorateLine(text, autoEmoji = true) {
    if (!text || typeof text !== 'string') return '';
    if (!autoEmoji) return text;

    try {
      const rawTokens = text.trim().split(/\s+/).filter(w => w.length > 0);
      if (rawTokens.length === 0) return text;

      let emojiCount = 0;
      const maxEmojis = 2;
      const usedEmojis = new Set();
      const matchedEmojiForToken = new Map();

      for (let i = 0; i < rawTokens.length; i++) {
        if (emojiCount >= maxEmojis) break;
        const emoji = getEmojiForWord(rawTokens[i]);
        if (emoji && !usedEmojis.has(emoji)) {
          usedEmojis.add(emoji);
          matchedEmojiForToken.set(i, emoji);
          emojiCount++;
        }
      }

      if (emojiCount === 0) return text;

      return rawTokens.map((token, idx) => {
        if (matchedEmojiForToken.has(idx)) {
          return `${matchedEmojiForToken.get(idx)} ${token}`;
        }
        return token;
      }).join(' ');
    } catch (err) {
      console.warn('[EmojiMapper] decorateLine error, falling back to raw text:', err);
      return text;
    }
  }

  return {
    getEmojiForWord,
    renderKineticWords,
    processKineticLine,
    normalizeWord,
    isNonLatinText,
    decorateLine,
    EMOJI_DICTIONARY,
    GUARANTEED_FALLBACK_EMOJIS
  };
});
