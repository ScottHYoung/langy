const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CEDICT_PATH = path.join(PROJECT_ROOT, 'corpus_raw', 'cedict_ts.u8');

const toneMarks = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ']
};

let cedictCache = null;
const wiktionaryCache = new Map();

function loadCedict() {
  if (cedictCache) return cedictCache;
  let content;
  try {
    content = fs.readFileSync(CEDICT_PATH, 'utf8');
  } catch (error) {
    console.warn('Unable to load CEDICT data:', error.message);
    cedictCache = { simplified: new Map(), traditional: new Map() };
    return cedictCache;
  }

  const simplified = new Map();
  const traditional = new Map();
  const lines = content.split(/\r?\n/);
  const lineRegex = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/;

  lines.forEach((line) => {
    if (!line || line.startsWith('#')) return;
    const match = lineRegex.exec(line.trim());
    if (!match) return;
    const [, traditionalForm, simplifiedForm, pinyinRaw, definitionsRaw] = match;
    const definitions = definitionsRaw
      .split('/')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => sanitizeDefinition(entry))
      .filter(Boolean);
    const entry = {
      traditional: traditionalForm,
      simplified: simplifiedForm,
      pinyinRaw: pinyinRaw.trim(),
      pinyin: convertNumericPinyin(pinyinRaw.trim()),
      definitions
    };
    if (!simplified.has(simplifiedForm)) {
      simplified.set(simplifiedForm, []);
    }
    simplified.get(simplifiedForm).push(entry);
    if (!traditional.has(traditionalForm)) {
      traditional.set(traditionalForm, []);
    }
    traditional.get(traditionalForm).push(entry);
  });

  cedictCache = { simplified, traditional };
  return cedictCache;
}

function sanitizeDefinition(text) {
  if (!text) return '';
  let cleaned = text.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\(CL:[^)]+\)/gi, '').replace(/\bCL:[^;,/]+/gi, '').trim();
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '').trim();
  if (cleaned.length > 160) {
    cleaned = `${cleaned.slice(0, 157).trim()}…`;
  }
  return cleaned;
}

function convertNumericPinyin(value) {
  if (!value || typeof value !== 'string') return '';
  const normalized = value
    .replace(/u:/gi, 'ü')
    .replace(/v/gi, 'ü')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  return normalized.replace(/([a-zA-ZüÜ·']+)([1-5])/g, (_, syllable, toneDigit) => {
    const tone = Number.parseInt(toneDigit, 10);
    return applyToneMark(syllable, tone);
  });
}

function applyToneMark(syllable, tone) {
  if (!syllable) return '';
  if (!tone || tone === 5) {
    return syllable.replace(/v/gi, 'ü');
  }
  const vowels = ['a', 'e', 'o', 'u', 'i', 'ü'];
  const lower = syllable.toLowerCase();
  let targetIndex = -1;
  if (lower.includes('a')) {
    targetIndex = lower.indexOf('a');
  } else if (lower.includes('e')) {
    targetIndex = lower.indexOf('e');
  } else if (lower.includes('ou')) {
    targetIndex = lower.indexOf('o');
  } else {
    for (let i = lower.length - 1; i >= 0; i -= 1) {
      if (vowels.includes(lower[i])) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex === -1) {
    return syllable.replace(/[1-5]/g, '');
  }

  const chars = syllable.replace(/v/gi, 'ü').split('');
  const baseChar = chars[targetIndex];
  const toneSet = toneMarks[baseChar.toLowerCase()];
  if (!toneSet) {
    return chars.join('');
  }
  const markedChar = baseChar === baseChar.toUpperCase() ? toneSet[tone - 1].toUpperCase() : toneSet[tone - 1];
  chars[targetIndex] = markedChar;
  return chars.join('').replace(/[1-5]/g, '');
}

function lookupCedict(word) {
  if (!word || typeof word !== 'string') return null;
  const trimmed = word.trim();
  if (!trimmed) return null;
  const { simplified, traditional } = loadCedict();
  const candidates = simplified.get(trimmed) || traditional.get(trimmed) || null;
  if (!candidates || !candidates.length) return null;
  const entry = candidates[0];
  const gloss = entry.definitions[0] || '';
  if (!gloss) return null;
  return {
    word: trimmed,
    pinyin: entry.pinyin || entry.pinyinRaw || '',
    gloss,
    note: 'CEDICT'
  };
}

async function lookupWiktionary(word) {
  if (!word || typeof word !== 'string') return null;
  const trimmed = word.trim();
  if (!trimmed) return null;
  if (wiktionaryCache.has(trimmed)) {
    return wiktionaryCache.get(trimmed);
  }
  const params = new URLSearchParams({
    action: 'parse',
    prop: 'wikitext',
    redirects: '1',
    format: 'json',
    page: trimmed
  });
  const url = `https://zh.wiktionary.org/w/api.php?${params.toString()}`;
  let parsed = null;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LangyApp/0.1 (+https://langy.local)',
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      wiktionaryCache.set(trimmed, null);
      return null;
    }
    const payload = await response.json();
    const wikitext = payload?.parse?.wikitext?.['*'];
    if (!wikitext) {
      wiktionaryCache.set(trimmed, null);
      return null;
    }
    const definitions = extractChineseDefinitions(wikitext);
    const pinyin = extractMandarinPinyin(wikitext);
    if (!definitions.length) {
      wiktionaryCache.set(trimmed, null);
      return null;
    }
    parsed = {
      word: trimmed,
      pinyin: pinyin || '',
      gloss: definitions[0],
      note: 'Wiktionary'
    };
    wiktionaryCache.set(trimmed, parsed);
    return parsed;
  } catch (error) {
    console.warn(`Wiktionary lookup failed for "${trimmed}":`, error.message);
    wiktionaryCache.set(trimmed, null);
    return null;
  }
}

function extractChineseDefinitions(wikitext) {
  const lines = wikitext.split('\n');
  const definitions = [];
  let inChineseSection = false;
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const sectionMatch = line.match(/^==\s*(.+?)\s*==$/);
    if (sectionMatch) {
      const label = sectionMatch[1];
      const normalizedLabel = label.replace(/\s+/g, '').toLowerCase();
      inChineseSection =
        normalizedLabel.includes('漢語') ||
        normalizedLabel.includes('汉语') ||
        normalizedLabel.includes('chinese');
      return;
    }
    if (!inChineseSection) return;
    if (line.startsWith('#') && !line.startsWith('#:') && !line.startsWith('#*') && !line.startsWith('##')) {
      const content = line.replace(/^#+\s*/, '');
      const stripped = stripWikiMarkup(content);
      if (stripped) {
        definitions.push(truncate(stripped, 160));
      }
    }
  });
  return definitions;
}

function stripWikiMarkup(text) {
  if (!text) return '';
  let output = text;
  output = output.replace(/\{\{lang\|[^|]+\|([^}]+)\}\}/gi, '$1');
  output = output.replace(/\{\{[^{}]*\|([^{}|]+)\}\}/g, '$1');
  while (/\{\{[^{}]*\}\}/.test(output)) {
    output = output.replace(/\{\{[^{}]*\}\}/g, '');
  }
  output = output.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2');
  output = output.replace(/\[\[([^\]]+)\]\]/g, '$1');
  output = output.replace(/'''?/g, '');
  output = output.replace(/&nbsp;/gi, ' ');
  output = output.replace(/<[^>]+>/g, '');
  output = output.replace(/\s+/g, ' ').trim();
  return output;
}

function extractMandarinPinyin(wikitext) {
  const match = wikitext.match(/\{\{zh-pron[\s\S]*?\}\}/i);
  if (!match) return '';
  const block = match[0];
  const paramRegex = /\|([a-z0-9\-]+)\s*=\s*([^\n]+)\n?/gi;
  const candidates = [];
  let current;
  while ((current = paramRegex.exec(block))) {
    const key = current[1].trim();
    const value = cleanTemplateValue(current[2]);
    if (!key.startsWith('m') || !value) continue;
    if (/[\u4e00-\u9fff]/.test(value)) continue;
    const normalized = normalizePinyin(value);
    if (!normalized) continue;
    candidates.push({ key, raw: value, normalized });
  }
  if (!candidates.length) return '';
  const ranked = candidates
    .map((entry) => ({
      ...entry,
      score: scorePinyinCandidate(entry)
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.normalized || '';
}

function cleanTemplateValue(rawValue = '') {
  let cleaned = rawValue.replace(/<!--.*?-->/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('{{') && cleaned.endsWith('}}')) {
    const inner = cleaned.slice(2, -2);
    const parts = inner.split('|').filter(Boolean);
    if (parts.length > 1) {
      cleaned = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      cleaned = parts[0];
    }
  }
  cleaned = cleaned.replace(/\[\[([^\]]+)\]\]/g, '$1');
  return cleaned.trim();
}

function normalizePinyin(value) {
  if (!value) return '';
  let text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/\d/.test(text)) {
    text = convertNumericPinyin(text);
  }
  if (!/[a-zA-Z]/.test(text)) {
    return '';
  }
  return text;
}

function scorePinyinCandidate(entry) {
  let score = 0;
  if (!entry) return score;
  if (/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(entry.normalized)) {
    score += 3;
  }
  if (/\d/.test(entry.raw)) {
    score += 1;
  }
  if (entry.key === 'm' || entry.key === 'm-p') {
    score += 2;
  } else if (entry.key === 'm-s') {
    score += 1;
  }
  return score;
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

async function resolveGlossesLocally(targets = []) {
  if (!Array.isArray(targets) || !targets.length) {
    return { resolved: [], unresolved: [] };
  }
  const resolved = [];
  const unresolved = [];
  targets.forEach((target) => {
    const entry = lookupCedict(target.word);
    if (entry) {
      resolved.push({
        key: target.key,
        word: target.word,
        pinyin: entry.pinyin,
        gloss: entry.gloss,
        note: entry.note
      });
    } else {
      unresolved.push(target);
    }
  });

  if (!unresolved.length) {
    return { resolved, unresolved: [] };
  }

  const wiktionaryResults = await fetchWiktionaryForTargets(unresolved);
  resolved.push(...wiktionaryResults.resolved);
  return {
    resolved,
    unresolved: wiktionaryResults.unresolved
  };
}

async function fetchWiktionaryForTargets(targets, concurrency = 2) {
  if (!targets.length) {
    return { resolved: [], unresolved: [] };
  }
  const resolved = [];
  const unresolved = [];
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const target = targets[index];
      try {
        const entry = await lookupWiktionary(target.word);
        if (entry && entry.gloss) {
          resolved.push({
            key: target.key,
            word: target.word,
            pinyin: entry.pinyin,
            gloss: entry.gloss,
            note: entry.note
          });
        } else {
          unresolved.push(target);
        }
      } catch (error) {
        console.warn(`Failed Wiktionary lookup for "${target.word}":`, error.message);
        unresolved.push(target);
      }
    }
  }

  const workerCount = Math.min(concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { resolved, unresolved };
}

module.exports = {
  resolveGlossesLocally
};
