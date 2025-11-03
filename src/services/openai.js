const { OPENAI_API_KEY, MODEL } = require('../config');
const { logApiUsage } = require('../utils/logging');

const MODEL_PRICING = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o-mini-tts': { input: 0.00015, output: 0.0006 }
};

function bytesFor(value) {
  if (!value) return 0;
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
  return Buffer.byteLength(String(value), 'utf8');
}

function estimateTokensFromChars(charCount) {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.max(1, Math.ceil(charCount / 4));
}

function estimateCostUsd(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  if (!pricing) return null;
  const cost =
    ((inputTokens || 0) / 1000) * pricing.input + ((outputTokens || 0) / 1000) * pricing.output;
  return Number(cost.toFixed(6));
}

async function callOpenAI(word) {
  const systemPrompt = [
    'You generate concise Mandarin study cards.',
    'Return a JSON object with: (a) a single Mandarin sentence that naturally uses the target word, (b) the target word written in pinyin with tone marks, (c) an English translation of the sentence, (d) the word’s English gloss (translation), (e) a short English definition clarifying nuance, and (f) a short English usage hint (<= 25 words) covering register, collocations, or nuance.',
    'The sentence should be under 30 Chinese characters, sound natural, and the target word must appear exactly as provided.',
    'All English outputs must be in English only.',
    'Return strictly JSON with the shape: {"sentence": "...", "word_pinyin": "...", "sentence_translation": "...", "word_translation": "...", "definition": "...", "usage_hint": "..."}'
  ].join(' ');

  const userPrompt = `Target word: ${word}`;

  const payloadBody = {
    model: MODEL,
    temperature: 0.7,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'sentence_card',
        schema: {
          type: 'object',
          properties: {
            sentence: { type: 'string', minLength: 4, maxLength: 80 },
            word_pinyin: { type: 'string', minLength: 1, maxLength: 80 },
            sentence_translation: { type: 'string', minLength: 4, maxLength: 220 },
            word_translation: { type: 'string', minLength: 1, maxLength: 120 },
            definition: { type: 'string', minLength: 4, maxLength: 200 },
            usage_hint: { type: 'string', minLength: 4, maxLength: 200 }
          },
          required: ['sentence', 'word_pinyin', 'sentence_translation', 'word_translation', 'definition', 'usage_hint'],
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
  const requestPayload = JSON.stringify(payloadBody);
  const requestBytes = bytesFor(requestPayload);
  const startedAt = Date.now();
  let responsePayloadSize = 0;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: requestPayload
  });

    const payload = await response.json();
    responsePayloadSize = bytesFor(JSON.stringify(payload));
    if (!response.ok) {
      const details = payload?.error ?? payload;
      throw new Error(
        `OpenAI error: ${response.status} ${response.statusText} ${JSON.stringify(details)}`
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI response missing content');
    }

    const parsed = JSON.parse(content);
    const latencyMs = Date.now() - startedAt;
    const inputTokens = estimateTokensFromChars(requestPayload.length);
    const outputTokens = estimateTokensFromChars(JSON.stringify(parsed).length);
    logApiUsage({
      type: 'chat.completions',
      mode: 'card-generation',
      model: MODEL,
      latencyMs,
      requestBytes,
      responseBytes: responsePayloadSize,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(MODEL, inputTokens, outputTokens),
      success: true
    });
    return parsed;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const inputTokens = estimateTokensFromChars(requestPayload.length);
    logApiUsage({
      type: 'chat.completions',
      mode: 'card-generation',
      model: MODEL,
      latencyMs,
      requestBytes,
      responseBytes: responsePayloadSize,
      inputTokens,
      outputTokens: 0,
      estimatedCostUsd: estimateCostUsd(MODEL, inputTokens, 0),
      success: false,
      error: error?.message || 'Unknown error'
    });
    throw error;
  }
}

async function callOpenAIAudio({ text, voice = 'alloy', audioFormat = 'mp3', model = 'gpt-4o-mini-tts' }) {
  if (!text || typeof text !== 'string') {
    throw new Error('Missing text for audio generation.');
  }
  const payloadBody = {
    model,
    voice,
    input: text,
    format: audioFormat
  };
  const requestPayload = JSON.stringify(payloadBody);
  const requestBytes = bytesFor(requestPayload);
  const startedAt = Date.now();
  let responseBytes = 0;
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: requestPayload
    });

    if (!response.ok) {
      let details = '';
      try {
        const payload = await response.json();
        details = JSON.stringify(payload?.error ?? payload);
      } catch (error) {
        details = response.statusText;
      }
      throw new Error(`OpenAI audio error: ${response.status} ${details}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    responseBytes = buffer.length;
    const latencyMs = Date.now() - startedAt;
    const inputTokens = estimateTokensFromChars(text.length);
    logApiUsage({
      type: 'audio.speech',
      mode: 'tts',
      model,
      latencyMs,
      requestBytes,
      responseBytes,
      inputTokens,
      outputTokens: 0,
      estimatedCostUsd: estimateCostUsd(model, inputTokens, 0),
      success: true
    });
    return buffer;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const inputTokens = estimateTokensFromChars(text.length);
    logApiUsage({
      type: 'audio.speech',
      mode: 'tts',
      model,
      latencyMs,
      requestBytes,
      responseBytes,
      inputTokens,
      outputTokens: 0,
      estimatedCostUsd: estimateCostUsd(model, inputTokens, 0),
      success: false,
      error: error?.message || 'Unknown error'
    });
    throw error;
  }
}

module.exports = {
  callOpenAI,
  callOpenAIAudio,
  callOpenAIReadGlosses
};

async function callOpenAIReadGlosses({ text, targets }) {
  if (!Array.isArray(targets) || !targets.length) {
    return [];
  }
  const sanitizedTargets = targets
    .filter((entry) => entry && typeof entry.word === 'string' && entry.word.trim())
    .slice(0, 24)
    .map((entry) => ({
      key: typeof entry.key === 'string' && entry.key.trim() ? entry.key.trim() : entry.word.trim(),
      word: entry.word.trim(),
      sentence:
        typeof entry.sentence === 'string' && entry.sentence.trim()
          ? entry.sentence.trim()
          : entry.word.trim()
    }));

  if (!sanitizedTargets.length) {
    return [];
  }

  const passage = typeof text === 'string' ? text.trim() : '';
  const targetPayload = sanitizedTargets
    .map(
      (entry, index) =>
        `${index + 1}. key: ${entry.key}\n   word: ${entry.word}\n   sentence: ${entry.sentence}`
    )
    .join('\n');

  const systemPrompt = [
    'You are a bilingual assistant helping an intermediate Mandarin learner read authentic text.',
    'For each target word, provide:',
    '1) accurate pinyin with tone marks,',
    '2) a concise English gloss (<= 6 words) that fits the sentence context,',
    '3) a short note (<= 20 words) highlighting nuance, tone, or usage if needed (otherwise an empty string).',
    'Return strictly JSON following the provided schema. Do not add commentary.'
  ].join(' ');

  const userPrompt = [
    'Reading passage:',
    passage || '(short passage omitted)',
    '',
    'Targets requiring glosses:',
    targetPayload
  ].join('\n');

  const payloadBody = {
    model: MODEL,
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'contextual_glosses',
        schema: {
          type: 'object',
          properties: {
            glosses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  word: { type: 'string' },
                  pinyin: { type: 'string' },
                  gloss: { type: 'string' },
                  note: { type: 'string' }
                },
                required: ['key', 'word', 'pinyin', 'gloss', 'note'],
                additionalProperties: false
              }
            }
          },
          required: ['glosses'],
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
  const requestPayload = JSON.stringify(payloadBody);
  const requestBytes = bytesFor(requestPayload);
  const startedAt = Date.now();
  let responseBytes = 0;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: requestPayload
    });

    const payload = await response.json();
    responseBytes = bytesFor(JSON.stringify(payload));
    if (!response.ok) {
      const details = payload?.error ?? payload;
      throw new Error(
        `OpenAI gloss error: ${response.status} ${response.statusText} ${JSON.stringify(details)}`
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI gloss response missing content');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Unable to parse OpenAI gloss JSON: ${error.message}`);
    }

    const glosses = Array.isArray(parsed?.glosses) ? parsed.glosses : [];
    const results = glosses
      .filter(
        (entry) =>
          entry &&
          typeof entry.key === 'string' &&
          typeof entry.word === 'string' &&
          typeof entry.pinyin === 'string' &&
          typeof entry.gloss === 'string' &&
          typeof entry.note === 'string'
      )
      .map((entry) => ({
        key: entry.key,
        word: entry.word,
        pinyin: entry.pinyin,
        gloss: entry.gloss,
        note: entry.note
      }));
    const latencyMs = Date.now() - startedAt;
    const inputTokens = estimateTokensFromChars(requestPayload.length);
    const outputTokens = estimateTokensFromChars(JSON.stringify(results).length);
    logApiUsage({
      type: 'chat.completions',
      mode: 'read-gloss',
      model: MODEL,
      latencyMs,
      requestBytes,
      responseBytes,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(MODEL, inputTokens, outputTokens),
      success: true,
      targetsRequested: targets.length,
      glossesReturned: results.length
    });
    return results;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const inputTokens = estimateTokensFromChars(requestPayload.length);
    logApiUsage({
      type: 'chat.completions',
      mode: 'read-gloss',
      model: MODEL,
      latencyMs,
      requestBytes,
      responseBytes,
      inputTokens,
      outputTokens: 0,
      estimatedCostUsd: estimateCostUsd(MODEL, inputTokens, 0),
      success: false,
      error: error?.message || 'Unknown error',
      targetsRequested: targets.length
    });
    throw error;
  }
}
