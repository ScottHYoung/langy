const fs = require('fs');
const path = require('path');

const { ROOT_DIR } = require('../config');
const { setCommonHeaders } = require('../utils/http');

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

module.exports = {
  handleStaticRequest
};
