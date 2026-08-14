export function createSimpleOkResponse(): Response {
    return new Response("200 OK", {
        status: 200,
        headers: {"content-type": "text/plain"},
    });
}
