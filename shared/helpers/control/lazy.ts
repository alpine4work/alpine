import {captureResult, unwrapResult} from "~/shared/helpers/control/capture-result";
import {Result} from "~/shared/helpers/control/result";

/**
 * A lazily computed value. We don't compute the value until `get()` is called
 * the first time and then we never compute again.
 *
 * If the compute function throws then we save the thrown value and re-throw it
 * every time `get()` is called.
 *
 * It is safe to treat a lazy value as an immutable value. Laziness can be
 * thought of an implementation detail for improved efficiency of an otherwise
 * immutable pointer.
 */
export class Lazy<Value> {
    private _result: Result<Value, unknown> | null;
    private _get: (() => Value) | null;

    constructor(get: () => Value) {
        this._result = null;
        this._get = get;
    }

    /**
     * Get the value. If the value has not yet been computed then we will compute
     * it synchronously.
     */
    get(): Value {
        if (this._result === null) {
            this._result = captureResult(this._get!);
            this._get = null;
        }
        return unwrapResult(this._result);
    }
}
