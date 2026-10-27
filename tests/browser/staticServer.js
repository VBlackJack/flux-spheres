/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** Content types of the files the game serves. */
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
});

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const INDEX_FILE = 'index.html';
const LOOPBACK_HOST = '127.0.0.1';
/** Port 0 lets the system pick a free one. */
const ANY_FREE_PORT = 0;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/**
 * Serves a directory over HTTP on the loopback interface, as the game is served in production.
 * @param {string} rootDir - Directory to serve.
 * @returns {Promise<{origin: string, close: () => Promise<void>}>} The server origin and a closer.
 */
export async function startStaticServer(rootDir) {
  const root = resolve(rootDir);
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, `http://${LOOPBACK_HOST}`);
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || INDEX_FILE;
    const filePath = normalize(join(root, relative));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      response.writeHead(HTTP_FORBIDDEN).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] || DEFAULT_CONTENT_TYPE;
      response.writeHead(HTTP_OK, { 'Content-Type': contentType }).end(body);
    } catch {
      response.writeHead(HTTP_NOT_FOUND).end();
    }
  });
  await new Promise((done) => server.listen(ANY_FREE_PORT, LOOPBACK_HOST, done));
  const { port } = server.address();
  return {
    origin: `http://${LOOPBACK_HOST}:${port}`,
    close: () => new Promise((done) => server.close(() => done()))
  };
}
