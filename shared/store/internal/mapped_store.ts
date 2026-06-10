import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Store} from "~/shared/store/internal/store.js";

/**
 * A combinator for `Store` where we can transform the underlying value.
 */
export class MappedStore<OldValue, NewValue> extends Store<NewValue> {
    private readonly _store: Store<OldValue>;
    private readonly _map: (value: OldValue) => NewValue;
    private _oldValue: OldValue | null = null;
    private _newValueResult: Result<NewValue> | null = null;

    constructor(store: Store<OldValue>, map: (value: OldValue) => NewValue) {
        super();
        this._store = store;
        this._map = map;
    }

    public override isFinal(): boolean {
        return this._store.isFinal();
    }

    public readonly getSnapshot = () => {
        // If `getSnapshot()` throws, it's fine. We don't leave our store in a bad partial
        // state.
        const oldValue = this._store.getSnapshot();

        if (this._newValueResult === null) {
            this._oldValue = oldValue;
            this._newValueResult = captureResult(() => this._map(oldValue));
        } else if (!Object.is(this._oldValue, oldValue)) {
            this._oldValue = oldValue;
            this._newValueResult = captureResult(() => this._map(oldValue));
        }

        return unwrapResult(this._newValueResult);
    };

    public addListener(listener: () => void): void {
        this._store.addListener(listener);
    }

    public removeListener(listener: () => void): void {
        this._store.removeListener(listener);
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._store._addWeakImmediateListener(listener);
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._store._removeWeakImmediateListener(listener);
    }
}
