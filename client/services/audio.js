export async function requestSentenceAudio({
  text,
  voice = 'alloy',
  audioFormat = 'mp3',
  language
} = {}) {
  const languageId =
    typeof language === 'string' && language.trim() ? language.trim() : undefined;
  const response = await fetch('/api/generate-audio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text, voice, audioFormat, language: languageId })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message = (payload && payload.error) || `Audio request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!payload || !payload.audio || !payload.contentType) {
    throw new Error('Audio generator returned incomplete data.');
  }

  const audioBytes = Uint8Array.from(atob(payload.audio), (char) => char.charCodeAt(0));
  const blob = new Blob([audioBytes], { type: payload.contentType });
  const url = URL.createObjectURL(blob);
  return {
    url,
    contentType: payload.contentType,
    voice: payload.voice ?? voice,
    format: payload.format ?? audioFormat
  };
}
