const CACHE_NAME = "guitar-lab-v4";
const APP_SHELL = [
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

function isCacheableStaticRequest(request) {
    const url = new URL(request.url);

    if (url.origin !== self.location.origin) {
        return false;
    }

    if (request.mode === "navigate") {
        return false;
    }

    return /\.(?:css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(url.pathname)
        || url.pathname === "/manifest.json";
}

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") {
        return;
    }

    if (!isCacheableStaticRequest(event.request)) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                return cached;
            }

            return fetch(event.request).then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return response;
            });
        })
    );
});