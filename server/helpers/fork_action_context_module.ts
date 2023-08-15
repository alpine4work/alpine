import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * The fork context module can be used for forking a completely fresh context
 * from an existing context. Used in the context of server actions to start,
 * effectively, a new action with the same credentials.
 *
 * It's up to the context creator to decide what's shared in a fork. We
 * recommend resetting any caches in your fork.
 *
 * The forked context will typically reuse the credentials of the action it was
 * forked from. You can create a detached forker which lets you keep spawning
 * forked actions with your original action's credentials forever! Be careful
 * with your detached forkers and make sure if you fork a request it's always
 * because the user indicated they wanted some action to occur. Don't surprise
 * users with an action they didn't perform.
 */
export class ForkActionContextModule<
    ForkContextModules extends {tracer: TracerContextModule; [key: string]: ContextModuleBase},
> extends ContextModuleBase<{tracer: TracerContextModule}> {
    private readonly _withFork: <Value>(
        span: TracerSpan,
        action: (context: Context<ForkContextModules>) => Promise<Value>,
    ) => Promise<Value>;

    constructor(
        withFork: <Value>(
            span: TracerSpan,
            action: (context: Context<ForkContextModules>) => Promise<Value>,
        ) => Promise<Value>,
    ) {
        super();
        this._withFork = withFork;
    }

    /**
     * Fork a new action off this context.
     */
    public withFork<Value>(
        spanName: string,
        action: (context: Context<ForkContextModules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        return this._context.tracer.getTracer().withSpan(spanName, span => {
            return this._withFork(span, context => action(context, span));
        });
    }

    /**
     * Get a detached forker which lets you continue making forks even after this
     * context module is destroyed with the credentials of the original action.
     *
     * Be careful with your detached forkers and make sure if you fork a request
     * it's always because the user indicated they wanted some action to occur.
     * Don't surprise users with an action they didn't perform.
     */
    public getDetachedForker() {
        const tracer = this._context.tracer.getTracer();
        const parentSpanLink =
            tracer instanceof TracerSpan ? {traceId: tracer.traceId, spanId: tracer.spanId} : null;

        return new ForkActionContextModuleDetachedForker(
            tracer.getRoot(),
            parentSpanLink,
            this._withFork,
        );
    }
}

/**
 * A detached forker which can keep forking actions even after the original
 * context is destroyed.
 */
export class ForkActionContextModuleDetachedForker<
    ForkContextModules extends {tracer: TracerContextModule; [key: string]: ContextModuleBase},
> {
    private readonly _tracer: TracerRoot;
    private readonly _parentSpanLink: {traceId: TraceId; spanId: TraceSpanId} | null;
    private readonly _withFork: <Value>(
        span: TracerSpan,
        action: (context: Context<ForkContextModules>) => Promise<Value>,
    ) => Promise<Value>;

    constructor(
        tracer: TracerRoot,
        parentSpanLink: {traceId: TraceId; spanId: TraceSpanId} | null,
        withFork: <Value>(
            span: TracerSpan,
            action: (context: Context<ForkContextModules>) => Promise<Value>,
        ) => Promise<Value>,
    ) {
        this._tracer = tracer;
        this._parentSpanLink = parentSpanLink;
        this._withFork = withFork;
    }

    /**
     * Fork a new action off our original action's context.
     */
    public withFork<Value>(
        spanName: string,
        action: (context: Context<ForkContextModules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        return this._tracer.withSpan(spanName, span => {
            // Link to the parent span which may have been created long ago...
            if (this._parentSpanLink) span.link(this._parentSpanLink);

            return this._withFork(span, context => action(context, span));
        });
    }

    /**
     * Fork a new action off our original action's context.
     */
    public async withForkFromCustomSpan<Value>(
        {span, finishSpan}: {span: TracerSpan; finishSpan: () => void},
        action: (context: Context<ForkContextModules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        try {
            // Link to the parent span which may have been created long ago...
            if (this._parentSpanLink) span.link(this._parentSpanLink);

            const value = await this._withFork(span, context => action(context, span));
            finishSpan();
            return value;
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }
}
