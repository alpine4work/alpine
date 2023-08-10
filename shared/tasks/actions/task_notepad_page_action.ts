import {Schema, SchemaType} from "~/shared/schema/schema.js";

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

export const TaskNotepadPageActionSchema = Schema.union({
    Create: TaskNotepadPageCreateActionSchema,
});
