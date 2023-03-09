import {FailedPreconditionError} from "~/shared/error/error";

/**
 * Small utility that only allows a value to be accessed once. Then it throws
 * the value away so it can be garbage collected.
 *
 * Use this when you have a one-time use value that's expensive memory-wise and
 * it's propagated in an object that is retained longer then the value is
 * needed. For example, React props that initialize state.
 */
export class Take<Value> {
    private _value: Value | null;

    constructor(value: Value) {
        this._value = value;
    }

    public wasTaken(): boolean {
        return this._value === null;
    }

    public take(): Value {
        if (this._value === null)
            throw new FailedPreconditionError("Value was already taken, can only take value once");
        const value = this._value;
        this._value = null;
        return value;
    }
}
