import {AccessPolicy, AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {
    ContentDuplicationVariableValues,
    applyContentDuplicationVariableValuesToText,
} from "~/shared/content/content_duplication_variable_schema.js";
import {generateDuplicateContentTitle} from "~/shared/content/generate_duplicate_content_title.js";
import {InternalError} from "~/shared/error/error.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskAction, TaskUpdateAccountNameAction} from "~/shared/tasks/actions/task_action.js";
import {TaskUpdateTaskActionMaybeModel} from "~/shared/tasks/actions/task_action_model.js";
import {
    TaskCreateAction,
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
    TaskTaskActionUnion,
} from "~/shared/tasks/actions/task_task_action.js";
import {createDefaultTaskAccessPolicy} from "~/shared/tasks/create_default_task_access_policy.js";
import {applyTaskActionToTaskModelData} from "~/shared/tasks/model/apply_task_action_to_task_model_data.js";
import {applyTaskUpdateAccountNameToTaskModelData} from "~/shared/tasks/model/apply_task_update_account_name_to_task_model_data.js";
import {mergeTaskModelData} from "~/shared/tasks/model/merge_task_model_data.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {
    TaskAssigneeStatus,
    TaskAssigneeStatusRegister,
} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskCreatorFromSchema} from "~/shared/tasks/task_creator.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskLayout, TaskLayoutRegister} from "~/shared/tasks/task_layout.js";
import {TaskPosition, TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {
    TaskSortableAccount,
    TaskSortableAccountSchema,
} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus, TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {
    TaskTitleModel,
    addFallbackToTaskTitle,
    emptyTaskTitleModel,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

export type TaskModelData = SchemaType<typeof TaskModelDataSchema>;

// TypeScript errors here when new TaskTaskActions are added. If you add a new task
// action type you should make sure to update `getDuplicateActions()`.
assertEqualTypes<
    keyof typeof TaskTaskActionUnion,
    | "Create"
    | "Delete"
    | "Undelete"
    | "UpdateParentTaskId"
    | "UpdateParentPosition"
    | "UpdateChildrenCounts"
    | "AddCollection"
    | "RemoveCollection"
    | "UpdateCollectionPosition"
    | "UpdateStatus"
    | "UpdateAssignee"
    | "UpdateAssigneeStatus"
    | "UpdateAssigneePosition"
    | "UpdateTitle"
    | "UpdateDueDate"
    | "UpdatePriority"
    | "UpdateLayout"
    | "UpdateAccessPolicy"
    | "UpdateNotepadPagePosition"
    | "UpdateAssigneeActivePosition"
>();

const TaskModelDataSchema = Schema.object({
    id: Schema.id<TaskId>(),
    spaceId: Schema.id<SpaceId>(),

    creator: TaskSortableAccountSchema.merge(
        Schema.object({
            from: TaskCreatorFromSchema.nullable().default(null),
        }),
    ),
    createdTime: TaskFilterableTime.schema,
    deletedTime: HybridLogicalTimeSchema.nullable(),
    undeletedTime: HybridLogicalTimeSchema.nullable(),

    parent: Schema.object({
        taskId: TaskParentTaskIdRegister.schema,
        position: TaskPositionRegister.schema,
    }),

    // See the documentation on `TaskUpdateChildrenCountsAction` for what these fields
    // are. They are CRDTs that allow us to figure out the task's `childTaskCount` and
    // `childClosedTaskCount`.
    addedChildTaskCount: Schema.integer,
    removedChildTaskCount: Schema.integer,
    addedClosedChildTaskCount: Schema.integer,
    removedClosedChildTaskCount: Schema.integer,

    accessPolicy: AccessPolicyRegister.schema.nullable().default(null),
    collections: TaskCollectionSet.schema,
    positionByCollectionId: TaskPositionByCollectionIdMap.schema,

    status: TaskStatusWithSortableAccountRegister.schema,
    assignee: TaskAssigneeWithSortableAccountRegister.schema,
    assigneeStatus: TaskAssigneeStatusRegister.schema,
    assigneePosition: TaskAssigneePositionRegister.schema,

    title: TaskTitleModel.schema,
    dueDate: TaskDueDateRegister.schema,
    priority: TaskPriorityRegister.schema,
    layout: TaskLayoutRegister.schema.nullable().default(null),
});

// An inactive assignee status object we can return to maintain referential
// identity to avoid unnecessary component updates.
const taskInactiveAssigneeStatus: TaskAssigneeStatus = {type: "Inactive"};

/**
 * A task model object is the representation of a task shared between the client
 * and server. Servers construct this object in `TaskRealtimeService` from a
 * `TaskIndexDoc` removing any sensitive data.
 *
 * This class has many convenience methods that allow you to see the current
 * "logical" value of some property even if the underlying register is something
 * different. For example `assigneeStatus` is always inactive when there is no
 * assignee but the `assigneeStatus` register may have a different value if updates
 * were applied out of order. You still have access to the task's raw underlying
 * data in the `rawData` property.
 */
// Doesn't use the `Model` class since `rawData` contains many "raw" properties we
// want to provide clean accessors for. Like `getAssigneeStatus()` returning null
// when the task is closed.
export class TaskModel {
    public static readonly schema = TaskModelDataSchema.transform<TaskModel>({
        serialize: task => task.rawData,
        deserialize: rawData => new TaskModel(rawData),
    });

    public readonly id: TaskId;
    public readonly rawData: TaskModelData;

    constructor(rawData: TaskModelData) {
        this.id = rawData.id;
        this.rawData = rawData;

        // In Jest eagerly call `getParent()` which caches some data so
        // `expect().toEqual()` never shows uncached data as the reason why two objects
        // don't match. Seeing the cached data can also help determine the difference in a
        // diff.
        if (import.meta.jest) {
            this.getParent();
        }
    }

    public static createFromAction(
        spaceId: SpaceId,
        taskId: TaskId,
        actionTime: HybridLogicalTime,
        action: TaskCreateAction,
        getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount,
    ) {
        return new TaskModel({
            spaceId,
            id: taskId,
            creator: {
                ...getActionReferencedSortableAccount(action.creator.accountId),
                from: action.creator.from,
            },
            createdTime: new TaskFilterableTime({
                absoluteTime: actionTime,
                setterTimeZone: action.creatorTimeZone,
            }),
            deletedTime: null,
            undeletedTime: null,
            parent: {
                taskId: new TaskParentTaskIdRegister(null, actionTime),
                position: new TaskPositionRegister(
                    {orderTime: actionTime, orderKey: initialOrderKey},
                    actionTime,
                ),
            },
            addedChildTaskCount: 0,
            removedChildTaskCount: 0,
            addedClosedChildTaskCount: 0,
            removedClosedChildTaskCount: 0,
            collections: TaskCollectionSet.empty,
            positionByCollectionId: TaskPositionByCollectionIdMap.empty,
            accessPolicy: action.accessPolicy
                ? new AccessPolicyRegister(action.accessPolicy, actionTime)
                : null,
            status: new TaskStatusWithSortableAccountRegister({type: "Open"}, actionTime),
            assignee: new TaskAssigneeWithSortableAccountRegister(null, actionTime),
            assigneeStatus: new TaskAssigneeStatusRegister({type: "Inactive"}, actionTime),
            assigneePosition: new TaskAssigneePositionRegister(null, actionTime),
            title: emptyTaskTitleModel.get(),
            dueDate: new TaskDueDateRegister(null, actionTime),
            priority: new TaskPriorityRegister(null, actionTime),
            layout: null,
        });
    }

    /**
     * Apply an action to this task. Tasks are [CRDTs][1] which means their actions are
     * commutative and idempotent. In practical language: you can apply actions many
     * times and in any order. Our task backend takes advantage of this and doesn't
     * bother enforcing a canonical task order.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public applyAction(
        action: TaskUpdateTaskActionMaybeModel,
        getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount,
    ): TaskModel {
        if (this.id !== action.taskId) {
            throw new InternalError("Can only apply action for a task with the same `TaskId`");
        }

        const rawData = applyTaskActionToTaskModelData(
            this.rawData,
            action.time,
            action.taskAction,
            getActionReferencedSortableAccount,
        );

        // Optimization: Maintain referential integrity if the task's data didn't change.
        if (rawData === this.rawData) return this;

        return new TaskModel(rawData);
    }

    /**
     * Apply an `UpdateAccountName` action to this task. Tasks are [CRDTs][1] which
     * means their actions are commutative and idempotent. In practical language: you
     * can apply actions many times and in any order. Our task backend takes advantage
     * of this and doesn't bother enforcing a canonical task order.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public applyUpdateAccountNameAction(action: TaskUpdateAccountNameAction) {
        const rawData = applyTaskUpdateAccountNameToTaskModelData(this.rawData, action);

        // Optimization: Maintain referential integrity if the task's data didn't change.
        if (rawData === this.rawData) return this;

        return new TaskModel(rawData);
    }

    /**
     * Get the actions required to duplicate this task.
     *
     * This function doesn't duplicate the task's access policy. The new task will have
     * a default access policy where just the creator has access. Duplicated tasks are
     * private to the duplicator until the duplicator shares them.
     *
     * @param creatorId - The actor who is performing the action. @param actionTime -
     * The time the action was performed. @param creatorTimeZone - The time zone of the
     * actor. @param parentTaskId - The ID of the parent task, defaulted to the cloned
     * task's parent. @param titleSuffix - A suffix to append to the cloned task's
     * title. @param variableValues - Values for template variable substitution in the
     * title.
     */
    public getDuplicateActions({
        creatorId,
        actionTime,
        creatorTimeZone,
        parentTaskId,
        withTitleUpdate,
        variableValues,
    }: {
        creatorId: AccountId;
        actionTime: HybridLogicalTime;
        creatorTimeZone: TimeZone;
        parentTaskId?: TaskId;
        withTitleUpdate?: boolean;
        variableValues?: ContentDuplicationVariableValues;
    }): {taskId: TaskId; actions: Array<TaskAction>} {
        const actions: Array<TaskAction> = [];

        // Generate the new task
        const taskId = generateId<TaskId>();
        const taskFilterableTime = new TaskFilterableTime({
            absoluteTime: actionTime,
            setterTimeZone: creatorTimeZone,
        });

        const getActionTime: () => HybridLogicalTime = () => {
            return [actionTime[0], actionTime[1] + actions.length];
        };

        actions.push({
            type: "UpdateTask",
            time: getActionTime(),
            taskId: taskId,
            taskAction: {
                type: "Create",
                creator: {accountId: creatorId, from: null},
                creatorTimeZone: creatorTimeZone,
            },
        });

        // Parent Relationships
        const parentTask = this.getParent();
        if (parentTask) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: parentTaskId ?? parentTask.taskId,
                },
            });

            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPosition: {
                        orderTime: parentTask.position.orderTime,
                        orderKey: parentTask.position.orderKey,
                    },
                },
            });
        }

        const originalTitleText = addFallbackToTaskTitle(this.getTitle().getText());
        let titleText = originalTitleText;

        // Apply variable substitution before suffix logic
        if (variableValues && variableValues.size > 0) {
            titleText = applyContentDuplicationVariableValuesToText(titleText, variableValues);
        }

        if (withTitleUpdate && titleText === originalTitleText) {
            titleText = generateDuplicateContentTitle(titleText);
        }

        actions.push({
            type: "UpdateTask",
            time: getActionTime(),
            taskId: taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: TaskTitleModel.fromText(
                    // Since this could be called on the server, use a random `TaskTitleClientId` so we
                    // don't run into any weird conflicts. If this is called on the client, it's not a
                    // continuous update anyway so the Yjs adjacent item merging optimization doesn't
                    // matter that much.
                    randomlyGenerateTaskTitleClientId(),
                    titleText,
                ).getRaw(),
            },
        });

        // Status
        let newStatus: TaskStatus;
        if (this.getStatus().type === "Closed") {
            newStatus = {
                type: "Closed",
                closerId: creatorId,
                closedTime: taskFilterableTime,
            };
        } else {
            newStatus = {
                type: "Open",
            };
        }

        actions.push({
            type: "UpdateTask",
            time: getActionTime(),
            taskId: taskId,
            taskAction: {
                type: "UpdateStatus",
                status: newStatus,
            },
        });

        // Assignee
        const assignee = this.getAssignee();
        if (assignee) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: assignee.assignee.accountId,
                        assignerId: creatorId,
                        assignedTime: taskFilterableTime,
                    },
                },
            });
        }

        // Assignee Status
        const assigneeStatus = this.getAssigneeStatus();
        if (assigneeStatus.type === "Active") {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: assigneeStatus.type,
                        activatedTime: taskFilterableTime,
                    },
                },
            });
        }

        // Assignee Position Only the assignee can update the task position
        const assigneePosition = this.getAssigneePosition();
        if (assignee && assigneePosition && creatorId === assignee.assignee.accountId) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateAssigneePosition",
                    accountId: assignee.assignee.accountId,
                    position: {
                        orderTime: assigneePosition.orderTime,
                        orderKey: assigneePosition.orderKey,
                    },
                },
            });
        }

        // Collections
        const collections = this.getCollections().getArray();
        for (const collection of collections) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.collectionId,
                    orderKey: collection.orderKey,
                },
            });
        }

        // Due Date
        const dueDate = this.getDueDate();
        if (dueDate) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: dueDate,
                },
            });
        }

        // Priority
        const priority = this.getPriority();
        if (priority) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdatePriority",
                    priority: priority,
                },
            });
        }

        // Layout
        const layout = this.getLayout();
        if (layout !== null) {
            actions.push({
                type: "UpdateTask",
                time: getActionTime(),
                taskId: taskId,
                taskAction: {
                    type: "UpdateLayout",
                    layout,
                },
            });
        }

        return {
            taskId,
            actions,
        };
    }

    /**
     * Merge this task with another. Tasks are [CRDTs][1] which means they have a
     * well-defined merge operation where we converge eventually to the latest
     * representation of a task.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public merge(otherTask: TaskModel): TaskModel {
        const rawData = mergeTaskModelData(this.rawData, otherTask.rawData);

        // Optimization: Maintain referential integrity if the task's data didn't change.
        if (rawData === this.rawData) return this;

        return new TaskModel(rawData);
    }

    /**
     * Make sure the hybrid logical clock's time is beyond any time observed by this
     * task.
     */
    public tick(clock: {tick(time: HybridLogicalTime): void}) {
        return tickTaskModelData(this.rawData, clock);
    }

    public getSpaceId() {
        return this.rawData.spaceId;
    }

    public getCreator() {
        return this.rawData.creator;
    }

    public getCreatedTime() {
        return this.rawData.createdTime;
    }

    public isDeleted() {
        return (
            !!this.rawData.deletedTime &&
            (!this.rawData.undeletedTime ||
                compareHybridLogicalTimes(this.rawData.deletedTime, this.rawData.undeletedTime) > 0)
        );
    }

    // We lazily initialize the parent object so it has the same reference as long as
    // the `TaskModel` is unchanged.
    private _parent:
        | {
              readonly taskId: TaskId;
              readonly position: TaskPosition;
          }
        | null
        | undefined = undefined;

    public getParent() {
        if (this._parent === undefined) {
            this._parent =
                this.rawData.parent.taskId.value !== null
                    ? {
                          taskId: this.rawData.parent.taskId.value,
                          position: this.rawData.parent.position.value,
                      }
                    : null;
        }

        return this._parent;
    }

    public getChildTaskCount() {
        return this.rawData.addedChildTaskCount - this.rawData.removedChildTaskCount;
    }

    public getClosedChildTaskCount() {
        return this.rawData.addedClosedChildTaskCount - this.rawData.removedClosedChildTaskCount;
    }

    public getOpenChildTaskCount() {
        return this.getChildTaskCount() - this.getClosedChildTaskCount();
    }

    public getAccessPolicy(): AccessPolicy {
        return (
            this.rawData.accessPolicy?.value ??
            createDefaultTaskAccessPolicy(this.rawData.creator.accountId)
        );
    }

    public getCollections() {
        return this.rawData.collections;
    }

    /**
     * Get the task's position in a collection. Returns null if the task is not in the
     * collection.
     *
     * If the task's position in this collection was never explicitly set then the
     * task's position defaults to the end of the collection at the time the task was
     * added to the collection. See `TaskUpdateCollectionPositionAction` for more.
     */
    public getCollectionPosition(collectionId: TaskCollectionId): TaskPosition | null {
        const version = this.getCollections().getVersion(collectionId);
        if (!version) return null;

        return (
            this.rawData.positionByCollectionId.get(collectionId) ?? {
                orderTime: version,
                orderKey: initialOrderKey,
            }
        );
    }

    public getStatus() {
        return this.rawData.status.value;
    }

    public getDisplayStatus(): TaskDisplayStatus {
        return this.rawData.status.value.type === "Closed"
            ? "Closed"
            : this.rawData.assignee.value && this.rawData.assigneeStatus.value.type === "Active"
              ? "OpenActive"
              : "OpenInactive";
    }

    public getAssignee() {
        return this.rawData.assignee.value;
    }

    public getAssigneeStatus() {
        return this.rawData.status.value.type === "Open" &&
            this.rawData.assignee.value &&
            this.rawData.assigneeStatus.value.type === "Active"
            ? this.rawData.assigneeStatus.value
            : taskInactiveAssigneeStatus;
    }

    public getAssigneePosition() {
        return this.rawData.assignee.value
            ? this.rawData.assigneePosition.value?.accountId ===
              this.rawData.assignee.value.assignee.accountId
                ? this.rawData.assigneePosition.value.position
                : {orderTime: this.rawData.assignee.version, orderKey: initialOrderKey}
            : null;
    }

    public getTitle() {
        return this.rawData.title;
    }

    public getDueDate() {
        return this.rawData.dueDate.value;
    }

    public getPriority() {
        return this.rawData.priority.value;
    }

    public getLayout(): TaskLayout | null {
        return this.rawData.layout?.value ?? null;
    }
}

function tickTaskModelData(task: TaskModelData, clock: {tick(time: HybridLogicalTime): void}) {
    clock.tick(task.createdTime.absoluteTime);
    if (task.deletedTime !== null) clock.tick(task.deletedTime);
    if (task.undeletedTime !== null) clock.tick(task.undeletedTime);
    clock.tick(task.parent.taskId.version);
    clock.tick(task.parent.position.version);
    if (task.accessPolicy) clock.tick(task.accessPolicy.version);
    task.collections.tick(clock);
    task.positionByCollectionId.tick(clock);
    clock.tick(task.status.version);
    clock.tick(task.assignee.version);
    clock.tick(task.assigneeStatus.version);
    clock.tick(task.assigneePosition.version);
    clock.tick(task.dueDate.version);
    clock.tick(task.priority.version);
    if (task.layout) clock.tick(task.layout.version);
}
