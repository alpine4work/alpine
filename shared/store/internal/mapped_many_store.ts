import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {Store} from "~/shared/store/internal/store.js";

/**
 * Maps the values from multiple stores into one result value. Accessed via the
 * static `Store.map()` combinator.
 */
export class MappedManyStore<
    OldValues extends ReadonlyArray<any>,
    NewValue,
> extends Store<NewValue> {
    private readonly _stores: ReadonlyArray<Store<OldValues[number]>>;
    private readonly _map: (values: OldValues) => NewValue;
    private _oldValues: OldValues | null = null;
    private _newValueResult: Result<NewValue> | null = null;

    constructor(
        stores: ReadonlyArray<Store<OldValues[number]>>,
        map: (value: OldValues) => NewValue,
    ) {
        super();
        this._stores = stores;
        this._map = map;
    }

    public override isFinal(): boolean {
        // This function should be fast. Recursively checking if all our stores are final
        // defeats the point of this optimization. So assume the store is not final.
        return false;
    }

    public readonly getSnapshot = () => {
        const oldValues = this._stores.map(store => store.getSnapshot()) as any as OldValues;

        if (this._newValueResult === null) {
            this._oldValues = oldValues;
            this._newValueResult = captureResult(() => this._map(oldValues));
        } else if (!oldValues.every((oldValue, i) => Object.is(oldValue, this._oldValues![i]))) {
            this._oldValues = oldValues;
            this._newValueResult = captureResult(() => this._map(oldValues));
        }

        return unwrapResult(this._newValueResult);
    };

    public addListener(listener: () => void): void {
        for (const store of this._stores) {
            store.addListener(listener);
        }
    }

    public removeListener(listener: () => void): void {
        for (const store of this._stores) {
            store.removeListener(listener);
        }
    }

    public _addWeakImmediateListener(listener: () => void): void {
        for (const store of this._stores) {
            store._addWeakImmediateListener(listener);
        }
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        for (const store of this._stores) {
            store._removeWeakImmediateListener(listener);
        }
    }
}
