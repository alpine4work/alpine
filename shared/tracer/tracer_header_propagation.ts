import {validateTracerEventFlatDataForPropagation} from "~/server/tracer/validate_tracer_event_flat_data";
import {InvalidArgumentError} from "~/shared/error/error";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import {isId} from "~/shared/id/id";
import {SchemaSerializedValue} from "~/shared/schema/schema";
import {TracerRoot} from "~/shared/tracer/tracer_root";
import {TracerSpan} from "~/shared/tracer/tracer_span";

const propagationContextHeaderName = "cyberworlds-tracer-context";

/**
 * Adds the tracer HTTP propagation header to a request.
 */
export function addTracerPropagationContextHeader(requestHeaders: Headers, span: TracerSpan) {
    requestHeaders.append(
        propagationContextHeaderName,
        JSON.stringify(span.getPropagationContext()),
    );
}

/**
 * Starts a span as a child of the span added in the HTTP propagation header of
 * the request.
 */
export function startSpanFromPropagationContextHeader(
    tracer: TracerRoot,
    name: string,
    request: Request,
): {span: TracerSpan; finishSpan: () => void} {
    const propagationContextHeaderValue = request.headers.get(propagationContextHeaderName);

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
            traceId: propagationContext.traceId,
            parentId: propagationContext.parentId,
            data: propagationContext.data,
        });
    } catch (error) {
        tracer.getRoot().logUncaughtException("Invalid trace propagation context", error);
        return tracer.startSpan(name);
    }
}
