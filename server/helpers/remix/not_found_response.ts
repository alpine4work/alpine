/**
 * Create a 404 not found response to be rendered by a Remix `CatchBoundary`.
 *
 * See: https://remix.run/docs/en/v1/guides/not-found
 */
export function notFoundResponse() {
    return new Response("Not Found", {
        status: 404,
    });
}
