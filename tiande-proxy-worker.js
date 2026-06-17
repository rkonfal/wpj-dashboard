const FEED_URL = 'https://www.kralovstvi-tiande.cz/feed/23/db0fa65b3fb4fa6ad3e44be839cc31b9a9b34b7b';
const GQL_URL  = 'https://www.kralovstvi-tiande.cz/admin/graphql';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── /feed  →  proxy product feed with CORS ──────────────────────
    if (url.pathname === '/feed') {
      try {
        const resp = await fetch(FEED_URL, {
          headers: { 'User-Agent': 'Mozilla/5.0 TianDe-BannerGen/1.0' },
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        const body = await resp.arrayBuffer();
        return new Response(body, {
          status: resp.status,
          headers: {
            ...CORS,
            'Content-Type': resp.headers.get('Content-Type') || 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── GET /  →  status ────────────────────────────────────────────
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({ ok: true, proxy: 'tiande', time: new Date().toISOString() }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // ── POST /  →  GraphQL proxy ────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
    }

    try {
      const token =
        request.headers.get('X-Access-Token') ||
        request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return new Response(JSON.stringify({ error: 'Missing X-Access-Token' }), { status: 401, headers: CORS });
      }

      const rawBody = await request.text();

      const doFetch = (u) => fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: rawBody,
        redirect: 'manual',
      });

      let upstream = await doFetch(GQL_URL);

      if ([301, 302, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get('Location');
        if (!location) {
          return new Response(
            JSON.stringify({ error: 'Redirect without Location', status: upstream.status }),
            { status: 502, headers: CORS }
          );
        }
        upstream = await doFetch(new URL(location, GQL_URL).toString());
      }

      return new Response(await upstream.text(), { status: upstream.status, headers: CORS });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Worker proxy error', message: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: CORS }
      );
    }
  },
};
