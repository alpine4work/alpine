import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ErrorBase, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {FileTaskEntityModel} from "~/shared/tasks/file_task_entity_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskRealtimeLoadQueriesOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {emptyTaskTitleModel} from "~/shared/tasks/title/task_title.js";

let withMockFileTaskEntityModelForTest = false;

export function enableMockFileTaskEntityModelForTest() {
    assert(import.meta.jest);
    withMockFileTaskEntityModelForTest = true;
}

export async function getFileTaskEntityModelIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
): Promise<Result<FileTaskEntityModel, ErrorBase>> {
    // Since `context.tasks.loadQuery()` isn't always implemented in all unit tests we
    // allow you to set a flag in Jest unit tests to return a mock task entity model.
    if (import.meta.jest && withMockFileTaskEntityModelForTest) {
        const unknownAccountData = AccountModel.getUnknown().initialData;

        return {
            ok: true,
            value: {
                type: "Task",
                versions: zeroHybridLogicalTime,
                task: new TaskModel({
                    id: taskId,
                    spaceId,
                    creator: {
                        accountId: unknownAccountData.id,
                        workingAccountName: unknownAccountData.name,
                        workingAccountNameVersion: unknownAccountData.nameVersion,
                        from: null,
                    },
                    createdTime: new TaskFilterableTime({
                        absoluteTime: zeroHybridLogicalTime,
                        setterTimeZone: defaultTimeZone,
                    }),
                    deletedTime: null,
                    undeletedTime: null,
                    parent: {
                        taskId: new TaskParentTaskIdRegister(null, zeroHybridLogicalTime),
                        position: new TaskPositionRegister(
                            {orderTime: zeroHybridLogicalTime, orderKey: initialOrderKey},
                            zeroHybridLogicalTime,
                        ),
                    },
                    addedChildTaskCount: 0,
                    removedChildTaskCount: 0,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                    accessPolicy: null,
                    collections: TaskCollectionSet.empty,
                    positionByCollectionId: TaskPositionByCollectionIdMap.empty,
                    status: new TaskStatusWithSortableAccountRegister(
                        {type: "Open"},
                        zeroHybridLogicalTime,
                    ),
                    assignee: new TaskAssigneeWithSortableAccountRegister(
                        null,
                        zeroHybridLogicalTime,
                    ),
                    assigneeStatus: new TaskAssigneeStatusRegister(
                        {type: "Inactive"},
                        zeroHybridLogicalTime,
                    ),
                    assigneePosition: new TaskAssigneePositionRegister(null, zeroHybridLogicalTime),
                    title: emptyTaskTitleModel.get(),
                    dueDate: new TaskDueDateRegister(null, zeroHybridLogicalTime),
                    priority: new TaskPriorityRegister(null, zeroHybridLogicalTime),
                    layout: null,
                }),
                assignee: null,
                parent: null,
                collections: emptyArray,
                referencedSites: emptyArray,
                site: null,
            },
        };
    }

    // Load the task and its dependencies (collections it belongs to)
    const result: Result<TaskRealtimeLoadQueriesOutput, ErrorBase> = await context.tasks
        .loadQueries(spaceId, {
            taskIds: [taskId],
            collectionIds: [],
            queries: [],
        })
        .then(
            result => ({ok: true, value: result}),
            error => {
                // Normally, we prefer that functions explicitly return authorization errors
                // instead of us using a try/catch which might pick up an unrelated permission
                // error. However, in this case the `loadQueries()` function in
                // `TaskRealtimeService` is complex enough that we're not going to bother updating
                // its code to return explicit authorization errors for now.
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

    // Find the task in the backfill results
    const backfillTask = assertExists(
        result.value.updateEvent.backfillTasks.find(backfillTask => {
            switch (backfillTask.type) {
                case "Authorized":
                    return backfillTask.task.id === taskId;
                case "Unauthorized":
                    return backfillTask.taskId === taskId;
                default:
                    throw exhaustive(backfillTask);
            }
        }),
    );

    // If we don't have access to the task then `loadQueries()` should throw a
    // `PermissionDeniedError`.
    assert(backfillTask.type !== "Unauthorized");

    // TODO(calebmer): What do deleted tasks look like?
    const task = backfillTask.task;

    let maxTime = zeroHybridLogicalTime;

    const clock = {
        tick: (time: HybridLogicalTime) => {
            if (compareHybridLogicalTimes(maxTime, time) < 0) {
                maxTime = time;
            }
        },
    };

    task.tick(clock);

    let parent: {
        rootTask: {type: "Authorized"; task: TaskModel} | {type: "Unauthorized"};
        depth: number;
    } | null = null;

    // Recursively find the task's root parent and calculate the depth to the root
    // parent.
    if (task.getParent() !== null) {
        parent = {
            rootTask: {type: "Authorized", task: task},
            depth: -1,
        };

        while (parent.rootTask.type === "Authorized") {
            const grandParent = parent.rootTask.task.getParent();
            if (grandParent === null) break;

            const backfillGrandParentTask:
                | {type: "Authorized"; task: TaskModel}
                | {type: "Unauthorized"} = assertExists(
                result.value.updateEvent.backfillTasks.find(backfillTask => {
                    switch (backfillTask.type) {
                        case "Authorized":
                            return backfillTask.task.id === grandParent.taskId;
                        case "Unauthorized":
                            return backfillTask.taskId === grandParent.taskId;
                        default:
                            throw exhaustive(backfillTask);
                    }
                }),
            );

            if (backfillGrandParentTask.type === "Authorized") {
                backfillGrandParentTask.task.tick(clock);
            }

            parent = {
                rootTask: backfillGrandParentTask,
                depth: parent.depth + 1,
            };
        }
    }

    // Get the task's assignee if it has one
    let assignee: AccountModel | null = null;
    const taskAssignee = task.getAssignee();
    if (taskAssignee) {
        assignee = assertExists(
            result.value.updateEvent.referencedAccounts.find(
                account => account.id === taskAssignee.assignee.accountId,
            ),
        );
    }

    // Build a map of collections from backfill results
    const collectionById = new Map<TaskCollectionId, TaskCollectionModel>();
    for (const backfillCollection of result.value.updateEvent.backfillCollections) {
        if (backfillCollection.type === "Authorized") {
            backfillCollection.collection.tick(clock);
            collectionById.set(backfillCollection.collection.id, backfillCollection.collection);
        }
    }

    const collections = sliceIterable(
        filterMapIterable(task.getCollections().getArray(), ({collectionId}) =>
            collectionById.get(collectionId),
        ),
        0,
        5,
    );

    // Derive the task's own site (if any) from its access policy. `loadQueries`
    // already returns the matching `SitePreviewModel` in `referencedSites`, so reuse
    // it instead of refetching. Fall back to the prefetcher (or `siteIfAlreadyLoaded`)
    // if `referencedSites` somehow doesn't have it.
    const taskAccessPolicy = task.getAccessPolicy();
    let site: SitePreviewModel | null = null;
    if (taskAccessPolicy?.type === "Site") {
        const referencedSite = result.value.updateEvent.referencedSites.find(
            referencedSiteResult =>
                !referencedSiteResult.isPrivate &&
                referencedSiteResult.site.id === taskAccessPolicy.siteId,
        );

        // The user may not have access to the site, so only use it if they do.
        site = referencedSite?.isPrivate === false ? referencedSite.site : null;
    }

    return {
        ok: true,
        value: {
            type: "Task",
            // We use the max `HybridLogicalTime` across all the CRDTs we're returning as the
            // version. While this isn't perfect (when merging two file entities one may have a
            // newer collection name and the other may have a newer collection color) we
            // consider it good enough. Most of the time we'll be reading the latest data.
            versions: maxTime,
            task,
            assignee,
            parent,
            collections: Array.from(collections),
            referencedSites: result.value.updateEvent.referencedSites,
            site,
        },
    };
}
