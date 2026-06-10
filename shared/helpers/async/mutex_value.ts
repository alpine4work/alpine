import {Mutex} from "~/shared/helpers/async/mutex.js";

/**
 * A mutex that owns a value. Useful if you want to force exclusive access to a
 * piece of state.
 */
export class MutexValue<Value> {
    private readonly _mutex = new Mutex();
    private _valueRef: {current: Value};

    constructor(value: Value) {
        this._valueRef = {current: value};
    }

    /**
     * Get the current value without locking. This function is unsafe! A lock may be in
     * the middle of updating this value. Only use if you know what you're doing.
     */
    public getWithoutLock(): Value {
        return this._valueRef.current;
    }

    /**
     * Locks the mutex and gives you a reference to the value which you can read/write
     * to.
     */
    public async withLock<ReturnValue>(
        action: (valueRef: {current: Value}) => Promise<ReturnValue>,
    ): Promise<ReturnValue> {
        const unlock = await this._mutex.lock();
        try {
            const returnValue = await action(this._valueRef);
            return returnValue;
        } finally {
            unlock();
        }
    }

    /**
     * Wait for the mutex to unlock.
     */
    public waitForUnlock() {
        return this._mutex.waitForUnlock();
    }
}
