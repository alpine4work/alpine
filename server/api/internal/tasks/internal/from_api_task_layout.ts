import {ApiTaskLayout} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";

export function fromApiTaskLayout(layout: ApiTaskLayout | null): TaskLayout | null {
    if (layout === null) return null;

    switch (layout.type) {
        case "Project":
            return "Project";
        default:
            throw exhaustive(layout.type);
    }
}
