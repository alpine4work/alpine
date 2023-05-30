import {Store} from "~/client/helpers/store/store";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error";

/**
 * A simple immutable value store object designed for use with React's
 * [`useSyncExternalStore()`][1] hook.
 *
 * Store values are immutable. You should only change the value in the store
 * by calling `set()`.
 *
 * [1]: https://react.dev/reference/react/useSyncExternalStore
 */
export class ValueStore<Value> extends Store<Value> {
    private _value: Value;
    private readonly _listeners = new Set<() => void>();

    constructor(value: Value) {
        super();
        this._value = value;
    }

    /**
     * Get the current value of the store. If you call this function you won't be
     * subscribed to updates from the store! Generally you want to use this
     * alongside `subscribe()`.
     *
     * We name this function `getSnapshot()` instead of the cleaner `get()` to
     * force the user to account for only getting the current value and not future
     * values. This name also aligns with the `useSyncExternalStore()` API.
     */
    // NOTE: This is an arrow function so you can dereference the function like
    // `useSyncExternalStore(store.subscribe, store.getSnapshot)` without losing
    // the `this` reference.
    public readonly getSnapshot = (): Value => {
        return this._value;
    };

    /**
     * Update the value in the store. Calls any subscribed listeners. The store
     * value should be immutable so this should be the only way to update it.
     */
    public set(value: Value | ((value: Value) => Value)): void {
        const actualValue: Value =
            typeof value === "function" ? (value as (value: Value) => Value)(this._value) : value;

        // Optimization: Skip updates where the value is exactly equal to the
        // previous value.
        if (Object.is(this._value, actualValue)) return;

        this._value = actualValue;

        for (const listener of this._listeners) {
            try {
                listener();
            } catch (error) {
                // If one of our listeners throws an error, continue calling the rest of our
                // listeners.
                //
                // Treat listener errors as unhandled errors. Emitting an event should not need
                // to think about downstream listener implementation details.
                scheduleUncaughtError(error);
            }
        }
    }

    /**
     * Subscribe to whenever the store value updates. A listener will be called
     * with the new value.
     */
    // NOTE: This is an arrow function so you can dereference the function like
    // `useSyncExternalStore(store.subscribe, store.getSnapshot)` without losing
    // the `this` reference.
    public readonly subscribe = (listener: () => void): (() => void) => {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    };
}
