import createTree, {Tree} from "functional-red-black-tree";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";

export class TaskQueryModel {
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;

    private readonly _tree: Tree<TaskQuerySortCursor, null>;

    private constructor({
        filters,
        sorts,
        tree,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        tree: Tree<TaskQuerySortCursor, null>;
    }) {
        this.filters = filters;
        this.sorts = sorts;
        this._tree = tree;
    }

    public static new({
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {
        return new TaskQueryModel({
            filters,
            sorts,
            tree: createTree((cursor1, cursor2) =>
                compareTaskQuerySortCursors(sorts, cursor1, cursor2),
            ),
        });
    }
}
