export async function generateCard(word) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ word })
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

export async function requestReadGlosses({ text = '', targets = [] } = {}) {
  const response = await fetch('/api/read/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      targets
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
