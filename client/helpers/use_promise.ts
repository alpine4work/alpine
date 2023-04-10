import {useEffect, useMemo, useState} from "react";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {PromiseState} from "~/shared/helpers/async/promise_state";

/**
 * Use the value of a promise in a React component. If the promise fails we
 * throw an error to the nearest error boundary. If the promise succeeds then
 * we return the value.
 *
 * Has special support for `PromiseImmediate`. If your promise is immediately
 * resolved then we don't need to render a pending state.
 */
export function usePromise<Value>(
    promise: PromiseLike<Value>,
): {isPending: true; value?: undefined} | {isPending: false; value: Value} {
    const [stateWithPromise, setStateWithPromise] = useState<{
        promise: PromiseLike<Value>;
        state: PromiseState<Value>;
    }>(() => {
        if (promise instanceof PromiseImmediate)
            return {promise, state: promise.getStateWithoutListening()};

        return {promise, state: {status: "pending"}};
    });

    useEffect(() => {
        setStateWithPromise(state => {
            if (state.promise === promise) return state;

            if (promise instanceof PromiseImmediate)
                return {promise, state: promise.getStateWithoutListening()};

            return {promise, state: {status: "pending"}};
        });

        let isCancelled = false;

        promise.then(
            value => {
                if (isCancelled) return;
                setStateWithPromise({promise, state: {status: "fulfilled", value}});
            },
            reason => {
                if (isCancelled) return;
                setStateWithPromise({promise, state: {status: "rejected", reason}});
            },
        );

        return () => {
            isCancelled = true;
        };
    }, [promise]);

    const state: PromiseState<Value> =
        stateWithPromise.promise === promise
            ? stateWithPromise.state
            : promise instanceof PromiseImmediate
            ? promise.getStateWithoutListening()
            : {status: "pending"};

    // Memoize the result so we can use it in dependency arrays.
    return useMemo(() => {
        if (state.status === "rejected") throw state.reason;

        return state.status === "pending"
            ? {isPending: true}
            : {isPending: false, value: state.value};
    }, [state.reason, state.status, state.value]);
}
