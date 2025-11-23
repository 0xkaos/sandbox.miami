
export async function onRequestGet(context) {
    // Check if the bucket is bound
    if (!context.env.BUCKET) {
        return new Response("R2 Bucket 'BUCKET' not bound. Check Cloudflare Dashboard > Settings > Functions.", { status: 503 });
    }

    try {
        const object = await context.env.BUCKET.get('letters.json');
        
        if (object === null) {
            // R2 is empty. Try to seed from static asset.
            const url = new URL(context.request.url);
            url.pathname = '/threejs/hebrew_script_writer/images/letters.json';
            
            console.log("Seeding R2 from:", url.toString());
            
            // Use internal asset fetcher if available, otherwise standard fetch
            const fetcher = context.env.ASSETS || fetch;
            const staticResp = await fetcher(url.toString());
            
            if (staticResp.ok) {
                const data = await staticResp.json();
                const json = JSON.stringify(data, null, 2);
                
                // Save to R2
                await context.env.BUCKET.put('letters.json', json, {
                    httpMetadata: { contentType: 'application/json' }
                });
                
                return new Response(json, {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            return new Response('Not found (Seeding failed)', { status: 404 });
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

    try {
        const data = await context.request.json();
        const json = JSON.stringify(data, null, 2);
        
        await context.env.BUCKET.put('letters.json', json, {
            httpMetadata: {
                contentType: 'application/json',
            }
        });
        
        return new Response("Saved to R2", { status: 200 });
    } catch (err) {
        return new Response("Error saving to R2: " + err.message, { status: 500 });
    }
}
