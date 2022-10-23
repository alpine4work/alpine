import {scheduleException} from "~/shared/helpers/async/schedule-exception";

/**
 * Runs an async function without awaiting for the result.
 *
 * Handles any uncaught exceptions. Generally prefer this over `void`ing a
 * promise.
 */
export function runAsyncWithoutAwaiting(action: () => Promise<void>): void {
    action().catch(scheduleException);
}
