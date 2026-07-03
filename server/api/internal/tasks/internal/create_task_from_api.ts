import {CalendarDate} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {createTaskNotesCreateTransactionEntry} from "~/server/tasks/data/create_task_notes_create_transaction_entry.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

export type ApiCreatedTask = {
    id: TaskId;
    creatorId: AccountId;
    title: string;
    status: {type: "Open"; isActive: boolean} | {type: "Closed"};
    assigneeId?: AccountId;
    dueDate?: CalendarDate;
    priority?: TaskPriority;
    layout: TaskLayout | null;
    parentTaskId?: TaskId;
    collectionIds: ReadonlyArray<TaskCollectionId>;
};

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
): Promise<ApiCreatedTask> {
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const botAccountId = context.actor.getBotAccountId();
    creatorId ??= botAccountId;
    const actor: TaskActor = {
        accountId: creatorId,
        from: {type: "Bot", accountId: botAccountId},
    };
    const createdTimeZone = defaultTimeZone;

    const effectiveAssigneeId =
        status?.type === "Open" && status.isActive && assigneeId === undefined
            ? botAccountId
            : assigneeId;

    const effectiveStatus = status ?? {type: "Open", isActive: false};
    const effectiveLayout = layout ?? null;
    const effectiveCollectionIds = [...new Set(collectionIds ?? [])];

    const actions: Array<TaskAction> = [
        {
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
        },
    ];

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

    const currentTime = new Date();

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

    await commitTaskActionTransaction(context, spaceId, actions, {
        consistency: "StrongWithinCache",
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
    });

    return {
        id: taskId,
        creatorId,
        title,
        status: effectiveStatus,
        assigneeId: effectiveAssigneeId,
        dueDate,
        priority,
        layout: effectiveLayout,
        parentTaskId,
        collectionIds: effectiveCollectionIds,
    };
}
