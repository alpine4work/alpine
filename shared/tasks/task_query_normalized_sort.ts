import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

/**
 * We use normalized sorts for actually executing query sorting. The normalized
 * sort type also supports some internal sorts we don't allow users to
 * configure in the UI.
 */
export type TaskQueryNormalizedSort =
    | TaskQueryBasicNormalizedSort
    | TaskQueryCollectionPositionNormalizedSort
    | TaskQueryNotepadPagePositionNormalizedSort
    | TaskQueryAssigneeStatusActivePositionNormalizedSort;

export type TaskQueryBasicNormalizedSort = {
    readonly type:
        | "DisplayStatus"
        | "Priority"
        | "Assignee"
        | "Creator"
        | "Assigner"
        | "DueDate"
        | "CreatedTime"
        | "AssignedTime"
        | "ClosedTime"
        | "ActivatedTime";
    readonly direction: "Ascending" | "Descending";
    readonly missing: "First" | "Last";
};

export type TaskQueryCollectionPositionNormalizedSort = {
    readonly type: "CollectionPosition";
    readonly collectionId: TaskCollectionId;
    readonly direction: "Ascending" | "Descending";
    readonly missing: "Last";
};

export type TaskQueryNotepadPagePositionNormalizedSort = {
    readonly type: "NotepadPagePosition";
    readonly accountId: AccountId;
    readonly notepadPageId: TaskNotepadPageId;
    readonly direction: "Ascending" | "Descending";
    readonly missing: "Last";
};

export type TaskQueryAssigneeStatusActivePositionNormalizedSort = {
    readonly type: "AssigneeStatusActivePosition";
    readonly direction: "Ascending" | "Descending";
    readonly missing: "Last";
};

assertAssignableTypes<
    TaskQueryNormalizedSort,
    {readonly direction: "Ascending" | "Descending"; readonly missing: "First" | "Last"}
>();

/**
 * Normalize a list of `TaskQuerySort`s.
 *
 * - Removes duplicates
 * - Adds a `CreatedDate` sort to the end
 */
export function normalizeTaskQuerySorts(
    sorts: ReadonlyArray<TaskQuerySort>,
): Array<TaskQueryNormalizedSort> {
    const sortTypes = new Set<TaskQueryBasicNormalizedSort["type"]>();
    const normalizedSorts: Array<TaskQueryNormalizedSort> = [];

    for (const sort of sorts) {
        // Only allow one of each sort type. Repeated sort types are redundant.
        if (sortTypes.has(sort.type)) continue;
        sortTypes.add(sort.type);

        normalizedSorts.push({
            direction: "Ascending",
            missing: "Last",
            ...sort,
        });
    }

    // If there was no created time sort explicitly included, then add one at the
    // end so we don't end up sorting by the fallback (`TaskId`).
    if (!sortTypes.has("CreatedTime")) {
        normalizedSorts.push({
            type: "CreatedTime",
            direction: "Ascending",
            missing: "Last",
        });
    }

    return normalizedSorts;
}
