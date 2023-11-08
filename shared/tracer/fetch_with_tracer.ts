import {UnavailableError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const globalFetch = fetch;

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
        spanRoute,
        fetch = globalFetch,
        sign,
        ...requestInit
    }: RequestInit & {
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
        spanRoute: string;

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
    },
    action: (response: Response, span: TracerSpan) => Promise<ResponseData>,
): Promise<ResponseData> {
    const requestUrl =
        typeof url === "string" && typeof window !== "undefined"
            ? new URL(url, window.location.href)
            : typeof url === "string"
            ? new URL(url)
            : url;

    assert(
        new RegExp(spanRoute.replaceAll(/(^|\/):[a-zA-Z0-9_]+(\/|$)/g, "$1[^/]+$2")).test(
            requestUrl.pathname,
        ),
        "`spanRoute` must match URL `pathname`",
    );

    const requestMethod = requestInit?.method ?? "GET";

    const {span, finishSpan} = tracer.startSpan(`HTTP client ${requestMethod} ${spanRoute}`);

    try {
        const requestHeaders = new Headers(requestInit?.headers);
        addTracerPropagationContextHeader(requestHeaders, span);

        let request = new Request(url, {
            ...requestInit,
            headers: requestHeaders,
        });

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
                route: spanRoute,
                url: requestUrl.toString(),
                method: requestMethod,
                userAgent: requestHeaders.get("user-agent") ?? undefined,
                request: {
                    header: Object.fromEntries(
                        filterIterable(requestHeaders, ([headerName]) =>
                            tracerEventHttpHeaderNames.has(headerName),
                        ),
                    ),
                },
            },
        });

        if (sign) {
            request = await sign(request, span);
        }

        // eslint-disable-next-line no-global-fetch
        const response = await fetch(request).catch(error => {
            // Classify network errors as the `Unavailable` status code.
            throw UnavailableError.from(error);
        });

        span.addData({
            http: {
                statusCode: response.status,
                response: {
                    header: Object.fromEntries(
                        filterIterable(response.headers, ([headerName]) =>
                            tracerEventHttpHeaderNames.has(headerName),
                        ),
                    ),
                },
            },
        });

        const responseContentLengthHeader = response.headers.get("content-length");
        const responseContentLengthHeaderNumber = responseContentLengthHeader
            ? parseInt(responseContentLengthHeader, 10)
            : null;

        let responseUncompressedContentLength = 0;

        // Count the bytes streamed through a response body. We only count the bytes if
        // `action()` consumes the body.
        const newResponseBody = response.body?.pipeThrough(
            new TransformStream({
                transform: (chunk, controller) => {
                    responseUncompressedContentLength += chunk.length;
                    controller.enqueue(chunk);
                },
            }),
        );

        let responseData;
        try {
            responseData = await action(new Response(newResponseBody, response), span);
        } finally {
            span.addData({
                http: {
                    response: {
                        contentLength: responseContentLengthHeaderNumber ?? undefined,
                        uncompressedContentLength: responseUncompressedContentLength,
                    },
                },
            });
        }

        finishSpan();
        return responseData;
    } catch (error) {
        span.addException(error);
        finishSpan();
        throw error;
    }
}
