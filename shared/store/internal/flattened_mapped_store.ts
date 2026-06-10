import {InternalError} from "~/shared/error/error.js";
import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Store} from "~/shared/store/internal/store.js";
import {StoreWeakImmediateListeners} from "~/shared/store/internal/store_weak_immediate_listeners.js";

/**
 * A combinator for `Store` which turns `Store<Store<Value>>` into `Store<Value>`.
 *
 * Combines both a `flat()` combinator and a `map()` combinator into a `flatMap()`
 * combinator. The `flat()` combinator can be trivially derived by using an
 * identity function for `map()`. Since `flatMap()` is more common than `flat()` we
 * wanted a combinator implementation that's more efficient for `flatMap()`.
 */
export class FlattenedMappedStore<OldValue, NewValue> extends Store<NewValue> {
    private readonly _store: Store<OldValue>;
    private readonly _map: (oldValue: OldValue) => Store<NewValue>;
    private _oldValue: OldValue | null = null;
    private _nestedStoreResult: Result<Store<NewValue>> | null = null;
    private readonly _listeners = new Map<() => void, number>();
    private _weakImmediateListeners: StoreWeakImmediateListeners | null = null;

    constructor(store: Store<OldValue>, map: (oldValue: OldValue) => Store<NewValue>) {
        super();
        this._store = store;
        this._map = map;
    }

    public override isFinal(): boolean {
        return (
            this._store.isFinal() &&
            this._nestedStoreResult?.ok === true &&
            this._nestedStoreResult.value.isFinal()
        );
    }

    public readonly getSnapshot = () => {
        if (this._nestedStoreResult === null) {
            // If `getSnapshot()` throws, it's fine. We don't leave our store in a bad partial
            // state.
            this._oldValue = this._store.getSnapshot();
            this._nestedStoreResult = captureResult(() => this._map(this._oldValue!));

            this._weakImmediateListeners?.moveListeners(
                null,
                this._nestedStoreResult.value ?? null,
            );

            for (const [listener, listenerCount] of this._listeners) {
                for (let i = 0; i < listenerCount; i++) {
                    this._nestedStoreResult.value?.addListener(listener);
                }
            }

            return unwrapResult(this._nestedStoreResult).getSnapshot();
        }

        const oldNestedStoreResult = this._nestedStoreResult;
        const oldOldValue = this._oldValue;
        // If `getSnapshot()` throws, it's fine. We don't leave our store in a bad partial
        // state.
        const newOldValue = (this._oldValue = this._store.getSnapshot());
        const newNestedStoreResult = !Object.is(oldOldValue, newOldValue)
            ? (this._nestedStoreResult = captureResult(() => this._map(newOldValue)))
            : this._nestedStoreResult;

        // If the nested store changed then move our listeners from the old nested store to
        // the new nested store.
        if (oldNestedStoreResult.value !== newNestedStoreResult.value) {
            this._weakImmediateListeners?.moveListeners(
                oldNestedStoreResult.value ?? null,
                newNestedStoreResult.value ?? null,
            );

            for (const [listener, listenerCount] of this._listeners) {
                for (let i = 0; i < listenerCount; i++) {
                    oldNestedStoreResult.value?.removeListener(listener);
                    newNestedStoreResult.value?.addListener(listener);
                }
            }
        }

        return unwrapResult(this._nestedStoreResult).getSnapshot();
    };

    public addListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) + 1;
        this._listeners.set(listener, listenerCount);

        this._store.addListener(listener);
        this._nestedStoreResult?.value?.addListener(listener);
    }

    public removeListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) - 1;
        if (listenerCount < 0) {
            throw new InternalError("Can\u2019t remove listener that wasn\u2019t added to store");
        } else if (listenerCount === 0) {
            this._listeners.delete(listener);
        } else {
            this._listeners.set(listener, listenerCount);
        }

        this._store.removeListener(listener);
        this._nestedStoreResult?.value?.removeListener(listener);
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.addListener(listener);

        this._store._addWeakImmediateListener(listener);
        this._nestedStoreResult?.value?._addWeakImmediateListener(listener);
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.removeListener(listener);

        this._store._removeWeakImmediateListener(listener);
        this._nestedStoreResult?.value?._removeWeakImmediateListener(listener);
    }
}
