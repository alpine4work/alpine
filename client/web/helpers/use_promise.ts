import {Memo, useEffect, useMemo, useState} from "react";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseState} from "~/shared/helpers/async/promise_state.js";

const pendingState: PromiseState<never> = {status: "pending"};
const nullState: PromiseState<null> = {status: "fulfilled", value: null};

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
): Memo<{isPending: true; value?: undefined} | {isPending: false; value: Value}>;
export function usePromise<Value>(
    promise: PromiseLike<Value> | null,
): Memo<{isPending: true; value?: undefined} | {isPending: false; value: Value | null}>;
export function usePromise<Value>(
    promise: PromiseLike<Value> | null,
): Memo<{isPending: true; value?: undefined} | {isPending: false; value: Value | null}> {
    const [stateWithPromise, setStateWithPromise] = useState<{
        promise: PromiseLike<Value>;
        state: PromiseState<Value>;
    } | null>(() => {
        if (promise === null) return null;

        if (promise instanceof PromiseImmediate)
            return {promise, state: promise.getStateWithoutListening()};

        return {promise, state: pendingState};
    });

    let state: PromiseState<Value | null> = stateWithPromise?.state ?? nullState;

    if (
        promise === null
            ? stateWithPromise !== null
            : stateWithPromise === null || stateWithPromise.promise !== promise
    ) {
        const newStateWithPromise =
            promise === null
                ? null
                : promise instanceof PromiseImmediate
                ? {promise, state: promise.getStateWithoutListening()}
                : {promise, state: pendingState};

        state = newStateWithPromise?.state ?? nullState;
        setStateWithPromise(newStateWithPromise);
    }

    useEffect(() => {
        // Promise is synchronously available, no effect needed.
        if (
            promise === null ||
            (promise instanceof PromiseImmediate &&
                promise.getStateWithoutListening().status !== "pending")
        ) {
            return;
        }

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

    // Memoize the result so we can use it in dependency arrays.
    return useMemo(() => {
        if (state.status === "rejected") throw state.reason;

        return state.status === "pending"
            ? {isPending: true}
            : {isPending: false, value: state.value};
    }, [state.reason, state.status, state.value]);
}
