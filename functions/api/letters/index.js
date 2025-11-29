
export async function onRequestGet(context) {
    // Check if the bucket is bound
    if (!context.env.BUCKET) {
        return new Response("R2 Bucket 'BUCKET' not bound. Check Cloudflare Dashboard > Settings > Functions.", { status: 503 });
    }

    try {
        const object = await context.env.BUCKET.get('letters.json');
        
        if (object === null) {
            return new Response('Not found', { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Content-Type', 'application/json');

        return new Response(object.body, {
            headers,
        });
    } catch (err) {
        return new Response("Error reading from R2: " + err.message, { status: 500 });
    }
}

export async function onRequestPost(context) {
    if (!context.env.BUCKET) {
        return new Response("R2 Bucket 'BUCKET' not bound.", { status: 503 });
    }

    // Password Protection
    const password = context.request.headers.get('x-admin-password');
    const correctPassword = context.env.ADMIN_PASSWORD || "admin"; // Default to "admin" if env var not set
    
    if (password !== correctPassword) {
        return new Response("Unauthorized", { status: 401 });
    }

    try {
        const contentType = (context.request.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const body = await context.request.json();

        // If body contains { char: <name>, strokes: [...] } then perform a partial update (merge single character)
        if (body && typeof body === 'object' && body.char && body.strokes !== undefined) {
            // Read existing file (if any)
            const existing = await context.env.BUCKET.get('letters.json');
            let store = {};
            if (existing !== null) {
                const txt = await new Response(existing.body).text();
                try { store = JSON.parse(txt); } catch (e) { store = {}; }
            }

            store[body.char] = body.strokes;

            const json = JSON.stringify(store, null, 2);
            await context.env.BUCKET.put('letters.json', json, {
                httpMetadata: { contentType: 'application/json' }
            });

            return new Response(JSON.stringify({ ok: true, updated: body.char }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // Otherwise treat body as full store replacement
        if (body && typeof body === 'object') {
            const json = JSON.stringify(body, null, 2);
            await context.env.BUCKET.put('letters.json', json, {
                httpMetadata: { contentType: 'application/json' }
            });

            return new Response(JSON.stringify({ ok: true, replaced: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Error saving to R2', detail: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
