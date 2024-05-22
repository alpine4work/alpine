import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
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
