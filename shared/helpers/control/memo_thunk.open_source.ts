import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";

/**
 * Memorizes the result of a thunk so it only runs once. All repeated calls will
 * return the same value.
 *
 * If the `thunk()` throws then we throw the exact same error every subsequent
 * call.
 */
export function memoThunk<Value>(thunk: () => Value): () => Value {
    let result: Result<Value> | undefined;
    return () => {
        result ??= captureResult(thunk);
        return unwrapResult(result);
    };
}
