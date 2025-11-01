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
