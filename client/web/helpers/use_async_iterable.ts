import {Memo, useEffect, useRef} from "react";
import {CancelledError} from "~/shared/error/error.open_source.js";

/**
 * Consume items produced by an async iterable in a React component.
 *
 * `iterable` should be memoized since whenever it changes we re-execute the
 * iterable. Also use the `AbortSignal` when creating an `AsyncIterable` so the
 * iterable can be cancelled when the component unmounts or props change.
 *
 * `next` and `error` don't needed to be memo'd.
 */
export function useAsyncIterable<Value>({
    iterable: createIterable,
    next,
    error,
}: {
    iterable: Memo<({signal}: {signal: AbortSignal}) => AsyncIterable<Value>>;
    next: (value: Value) => void;
    error: (error: unknown) => void;
}) {
    const listenersRef = useRef({next, error});
    useEffect(() => {
        listenersRef.current = {next, error};
    });

    useEffect(() => {
        const abortController = new AbortController();

        const iterable = createIterable({signal: abortController.signal});
        const iterator = iterable[Symbol.asyncIterator]();

        let isCancelled = false;
        const cancelError = new CancelledError("Unsubscribed from async iterable");

        const loop = () => {
            if (isCancelled) return;

            iterator.next().then(
                result => {
                    if (isCancelled || result.done) return;

                    // Call our listener. The listener is in a ref so our effect does not need a
                    // dependency on the listener function.
                    listenersRef.current.next(result.value);

                    loop();
                },
                error => {
                    // If this is the error from our `AbortSignal` then we can ignore it since it's
                    // expected.
                    if (error === cancelError) return;

                    listenersRef.current.error(error);
                },
            );
        };

        loop();

        return () => {
            isCancelled = true;
            abortController.abort(cancelError);
            iterator.return?.().catch(error => listenersRef.current.error(error));
        };
    }, [createIterable]);
}
