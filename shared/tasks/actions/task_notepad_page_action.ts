import {TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";

export type TaskNotepadPageAction = SchemaType<typeof TaskNotepadPageActionSchema>;

/**
 * Creates a new notepad page.
 *
 * Pages can't currently be deleted after they've been created. A user should
 * keep around all old pages. If the list is starting to get long, consider a
 * better UI.
 *
 * Actions on a page can not be processed until a create event is fired.
 */
export type TaskNotepadPageCreateAction = SchemaType<typeof TaskNotepadPageCreateActionSchema>;

const TaskNotepadPageCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
});

/**
 * Sets a task's position in this notepad page.
 *
 * If the task does not already exist in the page then we add the task to the
 * page. If the task does exist in the page then it's moved.
 */
export type TaskNotepadPageAddTaskAction = SchemaType<typeof TaskNotepadPageAddTaskActionSchema>;

const TaskNotepadPageAddTaskActionSchema = Schema.object({
    type: Schema.value("AddTask"),
    taskId: Schema.id<TaskId>(),
    position: TaskPositionSchema,
});

/**
 * Remove's a task from the notepad page.
 *
 * Does not delete the underlying task. Only removes it from this notepad page.
 */
export type TaskNotepadPageRemoveTaskAction = SchemaType<
    typeof TaskNotepadPageRemoveTaskActionSchema
>;

const TaskNotepadPageRemoveTaskActionSchema = Schema.object({
    type: Schema.value("RemoveTask"),
    taskId: Schema.id<TaskId>(),
});

export const TaskNotepadPageActionSchema = Schema.union({
    Create: TaskNotepadPageCreateActionSchema,
    AddTask: TaskNotepadPageAddTaskActionSchema,
    RemoveTask: TaskNotepadPageRemoveTaskActionSchema,
});
