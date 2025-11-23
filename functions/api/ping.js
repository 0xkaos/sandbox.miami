export async function onRequest(context) {
  return new Response("Pong! Functions are working.", { status: 200 });
}