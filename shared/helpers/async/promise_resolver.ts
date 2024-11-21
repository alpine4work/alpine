export type PromiseResolver<T> = {
    readonly promise: Promise<T>;
    readonly isSettled: () => boolean;
    readonly resolve: (value: T | PromiseLike<T>) => void;
    readonly reject: (error: unknown) => void;
};

/**
 * Sometimes constructing a promise with its immediately invoked constructor
 * function is inconvenient. Using a promise resolver inverts the promise so you
 * can call the resolver functions anywhere.
 */
export function createPromiseResolver<T = void>(): PromiseResolver<T> {
    let isSettled = false;
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (error: unknown) => void;

    const promise = new Promise<T>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });

    return {
        promise,
        isSettled: () => isSettled,
        resolve: value => {
            if (isSettled === true) return;
            isSettled = true;
            resolve!(value);
        },
        reject: error => {
            if (isSettled === true) return;
            isSettled = true;
            reject!(error);
        },
    };
}
