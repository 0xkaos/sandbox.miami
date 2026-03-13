export class StylusSession {
  constructor(state) {
    this.state = state;
    this.clients = new Map();
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role');

    if (role !== 'desktop' && role !== 'mobile') {
      return new Response('Missing or invalid role', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);

    serverSocket.accept();
    this.clients.set(role, serverSocket);

    const sendPresence = () => {
      const desktopConnected = this.clients.has('desktop');
      const mobileConnected = this.clients.has('mobile');
      const payload = JSON.stringify({
        type: 'presence',
        desktopConnected,
        mobileConnected
      });

      for (const ws of this.clients.values()) {
        try {
          ws.send(payload);
        } catch (_) {
          // Ignore stale sockets; close handler will clean up.
        }
      }
    };

    sendPresence();

    serverSocket.addEventListener('message', (event) => {
      if (role === 'mobile') {
        const desktopSocket = this.clients.get('desktop');
        if (desktopSocket) {
          try {
            desktopSocket.send(event.data);
          } catch (_) {
            // Ignore failed sends to stale desktop socket.
          }
        }
      }
    });

    serverSocket.addEventListener('close', () => {
      this.clients.delete(role);
      sendPresence();
    });

    serverSocket.addEventListener('error', () => {
      this.clients.delete(role);
      sendPresence();
    });

    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket Endpoint: /api/stylus/socket
    if (url.pathname === '/api/stylus/socket') {
      const sessionId = url.searchParams.get('session');

      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Missing session query param.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!env.STYLUS_SESSIONS) {
        return new Response(JSON.stringify({ error: "Durable Object binding 'STYLUS_SESSIONS' is missing." }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const id = env.STYLUS_SESSIONS.idFromName(sessionId);
      const stub = env.STYLUS_SESSIONS.get(id);
      return stub.fetch(request);
    }

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
            return new Response("Not found", { status: 404 });
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

    // API Endpoint: /api/audio
    if (url.pathname === '/api/audio') {
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: "R2 Bucket 'BUCKET' not bound." }), { 
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
      }

      // GET
      if (request.method === 'GET') {
        try {
          const object = await env.BUCKET.get('audio.json');
          
          if (object === null) {
            return new Response(JSON.stringify({}, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
          }

          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Content-Type', 'application/json');

          return new Response(object.body, { headers });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Error reading from R2", detail: err.message }), { 
              status: 500,
              headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // POST
      if (request.method === 'POST') {
        try {
            // Password Protection
            const password = request.headers.get('x-admin-password');
            const correctPassword = env.ADMIN_PASSWORD || "admin";
            
            if (password !== correctPassword) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { 
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            let body;
            try {
                body = await request.json();
            } catch (e) {
                return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }

            // Partial Update
            if (body && typeof body === 'object' && body.pattern && body.data) {
                const existing = await env.BUCKET.get('audio.json');
                let store = {};
                if (existing !== null) {
                    const txt = await new Response(existing.body).text();
                    try { store = JSON.parse(txt); } catch (e) { store = {}; }
                }

                store[body.pattern] = body.data;

                const json = JSON.stringify(store, null, 2);
                await env.BUCKET.put('audio.json', json, {
                    httpMetadata: { contentType: 'application/json' }
                });

                return new Response(JSON.stringify({ ok: true, updated: body.pattern }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // Full Replacement
            if (body && typeof body === 'object') {
                const json = JSON.stringify(body, null, 2);
                await env.BUCKET.put('audio.json', json, {
                    httpMetadata: { contentType: 'application/json' }
                });

                return new Response(JSON.stringify({ ok: true, replaced: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ error: 'Invalid JSON payload structure' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

        } catch (err) {
            return new Response(JSON.stringify({ error: 'Error saving to R2', detail: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // 4. Serve Static Assets (default behavior)
    return env.ASSETS.fetch(request);
  }
};
