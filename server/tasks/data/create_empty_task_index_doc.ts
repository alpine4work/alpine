import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    TaskCreateAction,
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {emptyTaskTitle} from "~/shared/tasks/title/task_title.js";

export function createEmptyTaskIndexDoc(
    actionTime: HybridLogicalTime,
    action: TaskCreateAction,
): Omit<TaskIndexDoc, "id" | "spaceId" | "creator"> & {
    creator: {accountId: AccountId; from: TaskIndexDoc["creator"]["from"]};
} {
    return {
        creator: {accountId: action.creator.accountId, from: action.creator.from},
        createdTime: new TaskFilterableTime({
            absoluteTime: actionTime,
            setterTimeZone: action.creatorTimeZone,
        }),
        rawDeletedTime: null,
        rawUndeletedTime: null,
        parent: {
            taskId: new TaskParentTaskIdRegister(null, actionTime),
            rawPosition: new TaskPositionRegister(
                {orderTime: actionTime, orderKey: initialOrderKey},
                actionTime,
            ),
        },
        addedChildTaskCount: 0,
        removedChildTaskCount: 0,
        addedClosedChildTaskCount: 0,
        removedClosedChildTaskCount: 0,
        collections: {
            raw: {
                collections: TaskCollectionSet.empty,
                positionById: TaskPositionByCollectionIdMap.empty,
            },
        },
        // Tasks created without an access policy default to null for historic reasons.
        // When we added `accessPolicy` to tasks all existing task index docs defaulted
        // their `accessPolicy` to null. So the behavior of a task without an access policy
        // action is as if the `accessPolicy` never existed in the first place.
        accessPolicy: action.accessPolicy
            ? new AccessPolicyRegister(action.accessPolicy, actionTime)
            : null,
        status: new TaskStatusWithSortableAccountRegister({type: "Open"}, actionTime),
        assignee: new TaskAssigneeWithSortableAccountRegister(null, actionTime),
        rawAssigneeStatus: new TaskAssigneeStatusRegister({type: "Inactive"}, actionTime),
        rawAssigneePosition: new TaskAssigneePositionRegister(null, actionTime),
        title: {raw: emptyTaskTitle.get()},
        dueDate: new TaskDueDateRegister(null, actionTime),
        priority: new TaskPriorityRegister(null, actionTime),
        layout: null,
    };
}
