import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {evaluateDeletedAccess} from "~/server/access/evaluate_deleted_access.js";
import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {
    convertTaskCollectionIndexDocToItem,
    convertTaskIndexDocToItem,
} from "~/server/tasks/data/internal/convert_task_index_doc_to_item.js";
import {isTaskCollectionItemDeleted} from "~/server/tasks/data/internal/is_task_collection_item_deleted.js";
import {
    TaskCollectionEssentialAttributesItemBase,
    TaskCommentsSummaryItem,
    TaskEssentialAttributesItemBase,
    TaskNotesItem,
    TaskTable,
} from "~/server/tasks/data/internal/task_table.js";
import type {
    TaskCollectionEssentialAttributesItem,
    TaskEssentialAttributesItem,
} from "~/server/tasks/data/internal/task_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {
    AccessLevel,
    AccessPolicy,
    EffectiveAccessPolicy,
    hasAccessLevel,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorBase, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {AccountId, SiteId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {createDefaultTaskAccessPolicy} from "~/shared/tasks/create_default_task_access_policy.js";
import {
    createTaskCollectionNotFoundError,
    createTaskNotFoundError,
    taskCollectionDeletedErrorDisplayMessage,
    taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
    taskDeletedErrorDisplayMessage,
    taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/tasks/task_error_messages.js";

export const TaskItemAuthorizationCache = new DynamoContextCache<
    TaskId,
    TaskEssentialAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Gets a task to be used in authorization. If used in `TaskRealtimeService` then
 * you may provide a loader function to use an in-memory task representation.
 *
 * 1. Attempts to get an in-memory task representation when used in
 *    `TaskRealtimeService` with `getTaskIndexDocIfExists`.
 *
 * 2. Otherwise loads the task from the database (cached within the action
 *    context).
 *
 * We force `getTaskIndexDocIfExists` to be synchronous. If you don't have the task
 * in memory then we should load from DynamoDB, not OpenSearch.
 */
export async function getTaskItemForAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    taskId: TaskId,
    loaders: {getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined} | null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<TaskEssentialAttributesItemBase> {
    const taskItem = await getTaskItemForAuthorizationIfExists(context, taskId, loaders, options);
    if (!taskItem) throw createTaskNotFoundError(taskId);
    return taskItem;
}

export async function getTaskItemForAuthorizationIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    taskId: TaskId,
    loaders: {getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined} | null,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<TaskEssentialAttributesItemBase | null> {
    const taskIndexDoc = loaders?.getTaskIndexDocIfExists(taskId);
    if (taskIndexDoc) return convertTaskIndexDocToItem(taskIndexDoc);

    const taskItem = await TaskItemAuthorizationCache.get(
        context,
        consistency,
        taskId,
        consistency =>
            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId,
                },
                {consistency},
            ),
    );

    return taskItem;
}

export const TaskCollectionItemAuthorizationCache = new DynamoContextCache<
    TaskCollectionId,
    TaskCollectionEssentialAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Gets a collection to be used in authorization. If used in `TaskRealtimeService`
 * then you may provide a loader function to use an in-memory collection
 * representation.
 *
 * 1. Attempts to get an in-memory collection representation when used in
 *    `TaskRealtimeService` with `getCollectionIndexDocIfExists`.
 *
 * 2. Otherwise loads the collection from the database (cached within the action
 *    context).
 *
 * We force `getCollectionIndexDocIfExists` to be synchronous. If you don't have
 * the collection in memory then we should load from DynamoDB, not OpenSearch.
 */
export async function getTaskCollectionItemForAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    collectionId: TaskCollectionId,
    loaders: {
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
    options?: {consistency?: DynamoCacheReadConsistency; onSiteId?: (siteId: SiteId) => void},
): Promise<TaskCollectionEssentialAttributesItemBase> {
    const collectionItem = await getTaskCollectionItemForAuthorizationIfExists(
        context,
        collectionId,
        loaders,
        options,
    );
    if (!collectionItem) throw createTaskCollectionNotFoundError(collectionId);
    return collectionItem;
}

export async function getTaskCollectionItemForAuthorizationIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    collectionId: TaskCollectionId,
    loaders: {
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
    {
        consistency = "Eventual",
        onSiteId,
    }: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    } = emptyObject,
): Promise<TaskCollectionEssentialAttributesItemBase | null> {
    const collectionIndexDoc = loaders?.getCollectionIndexDocIfExists(collectionId);
    if (collectionIndexDoc) {
        const collectionItem = convertTaskCollectionIndexDocToItem(collectionIndexDoc);
        if (collectionItem.accessPolicy.value.type === "Site") {
            onSiteId?.(collectionItem.accessPolicy.value.siteId);
        }
        return collectionItem;
    }

    const collectionItem = await TaskCollectionItemAuthorizationCache.get(
        context,
        consistency,
        collectionId,
        async consistency =>
            await TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "TaskCollection",
                    sortRangeType: "EssentialAttributes",
                    collectionId,
                },
                {consistency},
            ),
    );

    if (collectionItem?.accessPolicy.value.type === "Site") {
        onSiteId?.(collectionItem.accessPolicy.value.siteId);
    }

    return collectionItem;
}

export async function authorizeTaskCollectionItemAccess(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
): Promise<void> {
    unwrapResult(
        await authorizeTaskCollectionItemAccessIfPossible(
            context,
            collectionItem,
            expectedAccessLevel,
        ),
    );
}

export async function authorizeTaskCollectionItemAccessAllowingDeletedCollections(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
): Promise<void> {
    unwrapResult(
        await authorizeTaskCollectionItemAccessAllowingDeletedCollectionsIfPossible(
            context,
            collectionItem,
            expectedAccessLevel,
        ),
    );
}

export async function authorizeTaskCollectionItemAccessIfPossible(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    {
        consistency,
        dangerouslyAllowDeleted = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted?: boolean;
    } = {},
): Promise<Result<void, ErrorBase>> {
    if (isTaskCollectionItemDeleted(collectionItem)) {
        // If the actor couldn't view the collection then use a "permission denied" error
        // to avoid leaking that the collection was deleted.
        const result = await authorizeTaskCollectionItemAccessAllowingDeletedCollectionsIfPossible(
            context,
            collectionItem,
            "View",
            {consistency},
        );
        if (!result.ok) return result;

        const hasDeletedAccess = await evaluateDeletedAccess(context, {
            spaceId: collectionItem.spaceId,
            expectedAccessLevel,
            dangerouslyAllowDeleted,
        });

        if (!hasDeletedAccess) {
            return {
                ok: false,
                // NOTE(calebmer): Using `ErrorCode.NotFound` is important here. Consumers of this
                // error will render not found errors as "Deleted" and `ErrorCode.PermissionDenied`
                // as "Private".
                error: new NotFoundError("Task collection was deleted", {
                    aggregateDedupeKey: collectionItem.collectionId,
                    displayMessage: taskCollectionDeletedErrorDisplayMessage,
                }),
            };
        }
    }

    return await authorizeTaskCollectionItemAccessAllowingDeletedCollectionsIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
        {consistency},
    );
}

export async function authorizeTaskCollectionItemAccessAllowingDeletedCollectionsIfPossible(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        collectionItem.spaceId,
        collectionItem.accessPolicy.value,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: collectionItem.spaceId,
            expectedAccessLevel,
            aggregateDedupeKey: collectionItem.collectionId,
            displayMessages: taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}

export async function authorizeTaskItemAccess(
    context: ServerActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    unwrapResult(
        await authorizeTaskItemAccessIfPossible(
            context,
            taskItem,
            expectedAccessLevel,
            loaders,
            options,
        ),
    );
}

export async function authorizeTaskItemAccessAllowingDeletedTasks(
    context: ServerActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    unwrapResult(
        await authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
            context,
            taskItem,
            expectedAccessLevel,
            loaders,
            options,
        ),
    );
}

export async function authorizeTaskItemAccessIfPossible(
    context: TaskRealtimeActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    {
        consistency,
        dangerouslyAllowDeleted = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted?: boolean;
    } = {},
): Promise<Result<void, ErrorBase>> {
    if (taskItem.deletedTime) {
        // If the actor couldn't view the task then use a "permission denied" error to
        // avoid leaking that the task was deleted.
        const result = await authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
            context,
            taskItem,
            "View",
            loaders,
            {consistency},
        );
        if (!result.ok) return result;

        const hasDeletedAccess = await evaluateDeletedAccess(context, {
            spaceId: taskItem.spaceId,
            expectedAccessLevel,
            dangerouslyAllowDeleted,
        });

        if (!hasDeletedAccess) {
            return {
                ok: false,
                // NOTE(calebmer): Using `ErrorCode.NotFound` is important here. Consumers of this
                // error will render not found errors as "Deleted" and `ErrorCode.PermissionDenied`
                // as "Private".
                error: new NotFoundError("Task was deleted", {
                    aggregateDedupeKey: taskItem.taskId,
                    displayMessage: taskDeletedErrorDisplayMessage,
                }),
            };
        }
    }

    return await authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
        context,
        taskItem,
        expectedAccessLevel,
        loaders,
        {consistency},
    );
}

export function getTaskItemAccessPolicyWithDefault(
    taskItem: TaskEssentialAttributesItemBase,
): AccessPolicy {
    return taskItem.accessPolicy?.value ?? createDefaultTaskAccessPolicy(taskItem.creatorId);
}

export async function authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
    context: TaskRealtimeActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    switch (context.actor.type) {
        case "System": {
            if (context.actor.getSpaceId() !== taskItem.spaceId) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "System actor doesn\u2019t have access to task\u2019s space",
                    ),
                };
            }

            return okResult;
        }

        case "Session":
        case "ImpersonatedAccount":
        case "Anonymous": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== taskItem.spaceId
            ) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    ),
                };
            }

            const actorAccountId =
                context.actor.type !== "Anonymous" ? context.actor.getPossiblyBotAccountId() : null;

            if (
                await evaluateAccessPolicy(
                    context,
                    taskItem.spaceId,
                    getTaskItemAccessPolicyWithDefault(taskItem),
                    expectedAccessLevel,
                    options,
                )
            ) {
                return okResult;
            }

            if (
                actorAccountId !== null &&
                taskItem.assigneeId.value &&
                actorAccountId === taskItem.assigneeId.value &&
                hasAccessLevel("Edit", expectedAccessLevel) &&
                (await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    taskItem.spaceId,
                    actorAccountId,
                ))
            ) {
                return okResult;
            }

            // An array of `TaskCollectionId`s that authorize access to the task or `null` if
            // no `TaskCollectionId`s authorize access to the task.
            const authorizingCollectionItems = await runAllPromises(
                taskItem.collections.getArray().map(async ({collectionId}) => {
                    const collectionItem = await loaders.getCollectionItem(collectionId);

                    // Deleted collections don't grant any access.
                    if (isTaskCollectionItemDeleted(collectionItem)) return null;

                    const hasAccess = await evaluateAccessPolicy(
                        context,
                        collectionItem.spaceId,
                        collectionItem.accessPolicy.value,
                        expectedAccessLevel,
                        options,
                    );

                    return hasAccess ? collectionItem : null;
                }),
            );

            // We evaluate the access policies for all collections on a task but we only need
            // one passing access policy.
            if (authorizingCollectionItems.some(isNonNullable)) return okResult;

            if (taskItem.parentTaskId.value) {
                const parentTaskItem = await loaders.getTaskItem(taskItem.parentTaskId.value);

                // Parent tasks implicitly grant access to all of their child tasks. If we have a
                // parent task that is not deleted then check it before throwing a permission
                // denied error.
                if (!parentTaskItem.deletedTime) {
                    return await authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
                        context,
                        parentTaskItem,
                        expectedAccessLevel,
                        loaders,
                        options,
                    );
                }
            }

            return {
                ok: false,
                error: await createAccessPolicyPermissionDeniedError(context, {
                    spaceId: taskItem.spaceId,
                    expectedAccessLevel,
                    aggregateDedupeKey: taskItem.taskId,
                    displayMessages: taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
                }),
            };
        }

        // NOTE(calebmer): When authorizing whether a `Bot` has access to a task, we need
        // to collect everyone who has access to the task together at once and compare that
        // against the bot's scope.
        //
        // Unlike authorization for a `Session` actor where we take a more optimized
        // approach looking through each piece of a task one-by-one and only loading the
        // next referenced task/collection if we haven't authorized earlier.
        case "Bot": {
            // Optimization: Before we go and load the task's full access policy, see if we can
            // authorize task access using just the information immediately available in the
            // task. The task's access policy and assignee.
            //
            // Useful if a user is in a personal chat and asking their bot to read their
            // personal tasks.
            let cheapAccessPolicy = await intoEffectiveAccessPolicy(
                context,
                getTaskItemAccessPolicyWithDefault(taskItem),
            );

            if (taskItem.assigneeId.value) {
                const newAccountGrantById = new Map(cheapAccessPolicy.accountGrantById);

                newAccountGrantById.set(taskItem.assigneeId.value, {level: "Edit"});

                cheapAccessPolicy = {
                    ...cheapAccessPolicy,
                    accountGrantById: newAccountGrantById,
                };
            }

            if (
                await evaluateAccessPolicy(
                    context,
                    taskItem.spaceId,
                    cheapAccessPolicy,
                    expectedAccessLevel,
                    options,
                )
            ) {
                return okResult;
            }

            const effectiveAccessPolicy =
                await getTaskItemEffectiveAccessPolicyWithoutAuthorization(
                    context,
                    taskItem,
                    options,
                );

            if (
                await evaluateAccessPolicy(
                    context,
                    taskItem.spaceId,
                    effectiveAccessPolicy,
                    expectedAccessLevel,
                    options,
                )
            ) {
                return okResult;
            }

            return {
                ok: false,
                error: await createAccessPolicyPermissionDeniedError(context, {
                    spaceId: taskItem.spaceId,
                    expectedAccessLevel,
                    aggregateDedupeKey: taskItem.taskId,
                    displayMessages: taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
                }),
            };
        }

        default:
            throw exhaustive(context.actor);
    }
}

export async function authorizeTaskAccessAndGetCommentsSummaryItem(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    item: TaskEssentialAttributesItem;
    commentsSummaryItem: TaskCommentsSummaryItem | null;
}> {
    let taskItem: TaskEssentialAttributesItem | null = null;
    let taskCommentsSummaryItem: TaskCommentsSummaryItem | null = null;

    const taskItemPromise = (async () => {
        for await (const item of TaskTable.query(context, {
            partitionKey: {
                partitionType: "Task",
                taskId,
            },
            startSortKey: {
                sortRangeType: "EssentialAttributes",
            },
            endSortKey: {
                sortRangeType: "CommentsSummary",
            },
            limit: "All",
            consistency,
        })) {
            if (item.sortRangeType === "EssentialAttributes") {
                taskItem = item;
            } else if (item.sortRangeType === "CommentsSummary") {
                taskCommentsSummaryItem = item;
            }
        }

        return taskItem;
    })();

    // Cache the `taskItem` in case `getTaskItemForAuthorization()` is called for the
    // same `TaskId` later.
    TaskItemAuthorizationCache.set(context, consistency, taskId, taskItemPromise);

    taskItem = await taskItemPromise;
    if (!taskItem) throw createTaskNotFoundError(taskId);

    await authorizeTaskItemAccess(
        context,
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId =>
                getTaskItemForAuthorization(context, taskId, null, {consistency}),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null, {consistency}),
        },
        {consistency},
    );

    return {
        item: taskItem,
        commentsSummaryItem: taskCommentsSummaryItem,
    };
}

export async function authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists<Value>(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    process: (options: {
        item: TaskEssentialAttributesItem;
        commentsSummaryItem: TaskCommentsSummaryItem | null;
        notesItem: TaskNotesItem | null;
    }) => Promise<Value>,
    {
        consistency = "Eventual",
        onSiteId,
    }: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    } = {},
): Promise<Value | null> {
    let item: TaskEssentialAttributesItem | null = null;
    let commentsSummaryItem: TaskCommentsSummaryItem | null = null;
    let notesItem: TaskNotesItem | null = null;

    const itemPromise = (async () => {
        for await (const currentItem of TaskTable.query(context, {
            partitionKey: {
                partitionType: "Task",
                taskId,
            },
            startSortKey: {
                sortRangeType: "EssentialAttributes",
            },
            endSortKey: {
                sortRangeType: "Notes",
            },
            limit: "All",
            consistency,
        })) {
            if (currentItem.sortRangeType === "EssentialAttributes") {
                item = currentItem;
                if (currentItem.accessPolicy?.value?.type === "Site") {
                    onSiteId?.(currentItem.accessPolicy.value.siteId);
                }
            } else if (currentItem.sortRangeType === "CommentsSummary") {
                commentsSummaryItem = currentItem;
            } else if (currentItem.sortRangeType === "Notes") {
                notesItem = currentItem;
            }
        }

        return item;
    })();

    // Cache the `taskItem` in case `getTaskItemForAuthorization()` is called for the
    // same `TaskId` later.
    TaskItemAuthorizationCache.set(context, consistency, taskId, itemPromise);

    item = await itemPromise;
    if (!item) return null;

    const [, value] = await runAllPromises([
        authorizeTaskItemAccess(
            context,
            item,
            expectedAccessLevel,
            {
                getTaskItem: taskId =>
                    getTaskItemForAuthorization(context, taskId, null, {consistency}),
                getCollectionItem: collectionId =>
                    getTaskCollectionItemForAuthorization(context, collectionId, null, {
                        consistency,
                    }),
            },
            {consistency},
        ),
        process({
            item,
            commentsSummaryItem,
            notesItem,
        }),
    ]);

    return value;
}

export async function authorizeTaskAccessAndGetCommentsSummaryAndNotesItems<Value>(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    process: (options: {
        item: TaskEssentialAttributesItem;
        commentsSummaryItem: TaskCommentsSummaryItem | null;
        notesItem: TaskNotesItem | null;
    }) => Promise<Value>,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Value> {
    const value = await authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists(
        context,
        taskId,
        expectedAccessLevel,
        process,
        options,
    );

    if (!value) throw createTaskNotFoundError(taskId);
    return value;
}

/**
 * Does the task have a default grant? Either directly or inherited via the task's
 * collections / parent task.
 *
 * As long as you have access to the space you can call this function. Since if the
 * task has a `defaultGrant` if you have access to the space then you have access
 * to the task (if we ever add "guest" accounts that don't have access to
 * `defaultGrant` content in the space this may need to change). If the task
 * doesn't have a `defaultGrant` then as a space member you know the task exists if
 * you have its `TaskId` so returning false (instead of, say, throwing
 * `NotFoundError`) doesn't give you new information.
 */
export async function doesTaskItemHaveDefaultGrant(
    context: TaskRealtimeActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
): Promise<boolean> {
    await authorizeSpaceAccess(context, taskItem.spaceId);

    {
        const immediateAccessPolicy = await intoEffectiveAccessPolicy(
            context,
            getTaskItemAccessPolicyWithDefault(taskItem),
        );
        if (immediateAccessPolicy.defaultGrant) return true;
    }

    // An array of `TaskCollectionId`s that authorize access to the task or `null` if
    // no `TaskCollectionId`s authorize access to the task.
    const authorizingCollectionItems = await runAllPromises(
        taskItem.collections.getArray().map(async ({collectionId}) => {
            const collectionItem = await loaders.getCollectionItem(collectionId);

            // Deleted collections don't grant any access.
            if (isTaskCollectionItemDeleted(collectionItem)) return false;

            const effectiveAccessPolicy = await intoEffectiveAccessPolicy(
                context,
                collectionItem.accessPolicy.value,
            );

            return !!effectiveAccessPolicy.defaultGrant;
        }),
    );

    // We evaluate the access policies for all collections on a task but we only need
    // one `defaultGrant` to be true.
    if (authorizingCollectionItems.some(value => value)) return true;

    if (taskItem.parentTaskId.value) {
        const parentTaskItem = await loaders.getTaskItem(taskItem.parentTaskId.value);

        // Parent tasks implicitly grant access to all of their child tasks. If we have a
        // parent task that is not deleted then check it before returning false.
        if (!parentTaskItem.deletedTime) {
            return await doesTaskItemHaveDefaultGrant(context, parentTaskItem, loaders);
        }
    }

    return false;
}

export async function getTaskItemEffectiveAccessPolicyWithoutAuthorization(
    context: ServerMinimalActionContext,
    rootTaskItem: TaskEssentialAttributesItemBase,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<EffectiveAccessPolicy> {
    const accountGrantById = new Map<AccountId, {level: AccessLevel}>();
    let defaultGrant: {level: AccessLevel} | null = null;
    let urlGrant: {level: "View"} | null = null;

    const seenCollectionIds = new Set<TaskCollectionId>();
    const seenTaskIds = new Set<TaskId>([rootTaskItem.taskId]);

    function addAccountGrant(accountId: AccountId, accessLevel: AccessLevel) {
        let accountGrant = accountGrantById.get(accountId);
        if (accountGrant === undefined) {
            accountGrant = {level: accessLevel};
            accountGrantById.set(accountId, accountGrant);
        } else {
            accountGrant.level = maxAccessLevel(accountGrant.level, accessLevel);
        }
    }

    function addDefaultGrant(accessLevel: AccessLevel) {
        if (defaultGrant === null) {
            defaultGrant = {level: accessLevel};
        } else {
            defaultGrant.level = maxAccessLevel(defaultGrant.level, accessLevel);
        }
    }

    function addUrlGrant(accessLevel: "View") {
        if (urlGrant === null) {
            urlGrant = {level: "View"};
        } else {
            // The only acceptable access level right now is `View`.
            cast<"View">(accessLevel);
        }
    }

    async function addGrants(rawAccessPolicy: AccessPolicy) {
        const accessPolicy = await intoEffectiveAccessPolicy(context, rawAccessPolicy);

        for (const [accountId, accountGrant] of accessPolicy.accountGrantById) {
            addAccountGrant(accountId, accountGrant.level);
        }

        if (accessPolicy.defaultGrant) {
            addDefaultGrant(accessPolicy.defaultGrant.level);
        }

        if (accessPolicy.urlGrant) {
            addUrlGrant(accessPolicy.urlGrant.level);
        }
    }

    async function addTaskGrants(taskItem: TaskEssentialAttributesItemBase) {
        await addGrants(getTaskItemAccessPolicyWithDefault(taskItem));

        if (taskItem.assigneeId.value) {
            addAccountGrant(taskItem.assigneeId.value, "Edit");
        }

        await runAllPromises([
            (async () => {
                if (!taskItem.parentTaskId.value) return;

                if (seenTaskIds.has(taskItem.parentTaskId.value)) return;
                seenTaskIds.add(taskItem.parentTaskId.value);

                const parentTaskItem = await getTaskItemForAuthorization(
                    context,
                    taskItem.parentTaskId.value,
                    null,
                    options,
                );

                if (parentTaskItem.deletedTime) return;

                await addTaskGrants(parentTaskItem);
            })(),
            runAllPromises(
                taskItem.collections.getArray().map(async ({collectionId}) => {
                    if (seenCollectionIds.has(collectionId)) return;
                    seenCollectionIds.add(collectionId);

                    const collectionItem = await getTaskCollectionItemForAuthorization(
                        context,
                        collectionId,
                        null,
                        options,
                    );

                    if (isTaskCollectionItemDeleted(collectionItem)) return;

                    await addGrants(collectionItem.accessPolicy.value);
                }),
            ),
        ]);
    }

    await addTaskGrants(rootTaskItem);

    return {
        accountGrantById,
        defaultGrant,
        urlGrant,
    };
}
