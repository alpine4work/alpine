import {Store} from "~/client/helpers/store/internal/store.js";

/**
 * A combinator for `Store` where we can transform the underlying value.
 */
export class MappedStore<OldValue, NewValue> extends Store<NewValue> {
    private readonly _store: Store<OldValue>;
    private readonly _map: (value: OldValue) => NewValue;
    private _hasValues = false;
    private _oldValue: OldValue | null = null;
    private _newValue: NewValue | null = null;

    constructor(store: Store<OldValue>, map: (value: OldValue) => NewValue) {
        super();
        this._store = store;
        this._map = map;
    }

    public readonly getSnapshot = () => {
        const oldValue = this._store.getSnapshot();

        if (this._hasValues === false) {
            this._hasValues = true;
            this._oldValue = oldValue;
            this._newValue = this._map(oldValue);
        } else if (!Object.is(this._oldValue, oldValue)) {
            this._oldValue = oldValue;
            this._newValue = this._map(oldValue);
        }

        return this._newValue!;
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
