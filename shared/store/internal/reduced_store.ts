import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Store} from "~/shared/store/internal/store.js";

/**
 * A reduce combinator that lets you observe the previous store value when
 * computing the next store value. It's similar conceptually to
 * `Array.reduce()` and has a similar signature but instead of reducing an
 * array of values we're reducing a store's values over time.
 *
 * The reduce function doesn't reliably observe every value from the base
 * store! Like other stores we compute `getSnapshot()` lazily. So the reduce
 * function only observes values from the base store when `getSnapshot()` is
 * called. If whatever pulls values from our stores (e.g. `useStore()` hook)
 * calls `getSnapshot()` whenever a changes is reported by a `subscribe()`
 * listener the reduce function will end up seeing every base store value over
 * time while the component is `subscribe()`d. If `getSnapshot()` is called
 * less frequently the reduce function might not see every base store value.
 */
export class ReducedStore<BaseValue, Value> extends Store<Value> {
    private readonly _store: Store<BaseValue>;
    private readonly _reduce: (previousValue: Value, currentValue: BaseValue) => Value;
    private _hasReduced = false;
    private _baseValue: BaseValue | null = null;
    private _valueResult: Result<Value>;

    constructor(
        store: Store<BaseValue>,
        reduce: (previousValue: Value, currentValue: BaseValue) => Value,
        initialValue: Value,
    ) {
        super();
        this._store = store;
        this._reduce = reduce;
        this._valueResult = {ok: true, value: initialValue};
    }

    public override isFinal(): boolean {
        return this._store.isFinal();
    }

    public readonly getSnapshot = () => {
        // If `reduce()` threw previously then the reduced store will keep throwing
        // the same error. There's currently no way to recover. We could have an
        // optional `reduceError` option to recover from errors if that's useful.
        const value = unwrapResult(this._valueResult);

        // If `getSnapshot()` throws, it's fine. We don't leave our store in a bad
        // partial state.
        const baseValue = this._store.getSnapshot();

        if (this._hasReduced === false) {
            this._hasReduced = true;
            this._baseValue = baseValue;
            this._valueResult = captureResult(() => this._reduce(value, baseValue));
        } else if (!Object.is(this._baseValue, baseValue)) {
            this._baseValue = baseValue;
            this._valueResult = captureResult(() => this._reduce(value, baseValue));
        }

        return unwrapResult(this._valueResult);
    };

    public addListener(listener: () => void) {
        this._store.addListener(listener);
    }

    public removeListener(listener: () => void) {
        this._store.removeListener(listener);
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._store._addWeakImmediateListener(listener);
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._store._removeWeakImmediateListener(listener);
    }
}
