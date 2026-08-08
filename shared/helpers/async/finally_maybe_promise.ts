import {isPromiseLike} from "~/shared/helpers/async/is_promise_like.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";

/**
 * Run some `action` after the promise completes if `promise` is a promise. If
 * `promise` isn't a promise then we run the action immediately.
 */
export function finallyMaybePromise<Value>(
    promise: MaybePromise<Value>,
    action: () => void,
): MaybePromise<Value> {
    if (!isPromiseLike(promise)) {
        action();
        return promise;
    } else {
        return promise.finally(action);
    }
}
