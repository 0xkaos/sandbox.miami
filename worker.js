export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API Endpoint: /api/letters
    if (url.pathname === '/api/letters') {
      // 1. Check if R2 is bound
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: "R2 Bucket 'BUCKET' is not bound in Cloudflare Settings." }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. Handle GET (Read)
      if (request.method === 'GET') {
        try {
          const object = await env.BUCKET.get('letters.json');
          
          if (object === null) {
            // Return empty object if file doesn't exist yet
            return new Response("{}", { headers: { 'Content-Type': 'application/json' } });
          }

          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Content-Type', 'application/json');

          return new Response(object.body, { headers });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
      }

      // 3. Handle POST (Write)
      if (request.method === 'POST') {
        try {
          const data = await request.json();
          let contentToSave = data;

          // Support Partial Updates: { char: "Aleph", strokes: [...] }
          if (data.char && data.strokes) {
            const existing = await env.BUCKET.get('letters.json');
            let store = {};
            if (existing) {
              store = await existing.json();
            }
            store[data.char] = data.strokes;
            contentToSave = store;
          }

          // Write to R2
          await env.BUCKET.put('letters.json', JSON.stringify(contentToSave, null, 2), {
            httpMetadata: { contentType: 'application/json' }
          });

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Save failed: " + err.message }), { status: 500 });
        }
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // 4. Serve Static Assets (default behavior)
    return env.ASSETS.fetch(request);
  }
};
