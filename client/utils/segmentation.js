const DEFAULT_MAX_WORD_LENGTH = 6;

const CHINESE_PUNCTUATION = new Set(
  Array.from('，。！？；：、（）「」『』《》〈〉【】—…－～·“”‘’｡﹐﹑﹔﹖﹗')
);

const ASCII_PUNCTUATION = new Set(
  Array.from(',.;:?!()[]{}<>"\'-—…/\\')
);

const SENTENCE_FINAL_PUNCTUATION = new Set(
  Array.from('。！？!?；;')
);

function isWhitespace(char) {
  return /\s/.test(char);
}

function isChinesePunctuation(char) {
  return CHINESE_PUNCTUATION.has(char);
}

function isAsciiPunctuation(char) {
  return ASCII_PUNCTUATION.has(char);
}

function isPunctuation(char) {
  return isChinesePunctuation(char) || isAsciiPunctuation(char);
}

function isCjkChar(char) {
  if (!char) return false;
  const code = char.codePointAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0x2ceb0 && code <= 0x2ebef) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

function classifyChar(char) {
  if (char === '\n') return 'newline';
  if (isWhitespace(char)) return 'space';
  if (isPunctuation(char)) return 'punct';
  if (/[A-Za-z0-9]/.test(char)) return 'latin';
  if (isCjkChar(char)) return 'word';
  return 'other';
}

function fallbackSegment(text, dictionary, maxWordLength) {
  const segments = [];
  const dict = dictionary instanceof Set ? dictionary : new Set(dictionary || []);
  const maxLength =
    Number.isFinite(maxWordLength) && maxWordLength > 0
      ? Math.floor(maxWordLength)
      : DEFAULT_MAX_WORD_LENGTH;
  let index = 0;
  const length = text.length;
  while (index < length) {
    const char = text[index];
    if (char === '\n') {
      segments.push('\n');
      index += 1;
      continue;
    }
    if (isWhitespace(char)) {
      let whitespace = char;
      index += 1;
      while (index < length && isWhitespace(text[index]) && text[index] !== '\n') {
        whitespace += text[index];
        index += 1;
      }
      segments.push(whitespace);
      continue;
    }
    if (isPunctuation(char)) {
      segments.push(char);
      index += 1;
      continue;
    }
    let matched = '';
    const maxWindow = Math.min(maxLength, length - index);
    for (let windowSize = maxWindow; windowSize > 0; windowSize -= 1) {
      const slice = text.slice(index, index + windowSize);
      if (dict.has(slice)) {
        matched = slice;
        break;
      }
    }
    if (matched) {
      segments.push(matched);
      index += matched.length;
      continue;
    }
    segments.push(char);
    index += 1;
  }
  return segments;
}

function isPureCjk(text) {
  if (!text) return false;
  for (const char of text) {
    if (!isCjkChar(char)) {
      return false;
    }
  }
  return true;
}

function shouldKeepCompoundWord(word, dictionary, frequencyMap) {
  if (!word || word.length <= 1) return true;
  if (dictionary?.has?.(word)) return true;
  if (frequencyMap && Number.isFinite(frequencyMap[word]) && frequencyMap[word] > 0) {
    return true;
  }
  return false;
}

function splitCompoundWord(word, dictionary, frequencyMap, maxWordLength) {
  if (!isPureCjk(word)) {
    return [word];
  }
  const chars = Array.from(word);
  const n = chars.length;
  const maxLen = Math.min(maxWordLength || DEFAULT_MAX_WORD_LENGTH, n);
  const scores = new Array(n + 1).fill(-Infinity);
  const nextStep = new Array(n + 1).fill(1);
  scores[n] = 0;

  for (let i = n - 1; i >= 0; i -= 1) {
    let bestScore = -Infinity;
    let bestLen = 1;
    const remaining = n - i;
    const limit = Math.min(maxLen, remaining);
    for (let len = 1; len <= limit; len += 1) {
      const slice = chars.slice(i, i + len).join('');
      const allowed =
        len === 1 ||
        dictionary?.has?.(slice) ||
        (frequencyMap && Number.isFinite(frequencyMap[slice]) && frequencyMap[slice] > 0);
      if (!allowed) continue;
      const wordScore = computeCompoundScore(slice, dictionary, frequencyMap);
      const candidateScore = wordScore + scores[i + len];
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestLen = len;
      }
    }
    if (bestScore === -Infinity) {
      bestScore = scores[i + 1];
      bestLen = 1;
    }
    scores[i] = bestScore;
    nextStep[i] = bestLen;
  }

  const segments = [];
  let cursor = 0;
  while (cursor < n) {
    const len = nextStep[cursor] || 1;
    segments.push(chars.slice(cursor, cursor + len).join(''));
    cursor += len;
  }
  return segments;
}

function computeCompoundScore(word, dictionary, frequencyMap) {
  if (!word) return -Infinity;
  if (word.length === 1) {
    return Math.log((frequencyMap?.[word] || 5) + 1);
  }
  const base = dictionary?.has?.(word) ? 3 : 0;
  const freq = frequencyMap?.[word] || 0;
  return base + Math.log(freq + 1);
}

function refineTokens(tokens, dictionary, frequencyMap, maxWordLength) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return tokens || [];
  }
  const refined = [];
  tokens.forEach((token) => {
    if (!token || token.length <= 1 || !isPureCjk(token)) {
      refined.push(token);
      return;
    }
    if (shouldKeepCompoundWord(token, dictionary, frequencyMap)) {
      refined.push(token);
      return;
    }
    const split = splitCompoundWord(token, dictionary, frequencyMap, maxWordLength);
    refined.push(...split);
  });
  return refined;
}

function normalizeTokens(tokens) {
  const normalized = [];
  tokens.forEach((token) => {
    if (!token) return;
    let buffer = '';
    let bufferType = null;
    for (const char of token) {
      const type = classifyChar(char);
      if (!buffer) {
        buffer = char;
        bufferType = type;
        continue;
      }
      if (type === bufferType) {
        buffer += char;
        continue;
      }
      normalized.push({ text: buffer, type: bufferType });
      buffer = char;
      bufferType = type;
    }
    if (buffer) {
      normalized.push({ text: buffer, type: bufferType });
    }
  });
  return normalized;
}

function annotateSentences(segments) {
  const annotated = [];
  let sentenceIndex = 0;
  segments.forEach((segment) => {
    const entry = {
      text: segment.text,
      type: segment.type,
      sentenceIndex
    };
    annotated.push(entry);
    const lastChar = segment.text.slice(-1);
    const isSentenceBreak =
      segment.type === 'newline' ||
      (segment.type === 'punct' && SENTENCE_FINAL_PUNCTUATION.has(lastChar));
    if (isSentenceBreak) {
      sentenceIndex += 1;
    }
  });
  return annotated;
}

function buildSentenceContexts(annotated) {
  const sentences = [];
  annotated.forEach((segment) => {
    if (!sentences[segment.sentenceIndex]) {
      sentences[segment.sentenceIndex] = {
        index: segment.sentenceIndex,
        text: ''
      };
    }
    const carrier = sentences[segment.sentenceIndex];
    carrier.text += segment.text;
  });
  return sentences
    .filter(Boolean)
    .map((sentence) => ({
      index: sentence.index,
      text: sentence.text.trim()
    }))
    .filter((sentence) => sentence.text.length > 0);
}

export function segmentChineseText(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { segments: [], sentences: [] };
  }
  const normalizedText = text.replace(/\r\n/g, '\n');
  const dictionary = options.dictionary || new Set();
  const frequencyMap =
    options.frequencyMap && typeof options.frequencyMap === 'object' ? options.frequencyMap : null;
  const maxWordLength =
    typeof options.maxWordLength === 'number' ? options.maxWordLength : DEFAULT_MAX_WORD_LENGTH;
  const preferJieba = options.preferJieba === true;

  let rawTokens = [];
  if (preferJieba && typeof window !== 'undefined') {
    const candidate = window.jieba || window.Jieba || (window.jiebaJS && window.jiebaJS.jieba);
    if (candidate && typeof candidate.cut === 'function') {
      try {
        const cutResult = candidate.cut(normalizedText, true);
        if (Array.isArray(cutResult) && cutResult.length) {
          rawTokens = cutResult;
        }
      } catch (error) {
        // silently fall back to dictionary-based segmentation
      }
    }
  }

  if (!Array.isArray(rawTokens) || !rawTokens.length) {
    rawTokens = fallbackSegment(normalizedText, dictionary, maxWordLength);
  }

  const refinedTokens = refineTokens(rawTokens, dictionary, frequencyMap, maxWordLength);
  const normalizedTokens = normalizeTokens(refinedTokens);
  const annotated = annotateSentences(normalizedTokens);
  const sentences = buildSentenceContexts(annotated);
  return {
    segments: annotated,
    sentences
  };
}
