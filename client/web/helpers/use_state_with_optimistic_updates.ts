import {Memo, useCallback, useEffect, useReducer} from "react";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

/**
 * React state which may be updated optimistically while waiting on some data
 * to save. If we fail to save the data, the optimistic update reverts.
 *
 * Used like this:
 *
 * ```ts
 * const [value, updateValue, updateValueOptimistically] =
 *     useStateWithOptimisticUpdates(initialValue);
 * ```
 *
 * `updateValue()` updates the value immediately. If there are any pending
 * optimistic updates then `updateValue()` will be applied to the value without
 * any optimistic changes and optimistic updates will be re-applied after to
 * produce the final value.
 *
 * `updateValueOptimistically()` updates the value immediately but keeps track
 * of the `promise` you provide. The update will not be fully applied until
 * after the `promise` resolves. If the `promise` rejects then we remove the
 * optimistic update from the value and revert the value back to its original
 * form.
 *
 * The way this hook works is optimistic updates are kept in a queue. We keep
 * track of the value without any optimistic updates and the value with
 * optimistic updates. To revert an optimistic update, we remove it from our
 * queue and re-apply all remaining optimistic updates to the value without any
 * optimistic updates applied. The end result is a value without the optimistic
 * update.
 *
 * This hook is built on top of a `useReducer()`. If you want to use this logic
 * as part of a more complex reducer then we export all the individual parts.
 * e.g. `reduceStateWithOptimisticUpdates()`.
 */
export function useStateWithOptimisticUpdates<Value>(
    initialValue: MaybeThunk<Value>,
): [
    value: Value,
    updateValue: Memo<(update: (value: Value) => Value) => void>,
    updateValueOptimistically: Memo<
        <PromiseValue>(
            promise: Promise<PromiseValue>,
            update: (value: Value, promiseValue: PromiseValue | undefined) => Value,
        ) => void
    >,
    valueWithoutOptimisticUpdates: Value,
] {
    const [state, dispatch] = useReducer<
        (
            state: StateWithOptimisticUpdates<Value>,
            action: ActionForStateWithOptimisticUpdates<Value>,
        ) => StateWithOptimisticUpdates<Value>,
        MaybeThunk<Value>
    >(reduceStateWithOptimisticUpdates, initialValue, getInitialStateWithOptimisticUpdates);

    useStateWithOptimisticUpdatesMonitor(state, dispatch);

    return [
        state.value,
        useCallback(update => {
            dispatch({type: "Update", update});
        }, []),
        useCallback((promise, update) => {
            dispatch({type: "OptimisticUpdate", promise, update: update as any});
        }, []),
        state.valueWithoutOptimisticUpdates,
    ];
}

export type StateWithOptimisticUpdates<Value> = {
    readonly value: Value;
    readonly valueWithoutOptimisticUpdates: Value;
    readonly optimisticUpdates: ReadonlyArray<{
        readonly promise: Promise<unknown>;
        readonly update: (value: Value, promiseValue: unknown) => Value;
    }>;
};

export type ActionForStateWithOptimisticUpdates<Value> =
    | {
          readonly type: "Update";
          readonly update: (value: Value) => Value;
      }
    | {
          readonly type: "OptimisticUpdate";
          readonly promise: Promise<unknown>;
          readonly update: (value: Value, promiseValue: unknown) => Value;
      }
    | {
          readonly type: "ResolveOptimisticUpdate";
          readonly promise: Promise<unknown>;
          readonly promiseValue: unknown;
      }
    | {
          readonly type: "RejectOptimisticUpdate";
          readonly promise: Promise<unknown>;
      };

export function getInitialStateWithOptimisticUpdates<Value>(
    initialValue: MaybeThunk<Value>,
): StateWithOptimisticUpdates<Value> {
    const value =
        typeof initialValue === "function" ? (initialValue as () => Value)() : initialValue;

    return {
        value,
        valueWithoutOptimisticUpdates: value,
        optimisticUpdates: [],
    };
}

export function reduceStateWithOptimisticUpdates<Value>(
    state: StateWithOptimisticUpdates<Value>,
    action: ActionForStateWithOptimisticUpdates<Value>,
): StateWithOptimisticUpdates<Value> {
    switch (action.type) {
        case "Update": {
            const newValueWithoutOptimisticUpdates = action.update(
                state.valueWithoutOptimisticUpdates,
            );

            const newValue = state.optimisticUpdates.reduce(
                (value, {update}) => update(value, undefined),
                newValueWithoutOptimisticUpdates,
            );

            return {
                value: newValue,
                valueWithoutOptimisticUpdates: newValueWithoutOptimisticUpdates,
                optimisticUpdates: state.optimisticUpdates,
            };
        }
        case "OptimisticUpdate": {
            const newOptimisticUpdates = [
                ...state.optimisticUpdates,
                {
                    promise: action.promise,
                    update: action.update,
                },
            ];

            const newValue = action.update(state.value, undefined);

            return {
                value: newValue,
                valueWithoutOptimisticUpdates: state.valueWithoutOptimisticUpdates,
                optimisticUpdates: newOptimisticUpdates,
            };
        }
        case "ResolveOptimisticUpdate": {
            const resolvedOptimisticUpdates = [];
            const pendingOptimisticUpdates = [];

            for (const optimisticUpdate of state.optimisticUpdates) {
                if (optimisticUpdate.promise !== action.promise) {
                    pendingOptimisticUpdates.push(optimisticUpdate);
                } else {
                    resolvedOptimisticUpdates.push(optimisticUpdate);
                }
            }

            // Optimization: If no promises resolved, don't change state.
            if (pendingOptimisticUpdates.length === state.optimisticUpdates.length) return state;

            // Permanently apply optimistic update...
            const newValueWithoutOptimisticUpdates = resolvedOptimisticUpdates.reduce(
                (value, {update}) => update(value, action.promiseValue),
                state.valueWithoutOptimisticUpdates,
            );

            const newValue = pendingOptimisticUpdates.reduce(
                (value, {update}) => update(value, undefined),
                newValueWithoutOptimisticUpdates,
            );

            return {
                value: newValue,
                valueWithoutOptimisticUpdates: newValueWithoutOptimisticUpdates,
                optimisticUpdates: pendingOptimisticUpdates,
            };
        }
        case "RejectOptimisticUpdate": {
            const pendingOptimisticUpdates = [];

            for (const optimisticUpdate of state.optimisticUpdates) {
                if (optimisticUpdate.promise !== action.promise) {
                    pendingOptimisticUpdates.push(optimisticUpdate);
                }
            }

            // Optimization: If no promises rejected, don't change state.
            if (pendingOptimisticUpdates.length === state.optimisticUpdates.length) return state;

            const newValue = pendingOptimisticUpdates.reduce(
                (value, {update}) => update(value, undefined),
                state.valueWithoutOptimisticUpdates,
            );

            return {
                value: newValue,
                valueWithoutOptimisticUpdates: state.valueWithoutOptimisticUpdates,
                optimisticUpdates: pendingOptimisticUpdates,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function useStateWithOptimisticUpdatesMonitor<Value>(
    state: StateWithOptimisticUpdates<Value>,
    dispatch: Memo<(action: ActionForStateWithOptimisticUpdates<Value>) => void>,
) {
    useEffect(() => {
        let isCancelled = false;

        for (const {promise} of state.optimisticUpdates) {
            promise.then(
                promiseValue => {
                    if (isCancelled) return;

                    dispatch({
                        type: "ResolveOptimisticUpdate",
                        promise,
                        promiseValue,
                    });
                },
                () => {
                    if (isCancelled) return;

                    dispatch({
                        type: "RejectOptimisticUpdate",
                        promise,
                    });
                },
            );
        }

        return () => {
            isCancelled = true;
        };
    }, [dispatch, state.optimisticUpdates]);
}
