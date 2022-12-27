import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names";
import {startSpanFromPropagationContextHeader} from "~/shared/tracer/tracer_header_propagation";
import {TracerRoot} from "~/shared/tracer/tracer_root";
import {TracerSpan} from "~/shared/tracer/tracer_span";

/**
 * Create a span for the server response to the fetch HTTP API.
 *
 * If there are trace propagation headers, then we setup our span as a child of
 * the propagation context.
 *
 * May re-create the `Request` object so when responding to a request use the
 * `Request` object passed into the action.
 */
export async function traceFetchResponse(
    tracer: TracerRoot,
    request: Request,
    requestUrl: URL,
    action: (span: TracerSpan, request: Request) => Promise<Response>,
): Promise<Response> {
    const {span, finishSpan} = startSpanFromPropagationContextHeader(
        tracer,
        `HTTP server ${request.method}`,
        request,
    );

    try {
        const requestContentLengthHeader = request.headers.get("content-length");
        const requestContentLengthHeaderNumber = requestContentLengthHeader
            ? parseInt(requestContentLengthHeader, 10)
            : null;

        span.addData({
            http: {
                method: request.method,
                scheme: requestUrl.protocol.slice(0, -1),
                target: `${requestUrl.pathname}${requestUrl.search}`,
                // We depend on Cloudflare to set the `cf-connecting-ip` header on our request
                // to get the IP address.
                // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
                clientIp: request.headers.get("cf-connecting-ip") ?? undefined,
                userAgent: request.headers.get("user-agent") ?? undefined,
                request: {
                    contentLength: requestContentLengthHeaderNumber ?? undefined,
                    header: Object.fromEntries(
                        filterIterable(request.headers, ([headerName]) =>
                            tracerEventHttpHeaderNames.has(headerName),
                        ),
                    ),
                },
            },
        });

        // Measure the uncompressed request body size by creating an intermediate
        // readable stream on top of the request body.
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
                                    read();
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

        const response = await action(span, request);

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

        finishSpan();
        return response;
    } catch (error) {
        span.addExceptionData(error, {escaped: true});
        finishSpan();
        throw error;
    }
}
