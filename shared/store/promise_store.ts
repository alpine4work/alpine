import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseState, pendingPromiseState} from "~/shared/helpers/async/promise_state.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * Create a store which updates with a promise's state. Starts as pending when the
 * promise has resolved and transitions to fulfilled or rejected. After
 * transitioning to fulfilled or rejected the store will never change again.
 */
export function createPromiseStore<Value>(promise: PromiseLike<Value>): Store<PromiseState<Value>> {
    const initialState =
        promise instanceof PromiseImmediate
            ? promise.getStateWithoutListening()
            : pendingPromiseState;

    const store = new ValueStore(initialState);

    if (initialState.status === "pending") {
        promise.then(
            value => store.finalSet({status: "fulfilled", value}),
            reason => store.finalSet({status: "rejected", reason}),
        );
    }

    return store;
}
