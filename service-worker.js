const CACHE_NAME = "guitar-lab-v5";
const META_CACHE_NAME = "guitar-lab-auth-meta-v1";
const AUTH_CHECK_PARAM = "__gl_verify";

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

function startupShell() {
    return new Response(`<!doctype html>
<html lang="it">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="theme-color" content="#090c11">
    <title>Guitar Lab</title>
    <style>
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            background: #090c11;
            overflow: hidden;
        }
        body {
            display: grid;
            place-items: center;
        }
        img {
            width: 128px;
            height: 128px;
            border-radius: 24px;
        }
    </style>
</head>
<body>
    <img src="./icons/icon-192.png" alt="Guitar Lab">
    <script>
        (async function () {
            const url = new URL(location.href);
            url.searchParams.set("${AUTH_CHECK_PARAM}", "1");

            try {
                const response = await fetch(url.href, {
                    cache: "no-store",
                    credentials: "include",
                    redirect: "follow"
                });
                const html = await response.text();

                document.open();
                document.write(html);
                document.close();
            } catch {
                document.body.innerHTML = "";
                const message = document.createElement("div");
                message.style.cssText = "font-family:system-ui,sans-serif;color:#fff;text-align:center;padding:24px";
                message.textContent = "Accesso non disponibile. Riprova.";
                document.body.appendChild(message);
            }
        })();
    </script>
</body>
</html>`, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

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

    const requestUrl = new URL(event.request.url);

    // The startup shell performs the actual authenticated navigation with
    // this one-time marker. Bypass the shell so the request reaches the
    // server and its 200/403 result is preserved.
    if (requestUrl.searchParams.get(AUTH_CHECK_PARAM) === "1") {
        requestUrl.searchParams.delete(AUTH_CHECK_PARAM);
        event.respondWith(fetch(new Request(requestUrl.href, event.request), {
            cache: "no-store",
            credentials: "include"
        }));
        return;
    }

    if (event.request.mode === "navigate") {
        // Open the PWA immediately with the Guitar Lab icon. The page then
        // performs the authenticated server check before showing the app.
        event.respondWith(startupShell());
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