import {parse as parseCookieHeader} from "cookie";
import {parse as parseSetCookieHeader} from "set-cookie-parser";
import {formatDate as formatHttpDate} from "tough-cookie";
import {FailedPreconditionError, UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {CookieJar} from "~/shared/helpers/http/cookie_jar.js";
import {getSetCookieHeaders} from "~/shared/helpers/http/get_set_cookie_headers.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {
    TracerEventHttpHeaderName,
    tracerEventHttpHeaderNames,
} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// The same error message is copied in `WebNavigationController.swift`'s
// `showUnhealthyAlert()` function. If we update the message here, we should
// update it there as well.
export const offlineErrorDisplayMessage = errorDisplayMessage`Your device isn’t connected to the internet. Make sure you’re online then try again.`;

const globalFetch = typeof fetch !== "undefined" ? fetch : undefined;

/**
 * External service names are not PascalCase like our internal service names
 * (in the `TracerServiceName` type) instead they are a human readable phrase,
 * potentially including spaces.
 *
 * For example "OpenSearch" is an external service name instead of
 * "Opensearch". "Opensearch" (without a capital "S") is how we refer to
 * OpenSearch in PascalCase since we want to treat it like a single word. But
 * OpenSearch is how you'd write the service name in a sentence.
 *
 * A simpler example is "Secrets Manager" instead of "SecretsManager" to refer
 * to the AWS Secrets Manager service.
 *
 * Human readable phrases match our span name style which is why we do this.
 */
export type ExternalServiceName = "OpenSearch" | "Cohere" | "LogoDev";

function isExternalServiceName(
    serviceName: TracerServiceName | ExternalServiceName,
): serviceName is ExternalServiceName {
    switch (serviceName) {
        case "OpenSearch":
        case "Cohere":
        case "LogoDev":
            return true;
        default:
            // Should handle all `ExternalServiceName`s. Only `TracerServiceName`s should
            // be left (`cast()` enforces this with TypeScript).
            cast<TracerServiceName>(serviceName);
            return false;
    }
}

/**
 * Same as the global [`fetch()`][1] but we create a span for the HTTP request.
 * Generally should always use this instead of the global `fetch()`.
 *
 * You must provide an `action` function to do something with the response. The
 * time it takes to execute the action (and any errors thrown) will be included
 * in the HTTP span. Generally you want to read the request body (with
 * `response.body()` or `response.json()`). Deserialization logic can also go
 * in the `action` function and contribute to the HTTP request time.
 *
 * We require you to provide an action so:
 *
 * 1. Response body read times (with `response.json()`) are included in the span
 * 2. Deserialization times are included in the HTTP span
 * 3. If the request failed, you can throw a detailed error object which will
 *    be included in the span (instead of the failed HTTP request appear to
 *    succeed)
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
 */
export async function fetchWithTracer<ResponseData>(
    tracer: TracerBase,
    url: URL | string,
    {
        serviceName,
        route,
        fetch = globalFetch!,
        sign,
        cookieJar,
        ...requestInit
    }: RequestInit & {
        /**
         * The name of the service we are making a request to. Will be included in the
         * span name.
         */
        serviceName: TracerServiceName | ExternalServiceName;

        /**
         * A description of the path we'll include in the `TracerSpan`'s name.
         * This should be low cardinality for analysis.
         *
         * Uses a subset of the [URL Pattern API][1].
         *
         * For example if you are accessing a path that looks like
         * `/task_index/_update/27g6s1h4ygh1zqzw5h23gqtn88` your route should not
         * include the `Id` (which is very high cardinality) and instead be
         * `/task_index/_update/:taskId`. That way you can analyze this method
         * across all tasks.
         *
         * It's recommended that your identifier names (e.g. `:taskId`) are
         * formatted as camel case (instead of `:task_id`).
         *
         * [1]: https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API
         */
        route: string;

        /**
         * Provide a custom fetch function in case, for some reason, you can't use the
         * global fetch function. Useful for Cloudflare Durable Object stubs which
         * [provide their own fetch function][1].
         *
         * [1]: https://developers.cloudflare.com/durable-objects/how-to/create-durable-object-stubs/#2-send-http-requests
         */
        fetch?: (request: Request) => Promise<Response>;

        /**
         * Sign or otherwise modify a request object before it's sent. Useful for
         * signing requests to AWS with a library like [`aws4fetch`][1].
         *
         * [1]: https://www.npmjs.com/package/aws4fetch
         */
        sign?: (request: Request, span: TracerSpan) => Promise<Request>;

        /**
         * If you want to maintain a session across HTTP calls then provide a
         * `CookieJar` which stores cookies from responses and sends previously
         * assigned cookies with the response.
         */
        cookieJar?: CookieJar;
    },
    action: (response: Response, span: TracerSpan) => Promise<ResponseData>,
): Promise<ResponseData> {
    const requestUrl =
        typeof url === "string" && typeof window !== "undefined"
            ? new URL(url, window.location.href)
            : typeof url === "string"
              ? new URL(url)
              : url;

    if (process.env.NODE_ENV !== "production") {
        assert(
            new RegExp(
                route.replaceAll(
                    /(^|\/)(\*|:[a-zA-Z0-9_]+)(?=\/|$)/g,
                    (substring, match1, match2) => `${match1}${match2 === "*" ? ".*" : "[^/]+"}`,
                ),
            ).test(requestUrl.pathname),
            "`route` must match URL `pathname`",
        );
    }

    const requestMethod = requestInit?.method ?? "GET";

    const {span, finishSpan} = tracer.startSpan(`${serviceName} ${requestMethod} ${route}`);

    try {
        const requestHeaders = new Headers(requestInit?.headers);

        // Add our tracer propagation context if this isn't a request to an external
        // service.
        if (!isExternalServiceName(serviceName)) {
            addTracerPropagationContextHeader(requestHeaders, span);
        }

        let request = new Request(url, {
            ...requestInit,
            headers: requestHeaders,
        });

        cookieJar?.intoRequest(request);

        span.addData({
            net: {
                sock: {
                    peer: {
                        name: typeof requestUrl !== "string" ? requestUrl.hostname : undefined,
                        port:
                            typeof requestUrl !== "string" && requestUrl.port.length > 0
                                ? requestUrl.port
                                : undefined,
                    },
                },
            },
            http: {
                service: {name: serviceName},
                route,
                url: requestUrl.toString(),
                method: requestMethod,
                userAgent: request.headers.get("user-agent") ?? undefined,
                request: {
                    header: getHeadersTracerData(request.headers),
                    obfuscatedCookieHeader: obfuscateCookieHeader(request.headers),
                },
            },
        });

        if (sign) {
            request = await sign(request, span);
        }

        const fetchStartTime = span.clock.now();

        // eslint-disable-next-line no-global-fetch
        const response = await fetch(request).catch(error => {
            // Classify network errors as the `Unavailable` status code.
            //
            // If the user is offline then we use a `FailedPreconditionError` since it's a
            // user error (no internet connection) not a system error. System errors show a
            // red error icon.
            throw new (
                typeof window !== "undefined" && !navigator.onLine
                    ? FailedPreconditionError
                    : UnavailableError
            )(error instanceof Error ? error.message : String(error), {
                displayMessage:
                    // If we're in a web browser, if we failed to make a request it's probably the
                    // user's internet connection and they should look into a fix.
                    typeof window !== "undefined" && !navigator.onLine
                        ? offlineErrorDisplayMessage
                        : undefined,
            });
        });

        const fetchEndTime = span.clock.now();

        cookieJar?.fromResponse(response);

        span.addData({
            http: {
                fetchDurationMs: fetchEndTime - fetchStartTime,
                statusCode: response.status,
                response: {
                    header: getHeadersTracerData(response.headers),
                    obfuscatedSetCookieHeader: obfuscateSetCookieHeaders(response.headers),
                },
            },
        });

        const responseData = await action(response, span);

        finishSpan();
        return responseData;
    } catch (error) {
        span.addException(error);
        finishSpan();
        throw error;
    }
}

export function getHeadersTracerData(
    headers: Iterable<[string, string | ReadonlyArray<string> | undefined]>,
): {
    readonly [K in TracerEventHttpHeaderName]?: string | number;
} {
    return Object.fromEntries(
        filterMapIterable(headers, header => {
            const normalizedHeaderName = header[0].toLowerCase();
            if (!tracerEventHttpHeaderNames.has(normalizedHeaderName)) return;

            if (header[1] === undefined) return;

            if (normalizedHeaderName === "content-length") {
                if (typeof header[1] !== "string" || !/^\s*\d+\s*$/.test(header[1])) return;
                return [header[0], parseInt(header[1], 10)];
            }

            if (isReadonlyArray(header[1])) {
                if (header[1].length === 0) return;
                return [header[0], header[1].join(", ")];
            }

            return header;
        }),
    );
}

export function obfuscateCookieHeader(headers: Headers): string | undefined {
    const cookieHeader = headers.get("cookie");
    if (!cookieHeader) return undefined;

    const parsedCookieHeader = parseCookieHeader(cookieHeader);
    return Object.keys(parsedCookieHeader).join("; ");
}

export function obfuscateSetCookieHeaders(headers: Headers): string | undefined {
    const setCookieHeaders = getSetCookieHeaders(headers);
    if (setCookieHeaders.length === 0) return undefined;
    return obfuscateSetCookieHeaderString(setCookieHeaders);
}

export function obfuscateSetCookieHeaderString(
    headerString: string | ReadonlyArray<string> | number | undefined,
): string | undefined {
    if (headerString === undefined) return undefined;
    if (typeof headerString === "number") return undefined;

    const parsedSetCookieHeaders = parseSetCookieHeader(headerString);
    if (parsedSetCookieHeaders.length === 0) return undefined;

    return parsedSetCookieHeaders
        .map(setCookie => {
            const parts = [setCookie.name];

            if (setCookie.domain) {
                parts.push(`Domain=${encodeURIComponent(setCookie.domain)}`);
            }

            if (setCookie.expires) {
                parts.push(`Expires=${formatHttpDate(setCookie.expires)}`);
            }

            if (setCookie.httpOnly) {
                parts.push("HttpOnly");
            }

            if (setCookie.maxAge) {
                parts.push(`Max-Age=${setCookie.maxAge}`);
            }

            if (setCookie.path) {
                parts.push(`Path=${encodeURIComponent(setCookie.path)}`);
            }

            if (setCookie.sameSite) {
                parts.push(`SameSite=${encodeURIComponent(setCookie.sameSite)}`);
            }

            if (setCookie.secure) {
                parts.push("Secure");
            }

            return parts.join("; ");
        })
        .join(", ");
}
