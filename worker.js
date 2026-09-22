export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__kv-test") {
      const key = `__test__${crypto.randomUUID()}`;
      const value = "Guitar Lab KV test";

      try {
        await env.GuitarLabAccess.put(key, value);
        const readBack = await env.GuitarLabAccess.get(key);
        await env.GuitarLabAccess.delete(key);

        if (readBack !== value) {
          return new Response("KV test failed: value mismatch", {
            status: 500,
            headers: { "Cache-Control": "no-store" }
          });
        }

        return new Response("KV test OK", {
          status: 200,
          headers: { "Cache-Control": "no-store" }
        });
      } catch (error) {
        return new Response(`KV test failed: ${error instanceof Error ? error.message : String(error)}`, {
          status: 500,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
