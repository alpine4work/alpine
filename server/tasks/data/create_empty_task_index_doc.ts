import {
    TaskIndexDoc,
    TaskPositionByAccountIdAndNotepadPageId,
    TaskPositionByCollectionIdMap,
} from "~/server/tasks/data/task_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {
    TaskCreateAction,
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskStatusRegister} from "~/shared/tasks/task_status.js";
import {emptyTaskTitle} from "~/shared/tasks/task_title.js";

export function createEmptyTaskIndexDoc(
    actionTime: HybridLogicalTime,
    action: TaskCreateAction,
): Omit<TaskIndexDoc, "id" | "spaceId"> {
    return {
        creator: action.creator,
        createdTime: new TaskFilterableTime({
            absoluteTime: actionTime,
            setterTimeZone: action.creatorTimeZone,
        }),
        rawDeletedTime: null,
        rawUndeletedTime: null,
        parent: {
            taskId: new TaskParentTaskIdRegister(null, actionTime),
            position: new TaskPositionRegister(
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
        notepadPages: {
            raw: {
                positionById: TaskPositionByAccountIdAndNotepadPageId.empty,
            },
        },
        status: new TaskStatusRegister({type: "Open"}, actionTime),
        assignee: new TaskAssigneeRegister(null, actionTime),
        rawAssigneeStatus: new TaskAssigneeStatusRegister({type: "Inactive"}, actionTime),
        title: {raw: emptyTaskTitle.get()},
        dueDate: new TaskDueDateRegister(null, actionTime),
        priority: new TaskPriorityRegister(null, actionTime),
    };
}
