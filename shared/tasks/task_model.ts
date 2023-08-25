import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByAccountIdAndNotepadPageIdMap} from "~/shared/tasks/task_position_by_account_id_and_notepad_page_id.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusRegister} from "~/shared/tasks/task_status.js";
import {TaskTitleSchema} from "~/shared/tasks/task_title.js";

export type TaskModelData = SchemaType<typeof TaskModelDataSchema>;

const TaskModelDataSchema = Schema.object({
    id: Schema.id<TaskId>(),
    spaceId: Schema.id<SpaceId>(),

    creator: TaskSortableAccount.schema,
    createdTime: TaskFilterableTime.schema,
    deletedTime: HybridLogicalTimeSchema.nullable(),
    undeletedTime: HybridLogicalTimeSchema.nullable(),

    parent: Schema.object({
        taskId: TaskParentTaskIdRegister.schema,
        position: TaskPositionRegister.schema,
    }),

    // See the documentation on `TaskUpdateChildrenCountsAction` for what these
    // fields are. They are CRDTs that allow us to figure out the task's
    // `childTaskCount` and `childClosedTaskCount`.
    addedChildTaskCount: Schema.integer,
    removedChildTaskCount: Schema.integer,
    addedClosedChildTaskCount: Schema.integer,
    removedClosedChildTaskCount: Schema.integer,

    collections: TaskCollectionSet.schema,
    positionByCollectionId: TaskPositionByCollectionIdMap.schema,

    // We only include the positions for notepad pages owned by the account actor.
    // Other positions we filter out on the server.
    positionByAccountIdAndNotepadPageId: TaskPositionByAccountIdAndNotepadPageIdMap.schema,

    status: TaskStatusRegister.schema,
    assignee: TaskAssigneeRegister.schema,
    assigneeStatus: TaskAssigneeStatusRegister.schema,

    title: TaskTitleSchema,
    dueDate: TaskDueDateRegister.schema,
    priority: TaskPriorityRegister.schema,
});

// NOCOMMIT: Documentation!

// Doesn't use the `Model` class since `rawData` contains many "raw" properties
// we want to provide clean accessors for. Like `getAssigneeStatus()` returning
// null when the task is closed.
export class TaskModel {
    public static readonly schema = TaskModelDataSchema.transform<TaskModel>({
        serialize: task => task.rawData,
        deserialize: rawData => new TaskModel(rawData),
    });

    public readonly id: TaskId;
    public readonly rawData: TaskModelData;

    constructor(rawData: TaskModelData) {
        this.id = rawData.id;
        this.rawData = rawData;
    }
}
