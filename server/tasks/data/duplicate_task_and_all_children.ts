import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {attachFileFromAttachment} from "~/server/files/data/files_actions.js";
import {hasBotOperationAccess} from "~/server/spaces/authorize_bot_operation.js";
import {getSpaceAccountBotIdIfExistsWithoutAuthorization} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {
    authorizeTaskItemAccess,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskNotesItem, TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {
    ContentDuplicationVariableValues,
    applyContentDuplicationVariableValues,
} from "~/shared/content/content_duplication_variable_schema.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {FileId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {assertTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Duplicate the provided `TaskId` and all children of that task in a single
 * transaction. Returns the actions we committed from this function call.
 *
 * On the client we may not know all the transitive children of a task. So this
 * functionality needs to be implemented on the server.
 *
 * TODO: if we ever allow duplicating a task from the API, we should add
 * creatorFrom here.
 */
export function duplicateTaskAndAllChildren(
    context: ServerSessionActionContext,
    {
        sourceTaskId,
        actionTime,
        timeZone,
        variableValues,
    }: {
        sourceTaskId: TaskId;
        actionTime: HybridLogicalTime;
        timeZone: TimeZone;
        variableValues?: ContentDuplicationVariableValues;
    },
): Promise<{
    spaceId: SpaceId;
    actions: ReadonlyArray<TaskAction>;
    taskId: TaskId;
}> {
    return context.dynamo.retryTransaction(async context => {
        const currentTime = new Date();
        const taskItem = await TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId: sourceTaskId,
        });

        await authorizeTaskItemAccess(context, taskItem, "Edit", {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null),
        });

        const taskDisplayStatusFilter = {
            ifOpenActive: true,
            ifOpenInactive: true,
            ifClosed: true,
        } as const;

        let newRootTaskId: TaskId | null = null;

        // Track notes that have files so we can attach them after the transaction.
        const attachFiles: Array<{
            fromTaskId: TaskId;
            toTaskId: TaskId;
            fileIds: ReadonlySet<FileId>;
        }> = [];

        const createNotesClone = (
            parentTaskId: TaskId | undefined,
            existingNotesItem: TaskNotesItem,
            newTaskId: TaskId,
        ): TaskNotesItem => {
            let content = existingNotesItem.content;

            // Apply variable substitution to notes content
            if (!parentTaskId && variableValues && variableValues.size > 0) {
                content = assertTaskNotesContent(
                    applyContentDuplicationVariableValues(content, variableValues),
                );
            }

            // Track file IDs so we can attach them after the transaction.
            const {fileIds} = getContentReferencedIdsForNode(content);
            if (fileIds.size > 0) {
                attachFiles.push({
                    fromTaskId: existingNotesItem.taskId,
                    toTaskId: newTaskId,
                    fileIds,
                });
            }

            return {
                partitionType: "Task",
                sortRangeType: "Notes",
                taskId: newTaskId,
                spaceId: existingNotesItem.spaceId,
                content,
                // Reset version tracking
                stepCountByAccountId: new TaskStepCountByAccountId(new Map()),
                version: 0,
                createdTime: currentTime,
            };
        };

        // Our dynamo transaction limit is 100 actions. If we exceed that, we'll throw an
        // error. We don't want to keep resolving children if we already know we're going
        // to fail. For now, we just track the total child task count and throw if we
        // exceed it.
        const maxClonedObjectCount = 100;
        let totalClonedObjectCount = 1;

        /**
         * Aggregates all actions for a task and its children.
         *
         * @param currentTaskId The ID of the current task. @param parentTaskId The ID of
         * the parent task. @returns
         */
        const aggregateRecursiveActions = async (currentTaskId: TaskId, parentTaskId?: TaskId) => {
            const loadQueriesPromise = context.tasks.loadQueries(taskItem.spaceId, {
                taskIds: [currentTaskId],
                collectionIds: [],
                queries: [
                    {
                        type: "Normalized",
                        // Only request as many as we can support (+1 to allow hitting our limit)
                        limit: maxClonedObjectCount - totalClonedObjectCount + 1,
                        filters: {
                            displayStatusFilter: taskDisplayStatusFilter,
                            parentFilter: {
                                parentTaskId: currentTaskId,
                            },
                        },
                        sorts: [],
                    },
                ],
            });

            const loadNotesPromise = TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Notes",
                taskId: currentTaskId,
            });

            const [queryResult, notesItem] = await runAllPromises([
                loadQueriesPromise,
                loadNotesPromise,
            ]);

            const currentTask = assertExists(
                findMapIterable(queryResult.updateEvent.backfillTasks, backfillTask =>
                    backfillTask.type === "Authorized" && backfillTask.task.id === currentTaskId
                        ? backfillTask.task
                        : undefined,
                ),
            );

            const {taskId: newCurrentTaskId, actions: newActions} = currentTask.getDuplicateActions(
                {
                    creatorId: context.actor.getAccountId(),
                    actionTime,
                    creatorTimeZone: timeZone,
                    parentTaskId,
                    withTitleUpdate: !parentTaskId,
                    variableValues: !parentTaskId ? variableValues : undefined,
                    withAssignee: await canDuplicateKeepAssignee(
                        context,
                        taskItem.spaceId,
                        currentTask,
                    ),
                },
            );

            if (!parentTaskId) {
                newRootTaskId = newCurrentTaskId;
            }

            const actions = [...newActions];
            const extraTransactionEntries: Array<DynamoTransactionEntry> = [];
            const clonedTaskIds = new Map<TaskId, TaskId>([[currentTaskId, newCurrentTaskId]]);

            if (notesItem) {
                totalClonedObjectCount++;
                const newNotesItem = createNotesClone(parentTaskId, notesItem, newCurrentTaskId);
                extraTransactionEntries.push(
                    TaskTable.transactionCreateOrReplaceItem(newNotesItem),
                );
            }

            await runAllPromises(
                queryResult.updateEvent.backfillTasks.map(async childTask => {
                    if (childTask.type !== "Authorized") return;
                    if (childTask.task.getParent()?.taskId !== currentTaskId) return;

                    // There's an edge case / race condition where we could produce a cycle. If so,
                    // just ignore the child task and break the cycle. There is an incredibly small
                    // chance where we would try to fetch the same task multiple times AFTER this
                    // check. We don't handle that here.
                    if (clonedTaskIds.has(childTask.task.id)) {
                        return;
                    }

                    if (childTask.task.getChildTaskCount() > 0) {
                        // Recurse for the child tasks
                        const childTaskActions = await aggregateRecursiveActions(
                            childTask.task.id,
                            newCurrentTaskId,
                        );

                        actions.push(...childTaskActions.actions);
                        extraTransactionEntries.push(...childTaskActions.extraTransactionEntries);

                        for (const [
                            oldChildTaskId,
                            newChildTaskId,
                        ] of childTaskActions.clonedTaskIds) {
                            clonedTaskIds.set(oldChildTaskId, newChildTaskId);
                        }

                        totalClonedObjectCount += childTaskActions.clonedTaskIds.size;
                    } else {
                        // No child tasks, just clone the task
                        const {taskId: newChildTaskId, actions: newActions} =
                            childTask.task.getDuplicateActions({
                                creatorId: context.actor.getAccountId(),
                                actionTime,
                                creatorTimeZone: timeZone,
                                parentTaskId: newCurrentTaskId,
                                withAssignee: await canDuplicateKeepAssignee(
                                    context,
                                    taskItem.spaceId,
                                    childTask.task,
                                ),
                            });

                        actions.push(...newActions);
                        clonedTaskIds.set(childTask.task.id, newChildTaskId);
                        totalClonedObjectCount++;

                        // since we aren't recursing here, just grab the notes for this task
                        const childTaskNotesItem = await TaskTable.getItemIfExists(context, {
                            partitionType: "Task",
                            sortRangeType: "Notes",
                            taskId: childTask.task.id,
                        });

                        if (childTaskNotesItem) {
                            totalClonedObjectCount++;
                            // Pass newCurrentTaskId as parentTaskId to indicate this is a child task. This
                            // prevents variable substitution from being applied to child notes.
                            const newChildTaskNotesItem = createNotesClone(
                                newCurrentTaskId,
                                childTaskNotesItem,
                                newChildTaskId,
                            );

                            extraTransactionEntries.push(
                                TaskTable.transactionCreateOrReplaceItem(newChildTaskNotesItem),
                            );
                        }
                    }

                    if (totalClonedObjectCount > 100) {
                        throw new FailedPreconditionError("Child task limit exceeded", {
                            displayMessage: errorDisplayMessage`The task has too many child tasks.`,
                            // dedupe against the original root task ID
                            aggregateDedupeKey: sourceTaskId,
                        });
                    }
                }),
            );

            return {
                actions,
                clonedTaskIds,
                extraTransactionEntries,
            };
        };

        const {actions, extraTransactionEntries} = await aggregateRecursiveActions(sourceTaskId);
        assertExists(newRootTaskId);
        const returnedTaskId = newRootTaskId!;

        // Attach files from the source task notes to the new task notes BEFORE committing
        // the transaction. This prevents a race condition where a user opens the newly
        // created task before file attachments complete.
        if (attachFiles.length > 0) {
            await runAllPromises(
                flatMapIterable(attachFiles, ({fromTaskId, toTaskId, fileIds}) =>
                    mapIterable(fileIds, fileId =>
                        attachFileFromAttachment(context, fileId, {
                            from: FileTaskAuthorizer.bind({
                                type: "TaskNotes",
                                taskId: fromTaskId,
                            }),
                            to: FileTaskAuthorizer.bind({
                                type: "TaskNotes",
                                taskId: toTaskId,
                            }),

                            // The new task hasn't been created yet. So don't authorize we have access since
                            // doing so will throw a `NotFoundError`. We definitely have access to the new task
                            // since our actor is about to create it.
                            dangerouslySkipToAuthorizeTargetAccess: true,
                        }),
                    ),
                ),
            );
        }

        await commitTaskActionTransaction(context, taskItem.spaceId, actions, {
            extraTransactionEntries,
        });

        return {
            taskId: returnedTaskId,
            actions,
            spaceId: taskItem.spaceId,
        };
    });
}

/**
 * May the duplicate keep the source task's assignee?
 *
 * Bots are only assignable by actors who may view them, so a bot assignee the
 * actor can't view is left off the duplicate.
 */
async function canDuplicateKeepAssignee(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    task: TaskModel,
): Promise<boolean> {
    const assignee = task.getAssignee();
    if (!assignee) return true;

    const botId = await getSpaceAccountBotIdIfExistsWithoutAuthorization(
        context,
        spaceId,
        assignee.assignee.accountId,
    );
    if (botId === null) return true;

    return await hasBotOperationAccess(context, botId, {type: "View"});
}
