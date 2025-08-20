import {ServerActionContext} from "~/server/context/server_action_context.js";
import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {ErrorBase, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {FileTaskCollectionEntityModel} from "~/shared/tasks/file_task_collection_entity_model.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeLoadQueriesOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

let withMockFileCollectionEntityModelForTest = false;

export function enableMockFileTaskCollectionEntityModelForTest() {
    assert(import.meta.jest);
    withMockFileCollectionEntityModelForTest = true;
}

export async function getFileTaskCollectionEntityModelIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
): Promise<Result<FileTaskCollectionEntityModel, ErrorBase>> {
    // Since `context.tasks.loadQuery()` isn't always implemented in all unit tests
    // we allow you to set a flag in Jest unit tests to return a mock collection
    // entity model.
    if (import.meta.jest && withMockFileCollectionEntityModelForTest) {
        return {
            ok: true,
            value: {
                type: "TaskCollection",
                versions: zeroHybridLogicalTime,
                collection: new TaskCollectionModel({
                    id: collectionId,
                    spaceId,
                    createdTime: zeroHybridLogicalTime,
                    creatorId: null,
                    deletedTime: null,
                    undeletedTime: null,
                    name: new LabelStringRegister("Mock collection", zeroHybridLogicalTime),
                    color: new TaskCollectionColorRegister(null, zeroHybridLogicalTime),
                    accessPolicy: new AccessPolicyRegister(
                        {accountGrantById: emptyMap, defaultGrant: null, urlGrant: null},
                        zeroHybridLogicalTime,
                    ),
                }),
                previewTasks: emptyArray,
            },
        };
    }

    const filters: TaskQueryNormalizedFilters = {
        displayStatusFilter: {
            ifOpenActive: true,
            ifOpenInactive: true,
            ifClosed: false,
        },
        collectionsFilter: assertNonEmptyReadonlyArray([
            assertNonEmptyReadonlyMap(new Map([[collectionId, false]])),
        ]),
    };

    const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
        {
            type: "CollectionPosition",
            direction: "Ascending",
            missing: "Last",
            collectionId,
        },
        {
            type: "CreatedTime",
            direction: "Ascending",
            missing: "Last",
        },
    ];

    const result: Result<TaskRealtimeLoadQueriesOutput, ErrorBase> = await context.tasks
        .loadQueries(spaceId, {
            taskIds: [],
            collectionIds: [collectionId],
            queries: [{limit: 8, filters, sorts}],
        })
        .then(
            result => ({ok: true, value: result}),
            error => {
                // Normally, we prefer that functions explicitly return authorization errors
                // instead of us using a try/catch which might pick up an unrelated permission
                // error. However, in this case the `loadQueries()` function in
                // `TaskRealtimeService` is complex enough that we're not going to bother
                // updating its code to return explicit authorization errors for now.
                if (
                    (error instanceof PermissionDeniedError || error instanceof NotFoundError) &&
                    error.displayMessage
                ) {
                    return {ok: false, error};
                } else {
                    throw error;
                }
            },
        );

    if (!result.ok) return result;

    const tasksAndCursors: Array<{
        readonly cursor: TaskQuerySortCursor;
        readonly task: TaskModel;
    }> = [];

    for (const backfillTask of result.value.updateEvent.backfillTasks) {
        if (backfillTask.type !== "Authorized") continue;
        const {task} = backfillTask;

        if (!evaluateTaskQueryNormalizedFiltersForModel(filters, task)) continue;

        const cursor = getTaskQueryNormalizedSortCursorForModel(sorts, task);
        tasksAndCursors.push({cursor, task});
    }

    // Make sure our tasks are sorted properly...
    tasksAndCursors.sort((task1, task2) =>
        compareTaskQuerySortCursors(sorts, task1.cursor, task2.cursor),
    );

    const backfillCollection = assertExists(
        result.value.updateEvent.backfillCollections.find(backfillCollection => {
            switch (backfillCollection.type) {
                case "Authorized":
                    return backfillCollection.collection.id === collectionId;
                case "Unauthorized":
                    return backfillCollection.collectionId === collectionId;
                default:
                    throw exhaustive(backfillCollection);
            }
        }),
    );

    // If we don't have access to the collection then `loadQueries()` should throw
    // a `PermissionDeniedError`.
    assert(backfillCollection.type !== "Unauthorized");

    let maxTime = zeroHybridLogicalTime;

    const clock = {
        tick: (time: HybridLogicalTime) => {
            if (compareHybridLogicalTimes(maxTime, time) < 0) {
                maxTime = time;
            }
        },
    };

    // TODO(calebmer): We keep rendering deleted task collections! We should show
    // an error message instead.
    const collection = backfillCollection.collection;
    collection.tick(clock);

    const tasks = tasksAndCursors.map(({task}) => {
        task.tick(clock);
        return task;
    });

    return {
        ok: true,
        value: {
            type: "TaskCollection",
            // We use the max `HybridLogicalTime` across all the CRDTs we're
            // returning as the version. While this isn't perfect (when merging two file
            // entities one may have a newer collection name and the other may have a newer
            // collection color) we consider it good enough. Most of the time we'll be
            // reading the latest data.
            versions: maxTime,
            collection,
            previewTasks: tasks,
        },
    };
}
