// Rolecraft service worker.
//
// index.html lists every script and stylesheet with a version stamp taken from the
// file's contents (tools/stamp-versions.js): js/boot.js?v=3f9a12c4e1.
//
// - The page itself (index.html) is fetched network-first, so a new deploy is seen
//   on the next open. That is the only request an ordinary startup makes.
// - A stamped file is served from the cache with no network trip. A changed file has
//   a new stamp, so it is a different address and gets downloaded once. Old and new
//   files can therefore never be mixed, which is what network-first protected before
//   at the cost of one round trip per file on every startup.
// - Anything else on this site (images, manifest) stays network-first with a cache
//   fallback for offline. Other sites (AI providers, CDNs, fonts) are left alone.

const CACHE = 'rolecraft-v2';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const TAG = /<(?:script\s+src|link\s+rel="stylesheet"\s+href)="((?:js|css)\/[^"]+)"/g;

function stampedFiles(html) {
    return [...html.matchAll(TAG)].map(m => new URL(m[1], self.registration.scope).href);
}

// Drop cached files the current index.html no longer points at (earlier stamps).
async function prune(html) {
    const keep = new Set(stampedFiles(html));
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
        if (new URL(req.url).searchParams.has('v') && !keep.has(req.url)) await cache.delete(req);
    }
}

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        try {
            const res = await fetch('./index.html', { cache: 'no-cache' });
            const html = await res.clone().text();
            await cache.put('./index.html', res);
            await cache.addAll([...CORE.filter(f => f !== './index.html'), ...stampedFiles(html)]);
        } catch (err) {
            await cache.addAll(CORE).catch(() => {});
        }
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => clients.claim())
    );
});

async function networkFirst(req, isPage) {
    try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(isPage ? './index.html' : req, res.clone());
            if (isPage) res.clone().text().then(prune).catch(() => {});
        }
        return res;
    } catch (err) {
        const hit = await caches.match(isPage ? './index.html' : req, { ignoreSearch: !isPage });
        return hit || Response.error();
    }
}

async function cacheFirst(req) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const isPage = req.mode === 'navigate' || url.pathname.endsWith('/index.html');
    if (isPage) e.respondWith(networkFirst(req, true));
    else if (url.searchParams.has('v')) e.respondWith(cacheFirst(req));
    else e.respondWith(networkFirst(req, false));
});
