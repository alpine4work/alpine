declare global {
    interface Headers {
        /**
         * [Available in `node-fetch`][1] but not in browsers. Implemented before the
         * standard `getSetCookie()` function for the purpose of parsing `Set-Cookie`.
         *
         * [1]: https://www.npmjs.com/package/node-fetch#extract-set-cookie-header
         */
        raw?(): {readonly [key: string]: ReadonlyArray<string>};
    }
}

/**
 * The `Set-Cookie` header may be listed [multiple times][1] in HTTP headers but
 * the `Headers` object acts as a simple key/value store.
 *
 * A standardized [`getSetCookie()`][2] function was added but `node-fetch` also
 * has an [unstandardized `raw()`][3] function. Use whatever means available to get
 * the multiple `Set-Cookie` headers.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#see_also
 * [2]: https://developer.mozilla.org/en-US/docs/Web/API/Headers/getSetCookie
 * [3]: https://www.npmjs.com/package/node-fetch#extract-set-cookie-header
 */
export function getSetCookieHeaders(headers: Headers): ReadonlyArray<string> {
    if (typeof headers.getSetCookie === "function") return headers.getSetCookie();

    if (typeof headers.raw === "function") return headers.raw()["set-cookie"] ?? [];

    const setCookieHeader = headers.get("set-cookie");
    if (setCookieHeader === null) return [];

    return [setCookieHeader];
}
