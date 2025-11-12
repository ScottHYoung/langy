#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { OPENAI_API_KEY, MODEL } = require('../src/config');
const { logApiUsage } = require('../src/utils/logging');

const DEFAULT_COUNT = 20;
const MAX_COUNT = 50;
const PRESETS_PATH = path.join(__dirname, '..', 'anki', 'sentence_variation_presets.json');

function parseArgs() {
  const argv = process.argv.slice(2);
  const options = { count: DEFAULT_COUNT, word: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--word' || arg === '-w') && argv[i + 1]) {
      options.word = argv[i + 1];
      i += 1;
    } else if ((arg === '--count' || arg === '-c') && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        options.count = Math.min(value, MAX_COUNT);
      }
      i += 1;
    } else if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
      options.output = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!options.word && !arg.startsWith('-')) {
      options.word = arg;
    }
  }
  return options;
}

function printUsage() {
  console.log('Usage: node scripts/generate_card_sentences.js --word 午餐 [--count 20] [--output output.json]');
}

function loadPresets() {
  if (!fs.existsSync(PRESETS_PATH)) {
    throw new Error(`Missing presets file at ${PRESETS_PATH}`);
  }
  const raw = fs.readFileSync(PRESETS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.sentence_types) || !Array.isArray(parsed.context_settings)) {
    throw new Error('Presets file missing required arrays.');
  }
  return parsed;
}

function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) {
    throw new Error('Cannot pick from empty list.');
  }
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function buildRequestBody({ word, sentenceType, contextSetting }) {
  const systemPrompt = [
    'You craft single-sentence Mandarin examples for spaced-repetition flashcards.',
    'Always respond with valid JSON using the provided schema.',
    'Use natural, idiomatic Mandarin suitable for an intermediate learner.',
    'The target word must appear exactly as provided (matching characters).',
    'Keep the Mandarin sentence to 30 characters or fewer, including punctuation.',
    'Do not mix pinyin or English inside the Mandarin sentence.',
    'Return only one sentence per request.',
    'Include accurate English translation, pinyin for the target word, and concise usage guidance.'
  ].join(' ');

  const userPrompt = [
    `Target word: ${word}`,
    `Sentence style (${sentenceType.label}): ${sentenceType.instructions}`,
    `Context focus (${contextSetting.label}): ${contextSetting.prompt}`,
    'Ensure the sentence clearly reflects the context focus while sounding natural.',
    'If the style is a question, end with a question mark and do not provide an answer.'
  ].join('\n');

  return {
    model: MODEL,
    temperature: 0.75,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'single_sentence_card',
        schema: {
          type: 'object',
          properties: {
            sentence: { type: 'string', minLength: 4, maxLength: 120 },
            word_pinyin: { type: 'string', minLength: 1, maxLength: 80 },
            sentence_translation: { type: 'string', minLength: 4, maxLength: 240 },
            word_translation: { type: 'string', minLength: 1, maxLength: 120 },
            definition: { type: 'string', minLength: 4, maxLength: 200 },
            usage_hint: { type: 'string', minLength: 4, maxLength: 200 }
          },
          required: [
            'sentence',
            'word_pinyin',
            'sentence_translation',
            'word_translation',
            'definition',
            'usage_hint'
          ],
          additionalProperties: false
        },
        strict: true
      }
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
}

async function requestSentence({ word, sentenceType, contextSetting }) {
  const body = buildRequestBody({ word, sentenceType, contextSetting });
  const payload = JSON.stringify(body);
  const startedAt = Date.now();
  let responseBytes = 0;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: payload
    });
    const json = await response.json();
    responseBytes = Buffer.byteLength(JSON.stringify(json), 'utf8');
    if (!response.ok) {
      const details = json?.error ?? json;
      throw new Error(
        `OpenAI error: ${response.status} ${response.statusText} ${JSON.stringify(details)}`
      );
    }
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Missing OpenAI content payload.');
    }
    const parsed = JSON.parse(content);
    const latencyMs = Date.now() - startedAt;
    const inputTokens = Math.max(1, Math.ceil(payload.length / 4));
    const outputTokens = Math.max(1, Math.ceil(content.length / 4));
    logApiUsage({
      type: 'chat.completions',
      mode: 'card-variation',
      model: MODEL,
      latencyMs,
      requestBytes: Buffer.byteLength(payload, 'utf8'),
      responseBytes,
      inputTokens,
      outputTokens,
      estimatedCostUsd: null,
      success: true,
      meta: {
        word,
        sentenceType: sentenceType.id,
        contextSetting: contextSetting.id
      }
    });
    return parsed;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    logApiUsage({
      type: 'chat.completions',
      mode: 'card-variation',
      model: MODEL,
      latencyMs,
      requestBytes: Buffer.byteLength(payload, 'utf8'),
      responseBytes,
      inputTokens: Math.max(1, Math.ceil(payload.length / 4)),
      outputTokens: 0,
      estimatedCostUsd: null,
      success: false,
      error: error?.message || 'Unknown error',
      meta: {
        word,
        sentenceType: sentenceType.id,
        contextSetting: contextSetting.id
      }
    });
    throw error;
  }
}

async function main() {
  const options = parseArgs();
  if (options.help || !options.word) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  const presets = loadPresets();
  const sentenceTypes = presets.sentence_types;
  const contextSettings = presets.context_settings;
  const results = [];

  for (let i = 0; i < options.count; i += 1) {
    const sentenceType = pickRandom(sentenceTypes);
    const contextSetting = pickRandom(contextSettings);
    try {
      const completion = await requestSentence({ word: options.word, sentenceType, contextSetting });
      results.push({
        word: options.word,
        sentence_type_id: sentenceType.id,
        sentence_type_label: sentenceType.label,
        context_id: contextSetting.id,
        context_label: contextSetting.label,
        context_prompt: contextSetting.prompt,
        ...completion
      });
      process.stderr.write(
        `✓ (${i + 1}/${options.count}) ${sentenceType.id} @ ${contextSetting.id}\n`
      );
    } catch (error) {
      process.stderr.write(
        `✗ (${i + 1}/${options.count}) Failed for ${sentenceType.id} @ ${contextSetting.id}: ${error.message}\n`
      );
      throw error;
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    word: options.word,
    count: results.length,
    results
  };

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Saved ${results.length} examples to ${outputPath}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
