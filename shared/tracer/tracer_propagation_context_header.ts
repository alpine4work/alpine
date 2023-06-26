import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const tracerPropagationContextHeaderName = "cyberworlds-tracer-propagation-context";

/**
 * Adds the tracer HTTP propagation header to a request.
 */
export function addTracerPropagationContextHeader(requestHeaders: Headers, span: TracerSpan) {
    requestHeaders.append(
        tracerPropagationContextHeaderName,
        JSON.stringify(span.getPropagationContext()),
    );
}
