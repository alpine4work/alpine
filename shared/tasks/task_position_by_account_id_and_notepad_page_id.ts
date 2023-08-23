import {CrdtMap, createCrdtMap} from "~/shared/crdt/crdt_map.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskPosition, TaskPositionSchema} from "~/shared/tasks/task_position.js";

export type TaskAccountIdAndNotepadPageId = `${AccountId}-${TaskNotepadPageId}`;

export const TaskAccountIdAndNotepadPageIdSchema =
    Schema.string as Schema<any> as Schema<TaskAccountIdAndNotepadPageId>;

export const TaskPositionByAccountIdAndNotepadPageIdMap = createCrdtMap(
    TaskAccountIdAndNotepadPageIdSchema,
    TaskPositionSchema,
);

export type TaskPositionByAccountIdAndNotepadPageIdMap = CrdtMap<
    TaskAccountIdAndNotepadPageId,
    TaskPosition
>;
