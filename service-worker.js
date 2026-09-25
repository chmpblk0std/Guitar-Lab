const CACHE_NAME = "guitar-lab-v3";
const META_CACHE_NAME = "guitar-lab-auth-meta-v1";
const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

const META_URL = new URL("./__guitar_lab_auth_meta__", self.location.origin).toString();

async function readLastOnlineVerification() {
    const cache = await caches.open(META_CACHE_NAME);
    const response = await cache.match(META_URL);
    if (!response) return null;

    try {
        const data = await response.json();
        return Number.isFinite(data.lastVerifiedAt) ? data.lastVerifiedAt : null;
    } catch {
        return null;
    }
}

async function writeLastOnlineVerification() {
    const cache = await caches.open(META_CACHE_NAME);
    await cache.put(
        META_URL,
        new Response(JSON.stringify({ lastVerifiedAt: Date.now() }), {
            headers: { "Content-Type": "application/json" }
        })
    );
}

async function networkFirstNavigation(request) {
    try {
        // Navigation requests deliberately go to the network first.
        // This prevents a revoked/expired server-side authorization from
        // being hidden indefinitely by the cached app shell.
        const response = await fetch(request, { cache: "no-store", credentials: "include" });

        if (response.ok) {
            const copy = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, copy);
            await writeLastOnlineVerification();
        }

        return response;
    } catch {
        const lastVerifiedAt = await readLastOnlineVerification();

        if (!lastVerifiedAt || Date.now() - lastVerifiedAt > OFFLINE_MAX_AGE_MS) {
            return new Response(
                "Accesso non disponibile. È necessaria una verifica online.",
                {
                    status: 503,
                    headers: { "Content-Type": "text/plain; charset=utf-8" }
                }
            );
        }

        const cached = await caches.match(request);
        if (cached) return cached;

        const appShell = await caches.match("./index.html");
        if (appShell) return appShell;

        return new Response(
            "Accesso non disponibile. È necessaria una connessione Internet.",
            {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" }
            }
        );
    }
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
                    .filter(key => key !== CACHE_NAME && key !== META_CACHE_NAME)
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

    if (event.request.mode === "navigate") {
        event.respondWith(networkFirstNavigation(event.request));
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request).then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                return response;
            });
        })
    );
});