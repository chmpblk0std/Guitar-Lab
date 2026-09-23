export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__token-test") {
      const token = crypto.randomUUID().replaceAll("-", "");
      const record = {
        token,
        createdAt: new Date().toISOString(),
        active: true
      };

      try {
        await env.GuitarLabAccess.put(`access:${token}`, JSON.stringify(record));

        const stored = await env.GuitarLabAccess.get(`access:${token}`, "json");

        if (!stored || stored.token !== token || stored.active !== true) {
          return new Response("Token test failed: record mismatch", {
            status: 500,
            headers: { "Cache-Control": "no-store" }
          });
        }

        await env.GuitarLabAccess.delete(`access:${token}`);

        return new Response(JSON.stringify({
          status: "OK",
          token,
          createdAt: record.createdAt,
          active: record.active
        }, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      } catch (error) {
        return new Response(`Token test failed: ${error instanceof Error ? error.message : String(error)}`, {
          status: 500,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
