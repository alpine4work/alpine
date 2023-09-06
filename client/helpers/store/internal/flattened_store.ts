import {Store} from "~/client/helpers/store/internal/store.js";
import {StoreWeakImmediateListeners} from "~/client/helpers/store/internal/store_weak_immediate_listeners.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * A combinator for `Store` which turns `Store<Store<Value>>` into
 * `Store<Value>`.
 */
export class FlattenedStore<Value> extends Store<Value> {
    private readonly _store: Store<Store<Value>>;
    private _nestedStore: Store<Value>;
    private readonly _listeners = new Map<() => void, number>();
    private _weakImmediateListeners: StoreWeakImmediateListeners | null = null;

    constructor(store: Store<Store<Value>>) {
        super();
        this._store = store;
        this._store._addWeakImmediateListener(this._weakImmediateListener);
        this._nestedStore = store.getSnapshot();
    }

    private readonly _weakImmediateListener = () => {
        const oldNestedStore = this._nestedStore;
        const newNestedStore = (this._nestedStore = this._store.getSnapshot());

        // If the nested store changed then move our listeners from the old nested
        // store to the new nested store.
        if (oldNestedStore !== newNestedStore) {
            this._weakImmediateListeners?.moveListeners(oldNestedStore, newNestedStore);

            for (const [listener, listenerCount] of this._listeners) {
                for (let i = 0; i < listenerCount; i++) {
                    oldNestedStore.removeListener(listener);
                    newNestedStore.addListener(listener);
                }
            }
        }
    };

    public readonly getSnapshot = () => {
        return this._nestedStore.getSnapshot();
    };

    public addListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) + 1;
        this._listeners.set(listener, listenerCount);

        this._store.addListener(listener);
        this._nestedStore.addListener(listener);
    }

    public removeListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) - 1;
        if (listenerCount < 0) {
            throw new InternalError("Can't remove listener that wasn't added to store");
        } else if (listenerCount === 0) {
            this._listeners.delete(listener);
        } else {
            this._listeners.set(listener, listenerCount);
        }

        this._store.removeListener(listener);
        this._nestedStore.removeListener(listener);
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.addListener(listener);

        this._store._addWeakImmediateListener(listener);
        this._nestedStore._addWeakImmediateListener(listener);
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.removeListener(listener);

        this._store._removeWeakImmediateListener(listener);
        this._nestedStore._removeWeakImmediateListener(listener);
    }
}
