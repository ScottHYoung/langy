#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { OPENAI_API_KEY, MODEL } = require('../src/config');
const { logApiUsage } = require('../src/utils/logging');

function printUsage() {
  console.log(
    'Usage: node scripts/generate_helper_notes.js --words 午餐,大多数,... [--output anki/generated_sentences/helper_notes.json]'
  );
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const options = { words: [], output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--words' || arg === '-w') && argv[i + 1]) {
      options.words = argv[i + 1]
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
      i += 1;
    } else if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
      options.output = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      options.words.push(arg.trim());
    }
  }
  return options;
}

function buildRequestBody(word) {
  const systemPrompt = [
    'You are a bilingual Mandarin learning coach.',
    'Write helper notes in English to guide an intermediate learner on when and how to use the word.',
    'Return exactly 2 or 3 complete sentences, each ending with a period.',
    'Use English throughout except when referencing specific Chinese words, phrases, or characters.',
    'Cover whichever of these are most relevant: register/formality, common collocations, literal meaning vs figurative extensions, restrictions, pitfalls compared to near-synonyms, or cultural context.',
    'If the word is rare or archaic, state that clearly.',
    'Do not repeat dictionary definitions; focus on actionable advice.'
  ].join(' ');

  const userPrompt = `Target word: ${word}\nProvide a concise helper note as described.`;

  return {
    model: MODEL,
    temperature: 0.5,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'helper_note',
        schema: {
          type: 'object',
          properties: {
            helper_note: { type: 'string', minLength: 30, maxLength: 600 }
          },
          required: ['helper_note'],
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

async function requestHelperNote(word) {
  const body = buildRequestBody(word);
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
    responseBytes = Buffer.byteLength(JSON.stringify(json));
    if (!response.ok) {
      const details = json?.error ?? json;
      throw new Error(
        `OpenAI error: ${response.status} ${response.statusText} ${JSON.stringify(details)}`
      );
    }
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Missing content in OpenAI response');
    }
    const parsed = JSON.parse(content);
    const latencyMs = Date.now() - startedAt;
    const inputTokens = Math.max(1, Math.ceil(payload.length / 4));
    const outputTokens = Math.max(1, Math.ceil(content.length / 4));
    logApiUsage({
      type: 'chat.completions',
      mode: 'helper-notes',
      model: MODEL,
      latencyMs,
      requestBytes: Buffer.byteLength(payload),
      responseBytes,
      inputTokens,
      outputTokens,
      estimatedCostUsd: null,
      success: true,
      meta: { word }
    });
    return parsed.helper_note?.trim();
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    logApiUsage({
      type: 'chat.completions',
      mode: 'helper-notes',
      model: MODEL,
      latencyMs,
      requestBytes: Buffer.byteLength(payload),
      responseBytes,
      inputTokens: Math.max(1, Math.ceil(payload.length / 4)),
      outputTokens: 0,
      estimatedCostUsd: null,
      success: false,
      error: error?.message || 'Unknown error',
      meta: { word }
    });
    throw error;
  }
}

async function main() {
  const options = parseArgs();
  if (options.help || !options.words.length) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }
  const words = Array.from(new Set(options.words));
  const results = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    try {
      const note = await requestHelperNote(word);
      results.push({ word, helper_note: note });
      process.stderr.write(`✓ (${i + 1}/${words.length}) ${word}\n`);
    } catch (error) {
      process.stderr.write(`✗ (${i + 1}/${words.length}) ${word}: ${error.message}\n`);
      throw error;
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    count: results.length,
    results
  };

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Saved helper notes to ${outputPath}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
