import {assert} from "~/shared/helpers/control/assert";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {TracerSpan} from "~/shared/tracer/tracer";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/tracer_event_http_header_names";

/**
 * Same as the global [`fetch()`][1] but we create a span for the HTTP request.
 * Generally should always use this instead of the global `fetch()`.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
 */
export async function fetchWithTracer(
    parentSpan: TracerSpan,
    url: string,
    requestInit?: RequestInit,
): Promise<Response> {
    return fetchWithTracerAndReturnSpan(parentSpan, url, requestInit).responsePromise;
}

/**
 * Same as `fetchWithTracer()` but returns the span for further processing.
 * You should almost always prefer using `fetchWithTracer()`.
 */
export function fetchWithTracerAndReturnSpan(
    parentSpan: TracerSpan,
    url: string,
    requestInit?: RequestInit,
): {
    span: TracerSpan;
    responsePromise: Promise<Response>;
} {
    // This is a little weird, but start the fetch before starting the span. This
    // won't count any blocking time spent constructing the span.
    //
    // We do this because in Cloudflare Workers `Date.now()` [returns the time of
    // the last I/O][1] for [security against timing attacks][2]. So we want to
    // measure the start time of the HTTP request span after I/O happens so the
    // Cloudflare timer progresses.
    //
    // [1]: https://developers.cloudflare.com/workers/runtime-apis/web-standards/
    // [2]: https://developers.cloudflare.com/workers/learning/security-model/
    //
    // TODO(calebmer): Test that this actually works?
    //
    // TODO(calebmer): Include span propagation headers!
    // eslint-disable-next-line no-global-fetch
    const responsePromise = fetch(url, requestInit);

    const requestUrl = new URL(url, window.location.href);
    const requestMethod = requestInit?.method ?? "GET";
    const requestHeaders = new Headers(requestInit?.headers);

    const {span, finishSpan} = parentSpan.startSpan(`HTTP client ${requestMethod}`);

    span.addData({
        net: {
            sock: {
                peer: {
                    name: requestUrl.hostname,
                    port: requestUrl.port.length > 0 ? requestUrl.port : undefined,
                },
            },
        },
        http: {
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

    const actualResponsePromise = (async () => {
        try {
            const response = await responsePromise;

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

            if (!response.body) {
                span.addData({http: {response: {contentLength: 0}}});
                finishSpan();
                return response;
            }

            const responseBodyReader = response.body.getReader();
            let responseUncompressedContentLength = 0;

            // Wait until we read the entire body before finishing the span so we can add
            // the response content length.
            const finishSpanAfterResponseBodyRead = () => {
                span.addData({
                    http: {
                        response: {
                            // If there was no `Content-Length` header then we don't know the compressed
                            // size of the response so don't include a size at all.
                            contentLength: responseContentLengthHeaderNumber ?? undefined,
                            uncompressedContentLength: responseUncompressedContentLength,
                        },
                    },
                });
                finishSpan();
            };

            const finishSpanAfterResponseBodyError = (error: any) => {
                span.addException(error, {escaped: true});
                finishSpan();
            };

            let newResponseBodyController:
                | {
                      type: "Waiting";
                      controllerQueue: Array<
                          (controller: ReadableStreamController<Uint8Array>) => void
                      >;
                  }
                | {
                      type: "Started";
                      controller: ReadableStreamController<Uint8Array>;
                  } = {
                type: "Waiting",
                controllerQueue: [],
            };

            const read = () => {
                responseBodyReader.read().then(
                    ({done, value}) => {
                        if (done) {
                            if (newResponseBodyController.type === "Started") {
                                newResponseBodyController.controller.close();
                            } else {
                                newResponseBodyController.controllerQueue.push(controller =>
                                    controller.close(),
                                );
                            }
                            finishSpanAfterResponseBodyRead();
                        } else {
                            responseUncompressedContentLength += value.length;

                            if (newResponseBodyController.type === "Started") {
                                newResponseBodyController.controller.enqueue(value);
                            } else {
                                newResponseBodyController.controllerQueue.push(controller =>
                                    controller.enqueue(value),
                                );
                            }
                            read();
                        }
                    },
                    error => {
                        if (newResponseBodyController.type === "Started") {
                            newResponseBodyController.controller.error(error);
                        } else {
                            newResponseBodyController.controllerQueue.push(controller =>
                                controller.error(error),
                            );
                        }
                        finishSpanAfterResponseBodyError(error);
                    },
                );
            };

            // Immediately start reading the response body without waiting for the code we
            // return to. That way we can provide an accurate HTTP response time. We buffer
            // the response chunks until the code we return to starts reading the body
            // stream.
            read();

            const newResponseBody = new ReadableStream<Uint8Array>({
                start: controller => {
                    assert(newResponseBodyController.type === "Waiting");

                    for (const callback of newResponseBodyController.controllerQueue) {
                        callback(controller);
                    }

                    newResponseBodyController = {
                        type: "Started",
                        controller,
                    };
                },
            });

            return new Response(newResponseBody, response);
        } catch (error) {
            span.addException(error, {escaped: true});
            finishSpan();
            throw error;
        }
    })();

    return {
        span,
        responsePromise: actualResponsePromise,
    };
}
