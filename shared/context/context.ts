import {ContextModuleBase, ContextModuleModulesType} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";

// Never actually used at runtime. Only used by the type system.
declare const modulesTypeSymbol: unique symbol;

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
export type Context<Modules extends {[key: string]: ContextModuleBase | undefined}> = {
    // This symbol doesn't exist at runtime. It only exists in the type system.
    // It's also private to this module. By including this property, it makes
    // TypeScript error messages more readable since when TypeScript checks module
    // type compatibility it starts with this property.
    readonly [modulesTypeSymbol]: Modules;
} & {
    // We intersect the module type with a `ContextModuleBase` type that has the
    // full modules object. That way we can write clone functions in context
    // modules of the form `clone<Modules>(this: ContextModuleBase<Modules>)` that
    // know about all modules in a context.
    [Key in keyof Modules]: Modules[Key] & ContextModuleBase<Modules>;
} & {
    /**
     * Clones a context with some new module initializers. The new module
     * initializers either add to the set of modules in the context or replace an
     * existing module of the same name.
     *
     * If the context we clone from is destroyed then the cloned context will
     * also be destroyed. Cloned contexts can not outlive their parent context.
     *
     * You may only add new modules and replace existing modules when cloning. If
     * you are replacing an existing module, the new module must be a subclass of
     * the old module. This requirement means you can only add behavior to the
     * context, not take behavior away. So old context modules can be used even
     * with a new context object because the new context object is guaranteed to be
     * API compatible with the context object where the old module was added.
     *
     * You may need to pass a type parameter into this function to get the correct
     * return type. Like this: `context.clone<{ ... }>({ ... })`.
     */
    clone<NewModules extends {[key: string]: ContextModuleBase}>(
        newModules: NewModules,
    ): ContextWithDestroy<Replace<Modules, NewModules>>;

    /**
     * Clone the current context and make sure the clone is scoped to the provided
     * async action. When the async action completes, the context is destroyed.
     *
     * Behaves the same as `context.clone()`. See the documentation on that method
     * for relevant implementation details.
     *
     * The context we are cloning must have a `ProcessContextModule`. Any
     * `context.process.waitUntil()` calls will extend the lifetime of the
     * context.
     */
    with<NewModules extends {[key: string]: ContextModuleBase}, Value>(
        newModules: NewModules,
        action: (context: Context<Replace<Modules, NewModules>>) => Promise<Value>,
    ): Promise<Value>;

    /**
     * Synchronous version of `with()`.
     */
    withSync<NewModules extends {[key: string]: ContextModuleBase}, Value>(
        newModules: NewModules,
        action: (context: Context<Replace<Modules, NewModules>>) => Value,
    ): Value;
};

/**
 * A context that can be destroyed.
 *
 * We don't expect product code to destroy contexts. Instead framework level
 * code that constructs a context object should also be responsible for
 * destroying the context when it is done.
 */
export type ContextWithDestroy<Modules extends {[key: string]: ContextModuleBase}> =
    Context<Modules> & {
        /**
         * Destroys the context. Whenever you try to access a module an error will be
         * thrown. Contexts can not be used after they are destroyed. This is how we
         * make sure contexts don't "escape" async actions which create them.
         */
        destroy(): void;
    };

/**
 * For a `Modules` object type, construct a new object type with the
 * dependencies from each module. We can use this type to make sure we've
 * satisfied all our module requirements.
 */
export type ContextModulesDependencies<Modules extends {[key: string]: ContextModuleBase}> =
    UnionToIntersection<
        {[Key in keyof Modules]: ContextModuleModulesType<Modules[Key]>}[keyof Modules]
    >;

// We need to write the type of `Context` as a TypeScript type so that
// TypeScript doesn't get confused by the `new` property when building type
// declarations.
type ContextStatic = {
    /**
     * Create a new context object with the provided modules.
     *
     * You may need to pass a type parameter into this function to get the correct
     * return type. Like this: `Context.new<{ ... }>({ ... })`.
     */
    // TypeScript treats `new` as a keyword and not a property when it doesn't
    // have quotes.
    "new"<Modules extends {[key: string]: ContextModuleBase}>(
        modules: Modules & ContextModulesDependencies<Modules>,
    ): ContextWithDestroy<Modules>;

    /**
     * Create a context scoped to the provided async action. When the async action
     * completes, the context is destroyed.
     *
     * If the context comes with a `ProcessContextModule` under the `process` key,
     * any `context.process.waitUntil()` calls will extend the lifetime of the
     * context.
     */
    with<Modules extends {[key: string]: ContextModuleBase}, Value>(
        modules: Modules & ContextModulesDependencies<Modules>,
        action: (context: Context<Modules>) => Promise<Value>,
    ): Promise<Value>;

    /**
     * The synchronous version of `with()`.
     */
    withSync<Modules extends {[key: string]: ContextModuleBase}, Value>(
        modules: Modules & ContextModulesDependencies<Modules>,
        action: (context: Context<Modules>) => Promise<Value>,
    ): Promise<Value>;
};

export const Context: ContextStatic = {
    new<Modules extends {[key: string]: ContextModuleBase}>(
        modules: Modules & ContextModulesDependencies<Modules>,
    ): ContextWithDestroy<Modules> {
        return new ContextImplementation(null, modules) as any;
    },

    async with<Modules extends {[key: string]: ContextModuleBase}, Value>(
        modules: Modules & ContextModulesDependencies<Modules>,
        action: (context: Context<Modules>) => Promise<Value>,
    ): Promise<Value> {
        // If we have a `ProcessContextModule` then extend the lifetime of the context
        // with any `context.process.waitUntil()` calls.
        if (!modules.process) {
            const context = Context.new(modules);
            try {
                const value = await action(context);
                return value;
            } finally {
                context.destroy();
            }
        } else {
            const processContextModule = modules.process;
            assert(processContextModule instanceof ProcessContextModule);

            let taskPromises: Array<Promise<unknown>> = [];

            const context = Context.new<Modules>({
                ...modules,
                process: new ProcessContextModule({
                    waitUntil: promise => {
                        processContextModule.waitUntil(promise);

                        // We keep track of tasks our request is waiting on since we don't want to
                        // destroy the request context until all tasks have completed. Since the task
                        // may reference the request context.
                        taskPromises.push(promise);
                    },
                }),
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
                        void Promise.allSettled(currentTaskPromises).finally(loop);
                    }
                };

                loop();
            }
        }
    },

    withSync<Modules extends {[key: string]: ContextModuleBase}, Value>(
        modules: Modules & ContextModulesDependencies<Modules>,
        action: (context: Context<Modules>) => Value,
    ): Value {
        // If we have a `ProcessContextModule` then extend the lifetime of the context
        // with any `context.process.waitUntil()` calls.
        if (!modules.process) {
            const context = Context.new(modules);
            try {
                const value = action(context);
                return value;
            } finally {
                context.destroy();
            }
        } else {
            const processContextModule = modules.process;
            assert(processContextModule instanceof ProcessContextModule);

            let taskPromises: Array<Promise<unknown>> = [];

            const context = Context.new<Modules>({
                ...modules,
                process: new ProcessContextModule({
                    waitUntil: promise => {
                        processContextModule.waitUntil(promise);

                        // We keep track of tasks our request is waiting on since we don't want to
                        // destroy the request context until all tasks have completed. Since the task
                        // may reference the request context.
                        taskPromises.push(promise);
                    },
                }),
            });

            try {
                const result = action(context);
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
                        void Promise.allSettled(currentTaskPromises).finally(loop);
                    }
                };

                loop();
            }
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
    private readonly _modules: {[key: string]: ContextModuleBase<{}>};
    private _isDestroyed = false;
    private readonly _parentContext: Context | null;
    private readonly _childContexts = new Set<Context>();

    constructor(parentContext: Context | null, modules: {[key: string]: ContextModuleBase<{}>}) {
        this._parentContext = parentContext;
        this._modules = modules;

        for (const [key, actualModule] of Object.entries(modules)) {
            assert(
                !Object.getOwnPropertyDescriptor(actualModule, "_context"),
                "Can't construct a context with a module that has been bound to a different context",
            );

            // Create a clone of the context module and set the context module as the
            // prototype! This way whenever you call a method on the context module you get
            // the latest context module as `this.context`.
            // *Insert meme* (https://knowyourmeme.com/memes/roll-safe)
            const localModule = Object.create(actualModule, {
                _context: {value: this, configurable: false, writable: false},
            });

            // Freeze the module so developers don't run into issues where they try to
            // assign something to `this` in their class and it assigns to the local
            // context object (so the write is ignored in other context clones) instead of
            // the actual context object.
            //
            // If a developer wants some mutable state in their context they can create a
            // "ref" style object and assign to that. For example
            // `private readonly _counterRef: {current: number}`. Now you can assign to
            // `this._counterRef.current++` and it will be reflected in all contexts in the
            // clone tree.
            //
            // We use `Object.preventExtensions()` instead of `Object.freeze()` because the
            // one "own" property we add to this object is `context` and we define it above
            // as non-configurable and non-writable. All that's left to do is prevent
            // extensions to make sure developers don't shoot themselves in the foot.
            //
            // [`Object.freeze()` has some unclear performance characteristics][1].
            // `Object.preventExtensions()` is more narrow in scope and hopefully doesn't
            // have problems.
            //
            // [1]: https://github.com/automerge/automerge/issues/177
            Object.preventExtensions(localModule);

            (this as any)[key] = localModule;
        }

        this._parentContext?._childContexts.add(this);
    }

    public destroy() {
        if (this._isDestroyed) throw new InternalError("Context was already destroyed");
        this._isDestroyed = true;

        const throwDestroyedError = () => {
            throw new InternalError("Context was destroyed");
        };

        // When we destroy the context, replace all our modules with getters that throw
        // an error when you try to access the property.
        for (const key of Object.keys(this._modules)) {
            Object.defineProperty(this, key, {get: throwDestroyedError});
        }

        // Destroy all our child contexts. Remove ourselves from our parent context so
        // the parent context won't destroy us when it's destroyed.
        this._parentContext?._childContexts.delete(this);
        for (const childContext of this._childContexts) childContext.destroy();
    }

    public clone(newModules: {[key: string]: ContextModuleBase<{}>}): Context {
        const modules = {...this._modules};

        for (const [key, newModule] of Object.entries(newModules)) {
            const oldModule = modules[key];

            // If replacing a context module, then the new one should be a part of the same
            // class hierarchy as the old one. That way any context modules which depend on
            // the old context module can safely call methods on the new context as well.
            if (oldModule) {
                assert(
                    (newModule instanceof oldModule.constructor) as any,
                    "If replacing a context module, the new context module should be a subclass of the old context module",
                );
            }

            modules[key] = newModule;
        }

        return new Context(this, modules);
    }

    public async with<Value>(
        newModules: {[key: string]: ContextModuleBase<{}>},
        action: (context: Context) => Promise<Value>,
    ): Promise<Value> {
        // If we have a `ProcessContextModule` then extend the lifetime of the context
        // with any `context.process.waitUntil()` calls.
        if (!this._modules.process && !newModules.process) {
            const newContext = this.clone(newModules);
            try {
                const value = await action(newContext);
                return value;
            } finally {
                newContext.destroy();
            }
        } else {
            const processContextModule = newModules.process ?? this._modules.process;
            assert(processContextModule instanceof ProcessContextModule);

            let taskPromises: Array<Promise<unknown>> = [];

            const newContext = this.clone({
                ...newModules,
                process: new ProcessContextModule({
                    waitUntil: promise => {
                        processContextModule.waitUntil(promise);

                        // We keep track of tasks our request is waiting on since we don't want to
                        // destroy the request context until all tasks have completed. Since the task
                        // may reference the request context.
                        taskPromises.push(promise);
                    },
                }),
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
                        void Promise.allSettled(currentTaskPromises).finally(loop);
                    }
                };

                loop();
            }
        }
    }

    public withSync<Value>(
        newModules: {[key: string]: ContextModuleBase<{}>},
        action: (context: Context) => Value,
    ): Value {
        // If we have a `ProcessContextModule` then extend the lifetime of the context
        // with any `context.process.waitUntil()` calls.
        if (!this._modules.process && !newModules.process) {
            const newContext = this.clone(newModules);
            try {
                const value = action(newContext);
                return value;
            } finally {
                newContext.destroy();
            }
        } else {
            const processContextModule = newModules.process ?? this._modules.process;
            assert(processContextModule instanceof ProcessContextModule);

            let taskPromises: Array<Promise<unknown>> = [];

            const newContext = this.clone({
                ...newModules,
                process: new ProcessContextModule({
                    waitUntil: promise => {
                        processContextModule.waitUntil(promise);

                        // We keep track of tasks our request is waiting on since we don't want to
                        // destroy the request context until all tasks have completed. Since the task
                        // may reference the request context.
                        taskPromises.push(promise);
                    },
                }),
            });

            try {
                const result = action(newContext);
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
                        void Promise.allSettled(currentTaskPromises).finally(loop);
                    }
                };

                loop();
            }
        }
    }
};
