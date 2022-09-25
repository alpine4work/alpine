export type PromiseResolver<T> = {
    readonly promise: Promise<T>;
    isSettled(): boolean;
    resolve(value: T): void;
    reject(error: unknown): void;
};

/**
 * Sometimes constructing a promise with its immediately invoked constructor
 * function is inconvenient. Using a promise resolver inverts the promise so you
 * can call the resolver functions anywhere.
 */
export function createPromiseResolver<
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    T = void,
>(): PromiseResolver<T> {
    let isSettled = false;
    let resolve: (value: T) => void;
    let reject: (error: unknown) => void;

    const promise = new Promise<T>((_resolve, _reject) => {
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
