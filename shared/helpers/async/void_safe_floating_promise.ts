import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";

/**
 * Promise that resolves to undefined that's a valid `SafeFloatingPromise<void>`
 * you can use without writing an unsafe cast.
 */
export const voidSafeFloatingPromise = Promise.resolve() as SafeFloatingPromise<void>;
