import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint.js";
import {TaskId} from "~/shared/id/types/id_types.js";

let indiscriminatelyDisableAllTaskGridViewAnimations = 0;
const disableTaskGridViewAnimationsForTaskIds = new Map<TaskId, number>();

export function isDisablingTaskGridViewAnimationsForTaskId(taskId: TaskId) {
    return disableTaskGridViewAnimationsForTaskIds.has(taskId);
}

/**
 * Disable animations on the provided `TaskId` until the next browser paint. This
 * only works if you have (or will have) an immediate React render queued up before
 * the next paint.
 */
export function disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId: TaskId) {
    disableTaskGridViewAnimationsForTaskIds.set(
        taskId,
        (disableTaskGridViewAnimationsForTaskIds.get(taskId) ?? 0) + 1,
    );

    scheduleAfterNextBrowserPaint(() => {
        const count = (disableTaskGridViewAnimationsForTaskIds.get(taskId) ?? 0) - 1;
        if (count > 0) {
            disableTaskGridViewAnimationsForTaskIds.set(taskId, count);
        } else {
            disableTaskGridViewAnimationsForTaskIds.delete(taskId);
        }
    });
}

export function isIndiscriminatelyDisablingAllTaskGridViewAnimations() {
    return indiscriminatelyDisableAllTaskGridViewAnimations > 0;
}

/**
 * Disable all animations in task grid views until the next browser paint. This
 * only works if you have (or will have) an immediate React render queued up before
 * the next paint.
 *
 * Since this disables ALL animations, generally prefer using
 * `disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint()` to target
 * specific tasks.
 */
export function indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint() {
    indiscriminatelyDisableAllTaskGridViewAnimations++;
    scheduleAfterNextBrowserPaint(() => {
        indiscriminatelyDisableAllTaskGridViewAnimations--;
    });
}
