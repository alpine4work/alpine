import {CookieJar as CookieJarInternal} from "tough-cookie";
import {getSetCookieHeaders} from "~/shared/helpers/http/get_set_cookie_headers.js";

/**
 * Manages cookies from HTTP requests/responses in-memory. Useful for maintaining
 * sessions tracked by cookies outside a web browser.
 *
 * Thin wrapper around the `tough-cookie` library that provides a more convenient
 * API for our system.
 */
export class CookieJar {
    private readonly _jar = new CookieJarInternal();

    /**
     * Puts the cookies in our jar into the request's cookie header.
     */
    public intoRequest(request: Request) {
        // Our `tough-cookie` jar is backed by an in-memory store so a synchronous call is
        // fine.
        const cookieHeaderString = this._jar.getCookieStringSync(request.url);

        if (cookieHeaderString) {
            request.headers.set("cookie", cookieHeaderString);
        }
    }

    /**
     * Incorporates new cookies from a `Response`'s `Set-Cookie` header into our cookie
     * jar.
     */
    public fromResponse(response: Response) {
        const setCookieHeaders = getSetCookieHeaders(response.headers);

        for (const setCookieHeader of setCookieHeaders) {
            // Our `tough-cookie` jar is backed by an in-memory store so a synchronous call is
            // fine.
            this._jar.setCookieSync(setCookieHeader, response.url);
        }
    }
}
