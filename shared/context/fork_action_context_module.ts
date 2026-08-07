import {Context, ContextModulesDependencies} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * A context module that can be forked. Forking should create a completely new
 * module instance with new state but with the same underlying configuration. For
 * example, caches like `CacheContextModule` and batchers like `BatchContextModule`
 * don't share caches/batches with forked modules. However
 * `SessionActorContextModule` does maintain its `accountId` and `sessionId` in the
 * fork.
 */
export interface ForkableContextModuleBase extends ContextModuleBase {
    fork(): ForkableContextModuleBase;
}

/**
 * The fork context module can be used for forking a completely fresh context from
 * an existing context. Used in the context of server actions to start,
 * effectively, a new action with the same credentials.
 *
 * It's up to the context creator to decide what's shared in a fork. We recommend
 * resetting any caches in your fork.
 *
 * The forked context will typically reuse the credentials of the action it was
 * forked from. You can create a detached forker which lets you keep spawning
 * forked actions with your original action's credentials forever! Be careful with
 * your detached forkers and make sure if you fork a request it's always because
 * the user indicated they wanted some action to occur. Don't surprise users with
 * an action they didn't perform.
 *
 * The "action" part of the name is because this module is intended to be used with
 * action contexts. Action contexts:
 *
 * - Have a `TracerSpan` covering the action. The fork context module is
 *   responsible for starting new, related spans
 *
 * - Is constructed with `Context.with()` which means the context will be destroyed
 *   at the end of its lifetime. The fork context module extends the lifetime of an
 *   action
 */
export class ForkActionContextModule
    extends ContextModuleBase<{tracer: TracerContextModule}>
    implements ForkableContextModuleBase
{
    /**
     * Fork a new action off this context.
     */
    public withFork<Modules extends {[key: string]: ForkableContextModuleBase}, Value>(
        this: ContextModuleBase<Modules> & ForkActionContextModule,
        spanName: string,
        action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        return this._context.tracer.getTracer().withSpan(spanName, span => {
            const forkedModules: {[key: string]: ContextModuleBase} = {
                tracer: new TracerContextModule(span),
            };

            for (const [key, module] of Object.entries(this._context)) {
                // We manually add a new `TracerContextModule` with the new span.
                if (key === "tracer") continue;

                // Extra property added to the context that's not a module...
                if (!(module instanceof ContextModuleBase)) continue;

                const forkableModule = module as ForkableContextModuleBase;
                const forkedModule = forkableModule.fork();

                // When we bind a module to a context we call `Object.create(module)` and assign
                // the bound context to that object. So an unbound module has one less prototype
                // layer.
                assert(
                    Object.getPrototypeOf(forkedModule) ===
                        Object.getPrototypeOf(Object.getPrototypeOf(forkableModule)),
                    "Forked module should not be bound to context",
                );

                forkedModules[key] = forkedModule;
            }

            return Context.with<Modules, Value>(
                forkedModules as Modules & ContextModulesDependencies<Modules>,
                context => action(context, span),
            );
        });
    }

    /**
     * Get a detached forker which lets you continue making forks even after this
     * context module is destroyed with the credentials of the original action.
     *
     * Be careful with your detached forkers and make sure if you fork a request it's
     * always because the user indicated they wanted some action to occur. Don't
     * surprise users with an action they didn't perform.
     */
    public getDetachedForker<Modules extends {[key: string]: ForkableContextModuleBase}>(
        this: ContextModuleBase<Modules> & ForkActionContextModule,
    ) {
        const baseForkedModules: {[key: string]: ForkableContextModuleBase} = {};

        for (const [key, module] of Object.entries(this._context)) {
            // We will manually add a new `TracerContextModule` so ignore the existing
            // `TracerContextModule`.
            if (key === "tracer") continue;

            // Extra property added to the context that's not a module...
            if (!(module instanceof ContextModuleBase)) continue;

            const forkableModule = module as ForkableContextModuleBase;
            const forkedModule = forkableModule.fork();

            // When we bind a module to a context we call `Object.create(module)` and assign
            // the bound context to that object. So an unbound module has one less prototype
            // layer.
            assert(
                Object.getPrototypeOf(forkedModule) ===
                    Object.getPrototypeOf(Object.getPrototypeOf(forkableModule)),
                "Forked module should not be bound to context",
            );

            baseForkedModules[key] = forkedModule;
        }

        const tracer = this._context.tracer.getTracer();

        return new ForkActionContextModuleDetachedForker<Modules>(
            tracer.getRoot(),
            tracer instanceof TracerSpan ? tracer.getPropagationContext() : null,
            baseForkedModules,
        );
    }

    public fork() {
        return new ForkActionContextModule();
    }
}

/**
 * A detached forker which can keep forking actions even after the original context
 * is destroyed.
 */
export class ForkActionContextModuleDetachedForker<
    Modules extends {[key: string]: ForkableContextModuleBase},
> {
    private readonly _tracer: TracerRoot;
    private readonly _propagationContext: TracerSpanPropagationContext | null;
    private readonly _baseForkedModules: {[key: string]: ForkableContextModuleBase};

    constructor(
        tracer: TracerRoot,
        propagationContext: TracerSpanPropagationContext | null,
        baseForkedModules: {[key: string]: ForkableContextModuleBase},
    ) {
        this._tracer = tracer;
        this._propagationContext = propagationContext;
        this._baseForkedModules = baseForkedModules;
    }

    /**
     * Fork a new action off our original action's context.
     */
    public async withFork<Value>(
        spanName: string,
        action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value>;
    public async withFork<Value>(
        spanName: string,
        modules: Partial<Modules>,
        action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value>;
    public async withFork<Value>(
        spanName: string,
        modulesOrAction:
            | Partial<Modules>
            | ((context: Context<Modules>, span: TracerSpan) => Promise<Value>),
        optionalAction?: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        const span = this._propagationContext
            ? this._tracer.startSpanFromPropagationContextAsLinked(
                  spanName,
                  this._propagationContext,
              )
            : this._tracer.startSpan(spanName);

        let modules: Partial<Modules> | undefined;
        let action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>;

        if (optionalAction === undefined) {
            assert(typeof modulesOrAction === "function");
            action = modulesOrAction;
        } else {
            assert(typeof modulesOrAction !== "function");
            modules = modulesOrAction;
            action = optionalAction;
        }

        return await this._withForkFromCustomSpan(span, modules, action);
    }

    /**
     * Fork a new action off our original action's context.
     */
    public withForkFromCustomSpan<Value>(
        span: {span: TracerSpan; finishSpan: () => void},
        action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value>;
    public withForkFromCustomSpan<Value>(
        span: {span: TracerSpan; finishSpan: () => void},
        modules: Partial<Modules>,
        action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value>;
    public withForkFromCustomSpan<Value>(
        span: {span: TracerSpan; finishSpan: () => void},
        modulesOrAction:
            | Partial<Modules>
            | ((context: Context<Modules>, span: TracerSpan) => Promise<Value>),
        optionalAction?: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        let modules: Partial<Modules> | undefined;
        let action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>;

        if (optionalAction === undefined) {
            assert(typeof modulesOrAction === "function");
            action = modulesOrAction;
        } else {
            assert(typeof modulesOrAction !== "function");
            modules = modulesOrAction;
            action = optionalAction;
        }

        return this._withForkFromCustomSpan(span, modules, action);
    }

    private async _withForkFromCustomSpan<Value>(
        {span, finishSpan}: {span: TracerSpan; finishSpan: () => void},
        modules: Partial<Modules> | undefined,
        action: (context: Context<Modules>, span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        try {
            // Link to the parent span which may have been created long ago...
            if (this._propagationContext) {
                // Merge in our propagation context's data. If the `span` already the same data as
                // what we pass in then the data in `span` will win.
                span._addDefaultPropagatedFlatData(this._propagationContext.data);

                span.link(`Parent of: ${span.getName()}`, {
                    traceId: this._propagationContext.traceId,
                    spanId: this._propagationContext.parentId,
                });
            }

            const forkedModules: {[key: string]: ContextModuleBase} = {
                tracer: new TracerContextModule(span),
            };

            if (modules !== undefined) {
                for (const [key, module] of Object.entries(modules)) {
                    // We manually add a new `TracerContextModule` with the new span.
                    if (key === "tracer") continue;

                    // If we're replacing a forked module then double check the new module has the same
                    // type as the forked module. This helps make sure our TypeScript types are
                    // correct.
                    assert(
                        this._baseForkedModules[key] &&
                            module instanceof this._baseForkedModules[key].constructor,
                        "If replacing a forked context module, the new context module should be a subclass of the forked context module",
                    );

                    // @ts-expect-error
                    forkedModules[key] = module;
                }
            }

            for (const [key, module] of Object.entries(this._baseForkedModules)) {
                // We manually add a new `TracerContextModule` with the new span.
                if (key === "tracer") continue;

                if (modules !== undefined && hasOwnProperty(modules, key)) continue;

                forkedModules[key] = module.fork();
            }

            const value = await Context.with<Modules, Value>(
                forkedModules as Modules & ContextModulesDependencies<Modules>,
                context => action(context, span),
            );

            finishSpan();
            return value;
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }
}
