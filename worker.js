const ADMIN_SESSION_COOKIE = "GL_ADMIN_SESSION";
const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60;
const USER_SESSION_COOKIE = "GL_USER_SESSION";
const USER_SESSION_MAX_AGE = 24 * 60 * 60;

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (value.length % 4)) % 4);

  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function createAdminSession(secret) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE,
    nonce: crypto.randomUUID()
  };

  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = await hmacSign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

async function isValidAdminSession(request, secret) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${ADMIN_SESSION_COOKIE}=([^;]+)`)
  );

  if (!match) {
    return false;
  }

  const [encodedPayload, signature] = match[1].split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  try {
    const expectedSignature = await hmacSign(encodedPayload, secret);

    if (signature !== expectedSignature) {
      return false;
    }

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedPayload))
    );

    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
  );

  return match ? match[1] : null;
}

async function createUserSession(env, accessToken) {
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  const sessionRecord = {
    accessToken,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + USER_SESSION_MAX_AGE * 1000).toISOString()
  };

  await env.GuitarLabAccess.put(
    `session:${sessionId}`,
    JSON.stringify(sessionRecord),
    { expirationTtl: USER_SESSION_MAX_AGE }
  );

  return sessionId;
}

async function getValidUserSession(request, env) {
  const sessionId = getCookie(request, USER_SESSION_COOKIE);

  if (!sessionId) {
    return null;
  }

  const session = await env.GuitarLabAccess.get(`session:${sessionId}`, "json");

  if (!session || !session.accessToken) {
    return null;
  }

  const access = await env.GuitarLabAccess.get(
    `access:${session.accessToken}`,
    "json"
  );

  if (!access || access.revoked === true) {
    return null;
  }

  if (access.expiresAt && new Date(access.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return {
    sessionId,
    access
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function adminLoginPage(errorMessage = "") {
  return new Response(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Guitar Lab — Admin</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #090c11;
      color: #fff;
      font-family: system-ui, sans-serif;
    }
    main {
      width: min(420px, calc(100% - 32px));
      box-sizing: border-box;
      padding: 28px;
      border-radius: 16px;
      background: #151a22;
    }
    h1 { margin-top: 0; }
    label { display: block; margin-bottom: 8px; }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      margin-bottom: 16px;
      border-radius: 8px;
      border: 1px solid #555;
      background: #0d1117;
      color: #fff;
    }
    button {
      width: 100%;
      padding: 12px;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
    }
    .error { color: #ff8a8a; margin-bottom: 16px; }
  </style>
<script>function copyAccessLink(button, link) { navigator.clipboard.writeText(link).then(function() { var original = button.textContent; button.textContent = '✓ Copiato!'; setTimeout(function() { button.textContent = original; }, 1500); }); }</script></head>
<body>
  <main>
    <h1>Guitar Lab — Admin</h1>
    ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
    <form method="post" action="/admin/login">
      <label for="password">Password amministratore</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Accedi</button>
    </form>
  </main>
</body>
</html>`, {
    status: errorMessage ? 401 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function adminDashboard(env, message = "", createdLink = "") {
  const listed = await env.GuitarLabAccess.list({ prefix: "access:" });
  const accesses = [];
  for (const key of listed.keys) {
    const access = await env.GuitarLabAccess.get(key.name, "json");
    if (access) accesses.push(access);
  }
  accesses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return new Response(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Guitar Lab — Admin</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: #090c11;
      color: #fff;
      font-family: system-ui, sans-serif;
    }
    main {
      width: min(900px, calc(100% - 32px));
      margin: 48px auto;
    }
    section {
      padding: 24px;
      border-radius: 16px;
      background: #151a22;
      margin-bottom: 20px;
    }
    label { display: block; margin-bottom: 8px; }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      margin-bottom: 16px;
      border-radius: 8px;
      border: 1px solid #555;
      background: #0d1117;
      color: #fff;
    }
    button {
      padding: 10px 16px;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
    }
    .message {
      padding: 12px;
      border-radius: 8px;
      background: #0d3320;
      margin-bottom: 20px;
      overflow-wrap: anywhere;
    }
    .link {
      display: block;
      margin-top: 8px;
      padding: 12px;
      border-radius: 8px;
      background: #0d1117;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    form { margin-top: 20px; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Guitar Lab — Admin</h1>
      <p>Autenticazione amministratore riuscita.</p>

      ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
      ${createdLink ? `<div class="message">
        <strong>Link di accesso creato:</strong>
        <span class="link">${escapeHtml(createdLink)}</span>
      </div>` : ""}

      <h2>Accessi esistenti</h2>
      ${accesses.length ? `<div>${accesses.map(access => {
        const status = access.revoked ? "Revocato" : (access.expiresAt && new Date(access.expiresAt).getTime() <= Date.now() ? "Scaduto" : "Attivo");
        return `<div style="padding:12px 0;border-top:1px solid #333"><strong>${escapeHtml(access.label)}</strong><br>Stato: ${status}<br>Creato: ${escapeHtml(access.createdAt)}<br>Scadenza: ${access.expiresAt ? escapeHtml(access.expiresAt) : "Nessuna"}<br>Link: <span class="link">${escapeHtml(new URL(`/access/${access.token}`, "https://guitar-lab.wb-chomp479.workers.dev").toString())}</span><button type="button" onclick="copyAccessLink(this, 'https://guitar-lab.wb-chomp479.workers.dev/access/${access.token}')">Copia link</button><br>Accessi: ${Number.isFinite(access.accessCount) ? access.accessCount : 0}${!access.revoked ? `<form method="post" action="/admin/access/revoke" style="margin-top:8px"><input type="hidden" name="token" value="${escapeHtml(access.token)}"><button type="submit">Revoca accesso</button></form>` : ""}</div>`;
      }).join("")}</div>` : "<p>Nessun accesso creato.</p>"}

      <h2>Crea nuovo accesso</h2>
      <form method="post" action="/admin/access/create">
        <label for="label">Nome / etichetta utente</label>
        <input id="label" name="label" type="text" maxlength="100" required>

        <label for="expiresAt">Scadenza (facoltativa)</label>
        <input id="expiresAt" name="expiresAt" type="datetime-local">

        <button type="submit">Crea accesso</button>
      </form>

      <form method="post" action="/admin/logout">
        <button type="submit">Esci</button>
      </form>
    </section>
  </main>
</body>
</html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function accessDeniedPage(message) {
  return new Response(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Guitar Lab — Accesso</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #090c11;
      color: #fff;
      font-family: system-ui, sans-serif;
    }
    main {
      width: min(520px, calc(100% - 32px));
      box-sizing: border-box;
      padding: 28px;
      border-radius: 16px;
      background: #151a22;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <h1>Accesso non disponibile</h1>
    <p>${escapeHtml(message)}</p>
  </main>
</body>
</html>`, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" && request.method === "GET") {
      if (await isValidAdminSession(request, env.ADMIN_PASSWORD)) {
        return adminDashboard(env);
      }

      return adminLoginPage();
    }

    if (url.pathname === "/admin/login" && request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password");

      if (typeof password !== "string" || password !== env.ADMIN_PASSWORD) {
        return adminLoginPage("Password non corretta.");
      }

      const session = await createAdminSession(env.ADMIN_PASSWORD);

      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/admin",
          "Set-Cookie": `${ADMIN_SESSION_COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${ADMIN_SESSION_MAX_AGE}`,
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname === "/admin/access/create" && request.method === "POST") {
      if (!(await isValidAdminSession(request, env.ADMIN_PASSWORD))) {
        return adminLoginPage("Sessione amministrativa non valida o scaduta.");
      }

      const formData = await request.formData();
      const label = formData.get("label");
      const expiresAtInput = formData.get("expiresAt");

      if (typeof label !== "string" || !label.trim()) {
        return adminDashboard("Inserisci un nome o un'etichetta.");
      }

      let expiresAt = null;

      if (typeof expiresAtInput === "string" && expiresAtInput.trim()) {
        const parsed = new Date(expiresAtInput);

        if (Number.isNaN(parsed.getTime())) {
          return adminDashboard(env, "La data di scadenza non è valida.");
        }

        if (parsed.getTime() <= Date.now()) {
          return adminDashboard(env, "La scadenza deve essere nel futuro.");
        }

        expiresAt = parsed.toISOString();
      }

      const token = crypto.randomUUID().replaceAll("-", "");
      const record = {
        token,
        label: label.trim(),
        createdAt: new Date().toISOString(),
        expiresAt,
        revoked: false,
        lastAccessAt: null,
        accessCount: 0
      };

      await env.GuitarLabAccess.put(`access:${token}`, JSON.stringify(record));

      const accessUrl = new URL(`/access/${token}`, url.origin).toString();

      return adminDashboard(env, "Accesso creato correttamente.", accessUrl);
    }

    if (url.pathname === "/admin/access/revoke" && request.method === "POST") {
      if (!(await isValidAdminSession(request, env.ADMIN_PASSWORD))) {
        return adminLoginPage("Sessione amministrativa non valida o scaduta.");
      }
      const formData = await request.formData();
      const token = formData.get("token");
      if (typeof token !== "string" || !token || token.includes("/")) return adminDashboard(env, "Accesso da revocare non valido.");
      const accessKey = `access:${token}`;
      const access = await env.GuitarLabAccess.get(accessKey, "json");
      if (!access) return adminDashboard(env, "Accesso non trovato.");
      access.revoked = true;
      await env.GuitarLabAccess.put(accessKey, JSON.stringify(access));
      return adminDashboard(env, "Accesso revocato correttamente.");
    }

    if (url.pathname === "/access" || url.pathname.startsWith("/access/")) {
      const token = url.pathname.slice("/access/".length);

      if (request.method !== "GET" || !token || token.includes("/")) {
        return accessDeniedPage("Link di accesso non valido.");
      }

      const access = await env.GuitarLabAccess.get(`access:${token}`, "json");

      if (!access || access.revoked === true) {
        return accessDeniedPage("Questo accesso non è più disponibile.");
      }

      if (access.expiresAt && new Date(access.expiresAt).getTime() <= Date.now()) {
        return accessDeniedPage("Questo accesso è scaduto.");
      }

      const sessionId = await createUserSession(env, token);

      access.lastAccessAt = new Date().toISOString();
      access.accessCount = Number.isFinite(access.accessCount)
        ? access.accessCount + 1
        : 1;

      await env.GuitarLabAccess.put(`access:${token}`, JSON.stringify(access));

      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `${USER_SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${USER_SESSION_MAX_AGE}`,
          "Cache-Control": "no-store"
        }
      });
    }

    const userSession = await getValidUserSession(request, env);

    if (userSession) {
      return env.ASSETS.fetch(request);
    }

    return accessDeniedPage("Per utilizzare Guitar Lab è necessario un accesso valido.");
  }
};
