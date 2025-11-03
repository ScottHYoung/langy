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
  const maxLength = Number.isFinite(maxWordLength) && maxWordLength > 0 ? Math.floor(maxWordLength) : DEFAULT_MAX_WORD_LENGTH;
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
  const maxWordLength =
    typeof options.maxWordLength === 'number' ? options.maxWordLength : DEFAULT_MAX_WORD_LENGTH;
  const preferJieba = options.preferJieba !== false;

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

  const normalizedTokens = normalizeTokens(rawTokens);
  const annotated = annotateSentences(normalizedTokens);
  const sentences = buildSentenceContexts(annotated);
  return {
    segments: annotated,
    sentences
  };
}
