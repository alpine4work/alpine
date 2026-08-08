import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

export function getTaskPriorityName(priority: TaskPriority | "Null" | null): string {
    switch (priority) {
        case null:
        case "Null":
            return "None";
        case "Low":
            return "Low";
        case "Medium":
            return "Medium";
        case "High":
            return "High";
        case "Urgent":
            return "Urgent";
        default:
            throw exhaustive(priority);
    }
}
