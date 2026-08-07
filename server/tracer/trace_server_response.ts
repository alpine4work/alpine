import {validateTracerEventFlatDataForPropagation} from "~/server/tracer/validate_tracer_event_flat_data.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";
import {
    getHeadersTracerData,
    obfuscateCookieHeader,
    obfuscateSetCookieHeaders,
} from "~/shared/tracer/fetch_with_tracer.open_source.js";
import {tracerEventHttpSearchParamNameByServiceName} from "~/shared/tracer/helpers/tracer_event_http_search_param_name.open_source.js";
import {tracerPropagationContextHeaderName} from "~/shared/tracer/tracer_propagation_context_header.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export function createTraceServerResponseHandleSpanName(
    tracer: TracerRoot,
    request: Request,
    route: string,
) {
    return `${tracer.serviceName} ${request.method} ${route}`;
}

/**
 * Create a span for the server request handler using the WhatWG HTTP API. Used
 * with `createStandardizedServer()`.
 *
 * If there are trace propagation headers, then we setup our span as a child of the
 * propagation context.
 *
 * May re-create the `Request` object so when responding to a request use the
 * `Request` object passed into the action.
 */
export async function traceServerResponse(
    tracer: TracerRoot,
    request: Request,
    requestUrl: URL,
    route: string,
    action: (span: TracerSpan, request: Request) => Promise<Response>,
): Promise<Response> {
    if (process.env.NODE_ENV !== "production") {
        assert(
            new RegExp(
                route.replaceAll(
                    /(^|\/)(\*|:[a-zA-Z0-9_]+)(?=-|\/|$)/g,
                    (substring, match1, match2) => `${match1}${match2 === "*" ? ".*" : "[^/]*"}`,
                ),
            ).test(requestUrl.pathname),
            "`route` must match URL `pathname`",
        );
    }

    const handleSpanName = createTraceServerResponseHandleSpanName(tracer, request, route);

    const {span, finishSpan} = startTracerSpanFromPropagationContextHeader(
        tracer,
        `Handle: ${handleSpanName}`,
        request.headers,
    );

    span.addPropagatedDataForChildrenOnly({
        context: {
            handler: handleSpanName,
        },
    });

    try {
        const spanSearch: {[key: string]: string} = {};
        const validSpanSearchParamNames =
            tracerEventHttpSearchParamNameByServiceName[tracer.serviceName];
        for (const [searchParamName, searchParamValue] of requestUrl.searchParams) {
            if (validSpanSearchParamNames?.has(searchParamName as any)) {
                spanSearch[searchParamName] = searchParamValue;
            }
        }

        span.addData({
            http: {
                route,
                method: request.method,
                scheme: requestUrl.protocol.slice(0, -1),
                target: `${requestUrl.pathname}${requestUrl.search}`,
                search: spanSearch,
                clientIp: getRequestIpAddress(request) ?? undefined,
                userAgent: request.headers.get("user-agent") ?? undefined,
                request: {
                    header: getHeadersTracerData(request.headers),
                    obfuscatedCookieHeader: obfuscateCookieHeader(request.headers),
                },
            },
        });

        const response = await action(span, request);

        span.addData({
            http: {
                statusCode: response.status,
                response: {
                    header: getHeadersTracerData(response.headers),
                    obfuscatedSetCookieHeader: obfuscateSetCookieHeaders(response.headers),
                },
            },
        });

        finishSpan();

        return response;
    } catch (error) {
        span.addException(error);
        finishSpan();
        throw error;
    }
}

/**
 * Starts a span as a child of the span added in the HTTP propagation header of the
 * request.
 */
export function startTracerSpanFromPropagationContextHeader(
    tracer: TracerRoot,
    name: string,
    headers: Headers,
): {span: TracerSpan; finishSpan: () => void} {
    const propagationContextHeaderValue = headers.get(tracerPropagationContextHeaderName);

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
        tracer.getRoot().logException("Invalid trace propagation context", error);
        return tracer.startSpan(name);
    }
}

export function getRequestIpAddress(request: Request): string | null {
    // We depend on Cloudflare to set `x-real-ip` or `cf-connecting-ip` header on our
    // request to get the IP address.
    // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
    return request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip");
}
