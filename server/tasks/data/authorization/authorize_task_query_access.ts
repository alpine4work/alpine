import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {authorizeTaskCollectionAccess} from "~/server/tasks/data/authorization/authorize_task_collection_access.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {
    runAllPromiseThunks,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

export async function authorizeTaskQueryAccess(
    context: TaskRealtimeActionContext,
    {
        spaceId,
        filters,
        sorts,
        consistency,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        consistency?: DynamoCacheReadConsistency;
    },
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
) {
    let hasAccess = false;

    await runAllPromiseThunks(
        async () => {
            // Account has edit access to all tasks they created. So authorize if we have an
            // exclusive creator filter for our session account.
            if (
                filters.creatorFilter &&
                filters.creatorFilter.type === "OneOf" &&
                filters.creatorFilter.accountIds.size > 0 &&
                (
                    await runAllPromises(
                        mapIterable(filters.creatorFilter.accountIds, async accountId => {
                            // A task must have a creator to grant access to the task.
                            if (accountId === "MissingAccount") return false;

                            return await evaluateAccessPolicy(
                                context,
                                spaceId,
                                {
                                    accountGrantById: new Map([[accountId, {level: "Edit"}]]),
                                    defaultGrant: null,
                                    urlGrant: null,
                                },
                                "Edit",
                                {consistency},
                            );
                        }),
                    )
                ).every(value => value)
            ) {
                hasAccess = true;
            }
        },
        async () => {
            // Account has edit access to tasks it is assigned to. So authorize if we have an
            // exclusive assignee filter for our session account.
            if (
                filters.assigneeFilter &&
                filters.assigneeFilter.type === "OneOf" &&
                filters.assigneeFilter.accountIds.size > 0 &&
                (
                    await runAllPromises(
                        mapIterable(filters.assigneeFilter.accountIds, async accountId => {
                            // A task must have a creator to grant access to the task.
                            if (accountId === "MissingAccount") return false;

                            return await evaluateAccessPolicy(
                                context,
                                spaceId,
                                {
                                    accountGrantById: new Map([[accountId, {level: "Edit"}]]),
                                    defaultGrant: null,
                                    urlGrant: null,
                                },
                                "Edit",
                                {consistency},
                            );
                        }),
                    )
                ).every(value => value)
            ) {
                hasAccess = true;
            }
        },
        async () => {
            if (!filters.collectionsFilter) return;

            await runAllPromises(
                filters.collectionsFilter.map(async clause => {
                    // Make sure we're authorized to view every referenced collection...
                    await runAllPromises(
                        Array.from(clause.keys(), async term => {
                            if (term === "IsEmpty") return;

                            const {spaceId: collectionSpaceId} =
                                await authorizeTaskCollectionAccess(
                                    context,
                                    term,
                                    "View",
                                    loaders,
                                    {consistency},
                                );

                            if (spaceId !== collectionSpaceId) {
                                throw new PermissionDeniedError(
                                    "Task collection is in the wrong space",
                                );
                            }
                        }),
                    );

                    // For this filter to grant access, we need to guarantee the query only returns
                    // tasks that have at least one collection we can view.
                    //
                    // A normalized collections filter is in [conjunctive normal form][1]. That means
                    // if one of the "AND"ed clauses narrows down to only viewable collections this
                    // filter can grant access. That's what we check here.
                    //
                    // [1]: https://en.wikipedia.org/wiki/Conjunctive_normal_form
                    if (iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not)) {
                        hasAccess = true;
                    }
                }),
            );
        },
        async () => {
            if (!filters.parentFilter) return;

            // View access on the parent task is inherited to child tasks.
            const {spaceId: taskSpaceId} = await authorizeTaskAccess(
                context,
                filters.parentFilter.parentTaskId,
                "View",
                loaders,
                {consistency},
            );

            if (spaceId !== taskSpaceId) {
                throw new PermissionDeniedError("Parent task is in the wrong space");
            }

            hasAccess = true;
        },
        async () => {
            // Must have space access to filter by hidden accounts. We only send account
            // information for assignees to actors without space access (e.g. anonymous actors
            // viewing a collection they have access to via `urlGrant`). Allowing an actor
            // without space access to filter by hidden accounts could reveal information we
            // don't want them to see.
            if (filters.creatorFilter || filters.assignerFilter) {
                await authorizeSpaceAccess(context, spaceId);
            }
        },
        async () => {
            await runAllPromises(
                sorts.map(async sort => {
                    switch (sort.type) {
                        case "ParentPosition": {
                            // You are not allowed to sort by parent position unless you are also filtering by
                            // the parent task. This is because sorting by parent position reveals information
                            // about the parent task which might not be visible to you.
                            if (filters.parentFilter) break;

                            throw new PermissionDeniedError(
                                "Must filter by a parent task to sort by parent position",
                            );
                        }
                        case "CollectionPosition": {
                            // Optimization: If our filter contains the collection then we will authorize view
                            // access above.
                            if (
                                filters.collectionsFilter?.some(clause =>
                                    clause.has(sort.collectionId),
                                )
                            ) {
                                break;
                            }

                            const {spaceId: collectionSpaceId} =
                                await authorizeTaskCollectionAccess(
                                    context,
                                    sort.collectionId,
                                    "View",
                                    loaders,
                                    {consistency},
                                );

                            if (spaceId !== collectionSpaceId) {
                                throw new PermissionDeniedError(
                                    "Task collection is in the wrong space",
                                );
                            }
                            break;
                        }
                        case "AssigneePosition": {
                            // A task's assignee position is private to the account whom the task is assigned.
                            // Only allow sorting by assignee position when also filtering for tasks assigned
                            // to you.
                            if (
                                context.actor.type === "Session" &&
                                filters.assigneeFilter?.accountIds.size === 1 &&
                                filters.assigneeFilter.accountIds.has(context.actor.getAccountId())
                            ) {
                                // If the actor doesn't have space access then throw an "actor doesn't have space
                                // access" error.
                                await authorizeSpaceAccess(context, spaceId);

                                break;
                            }

                            throw new PermissionDeniedError(
                                "Must filter assignee to session account to sort by assignee position",
                            );
                        }
                        case "Creator":
                        case "Assigner": {
                            // Must have space access to sort by hidden accounts. We only send account
                            // information for assignees to actors without space access (e.g. anonymous actors
                            // viewing a collection they have access to via `urlGrant`). Allowing an actor
                            // without space access to sort by hidden accounts could reveal information we
                            // don't want them to see.
                            await authorizeSpaceAccess(context, spaceId);
                            break;
                        }
                        default:
                            break;
                    }
                }),
            );
        },
    );

    if (!hasAccess) {
        // If the actor doesn't have space access then throw an "actor doesn't have space
        // access" error.
        await authorizeSpaceAccess(context, spaceId);

        throw new PermissionDeniedError("Query may reveal tasks the actor is not allowed to see", {
            displayMessage: errorDisplayMessage`These filters and sorts would reveal tasks you don\u2019t have access to. Try again and add a collection filter with a collection you have access to or an assignee/creator filter for the account you\u2019re acting on behalf of.`,
        });
    }
}
