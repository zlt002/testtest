import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const host = '127.0.0.1';
const port = 8866;

const contentTypes = new Map([
  ['.zip', 'application/zip'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.vbs', 'text/plain; charset=utf-8'],
  ['.ps1', 'text/plain; charset=utf-8'],
]);

function sendNotFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

function sendMethodNotAllowed(response) {
  response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Method not allowed');
}

function sendFile(response, filePath) {
  const stat = statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
    'Last-Modified': stat.mtime.toUTCString(),
  });
  createReadStream(filePath).pipe(response);
}

await mkdir(releaseDir, { recursive: true });

const server = http.createServer((request, response) => {
  if (!request.url) {
    sendNotFound(response);
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    sendMethodNotAllowed(response);
    return;
  }

  const requestPath = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  const relativePath = requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(releaseDir, relativePath);

  if (!filePath.startsWith(`${releaseDir}${path.sep}`) && filePath !== releaseDir) {
    sendNotFound(response);
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    sendNotFound(response);
    return;
  }

  if ((request.method ?? 'GET') === 'HEAD') {
    const stat = statSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
      'Last-Modified': stat.mtime.toUTCString(),
    });
    response.end();
    return;
  }

  sendFile(response, filePath);
});

server.listen(port, host, () => {
  console.log(`Serving Windows Lite release feed at http://${host}:${port}/ from ${releaseDir}`);
});
