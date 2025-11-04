const { setCommonHeaders, readJsonBody } = require('../utils/http');
const {
  callOpenAI,
  callOpenAIAudio,
  callOpenAIReadGlosses,
  callOpenAIReadPassage
} = require('../services/openai');
const { resolveGlossesLocally } = require('../services/glossary');

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
  handleApiGenerateAudio,
  handleApiReadAnalyze,
  handleApiReadGenerate
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

async function handleApiReadAnalyze(req, res) {
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

  const text = typeof body.text === 'string' ? body.text : '';
  const targetsInput = Array.isArray(body.targets) ? body.targets : [];

  const sanitizedTargets = targetsInput
    .map((entry) => {
      const word = typeof entry.word === 'string' ? entry.word.trim() : '';
      const key = typeof entry.key === 'string' ? entry.key.trim() : '';
      const sentence = typeof entry.sentence === 'string' ? entry.sentence.trim() : '';
      if (!word) return null;
      return {
        key: key || `${word}-${entry.sentenceIndex ?? 0}`,
        word,
        sentence,
        sentenceIndex:
          typeof entry.sentenceIndex === 'number' && Number.isFinite(entry.sentenceIndex)
            ? entry.sentenceIndex
            : 0
      };
    })
    .filter(Boolean);

  if (sanitizedTargets.length > 120) {
    sanitizedTargets.length = 120;
  }

  if (!sanitizedTargets.length) {
    setCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ glosses: [] }));
    return;
  }

  try {
    const localResolution = await resolveGlossesLocally(sanitizedTargets);
    const pendingTargets = localResolution.unresolved || [];
    const localGlosses = Array.isArray(localResolution.resolved) ? localResolution.resolved : [];
    let remoteGlosses = [];

    if (pendingTargets.length) {
      remoteGlosses = await callOpenAIReadGlosses({
        text,
        targets: pendingTargets
      });
    }

    const merged = new Map();
    localGlosses.forEach((entry) => {
      if (!entry || !entry.key) return;
      merged.set(entry.key, {
        key: entry.key,
        word: entry.word,
        pinyin: entry.pinyin,
        gloss: entry.gloss,
        note: entry.note || 'CEDICT'
      });
    });

    remoteGlosses.forEach((entry) => {
      if (!entry || !entry.key) return;
      merged.set(entry.key, {
        key: entry.key,
        word: entry.word,
        pinyin: entry.pinyin,
        gloss: entry.gloss,
        note: entry.note || 'OpenAI'
      });
    });

    const payload = {
      glosses: Array.from(merged.values())
    };
    setCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error('OpenAI read gloss request failed:', error);
    setCommonHeaders(res);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function handleApiReadGenerate(req, res) {
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

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const lifetimeTokens =
    typeof body.lifetimeTokens === 'number' && Number.isFinite(body.lifetimeTokens)
      ? body.lifetimeTokens
      : 0;
  const difficultyTarget =
    typeof body.difficultyTarget === 'number' && Number.isFinite(body.difficultyTarget)
      ? body.difficultyTarget
      : 0.9;
  const paragraphCount =
    typeof body.paragraphCount === 'number' && Number.isFinite(body.paragraphCount)
      ? body.paragraphCount
      : 2;
  const easeAdjustment =
    typeof body.easeAdjustment === 'number' && Number.isFinite(body.easeAdjustment)
      ? body.easeAdjustment
      : 0;
  const previousPassage =
    typeof body.previousPassage === 'string' && body.previousPassage.trim()
      ? body.previousPassage.trim()
      : null;

  try {
    const result = await callOpenAIReadPassage({
      topic,
      lifetimeTokens,
      difficultyTarget,
      paragraphCount,
      easeAdjustment,
      previousPassage
    });
    setCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('OpenAI read passage request failed:', error);
    setCommonHeaders(res);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
}
