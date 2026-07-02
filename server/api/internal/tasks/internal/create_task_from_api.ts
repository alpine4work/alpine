import {CalendarDate} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {createTaskNotesCreateTransactionEntry} from "~/server/tasks/data/create_task_notes_create_transaction_entry.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {AccountId, SiteId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

export async function createTaskFromApi(
    context: ApiServiceBotActionContext,
    {
        taskId,
        spaceId,
        accessPolicy,
        creatorId,
        title,
        notesContent,
        assigneeId,
        status,
        dueDate,
        priority,
        layout,
        parentTaskId,
        collectionIds,
    }: {
        taskId: TaskId;
        spaceId: SpaceId;
        accessPolicy: LocalAccessPolicy;
        creatorId?: AccountId;
        title: string;
        notesContent?: TaskNotesContent;
        assigneeId?: AccountId;
        status?: {type: "Open"; isActive: boolean} | {type: "Closed"};
        dueDate?: CalendarDate;
        priority?: TaskPriority;
        layout?: TaskLayout | null;
        parentTaskId?: TaskId;
        collectionIds?: ReadonlyArray<TaskCollectionId>;
    },
): Promise<{task: TaskModel; referencedAccounts: Array<AccountModel>}> {
    const botAccountId = context.actor.getBotAccountId();
    const currentTime = new Date();
    const createdTimeZone = defaultTimeZone;
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);

    creatorId ??= botAccountId;

    const actor: TaskActor = {
        accountId: creatorId,
        from: {type: "Bot", accountId: botAccountId},
    };

    const effectiveAssigneeId =
        status?.type === "Open" && status.isActive && assigneeId === undefined
            ? botAccountId
            : assigneeId;

    const effectiveLayout = layout ?? null;
    const effectiveCollectionIds = [...new Set(collectionIds ?? [])];

    const createAction = {
        type: "UpdateTask",
        time: clock.now(),
        taskId,
        taskAction: {
            type: "Create",
            creator: {
                accountId: creatorId,
                from: {type: "Bot", accountId: botAccountId},
            },
            creatorTimeZone: createdTimeZone,
            accessPolicy,
        },
    } satisfies TaskUpdateTaskAction;

    const actions: Array<TaskUpdateTaskAction> = [];

    if (title.length > 0) {
        actions.push({
            type: "UpdateTask",
            time: clock.now(),
            actor,
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), title),
            },
        });
    }

    if (effectiveAssigneeId !== undefined) {
        const time = clock.now();
        actions.push({
            type: "UpdateTask",
            time,
            actor,
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assigneeId: effectiveAssigneeId,
                    assignerId: botAccountId,
                    assignedTime: new TaskFilterableTime({
                        absoluteTime: time,
                        setterTimeZone: createdTimeZone,
                    }),
                },
            },
        });
    }

    if (status) {
        if (status.type === "Closed") {
            const time = clock.now();
            actions.push({
                type: "UpdateTask",
                time,
                actor,
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: botAccountId,
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time,
                            setterTimeZone: createdTimeZone,
                        }),
                    },
                },
            });
        }

        if (status.type === "Open" && status.isActive) {
            const activeTime = clock.now();

            actions.push({
                type: "UpdateTask",
                time: activeTime,
                actor,
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: activeTime,
                            setterTimeZone: createdTimeZone,
                        }),
                    },
                },
            });
        }
    }

    if (dueDate) {
        actions.push({
            type: "UpdateTask",
            time: clock.now(),
            actor,
            taskId,
            taskAction: {
                type: "UpdateDueDate",
                dueDate,
            },
        });
    }

    if (priority) {
        actions.push({
            type: "UpdateTask",
            time: clock.now(),
            actor,
            taskId,
            taskAction: {
                type: "UpdatePriority",
                priority,
            },
        });
    }

    if (effectiveLayout !== null) {
        actions.push({
            type: "UpdateTask",
            time: clock.now(),
            taskId,
            taskAction: {
                type: "UpdateLayout",
                layout: effectiveLayout,
            },
        });
    }

    if (parentTaskId !== undefined) {
        actions.push({
            type: "UpdateTask",
            time: clock.now(),
            taskId,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId,
            },
        });
    }

    if (effectiveCollectionIds.length > 0) {
        const orderKeys = generateOrderKeysBetween(null, null, effectiveCollectionIds.length);
        for (let i = 0; i < effectiveCollectionIds.length; i++) {
            actions.push({
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: assertExists(effectiveCollectionIds[i]),
                    orderKey: assertExists(orderKeys[i]),
                },
            });
        }
    }

    const allActions = [createAction, ...actions];

    const [, {taskSortableAccountById, referencedAccounts}] = await runAllPromises([
        commitTaskActionTransaction(context, spaceId, allActions, {
            consistency: "StrongWithinCache",
            // Very important! For the API to have read-after-write consistency we need to wait
            // until our actions have been sent to every `TaskRealtimeService`. Then future
            // reads against `TaskRealtimeService` will return the data we wrote.
            waitForProcessing: true,
            // Create initial notes atomically with the task. A follow-up
            // `updateTaskNotesContent()` write would allow the task to be created even if
            // persisting its notes failed.
            extraTransactionEntries: notesContent
                ? [
                      createTaskNotesCreateTransactionEntry({
                          spaceId,
                          taskId,
                          content: notesContent,
                          createdTime: currentTime,
                      }),
                  ]
                : undefined,
        }),
        // We're loading references so eventual consistency is ok.
        loadTaskSortableAccountsForActions(context.dynamo.unexpectStrongReadConsistency(), {
            spaceId,
            actions: allActions,
        }),
    ]);

    let task = TaskModel.createFromAction(
        spaceId,
        taskId,
        createAction.time,
        createAction.taskAction,
        accountId => assertExists(taskSortableAccountById.get(accountId)),
    );

    for (const action of actions) {
        task = task.applyAction(action, accountId =>
            assertExists(taskSortableAccountById.get(accountId)),
        );
    }

    return {
        task,
        referencedAccounts,
    };
}

/**
 * Load the sortable account payloads needed to apply the generated actions to the
 * in-memory `TaskModel`.
 */
async function loadTaskSortableAccountsForActions(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        actions,
    }: {
        spaceId: SpaceId;
        actions: ReadonlyArray<TaskAction>;
    },
): Promise<{
    taskSortableAccountById: Map<AccountId, TaskSortableAccount>;
    referencedAccounts: Array<AccountModel>;
}> {
    const accountIds = new Set<AccountId>();
    const siteIds = new Set<SiteId>();
    for (const action of actions) {
        collectReferencedIdsFromTaskAction(accountIds, siteIds, action);
    }

    const referencedAccounts = await runAllPromises(
        mapIterable(accountIds, accountId => getAccount(context, spaceId, accountId)),
    );

    const taskSortableAccountById = new Map<AccountId, TaskSortableAccount>();

    // `TaskModel.applyAction()` needs sortable account payloads, not bare account IDs,
    // so load and cache any referenced accounts that weren't already present on the
    // task.
    for (let i = 0; i < referencedAccounts.length; i++) {
        const account = referencedAccounts[i]!;

        taskSortableAccountById.set(account.id, {
            accountId: account.id,
            workingAccountName: account.initialData.name,
            workingAccountNameVersion: account.initialData.nameVersion,
        });
    }

    return {taskSortableAccountById, referencedAccounts};
}
