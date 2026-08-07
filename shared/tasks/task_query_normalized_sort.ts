import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {ObjectSchema, Schema} from "~/shared/schema/schema.open_source.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

/**
 * We use normalized sorts for actually executing query sorting. The normalized
 * sort type also supports some internal sorts we don't allow users to configure in
 * the UI.
 */
export type TaskQueryNormalizedSort =
    | TaskQueryBasicNormalizedSort
    | TaskQueryParentPositionNormalizedSort
    | TaskQueryCollectionPositionNormalizedSort
    | TaskQueryAssigneePositionNormalizedSort;

export const defaultTaskQueryNormalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> = [
    {type: "CreatedTime", direction: "Ascending", missing: "Last"},
];

export type TaskQueryBasicNormalizedSort = {
    readonly type:
        | "DisplayStatus"
        | "Priority"
        | "Layout"
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

const TaskQueryBasicNormalizedSortSchemas: {
    [Key in TaskQueryBasicNormalizedSort["type"]]: ObjectSchema<{
        type: Key;
        direction: "Ascending" | "Descending";
        missing: "First" | "Last";
    }>;
} = {
    DisplayStatus: Schema.object({
        type: Schema.value("DisplayStatus"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    Priority: Schema.object({
        type: Schema.value("Priority"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    Layout: Schema.object({
        type: Schema.value("Layout"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    Assignee: Schema.object({
        type: Schema.value("Assignee"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    Creator: Schema.object({
        type: Schema.value("Creator"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    Assigner: Schema.object({
        type: Schema.value("Assigner"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    DueDate: Schema.object({
        type: Schema.value("DueDate"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    CreatedTime: Schema.object({
        type: Schema.value("CreatedTime"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    AssignedTime: Schema.object({
        type: Schema.value("AssignedTime"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    ClosedTime: Schema.object({
        type: Schema.value("ClosedTime"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
    ActivatedTime: Schema.object({
        type: Schema.value("ActivatedTime"),
        direction: Schema.enum(["Ascending", "Descending"]),
        missing: Schema.enum(["First", "Last"]),
    }),
};

export type TaskQueryParentPositionNormalizedSort = {
    readonly type: "ParentPosition";
    readonly direction: "Ascending" | "Descending";
    readonly missing: "First" | "Last";
};

const TaskQueryParentPositionNormalizedSortSchema = Schema.object({
    type: Schema.value("ParentPosition"),
    direction: Schema.enum(["Ascending", "Descending"]),
    missing: Schema.enum(["First", "Last"]),
});

export type TaskQueryCollectionPositionNormalizedSort = {
    readonly type: "CollectionPosition";
    readonly collectionId: TaskCollectionId;
    readonly direction: "Ascending" | "Descending";
    readonly missing: "Last";
};

const TaskQueryCollectionPositionNormalizedSortSchema = Schema.object({
    type: Schema.value("CollectionPosition"),
    collectionId: Schema.id<TaskCollectionId>(),
    direction: Schema.enum(["Ascending", "Descending"]),
    missing: Schema.value("Last"),
});

export type TaskQueryAssigneePositionNormalizedSort = {
    readonly type: "AssigneePosition";
    readonly direction: "Ascending" | "Descending";
    readonly missing: "First" | "Last";
};

const TaskQueryAssigneePositionNormalizedSortSchema = Schema.object({
    type: Schema.value("AssigneePosition"),
    direction: Schema.enum(["Ascending", "Descending"]),
    missing: Schema.enum(["First", "Last"]),
});

export const TaskQueryNormalizedSortSchema: Schema<TaskQueryNormalizedSort> = Schema.union({
    ...TaskQueryBasicNormalizedSortSchemas,
    ParentPosition: TaskQueryParentPositionNormalizedSortSchema,
    CollectionPosition: TaskQueryCollectionPositionNormalizedSortSchema,
    AssigneePosition: TaskQueryAssigneePositionNormalizedSortSchema,
});

assertAssignableTypes<
    TaskQueryNormalizedSort,
    {readonly direction: "Ascending" | "Descending"; readonly missing: "First" | "Last"}
>();

/**
 * Normalize a list of `TaskQuerySort`s.
 *
 * - Removes duplicates
 * - Adds a `CreatedDate` sort to the end
 *
 * Will also accept an already normalized list of sorts. If sorts are already
 * normalized we should return the same value back.
 */
export function normalizeTaskQuerySorts(
    sorts: ReadonlyArray<TaskQuerySort | TaskQueryNormalizedSort>,
): Array<TaskQueryNormalizedSort> {
    const sortTypes = new Set<TaskQueryNormalizedSort["type"]>();
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

    // If there was no created time sort explicitly included, then add one at the end
    // so we don't end up sorting by the fallback (`TaskId`).
    if (!sortTypes.has("CreatedTime")) {
        normalizedSorts.push({
            type: "CreatedTime",
            direction: "Ascending",
            missing: "Last",
        });
    }

    return normalizedSorts;
}
