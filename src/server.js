const http = require('http');
const { URL } = require('url');

const { PORT } = require('./config');
const { setCommonHeaders } = require('./utils/http');
const {
  handleApiGenerate,
  handleApiGenerateAudio,
  handleApiReadAnalyze,
  handleApiReadGenerate
} = require('./routes/api');
const { handleStaticRequest } = require('./routes/static');

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/read/generate')) {
    await handleApiReadGenerate(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/read/analyze')) {
    await handleApiReadAnalyze(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/generate-audio')) {
    await handleApiGenerateAudio(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/generate')) {
    await handleApiGenerate(req, res);
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

module.exports = server;
