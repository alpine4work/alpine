import {assert} from "~/shared/helpers/control/assert";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names";
import {TracerSpan} from "~/shared/tracer/tracer_span";

/**
 * Same as the global [`fetch()`][1] but we create a span for the HTTP request.
 * Generally should always use this instead of the global `fetch()`.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
 */
export async function fetchWithTracer(parentSpan: TracerSpan, request: Request): Promise<Response> {
    return fetchWithTracerAndReturnSpan(parentSpan, request).responsePromise;
}

/**
 * Same as `fetchWithTracer()` but returns the span for further processing.
 * You should almost always prefer using `fetchWithTracer()`.
 */
export function fetchWithTracerAndReturnSpan(
    parentSpan: TracerSpan,
    request: Request,
): {
    span: TracerSpan;
    responsePromise: Promise<Response>;
} {
    const url = new URL(request.url);

    if (request.body) {
        let requestUncompressedContentLength = 0;
        const requestBodyReader = request.body.getReader();

        const newRequestBody = new ReadableStream<Uint8Array>({
            start: controller => {
                const read = () => {
                    requestBodyReader.read().then(
                        ({done, value}) => {
                            if (done) {
                                controller.close();

                                // Add the uncompressed content length to the span once we have it.
                                if (!span.isFinished()) {
                                    span.addData({
                                        http: {
                                            request: {
                                                uncompressedContentLength:
                                                    requestUncompressedContentLength,
                                            },
                                        },
                                    });
                                }
                            } else {
                                requestUncompressedContentLength += value.length;
                                controller.enqueue(value);
                            }
                        },
                        error => controller.error(error),
                    );
                };

                read();
            },
        });

        request = new Request(request, {body: newRequestBody});
    }

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
    const responsePromise = fetch(request);

    const span = parentSpan.startChildSpan(`HTTP ${request.method}`);

    span.addData({
        net: {
            peer: {
                name: url.hostname,
                port: url.port.length > 0 ? url.port : undefined,
            },
        },
        http: {
            url: request.url,
            method: request.method,
            userAgent: request.headers.get("user-agent") ?? undefined,
            request: {
                header: Object.fromEntries(
                    filterMapIterable(tracerEventHttpHeaderNames, headerName => {
                        const headerValue = request.headers.get(headerName);
                        if (!headerValue) return null;
                        return [headerName, headerValue];
                    }),
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
                            filterMapIterable(tracerEventHttpHeaderNames, headerName => {
                                const headerValue = response.headers.get(headerName);
                                if (!headerValue) return null;
                                return [headerName, headerValue];
                            }),
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
                span.finish();
                return response;
            }

            const responseBodyReader = response.body.getReader();
            let responseUncompressedContentLength = 0;

            // Wait until we read the entire body before finishing the span so we can add
            // the response content length.
            const finishSpan = () => {
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
                span.finish();
            };

            const finishSpanWithError = (error: any) => {
                span.addException(error, {escaped: true});
                span.finish();
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
                            finishSpan();
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
                        finishSpanWithError(error);
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
            span.finish();
            throw error;
        }
    })();

    return {
        span,
        responsePromise: actualResponsePromise,
    };
}
