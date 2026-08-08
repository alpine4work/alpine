/**
 * HTTP headers included in trace data. We use an HTTP header allow list so that
 * clients can't send arbitrary, unknown, headers.
 *
 * Headers are in lower kebab-case. (Not uppercase like Kebab-Case.) Header names
 * are converted to snake_case before sending to telemetry services.
 *
 * `user-agent` is not included since that's already captured in the trace event
 * data property `http.userAgent`.
 *
 * A handpicked list from [Wikipedia's list of HTTP header fields][1] that appear
 * to not have sensitive user content.
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
    "content-length": true;
    date: true;
    forwarded: true;
    host: true;
    origin: true;
    pragma: true;
    prefer: true;
    trailer: true;
    "transfer-encoding": true;
    upgrade: true;
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
    referer: true;
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

    // AWS headers
    //
    // https://docs.aws.amazon.com/AmazonS3/latest/API/RESTCommonRequestHeaders.html
    // https://docs.aws.amazon.com/AmazonS3/latest/API/RESTCommonResponseHeaders.html
    "content-md5": true;
    "x-amz-date": true;
    "x-amz-content-sha256": true;
    "x-amz-id-2": true;
    "x-amz-request-id": true;

    // Cloudflare headers
    //
    // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers/
    "cf-connecting-ip": true;
    "cf-connecting-ipv6": true;
    "cf-ew-via": true;
    "cf-pseudo-ipv4": true;
    "cf-ray": true;
    "cf-ipcountry": true;
    "cdn-loop": true;
    "cf-worker": true;

    // Cloudflare cache status header
    //
    // https://developers.cloudflare.com/cache/concepts/cache-responses
    "cf-cache-status": true;

    // APNs headers
    //
    // https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
    // https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns#Understand-error-codes
    "apns-push-type": true;
    "apns-id": true;
    "apns-expiration": true;
    "apns-priority": true;
    "apns-topic": true;
    "apns-collapse-id": true;
    "apns-unique-id": true;

    // Remix headers
    "x-remix-catch": true;
    "x-remix-error": true;
    "x-remix-redirect": true;
    "x-remix-reload-document": true;
    "x-remix-revalidate": true;
    "x-remix-status": true;

    // Cyberworlds custom headers
    "cyberworlds-durable-object-id-name": true;
    "cyberworlds-durable-object-if-initialized": true;
    "cyberworlds-route": true;
    "cyberworlds-transient-error": true;
    "cyberworlds-fixed-time-for-test": true;
    "cyberworlds-active-site-id": true;
    "cyberworlds-space-id": true;

    // DEPRECATED: We keep this around for tracer event backwards compatibility but we
    // don't use this header anymore.
    "cyberworlds-space-id-hint": true;

    // Loops headers
    //
    // https://loops.so/docs/api-reference/intro#rate-limiting-details
    "x-ratelimit-limit": true;
    "x-ratelimit-remaining": true;
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
    "content-length": true,
    date: true,
    forwarded: true,
    host: true,
    origin: true,
    pragma: true,
    prefer: true,
    trailer: true,
    "transfer-encoding": true,
    upgrade: true,
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
    referer: true,
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
    "content-md5": true,
    "x-amz-date": true,
    "x-amz-content-sha256": true,
    "x-amz-id-2": true,
    "x-amz-request-id": true,
    "cf-connecting-ip": true,
    "cf-connecting-ipv6": true,
    "cf-ew-via": true,
    "cf-pseudo-ipv4": true,
    "cf-ray": true,
    "cf-ipcountry": true,
    "cdn-loop": true,
    "cf-worker": true,
    "cf-cache-status": true,
    "apns-push-type": true,
    "apns-id": true,
    "apns-expiration": true,
    "apns-priority": true,
    "apns-topic": true,
    "apns-collapse-id": true,
    "apns-unique-id": true,
    "x-remix-catch": true,
    "x-remix-error": true,
    "x-remix-redirect": true,
    "x-remix-reload-document": true,
    "x-remix-revalidate": true,
    "x-remix-status": true,
    "cyberworlds-durable-object-id-name": true,
    "cyberworlds-durable-object-if-initialized": true,
    "cyberworlds-space-id-hint": true,
    "cyberworlds-route": true,
    "cyberworlds-transient-error": true,
    "cyberworlds-fixed-time-for-test": true,
    "cyberworlds-active-site-id": true,
    "cyberworlds-space-id": true,
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
};

/**
 * All of the header names in our `TracerEventHttpHeaderName` type available at
 * runtime.
 */
export const tracerEventHttpHeaderNames: ReadonlySet<string> = new Set(
    Object.keys(tracerEventHttpHeaderNameMap),
);
