import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

export function intoApiTaskStatus(
    taskDisplayStatus: TaskDisplayStatus,
): {type: "Open"; isActive: boolean} | {type: "Closed"} {
    switch (taskDisplayStatus) {
        case "OpenInactive":
            return {type: "Open", isActive: false};
        case "OpenActive":
            return {type: "Open", isActive: true};
        case "Closed":
            return {type: "Closed"};
        default:
            throw exhaustive(taskDisplayStatus);
    }
}
