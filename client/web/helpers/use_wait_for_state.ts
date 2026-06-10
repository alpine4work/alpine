import {Memo, useCallback, useEffect, useRef} from "react";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";

/**
 * Creates a function that returns a promise which waits for a condition on some
 * React state value to be met before resolving.
 */
export function useWaitForState<Value>(
    value: Value,
): Memo<(condition: (value: Value) => boolean) => Promise<void>> {
    const valueRef = useRef(value);

    const waitersRef = useRef<Set<{
        condition: (value: Value) => boolean;
        promiseResolver: PromiseResolver<void>;
    }> | null>(null);

    useEffect(() => {
        valueRef.current = value;

        if (waitersRef.current !== null) {
            const waiters = waitersRef.current;

            const deleteWaiters = new Set<{
                condition: (value: Value) => boolean;
                promiseResolver: PromiseResolver<void>;
            }>();

            for (const waiter of waiters) {
                if (waiter.condition(value)) {
                    waiter.promiseResolver.resolve();
                    deleteWaiters.add(waiter);
                }
            }

            for (const waiter of deleteWaiters) {
                waiters.delete(waiter);
            }
        }
    }, [value]);

    const waitForState = useCallback((condition: (value: Value) => boolean): Promise<void> => {
        const promiseResolver = createPromiseResolver();

        if (condition(valueRef.current)) {
            promiseResolver.resolve();
        } else {
            waitersRef.current ??= new Set();
            waitersRef.current.add({condition, promiseResolver});
        }

        return promiseResolver.promise;
    }, []);

    return waitForState;
}
