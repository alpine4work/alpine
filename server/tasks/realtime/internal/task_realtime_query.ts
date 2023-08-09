import {RBTree} from "bintrees";
import {evaluateTaskQueryNormalizedFiltersForIndexDoc} from "~/server/tasks/index/evaluate_task_query_normalized_filters_for_index_doc.js";
import {
    TaskIndexDoc,
    TaskPriorityIntegerMapping,
    TaskStatusTypeIntegerMapping,
} from "~/server/tasks/index/task_index_doc.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/normalize_task_query_filters.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

type TaskRealtimeQueryTreeEntry = readonly [...ReadonlyArray<TaskQuerySortValue>, TaskId];

const previousTaskIndexDocByIdByQueryForTest =
    process.env.NODE_ENV === "test"
        ? new WeakMap<TaskRealtimeQuery, Map<TaskId, TaskIndexDoc>>()
        : null;

export class TaskRealtimeQuery {
    public readonly spaceId: SpaceId;
    private readonly _filters: TaskQueryNormalizedFilters;
    private readonly _sort: ReadonlyArray<TaskQuerySort>;

    private readonly _tree = new RBTree<TaskRealtimeQueryTreeEntry>((entry1, entry2) => {
        const sortLength = this._sort.length;
        let i = 0;
        for (i = 0; i < sortLength; i++) {
            const {direction = "Ascending", missing = "Last"} = this._sort[i]!;
            const sortValue1 = entry1[i] as TaskQuerySortValue;
            const sortValue2 = entry2[i] as TaskQuerySortValue;

            if (sortValue1 === null && sortValue2 === null) continue;
            if (sortValue1 === null) return missing === "Last" ? 1 : -1;
            if (sortValue2 === null) return missing === "Last" ? -1 : 1;

            if (typeof sortValue1 === "number") {
                if (typeof sortValue2 !== "number") return -1;
                let comparison = sortValue1 - sortValue2;
                if (comparison === 0) continue;
                comparison *= direction === "Ascending" ? 1 : -1;
                return comparison;
            }

            if (typeof sortValue1 === "string") {
                if (typeof sortValue2 !== "string") return 1;
                if (sortValue1 < sortValue2) return direction === "Ascending" ? -1 : 1;
                if (sortValue1 > sortValue2) return direction === "Ascending" ? 1 : -1;
                continue;
            }

            throw exhaustive(sortValue1);
        }

        const taskId1 = entry1[i] as TaskId;
        const taskId2 = entry1[i] as TaskId;

        if (taskId1 < taskId2) return -1;
        if (taskId1 > taskId2) return 1;
        return 0;
    });

    public onVisibleTaskUpdate(
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
    ): {isStillVisible: boolean} {
        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV === "test") {
            assert(previousTaskIndexDocByIdByQueryForTest);

            const previousTaskIndexDocById = getOrSetDefaultMapValue(
                previousTaskIndexDocByIdByQueryForTest,
                this,
                () => new Map(),
            );

            assert(
                previousTaskIndexDocById.get(taskId) === oldTask,
                "Query must observe all updates to a task through `onVisibleTaskUpdate`",
            );
            previousTaskIndexDocById.set(taskId, newTask);
        }

        const oldSortValues = this._sort.map(sort =>
            getTaskQuerySortValueFromIndexDoc(sort, oldTask),
        );

        // If the task is no longer visible, remove it from our tree.
        const isStillVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(
            this._filters,
            newTask,
        );
        if (!isStillVisible) {
            const wasRemoved = this._tree.remove([...oldSortValues, taskId]);
            assert(wasRemoved);

            // When testing, track that the task has been removed from the query.
            if (process.env.NODE_ENV === "test") {
                assertExists(previousTaskIndexDocByIdByQueryForTest).get(this)?.delete(taskId);
            }

            return {isStillVisible: false};
        }

        const newSortValues = this._sort.map(sort =>
            getTaskQuerySortValueFromIndexDoc(sort, newTask),
        );

        // If the sort values of our task have changed then we want to move it to a new
        // position in our tree. This has O(log(n)) performance since we use a binary
        // search tree.
        const haveSortValuesChanged = oldSortValues.some(
            (oldSortValue, i) => newSortValues[i] !== oldSortValue,
        );
        if (haveSortValuesChanged) {
            const wasRemoved = this._tree.remove([...oldSortValues, taskId]);
            assert(wasRemoved);
            this._tree.insert([...newSortValues, taskId]);
        }

        return {isStillVisible: true};
    }
}

type TaskQuerySortValue = string | number | null;

function getTaskQuerySortValueFromIndexDoc(
    sort: TaskQuerySort,
    task: TaskIndexDoc,
): TaskQuerySortValue {
    switch (sort.type) {
        case "Status": {
            return TaskStatusTypeIntegerMapping.into(task.status.value.type);
        }
        case "Priority": {
            return task.priority.value === null
                ? 0
                : TaskPriorityIntegerMapping.into(task.priority.value);
        }
        case "Assignee": {
            return task.assignee.value?.assignee.workingAccountName ?? null;
        }
        case "Creator": {
            return task.creator?.workingAccountName ?? null;
        }
        case "Assigner": {
            return task.assignee.value?.assigner.workingAccountName ?? null;
        }
        case "DueDate": {
            return task.dueDate.value?.toDate("UTC").getTime() ?? null;
        }
        case "CreatedDate": {
            return task.createdTime.absoluteTime[0];
        }
        case "AssignedDate": {
            return task.assignee.value?.assignedTime.absoluteTime[0] ?? null;
        }
        case "ClosedDate": {
            return task.status.value.type === "Closed"
                ? task.status.value.closedTime.absoluteTime[0]
                : null;
        }
        case "ActivatedDate": {
            return task.status.value.type === "Open" &&
                task.assignee.value &&
                task.rawAssigneeStatus.value.type === "Active"
                ? task.rawAssigneeStatus.value.activatedTime.absoluteTime[0]
                : null;
        }
        default:
            throw exhaustive(sort);
    }
}
