import {ApiTaskLayout} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";

export function intoApiTaskLayout(layout: TaskLayout | null): ApiTaskLayout | undefined {
    switch (layout) {
        case "Project":
            return {type: "Project"};
        case null:
            return undefined;
    }
}
