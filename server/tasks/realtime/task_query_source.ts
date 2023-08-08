import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";

// NOCOMMIT: Do I need this?

/**
 * The task query source determines the base set of available tasks and their
 * default sort order. Filters are applied on top of the source and sorts
 * override any default sort.
 *
 * You can think of this as the source in a SQL query like this:
 *
 * ```
 * SELECT * FROM source WHERE filters ORDER BY sorts
 * ```
 *
 * The `WHERE` clause narrows the rows in `source` down further. If no
 * `ORDER BY` clause is included then the row order comes from `source`. In
 * many SQL implementations if `source` is a plain table reference the order is
 * not defined but if `source` is more complicated, like a sub-query or a [set
 * returning function][1] (e.g. `SELECT * FROM generate_series(2, 4)`), then
 * there is some order to the source.
 *
 * [1]: https://www.postgresql.org/docs/current/functions-srf.html
 */
export type TaskQuerySource =
    | TaskQueryActiveAssigneeStatusSource
    | TaskQueryNotepadPageSource
    | TaskQueryCollectionSource;

/**
 * The tasks with an `Active` `TaskAssigneeStatus` assigned to the current
 * account in our evaluation context. Ordered by `TaskPosition` which the
 * assignee controls.
 */
export type TaskQueryActiveAssigneeStatusSource = {
    readonly type: "ActiveAssigneeStatus";
};

/**
 * The tasks in an account's notepad page with the provided
 * `TaskNotepadPageId`. Ordered by the `TaskPosition` in the notepad page.
 */
export type TaskQueryNotepadPageSource = {
    readonly type: "NotepadPage";
    readonly notepadPageId: TaskNotepadPageId;
};

/**
 * The tasks in a collection. Ordered by the `TaskPosition` in the collection.
 */
export type TaskQueryCollectionSource = {
    readonly type: "Collection";
    readonly collectionId: TaskCollectionId;
};
