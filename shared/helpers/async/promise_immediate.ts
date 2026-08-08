import {UnavailableError} from "~/shared/error/error.open_source.js";
import {isPromiseLike} from "~/shared/helpers/async/is_promise_like.js";
import {PromiseState, pendingPromiseState} from "~/shared/helpers/async/promise_state.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Same as a promise except `PromiseImmediate.then()` will call its callbacks
 * synchronously if the promise is resolved.
 *
 * Implements the "thenable" API so you can await these promises in async/await
 * functions. However, awaiting the promise will turn it into a regular promise. If
 * you want to preserve the immediate behavior you need to use
 * `PromiseImmediate.then()`.
 *
 * Useful in a React Suspense world where you need async values to return
 * synchronously if they're resolved in a render method (and otherwise throw).
 */
export class PromiseImmediate<Value> implements PromiseLike<Value> {
    private _state: PromiseState<Value>;
    // We use `any` for `value` here since it's important that
    // `PromiseImmediate<Value>` is covariant in `Value` type.
    private _onResolvedCallbacks: Array<(value: any) => void> | null;
    private _onRejectedCallbacks: Array<(error: unknown) => void> | null;

    constructor(
        executor: (
            resolve: (value: Value | PromiseLike<Value>) => void,
            reject: (error: unknown) => void,
        ) => void,
    ) {
        this._state = pendingPromiseState;
        this._onResolvedCallbacks = [];
        this._onRejectedCallbacks = [];

        let hasCalledResolveOrReject1 = false;

        try {
            executor(
                value => {
                    if (hasCalledResolveOrReject1) return;
                    hasCalledResolveOrReject1 = true;

                    if (!isPromiseLike(value)) {
                        this._setFulfilled(value);
                    } else {
                        let hasCalledResolveOrReject2 = false;
                        value.then(
                            value => {
                                if (hasCalledResolveOrReject2) return;
                                hasCalledResolveOrReject2 = true;
                                this._setFulfilled(value);
                            },
                            value => {
                                if (hasCalledResolveOrReject2) return;
                                hasCalledResolveOrReject2 = true;
                                this._setRejected(value);
                            },
                        );
                    }
                },
                error => {
                    if (hasCalledResolveOrReject1) return;
                    hasCalledResolveOrReject1 = true;

                    if (!isPromiseLike(error)) {
                        this._setRejected(error);
                    } else {
                        let hasCalledResolveOrReject2 = false;
                        error.then(
                            value => {
                                if (hasCalledResolveOrReject2) return;
                                hasCalledResolveOrReject2 = true;
                                this._setRejected(value);
                            },
                            value => {
                                if (hasCalledResolveOrReject2) return;
                                hasCalledResolveOrReject2 = true;
                                this._setRejected(value);
                            },
                        );
                    }
                },
            );
        } catch (error) {
            if (!hasCalledResolveOrReject1) {
                hasCalledResolveOrReject1 = true;
                this._setRejected(error);
            }
        }
    }

    private _setFulfilled(value: Value) {
        assert(this._state.status === "pending" && this._onResolvedCallbacks !== null);

        this._state = {status: "fulfilled", value};

        const onResolvedCallbacks = this._onResolvedCallbacks;
        this._onResolvedCallbacks = null;
        this._onRejectedCallbacks = null;

        for (const onResolvedCallback of onResolvedCallbacks) {
            onResolvedCallback(value);
        }
    }

    private _setRejected(reason: unknown) {
        assert(this._state.status === "pending" && this._onRejectedCallbacks !== null);

        this._state = {status: "rejected", reason};

        const onRejectedCallbacks = this._onRejectedCallbacks;
        this._onResolvedCallbacks = null;
        this._onRejectedCallbacks = null;

        for (const onRejectedCallback of onRejectedCallbacks) {
            onRejectedCallback(reason);
        }
    }

    /**
     * Get the current internal state of the promise.
     */
    // NOTE(calebmer): If the `use()` React RFC is adopted we should consider exposing
    // our promise's state in the same way this RFC specifies:
    // https://github.com/acdlite/rfcs/blob/9c21ca1/text/0000-first-class-support-for-promises.md#reading-the-result-of-a-promise-that-was-read-previously
    public getStateWithoutListening(): PromiseState<Value> {
        return this._state;
    }

    /**
     * Is this promise currently pending?
     */
    public isPending(): boolean {
        return this._state.status === "pending";
    }

    /**
     * Get the fulfilled promise value or throw an error if the promise is still
     * pending.
     */
    public getOrThrow(): Value {
        switch (this._state.status) {
            case "fulfilled":
                return this._state.value;
            case "rejected":
                throw this._state.reason;
            case "pending":
                throw new UnavailableError("Promise is pending");
            default:
                throw exhaustive(this._state);
        }
    }

    /**
     * Get the fulfilled promise value or return undefined if the promise is still
     * pending.
     */
    public getIfAvailable(): Value | undefined {
        switch (this._state.status) {
            case "fulfilled":
                return this._state.value;
            case "rejected":
                throw this._state.reason;
            case "pending":
                return undefined;
            default:
                throw exhaustive(this._state);
        }
    }

    static resolve(value: void): PromiseImmediate<void>;
    static resolve<Value>(value: Value | PromiseLike<Value>): PromiseImmediate<Value>;
    static resolve<Value>(value: Value | PromiseLike<Value>): PromiseImmediate<Value> {
        return new PromiseImmediate(resolve => {
            resolve(value);
        });
    }

    static reject(error: unknown): PromiseImmediate<never> {
        return new PromiseImmediate((resolve, reject) => {
            reject(error);
        });
    }

    /**
     * Same behavior as `Promise.then()` except if the promise is not pending we will
     * synchronously call our callbacks.
     */
    public then<NewValue1 = Value, NewValue2 = never>(
        onResolved?: ((value: Value) => NewValue1 | PromiseLike<NewValue1>) | null,
        onRejected?: ((error: any) => NewValue2 | PromiseLike<NewValue2>) | null,
    ): PromiseImmediate<NewValue1 | NewValue2> {
        switch (this._state.status) {
            case "fulfilled": {
                const {value} = this._state;

                if (onResolved !== undefined && onResolved !== null) {
                    return new PromiseImmediate(resolve => {
                        const newValue = onResolved(value);
                        resolve(newValue);
                    });
                } else {
                    return new PromiseImmediate(resolve => {
                        resolve(value as any as NewValue1);
                    });
                }
            }
            case "rejected": {
                const {reason} = this._state;

                if (onRejected !== undefined && onRejected !== null) {
                    return new PromiseImmediate(resolve => {
                        const newValue = onRejected(reason);
                        resolve(newValue);
                    });
                } else {
                    return new PromiseImmediate((resolve, reject) => {
                        reject(reason);
                    });
                }
            }
            case "pending": {
                return new PromiseImmediate((resolve, reject) => {
                    assert(
                        this._onResolvedCallbacks !== null && this._onRejectedCallbacks !== null,
                    );

                    this._onResolvedCallbacks.push(value => {
                        if (onResolved !== undefined && onResolved !== null) {
                            try {
                                resolve(onResolved(value));
                            } catch (error) {
                                reject(error);
                            }
                        } else {
                            resolve(value as NewValue1);
                        }
                    });

                    this._onRejectedCallbacks.push(error => {
                        if (onRejected !== undefined && onRejected !== null) {
                            try {
                                resolve(onRejected(error));
                            } catch (error) {
                                reject(error);
                            }
                        } else {
                            reject(error);
                        }
                    });
                });
            }
            default:
                throw exhaustive(this._state);
        }
    }

    public catch<NewValue>(
        onRejected?: ((error: any) => NewValue | PromiseLike<NewValue>) | null,
    ): PromiseImmediate<Value | NewValue> {
        return this.then(null, onRejected);
    }

    /**
     * Same behavior as `Promise.allSettled()` except if all the promises resolve
     * synchronously then the `PromiseImmediate` will also be marked as having
     * synchronously resolved.
     */
    public static allSettled<T extends ReadonlyArray<unknown> | []>(
        values: T,
    ): PromiseImmediate<{-readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>}>;
    public static allSettled<T>(
        values: Iterable<T | PromiseLike<T>>,
    ): PromiseImmediate<Array<PromiseSettledResult<Awaited<T>>>>;
    public static allSettled(
        values: Iterable<unknown>,
    ): PromiseImmediate<Array<PromiseSettledResult<unknown>>> {
        return new PromiseImmediate(resolve => {
            let hasFinishedIterating = false;
            let count = 0;
            let settledCount = 0;

            const results: Array<PromiseSettledResult<unknown>> = [];

            for (const value of values) {
                const index = count;
                count++;

                if (!isPromiseLike(value)) {
                    settledCount++;
                    results[index] = {status: "fulfilled", value};
                } else {
                    let hasCalledResolveOrReject = false;

                    value.then(
                        value => {
                            if (hasCalledResolveOrReject) return;
                            hasCalledResolveOrReject = true;

                            settledCount++;
                            results[index] = {status: "fulfilled", value};

                            if (hasFinishedIterating && count === settledCount) {
                                resolve(results);
                            }
                        },
                        value => {
                            if (hasCalledResolveOrReject) return;
                            hasCalledResolveOrReject = true;

                            settledCount++;
                            results[index] = {status: "rejected", reason: value};

                            if (hasFinishedIterating && count === settledCount) {
                                resolve(results);
                            }
                        },
                    );
                }
            }

            hasFinishedIterating = true;

            if (count === settledCount) {
                resolve(results);
            }
        });
    }
}
