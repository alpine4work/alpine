import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";

export type PromiseImmediateResolver<T> = {
    readonly promise: PromiseImmediate<T>;
    readonly isSettled: () => boolean;
    readonly resolve: (value: T) => void;
    readonly reject: (error: unknown) => void;
};

/**
 * Sometimes constructing a promise with its immediately invoked constructor
 * function is inconvenient. Using a promise resolver inverts the promise so you
 * can call the resolver functions anywhere.
 */
export function createPromiseImmediateResolver<T = void>(): PromiseImmediateResolver<T> {
    let isSettled = false;
    let resolve: (value: T) => void;
    let reject: (error: unknown) => void;

    const promise = new PromiseImmediate<T>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });

    return {
        promise,
        isSettled: () => isSettled,
        resolve: value => {
            isSettled = true;
            resolve!(value);
        },
        reject: error => {
            isSettled = true;
            reject!(error);
        },
    };
}
