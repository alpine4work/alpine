import {InternalError} from "~/shared/error/error.js";
import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {StoreWeakImmediateListeners} from "~/shared/store/internal/store_weak_immediate_listeners.js";
import {Store} from "~/shared/store/store.js";

/**
 * Creates a store that let's you run an arbitrary synchronous computation with
 * any number of dynamic store dependencies and return a result.
 *
 * In your computation function, if you want to read the value from a store
 * call `get(store)`. This not only gives you the current value of the store but
 * also registers the store as a dependency so if it changes in the future your
 * computation will be re-run.
 *
 * You can probably get the same effect as this store by using
 * `store.flatMap()` a bunch but a computation store is significantly more
 * ergonomic and doesn't create a bunch of intermediate store objects.
 */
export function computeStore<NewValue>(
    compute: (get: <Value>(store: Store<Value>) => Value) => NewValue,
): Store<NewValue> {
    return new ComputationStore(compute);
}

// NOTE(calebmer, 2023-09-22): When I worked at Airtable, I introduce a library
// called Live that was similar to the `Store` helpers we have here. `Store` is
// much more focused on incremental updates whereas Live was mostly focused on
// the ergonomics of writing reactive client code. Live basically only provided
// equivalents for `ValueStore` and `computeStore()` (no tree stores, no
// `store.map()`). However, the ergonomics were a lot nicer. It established a
// convention of "live" functions that were like async functions but reactive.
// You'd write a live function by adding "Live" to the end of your function
// name like this:
//
// ```js
// function getNameLive(account) {
//     return account.getFirstNameLive() + " " + account.getLastNameLive();
// }
// ```
//
// The wait it worked is the equivalent of `ValueStore` had a function called
// `getWithoutListening()` (which has the same behavior as `getSnapshot()`) and
// a function called `live()`. The `live()` function looked at a global "live
// context" variable and registered the store as a dependency when we were in a
// live context. Outside of a live context that function threw. We had a lint
// rule to make sure you only ever used live functions in live contexts.
//
// What's really ergonomic about this is you don't have to pass the `get`
// function into live functions. Instead we lookup a global context variable.
// With `computeStore()`, calling `get(store)` is not only less pretty than
// `store.live()` but it also makes it harder to build live abstractions like
// `getFullNameLive(account)`.
//
// The downside of a global live context is it's implicit, not enforced by type
// signatures, and can't support async functions. Maybe in the Cyberworlds
// codebase we can leverage the `Context` object and attach a live context to
// that? Since we have conventions around propagating that object.
class ComputationStore<NewValue> extends Store<NewValue> {
    private readonly _compute: (get: <Value>(store: Store<Value>) => Value) => NewValue;
    private readonly _oldValueResultByStore = new Map<Store<unknown>, Result<unknown>>();
    private _newValueResult: Result<NewValue> | null = null;
    private readonly _listeners = new Map<() => void, number>();
    private _weakImmediateListeners: StoreWeakImmediateListeners | null = null;

    constructor(compute: (get: <Value>(store: Store<Value>) => Value) => NewValue) {
        super();
        this._compute = compute;
    }

    public override isFinal(): boolean {
        // This function should be fast. Recursively checking if all our stores are
        // final defeats the point of this optimization. So pessimistically assume the
        // store is not final.
        //
        // If the `get()` function passed to `compute()` was never called then this
        // store is final.
        return this._newValueResult !== null && this._oldValueResultByStore.size === 0;
    }

    public readonly getSnapshot = () => {
        // Initialize the computation:
        if (this._newValueResult === null) {
            let isFinished = false;

            const get = <Value>(store: Store<Value>): Value => {
                if (isFinished) {
                    throw new InternalError(
                        "Can\u2019t get more stores because we\u2019re finished computing value",
                    );
                }

                // Optimization: Final stores never update so don't bother recording the store
                // in our dependencies.
                if (store.isFinal()) return store.getSnapshot();

                const existingOldValueResult = this._oldValueResultByStore.get(store);

                // If we previously read the value for this store then keep returning the same
                // value. This does mean if a store updates during a computation (we strongly
                // recommend against this) we'll keep returning the old value for just
                // that store.
                if (existingOldValueResult !== undefined) {
                    return unwrapResult(existingOldValueResult) as Value;
                } else {
                    const valueResult = captureResult(() => store.getSnapshot());
                    this._oldValueResultByStore.set(store, valueResult);
                    return unwrapResult(valueResult);
                }
            };

            this._newValueResult = captureResult(() => this._compute(get));
            isFinished = true;

            for (const store of this._oldValueResultByStore.keys()) {
                this._weakImmediateListeners?.moveListeners(null, store);

                for (const [listener, listenerCount] of this._listeners) {
                    for (let i = 0; i < listenerCount; i++) {
                        store.addListener(listener);
                    }
                }
            }

            // If there are zero store dependencies (may happen if all our dependencies are
            // finalized) then our computation store is itself finalized so clear all
            // listeners.
            if (this._oldValueResultByStore.size === 0) {
                this._listeners.clear();
                this._weakImmediateListeners = null;
            }

            return unwrapResult(this._newValueResult);
        }

        // When testing if values changed we put new results into this map so we can
        // reuse them later instead of calling `getSnapshot()` twice in one
        // computation.
        const updatedValueResultByStore = new Map<Store<unknown>, Result<unknown>>();

        const haveNoValuesChanged = iterableEvery(
            this._oldValueResultByStore,
            ([store, oldValueResult]) => {
                const valueResult = captureResult(() => store.getSnapshot());
                updatedValueResultByStore.set(store, valueResult);

                if (valueResult.ok && oldValueResult.ok) {
                    return Object.is(valueResult.value, oldValueResult.value);
                }

                if (!valueResult.ok && !oldValueResult.ok) {
                    return Object.is(valueResult.error, oldValueResult.error);
                }

                return false;
            },
        );

        // If none if this computation's dependencies changed then we don't have to
        // recompute.
        if (haveNoValuesChanged) return unwrapResult(this._newValueResult);

        const removedStores = new Set<Store<unknown>>(this._oldValueResultByStore.keys());
        const addedStores = new Set<Store<unknown>>();

        let isFinished = false;

        const get = <Value>(store: Store<Value>): Value => {
            if (isFinished) {
                throw new InternalError(
                    "Can\u2019t get more stores because we\u2019re finished computing value",
                );
            }

            // Optimization: Final stores never update so don't bother recording the store
            // in our dependencies.
            if (store.isFinal()) return store.getSnapshot();

            const existingOldValueResult = this._oldValueResultByStore.get(store);

            // This is a new store, add it:
            if (existingOldValueResult === undefined) {
                addedStores.add(store);
                const valueResult =
                    updatedValueResultByStore.get(store) ??
                    captureResult(() => store.getSnapshot());
                this._oldValueResultByStore.set(store, valueResult);
                return unwrapResult(valueResult) as Value;
            }

            // This is the first time we're seeing the store this computation, update it:
            if (removedStores.delete(store)) {
                const valueResult =
                    updatedValueResultByStore.get(store) ??
                    captureResult(() => store.getSnapshot());
                this._oldValueResultByStore.set(store, valueResult);
                return unwrapResult(valueResult) as Value;
            }

            // This store was previously seen in the computation, its result is cached:
            //
            // If we previously read the value for this store then keep returning the same
            // value. This does mean if a store updates during a computation (we strongly
            // recommend against this) we'll keep returning the old value for just
            // that store.
            return unwrapResult(existingOldValueResult) as Value;
        };

        this._newValueResult = captureResult(() => this._compute(get));
        isFinished = true;

        for (const store of removedStores) {
            this._oldValueResultByStore.delete(store);

            this._weakImmediateListeners?.moveListeners(store, null);

            for (const [listener, listenerCount] of this._listeners) {
                for (let i = 0; i < listenerCount; i++) {
                    store.removeListener(listener);
                }
            }
        }

        for (const store of addedStores) {
            this._weakImmediateListeners?.moveListeners(null, store);

            for (const [listener, listenerCount] of this._listeners) {
                for (let i = 0; i < listenerCount; i++) {
                    store.addListener(listener);
                }
            }
        }

        // If there are zero store dependencies (may happen if all our dependencies are
        // finalized) then our computation store is itself finalized so clear all
        // listeners.
        if (this._oldValueResultByStore.size === 0) {
            this._listeners.clear();
            this._weakImmediateListeners = null;
        }

        return unwrapResult(this._newValueResult);
    };

    public addListener(listener: () => void) {
        if (this._newValueResult !== null && this._oldValueResultByStore.size === 0) return;

        const listenerCount = (this._listeners.get(listener) ?? 0) + 1;
        this._listeners.set(listener, listenerCount);

        for (const store of this._oldValueResultByStore.keys()) {
            store.addListener(listener);
        }
    }

    public removeListener(listener: () => void) {
        if (this._newValueResult !== null && this._oldValueResultByStore.size === 0) return;

        const listenerCount = (this._listeners.get(listener) ?? 0) - 1;
        if (listenerCount < 0) {
            throw new InternalError("Can\u2019t remove listener that wasn\u2019t added to store");
        } else if (listenerCount === 0) {
            this._listeners.delete(listener);
        } else {
            this._listeners.set(listener, listenerCount);
        }

        for (const store of this._oldValueResultByStore.keys()) {
            store.removeListener(listener);
        }
    }

    public _addWeakImmediateListener(listener: () => void): void {
        if (this._newValueResult !== null && this._oldValueResultByStore.size === 0) return;

        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.addListener(listener);

        for (const store of this._oldValueResultByStore.keys()) {
            store._addWeakImmediateListener(listener);
        }
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        if (this._newValueResult !== null && this._oldValueResultByStore.size === 0) return;

        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.removeListener(listener);

        for (const store of this._oldValueResultByStore.keys()) {
            store._removeWeakImmediateListener(listener);
        }
    }
}
