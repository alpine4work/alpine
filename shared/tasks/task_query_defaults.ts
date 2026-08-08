import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {TaskQueryFiltersSchema} from "~/shared/tasks/task_query_filters_schema.js";
import {TaskQuerySortsSchema} from "~/shared/tasks/task_query_sorts_schema.js";

/**
 * The default view customizations applied for everyone when they open a task
 * collection without explicit customizations of their own (e.g. filters in the
 * URL).
 *
 * If we add more view customizations in the future (e.g. grouping or a view type
 * like kanban vs grid) their defaults belong in this object too.
 */
export type TaskQueryDefaults = SchemaType<typeof TaskQueryDefaultsSchema>;

export const TaskQueryDefaultsSchema = Schema.object({
    filters: TaskQueryFiltersSchema,
    sorts: TaskQuerySortsSchema,
});

export const emptyTaskQueryDefaults: TaskQueryDefaults = {
    filters: [],
    sorts: [],
};

export type TaskQueryDefaultsRegister = CrdtRegister<TaskQueryDefaults>;

/**
 * A CRDT register for a task collection's defaults.
 *
 * The defaults are one register (instead of one register per customization)
 * because they're always saved together as one coherent view configuration.
 * Merging the filters of one save with the sorts of another could produce a view
 * no one ever chose.
 */
export const TaskQueryDefaultsRegister = createCrdtRegister(TaskQueryDefaultsSchema);
