import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionActionSchema} from "~/shared/tasks/actions/task_collection_action.js";

export type TaskSpaceAction = SchemaType<typeof TaskSpaceActionSchema>;

export type TaskSpaceUpdateTaskAction = SchemaType<typeof TaskSpaceUpdateTaskActionSchema>;

const TaskSpaceUpdateTaskActionSchema = Schema.object({
    type: Schema.value("UpdateTask"),
    taskId: Schema.id<TaskId>(),
    taskAction: TaskActionSchema,
});

export type TaskSpaceUpdateTaskCollectionAction = SchemaType<
    typeof TaskSpaceUpdateTaskCollectionSchema
>;

const TaskSpaceUpdateTaskCollectionSchema = Schema.object({
    type: Schema.value("UpdateTaskCollection"),
    collectionId: Schema.id<TaskCollectionId>(),
    collectionAction: TaskCollectionActionSchema,
});

export const TaskSpaceActionSchema = Schema.union({
    UpdateTask: TaskSpaceUpdateTaskActionSchema,
    UpdateTaskCollection: TaskSpaceUpdateTaskCollectionSchema,
});
