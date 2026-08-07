import {Step} from "prosemirror-transform";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {getTaskNotesContentHash} from "~/server/tasks/data/get_task_notes_content_hash.js";
import {
    authorizeTaskAccessAndGetCommentsSummaryAndNotesItems,
    authorizeTaskItemAccess,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {getTaskNotesContentStepsBetweenValidatedVersionRange} from "~/server/tasks/data/internal/get_task_notes_content_steps_between_validated_version_range.js";
import {
    TaskNotesItem,
    TaskNotesStepTransactionItem,
    TaskTable,
} from "~/server/tasks/data/internal/task_table.js";
import {withSendTaskIndexSearchEntityJobIfNeeded} from "~/server/tasks/data/task_index.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {ContentEditorClientId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    emptyTaskNotesContent,
    isTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Updates the task's notes with the provided steps.
 *
 * If `version` is behind the current notes version we rebase the provided steps
 * onto the latest content using the steps persisted in the
 * `NotesStepTransactionsBeforeSnapshot` sort range (like document content), so
 * updates made against an older version are recoverable. Throws a
 * `FailedPreconditionError` if `version` is ahead of the current version.
 *
 * Returns the version after the steps were applied. Because of rebasing this may
 * be greater than `version + steps.length`.
 */
export function updateTaskNotesContent(
    context: ServerAccountActionContext,
    {
        spaceId,
        taskId,
        clientVersion,
        clientSteps,
        clientId,
        clientRequestToken,
        consistency,
        overrideUpdatedTimeForTest,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        clientVersion: number;
        clientSteps: ReadonlyArray<Step>;
        clientId: ContentEditorClientId;
        // Threaded into the DynamoDB transaction so retries with the same token are
        // deduplicated. See `updateTaskNotesContentIdempotently()`.
        clientRequestToken?: string;
        consistency?: DynamoCacheReadConsistency;
        /**
         * Backdates the update (which is also the time the notes window renders at in the
         * task activity feed) so tests can author histories a known distance from a fixed
         * screenshot time. Mirrors `overrideCommittedTimeForTest` on
         * `commitTaskActionTransaction()`.
         */
        overrideUpdatedTimeForTest?: Date;
    },
): Promise<{newVersion: number}> {
    if (overrideUpdatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    const currentTime = overrideUpdatedTimeForTest ?? new Date();
    return withSendTaskIndexSearchEntityJobIfNeeded(context, {spaceId, taskId}, () => {
        return context.dynamo.retryTransaction(async context => {
            const [taskItem, currentNotesItem] = await runAllPromises([
                (async () => {
                    const taskItem = await TaskTable.getItem(
                        context,
                        {
                            partitionType: "Task",
                            sortRangeType: "EssentialAttributes",
                            taskId,
                        },
                        {consistency},
                    );

                    const expectedAccessLevel = "Edit";

                    await authorizeTaskItemAccess(
                        context,
                        taskItem,
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
                    );

                    if (taskItem.spaceId !== spaceId) {
                        throw new FailedPreconditionError("Task is in unexpected space");
                    }

                    return taskItem;
                })(),
                TaskTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Task",
                        sortRangeType: "Notes",
                        taskId,
                    },
                    {consistency},
                ),
            ]);

            const currentVersion = currentNotesItem?.version ?? 0;
            const currentContent = currentNotesItem?.content ?? emptyTaskNotesContent;

            // Rebase the provided steps against any steps that have been applied since
            // `version`. If `version` is behind the current version we read the intervening
            // steps from the `NotesStepTransactionsBeforeSnapshot` sort range and rebase the
            // provided steps onto the latest content. Throws a `FailedPreconditionError` if
            // `version` is ahead of the current version.
            const {
                newContent,
                steps: newSteps,
                invertedSteps: newInvertedSteps,
            } = await getCollaborativelyUpdateContentResult(context, {
                currentVersion,
                currentContent,
                clientVersion: clientVersion,
                clientSteps: clientSteps,
                getSteps: (startVersion, endVersion) =>
                    getTaskNotesContentStepsBetweenValidatedVersionRange(context, {
                        taskId,
                        startVersion,
                        endVersion,
                    }),
            });

            assert(isTaskNotesContent(newContent));

            // After rebasing, all of the provided steps may have become noops. In that case
            // there's nothing to persist so leave the content and version unchanged.
            if (newSteps.length === 0) return {newVersion: currentVersion};

            let newStepCountByAccountId =
                currentNotesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map());

            // Keep track of how much each account contributed to the task's notes.
            if (context.actor.getPossiblyBotAccountId() !== taskItem.creatorId) {
                const actualNewStepCountByAccountId = new Map(newStepCountByAccountId.get());

                const stepCount =
                    actualNewStepCountByAccountId.get(context.actor.getPossiblyBotAccountId()) ?? 0;

                actualNewStepCountByAccountId.set(
                    context.actor.getPossiblyBotAccountId(),
                    stepCount + newSteps.length,
                );

                newStepCountByAccountId = new TaskStepCountByAccountId(
                    actualNewStepCountByAccountId,
                );
            }

            // The before hash is by definition the previous update's after hash, so it's a
            // stored-attribute read — recomputed only for items written before `contentHash`
            // existed. Only the new content pays a hash here.
            const beforeContentHash =
                currentNotesItem?.contentHash ?? getTaskNotesContentHash(currentContent);
            const afterContentHash = getTaskNotesContentHash(newContent);

            const newNotesItem: TaskNotesItem = currentNotesItem
                ? {
                      ...currentNotesItem,
                      version: currentVersion + newSteps.length,
                      content: newContent,
                      contentHash: afterContentHash,
                      stepCountByAccountId: newStepCountByAccountId,
                      lastUpdatedTime: currentTime,
                  }
                : {
                      partitionType: "Task",
                      sortRangeType: "Notes",
                      spaceId: taskItem.spaceId,
                      taskId,
                      createdTime: currentTime,
                      version: currentVersion + newSteps.length,
                      content: newContent,
                      contentHash: afterContentHash,
                      stepCountByAccountId: newStepCountByAccountId,
                  };

            // Persist the steps so future updates made against an old version can be rebased
            // onto the latest content.
            const newStepTransactionItem: TaskNotesStepTransactionItem = {
                partitionType: "Task",
                sortRangeType: "NotesStepTransactionsBeforeSnapshot",
                taskId,
                startVersion: currentVersion,
                createdTime: currentTime,
                steps: newSteps,
                invertedSteps: newInvertedSteps,
                clientId,
                // TODO(#bot-attribution): When the actor is a bot, resolve the human account that
                // triggered the bot action. Currently bot-applied steps will attribute both fields
                // to the bot's account.
                accountId: context.actor.getPossiblyBotAccountId(),
                fromBotAccountId:
                    context.actor.type === "Bot" ? context.actor.getBotAccountId() : null,
            };

            await DynamoTableSchema.executeTransaction(
                context,
                [
                    // If a task's notes changed and there's a lease, invalidate the lease so the
                    // account who owns the lease can't see changes to a task they shouldn't have
                    // access to.
                    ...(taskItem.validLeaseId === null
                        ? []
                        : [
                              TaskTable.transactionDirectlyUpdateItem({
                                  ...taskItem,
                                  validLeaseId: null,
                              }),
                          ]),
                    currentNotesItem === null
                        ? TaskTable.transactionCreateItem(newNotesItem)
                        : TaskTable.transactionDirectlyUpdateItem(newNotesItem),
                    TaskTable.transactionCreateItem(newStepTransactionItem),
                ],
                {clientRequestToken},
            );

            context.jobs.send({
                type: "ProcessTaskNotesActivity",
                spaceId,
                taskId,
                startVersion: currentVersion,
                endVersion: currentVersion + newSteps.length,
                createdTime: currentTime,
                actor: {
                    accountId: context.actor.getPossiblyBotAccountId(),
                    from:
                        context.actor.type === "Bot"
                            ? {type: "Bot", accountId: context.actor.getBotAccountId()}
                            : null,
                },
                beforeContentHash,
                afterContentHash,
            });

            return {newVersion: currentVersion + newSteps.length};
        });
    });
}

/**
 * Same as `updateTaskNotesContent()` but idempotent. If you call this function
 * multiple times with the same input and `clientRequestToken` then you'll get the
 * same response.
 */
export async function updateTaskNotesContentIdempotently(
    context: ServerAccountActionContext,
    options: Parameters<typeof updateTaskNotesContent>[1] & {clientRequestToken: string},
): Promise<{newVersion: number}> {
    try {
        return await updateTaskNotesContent(context, options);
    } catch (error) {
        if (!isDynamoIdempotentParameterMismatchError(error)) throw error;

        // The original request already committed. Read back the current version so we
        // return the same result the original call did.
        const newVersion = await authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
            context,
            options.taskId,
            "Edit",
            async ({notesItem}) => notesItem?.version ?? 0,
            {consistency: "StrongWithinCache"},
        );

        return {newVersion};
    }
}
