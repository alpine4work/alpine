import {assert} from "~/shared/helpers/control/assert";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names";
import {TracerBase} from "~/shared/tracer/tracer_base";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_header_propagation";
import {TracerSpan} from "~/shared/tracer/tracer_span";

/**
 * Same as the global [`fetch()`][1] but we create a span for the HTTP request.
 * Generally should always use this instead of the global `fetch()`.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
 */
export async function fetchWithTracer(
    tracer: TracerBase,
    url: string,
    requestInit?: RequestInit,
): Promise<Response> {
    return fetchWithTracerAndReturnSpan(tracer, url, requestInit).responsePromise;
}

/**
 * Same as `fetchWithTracer()` but returns the span for further processing.
 * You should almost always prefer using `fetchWithTracer()`.
 */
export function fetchWithTracerAndReturnSpan(
    tracer: TracerBase,
    url: string,
    requestInit?: RequestInit,
): {
    span: TracerSpan;
    responsePromise: Promise<Response>;
} {
    const requestUrl = new URL(url, window.location.href);
    const requestMethod = requestInit?.method ?? "GET";

    const {span, finishSpan} = tracer.startSpan(`HTTP client ${requestMethod}`);

    const requestHeaders = new Headers(requestInit?.headers);
    addTracerPropagationContextHeader(requestHeaders, span);

    // eslint-disable-next-line no-global-fetch
    const responsePromise = fetch(url, {...requestInit, headers: requestHeaders});

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
                span.addException(error);
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
            span.addException(error);
            finishSpan();
            throw error;
        }
    })();

    return {
        span,
        responsePromise: actualResponsePromise,
    };
}
