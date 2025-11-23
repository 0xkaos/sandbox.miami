
export async function onRequestGet(context) {
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
