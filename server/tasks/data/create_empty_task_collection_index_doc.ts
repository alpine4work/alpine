import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TaskCollectionCreateAction} from "~/shared/tasks/actions/task_collection_action.js";
import {LabelStringSchemaRegister} from "~/shared/tasks/label_string_schema_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";

export function createEmptyTaskCollectionIndexDoc(
    actionTime: HybridLogicalTime,
    action: TaskCollectionCreateAction,
): Omit<TaskCollectionIndexDoc, "id" | "spaceId"> {
    return {
        createdTime: actionTime,
        rawDeletedTime: null,
        rawUndeletedTime: null,
        name: new LabelStringSchemaRegister(action.name, actionTime),
        accessPolicy: new TaskCollectionAccessPolicyRegister(action.accessPolicy, actionTime),
    };
}
