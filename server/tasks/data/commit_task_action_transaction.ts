import {addHours} from "date-fns";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {RynamoTransactionEntry} from "~/server/context/rynamo_transaction_entry.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {addFeedAccountCandidateEntry, addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getAccountIfExists} from "~/server/spaces/get_account.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {afterCommitTaskActionTransactionEventEmitterForTest} from "~/server/tasks/data/after_commit_task_action_transaction_event_emitter_for_test.js";
import {commitTaskActionTransactionBeforeExecuteTestCheckpoint} from "~/server/tasks/data/commit_task_action_transaction_before_execute_test_checkpoint.js";
import {
    authorizeTaskCollectionItemAccess,
    authorizeTaskCollectionItemAccessAllowingDeletedCollections,
    authorizeTaskItemAccess,
    authorizeTaskItemAccessAllowingDeletedTasks,
    doesTaskItemHaveDefaultGrant,
    getTaskItemAccessPolicyWithDefault,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {isTaskCollectionItemDeleted} from "~/server/tasks/data/internal/is_task_collection_item_deleted.js";
import {
    TaskAccountActionTransactionLeaseItem,
    TaskActionTable,
    TaskActionTransactionItem,
    TaskAssigneeAccountIdRegister,
    TaskStatusTypeRegister,
    TaskTable,
} from "~/server/tasks/data/internal/task_table.js";
import type {
    TaskCollectionEssentialAttributesItem,
    TaskEssentialAttributesItem,
} from "~/server/tasks/data/internal/task_table.js";
import {ensureLocalTaskIndexesIfEnabled} from "~/server/tasks/data/task_index.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyRegister,
    EffectiveAccessPolicy,
    ResolvedAccessPolicy,
} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {Context} from "~/shared/context/context.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {
    runAllPromiseThunks,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    SpaceId,
    TaskActionTransactionId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";
import {
    TaskAction,
    TaskActionSchema,
    TaskUpdateTaskAction,
    getTaskActionLabel,
} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";
import {
    createTaskCollectionNotFoundError,
    taskCollectionDeletedErrorDisplayMessage,
    taskDeletedErrorDisplayMessage,
} from "~/shared/tasks/task_error_messages.js";
import {TaskLayoutRegister} from "~/shared/tasks/task_layout.js";
import {
    TaskQueryDefaultsRegister,
    emptyTaskQueryDefaults,
} from "~/shared/tasks/task_query_defaults.js";

/**
 * Commit a transaction of `TaskAction`s. Authorizes that each action is valid
 * before committing it.
 *
 * When actions are applied to some view they are commutative and idempotent. That
 * means you can apply them in any order and you can apply them multiple times.
 * However, this function is not commutative and idempotent.
 *
 * To successfully commit an action you need to be allowed to modify the data
 * specified in the action. This means committing actions depends on the current
 * state, hence this function can't be commutative.
 *
 * However, because we implement authorization here it means once an action is
 * committed any downstream consumers don't need to factor in authorization rules
 * at all. Downstream consumers can apply actions in any order (thanks to their
 * commutative property) multiple times (thanks to their idempotent property).
 */
export function commitTaskActionTransaction(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskAction>,
    options: {
        clientId?: TaskRealtimeClientId | null;
        actorId?: AccountId;
        leaseId?: TaskActionTransactionLeaseId;
        createLeaseIfLostAccess?: {
            id: TaskActionTransactionLeaseId;
            actions: ReadonlyArray<TaskUpdateTaskAction>;
        };
        updateAccessPolicyShareNotification?: ShareNotification;
        extraTransactionEntries?: Array<DynamoTransactionEntry>;
        consistency?: DynamoCacheReadConsistency;
        waitForProcessing?: boolean;
        /**
         * Backdates the transaction's `committedTime` so tests can author histories a
         * known distance from a fixed time. Mirrors `overrideUpdatedTimeForTest` on
         * `updateTaskNotesContent()`.
         */
        overrideCommittedTimeForTest?: Date;
    } = {},
): Promise<{
    extraActions: ReadonlyArray<TaskAction>;
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    return context.tracer.withSpan("Commit task action transaction", async (context, span) => {
        span.addData({
            tasks: {
                actions: actions.map(getTaskActionLabel).join(","),
                actionCount: actions.length,
            },
        });

        // In our local environment, before committing make sure task indexes exist. That
        // way:
        //
        // 1. If there's an error creating task indexes it prevents actions from being
        //    committed
        // 2. There are no timeout warnings when processing task actions after they're
        //    committed (since ensuring task indexes may take a while)
        if (process.env.NODE_ENV !== "production") {
            await ensureLocalTaskIndexesIfEnabled(context);
        }

        if (
            options.actorId !== undefined &&
            context.actor.type !== "Bot" &&
            options.actorId !== context.actor.getPossiblyBotAccountId()
        ) {
            throw new PermissionDeniedError(
                "Only bots can commit task actions on behalf of other accounts",
            );
        }

        if (
            options.actorId !== undefined &&
            context.actor.type === "Bot" &&
            options.actorId !== context.actor.getPossiblyBotAccountId() &&
            !(await isAccountMemberOfSpace(context, spaceId, options.actorId))
        ) {
            const hasTaskAction = actions.some(action => action.type === "UpdateTask");
            const hasCollectionAction = actions.some(action => action.type === "UpdateCollection");

            throw new PermissionDeniedError(
                "Unexpected task action transaction actor outside of space",
                {
                    displayMessage:
                        hasTaskAction && !hasCollectionAction
                            ? errorDisplayMessage`Actor must be a member of the same space the task is in. Try again without an actor or with an actor in the same space as the task.`
                            : errorDisplayMessage`Actor must be a member of the same space the task collection is in. Try again without an actor or with an actor in the same space as the task collection.`,
                },
            );
        }

        if (
            options.updateAccessPolicyShareNotification &&
            !actions.some(
                action =>
                    (action.type === "UpdateCollection" &&
                        action.collectionAction.type === "UpdateAccessPolicy") ||
                    (action.type === "UpdateTask" &&
                        action.taskAction.type === "UpdateAccessPolicy"),
            )
        ) {
            throw new FailedPreconditionError(
                "Can only provide `updateAccessPolicyShareNotification` if there\u2019s an `UpdateAccessPolicy` action in the transaction",
            );
        }

        const {actionTransactionItem, extraActions, getRynamoEventsForSite} =
            await TaskActionTransactionCommitState.commit(context, spaceId, actions, options);

        span.addData({
            tasks: {
                actionTransactionId: actionTransactionItem.actionTransactionId,
            },
        });

        // Make sure we include extra actions in our `TracerSpan` if there were any.
        if (actionTransactionItem.actions.length > 0) {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                },
            });
        }

        const startTime = Date.now();

        const {processPromise} = await afterCommitTaskActionTransaction(
            context,
            actionTransactionItem,
        );

        // Make sure `endTime` is greater than `startTime` in case there was clock skew.
        const endTime = Math.max(startTime, Date.now());

        // Send a notification for all collections updated via the `UpdateAccessPolicy`
        // action in this transaction.
        if (options.updateAccessPolicyShareNotification) {
            for (const action of actions) {
                let entityId: FileEntityId | null = null;

                if (
                    action.type === "UpdateCollection" &&
                    action.collectionAction.type === "UpdateAccessPolicy"
                ) {
                    entityId = `TaskCollection:${action.collectionId}`;
                } else if (
                    action.type === "UpdateTask" &&
                    action.taskAction.type === "UpdateAccessPolicy"
                ) {
                    entityId = `Task:${action.taskId}`;
                }

                if (entityId === null) continue;

                context.jobs.send({
                    type: "SendShareNotification",
                    jobId: generateId(),
                    spaceId,
                    actorAccountId: context.actor.getPossiblyBotAccountId(),
                    entityId,
                    notification: options.updateAccessPolicyShareNotification,
                });
            }
        }

        if (options.waitForProcessing) {
            await processPromise;
        } else {
            // Try and wait until the transaction is processed before returning to the client.
            // We only wait up to 100ms then let the transaction processing finish in the
            // background.
            //
            // Given the client only sends one `commitTaskActionTransaction()` request at a
            // time, this helps reduce conflicts when indexing many sequential actions on the
            // same task (e.g. from typing in the title). And helps other users connected to
            // realtime see these actions in the same order they were made.
            await Promise.race([processPromise.catch(() => {}), wait(100 - (endTime - startTime))]);
        }

        return {
            extraActions,
            getRynamoEventsForSite,
        };
    });
}

export async function afterCommitTaskActionTransaction(
    context: ServerAccountActionContext,
    actionTransactionItem: TaskActionTransactionItem,
) {
    const processPromise = processTaskActionTransaction(context, actionTransactionItem);

    context.process.waitUntil(processPromise);

    afterCommitTaskActionTransactionEventEmitterForTest?.emit({
        spaceId: actionTransactionItem.spaceId,
        committedTime: actionTransactionItem.committedTime,
        actions: actionTransactionItem.actions,
        clientId: actionTransactionItem.clientId,
        processPromise,
    });

    // Always wait for us to apply the transaction in `TaskRealtimeService`. This
    // allows us to have read-after-write consistency with
    // `commitTaskActionTransaction()` as the write and `context.tasks.loadQuery()` as
    // the read (or anything else that makes a request to `TaskRealtimeService`).
    //
    // If you wait for `commitTaskActionTransaction()` to finish, you're guaranteed any
    // read to a `TaskRealtimeService` instance will see your newly committed data.
    await processPromise.applyActionTransactionInRealtimeServicePromise;

    return {processPromise};
}

export function processTaskActionTransaction(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    actionTransactionItem: TaskActionTransactionItem,
): Promise<void> & {
    applyActionTransactionInRealtimeServicePromise: Promise<void>;
} {
    let applyActionTransactionInRealtimeServicePromise: Promise<void> | null = null;

    const promise = context.tracer.withSpan(
        "Process task action transaction",
        async (context, span) => {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                    actionTransactionId: actionTransactionItem.actionTransactionId,
                },
            });

            applyActionTransactionInRealtimeServicePromise =
                context.tasks.applyActionTransactionInRealtimeService(actionTransactionItem);

            // Process the action transaction in the background.
            await runAllPromises([
                context.tasks.indexActionTransactionAssumingItsCommitted(actionTransactionItem),
                applyActionTransactionInRealtimeServicePromise,
            ]);

            // Once we've finished processing, flip the `wasProcessed` flag to true which will
            // also remove this transaction from our unprocessed transactions index.
            await TaskActionTable.createOrReplaceItem(context, {
                ...actionTransactionItem,
                wasProcessed: true,
            });
        },
    );

    return Object.assign(promise, {
        // Must return the apply action transaction promise separately.
        // `commitTaskActionTransaction()` waits for this before returning.
        applyActionTransactionInRealtimeServicePromise: assertExists(
            cast<Promise<void> | null>(applyActionTransactionInRealtimeServicePromise),
        ),
    });
}

export const taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression =
    "SET updateLockVersion = if_not_exists(updateLockVersion, :zero) + :one, taskCount = taskCount + :taskCountDelta, openTaskCount = openTaskCount + :openTaskCountDelta";

/**
 * Abstraction for managing state during a `commitTaskActionTransaction()` call. A
 * task may be updated multiple times within a transaction so we need to keep track
 * of previous writes and return them if another action in the transaction attempts
 * to read again.
 */
class TaskActionTransactionCommitState {
    private readonly _context: ServerAccountActionContext;
    private readonly _spaceId: SpaceId;
    private readonly _leaseId: TaskActionTransactionLeaseId | null;
    private readonly _providedActorIdFromBot: AccountId;
    private readonly _overrideCommittedTimeForTest: Date | null;
    private _startTime = Date.now();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByTaskId = new Map<
        TaskId,
        {
            action: "CreateItem" | "DirectlyUpdateItem" | "DirectlyUpdateItemLockVersion";
            taskItem: TaskEssentialAttributesItem;
            shouldCommitExtraUpdateChildrenCountAction: boolean;
        }
    >();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByCollectionId = new Map<
        TaskCollectionId,
        | {action: "CreateItem"; collectionItem: TaskCollectionEssentialAttributesItem}
        | {action: "DirectlyUpdateItem"; collectionItem: TaskCollectionEssentialAttributesItem}
        | {
              action: "AtomicallyUpdateItemAttributes";
              taskCountDelta: number;
              openTaskCountDelta: number;
              lastTaskAddedTime: HybridLogicalTime | null;
          }
    >();

    private readonly _additionalTransactionEntries: Array<
        DynamoTransactionEntry | RynamoTransactionEntry
    > = [];

    /**
     * Callbacks that produce realtime events for the site transaction entries we
     * pushed onto `_additionalTransactionEntries`. Invoked after the dynamo commit by
     * `commitTaskActionTransaction` to surface the events back to the caller.
     */
    private readonly _additionalSiteEventCallbacks: Array<
        (context: ServerActionContext) => Promise<RynamoEvent<SitePreviewModel | SiteEntryModel>>
    > = [];

    private readonly _actionTransactionLeaseTransactionEntries: Array<TaskAccountActionTransactionLeaseItem> =
        [];

    private readonly _taskItemById = new Map<TaskId, Promise<TaskEssentialAttributesItem | null>>();
    private readonly _collectionItemById = new Map<
        TaskCollectionId,
        Promise<TaskCollectionEssentialAttributesItem | null>
    >();

    private readonly _afterCommitActions: Array<
        (context: ServerAccountActionContext) => Promise<void>
    > = [];

    private readonly _consistency: DynamoCacheReadConsistency;

    private constructor(
        context: ServerAccountActionContext,
        {
            spaceId,
            leaseId,
            providedActorIdFromBot,
            consistency = "Eventual",
            overrideCommittedTimeForTest,
        }: {
            spaceId: SpaceId;
            leaseId: TaskActionTransactionLeaseId | null;
            providedActorIdFromBot: AccountId;
            consistency?: DynamoCacheReadConsistency;
            overrideCommittedTimeForTest?: Date;
        },
    ) {
        this._context = context;
        this._spaceId = spaceId;
        this._leaseId = leaseId;
        this._providedActorIdFromBot = providedActorIdFromBot;
        this._consistency = consistency;
        this._overrideCommittedTimeForTest = overrideCommittedTimeForTest ?? null;
    }

    public static commit(
        context: ServerAccountActionContext,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskAction>,
        {
            clientId = null,
            actorId: providedActorIdFromBot = context.actor.getPossiblyBotAccountId(),
            leaseId = null,
            createLeaseIfLostAccess,
            extraTransactionEntries,
            consistency,
            overrideCommittedTimeForTest,
        }: {
            clientId?: TaskRealtimeClientId | null;
            actorId?: AccountId;
            leaseId?: TaskActionTransactionLeaseId | null;
            createLeaseIfLostAccess?: {
                id: TaskActionTransactionLeaseId;
                actions: ReadonlyArray<TaskUpdateTaskAction>;
            };
            extraTransactionEntries?: Array<DynamoTransactionEntry>;
            consistency?: DynamoCacheReadConsistency;
            overrideCommittedTimeForTest?: Date;
        },
    ): Promise<{
        actionTransactionItem: TaskActionTransactionItem;
        extraActions: ReadonlyArray<TaskAction>;
        getRynamoEventsForSite: (
            context: ServerActionContext,
        ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
    }> {
        return context.dynamo.retryTransaction(async context => {
            await authorizeSpaceAccess(context, spaceId);

            if (!actions[0]) {
                throw new InvalidArgumentError("Must commit at least one action");
            }

            // If the actor is trying to use a lease to authorize their action transaction,
            // make sure the lease is valid before continuing.
            if (leaseId !== null) {
                const leaseItem = await TaskTable.getItemIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "TaskActionTransactionLease",
                    spaceId,
                    accountId: context.actor.getPossiblyBotAccountId(),
                    leaseId,
                });

                // If we can't find the lease we attempt to commit without it.
                //
                // - The lease may have expired. In that case the user should get an authorization
                //   failure.
                // - The client may have asked us to create a lease but we detected they don't need
                //   one so we didn't create a lease.
                if (!leaseItem || leaseItem.expirationTime.getTime() < Date.now()) {
                    leaseId = null;
                } else {
                    if (
                        !isDeepEqual(
                            actions.map(action =>
                                omitObject(TaskActionSchema.serialize(action), ["time"]),
                            ),
                            leaseItem.actions.map(action =>
                                omitObject(TaskActionSchema.serialize(action), ["time"]),
                            ),
                        )
                    ) {
                        throw new PermissionDeniedError(
                            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
                        );
                    }
                }
            }

            if (overrideCommittedTimeForTest) {
                assert(isTestNodeEnvOrAdminScenariosScript);
            }

            const state = new TaskActionTransactionCommitState(context, {
                spaceId,
                leaseId,
                providedActorIdFromBot,
                consistency,
                overrideCommittedTimeForTest,
            });
            await state._prepareCommit(actions);

            if (createLeaseIfLostAccess) {
                // The client tries to create a lease when a task leaves its view. If the actions
                // that cause the task to leave would cause the undo actions to fail then we create
                // a lease.
                //
                // This is an optimization. All the data needed to execute this should be cached.
                // Allows us to avoid creating leases when they're unnecessary.
                let hasLostAccess = false;
                try {
                    const forkedState = state._fork();
                    await forkedState._prepareCommit(createLeaseIfLostAccess.actions);

                    assert(
                        forkedState._afterCommitActions.length === 0,
                        "Can\u2019t register after commit callbacks for lease actions since we don\u2019t commit lease actions when creating the lease",
                    );
                } catch (error) {
                    if (error instanceof PermissionDeniedError) {
                        hasLostAccess = true;
                    } else {
                        throw error;
                    }
                }

                if (hasLostAccess) {
                    // Create a new state object and make sure we're allowed to commit the actions we
                    // want a lease for BEFORE the actions that cause us to lose access.
                    try {
                        const testState = new TaskActionTransactionCommitState(context, {
                            spaceId,
                            leaseId: null,
                            providedActorIdFromBot,
                        });
                        await testState._prepareCommit(createLeaseIfLostAccess.actions);

                        assert(
                            testState._afterCommitActions.length === 0,
                            "Can\u2019t register after commit callbacks for lease actions since we don\u2019t commit lease actions when creating the lease",
                        );
                    } catch (error) {
                        if (error instanceof PermissionDeniedError) {
                            throw PermissionDeniedError.from(
                                error,
                                "Couldn\u2019t apply lease actions",
                            );
                        } else {
                            throw error;
                        }
                    }

                    // Mark our lease as valid for all tasks in the transaction...
                    await runAllPromises(
                        createLeaseIfLostAccess.actions.map(async leaseAction => {
                            const task = await state.getTaskItem(leaseAction.taskId);

                            state.updateTaskItem({
                                ...task,
                                validLeaseId: createLeaseIfLostAccess.id,
                            });
                        }),
                    );

                    state._actionTransactionLeaseTransactionEntries.push({
                        partitionType: "Account",
                        sortRangeType: "TaskActionTransactionLease",
                        spaceId,
                        accountId: context.actor.getPossiblyBotAccountId(),
                        leaseId: createLeaseIfLostAccess.id,
                        actions: createLeaseIfLostAccess.actions,
                        // Leases have a short expiration time. You may not use a lease after two hours.
                        expirationTime: addHours(new Date(state._startTime), 2),
                    });
                }
            }

            return await state._applyCommit(actions, {
                clientId,
                extraTransactionEntries,
            });
        });
    }

    private async _prepareCommit(actions: ReadonlyArray<TaskAction>): Promise<void> {
        await actuallyCommitTaskActionTransaction(this, this._spaceId, actions);
    }

    private async _applyCommit(
        actions: ReadonlyArray<TaskAction>,
        {
            clientId,
            extraTransactionEntries,
        }: {
            clientId: TaskRealtimeClientId | null;
            extraTransactionEntries?: Array<DynamoTransactionEntry>;
        },
    ) {
        let maxActionTime = actions[0]!.time;
        for (let i = 1; i < actions.length; i++) {
            maxActionTime = maxHybridLogicalTime(maxActionTime, actions[i]!.time);
        }

        const transactionEntries: Array<DynamoTransactionEntry | RynamoTransactionEntry> = [];
        const extraActions: Array<TaskAction> = [];

        for (const transactionEntry of this._transactionEntryByTaskId.values()) {
            switch (transactionEntry.action) {
                case "CreateItem": {
                    transactionEntries.push(
                        TaskTable.transactionCreateItem(transactionEntry.taskItem),
                    );
                    break;
                }
                case "DirectlyUpdateItem": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItem(transactionEntry.taskItem),
                    );
                    break;
                }
                case "DirectlyUpdateItemLockVersion": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItemLockVersion(
                            transactionEntry.taskItem,
                            transactionEntry.taskItem.updateLockVersion,
                        ),
                    );
                    break;
                }
                default:
                    throw exhaustive(transactionEntry.action);
            }

            // If children counts were updated then we want to commit an extra action with the
            // authoritative child counts so all other clients have the correct children count.
            if (transactionEntry.shouldCommitExtraUpdateChildrenCountAction) {
                extraActions.push({
                    type: "UpdateTask",
                    // For our extra action's time, add a tick to the max action time.
                    time: [maxActionTime[0], maxActionTime[1] + 1],
                    taskId: transactionEntry.taskItem.taskId,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: transactionEntry.taskItem.addedChildTaskCount,
                        removedChildTaskCount: transactionEntry.taskItem.removedChildTaskCount,
                        addedClosedChildTaskCount:
                            transactionEntry.taskItem.addedClosedChildTaskCount,
                        removedClosedChildTaskCount:
                            transactionEntry.taskItem.removedClosedChildTaskCount,
                    },
                });
            }
        }

        for (const [collectionId, transactionEntry] of this._transactionEntryByCollectionId) {
            switch (transactionEntry.action) {
                case "CreateItem": {
                    transactionEntries.push(
                        TaskTable.transactionCreateItem(transactionEntry.collectionItem),
                    );
                    break;
                }
                case "DirectlyUpdateItem": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItem(transactionEntry.collectionItem),
                    );
                    break;
                }
                case "AtomicallyUpdateItemAttributes": {
                    const updateExpression =
                        taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression +
                        (transactionEntry.lastTaskAddedTime
                            ? ", lastTaskAddedTime = :lastTaskAddedTime"
                            : "");

                    const expressionAttributeValues: {[key: string]: SchemaSerializedValue} = {
                        ":zero": 0,
                        ":one": 1,
                        ":taskCountDelta": transactionEntry.taskCountDelta,
                        ":openTaskCountDelta": transactionEntry.openTaskCountDelta,
                    };

                    if (transactionEntry.lastTaskAddedTime) {
                        expressionAttributeValues[":lastTaskAddedTime"] =
                            HybridLogicalTimeSchema.serialize(transactionEntry.lastTaskAddedTime);
                    }

                    transactionEntries.push(
                        // We use a custom atomic update expression to update our collection without:
                        //
                        // 1. Needing to read the current collection item (costing additional RCUs)
                        // 2. Creating condition expression conflicts with other updates on the task
                        //    collection
                        TaskTable.dangerousTransactionUpdateItemWithCustomUpdateExpression(
                            {
                                partitionType: "TaskCollection",
                                sortRangeType: "EssentialAttributes",
                                collectionId,
                            },
                            {
                                updateExpression,
                                expressionAttributeValues,
                            },
                        ),
                    );
                    break;
                }
                default:
                    throw exhaustive(transactionEntry);
            }
        }

        for (const transactionEntry of extraTransactionEntries ?? []) {
            transactionEntries.push(transactionEntry);
        }

        for (const transactionEntry of this._additionalTransactionEntries) {
            transactionEntries.push(transactionEntry);
        }

        for (const transactionEntry of this._actionTransactionLeaseTransactionEntries) {
            transactionEntries.push(TaskTable.transactionCreateItem(transactionEntry));
        }

        await commitTaskActionTransactionBeforeExecuteTestCheckpoint.waitForTest(
            this._context.actor.getPossiblyBotAccountId(),
        );

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: this._spaceId,
            committedTime: this._overrideCommittedTimeForTest ?? new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [...actions, ...extraActions],
            wasProcessed: false,
            actor: this.getCreator(),
            clientId,
        };

        if (transactionEntries.length > 0) {
            transactionEntries.push(
                TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
            );

            // Use the general-realtime variant of `executeTransaction` so we can mix task
            // entries (`DynamoTransactionEntry`) with site entries (`RynamoTransactionEntry`)
            // in a single atomic write. The general-realtime variant accepts both types and
            // only broadcasts entries that came through general-realtime schemas, so task
            // entries continue to flow through their existing realtime broadcast path
            // unchanged.
            await RynamoTableSchema.executeTransaction(this._context, transactionEntries);
        } else {
            await TaskActionTable.createOrReplaceItem(this._context, actionTransactionItem);
        }

        // Hooray! We've successfully committed the transaction. Now run our after commit
        // actions...
        if (this._afterCommitActions.length > 0) {
            await runAllPromises(this._afterCommitActions.map(action => action(this._context)));
        }

        // Capture the site event callbacks now so the closure doesn't keep a reference to
        // the entire commit state.
        const siteEventCallbacks = this._additionalSiteEventCallbacks;

        return {
            actionTransactionItem,
            extraActions,
            getRynamoEventsForSite: (eventContext: ServerActionContext) =>
                runAllPromises(siteEventCallbacks.map(getEvent => getEvent(eventContext))),
        };
    }

    /**
     * Fork this commit state object so you can attempt to prepare more actions based
     * on the updates we've already made to the state without affecting the original
     * state's committed data.
     */
    private _fork() {
        const newState = new TaskActionTransactionCommitState(this._context, {
            spaceId: this._spaceId,
            // The forked state does not inherit the lease. It must authorize on its own.
            leaseId: null,
            providedActorIdFromBot: this._providedActorIdFromBot,
        });
        newState._startTime = this._startTime;

        for (const [taskId, taskItem] of this._taskItemById) {
            newState._taskItemById.set(taskId, taskItem);
        }

        for (const [collectionId, collectionItem] of this._collectionItemById) {
            newState._collectionItemById.set(collectionId, collectionItem);
        }

        return newState;
    }

    public getActorAccountId(): AccountId {
        return this._context.actor.getPossiblyBotAccountId();
    }

    public getCreator(): TaskCreator {
        const actorIdFromContext = this.getActorAccountId();

        // We throw a `PermissionDeniedError` much earlier if the actor is not a bot and
        // `actorId` isn't equal to what's in context, but double check once again here
        // right before committing.
        assert(
            this._context.actor.type === "Bot" ||
                this._providedActorIdFromBot === actorIdFromContext,
        );

        return {
            accountId: this._providedActorIdFromBot,
            from:
                this._providedActorIdFromBot !== actorIdFromContext
                    ? {type: "Bot", accountId: actorIdFromContext}
                    : null,
        };
    }

    public getActorType() {
        return this._context.actor.type;
    }

    public getAccountIfExists(accountId: AccountId): Promise<AccountModel | null> {
        return getAccountIfExists(this._context, this._spaceId, accountId, {
            consistency: this._consistency,
        });
    }

    public isAccountMemberOfSpace(accountId: AccountId): Promise<boolean> {
        return isAccountMemberOfSpace(this._context, this._spaceId, accountId);
    }

    /**
     * Clients specify change times for various properties and we use change times to
     * resolve conflicting updates. Clients may specify a change time at any point in
     * the past (maybe they are syncing offline updates) but they may not specify a
     * change time too far in the future.
     *
     * We provide some wiggle room to account for clock skew. It's required that
     * clients use NTP to get a time (through our `/api/time` route implemented in
     * `EdgeService`) that's consistent with other clients instead of relying on the
     * device clock.
     */
    public isTimeReasonable(time: number): boolean {
        return time - this._startTime < 1000 * 60 * 2;
    }

    public getTaskItemIfExists(taskId: TaskId): Promise<TaskEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._taskItemById, taskId, async () => {
            const taskItem = await TaskTable.getItemIfExists(
                this._context,
                {
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId,
                },
                {consistency: this._consistency},
            );
            if (!taskItem) return null;

            if (taskItem.spaceId !== this._spaceId) {
                throw createAuthorizeSpaceAccessPermissionDeniedError(
                    taskItem.spaceId,
                    this._context.actor.getPossiblyBotAccountId(),
                    "Member",
                );
            }

            return taskItem;
        });
    }

    public async getTaskItem(taskId: TaskId): Promise<TaskEssentialAttributesItem> {
        const taskItem = await this.getTaskItemIfExists(taskId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!taskItem) throw new InternalError("Task not found");

        return taskItem;
    }

    public createTaskItem(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "CreateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                throw new FailedPreconditionError(
                    "Can\u2019t update a task before it\u2019s created",
                );
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));
    }

    public updateTaskItem(
        taskItem: TaskEssentialAttributesItem,
        {
            shouldCommitExtraUpdateChildrenCountAction = false,
        }: {
            // If set to true then we will add an `UpdateChildrenCount` action to the end of
            // the current transaction before committing.
            shouldCommitExtraUpdateChildrenCountAction?: boolean;
        } = {},
    ) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        transactionEntry.shouldCommitExtraUpdateChildrenCountAction ||=
            shouldCommitExtraUpdateChildrenCountAction;

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
                break;
            case "DirectlyUpdateItemLockVersion":
                transactionEntry.action = "DirectlyUpdateItem";
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));
    }

    public updateTaskItemLockVersion(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItemLockVersion" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
    }

    /**
     * If the action time was more than an hour in the past then we don't set it as the
     * new `lastTaskAddedTime` since it would look like the last update time was
     * skipping backwards since we can't run `max()` in a DynamoDB update expression.
     */
    private _isCollectionLastTaskAddedTimeReasonable(time: HybridLogicalTime) {
        return this._startTime - time[0] < 1000 * 60;
    }

    private _applyCollectionUpdateItemAttributes(
        collectionItem: TaskCollectionEssentialAttributesItem,
        {
            taskCountDelta,
            openTaskCountDelta,
            lastTaskAddedTime,
        }: {
            taskCountDelta: number;
            openTaskCountDelta: number;
            lastTaskAddedTime: HybridLogicalTime | null;
        },
    ): TaskCollectionEssentialAttributesItem {
        return {
            ...collectionItem,
            taskCount: collectionItem.taskCount + taskCountDelta,
            openTaskCount: collectionItem.openTaskCount + openTaskCountDelta,
            lastTaskAddedTime:
                lastTaskAddedTime &&
                this._isCollectionLastTaskAddedTimeReasonable(lastTaskAddedTime)
                    ? lastTaskAddedTime
                    : collectionItem.lastTaskAddedTime,
        };
    }

    public getCollectionItemIfExists(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._collectionItemById, collectionId, async () => {
            let collectionItem = await TaskTable.getItemIfExists(
                this._context,
                {
                    partitionType: "TaskCollection",
                    sortRangeType: "EssentialAttributes",
                    collectionId,
                },
                {consistency: this._consistency},
            );
            if (!collectionItem) return null;

            if (collectionItem.spaceId !== this._spaceId) {
                throw createAuthorizeSpaceAccessPermissionDeniedError(
                    collectionItem.spaceId,
                    this._context.actor.getPossiblyBotAccountId(),
                    "Member",
                );
            }

            // If we have an atomic update transaction entry, we need to apply it when the
            // collection is loaded. Since we can't put an entry in `collectionItemById` when
            // the update is applied.
            const transactionEntry = this._transactionEntryByCollectionId.get(collectionId);
            if (transactionEntry?.action === "AtomicallyUpdateItemAttributes") {
                collectionItem = this._applyCollectionUpdateItemAttributes(
                    collectionItem,
                    transactionEntry,
                );
            }

            return collectionItem;
        });
    }

    public async getCollectionItem(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem> {
        const collectionItem = await this.getCollectionItemIfExists(collectionId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!collectionItem) throw new InternalError("Task collection not found");

        return collectionItem;
    }

    public createCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                collectionItem,
                action: "CreateItem" as const,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "AtomicallyUpdateItemAttributes":
                throw new FailedPreconditionError(
                    "Can\u2019t update a collection before it\u2019s created",
                );
            default:
                throw exhaustive(transactionEntry);
        }

        if (transactionEntry.collectionItem.updateLockVersion !== collectionItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.collectionItem = collectionItem;
        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));
    }

    public updateCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                collectionItem,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem": {
                if (
                    transactionEntry.collectionItem.updateLockVersion !==
                    collectionItem.updateLockVersion
                ) {
                    throw new InternalError(
                        "`updateLockVersion` should only change after we commit to the database",
                    );
                }

                transactionEntry.collectionItem = collectionItem;
                break;
            }
            case "AtomicallyUpdateItemAttributes": {
                // We don't need to apply atomic updates here since they should have already been
                // applied when the calling code read the collection from our state.

                this._transactionEntryByCollectionId.set(collectionItem.collectionId, {
                    action: "DirectlyUpdateItem",
                    collectionItem,
                });
                break;
            }
            default:
                throw exhaustive(transactionEntry);
        }

        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));
    }

    public updateCollectionItemAttributes(
        collectionId: TaskCollectionId,
        update: {
            taskCountDelta: number;
            openTaskCountDelta: number;
            lastTaskAddedTime: HybridLogicalTime | null;
        },
    ) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionId,
            () => ({
                action: "AtomicallyUpdateItemAttributes" as const,
                taskCountDelta: 0,
                openTaskCountDelta: 0,
                lastTaskAddedTime: null,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem": {
                transactionEntry.collectionItem = this._applyCollectionUpdateItemAttributes(
                    transactionEntry.collectionItem,
                    update,
                );

                this._collectionItemById.set(
                    collectionId,
                    Promise.resolve(transactionEntry.collectionItem),
                );
                break;
            }
            case "AtomicallyUpdateItemAttributes": {
                transactionEntry.taskCountDelta += update.taskCountDelta;
                transactionEntry.openTaskCountDelta += update.openTaskCountDelta;
                transactionEntry.lastTaskAddedTime =
                    update.lastTaskAddedTime &&
                    this._isCollectionLastTaskAddedTimeReasonable(update.lastTaskAddedTime)
                        ? update.lastTaskAddedTime
                        : transactionEntry.lastTaskAddedTime;

                // If a collection item has been loaded then we need to apply our update to that
                // item.
                const collectionItemPromise = this._collectionItemById.get(collectionId);
                if (collectionItemPromise) {
                    this._collectionItemById.set(
                        collectionId,
                        collectionItemPromise.then(collectionItem =>
                            collectionItem
                                ? this._applyCollectionUpdateItemAttributes(collectionItem, update)
                                : null,
                        ),
                    );
                }
                break;
            }
            default:
                throw exhaustive(transactionEntry);
        }
    }

    public getEffectiveAccessPolicy(accessPolicy: AccessPolicy): Promise<EffectiveAccessPolicy> {
        return intoEffectiveAccessPolicy(this._context, accessPolicy);
    }

    public async isDefaultAccessPolicyForContentCreatedByBot(
        accessPolicy: CreateOrUpdateAccessPolicy,
    ): Promise<boolean> {
        if (this._context.actor.type !== "Bot") return false;

        const botContext = await this._context.actor.authenticate();
        const defaultAccessPolicy = await createAccessPolicyForContentCreatedByBot(
            botContext,
            this._spaceId,
            {consistency: this._consistency},
        );

        return isDeepEqual(accessPolicy, defaultAccessPolicy);
    }

    public async validateAccessPolicyUpdate(
        entityId: SearchEntityId,
        oldAccessPolicy: AccessPolicy | null,
        newAccessPolicy: CreateOrUpdateAccessPolicy,
    ): Promise<ResolvedAccessPolicy> {
        const {resolvedAccessPolicy, transactionEntries} =
            await validateAccessPolicyUpdateForServer(
                this._context,
                this._spaceId,
                entityId,
                oldAccessPolicy,
                newAccessPolicy,
            );

        // Each entry in `add` / `remove` is `{transactionEntry, getEvent}`. Push the raw
        // `transactionEntry` (cast through `unknown` because the injection module declares
        // an opaque marker class to avoid a circular Bazel dependency between
        // `//server/context` and `//server/rynamo`) and store the `getEvent` callback so
        // we can produce realtime events at commit time.
        for (const entry of transactionEntries) {
            this._additionalTransactionEntries.push(entry.transactionEntry);
            this._additionalSiteEventCallbacks.push(entry.getEvent);
        }

        return resolvedAccessPolicy;
    }

    public async authorizeCollectionAccess(
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        await authorizeTaskCollectionItemAccess(this._context, collectionItem, expectedAccessLevel);
    }

    public async authorizeCollectionAccessAllowingDeletedCollections(
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        await authorizeTaskCollectionItemAccessAllowingDeletedCollections(
            this._context,
            collectionItem,
            expectedAccessLevel,
        );
    }

    public async authorizeTaskItemAccess(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: AccessLevel,
    ) {
        // If we are using a lease and the lease is valid for this task, skip
        // authorization. The lease allows us to take otherwise disallowed actions.
        if (this._leaseId !== null && this._leaseId === taskItem.validLeaseId) return;

        await authorizeTaskItemAccess(this._context, taskItem, expectedAccessLevel, this, {
            consistency: this._consistency,
        });
    }

    public async authorizeTaskItemAccessAllowingDeletedTasks(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: AccessLevel,
    ) {
        // If we are using a lease and the lease is valid for this task, skip
        // authorization. The lease allows us to take otherwise disallowed actions.
        if (this._leaseId !== null && this._leaseId === taskItem.validLeaseId) return;

        await authorizeTaskItemAccessAllowingDeletedTasks(
            this._context,
            taskItem,
            expectedAccessLevel,
            this,
            {consistency: this._consistency},
        );
    }

    public doesTaskItemHaveDefaultGrant(taskItem: TaskEssentialAttributesItem) {
        return doesTaskItemHaveDefaultGrant(this._context, taskItem, this);
    }

    /**
     * Run some code after the action transaction has successfully committed.
     *
     * You can't register after commit actions when creating a lease (an error will be
     * thrown). Since we don't actually commit lease actions until later.
     */
    public registerAfterCommitAction(
        action: (context: ServerAccountActionContext) => Promise<void>,
    ) {
        this._afterCommitActions.push(action);
    }
}

const circularTaskDependencyErrorDisplayMessage = errorDisplayMessage`Can\u2019t move a task to the subtasks of one of its own subtasks. Check your task\u2019s subtasks and try removing the one you want to move your task into.`;

async function actuallyCommitTaskActionTransaction(
    // We intentionally don't pass in `context` since we want all DynamoDB access to go
    // through this `state` object. That way we force reads to go through our local
    // cache.
    state: TaskActionTransactionCommitState,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskAction>,
) {
    for (const action of actionTransaction) {
        // Make sure our action time isn't too far in the future. That would mean future
        // updates all need to use the `ticks` property of `HybridLogicalTime` and couldn't
        // express the update time with a real time.
        if (!state.isTimeReasonable(action.time[0])) {
            throw new InvalidArgumentError("Action time too far in the future");
        }

        switch (action.type) {
            case "UpdateTask": {
                const {taskId, taskAction} = action;

                switch (taskAction.type) {
                    case "Create": {
                        if (!isDeepEqual(taskAction.creator, state.getCreator())) {
                            throw new PermissionDeniedError(
                                "Task creator must exactly match the task action transaction actor",
                            );
                        }

                        const newResolvedAccessPolicy = taskAction.accessPolicy
                            ? await state.validateAccessPolicyUpdate(
                                  `Task:${taskId}`,
                                  null,
                                  taskAction.accessPolicy,
                              )
                            : null;

                        const shouldAddFeedCandidateEntryForCreate =
                            !!newResolvedAccessPolicy?.defaultGrant &&
                            !(
                                taskAction.accessPolicy &&
                                (await state.isDefaultAccessPolicyForContentCreatedByBot(
                                    taskAction.accessPolicy,
                                ))
                            );

                        const newTaskItem: TaskEssentialAttributesItem = {
                            partitionType: "Task",
                            sortRangeType: "EssentialAttributes",
                            taskId,
                            spaceId,
                            creatorId: taskAction.creator.accountId,
                            creatorFrom: taskAction.creator.from,
                            createdTime: action.time,
                            deletedTime: null,
                            statusType: new TaskStatusTypeRegister("Open", action.time),
                            parentTaskId: new TaskParentTaskIdRegister(null, action.time),
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            childTaskIds: new Set(),
                            collections: TaskCollectionSet.empty,
                            assigneeId: new TaskAssigneeAccountIdRegister(null, action.time),
                            // Empty tasks have an access policy of null for historic reasons. When we added
                            // `accessPolicy` to tasks all existing task index docs default their
                            // `accessPolicy` to null. So the behavior of a task without an
                            // `UpdateAccessPolicy` action is as if the `accessPolicy` never existed in the
                            // first place.
                            accessPolicy: taskAction.accessPolicy
                                ? new AccessPolicyRegister(taskAction.accessPolicy, action.time)
                                : null,
                            layout: null,
                            feed: shouldAddFeedCandidateEntryForCreate
                                ? "AddedCandidateEntry"
                                : null,
                            validLeaseId: null,
                        };

                        state.createTaskItem(newTaskItem);

                        if (newTaskItem.feed !== null) {
                            // New tasks have not yet added a feed entry for the creator, so allow this entry
                            // through to the creator feed as well.
                            registerSharedTaskFeedCandidateEntry(state, spaceId, {
                                taskId,
                                time: action.time,
                                taskItem: newTaskItem,
                                excludeFromCreatorFeed: false,
                            });
                        }
                        break;
                    }
                    case "Undelete": {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (!taskItem.deletedTime) {
                            throw new FailedPreconditionError("Expected task to be deleted");
                        }

                        await state.authorizeTaskItemAccessAllowingDeletedTasks(taskItem, "Edit");

                        if (compareHybridLogicalTimes(action.time, taskItem.deletedTime) <= 0) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        const seenTaskIds = new Set([taskItem.taskId]);
                        let currentParentTaskItem = taskItem;

                        while (currentParentTaskItem.parentTaskId.value !== null) {
                            // We don't allow task circular dependencies which would cause infinite looping.
                            // Deleted tasks break the circular dependency chain. So a circular dependency may
                            // exist involving a deleted task. When we undelete, we need to make sure it
                            // doesn't create a circular dependency.
                            if (seenTaskIds.has(currentParentTaskItem.parentTaskId.value)) {
                                throw new FailedPreconditionError(
                                    "Undeleting task would create a circular dependency",
                                    {
                                        // NOTE(calebmer): Ideally the error message would have a hint. This error case
                                        // seems pretty rare. I'd want to know what the UI of this looks like to write an
                                        // appropriate hint. (e.g. Can you see the old parent task?)
                                        displayMessage: errorDisplayMessage`Undoing task deletion would make the task its own subtask.`,
                                    },
                                );
                            }

                            const nextParentTaskItem = await state.getTaskItem(
                                currentParentTaskItem.parentTaskId.value,
                            );

                            // Deleted tasks do not participate in circular dependencies.
                            if (nextParentTaskItem.deletedTime) break;

                            seenTaskIds.add(nextParentTaskItem.taskId);
                            currentParentTaskItem = nextParentTaskItem;
                        }

                        // Force updates to a root task's subtask tree to be serialized. That way race
                        // conditions can't sneak a circular dependency in.
                        state.updateTaskItemLockVersion(currentParentTaskItem);

                        state.updateTaskItem({
                            ...taskItem,
                            deletedTime: null,
                            // Invalidate any leases on this task now that another user has updated it.
                            validLeaseId: null,
                        });

                        if (taskItem.parentTaskId.value !== null) {
                            // May be cached from authorization...
                            const parentTaskItem = await state.getTaskItem(
                                taskItem.parentTaskId.value,
                            );

                            state.updateTaskItem(
                                {
                                    ...parentTaskItem,
                                    addedChildTaskCount: parentTaskItem.addedChildTaskCount + 1,
                                    addedClosedChildTaskCount:
                                        parentTaskItem.addedClosedChildTaskCount +
                                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                                },
                                {shouldCommitExtraUpdateChildrenCountAction: true},
                            );
                        }

                        for (const {collectionId} of taskItem.collections.getArray()) {
                            state.updateCollectionItemAttributes(collectionId, {
                                taskCountDelta: 1,
                                openTaskCountDelta: taskItem.statusType.value === "Open" ? 1 : 0,
                                lastTaskAddedTime: action.time,
                            });
                        }
                        break;
                    }
                    default: {
                        const initialTaskItem = await state.getTaskItemIfExists(taskId);
                        if (!initialTaskItem) throw new NotFoundError("Task not found");
                        let taskItem = initialTaskItem;

                        await state.authorizeTaskItemAccess(taskItem, "Edit");

                        if (taskItem.deletedTime) {
                            throw new FailedPreconditionError("Task was deleted", {
                                displayMessage: taskDeletedErrorDisplayMessage,
                            });
                        }

                        if (taskItem.validLeaseId !== null) {
                            taskItem = {
                                ...taskItem,
                                // Invalidate any leases on this task now that another user has updated it.
                                validLeaseId: null,
                            };
                            state.updateTaskItem(taskItem);
                        }

                        switch (taskAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(action.time, taskItem.createdTime) <=
                                    0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    deletedTime: action.time,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    // May be cached from authorization...
                                    const parentTaskItem = await state.getTaskItem(
                                        taskItem.parentTaskId.value,
                                    );

                                    state.updateTaskItem(
                                        {
                                            ...parentTaskItem,
                                            removedChildTaskCount:
                                                parentTaskItem.removedChildTaskCount + 1,
                                            removedClosedChildTaskCount:
                                                parentTaskItem.removedClosedChildTaskCount +
                                                (taskItem.statusType.value === "Closed" ? 1 : 0),
                                        },
                                        {shouldCommitExtraUpdateChildrenCountAction: true},
                                    );
                                }

                                for (const {collectionId} of taskItem.collections.getArray()) {
                                    state.updateCollectionItemAttributes(collectionId, {
                                        taskCountDelta: -1,
                                        openTaskCountDelta:
                                            taskItem.statusType.value === "Open" ? -1 : 0,
                                        lastTaskAddedTime: null,
                                    });
                                }
                                break;
                            }
                            case "UpdateParentTaskId": {
                                if (
                                    taskAction.parentPosition &&
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                // We want to prevent the creation of cycles even during race conditions. So we
                                // call `updateTaskItemLockVersion()` on critical parent tasks that can't update
                                // without us knowing about it. We call this method on:
                                //
                                // 1. The root parent task in the new parent task chain
                                // 2. The root parent task in the old parent task chain
                                //
                                // This has the effect of forcing any change to subtask structure under a root task
                                // to be committed serially. If the root task itself is made the subtask of some
                                // other task than that update too must be serialized with changes to its subtask
                                // structure. By serializing updates to subtask structure we can make sure no
                                // circular dependencies are introduced.
                                await runAllPromiseThunks(
                                    // Authorize new parent `TaskId`:
                                    async () => {
                                        if (taskAction.parentTaskId === null) return;

                                        if (taskId === taskAction.parentTaskId) {
                                            throw new FailedPreconditionError(
                                                "Updating task\u2019s `parentTaskId` would create a circular dependency",
                                                {
                                                    displayMessage:
                                                        circularTaskDependencyErrorDisplayMessage,
                                                },
                                            );
                                        }

                                        const newParentTaskItem = await state.getTaskItemIfExists(
                                            taskAction.parentTaskId,
                                        );
                                        if (!newParentTaskItem)
                                            throw new NotFoundError("Parent task not found");
                                        if (newParentTaskItem.deletedTime)
                                            throw new FailedPreconditionError(
                                                "Parent task is deleted",
                                            );

                                        // Make sure we have edit access to the parent task in order to make this task a
                                        // child of it.
                                        await state.authorizeTaskItemAccess(
                                            newParentTaskItem,
                                            "Edit",
                                        );

                                        const seenTaskIds = new Set([
                                            taskId,
                                            newParentTaskItem.taskId,
                                        ]);
                                        let currentNewParentTaskItem = newParentTaskItem;

                                        while (
                                            currentNewParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            // We don't allow task circular dependencies which would cause infinite looping. If
                                            // we see that updating our `parentTaskId` would create a circular dependency then
                                            // error.
                                            if (
                                                seenTaskIds.has(
                                                    currentNewParentTaskItem.parentTaskId.value,
                                                )
                                            ) {
                                                throw new FailedPreconditionError(
                                                    "Updating task\u2019s `parentTaskId` would create a circular dependency",
                                                    {
                                                        displayMessage:
                                                            circularTaskDependencyErrorDisplayMessage,
                                                    },
                                                );
                                            }

                                            // Parent task loading may be cached by our `authorizeTaskItemAccess()` call
                                            // earlier.
                                            const nextNewParentTaskItem = await state.getTaskItem(
                                                currentNewParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextNewParentTaskItem.deletedTime) break;

                                            seenTaskIds.add(nextNewParentTaskItem.taskId);
                                            currentNewParentTaskItem = nextNewParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentNewParentTaskItem);
                                    },
                                    // Authorize old parent `TaskId`:
                                    async () => {
                                        if (taskItem.parentTaskId.value === null) return;

                                        const oldParentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );
                                        if (oldParentTaskItem.deletedTime) return;

                                        // We allow you to change the parent of a task you have edit access to even if you
                                        // don't have access to the _current_ parent task. This is because we also allow
                                        // you to delete tasks even when you don't have access to the current parent task.
                                        // That operation will remove a child task from a parent task so it follows a user
                                        // is allowed to remove tasks they have access to from unknown parents.
                                        //
                                        // Should we allow deleting a task when you don't have access to the parent?
                                        // Arguably not. But it's hard to explain a restriction like that in the UI and the
                                        // restriction is not too bad if we explain it in the revision feed.
                                        //
                                        // TODO(calebmer): When we add revision history, deleting or changing the parent of
                                        // a child task should add a revision history entry to the parent task. That way a
                                        // user who has access to the child but not the parent can have their changes
                                        // audited.

                                        let currentOldParentTaskItem = oldParentTaskItem;

                                        while (
                                            currentOldParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            const nextOldParentTaskItem = await state.getTaskItem(
                                                currentOldParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextOldParentTaskItem.deletedTime) break;

                                            currentOldParentTaskItem = nextOldParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentOldParentTaskItem);
                                    },
                                );

                                const oldParentTaskId = taskItem.parentTaskId;
                                const newParentTaskId = oldParentTaskId.apply({
                                    value: taskAction.parentTaskId,
                                    version: action.time,
                                });

                                const newTaskItem: TaskEssentialAttributesItem = {
                                    ...taskItem,
                                    parentTaskId: newParentTaskId.apply({
                                        value: taskAction.parentTaskId,
                                        version: action.time,
                                    }),
                                };

                                state.updateTaskItem(newTaskItem);

                                // If the parent task changed then increment our counters such that we remove our
                                // task from the old parent and add our task to the new parent.
                                if (oldParentTaskId.value !== newParentTaskId.value) {
                                    await runAllPromiseThunks(
                                        async () => {
                                            if (oldParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const oldParentTaskItem = await state.getTaskItem(
                                                oldParentTaskId.value,
                                            );

                                            const oldParentChildTaskIds = new Set(
                                                oldParentTaskItem.childTaskIds,
                                            );
                                            oldParentChildTaskIds.delete(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...oldParentTaskItem,
                                                    removedChildTaskCount:
                                                        oldParentTaskItem.removedChildTaskCount + 1,
                                                    removedClosedChildTaskCount:
                                                        oldParentTaskItem.removedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: oldParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                        async () => {
                                            if (newParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const newParentTaskItem = await state.getTaskItem(
                                                newParentTaskId.value,
                                            );

                                            const newParentChildTaskIds = new Set(
                                                newParentTaskItem.childTaskIds,
                                            );
                                            newParentChildTaskIds.add(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...newParentTaskItem,
                                                    addedChildTaskCount:
                                                        newParentTaskItem.addedChildTaskCount + 1,
                                                    addedClosedChildTaskCount:
                                                        newParentTaskItem.addedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: newParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                    );
                                }

                                await maybeAddFeedCandidateEntryAfterAddCollectionOrUpdateParentTaskId(
                                    newTaskItem,
                                );
                                break;
                            }
                            case "UpdateParentPosition": {
                                if (
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.parentTaskId.value === null) {
                                    throw new FailedPreconditionError(
                                        "Task doesn\u2019t have a parent",
                                    );
                                }

                                const parentTaskItem = await state.getTaskItem(
                                    taskItem.parentTaskId.value,
                                );
                                if (parentTaskItem.deletedTime)
                                    throw new FailedPreconditionError("Parent task is deleted");

                                // Make sure we have edit access to the parent task. The order key is more-so a
                                // property of the parent task than it is a property of our task.
                                await state.authorizeTaskItemAccess(parentTaskItem, "Edit");
                                break;
                            }
                            case "UpdateChildrenCounts": {
                                // These actions may only be generated by the server.
                                //
                                // See the documentation on `TaskUpdateChildrenCountsAction` for more information
                                // on why this isn't allowed.
                                throw new InvalidArgumentError(
                                    "Clients are not allowed to commit an `UpdateChildrenCounts` action",
                                );
                            }
                            case "AddCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                const newTaskItem: TaskEssentialAttributesItem = {
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Set",
                                        key: taskAction.collectionId,
                                        value: taskAction.orderKey,
                                        version: action.time,
                                    }),
                                };

                                state.updateTaskItem(newTaskItem);

                                state.updateCollectionItemAttributes(taskAction.collectionId, {
                                    taskCountDelta: 1,
                                    openTaskCountDelta:
                                        taskItem.statusType.value === "Open" ? 1 : 0,
                                    lastTaskAddedTime: action.time,
                                });

                                await maybeAddFeedCandidateEntryAfterAddCollectionOrUpdateParentTaskId(
                                    newTaskItem,
                                );
                                break;
                            }
                            case "RemoveCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Delete",
                                        key: taskAction.collectionId,
                                        version: action.time,
                                    }),
                                });

                                state.updateCollectionItemAttributes(taskAction.collectionId, {
                                    taskCountDelta: -1,
                                    openTaskCountDelta:
                                        taskItem.statusType.value === "Open" ? -1 : 0,
                                    lastTaskAddedTime: null,
                                });
                                break;
                            }
                            case "UpdateCollectionPosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (!taskItem.collections.has(taskAction.collectionId)) {
                                    throw new FailedPreconditionError("Task is not in collection");
                                }

                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );
                                break;
                            }
                            case "UpdateStatus": {
                                if (
                                    taskAction.status.type === "Closed" &&
                                    !state.isTimeReasonable(
                                        taskAction.status.closedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `closedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.status.type === "Closed" &&
                                    taskAction.status.closerId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only close a task with yourself as the closer",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatus?.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                const oldStatusType = taskItem.statusType;

                                const newStatusType = oldStatusType.apply({
                                    value: taskAction.status.type,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    statusType: newStatusType,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                addedClosedChildTaskCount:
                                                    parentTaskItem.addedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                removedClosedChildTaskCount:
                                                    parentTaskItem.removedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }
                                }

                                for (const {collectionId} of taskItem.collections.getArray()) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        state.updateCollectionItemAttributes(collectionId, {
                                            taskCountDelta: 0,
                                            openTaskCountDelta: -1,
                                            lastTaskAddedTime: null,
                                        });
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        state.updateCollectionItemAttributes(collectionId, {
                                            taskCountDelta: 0,
                                            openTaskCountDelta: 1,
                                            lastTaskAddedTime: null,
                                        });
                                    }
                                }
                                break;
                            }
                            case "UpdateAssignee": {
                                if (
                                    taskAction.assignee &&
                                    !state.isTimeReasonable(
                                        taskAction.assignee.assignedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `assignedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    taskAction.assignee.assignerId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only assign a task with yourself as the assigner",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    // We intentionally use `getAccountIfExists()` instead of
                                    // `isAccountMemberOfSpace()` here. If an account is removed from a space it should
                                    // still be ok setting the removed account as a task assignee. Though it's probably
                                    // unwise for a user to do so.
                                    !(await state.getAccountIfExists(
                                        taskAction.assignee.assigneeId,
                                    ))
                                ) {
                                    throw new FailedPreconditionError(
                                        "Can\u2019t assign a task to an account outside of the current space",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatus?.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    assigneeId: taskItem.assigneeId.apply({
                                        value: taskAction.assignee?.assigneeId ?? null,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            case "UpdateAssigneeStatus": {
                                if (
                                    taskAction.assigneeStatus.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdateAssigneePosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.assigneeId.value !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only update the task\u2019s assignee position if you are the task\u2019s assignee",
                                    );
                                }

                                if (taskAction.accountId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Must use the actor `AccountId` when updating the task\u2019s assignee position",
                                    );
                                }
                                break;
                            }
                            case "UpdateTitle": {
                                // Y.js uses Lamport timestamps which we don't need to validate for reasonableness.
                                break;
                            }
                            case "UpdateDueDate": {
                                // We don't store due date in essential attributes and action time is validated
                                // above.
                                break;
                            }
                            case "UpdatePriority": {
                                // We don't store priority in essential attributes and action time is validated
                                // above.
                                break;
                            }
                            case "UpdateLayout": {
                                const newLayout = taskItem.layout
                                    ? taskItem.layout.apply({
                                          value: taskAction.layout,
                                          version: action.time,
                                      })
                                    : new TaskLayoutRegister(taskAction.layout, action.time);

                                let newFeed = taskItem.feed;

                                if (newLayout.value === "Project" && taskItem.feed === null) {
                                    // If the task has a default grant, then add a feed entry for everyone. Otherwise,
                                    // only add a feed entry for the creator.
                                    newFeed = (await state.doesTaskItemHaveDefaultGrant(taskItem))
                                        ? "AddedCandidateEntry"
                                        : "AddedAccountCandidateEntry";
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    layout: newLayout,
                                    feed: newFeed,
                                });

                                // When a task is turned into a project we add a feed entry for the creator. If
                                // this task has previously been shared we do not add a second entry to the feed.
                                if (taskItem.feed !== newFeed) {
                                    state.registerAfterCommitAction(async context => {
                                        const entry: FeedEntry = {
                                            type: "Task",
                                            taskId,
                                            sharedTime: new Date(action.time[0]),
                                            sharerId: context.actor.getPossiblyBotAccountId(),
                                            creator: {
                                                id: taskItem.creatorId,
                                                from: taskItem.creatorFrom,
                                            },
                                            // Override the default behavior to exclude entries from the creator feed that
                                            // aren't `event: "Created"`.
                                            excludeFromCreatorFeed: false,
                                            event: "UpdatedToProjectLayout",
                                        };

                                        if (newFeed === "AddedAccountCandidateEntry") {
                                            context.process.waitUntil(
                                                addFeedAccountCandidateEntry(
                                                    context,
                                                    spaceId,
                                                    // In case the person turning the account into a project is different from the task
                                                    // creator, add the entry to the person turning the task into a project.
                                                    context.actor.getPossiblyBotAccountId(),
                                                    entry,
                                                ),
                                            );
                                        } else {
                                            context.process.waitUntil(
                                                addFeedCandidateEntry(context, spaceId, entry),
                                            );
                                        }
                                    });
                                }
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                await state.authorizeTaskItemAccess(taskItem, "Manage");

                                const oldAccessPolicy =
                                    getTaskItemAccessPolicyWithDefault(taskItem);

                                const {defaultGrant: newResolvedDefaultGrant} =
                                    await state.validateAccessPolicyUpdate(
                                        `Task:${taskId}`,
                                        oldAccessPolicy,
                                        taskAction.accessPolicy,
                                    );

                                let newFeed = taskItem.feed;

                                if (
                                    (taskItem.feed === null ||
                                        taskItem.feed === "AddedAccountCandidateEntry") &&
                                    // Was this task directly shared via its access policy?
                                    newResolvedDefaultGrant
                                ) {
                                    newFeed = "AddedCandidateEntry";
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    accessPolicy: taskItem.accessPolicy
                                        ? taskItem.accessPolicy.apply({
                                              value: taskAction.accessPolicy,
                                              version: action.time,
                                          })
                                        : new AccessPolicyRegister(
                                              taskAction.accessPolicy,
                                              action.time,
                                          ),
                                    feed: newFeed,
                                });

                                // If we're sharing a task for the first time then add a feed candidate entry after
                                // 5 minutes. We wait 5 minutes to give the user the chance to add some data to the
                                // task. So the feed entry we publish doesn't show an empty task.
                                //
                                // Unless some condition has been met on the task that makes us feel like the user
                                // has filled out the task and it's not empty. For example, if the task has
                                // children or a collection then that's good signal the user has filled out the
                                // task.
                                if (taskItem.feed !== newFeed) {
                                    registerSharedTaskFeedCandidateEntry(state, spaceId, {
                                        taskId,
                                        time: action.time,
                                        taskItem,
                                        // If we've already added this entry to the creator's feed then we don't want to
                                        // add it again.
                                        excludeFromCreatorFeed:
                                            taskItem.feed === "AddedAccountCandidateEntry",
                                    });
                                }
                                break;
                            }
                            case "UpdateNotepadPagePosition":
                            case "UpdateAssigneeActivePosition": {
                                throw new InvalidArgumentError(
                                    quote`Can\u2019t commit deprecated task action type ${action.taskAction.type}`,
                                );
                            }
                            default:
                                throw exhaustive(taskAction);
                        }
                    }
                }

                async function maybeAddFeedCandidateEntryAfterAddCollectionOrUpdateParentTaskId(
                    newTaskItem: TaskEssentialAttributesItem,
                ) {
                    let newFeed = newTaskItem.feed;

                    if (
                        newTaskItem.layout?.value === "Project" &&
                        (newTaskItem.feed === null ||
                            newTaskItem.feed === "AddedAccountCandidateEntry") &&
                        // If there was no feed candidate entry, we assume the task previously was private
                        // (didn't have a `defaultGrant`). In all code paths that might add a
                        // `defaultGrant` we add a feed candidate entry if we detect the task is public and
                        // there's no previous feed candidate entry.
                        //
                        // Run this last in the condition since it's expensive as it potentially needs to
                        // load all referenced collections/tasks!
                        (await state.doesTaskItemHaveDefaultGrant(newTaskItem))
                    ) {
                        newFeed = "AddedCandidateEntry";
                    }

                    // If the project was shared then add a feed entry saying "so and so shared this
                    // project".
                    if (newTaskItem.feed !== newFeed) {
                        state.updateTaskItem({...newTaskItem, feed: newFeed});

                        state.registerAfterCommitAction(async context => {
                            const entry: FeedEntry = {
                                type: "Task",
                                taskId,
                                sharedTime: new Date(action.time[0]),
                                sharerId: context.actor.getPossiblyBotAccountId(),
                                creator: {
                                    id: newTaskItem.creatorId,
                                    from: newTaskItem.creatorFrom,
                                },
                                // If we've already added this entry to the creator's feed then we don't want to
                                // add it again.
                                excludeFromCreatorFeed:
                                    newTaskItem.feed === "AddedAccountCandidateEntry",
                                event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
                            };

                            context.process.waitUntil(
                                addFeedCandidateEntry(context, spaceId, entry),
                            );
                        });
                    }
                }
                break;
            }
            case "UpdateCollection": {
                const {collectionId, collectionAction} = action;

                switch (collectionAction.type) {
                    case "Create": {
                        const {creator} = collectionAction;

                        if (!creator) {
                            throw new PermissionDeniedError(
                                "Task collection creator is required for new task collections",
                            );
                        }

                        if (!isDeepEqual(creator, state.getCreator())) {
                            throw new PermissionDeniedError(
                                "Task collection creator must exactly match the task action transaction actor",
                            );
                        }

                        const newEffectiveAccessPolicy = await state.validateAccessPolicyUpdate(
                            `TaskCollection:${collectionId}`,
                            null,
                            collectionAction.accessPolicy,
                        );

                        const newCollectionItem: TaskCollectionEssentialAttributesItem = {
                            partitionType: "TaskCollection",
                            sortRangeType: "EssentialAttributes",
                            collectionId,
                            spaceId,
                            createdTime: action.time,
                            creatorId: creator.accountId,
                            creatorFrom: creator.from,
                            rawDeletedTime: null,
                            rawUndeletedTime: null,
                            name: new LabelStringRegister(collectionAction.name, action.time),
                            color: new TaskCollectionColorRegister(null, action.time),
                            accessPolicy: new AccessPolicyRegister(
                                collectionAction.accessPolicy,
                                action.time,
                            ),
                            defaults: new TaskQueryDefaultsRegister(
                                emptyTaskQueryDefaults,
                                action.time,
                            ),
                            hasAddedFeedCandidateEntry: !!newEffectiveAccessPolicy.defaultGrant,
                            taskCount: 0,
                            openTaskCount: 0,
                            lastTaskAddedTime: null,
                        };

                        state.createCollectionItem(newCollectionItem);

                        state.registerAfterCommitAction(async context => {
                            const entry: FeedEntry & {type: "TaskCollection"} = {
                                type: "TaskCollection",
                                collectionId,
                                sharedTime: new Date(action.time[0]),
                                sharerId: creator.accountId,
                                creator: {id: creator.accountId, from: creator.from},
                                event: "Created",
                            };

                            // Immediately add the collection to the creator's feed. Whether the collection is
                            // private or public. If the collection is public we will add it to everyone else's
                            // feed below. This way the creator can quickly find the collection they created
                            // again by opening their feed.
                            context.process.waitUntil(
                                addFeedAccountCandidateEntry(
                                    context,
                                    spaceId,
                                    creator.accountId,
                                    entry,
                                ),
                            );

                            // If we created a public task collection then add a feed candidate entry after 5
                            // minutes. We wait 5 minutes to give the user the chance to add some tasks to the
                            // collection. So the feed entry we publish doesn't show an empty task collection.
                            if (newCollectionItem.hasAddedFeedCandidateEntry) {
                                context.jobs.send(
                                    {
                                        type: "AddFeedCandidateEntry",
                                        jobId: generateId(),
                                        spaceId,
                                        // We already added this collection to the creator's feed. Don't add it again.
                                        entry: {...entry, excludeFromCreatorFeed: true},
                                    },
                                    {delaySeconds: 5 * 60},
                                );
                            }
                        });
                        break;
                    }
                    case "Undelete": {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw createTaskCollectionNotFoundError(collectionId);
                        if (!isTaskCollectionItemDeleted(collectionItem)) {
                            throw new FailedPreconditionError(
                                "Expected task collection to be deleted",
                            );
                        }

                        // If `isTaskCollectionItemDeleted()` returns true then we have `rawDeletedTime`.
                        assert(collectionItem.rawDeletedTime);

                        await state.authorizeCollectionAccessAllowingDeletedCollections(
                            collectionId,
                            "Manage",
                        );

                        if (
                            compareHybridLogicalTimes(action.time, collectionItem.rawDeletedTime) <=
                            0
                        ) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        state.updateCollectionItem({
                            ...collectionItem,
                            rawUndeletedTime: action.time,
                        });
                        break;
                    }
                    default: {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw createTaskCollectionNotFoundError(collectionId);
                        if (isTaskCollectionItemDeleted(collectionItem)) {
                            throw new FailedPreconditionError("Task collection was deleted", {
                                displayMessage: taskCollectionDeletedErrorDisplayMessage,
                            });
                        }

                        switch (collectionAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.createdTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                if (
                                    collectionItem.rawUndeletedTime &&
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.rawUndeletedTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than undelete action time",
                                    );
                                }

                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    rawDeletedTime: action.time,
                                });
                                break;
                            }
                            case "UpdateName": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newName = collectionItem.name.apply({
                                    value: collectionAction.name,
                                    version: action.time,
                                });

                                if (collectionItem.name !== newName) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        name: newName,
                                    });
                                }
                                break;
                            }
                            case "UpdateColor": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newColor = collectionItem.color.apply({
                                    value: collectionAction.color,
                                    version: action.time,
                                });

                                if (collectionItem.color !== newColor) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        color: newColor,
                                    });
                                }
                                break;
                            }
                            case "UpdateDefaults": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newDefaults = collectionItem.defaults.apply({
                                    value: collectionAction.defaults,
                                    version: action.time,
                                });

                                if (collectionItem.defaults !== newDefaults) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        defaults: newDefaults,
                                    });
                                }
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const oldCollectionAccessPolicy = collectionItem.accessPolicy.value;

                                const newEffectiveAccessPolicy =
                                    await state.validateAccessPolicyUpdate(
                                        `TaskCollection:${collectionId}`,
                                        oldCollectionAccessPolicy,
                                        collectionAction.accessPolicy,
                                    );

                                const oldHasAddedFeedCandidateEntry =
                                    collectionItem.hasAddedFeedCandidateEntry;
                                const newHasAddedFeedCandidateEntry =
                                    oldHasAddedFeedCandidateEntry ||
                                    !!newEffectiveAccessPolicy.defaultGrant;

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    accessPolicy: collectionItem.accessPolicy.apply({
                                        value: collectionAction.accessPolicy,
                                        version: action.time,
                                    }),
                                    hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                                });

                                // If we're sharing a task collection for the first time then add a feed candidate
                                // entry after 5 minutes. We wait 5 minutes to give the user the chance to add some
                                // tasks to the collection. So the feed entry we publish doesn't show an empty task
                                // collection.
                                //
                                // Unless there are 8 or more open tasks. Then we add the feed candidate entry
                                // immediately since we have enough tasks to render a good preview in feed.
                                if (
                                    newHasAddedFeedCandidateEntry &&
                                    !oldHasAddedFeedCandidateEntry
                                ) {
                                    state.registerAfterCommitAction(async context => {
                                        const entry: FeedEntry = {
                                            type: "TaskCollection",
                                            collectionId,
                                            sharedTime: new Date(action.time[0]),
                                            sharerId: state.getActorAccountId(),
                                            creator: {
                                                id: collectionItem.creatorId,
                                                from: collectionItem.creatorFrom,
                                            },
                                            event: "SharedWithAccessPolicyDefaultGrant",
                                        };

                                        addFeedCandidateEntryNowOrAfterDelay(
                                            context,
                                            spaceId,
                                            entry,
                                            {
                                                shouldAddImmediately:
                                                    collectionItem.openTaskCount >= 8,
                                            },
                                        );
                                    });
                                }
                                break;
                            }
                            default:
                                throw exhaustive(collectionAction);
                        }
                        break;
                    }
                }
                break;
            }
            case "UpdateAccountName": {
                // Clients can't commit this action whenever they'd like by calling
                // `commitTaskActionTransaction()`. We only commit this action when updating an
                // account's name.
                throw new InvalidArgumentError(
                    "Clients are not allowed to commit an `UpdateAccountName` action",
                );
            }
            case "UpdateNotepadPage": {
                throw new InvalidArgumentError(
                    quote`Can\u2019t commit deprecated action type ${action.type}`,
                );
            }
            default:
                throw exhaustive(action);
        }
    }
}

function shouldAddTaskFeedCandidateEntryImmediately(
    taskItem: TaskEssentialAttributesItem,
): boolean {
    return (
        !!taskItem.layout?.value ||
        taskItem.addedChildTaskCount - taskItem.removedChildTaskCount > 0 ||
        taskItem.collections.getArray().length > 0
    );
}

function addFeedCandidateEntryNowOrAfterDelay(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    entry: FeedEntry,
    {shouldAddImmediately}: {shouldAddImmediately: boolean},
) {
    if (shouldAddImmediately) {
        context.process.waitUntil(addFeedCandidateEntry(context, spaceId, entry));
    } else {
        context.jobs.send(
            {
                type: "AddFeedCandidateEntry",
                jobId: generateId(),
                spaceId,
                entry,
            },
            {delaySeconds: 5 * 60},
        );
    }
}

function registerSharedTaskFeedCandidateEntry(
    state: TaskActionTransactionCommitState,
    spaceId: SpaceId,
    {
        taskId,
        time,
        taskItem,
        excludeFromCreatorFeed,
    }: {
        taskId: TaskId;
        time: HybridLogicalTime;
        taskItem: TaskEssentialAttributesItem;
        excludeFromCreatorFeed: boolean;
    },
) {
    state.registerAfterCommitAction(async context => {
        const entry: FeedEntry = {
            type: "Task",
            taskId,
            sharedTime: new Date(time[0]),
            sharerId: context.actor.getPossiblyBotAccountId(),
            creator: {
                id: taskItem.creatorId,
                from: taskItem.creatorFrom,
            },
            excludeFromCreatorFeed,
            event: "SharedWithAccessPolicyDefaultGrant",
        };

        addFeedCandidateEntryNowOrAfterDelay(context, spaceId, entry, {
            shouldAddImmediately: shouldAddTaskFeedCandidateEntryImmediately(taskItem),
        });
    });
}
