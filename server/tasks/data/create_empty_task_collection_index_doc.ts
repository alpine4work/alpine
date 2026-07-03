import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {
    TaskCollectionCreateAction,
    getTaskCollectionCreateActionCreator,
} from "~/shared/tasks/actions/task_collection_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {
    TaskQueryDefaultsRegister,
    emptyTaskQueryDefaults,
} from "~/shared/tasks/task_query_defaults.js";

export function createEmptyTaskCollectionIndexDoc(
    actionTime: HybridLogicalTime,
    action: TaskCollectionCreateAction,
): Omit<TaskCollectionIndexDoc, "id" | "spaceId"> {
    const creator = getTaskCollectionCreateActionCreator(action);
    return {
        createdTime: actionTime,
        creatorId: creator?.accountId ?? null,
        creatorFrom: creator?.from ?? null,
        rawDeletedTime: null,
        rawUndeletedTime: null,
        name: new LabelStringRegister(action.name, actionTime),
        color: new TaskCollectionColorRegister(null, actionTime),
        accessPolicy: new AccessPolicyRegister(action.accessPolicy, actionTime),
        defaults: new TaskQueryDefaultsRegister(emptyTaskQueryDefaults, actionTime),
    };
}
