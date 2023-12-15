import {validateTracerEventFlatDataForPropagation} from "~/server/tracer/validate_tracer_event_flat_data.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {isId} from "~/shared/id/id.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {
    obfuscateCookieHeader,
    obfuscateSetCookieHeaders,
} from "~/shared/tracer/fetch_with_tracer.js";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {tracerPropagationContextHeaderName} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Create a span for the server request handler using the WhatWG HTTP API. Used
 * with `createStandardizedServer()`.
 *
 * If there are trace propagation headers, then we setup our span as a child of
 * the propagation context.
 *
 * May re-create the `Request` object so when responding to a request use the
 * `Request` object passed into the action.
 */
// TODO(calebmer, #tracer): Include the HTTP route in the span name like we do
// with `fetchWithTracer()`.
export async function traceServerResponse(
    tracer: TracerRoot,
    request: Request,
    requestUrl: URL,
    action: (span: TracerSpan, request: Request) => Promise<Response>,
): Promise<Response> {
    const {span, finishSpan} = startSpanFromTracerPropagationContextHeader(
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
                // We depend on Cloudflare to set `x-real-ip` or `cf-connecting-ip` header on
                // our request to get the IP address.
                // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
                clientIp:
                    request.headers.get("x-real-ip") ??
                    request.headers.get("cf-connecting-ip") ??
                    undefined,
                userAgent: request.headers.get("user-agent") ?? undefined,
                request: {
                    contentLength: requestContentLengthHeaderNumber ?? undefined,
                    header: Object.fromEntries(
                        filterIterable(request.headers, ([headerName]) =>
                            tracerEventHttpHeaderNames.has(headerName),
                        ),
                    ),
                    obfuscatedCookieHeader: obfuscateCookieHeader(request.headers),
                },
            },
        });

        // Measure the uncompressed request body size by creating an intermediate
        // readable stream on top of the request body.
        if (request.body) {
            let requestUncompressedContentLength = 0;
            const requestBodyReader = request.body.getReader();

            const newRequestBody = new ReadableStream<Uint8Array>({
                type: "bytes",
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

            request = new Request(request, {
                body: newRequestBody,
                // Node.js appears not to be copying `headers` from the original request after
                // v20.9.0. This is a bug.
                // https://github.com/nodejs/node/issues/50490
                headers: request.headers,
                // @ts-expect-error: Expected by the WhatWG fetch API when `body` is a
                // `ReadableStream` but it's not supported in the types yet.
                // https://github.com/nodejs/node/issues/46221
                duplex: "half",
            });
        }

        let response = await action(span, request);

        span.addData({
            http: {
                statusCode: response.status,
                response: {
                    header: Object.fromEntries(
                        filterIterable(response.headers, ([headerName]) =>
                            tracerEventHttpHeaderNames.has(headerName),
                        ),
                    ),
                    obfuscatedSetCookieHeader: obfuscateSetCookieHeaders(response.headers),
                },
            },
        });

        // Measure the uncompressed response body size by creating an intermediate
        // readable stream on top of the response body.
        //
        // Also, we want to finish the span when the body stops streaming. Not when the
        // `action()` function resolves.
        if (!response.body) {
            finishSpan();
        } else {
            let responseUncompressedContentLength = 0;
            const responseBodyReader = response.body.getReader();

            const actuallyFinishSpan = () => {
                if (span.isFinished()) return;

                span.addData({
                    http: {
                        response: {
                            uncompressedContentLength: responseUncompressedContentLength,
                        },
                    },
                });

                finishSpan();
            };

            const newResponseBody = new ReadableStream<Uint8Array>({
                type: "bytes",
                start: controller => {
                    const read = () => {
                        responseBodyReader.read().then(
                            ({done, value}) => {
                                if (done) {
                                    controller.close();
                                    actuallyFinishSpan();
                                } else {
                                    responseUncompressedContentLength += value.length;
                                    controller.enqueue(value);
                                    read();
                                }
                            },
                            error => controller.error(error),
                        );
                    };

                    read();
                },
                cancel: () => {
                    actuallyFinishSpan();
                },
            });

            response = new Response(newResponseBody, response);
        }

        return response;
    } catch (error) {
        span.addException(error);
        finishSpan();
        throw error;
    }
}

/**
 * Starts a span as a child of the span added in the HTTP propagation header of
 * the request.
 */
function startSpanFromTracerPropagationContextHeader(
    tracer: TracerRoot,
    name: string,
    request: Request,
): {span: TracerSpan; finishSpan: () => void} {
    const propagationContextHeaderValue = request.headers.get(tracerPropagationContextHeaderName);

    // If there is no propagation header, start a new root span.
    if (propagationContextHeaderValue === null) return tracer.startSpan(name);

    // Try to parse the propagation header. If we can't then we log an error and
    // continue with a new root span.
    try {
        const propagationContext: SchemaSerializedValue = JSON.parse(propagationContextHeaderValue);

        if (!isPlainObject(propagationContext))
            throw new InvalidArgumentError("Expected propagation context to be a JSON object");

        if (typeof propagationContext.traceId !== "string" || !isId(propagationContext.traceId))
            throw new InvalidArgumentError(
                "Expected propagation context to contain a `traceId` string",
            );

        if (typeof propagationContext.parentId !== "string" || !isId(propagationContext.parentId))
            throw new InvalidArgumentError(
                "Expected propagation context to contain a `parentId` string",
            );

        if (!isPlainObject(propagationContext.data))
            throw new InvalidArgumentError(
                "Expected propagation context to have a `data` object property",
            );

        validateTracerEventFlatDataForPropagation(propagationContext.data);

        return tracer.startSpanFromPropagationContext(name, {
            traceId: propagationContext.traceId as TraceId,
            parentId: propagationContext.parentId as TraceSpanId,
            data: propagationContext.data,
        });
    } catch (error) {
        tracer.getRoot().logUncaughtException("Invalid trace propagation context", error);
        return tracer.startSpan(name);
    }
}
