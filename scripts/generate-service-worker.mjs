import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const root = dist.pathname.replace(/^\/(?:[A-Za-z]:)/, match => match.slice(1));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(dir, entry.name))
    : [join(dir, entry.name)]));
  return nested.flat();
}
const assets = (await files(root))
  .map(file => '/' + relative(root, file).split(sep).join('/'))
  .filter(path => !path.endsWith('.mp4') && !path.endsWith('.map') && !path.endsWith('/sw.js') && !path.endsWith('/_headers') && !path.endsWith('/_redirects'));
const revision = (await readFile(join(root, 'index.html'), 'utf8')).match(/src="([^"]+\.js)"/)?.[1] ?? String(Date.now());
const source = `const CACHE = 'velmory-app-${revision}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('velmory-app-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => response.ok ? response : caches.match('/index.html')).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(new URL(request.url).pathname,{ignoreVary:true}).then(cached => cached || fetch(request)));
});`;
await writeFile(join(root, 'sw.js'), source);
console.log(`Offline app shell prepared with ${assets.length} static files.`);
