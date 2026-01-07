// Important that this is a type import to break the import cycle.
import type {Context} from "~/shared/context/context.js";
import {InternalError} from "~/shared/error/error.js";

// Never actually used at runtime. Only used by the type system.
declare const modulesTypeSymbol: unique symbol;

/**
 * A `Context` is made up of a couple modules. All modules inherit from this
 * class.
 *
 * Modules have access to the context object where the module was invoked
 * through its `this._context` reference.
 *
 * The own properties of a context module may not be mutated after it is
 * constructed! In fact, you will get an error if you try to mutate the context
 * module in a method since we call `Object.freeze()` on the module.
 *
 * However you may mutate sub-objects on the context. For example
 * `this._counterRef = {current: 0}`. You may mutate
 * `this._counterRef.current++` but you would not be able to mutate
 * `this._counter++`.
 *
 * The reason you can't mutate direct properties is that when we clone a
 * context we also clone context modules so we can change the `this._context`
 * reference. Instead of constructing a new context module, we create an object
 * with the context module as the prototype! With:
 * `Object.create(contextModule, {_context: {...}})`. That is why if you try to
 * assign a property like `this._counter = 42` then the assignment will be on
 * the cloned context module, not the original context module that is shared
 * across clones.
 */
export class ContextModuleBase<
    Modules extends {[key: string]: ContextModuleBase | undefined} = {},
> {
    // This symbol doesn't exist at runtime. It only exists in the type system.
    // It's also private to this module. By including this, it makes it easier for
    // TypeScript to infer the type of `Modules` when performing inference of the
    // form `Context<infer Modules>`. Otherwise TypeScript sometimes considers the
    // `clone()` function on the `Context` object to be a part of modules!
    declare public readonly [modulesTypeSymbol]: Modules;

    protected get _context(): Context<Modules> {
        throw new InternalError(
            "Can’t access the context property until this context module is bound to a context object",
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public _allowReplace(otherModule: ContextModuleBase): boolean {
        return false;
    }
}

/**
 * Get the `Modules` type for a context module.
 */
export type ContextModuleModulesType<Module extends ContextModuleBase> =
    Module[typeof modulesTypeSymbol];
