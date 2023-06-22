import {TaskPriority} from "~/client/tasks/demo_2/local_tasks_state";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

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
