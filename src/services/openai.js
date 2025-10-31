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

module.exports = {
  callOpenAI
};
