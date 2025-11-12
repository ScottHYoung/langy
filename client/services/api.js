export async function generateCard(input) {
  const payloadInput =
    typeof input === 'string' ? { word: input } : input && typeof input === 'object' ? input : {};
  const word = typeof payloadInput.word === 'string' ? payloadInput.word.trim() : '';
  const languageId =
    typeof payloadInput.language === 'string' && payloadInput.language.trim()
      ? payloadInput.language.trim()
      : undefined;
  if (!word) {
    throw new Error('A word is required to generate a card.');
  }
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ word, language: languageId })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && payload.error) || `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (
    !payload ||
    !payload.sentence ||
    !payload.word_pinyin ||
    !payload.sentence_translation ||
    !payload.word_translation ||
    !payload.definition ||
    !payload.usage_hint
  ) {
    throw new Error('Generator returned incomplete data.');
  }

  return payload;
}

export async function requestReadGlosses(options = {}) {
  const {
    text = '',
    targets = [],
    language
  } = options || {};
  const languageId =
    typeof language === 'string' && language.trim() ? language.trim() : undefined;
  const response = await fetch('/api/read/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      targets,
      language: languageId
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && payload.error) || `Contextual gloss request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!payload || !Array.isArray(payload.glosses)) {
    throw new Error('Contextual gloss response missing data.');
  }

  return payload.glosses;
}

export async function requestReadingPassage(options = {}) {
  const languageId =
    typeof options.language === 'string' && options.language.trim()
      ? options.language.trim()
      : undefined;
  const response = await fetch('/api/read/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic: options.topic || '',
      lifetimeTokens: options.lifetimeTokens || 0,
      difficultyTarget: options.difficultyTarget || 0.9,
      paragraphCount: options.paragraphCount || 2,
      easeAdjustment: options.easeAdjustment || 0,
      previousPassage: options.previousPassage || '',
      language: languageId
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && payload.error) || `Reading passage request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!payload || !Array.isArray(payload.paragraphs) || !payload.text) {
    throw new Error('Reading passage response missing data.');
  }

  return payload;
}
