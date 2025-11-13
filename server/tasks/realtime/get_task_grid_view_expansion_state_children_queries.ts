import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/spaces_actions.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActorInterface} from "~/server/tasks/data/task_realtime_actor_interface.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {authorizeTaskIndexDocAccessIfPossible} from "~/server/tasks/data/task_table.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionTaskState,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * Get the queries to preload for some `TaskGridViewExpansionState`. If some
 * tasks are expanded we want to return the children data with the main query
 * all at once.
 *
 * This uses a guessing heuristic. We don't know for sure whether all the
 * queries we preload are valid. It's our best guess based on the
 * `TaskGridViewExpansionState` which may be stale. Expansion state will be
 * cleaned up on the client if it contains a task tree that doesn't exist
 * anymore.
 */
export function getTaskGridViewExpansionStateChildrenQueries<Result>(
    context: TaskRealtimeSystemActionContext,
    {
        server,
        spaceId,
        actor,
        limit,
        tasks,
        gridViewExpansionState,
        consistency,
        loadQuery,
    }: {
        server: TaskRealtimeServer;
        spaceId: SpaceId;
        actor: TaskRealtimeActorInterface;
        limit: number;
        tasks: ReadonlyArray<TaskIndexDoc>;
        gridViewExpansionState: TaskGridViewExpansionState;
        consistency?: DynamoCacheReadConsistency;
        loadQuery: (input: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        }) => Promise<Result>;
    },
): Array<Promise<Result | null>> {
    const childrenQueryPromises: Array<Promise<Result | null>> = [];

    if (actor.type !== "Session" && actor.type !== "ImpersonatedAccount") {
        return childrenQueryPromises;
    }

    const actorAccountId = actor.getAccountId();

    if (!gridViewExpansionState) return childrenQueryPromises;

    // All loaded tasks are authorized because we authorized query access.
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex]!;

        // If this task is expanded then load its child tasks. If any of this task's
        // child tasks are expanded then we load all of those as well.
        //
        // A task must have at least one child task for a client to be able to expand
        // it. However, if a task loses all its children we don't update the expanded
        // state. So we double check the task still has some children before starting
        // to load child tasks.
        //
        // The way we limit the number of child tasks we load requires knowing how grid
        // view is lain out. An expanded task shows its child tasks directly below it.
        // Ideally we count child tasks against the provided `limit` for the overall
        // query because they take vertical space. However we've already loaded our
        // main task query. We still want to limit the number of child task queries
        // though.
        //
        // We make the assumption that each child task query returns at least 1 task.
        // While a task needs at least 1 child task to expand it may lose that child
        // task. So the assumption is correct most of the time but not all of the time.
        //
        // So that means we use `limit` to control the number of queries we load. If
        // limit is 50 then we assume 50 queries will return at least 50 tasks meeting
        // our limit. However, we can subtract from limit based on how far down in the
        // query we are. If our expanded task is in the 10th position, that means with
        // a limit of 50 we only need 40 more tasks. So we'll only load 40 child
        // queries.
        const taskGridViewExpansionState = gridViewExpansionState?.get(task.id);
        if (
            taskGridViewExpansionState?.isExpanded &&
            task.addedChildTaskCount - task.removedChildTaskCount > 0 &&
            childrenQueryPromises.length < limit - (taskIndex + 1)
        ) {
            const addTaskChildrenQueries = (
                taskId: TaskId,
                taskState: TaskGridViewExpansionTaskState,
            ) => {
                if (!taskState.isExpanded) return;

                const childrenFilters: TaskQueryNormalizedFilters = {
                    displayStatusFilter: {
                        ifOpenInactive: true,
                        ifOpenActive: true,
                        ifClosed: true,
                    },
                    parentFilter: {
                        parentTaskId: taskId,
                    },
                };

                const childrenSorts: ReadonlyArray<TaskQueryNormalizedSort> = [
                    {
                        type: "ParentPosition",
                        direction: "Ascending",
                        missing: "Last",
                    },
                    {
                        type: "CreatedTime",
                        direction: "Ascending",
                        missing: "Last",
                    },
                ];

                const childrenQueryPromise = (async () => {
                    const task = await server.getTask(context, spaceId, taskId);

                    const authorizationResult = await impersonateAccountAsSystemContext(
                        context,
                        actorAccountId,
                        accountContext =>
                            authorizeTaskIndexDocAccessIfPossible(
                                accountContext,
                                task,
                                "View",
                                {
                                    getTaskIndexDoc: taskId =>
                                        server.getTask(context, spaceId, taskId),
                                    getCollectionIndexDoc: collectionId =>
                                        server.getCollection(context, spaceId, collectionId),
                                },
                                {consistency},
                            ),
                    );

                    // We may have tasks in our expansion state that the user lost access too (e.g.
                    // the task was deleted or it moved collections). Since we preload child query
                    // tasks as an optimization, ignore tasks we no longer have access to.
                    if (!authorizationResult.ok) return null;

                    return loadQuery({
                        filters: childrenFilters,
                        sorts: childrenSorts,
                        limit,
                    });
                })();

                context.process.waitUntil(childrenQueryPromise);
                childrenQueryPromises.push(childrenQueryPromise);

                if (taskState.childTasks) {
                    for (const [taskId, childTaskState] of taskState.childTasks) {
                        addTaskChildrenQueries(taskId, childTaskState);
                    }
                }
            };

            addTaskChildrenQueries(task.id, taskGridViewExpansionState);
        }

        // Exit the loop early if we have enough children queries to fill our limit.
        if (childrenQueryPromises.length >= limit - (taskIndex + 1)) break;
    }

    return childrenQueryPromises;
}
