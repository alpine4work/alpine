import {ApiTaskQuerySort} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function intoApiTaskQuerySort(sort: TaskQuerySort): ApiTaskQuerySort {
    switch (sort.type) {
        case "DisplayStatus": {
            return {type: "Status", direction: sort.direction};
        }
        case "Priority": {
            return {type: "Priority", direction: sort.direction};
        }
        case "Layout": {
            return {type: "Layout", missing: sort.missing};
        }
        case "Assignee": {
            return {type: "Assignee", missing: sort.missing};
        }
        case "Creator": {
            return {type: "Creator"};
        }
        case "Assigner": {
            return {type: "Assigner", missing: sort.missing};
        }
        case "DueDate": {
            return {type: "Due", direction: sort.direction};
        }
        case "CreatedTime": {
            return {type: "CreatedTime", direction: sort.direction};
        }
        case "AssignedTime": {
            return {type: "AssignedTime", direction: sort.direction};
        }
        case "ClosedTime": {
            return {type: "ClosedTime", direction: sort.direction};
        }
        case "ActivatedTime": {
            return {type: "ActivatedTime", direction: sort.direction};
        }
        default:
            throw exhaustive(sort);
    }
}

export function fromApiTaskQuerySort(sort: ApiTaskQuerySort): TaskQuerySort {
    switch (sort.type) {
        case "Status": {
            return {type: "DisplayStatus", direction: sort.direction};
        }
        case "Priority": {
            return {type: "Priority", direction: sort.direction};
        }
        case "Layout": {
            return {type: "Layout", missing: sort.missing};
        }
        case "Assignee": {
            return {type: "Assignee", missing: sort.missing};
        }
        case "Creator": {
            return {type: "Creator"};
        }
        case "Assigner": {
            return {type: "Assigner", missing: sort.missing};
        }
        case "Due": {
            return {type: "DueDate", direction: sort.direction};
        }
        case "CreatedTime": {
            return {type: "CreatedTime", direction: sort.direction};
        }
        case "AssignedTime": {
            return {type: "AssignedTime", direction: sort.direction};
        }
        case "ClosedTime": {
            return {type: "ClosedTime", direction: sort.direction};
        }
        case "ActivatedTime": {
            return {type: "ActivatedTime", direction: sort.direction};
        }
        default:
            throw exhaustive(sort);
    }
}
