const { OPENAI_API_KEY, MODEL } = require('../config');

async function callOpenAI(word) {
  const systemPrompt = [
    'You generate concise Mandarin study cards.',
    'Return a JSON object with: (a) a single Mandarin sentence that naturally uses the target word, (b) the target word written in pinyin with tone marks, (c) an English translation of the sentence, (d) the word’s English gloss (translation), (e) a short English definition clarifying nuance, and (f) a short English usage hint (<= 25 words) covering register, collocations, or nuance.',
    'The sentence should be under 30 Chinese characters, sound natural, and the target word must appear exactly as provided.',
    'All English outputs must be in English only.',
    'Return strictly JSON with the shape: {"sentence": "...", "word_pinyin": "...", "sentence_translation": "...", "word_translation": "...", "definition": "...", "usage_hint": "..."}'
  ].join(' ');

  const userPrompt = `Target word: ${word}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
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
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const details = payload?.error ?? payload;
    throw new Error(`OpenAI error: ${response.status} ${response.statusText} ${JSON.stringify(details)}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response missing content');
  }

  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    throw new Error(`Unable to parse OpenAI response JSON: ${error.message}`);
  }
}

async function callOpenAIAudio({ text, voice = 'alloy', audioFormat = 'mp3', model = 'gpt-4o-mini-tts' }) {
  if (!text || typeof text !== 'string') {
    throw new Error('Missing text for audio generation.');
  }
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      format: audioFormat
    })
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
  return Buffer.from(arrayBuffer);
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

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
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
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const details = payload?.error ?? payload;
    throw new Error(`OpenAI gloss error: ${response.status} ${response.statusText} ${JSON.stringify(details)}`);
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
  return glosses
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
}
