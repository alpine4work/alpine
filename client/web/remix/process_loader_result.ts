/**
 * Process the result of a Remix loader function like `@remix-run/router`. Notably
 * we parse the JSON body of `Response` types.
 */
export async function processLoaderResult(result: unknown): Promise<unknown> {
    if (!(result instanceof Response)) return result;

    const contentType = result.headers.get("Content-Type");

    // Derived from:
    // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/router.ts#L3649-L3656
    if (contentType && /\bapplication\/json\b/.test(contentType)) {
        return await result.json();
    } else {
        return await result.text();
    }
}
