import {
    getTaskQueryManuallySortedDirection,
    isTaskQueryManuallySorted,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

describe("getTaskQueryManuallySortedDirection", () => {
    test("returns null for empty sorts array", () => {
        expect(getTaskQueryManuallySortedDirection([])).toBe(null);
    });

    test("returns Ascending for ParentPosition sort with Ascending direction", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Ascending");
    });

    test("returns Descending for ParentPosition sort with Descending direction", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "ParentPosition", direction: "Descending", missing: "First"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Descending");
    });

    test("returns Ascending for CollectionPosition sort with Ascending direction", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {
                type: "CollectionPosition",
                collectionId: generateId<TaskCollectionId>(),
                direction: "Ascending",
                missing: "Last",
            },
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Ascending");
    });

    test("returns Descending for CollectionPosition sort with Descending direction", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {
                type: "CollectionPosition",
                collectionId: generateId<TaskCollectionId>(),
                direction: "Descending",
                missing: "Last",
            },
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Descending");
    });

    test("returns Ascending for AssigneePosition sort with Ascending direction", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "AssigneePosition", direction: "Ascending", missing: "Last"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Ascending");
    });

    test("returns Descending for AssigneePosition sort with Descending direction", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "AssigneePosition", direction: "Descending", missing: "First"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Descending");
    });

    test("returns null for CreatedTime sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe(null);
    });

    test("returns null for Priority sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "Priority", direction: "Descending", missing: "Last"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe(null);
    });

    test("returns null for DueDate sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "DueDate", direction: "Ascending", missing: "Last"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe(null);
    });

    test("only checks first sort when multiple sorts present", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            {type: "ParentPosition", direction: "Descending", missing: "First"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe(null);
    });

    test("returns direction from first sort when it is a position sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
            {type: "CreatedTime", direction: "Descending", missing: "First"},
        ];
        expect(getTaskQueryManuallySortedDirection(sorts)).toBe("Ascending");
    });
});

describe("isTaskQueryManuallySorted", () => {
    test("returns false for empty sorts array", () => {
        expect(isTaskQueryManuallySorted([])).toBe(false);
    });

    test("returns true for ParentPosition sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
        ];
        expect(isTaskQueryManuallySorted(sorts)).toBe(true);
    });

    test("returns true for CollectionPosition sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {
                type: "CollectionPosition",
                collectionId: generateId<TaskCollectionId>(),
                direction: "Ascending",
                missing: "Last",
            },
        ];
        expect(isTaskQueryManuallySorted(sorts)).toBe(true);
    });

    test("returns true for AssigneePosition sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "AssigneePosition", direction: "Descending", missing: "First"},
        ];
        expect(isTaskQueryManuallySorted(sorts)).toBe(true);
    });

    test("returns false for CreatedTime sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ];
        expect(isTaskQueryManuallySorted(sorts)).toBe(false);
    });

    test("returns false for Priority sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "Priority", direction: "Descending", missing: "Last"},
        ];
        expect(isTaskQueryManuallySorted(sorts)).toBe(false);
    });

    test("returns false when first sort is not a position sort", () => {
        const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
            {type: "DueDate", direction: "Ascending", missing: "Last"},
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
        ];
        expect(isTaskQueryManuallySorted(sorts)).toBe(false);
    });
});
