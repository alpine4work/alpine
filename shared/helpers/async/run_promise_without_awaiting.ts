import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

/**
 * Runs an async function without awaiting for the result.
 *
 * Handles any uncaught exceptions. Generally prefer this over `void`ing a promise.
 */
export function runPromiseWithoutAwaiting(
    action: Promise<unknown> | (() => Promise<unknown>),
): void {
    (typeof action === "function" ? action() : action).catch(scheduleUncaughtError);
}
