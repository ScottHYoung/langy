const { setCommonHeaders, readJsonBody } = require('../utils/http');
const { callOpenAI, callOpenAIAudio } = require('../services/openai');

async function handleApiGenerate(req, res) {
  if (req.method === 'OPTIONS') {
    setCommonHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    setCommonHeaders(res);
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    setCommonHeaders(res);
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
    return;
  }

  const word = typeof body.word === 'string' ? body.word.trim() : '';
  if (!word) {
    setCommonHeaders(res);
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Missing "word" in request body.' }));
    return;
  }

  try {
    const completion = await callOpenAI(word);
    const payload = {
      word,
      sentence: completion.sentence,
      word_pinyin: completion.word_pinyin,
      sentence_translation: completion.sentence_translation,
      word_translation: completion.word_translation,
      definition: completion.definition,
      usage_hint: completion.usage_hint
    };
    setCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error('OpenAI request failed:', error);
    setCommonHeaders(res);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

module.exports = {
  handleApiGenerate,
  handleApiGenerateAudio
};

async function handleApiGenerateAudio(req, res) {
  if (req.method === 'OPTIONS') {
    setCommonHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    setCommonHeaders(res);
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    setCommonHeaders(res);
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
    return;
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'alloy';
  const audioFormat = typeof body.audioFormat === 'string' && body.audioFormat.trim() ? body.audioFormat.trim() : 'mp3';
  if (!text) {
    setCommonHeaders(res);
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Missing "text" in request body.' }));
    return;
  }

  try {
    const audioBuffer = await callOpenAIAudio({ text, voice, audioFormat });
    const base64 = audioBuffer.toString('base64');
    setCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        audio: base64,
        contentType: audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
        voice,
        format: audioFormat
      })
    );
  } catch (error) {
    console.error('OpenAI audio request failed:', error);
    setCommonHeaders(res);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
}
