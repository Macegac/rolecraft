// Rolecraft service worker.
//
// The app is split across index.html plus many js/ and css/ files. If a phone
// served some of those from an old cache and some fresh from the network, it
// would run a mix of two versions and break in confusing ways. So every
// same-origin file is fetched network-first (revalidated, so an unchanged file
// costs only a small "not modified" reply) and the cache is used only when the
// network is unavailable. Cross-origin requests (AI providers, CDNs, fonts)
// are left alone.

const CACHE = 'rolecraft-v1';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// Read the file list from index.html so it can never drift from what the page loads.
async function appFiles() {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    const html = await res.text();
    const files = [...html.matchAll(/<(?:script\s+src|link\s+rel="stylesheet"\s+href)="((?:js|css)\/[^"]+)"/g)]
        .map(m => './' + m[1]);
    return [...CORE, ...files];
}

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        appFiles()
            .then(files => caches.open(CACHE).then(c => c.addAll(files)))
            .catch(() => caches.open(CACHE).then(c => c.addAll(CORE)))
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    e.respondWith(
        fetch(req, { cache: 'no-cache' }).then(res => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(req, copy));
            }
            return res;
        }).catch(async () => {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) return hit;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return Response.error();
        })
    );
});
