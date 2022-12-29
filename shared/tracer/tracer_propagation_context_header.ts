import {TracerSpan} from "~/shared/tracer/tracer_span";

export const tracerPropagationContextHeaderName = "cyberworlds-tracer-context";

/**
 * Adds the tracer HTTP propagation header to a request.
 */
export function addTracerPropagationContextHeader(requestHeaders: Headers, span: TracerSpan) {
    requestHeaders.append(
        tracerPropagationContextHeaderName,
        JSON.stringify(span.getPropagationContext()),
    );
}
