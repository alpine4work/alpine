import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.open_source.js";

/**
 * A wrapper around either a `Tracer` or `TracerSpan` for instrumenting code using
 * our context abstraction.
 *
 * `withSpan()` will create a new context object
 */
export class TracerContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    private readonly _tracer: TracerBase;

    constructor(tracer: TracerBase) {
        super();
        this._tracer = tracer;
    }

    /**
     * Return the underlying tracer.
     */
    public getTracer(): TracerBase {
        return this._tracer;
    }

    /**
     * Get the root tracer.
     */
    public getRoot(): TracerRoot {
        return this._tracer.getRoot();
    }

    /**
     * Start a span that you will manually finish. We recommend using `withSpan()`
     * wherever possible which automatically finishes spans and handles exceptions.
     *
     * See `withSpan()` on guidance for naming spans.
     */
    public startSpan(name: string) {
        return this._tracer.startSpan(name);
    }

    /**
     * Runs some code with a span around it. Tracks the time the span takes to execute
     * and exceptions that happen while executing. You can add more data to the span
     * (including child spans) through the provided `span` argument.
     *
     * The name should be a short, low cardinality, string. You should be able to
     * easily search the codebase for the code defining a span based on its name after
     * seeing a span in our observability tool.
     *
     * The name should be written in present simple tense. So "Update document content"
     * instead of "Updating document content" (present continuous tense) or "Updated
     * document content" (past tense).
     *
     * The name should not contain IDs or other dynamic content.
     *
     * We recommend formatting span names as short phrases without punctuation (but can
     * include spaces between words). For example: "Get admin account" is a good span
     * name.
     */
    public withSpan<Modules extends {}, Value>(
        this: ContextModuleBase<Modules> & TracerContextModule,
        name: string,
        action: (
            context: Context<Replace<Modules, {tracer: TracerContextModule}>>,
            span: TracerSpan,
        ) => Promise<Value>,
    ): Promise<Value> {
        return this._tracer.withSpan(name, span => {
            return this._context.with({tracer: new TracerContextModule(span)}, context =>
                action(context, span),
            );
        });
    }

    /**
     * Synchronous version of `withSpan()`.
     */
    public withSpanSync<Modules extends {}, Value>(
        this: ContextModuleBase<Modules> & TracerContextModule,
        name: string,
        action: (
            context: Context<Replace<Modules, {tracer: TracerContextModule}>>,
            span: TracerSpan,
        ) => Value,
    ): Value {
        return this._tracer.withSpanSync(name, span => {
            return this._context.withSync({tracer: new TracerContextModule(span)}, context =>
                action(context, span),
            );
        });
    }

    /**
     * Same as `withSpan()` but we call `startSpanAsLinked()` instead of `startSpan()`.
     * See the documentation of those methods for more information.
     */
    public withSpanAsLinked<Modules extends {}, Value>(
        this: ContextModuleBase<Modules> & TracerContextModule,
        name: string,
        action: (
            context: Context<Replace<Modules, {tracer: TracerContextModule}>>,
            span: TracerSpan,
        ) => Promise<Value>,
    ): Promise<Value> {
        return this._tracer.withSpanAsLinked(name, span => {
            return this._context.with({tracer: new TracerContextModule(span)}, context =>
                action(context, span),
            );
        });
    }

    /**
     * Returns a context where all spans created by the tracer will include the data
     * passed into this function. The propagated data will also be sent over network
     * boundaries.
     */
    public withPropagatedData<Modules extends {tracer: TracerContextModule}>(
        this: ContextModuleBase<Modules> & TracerContextModule,
        data: TracerEventData,
    ): Context<Replace<Modules, {tracer: TracerContextModule}>> {
        const newTracer = this._tracer.withPropagatedData(data);
        if (newTracer === this._tracer) return this._context;
        return this._context.clone({tracer: new TracerContextModule(newTracer)});
    }

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
    public log(name: string, data?: TracerEventData) {
        this._tracer.log(name, data);
    }

    /**
     * Add a structured exception log event to this span.
     *
     * Uses `this.log()` but with exception event attributes.
     *
     * See `TracerBase.log` for how to name this event.
     */
    public logException(name: string, error: unknown, data?: TracerEventData) {
        this._tracer.logException(name, error, data);
    }

    public fork() {
        return new TracerContextModule(this._tracer);
    }
}
