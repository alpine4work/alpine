import {InternalError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

const isLoadingIndicatorSymbol = Symbol("isLoadingIndicator");

export type LoadingIndicatorLoaderData = {
    readonly [isLoadingIndicatorSymbol]: true;
    readonly promise: PromiseImmediate<unknown>;
};

export function createLoadingIndicatorLoaderData(promise: PromiseImmediate<unknown>) {
    return {[isLoadingIndicatorSymbol]: true, promise};
}

export function isLoadingIndicatorLoaderData(
    loaderData: unknown,
): loaderData is LoadingIndicatorLoaderData {
    return isObject(loaderData) && loaderData[isLoadingIndicatorSymbol] === true;
}

/**
 * If we have loading indicator loader data, this function will unwrap it to
 * the underlying loader data value. If the loading indicator promise is still
 * pending an error will be thrown! You may only unwrap once loading is done.
 */
export function unwrapLoadingIndicatorLoaderData<Value>(loaderData: Value): Value {
    if (!isLoadingIndicatorLoaderData(loaderData)) return loaderData;

    const promiseState = loaderData.promise.getStateWithoutListening();

    switch (promiseState.status) {
        case "pending": {
            throw new InternalError(
                "Can\u2019t unwrap pending loader data, space routes should be wrapped in `<LoadingIndicatorSpaceOutletContainer>`",
            );
        }
        case "rejected": {
            throw promiseState.reason;
        }
        case "fulfilled": {
            return promiseState.value as Value;
        }
        default:
            throw exhaustive(promiseState);
    }
}
