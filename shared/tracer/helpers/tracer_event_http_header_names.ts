/**
 * HTTP headers included in trace data. We use an HTTP header allow list so
 * that clients can't send arbitrary, unknown, headers.
 *
 * Headers are in lower kebab-case. (Not uppercase like Kebab-Case.) Header
 * names are converted to snake_case before sending to telemetry services.
 *
 * `user-agent` is not included since that's already captured in the trace
 * event data property `http.userAgent`.
 *
 * A handpicked list from [Wikipedia's list of HTTP header fields][1] that
 * appear to not have sensitive user content.
 *
 * [1]: https://en.wikipedia.org/wiki/List_of_HTTP_header_fields
 */
export type TracerEventHttpHeaderName = keyof TracerEventHttpHeaderNameMap;

type TracerEventHttpHeaderNameMap = {
    accept: true;
    "accept-charset": true;
    "accept-encoding": true;
    "accept-language": true;
    "access-control-request-method": true;
    "access-control-request-headers": true;
    "cache-control": true;
    connection: true;
    "content-encoding": true;
    "content-type": true;
    date: true;
    forwarded: true;
    host: true;
    origin: true;
    pragma: true;
    prefer: true;
    trailer: true;
    "transfer-encoding": true;
    via: true;
    warning: true;
    "x-requested-with": true;
    "x-forwarded-for": true;
    "x-forwarded-host": true;
    "x-forwarded-proto": true;
    "x-http-method-override": true;
    "x-request-id": true;
    "accept-ch": true;
    "accept-ranges": true;
    age: true;
    allow: true;
    "alt-svc": true;
    "content-disposition": true;
    "content-language": true;
    expires: true;
    "last-modified": true;
    "preference-applied": true;
    "retry-after": true;
    server: true;
    "strict-transport-security": true;
    vary: true;
    "content-security-policy": true;
    "x-content-security-policy": true;
    "x-webkit-csp": true;
    "permissions-policy": true;
    "timing-allow-origin": true;
    "x-powered-by": true;
    "x-ua-compatible": true;
    "x-xss-protection": true;
};

const tracerEventHttpHeaderNameMap: TracerEventHttpHeaderNameMap = {
    accept: true,
    "accept-charset": true,
    "accept-encoding": true,
    "accept-language": true,
    "access-control-request-method": true,
    "access-control-request-headers": true,
    "cache-control": true,
    connection: true,
    "content-encoding": true,
    "content-type": true,
    date: true,
    forwarded: true,
    host: true,
    origin: true,
    pragma: true,
    prefer: true,
    trailer: true,
    "transfer-encoding": true,
    via: true,
    warning: true,
    "x-requested-with": true,
    "x-forwarded-for": true,
    "x-forwarded-host": true,
    "x-forwarded-proto": true,
    "x-http-method-override": true,
    "x-request-id": true,
    "accept-ch": true,
    "accept-ranges": true,
    age: true,
    allow: true,
    "alt-svc": true,
    "content-disposition": true,
    "content-language": true,
    expires: true,
    "last-modified": true,
    "preference-applied": true,
    "retry-after": true,
    server: true,
    "strict-transport-security": true,
    vary: true,
    "content-security-policy": true,
    "x-content-security-policy": true,
    "x-webkit-csp": true,
    "permissions-policy": true,
    "timing-allow-origin": true,
    "x-powered-by": true,
    "x-ua-compatible": true,
    "x-xss-protection": true,
};

/**
 * All of the header names in our `TracerEventHttpHeaderName` type
 * available at runtime.
 */
export const tracerEventHttpHeaderNames = Object.keys(
    tracerEventHttpHeaderNameMap,
) as ReadonlyArray<TracerEventHttpHeaderName>;
