import {CalendarDate, parseDate} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {intoApiTaskStatus} from "~/shared/api/content/into_api_task_status.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {randomlyGenerateTaskTitleClientId} from "~/shared/tasks/title/task_title.js";

type TaskPatch = ApiSpecification.components["schemas"]["TaskPatch"];
type ApiTaskStatus = ApiSpecification.components["schemas"]["TaskStatus"];
type ApiTaskPriority = NonNullable<ApiSpecification.components["schemas"]["Task"]["priority"]>;

/**
 * The mutable, API-shaped view of task fields we track while folding a PATCH
 * request down into one final intended task state.
 */
type TaskPatchState = {
    title: string;
    assigneeId: AccountId | null;
    status: ApiTaskStatus;
    dueDate: CalendarDate | null;
    priority: ApiTaskPriority | null;
    collectionIds: Set<TaskCollectionId>;
};

/**
 * Applies API task metadata patches, commits the resulting task actions, and
 * returns the updated task model used for the response.
 *
 * Notes patches are handled separately by `updateTaskNotesFromApi()` since they
 * target the notes collaboration Durable Object rather than task action
 * transactions.
 */
export async function updateTaskWithoutNotesFromApi(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        taskId,
        patches,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        patches: ReadonlyArray<TaskPatch>;
    },
): Promise<TaskModel> {
    const consistency = "StrongWithinCache" as const;
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const botAccountId = context.actor.getBotAccountId();
    const timeZone = defaultTimeZone;

    const initialTask = await context.tasks.getTaskWithoutDependencies(spaceId, taskId, {
        consistency,
    });

    const initialState = createTaskWithoutNotesPatchState(initialTask);
    const finalState = applyTaskWithoutNotesPatches(initialState, patches);

    if (
        finalState.status.type === "Open" &&
        finalState.status.isActive &&
        finalState.assigneeId === null
    ) {
        // Match task creation and product behavior by auto-assigning the bot when the
        // caller requests an active task without an assignee.
        finalState.assigneeId = botAccountId;
    }

    const actions = createTaskWithoutNotesPatchActions({
        taskId,
        initialTask,
        initialState,
        finalState,
        clock,
        botAccountId,
        timeZone,
    });

    if (actions.length === 0) return initialTask;

    const taskSortableAccountsPromise = loadTaskSortableAccountsForActions(context, {
        spaceId,
        initialTask,
        actions,
        consistency,
    });

    const [, taskSortableAccountById] = await runAllPromises([
        commitTaskActionTransaction(context, spaceId, actions, {
            consistency,
            waitForProcessing: true,
        }),
        taskSortableAccountsPromise,
    ]);

    return applyActionsToTaskModel(initialTask, actions, taskSortableAccountById);
}

/**
 * Captures the current task fields that can be updated through the API patch
 * surface.
 */
function createTaskWithoutNotesPatchState(task: TaskModel): TaskPatchState {
    return {
        title: task.getTitle().getText(),
        assigneeId: task.getAssignee()?.assignee.accountId ?? null,
        status: intoApiTaskStatus(task.getDisplayStatus()),
        dueDate: task.getDueDate(),
        priority: task.getPriority(),
        collectionIds: new Set(
            task
                .getCollections()
                .getArray()
                .map(({collectionId}) => collectionId),
        ),
    };
}

/**
 * Applies the patch list in request order to compute the final intended task state
 * before any task actions are generated.
 */
function applyTaskWithoutNotesPatches(
    initialState: TaskPatchState,
    patches: ReadonlyArray<TaskPatch>,
): TaskPatchState {
    const state: TaskPatchState = {
        ...initialState,
        collectionIds: new Set(initialState.collectionIds),
    };

    for (const patch of patches) {
        switch (patch.type) {
            case "SetTitle":
                state.title = patch.title;
                break;
            case "SetAssignee":
                state.assigneeId = patch.assignee;
                if (
                    patch.assignee === null &&
                    state.status.type === "Open" &&
                    state.status.isActive
                ) {
                    state.status = {type: "Open", isActive: false};
                }
                break;
            case "SetStatus":
                state.status = patch.status;
                break;
            case "SetDueDate":
                state.dueDate = patch.due ? parseDate(patch.due.date) : null;
                break;
            case "SetPriority":
                state.priority = patch.priority;
                break;
            case "AddCollection":
                state.collectionIds.add(patch.collectionId);
                break;
            case "RemoveCollection":
                state.collectionIds.delete(patch.collectionId);
                break;
            default:
                throw exhaustive(patch);
        }
    }

    return state;
}

/**
 * Converts the before-and-after patch state into the normalized set of task
 * actions needed to realize the update.
 */
function createTaskWithoutNotesPatchActions({
    taskId,
    initialTask,
    initialState,
    finalState,
    clock,
    botAccountId,
    timeZone,
}: {
    taskId: TaskId;
    initialTask: TaskModel;
    initialState: TaskPatchState;
    finalState: TaskPatchState;
    clock: HybridLogicalClock;
    botAccountId: AccountId;
    timeZone: typeof defaultTimeZone;
}): Array<TaskAction> {
    const actions: Array<TaskAction> = [];

    const pushTaskAction = (
        taskAction: Extract<TaskAction, {readonly type: "UpdateTask"}>["taskAction"],
        time = clock.now(),
    ) => {
        actions.push({type: "UpdateTask", time, taskId, taskAction});
    };

    if (finalState.title !== initialState.title) {
        const titleUpdate = initialTask
            .getTitle()
            .replace(
                randomlyGenerateTaskTitleClientId(),
                0,
                initialState.title.length,
                finalState.title,
            );
        pushTaskAction({type: "UpdateTitle", titleUpdate: titleUpdate.raw});
    }

    if (!isDueDateEqual(initialState.dueDate, finalState.dueDate)) {
        pushTaskAction({
            type: "UpdateDueDate",
            dueDate: finalState.dueDate,
        });
    }

    if (finalState.priority !== initialState.priority) {
        pushTaskAction({
            type: "UpdatePriority",
            priority: finalState.priority,
        });
    }

    const initialIsClosed = initialState.status.type === "Closed";
    const finalIsClosed = finalState.status.type === "Closed";
    const initialIsActive = initialState.status.type === "Open" && initialState.status.isActive;
    const finalIsActive = finalState.status.type === "Open" && finalState.status.isActive;

    if (finalIsClosed) {
        if (!initialIsClosed) {
            const time = clock.now();
            pushTaskAction(
                {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: botAccountId,
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time,
                            setterTimeZone: timeZone,
                        }),
                    },
                },
                time,
            );
        }
    } else if (initialIsClosed) {
        pushTaskAction({
            type: "UpdateStatus",
            status: {type: "Open"},
        });
    }

    if (initialState.assigneeId !== finalState.assigneeId) {
        const time = clock.now();
        pushTaskAction(
            {
                type: "UpdateAssignee",
                assignee:
                    finalState.assigneeId !== null
                        ? {
                              assigneeId: finalState.assigneeId,
                              assignerId: botAccountId,
                              assignedTime: new TaskFilterableTime({
                                  absoluteTime: time,
                                  setterTimeZone: timeZone,
                              }),
                          }
                        : null,
                assigneeStatus:
                    finalState.assigneeId !== null && finalIsActive
                        ? {
                              type: "Active",
                              activatedTime: new TaskFilterableTime({
                                  absoluteTime: time,
                                  setterTimeZone: timeZone,
                              }),
                          }
                        : undefined,
            },
            time,
        );
    } else if (finalIsActive !== initialIsActive) {
        const time = clock.now();
        pushTaskAction(
            finalIsActive
                ? {
                      type: "UpdateAssigneeStatus",
                      assigneeStatus: {
                          type: "Active",
                          activatedTime: new TaskFilterableTime({
                              absoluteTime: time,
                              setterTimeZone: timeZone,
                          }),
                      },
                  }
                : {
                      type: "UpdateAssigneeStatus",
                      assigneeStatus: {type: "Inactive"},
                  },
            time,
        );
    }

    const initialCollectionIds = initialState.collectionIds;
    const finalCollectionIds = finalState.collectionIds;

    for (const collectionId of initialCollectionIds) {
        if (!finalCollectionIds.has(collectionId)) {
            pushTaskAction({
                type: "RemoveCollection",
                collectionId,
            });
        }
    }

    const collectionIdsToAdd = Array.from(finalCollectionIds).filter(
        collectionId => !initialCollectionIds.has(collectionId),
    );

    if (collectionIdsToAdd.length > 0) {
        const orderKeys = generateOrderKeysBetween(
            initialTask.getCollections().getLastOrderKey(),
            null,
            collectionIdsToAdd.length,
        );
        for (let i = 0; i < collectionIdsToAdd.length; i++) {
            pushTaskAction({
                type: "AddCollection",
                collectionId: assertExists(collectionIdsToAdd[i]),
                orderKey: assertExists(orderKeys[i]),
            });
        }
    }

    return actions;
}

/**
 * Applies the generated actions to the loaded task model so the route can build a
 * response without refetching the task.
 */
function applyActionsToTaskModel(
    initialTask: TaskModel,
    actions: ReadonlyArray<TaskAction>,
    taskSortableAccountById: ReadonlyMap<AccountId, TaskSortableAccount>,
): TaskModel {
    let updatedTask = initialTask;
    for (const action of actions) {
        assert(action.type === "UpdateTask");
        updatedTask = updatedTask.applyAction(action, accountId =>
            assertExists(taskSortableAccountById.get(accountId)),
        );
    }

    return updatedTask;
}

/**
 * Load the sortable account payloads needed to apply the generated actions to the
 * in-memory `TaskModel`.
 */
async function loadTaskSortableAccountsForActions(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        initialTask,
        actions,
        consistency,
    }: {
        spaceId: SpaceId;
        initialTask: TaskModel;
        actions: ReadonlyArray<TaskAction>;
        consistency: "StrongWithinCache";
    },
): Promise<Map<AccountId, TaskSortableAccount>> {
    const accountIds = new Set<AccountId>();
    for (const action of actions) {
        collectReferencedIdsFromTaskAction(accountIds, new Set(), action);
    }

    // Seed the lookup from the task's embedded sortable accounts so we only fetch
    // accounts newly introduced by this patch batch.
    const taskSortableAccountById = new Map<AccountId, TaskSortableAccount>();
    for (const taskSortableAccount of getTaskSortableAccountsFromTask(initialTask)) {
        taskSortableAccountById.set(taskSortableAccount.accountId, taskSortableAccount);
    }

    const missingAccountIds = [...accountIds].filter(
        accountId => !taskSortableAccountById.has(accountId),
    );

    const missingAccounts = await runAllPromises(
        missingAccountIds.map(accountId => getAccount(context, spaceId, accountId, {consistency})),
    );

    // `TaskModel.applyAction()` needs sortable account payloads, not bare account IDs,
    // so load and cache any referenced accounts that weren't already present on the
    // task.
    for (let i = 0; i < missingAccountIds.length; i++) {
        taskSortableAccountById.set(assertExists(missingAccountIds[i]), {
            accountId: assertExists(missingAccountIds[i]),
            workingAccountName: assertExists(missingAccounts[i]).initialData.name,
            workingAccountNameVersion: assertExists(missingAccounts[i]).initialData.nameVersion,
        });
    }

    return taskSortableAccountById;
}

/**
 * Collects the sortable account payloads already present on the task so local
 * action application can reuse them before loading anything missing.
 */
function getTaskSortableAccountsFromTask(task: TaskModel): Array<TaskSortableAccount> {
    const taskSortableAccounts: Array<TaskSortableAccount> = [task.rawData.creator];

    if (task.rawData.status.value.type === "Closed") {
        taskSortableAccounts.push(task.rawData.status.value.closer);
    }

    if (task.rawData.assignee.value) {
        taskSortableAccounts.push(task.rawData.assignee.value.assignee);
        taskSortableAccounts.push(task.rawData.assignee.value.assigner);
    }

    return taskSortableAccounts;
}

/**
 * Compares due dates by value so we only emit a due date action when the API patch
 * actually changes the date.
 */
function isDueDateEqual(dueDate1: CalendarDate | null, dueDate2: CalendarDate | null) {
    return dueDate1?.toString() === dueDate2?.toString();
}
