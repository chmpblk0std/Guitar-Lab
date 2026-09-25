const CACHE_NAME = "guitar-lab-v4";
const META_CACHE_NAME = "guitar-lab-auth-meta-v1";

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

async function networkNavigation(request) {
    try {
        // Authenticated document navigations are always verified online.
        // Never serve a cached HTML document as a fallback: server-side
        // revocation and expiry must always take precedence.
        return await fetch(request, {
            cache: "no-store",
            credentials: "include"
        });
    } catch {
        // A network failure is not an authorization result. Fail closed
        // rather than serving stale authenticated HTML.
        return new Response(
            "Accesso non disponibile. È necessaria una verifica online.",
            {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
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
    if (event.request.method !== "GET") return;

    if (event.request.mode === "navigate") {
        event.respondWith(networkNavigation(event.request));
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request, { credentials: "include" }).then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                return response;
            });
        })
    );
});