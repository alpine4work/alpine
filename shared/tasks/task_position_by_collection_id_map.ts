import {createCrdtMap} from "~/shared/crdt/crdt_map.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";

export const TaskPositionByCollectionIdMap = createCrdtMap(
    Schema.id<TaskCollectionId>(),
    TaskPositionSchema,
);
