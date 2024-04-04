import {Store} from "~/client/helpers/store/store.js";

/**
 * A store with a value that never changes. Adding/removing listeners from this
 * store is a noop.
 */
export class ConstStore<Value> extends Store<Value> {
    private readonly _value: Value;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public readonly getSnapshot = () => {
        return this._value;
    };

    public addListener() {}
    public removeListener() {}
    public _addWeakImmediateListener() {}
    public _removeWeakImmediateListener() {}
}

export const nullStore = new ConstStore(null);
export const undefinedStore = new ConstStore(undefined);
export const trueStore = new ConstStore(true);
export const falseStore = new ConstStore(false);
