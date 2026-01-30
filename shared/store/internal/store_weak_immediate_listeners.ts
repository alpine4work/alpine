import {InternalError} from "~/shared/error/error.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Store} from "~/shared/store/internal/store.js";

/**
 * A set of weakly referenced listeners you can call. Weak listeners are added
 * to stores to avoid creating memory cycles that can't be cleaned up.
 */
export class StoreWeakImmediateListeners {
    private readonly _listeners = new WeakMap<
        () => void,
        {count: number; ref: WeakRef<() => void>}
    >();
    private readonly _listenerRefs = new Set<WeakRef<() => void>>();

    private readonly _finalizationRegistry = new FinalizationRegistry<WeakRef<() => void>>(
        listenerRef => {
            this._listenerRefs.delete(listenerRef);
        },
    );

    /**
     * Adds a listener. Returns true if this is the first listener.
     */
    public addListener(listener: () => void): boolean {
        const listenerEntry = this._listeners.get(listener);

        if (listenerEntry !== undefined) {
            listenerEntry.count++;
            return false;
        } else {
            const listenerRef = new WeakRef(listener);

            this._listeners.set(listener, {count: 1, ref: listenerRef});
            this._listenerRefs.add(listenerRef);
            this._finalizationRegistry.register(listener, listenerRef, listenerRef);
            return true;
        }
    }

    /**
     * Removes a listener. Returns true if this is the last listener.
     */
    public removeListener(listener: () => void): boolean {
        const listenerEntry = this._listeners.get(listener);

        if (listenerEntry === undefined) {
            throw new InternalError("Can\u2019t remove listener that wasn\u2019t added to store");
        } else if (listenerEntry.count > 1) {
            listenerEntry.count--;
            return false;
        } else {
            this._listeners.delete(listener);
            this._listenerRefs.delete(listenerEntry.ref);
            this._finalizationRegistry.unregister(listenerEntry.ref);
            return true;
        }
    }

    public callListeners() {
        for (const listenerRef of this._listenerRefs) {
            try {
                listenerRef.deref()?.();
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

    public moveListeners<Value>(oldStore: Store<Value> | null, newStore: Store<Value> | null) {
        for (const listenerRef of this._listenerRefs) {
            const listener = listenerRef.deref();
            if (listener === undefined) continue;

            const listenerEntry = this._listeners.get(listener)!;

            for (let i = 0; i < listenerEntry.count; i++) {
                oldStore?._removeWeakImmediateListener(listener);
                newStore?._addWeakImmediateListener(listener);
            }
        }
    }

    public getListenerCountForTest() {
        assert(import.meta.jest);

        let listenerCount = 0;

        for (const listenerRef of this._listenerRefs) {
            const listener = listenerRef.deref();
            if (listener === undefined) continue;

            listenerCount++;
        }

        return listenerCount;
    }
}
