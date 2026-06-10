import {Step} from "prosemirror-transform";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    authorizeTaskItemAccess,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskNotesItem, TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {withSendTaskIndexSearchEntityJobIfNeeded} from "~/server/tasks/data/task_index.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    emptyTaskNotesContent,
    isTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Updates the task's notes with the provided steps. Uses optimistic concurrency
 * control so rejects any updates that have `version` set to the wrong value.
 *
 * It's important that task note updating should be solely managed by the
 * `TaskNotesCollaborationService` Durable Object. If you get an incorrect version
 * error, we don't know what steps you're missing since we don't keep track of old
 * steps (unlike document content). There's no way to recover!
 */
export function updateTaskNotesContent(
    context: ServerAccountActionContext,
    {
        spaceId,
        taskId,
        version,
        steps,
        consistency,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        version: number;
        steps: ReadonlyArray<Step>;
        consistency?: DynamoCacheReadConsistency;
    },
) {
    return withSendTaskIndexSearchEntityJobIfNeeded(context, {spaceId, taskId}, () => {
        return context.dynamo.retryTransaction(async context => {
            const [taskItem, notesItem] = await runAllPromises([
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

            let newStepCountByAccountId =
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map());

            // Keep track of how much each account contributed to the task's notes.
            if (context.actor.getPossiblyBotAccountId() !== taskItem.creatorId) {
                const actualNewStepCountByAccountId = new Map(newStepCountByAccountId.get());

                const stepCount =
                    actualNewStepCountByAccountId.get(context.actor.getPossiblyBotAccountId()) ?? 0;

                actualNewStepCountByAccountId.set(
                    context.actor.getPossiblyBotAccountId(),
                    stepCount + steps.length,
                );

                newStepCountByAccountId = new TaskStepCountByAccountId(
                    actualNewStepCountByAccountId,
                );
            }

            let newNotesItem: TaskNotesItem;

            // If the notes item doesn't exist yet then create it.
            if (!notesItem) {
                if (version !== 0) throw new FailedPreconditionError("Incorrect version");

                let content = emptyTaskNotesContent;

                for (const step of steps) {
                    const stepResult = step.apply(content);
                    if (!stepResult.doc) {
                        throw new FailedPreconditionError(
                            `Couldn\u2019t apply step to content: ${stepResult.failed!}`,
                        );
                    }

                    assert(isTaskNotesContent(stepResult.doc));
                    content = stepResult.doc;
                }

                newNotesItem = {
                    partitionType: "Task",
                    sortRangeType: "Notes",
                    spaceId: taskItem.spaceId,
                    taskId,
                    version: steps.length,
                    content,
                    stepCountByAccountId: newStepCountByAccountId,
                };
            } else {
                if (version !== notesItem.version)
                    throw new FailedPreconditionError("Incorrect version");

                let content = notesItem.content;

                for (const step of steps) {
                    const stepResult = step.apply(content);
                    if (!stepResult.doc) {
                        throw new FailedPreconditionError(
                            `Couldn\u2019t apply step to content: ${stepResult.failed!}`,
                        );
                    }

                    assert(isTaskNotesContent(stepResult.doc));
                    content = stepResult.doc;
                }

                newNotesItem = {
                    ...notesItem,
                    version: notesItem.version + steps.length,
                    content,
                    stepCountByAccountId: newStepCountByAccountId,
                };
            }

            // If a task's notes changed and there's a lease, invalidate the lease so the
            // account who owns the lease can't see changes to a task they shouldn't have
            // access to.
            if (taskItem.validLeaseId === null) {
                if (notesItem === null) {
                    await TaskTable.createItem(context, newNotesItem);
                } else {
                    await TaskTable.directlyUpdateItem(context, newNotesItem);
                }
            } else {
                await DynamoTableSchema.executeTransaction(context, [
                    TaskTable.transactionDirectlyUpdateItem({
                        ...taskItem,
                        // Invalidate any leases on this task now that another user has updated it.
                        validLeaseId: null,
                    }),
                    notesItem === null
                        ? TaskTable.transactionCreateItem(newNotesItem)
                        : TaskTable.transactionDirectlyUpdateItem(newNotesItem),
                ]);
            }
        });
    });
}
