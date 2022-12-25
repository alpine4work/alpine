import {Context} from "~/shared/context/context";
import {UnimplementedError} from "~/shared/error/error";
import {Replace} from "~/shared/helpers/types/replace";
import {TracerBase, TracerSpan} from "~/shared/tracer/tracer";

/**
 * A wrapper around either a `Tracer` or `TracerSpan` for instrumenting code
 * using our context abstraction.
 *
 * `withSpan()` will create a new context object
 */
export class TracerContextModule<Modules> {
    constructor(private readonly context: Context<Modules>, private readonly tracer: TracerBase) {}

    /**
     * Start a span that you will manually finish. We recommend using `withSpan()`
     * wherever possible which automatically finishes spans and handles exceptions.
     *
     * See `withSpan()` on guidance for naming spans.
     */
    public startSpan(name: string) {
        return this.tracer.startSpan(name);
    }

    /**
     * Runs some code with a span around it. Tracks the time the span takes to
     * execute and exceptions that happen while executing. You can add more data to
     * the span (including child spans) through the provided `span` argument.
     *
     * The name should be a short, low cardinality, string. You should be able to
     * easily search the codebase for the code defining a span based on its name
     * after seeing a span in our observability tool.
     *
     * The name should not contain IDs or other dynamic content.
     *
     * We recommend formatting span names as short phrases without punctuation (but
     * can include spaces between words). For example: "Get admin account" is a
     * good span name.
     */
    public withSpan<Value>(
        name: string,
        action: (
            context: Context<
                Replace<Modules, {tracer: TracerContextModule<Omit<Modules, "tracer">>}>
            >,
            span: TracerSpan,
        ) => Promise<Value>,
    ): Promise<Value> {
        throw new UnimplementedError("TODO: This implementation has a critical bug");

        return this.tracer.withSpan(name, span => {
            // TODO(calebmer): If we are in a clone this won't work quite right! We will be
            // using the parent `this` not the child `this`. So like an authenticated
            // context module could become unauthenticated!
            return this.context.withClone<
                {tracer: TracerContextModule<Omit<Modules, "tracer">>},
                Value
            >({tracer: context => new TracerContextModule(context, span)}, context =>
                action(context, span),
            );
        });
    }
}
