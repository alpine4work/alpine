import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TaskCollectionCreateAction} from "~/shared/tasks/actions/task_collection_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";

export function createEmptyTaskCollectionIndexDoc(
    actionTime: HybridLogicalTime,
    action: TaskCollectionCreateAction,
): Omit<TaskCollectionIndexDoc, "id" | "spaceId"> {
    return {
        createdTime: actionTime,
        creatorId: action.creatorId,
        rawDeletedTime: null,
        rawUndeletedTime: null,
        name: new LabelStringRegister(action.name, actionTime),
        color: new TaskCollectionColorRegister(null, actionTime),
        accessPolicy: new TaskCollectionAccessPolicyRegister(action.accessPolicy, actionTime),
    };
}
