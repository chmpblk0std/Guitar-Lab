export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__admin-secret-test") {
      const configured = typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length > 0;

      return new Response(configured ? "Admin secret OK" : "Admin secret missing", {
        status: configured ? 200 : 500,
        headers: { "Cache-Control": "no-store" }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
