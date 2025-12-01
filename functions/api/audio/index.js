export async function onRequestGet(context) {
    // Check if the bucket is bound
    if (!context.env.BUCKET) {
        return new Response("R2 Bucket 'BUCKET' not bound. Check Cloudflare Dashboard > Settings > Functions.", { status: 503 });
    }

    try {
        const object = await context.env.BUCKET.get('audio.json');
        
        if (object === null) {
            // Return empty object if file doesn't exist yet
            return new Response(JSON.stringify({}, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
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
    try {
        if (!context.env.BUCKET) {
            console.error("R2 Bucket 'BUCKET' not bound in environment.");
            return new Response("R2 Bucket 'BUCKET' not bound.", { status: 503 });
        }

        // Password Protection
        const password = context.request.headers.get('x-admin-password');
        const correctPassword = context.env.ADMIN_PASSWORD || "admin"; // Default to "admin" if env var not set
        
        if (password !== correctPassword) {
            console.warn(`Unauthorized access attempt. Got: '${password}'`);
            return new Response("Unauthorized", { status: 401 });
        }

        const contentType = (context.request.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        let body;
        try {
            body = await context.request.json();
        } catch (e) {
            console.error("Failed to parse JSON body:", e);
            return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Partial Update: { pattern: "Name", data: { ... } }
        if (body && typeof body === 'object' && body.pattern && body.data) {
            // Read existing file
            const existing = await context.env.BUCKET.get('audio.json');
            let store = {};
            if (existing !== null) {
                const txt = await new Response(existing.body).text();
                try { store = JSON.parse(txt); } catch (e) { store = {}; }
            }

            store[body.pattern] = body.data;

            const json = JSON.stringify(store, null, 2);
            await context.env.BUCKET.put('audio.json', json, {
                httpMetadata: { contentType: 'application/json' }
            });

            return new Response(JSON.stringify({ ok: true, updated: body.pattern }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // Full Replacement
        if (body && typeof body === 'object') {
            const json = JSON.stringify(body, null, 2);
            await context.env.BUCKET.put('audio.json', json, {
                httpMetadata: { contentType: 'application/json' }
            });

            return new Response(JSON.stringify({ ok: true, replaced: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ error: 'Invalid JSON payload structure' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        console.error("Server Error in onRequestPost:", err);
        return new Response(JSON.stringify({ error: 'Error saving to R2', detail: err.message, stack: err.stack }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
