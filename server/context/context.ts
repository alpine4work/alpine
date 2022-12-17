import {ProcessContextModule} from "~/server/context/process_context_module";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";

const brandSymbol = Symbol("brand");

/**
 * The context abstraction is designed for passing shared environment
 * capabilities deep throughout server side code.
 *
 * For example, logging is defined in the entrypoint for a given piece of code
 * and propagated deeply to all code through the context abstraction.
 *
 * Code can use the `Modules` type parameter to declare what it depends on from
 * the environment. A context object may contain many modules, but
 * implementation code may only need a few. A small set of context modules is
 * easier to test.
 *
 * The type of modules may also change which can be used to define different
 * requirements for a piece of code. For example, an authentication context
 * module may start with a "maybe authenticated" type then once authentication
 * is challenged we create a new context with an "authenticated" context
 * module.
 *
 * Finally, a context may be scoped to execution of a particular piece of code.
 * Once the execution of that code is over, the context may be destroyed so
 * that it's resources are not misused later.
 */
export type Context<Modules> = {
    readonly [Key in keyof Modules]: () => Modules[Key];
} & {
    /**
     * You can't create a context object outside of this module. So we
     * use a private non-enumerable symbol property for branding the context
     * object.
     *
     * Only the context module has access to the symbol and the symbol is not
     * copied when cloning the object (because it's non-enumerable).
     */
    readonly [brandSymbol]: true;

    /**
     * Clones a context with some new module initializers. The new module
     * initializers either add to the set of modules in the context or replace an
     * existing module of the same name.
     *
     * If the context we clone from is destroyed then the cloned context will
     * also be destroyed. Cloned contexts can not outlive their parent context.
     *
     * You need to pass a type parameter into this function to get the correct
     * return type. Like this: `context.clone<{ ... }>({ ... })`.
     */
    clone<NewModules>(
        moduleInitializers: ContextModuleInitializers<
            NewModules,
            Omit<Modules, keyof NewModules> & NewModules
        >,
    ): ContextWithDestroy<Omit<Modules, keyof NewModules> & NewModules>;

    /**
     * Clone the current context and make sure the clone is scoped to the provided
     * async action. When the async action completes, the context is destroyed.
     *
     * Behaves the same as `context.clone()`.
     *
     * The context we are cloning must have a `ProcessContextModule`. Any
     * `context.process().waitUntil()` calls will extend the lifetime of the
     * context.
     */
    withClone<NewModules, Result>(
        // Require the context we are cloning to have a `ProcessContextModule`. So we
        // can extend the context lifetime with its task promises.
        this: Context<Modules & {process: ProcessContextModule}>,
        moduleInitializers: ContextModuleInitializers<
            NewModules,
            Omit<Modules, keyof NewModules> & NewModules
        >,
        action: (context: Context<Omit<Modules, keyof NewModules> & NewModules>) => Promise<Result>,
    ): Promise<Result>;
};

/**
 * A context that can be destroyed.
 *
 * We don't expect product code to destroy contexts. Instead framework level
 * code that constructs a context object should also be responsible for
 * destroying the context when it is done.
 */
export type ContextWithDestroy<Modules> = Context<Modules> & {
    /**
     * Destroys the context. Whenever you try to access a module an error will be
     * thrown. Contexts can not be used after they are destroyed. This is how we
     * make sure contexts don't "escape" async actions which create them.
     */
    destroy(): void;
};

/**
 * Functions that construct modules which we pass into context creation methods
 * like `Context.new()` and `context.clone()`. These initializers are lazily
 * invoked when the context module is requested.
 *
 * Context modules recursively have access to the context object being created
 * so they can reference other context modules.
 */
export type ContextModuleInitializers<Modules, ModulesForInitializer = Modules> = {
    [Key in keyof Modules]: (context: Context<ModulesForInitializer>) => Modules[Key];
};

export const Context = {
    /**
     * Create a new context object with the provided modules.
     *
     * You need to pass a type parameter into this function to get the correct
     * return type. Like this: `Context.new<{ ... }>({ ... })`.
     */
    new<Modules>(
        moduleInitializers: ContextModuleInitializers<Modules>,
    ): ContextWithDestroy<Modules> {
        const context: any = ContextImplementation.new(moduleInitializers as any);
        return context;
    },

    /**
     * Create a context scoped to the provided async action. When the async action
     * completes, the context is destroyed.
     *
     * The context must come with a `ProcessContextModule`. Any
     * `context.process().waitUntil()` calls will extend the lifetime of the
     * context.
     */
    async with<Modules extends {process: ProcessContextModule}, Result>(
        moduleInitializers: ContextModuleInitializers<Modules>,
        action: (context: Context<Modules>) => Promise<Result>,
    ): Promise<Result> {
        let taskPromises: Array<Promise<void>> = [];

        const context = Context.new<Modules>({
            ...moduleInitializers,
            process: context => {
                const processContextModule = moduleInitializers.process(context);
                return new ProcessContextModule({
                    waitUntil: promise => {
                        processContextModule.waitUntil(promise);

                        // We keep track of tasks our request is waiting on since we don't want to
                        // destroy the request context until all tasks have completed. Since the task
                        // may reference the request context.
                        taskPromises.push(promise);
                    },
                });
            },
        });

        try {
            const result = await action(context);
            return result;
        } finally {
            // Wait for all our tasks to resolve before we can destroy our request context.
            // The tasks may end up using the request context.
            //
            // We need to loop since while waiting for our tasks to finish, we may queue
            // more tasks.
            const loop = () => {
                const currentTaskPromises = taskPromises;
                taskPromises = [];

                if (currentTaskPromises.length === 0) {
                    context.destroy();
                } else {
                    Promise.allSettled(currentTaskPromises).finally(loop);
                }
            };

            loop();
        }
    },
};

/**
 * The class which implements our `Context` abstraction. This class is loosely
 * typed. It does not know the types of modules unlike our `Context<Modules>`
 * type. It's hard to write the actual implementation with the correct types so
 * we cast to `any` at the typed layer.
 */
// In stack traces, we want this class to be called `Context`. But that
// conflicts with our existing `Context` type and object. So we alias the class
// to `ContextImplementation` to avoid a name collision at the module level.
const ContextImplementation = class Context {
    public static new(moduleInitializers: {[key: string]: (context: Context) => unknown}): Context {
        const moduleKeys = Object.keys(moduleInitializers);
        const newContext: any = new Context(null, moduleKeys);

        for (const key of moduleKeys) {
            assert(!(key in newContext));

            const moduleInitializer = moduleInitializers[key]!;
            let module: unknown;

            // Using `function` instead of an arrow function is important here! If
            // this function is copied onto a context clone then we want to use the
            // `_isDestroyed` flag from that clone.
            //
            // Using `newContext` when initializing instead of `this` is also important.
            // When the module was initialized, we want to initialize it with the set of
            // modules in the context the initializer was defined.
            newContext[key] = function (this: Context) {
                if (this._isDestroyed) throw new InternalError("Context was destroyed");

                if (module === undefined) {
                    module = moduleInitializer(newContext);
                    assert(module !== undefined);
                }

                return module;
            };
        }

        return newContext;
    }

    private readonly [brandSymbol] = true;
    private _isDestroyed = false;
    private readonly _childContexts = new Set<Context>();

    private constructor(
        private readonly _parentContext: Context | null,
        private readonly _moduleKeys: ReadonlyArray<string>,
    ) {}

    public destroy() {
        if (this._isDestroyed) throw new InternalError("Context was already destroyed");
        this._isDestroyed = true;

        // Destroy all our child contexts. Remove ourselves from our parent context so
        // the parent context won't destroy us when it's destroyed.
        this._parentContext?._childContexts.delete(this);
        for (const childContext of this._childContexts) childContext.destroy();
    }

    public clone(moduleInitializers: {[key: string]: (context: Context) => unknown}): Context {
        const moduleKeys = Object.keys(moduleInitializers);
        const oldContext: any = this;
        const newContext: any = new Context(oldContext, moduleKeys);

        for (const key of moduleKeys) {
            assert(!(key in newContext));

            const moduleInitializer = moduleInitializers[key]!;
            let module: unknown;

            // Using `function` instead of an arrow function is important here! If
            // this function is copied onto a context clone then we want to use the
            // `_isDestroyed` flag from that clone.
            //
            // Using `newContext` when initializing instead of `this` is also important.
            // When the module was initialized, we want to initialize it with the set of
            // modules in the context the initializer was defined.
            newContext[key] = function (this: Context) {
                if (this._isDestroyed) throw new InternalError("Context was destroyed");

                if (module === undefined) {
                    module = moduleInitializer(newContext);
                    assert(module !== undefined);
                }

                return module;
            };
        }

        // Copy over modules that were not updated in the clone.
        for (const key of this._moduleKeys) {
            if (hasOwnProperty(moduleInitializers, key)) continue;

            moduleKeys.push(key);
            newContext[key] = oldContext[key];
        }

        this._childContexts.add(newContext);
        return newContext;
    }

    public async withClone<Result>(
        moduleInitializers: {[key: string]: (context: Context) => unknown},
        action: (context: Context) => Promise<Result>,
    ): Promise<Result> {
        let taskPromises: Array<Promise<void>> = [];

        const newContext = this.clone({
            ...moduleInitializers,
            process: context => {
                const processContextModule: ProcessContextModule = (context as any).process();
                return new ProcessContextModule({
                    waitUntil: promise => {
                        processContextModule.waitUntil(promise);

                        // We keep track of tasks our request is waiting on since we don't want to
                        // destroy the request context until all tasks have completed. Since the task
                        // may reference the request context.
                        taskPromises.push(promise);
                    },
                });
            },
        });

        try {
            const result = await action(newContext);
            return result;
        } finally {
            // Wait for all our tasks to resolve before we can destroy our request context.
            // The tasks may end up using the request context.
            //
            // We need to loop since while waiting for our tasks to finish, we may queue
            // more tasks.
            const loop = () => {
                const currentTaskPromises = taskPromises;
                taskPromises = [];

                if (currentTaskPromises.length === 0) {
                    newContext.destroy();
                } else {
                    Promise.allSettled(currentTaskPromises).finally(loop);
                }
            };

            loop();
        }
    }
};
