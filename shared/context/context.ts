import {ContextModuleBase, ContextModuleModulesType} from "~/shared/context/context_module_base.js";
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
 * Get the modules object type from a context.
 */
export type ContextModulesType<T extends Context<any>> = T[typeof modulesTypeSymbol];

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
    // have quotes when generating a `.d.ts` file.
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
        action: (context: Context<Modules>) => Value,
    ): Value;
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
        const context = Context.new(modules);

        // Turn on `waitUntil()` tracking. When this value is null (the default) we
        // don't destroy the context when all `waitUntil()` calls finish. For contexts
        // you manually destroy (like those created by `Context.new()` and
        // `context.clone()` like `ServerProcessContext`) we shouldn't destroy the
        // context when all `waitUntil()`s finish.
        //
        // However, action-scoped contexts created with `context.with()` should be
        // destroyed after all `waitUntil()` promises finish.
        //
        // @ts-expect-error: This property exists but it's private since we only want
        // to use it in this `context.ts` file. Ignore the TypeScript error.
        context._waitUntilPromiseCount = 1;

        try {
            const value = await action(context);
            return value;
        } finally {
            assert(typeof context._waitUntilPromiseCount === "number");

            // @ts-expect-error: This property exists but it's private since we only want
            // to use it in this `context.ts` file. Ignore the TypeScript error.
            context._waitUntilPromiseCount--;

            // If the lifetime of the context was extended by calling `_waitUntil()` then
            // don't destroy the context just yet.
            if (context._waitUntilPromiseCount === 0) {
                context.destroy();
            }
        }
    },

    withSync<Modules extends {[key: string]: ContextModuleBase}, Value>(
        modules: Modules & ContextModulesDependencies<Modules>,
        action: (context: Context<Modules>) => Value,
    ): Value {
        const context = Context.new(modules);

        // Turn on `waitUntil()` tracking. When this value is null (the default) we
        // don't destroy the context when all `waitUntil()` calls finish. For contexts
        // you manually destroy (like those created by `Context.new()` and
        // `context.clone()` like `ServerProcessContext`) we shouldn't destroy the
        // context when all `waitUntil()`s finish.
        //
        // However, action-scoped contexts created with `context.with()` should be
        // destroyed after all `waitUntil()` promises finish.
        //
        // @ts-expect-error: This property exists but it's private since we only want
        // to use it in this `context.ts` file. Ignore the TypeScript error.
        context._waitUntilPromiseCount = 1;

        try {
            const value = action(context);
            return value;
        } finally {
            assert(typeof context._waitUntilPromiseCount === "number");

            // @ts-expect-error: This property exists but it's private since we only want
            // to use it in this `context.ts` file. Ignore the TypeScript error.
            context._waitUntilPromiseCount--;

            // If the lifetime of the context was extended by calling `_waitUntil()` then
            // don't destroy the context just yet.
            if (context._waitUntilPromiseCount === 0) {
                context.destroy();
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
    private _waitUntilPromiseCount: number | null = null;
    private readonly _parentContext: Context | null;
    private readonly _childContexts = new Set<Context>();

    constructor(parentContext: Context | null, modules: {[key: string]: ContextModuleBase<{}>}) {
        this._parentContext = parentContext;
        this._modules = modules;

        for (const [key, actualModule] of Object.entries(modules)) {
            assert(
                !Object.getOwnPropertyDescriptor(actualModule, "_context"),
                "Can\u2019t construct a context with a module that has been bound to a different context",
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
                    ((newModule instanceof oldModule.constructor) as any) ||
                        // HACK(calebmer): Allow context modules to be replaced by a module that's not
                        // a part of the same class hierarchy. Technically this is unsound. A peer
                        // context module might still expect the context module at `key` to still have
                        // the old type. However, this is a practical workaround for cases where it's
                        // useful to completely change the context module (e.g. swapping actor types).
                        //
                        // An example of how this is unsound: We use this function to allow replacing a
                        // system actor with an impersonated account actor. Let's say we have a system
                        // action context with a hypothetical `context.admin` module. Where the `admin`
                        // module depends on a specific property of the system actor context module
                        // (let's pretend the system actor context module has a method called
                        // `context.actor.sendAnnouncementToEveryone()`). Calling `context.clone()`
                        // with an impersonated account actor that replaces the system actor will be
                        // allowed (because of this `_allowReplace()` method) but if `context.admin`
                        // isn't updated it may still think the actor is a system actor and try to call
                        // `context.actor.sendAnnouncementToEveryone()` which throws a "can't call
                        // undefined" error.
                        //
                        // This is a very pedantic issue. Practically it's generally fine to allow
                        // replacing context modules with whatever type we want.
                        oldModule._allowReplace(newModule),
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
        const newContext = this.clone(newModules);

        // Turn on `waitUntil()` tracking. When this value is null (the default) we
        // don't destroy the context when all `waitUntil()` calls finish. For contexts
        // you manually destroy (like those created by `Context.new()` and
        // `context.clone()` like `ServerProcessContext`) we shouldn't destroy the
        // context when all `waitUntil()`s finish.
        //
        // However, action-scoped contexts created with `context.with()` should be
        // destroyed after all `waitUntil()` promises finish.
        newContext._waitUntilPromiseCount = 1;

        try {
            const value = await action(newContext);
            return value;
        } finally {
            assert(typeof newContext._waitUntilPromiseCount === "number");

            newContext._waitUntilPromiseCount--;

            // If the lifetime of the context was extended by calling `_waitUntil()` then
            // don't destroy the context just yet.
            if (newContext._waitUntilPromiseCount === 0) {
                newContext.destroy();
            }
        }
    }

    public withSync<Value>(
        newModules: {[key: string]: ContextModuleBase<{}>},
        action: (context: Context) => Value,
    ): Value {
        const newContext = this.clone(newModules);

        // Turn on `waitUntil()` tracking. When this value is null (the default) we
        // don't destroy the context when all `waitUntil()` calls finish. For contexts
        // you manually destroy (like those created by `Context.new()` and
        // `context.clone()` like `ServerProcessContext`) we shouldn't destroy the
        // context when all `waitUntil()`s finish.
        //
        // However, action-scoped contexts created with `context.with()` should be
        // destroyed after all `waitUntil()` promises finish.
        newContext._waitUntilPromiseCount = 1;

        try {
            const value = action(newContext);
            return value;
        } finally {
            assert(typeof newContext._waitUntilPromiseCount === "number");

            newContext._waitUntilPromiseCount--;

            // If the lifetime of the context was extended by calling `_waitUntil()` then
            // don't destroy the context just yet.
            if (newContext._waitUntilPromiseCount === 0) {
                newContext.destroy();
            }
        }
    }

    /**
     * Extend the context's lifetime for action-scoped context's. Action scoped
     * context's are created with:
     *
     * - `parentContext.with(modules, action)`
     * - `parentContext.withSync(modules, action)`
     * - `Context.with(modules, action)`
     * - `Context.withSync(modules, action)`
     *
     * Action scoped contexts live until the end of their `action` function and
     * then they're destroyed (by calling `context.destroy()`). Unless a developer
     * uses `context.process.waitUntil(promise)` within the action. This extends
     * the context's lifetime until after `promise` passed to `waitUntil()`
     * resolves/rejects.
     *
     * Non-action scoped contexts are created with:
     *
     * - `parentContext.clone(modules)`
     * - `Context.new(modules)`
     *
     * You must manually destroy these contexts when you're done with them (by
     * calling `context.destroy()`).
     *
     * This method implements lifetime extension for action scoped contexts. When
     * called it loops up the context parent tree incrementing
     * `_waitUntilPromiseCount`. Which is null for non-action scoped contexts and
     * non-null for action scoped contexts. When the promise resolves/rejects we
     * loop through the context parent tree again decrementing
     * `_waitUntilPromiseCount` for action scoped contexts. If
     * `_waitUntilPromiseCount` reaches 0 then we destroy the context.
     */
    private _waitUntil(promise: Promise<unknown>) {
        // Can't extend the context's lifespan if the context has already been
        // destroyed.
        if (this._isDestroyed) throw new InternalError("Context was destroyed");

        let currentContext: Context | null = this;
        while (currentContext !== null) {
            if (currentContext._waitUntilPromiseCount !== null) {
                currentContext._waitUntilPromiseCount++;
            }

            currentContext = currentContext._parentContext;
        }

        let hasSettled = false;

        const settle = () => {
            // Protect against a buggy non-native `Promise` implementation that
            // resolves/rejects twice. It's important the following code only runs
            // once or else we risk destroying contexts twice.
            if (hasSettled) return;
            hasSettled = true;

            let currentContext: Context | null = this;
            while (currentContext !== null) {
                if (currentContext._waitUntilPromiseCount !== null) {
                    currentContext._waitUntilPromiseCount--;

                    if (currentContext._waitUntilPromiseCount === 0) {
                        currentContext.destroy();
                    }
                }

                currentContext = currentContext._parentContext;
            }
        };

        // Provide an error handler so we don't have unhandled promise rejection logs.
        // The `waitUntil` implementation provided to `ProcessContextModule` is
        // expected to handle errors.
        promise.then(settle, settle);
    }
};
