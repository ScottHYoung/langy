const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = path.resolve(__dirname);

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnvFile();
for (const [key, value] of Object.entries(fileEnv)) {
  if (!(key in process.env)) {
    process.env[key] = value;
  }
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable. Add it to .env or your shell.');
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Request body too large'));
        req.connection.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

async function callOpenAI(word) {
  const systemPrompt = [
    'You generate concise Mandarin study cards.',
    'Return a JSON object with a single sentence that naturally uses the provided target word and its English translation.',
    'The sentence should be under 30 characters, sound natural, and the target word must appear exactly as provided.',
    'Return strictly JSON with the shape: {"sentence": "...", "translation": "..."}'
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
              sentence: { type: 'string', minLength: 4, maxLength: 60 },
              translation: { type: 'string', minLength: 4, maxLength: 120 }
            },
            required: ['sentence', 'translation'],
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

async function handleApiGenerate(req, res, url) {
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
      translation: completion.translation
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

async function handleStaticRequest(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = path.join(ROOT_DIR, pathname);
  if (!filePath.startsWith(ROOT_DIR)) {
    setCommonHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) {
      setCommonHeaders(res);
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const fileStream = fs.createReadStream(filePath);
    setCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    fileStream.pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      setCommonHeaders(res);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } else {
      console.error('Static file error:', error);
      setCommonHeaders(res);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/generate')) {
    await handleApiGenerate(req, res, url);
    return;
  }
  await handleStaticRequest(req, res, url);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('Unhandled server error:', error);
    if (!res.headersSent) {
      setCommonHeaders(res);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    } else {
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Langy dev server running at http://localhost:${PORT}`);
});
