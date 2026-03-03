import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * An object you can create new spans from. These spans may be child of other spans
 * or may be root-level spans.
 */
export abstract class TracerBase {
    /**
     * Get the root tracer.
     */
    public abstract getRoot(): TracerRoot;

    /**
     * Start a span that you will manually finish. We recommend using `withSpan()`
     * wherever possible which automatically finishes spans and handles exceptions.
     *
     * See `withSpan()` on guidance for naming spans.
     */
    public abstract startSpan(name: string): {span: TracerSpan; finishSpan: () => void};

    /**
     * Same as `startSpan()` but instead of being a child span in the current trace, we
     * create a new trace that links back to the old one. We recommend using
     * `withSpanAsLinked()` wherever possible which automatically finishes spans and
     * handles exceptions.
     *
     * See `withSpan()` on guidance for naming spans.
     */
    public abstract startSpanAsLinked(name: string): {span: TracerSpan; finishSpan: () => void};

    /**
     * Runs some code with a span around it. Tracks the time the span takes to execute
     * and exceptions that happen while executing. You can add more data to the span
     * (including child spans) through the provided `span` argument.
     *
     * The name should be a short, low cardinality, string. You should be able to
     * easily search the codebase for the code defining a span based on its name after
     * seeing a span in our observability tool.
     *
     * The name should not contain IDs or other dynamic content.
     *
     * We recommend formatting span names as short phrases without punctuation (but can
     * include spaces between words). For example: "Get admin account" is a good span
     * name.
     */
    public async withSpan<Value>(
        name: string,
        action: (span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        const {span, finishSpan} = this.startSpan(name);
        try {
            const value = await action(span);
            finishSpan();
            return value;
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Runs some synchronous code with a span around it. See `withSpan()` (the async
     * version) for more information.
     */
    public withSpanSync<Value>(name: string, action: (span: TracerSpan) => Value): Value {
        const {span, finishSpan} = this.startSpan(name);
        try {
            const value = action(span);
            finishSpan();
            return value;
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Same as `withSpan()` but we call `startSpanAsLinked()` instead of `startSpan()`.
     * See the documentation of those methods for more information.
     */
    public async withSpanAsLinked<Value>(
        name: string,
        action: (span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        const {span, finishSpan} = this.startSpanAsLinked(name);
        try {
            const value = await action(span);
            finishSpan();
            return value;
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Returns a tracer where all spans created by the tracer will include the data
     * passed into this function. The propagated data will also be sent over network
     * boundaries.
     *
     * If this tracer is, itself, a span then we will add this data to the span itself
     * and all future child spans (not just child spans created by the returned
     * object). When we add propagated data through mutation (instead of creating a new
     * immutable object) then the returned object will be referentially equal to
     * `this`.
     *
     * Regardless of the implementation, this function guarantees that spans created by
     * the returned tracer will have the propagated data.
     */
    public abstract withPropagatedData(data: TracerEventData): TracerBase;

    /**
     * Add a structured log to a span.
     *
     * The log name should follow the same convention as our span names. Written below:
     *
     * The name should be a short, low cardinality, string. You should be able to
     * easily search the codebase for the code defining a span based on its name after
     * seeing a span in our observability tool.
     *
     * The name should not contain IDs or other dynamic content.
     *
     * We recommend formatting span names as short phrases without punctuation (but can
     * include spaces between words). For example: "Get admin account" is a good span
     * name.
     */
    public abstract log(name: string, data?: TracerEventData): void;

    /**
     * Add a structured exception log event to this span.
     *
     * Uses `this.log()` but with exception event attributes.
     *
     * See `TracerBase.log` for how to name this event.
     */
    public abstract logException(name: string, error: unknown, data?: TracerEventData): void;
}
