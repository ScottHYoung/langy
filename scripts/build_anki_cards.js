#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { callOpenAIAudio } = require('../src/services/openai');

function printUsage() {
  console.log(
    'Usage: node scripts/build_anki_cards.js --sentences <json> --helpers <json> --output <txt> [--tts-count 3] [--media-dir anki/media]'
  );
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const options = {
    ttsCount: 3,
    sentencesPath: null,
    helpersPath: null,
    outputPath: null,
    mediaDir: path.join(__dirname, '..', 'anki', 'media')
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--sentences' || arg === '-s') && argv[i + 1]) {
      options.sentencesPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--helpers' || arg === '-h') && argv[i + 1]) {
      options.helpersPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
      options.outputPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((arg === '--tts-count' || arg === '-c') && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value >= 0) {
        options.ttsCount = value;
      }
      i += 1;
    } else if ((arg === '--media-dir' || arg === '-m') && argv[i + 1]) {
      options.mediaDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--help' || arg === '-?') {
      options.help = true;
    }
  }
  return options;
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function highlightSentence(sentence, word) {
  const index = sentence.indexOf(word);
  if (index === -1) {
    return sentence;
  }
  return (
    sentence.slice(0, index) +
    `<strong>${word}</strong>` +
    sentence.slice(index + word.length)
  );
}

const TONE_MAP = {
  ā: 'a',
  á: 'a',
  ǎ: 'a',
  à: 'a',
  ē: 'e',
  é: 'e',
  ě: 'e',
  è: 'e',
  ī: 'i',
  í: 'i',
  ǐ: 'i',
  ì: 'i',
  ō: 'o',
  ó: 'o',
  ǒ: 'o',
  ò: 'o',
  ū: 'u',
  ú: 'u',
  ǔ: 'u',
  ù: 'u',
  ǖ: 'v',
  ǘ: 'v',
  ǚ: 'v',
  ǜ: 'v',
  Ā: 'A',
  Á: 'A',
  Ǎ: 'A',
  À: 'A',
  Ē: 'E',
  É: 'E',
  Ě: 'E',
  È: 'E',
  Ī: 'I',
  Í: 'I',
  Ǐ: 'I',
  Ì: 'I',
  Ō: 'O',
  Ó: 'O',
  Ǒ: 'O',
  Ò: 'O',
  Ū: 'U',
  Ú: 'U',
  Ǔ: 'U',
  Ù: 'U',
  Ǖ: 'V',
  Ǘ: 'V',
  Ǚ: 'V',
  Ǜ: 'V'
};

function flattenPinyin(pinyin) {
  return (pinyin || '')
    .split('')
    .map((char) => {
      if (TONE_MAP[char]) return TONE_MAP[char].toLowerCase();
      if (char === 'ü' || char === 'Ü') return 'v';
      if (/[a-z0-9]/i.test(char)) return char.toLowerCase();
      if (/\s/.test(char)) return ' ';
      if (char === '·' || char === '-' || char === '\'') return '';
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function simplifyPinyin(pinyin) {
  return pinyin
    .split('')
    .map((char) => {
      if (TONE_MAP[char]) return TONE_MAP[char].toLowerCase();
      if (/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(char)) return 'a';
      if (char === 'ü' || char === 'Ü') return 'v';
      if (/[a-z0-9]/i.test(char)) return char.toLowerCase();
      if (/\s/.test(char)) return '';
      if (char === '·' || char === '-' || char === '\'') return '';
      return '';
    })
    .join('');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '');
}

function escapeField(value) {
  const safe = String(value ?? '')
    .replace(/\"/g, '&quot;')
    .trim();
  return `"${safe}"`;
}

async function synthesizeAudio(sentence, filePath) {
  const buffer = await callOpenAIAudio({ text: sentence, voice: 'alloy', audioFormat: 'mp3' });
  fs.writeFileSync(filePath, buffer);
}

async function main() {
  const options = parseArgs();
  if (options.help || !options.sentencesPath || !options.helpersPath || !options.outputPath) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  ensureDir(path.dirname(options.outputPath));
  ensureDir(options.mediaDir);

  const sentencesPayload = loadJson(options.sentencesPath);
  const helperPayload = loadJson(options.helpersPath);
  const helperMap = new Map();
  for (const entry of helperPayload.results || []) {
    if (entry?.word) {
      helperMap.set(entry.word, entry.helper_note);
    }
  }

  const grouped = new Map();
  for (const entry of sentencesPayload.results || []) {
    if (!grouped.has(entry.word)) {
      grouped.set(entry.word, []);
    }
    grouped.get(entry.word).push(entry);
  }

  const slugByWord = new Map();
  const slugUsageCount = new Map();

  const lines = [];
  for (const [word, sentenceEntries] of grouped.entries()) {
    if (!sentenceEntries.length) continue;
    const base = sentenceEntries[0];
    const helperNote = helperMap.get(word) || 'Contextual guidance TBD.';
    const basePinyin = flattenPinyin(base.word_pinyin || base.word);
    const displayPinyin = (base.word_pinyin || '').replace(/\s+/g, '') || basePinyin;

    const sentenceField = sentenceEntries
      .map((entry) => `${highlightSentence(entry.sentence, word)}::${entry.sentence_translation}`)
      .join('||');

    const audioRefs = [];
    for (let i = 0; i < Math.min(options.ttsCount, sentenceEntries.length); i += 1) {
      const entry = sentenceEntries[i];
      const slugBase = simplifyPinyin(entry.word_pinyin || entry.word);
      if (!slugByWord.has(word)) {
        const usedCount = slugUsageCount.get(slugBase) || 0;
        const assignedSlug = usedCount === 0 ? slugBase : `${slugBase}_${usedCount + 1}`;
        slugUsageCount.set(slugBase, usedCount + 1);
        slugByWord.set(word, assignedSlug);
      }
      const slug = slugByWord.get(word);
      const fileName = `${slug}-${i + 1}.mp3`;
      const mediaPath = path.join(options.mediaDir, fileName);
      const plainSentence = stripHtml(entry.sentence);
      if (!fs.existsSync(mediaPath)) {
        await synthesizeAudio(plainSentence, mediaPath);
      }
      audioRefs.push(fileName);
    }

    const fields = [
      word,
      base.word_translation,
      displayPinyin,
      escapeField(sentenceField),
      escapeField(audioRefs.join('||')),
      escapeField(helperNote)
    ];
    lines.push(fields.join('|'));
  }

  fs.writeFileSync(options.outputPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${lines.length} cards to ${options.outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
