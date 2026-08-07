import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export const tracerPropagationContextHeaderName = "cyberworlds-tracer-propagation-context";

/**
 * Adds the tracer HTTP propagation header to a request.
 */
export function addTracerPropagationContextHeader(requestHeaders: Headers, span: TracerSpan) {
    requestHeaders.set(
        tracerPropagationContextHeaderName,
        JSON.stringify(span.getPropagationContext()),
    );
}
