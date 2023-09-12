import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskCreateAction,
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
    TaskTaskAction,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskAssigneeRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeActivePositionRegister} from "~/shared/tasks/task_assignee_active_position.js";
import {
    TaskAssigneeStatus,
    TaskAssigneeStatusRegister,
} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPosition, TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByAccountIdAndNotepadPageIdMap} from "~/shared/tasks/task_position_by_account_id_and_notepad_page_id.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusRegister} from "~/shared/tasks/task_status.js";
import {emptyTaskTitle} from "~/shared/tasks/task_title.js";

export type TaskModelData = SchemaType<typeof TaskModelDataSchema>;

const TaskModelDataSchema = Schema.object({
    id: Schema.id<TaskId>(),
    spaceId: Schema.id<SpaceId>(),

    creator: TaskSortableAccount.schema,
    createdTime: TaskFilterableTime.schema,
    deletedTime: HybridLogicalTimeSchema.nullable(),
    undeletedTime: HybridLogicalTimeSchema.nullable(),

    parent: Schema.object({
        taskId: TaskParentTaskIdRegister.schema,
        position: TaskPositionRegister.schema,
    }),

    // See the documentation on `TaskUpdateChildrenCountsAction` for what these
    // fields are. They are CRDTs that allow us to figure out the task's
    // `childTaskCount` and `childClosedTaskCount`.
    addedChildTaskCount: Schema.integer,
    removedChildTaskCount: Schema.integer,
    addedClosedChildTaskCount: Schema.integer,
    removedClosedChildTaskCount: Schema.integer,

    collections: TaskCollectionSet.schema,
    positionByCollectionId: TaskPositionByCollectionIdMap.schema,

    // We only include the positions for notepad pages owned by the account actor.
    // Other positions we filter out on the server.
    positionByAccountIdAndNotepadPageId: TaskPositionByAccountIdAndNotepadPageIdMap.schema,

    status: TaskStatusRegister.schema,
    assignee: TaskAssigneeRegister.schema,
    assigneeStatus: TaskAssigneeStatusRegister.schema,
    assigneeActivePosition: TaskAssigneeActivePositionRegister.schema,

    title: TaskTitleModel.schema,
    dueDate: TaskDueDateRegister.schema,
    priority: TaskPriorityRegister.schema,
});

// An inactive assignee status object we can return to maintain referential
// identity to avoid unnecessary component updates.
const taskInactiveAssigneeStatus: TaskAssigneeStatus = {type: "Inactive"};

/**
 * A task model object is the representation of a task shared between the
 * client and server. Servers construct this object in `TaskRealtimeService`
 * from a `TaskIndexDoc` removing any sensitive data.
 *
 * This class has many convenience methods that allow you to see the current
 * "logical" value of some property even if the underlying register is
 * something different. For example `assigneeStatus` is always inactive when
 * there is no assignee but the `assigneeStatus` register may have a different
 * value if updates were applied out of order. You still have access to the
 * task's raw underlying data in the `rawData` property.
 */
// Doesn't use the `Model` class since `rawData` contains many "raw" properties
// we want to provide clean accessors for. Like `getAssigneeStatus()` returning
// null when the task is closed.
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

        // Kinda hacky but in tests eagerly call `getParent()` so
        // `expect().toEqual()` never shows parent as the reason why two objects
        // don't match.
        if (import.meta.jest) {
            this.getParent();
        }
    }

    public static createFromAction(
        spaceId: SpaceId,
        taskId: TaskId,
        actionTime: HybridLogicalTime,
        action: TaskCreateAction,
    ) {
        return new TaskModel({
            spaceId,
            id: taskId,
            creator: action.creator,
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
            positionByAccountIdAndNotepadPageId: TaskPositionByAccountIdAndNotepadPageIdMap.empty,
            status: new TaskStatusRegister({type: "Open"}, actionTime),
            assignee: new TaskAssigneeRegister(null, actionTime),
            assigneeStatus: new TaskAssigneeStatusRegister({type: "Inactive"}, actionTime),
            assigneeActivePosition: new TaskAssigneeActivePositionRegister(null, actionTime),
            title: TaskTitleModel.new(emptyTaskTitle.get()),
            dueDate: new TaskDueDateRegister(null, actionTime),
            priority: new TaskPriorityRegister(null, actionTime),
        });
    }

    /**
     * Apply an action to this task. Tasks are [CRDTs][1] which means their actions
     * are commutative and idempotent. In practical language: you can apply
     * actions many times and in any order. Our task backend takes advantage of
     * this and doesn't bother enforcing a canonical task order.
     *
     * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
     */
    public apply(action: TaskUpdateTaskAction): TaskModel {
        if (this.id !== action.taskId) {
            throw new InternalError("Can only apply action for a task with the same `TaskId`");
        }

        const rawData = applyTaskActionToTaskModelData(
            this.rawData,
            action.time,
            action.taskAction,
        );

        // Optimization: Maintain referential integrity if the task's data didn't
        // change.
        if (rawData === this.rawData) return this;

        return new TaskModel(rawData);
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

        // Optimization: Maintain referential integrity if the task's data didn't
        // change.
        if (rawData === this.rawData) return this;

        return new TaskModel(rawData);
    }

    /**
     * Make sure the hybrid logical clock's time is beyond any time observed by
     * this task.
     */
    public tick(clock: HybridLogicalClock) {
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

    // We lazily initialize the parent object so it has the same reference as long
    // as the `TaskModel` is unchanged.
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

    public getCollections() {
        return this.rawData.collections;
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

    public getAssigneeActivePosition() {
        return this.rawData.status.value.type === "Open" &&
            this.rawData.assignee.value &&
            this.rawData.assigneeStatus?.value.type === "Active"
            ? this.rawData.assigneeActivePosition.value?.accountId ===
              this.rawData.assignee.value.assignee.accountId
                ? this.rawData.assigneeActivePosition.value.position
                : // TODO(calebmer): Ideally we'd return a referentially identical object here
                  // whenever this function is called instead of creating a new object. Does it
                  // matter for performance?
                  {orderTime: this.rawData.assigneeStatus.version, orderKey: initialOrderKey}
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
}

function mergeTaskModelData(task1: TaskModelData, task2: TaskModelData) {
    if (task1.id !== task2.id)
        throw new InternalError("Can only merge tasks with the same `TaskId`");

    if (task1.spaceId !== task2.spaceId)
        throw new InternalError("Incompatible task `spaceId` when merging");

    if (!task1.creator.isEqual(task2.creator))
        throw new InternalError("Incompatible task `creator` when merging");

    if (!task1.createdTime.isEqual(task2.createdTime))
        throw new InternalError("Incompatible task `createdTime` when merging");

    const newTask: TaskModelData = {
        id: task1.id,
        spaceId: task1.spaceId,

        creator: task1.creator,
        createdTime: task1.createdTime,
        deletedTime:
            task1.deletedTime !== null && task2.deletedTime !== null
                ? maxHybridLogicalTime(task1.deletedTime, task2.deletedTime)
                : task1.deletedTime ?? task2.deletedTime,
        undeletedTime:
            task1.undeletedTime !== null && task2.undeletedTime !== null
                ? maxHybridLogicalTime(task1.undeletedTime, task2.undeletedTime)
                : task1.undeletedTime ?? task2.undeletedTime,

        parent: {
            taskId: task1.parent.taskId.merge(task2.parent.taskId),
            position: task1.parent.position.merge(task2.parent.position),
        },

        addedChildTaskCount: Math.max(task1.addedChildTaskCount, task2.addedChildTaskCount),
        removedChildTaskCount: Math.max(task1.removedChildTaskCount, task2.removedChildTaskCount),
        addedClosedChildTaskCount: Math.max(
            task1.addedClosedChildTaskCount,
            task2.addedClosedChildTaskCount,
        ),
        removedClosedChildTaskCount: Math.max(
            task1.removedClosedChildTaskCount,
            task2.removedClosedChildTaskCount,
        ),

        collections: task1.collections.merge(task2.collections),
        positionByCollectionId: task1.positionByCollectionId.merge(task2.positionByCollectionId),

        positionByAccountIdAndNotepadPageId: task1.positionByAccountIdAndNotepadPageId.merge(
            task2.positionByAccountIdAndNotepadPageId,
        ),

        status: task1.status.merge(task2.status),
        assignee: task1.assignee.merge(task2.assignee),
        assigneeStatus: task1.assigneeStatus.merge(task2.assigneeStatus),
        assigneeActivePosition: task1.assigneeActivePosition.merge(task2.assigneeActivePosition),

        title: task1.title.isEqual(task2.title) ? task1.title : task1.title.apply(task2.title.raw),
        dueDate: task1.dueDate.merge(task2.dueDate),
        priority: task1.priority.merge(task2.priority),
    };

    // Optimization: If nothing changed between `task1` and the merged task then
    // return `task1` so the new task is referentially equal to the old one.
    if (isDeepEqual(task1, newTask)) return task1;

    return newTask;
}

function applyTaskActionToTaskModelData(
    task: TaskModelData,
    actionTime: HybridLogicalTime,
    action: TaskTaskAction,
): TaskModelData {
    switch (action.type) {
        case "Create": {
            if (
                !task.creator.isEqual(action.creator) ||
                !task.createdTime.isEqual(
                    new TaskFilterableTime({
                        absoluteTime: actionTime,
                        setterTimeZone: action.creatorTimeZone,
                    }),
                )
            ) {
                throw new FailedPreconditionError("Incompatible create action");
            }
            return task;
        }
        case "Delete": {
            const newDeletedTime =
                task.deletedTime !== null
                    ? maxHybridLogicalTime(task.deletedTime, actionTime)
                    : actionTime;

            if (newDeletedTime === task.deletedTime) return task;
            return {...task, deletedTime: newDeletedTime};
        }
        case "Undelete": {
            const newUndeletedTime =
                task.undeletedTime !== null
                    ? maxHybridLogicalTime(task.undeletedTime, actionTime)
                    : actionTime;

            if (newUndeletedTime === task.undeletedTime) return task;
            return {...task, undeletedTime: newUndeletedTime};
        }
        case "UpdateParentTaskId": {
            const newParentTaskId = task.parent.taskId.apply({
                value: action.parentTaskId,
                version: actionTime,
            });

            const newParentPosition = task.parent.position.apply({
                value: {orderTime: actionTime, orderKey: initialOrderKey},
                version: actionTime,
            });

            if (
                newParentTaskId === task.parent.taskId &&
                newParentPosition === task.parent.position
            ) {
                return task;
            }

            return {
                ...task,
                parent: {
                    taskId: newParentTaskId,
                    position: newParentPosition,
                },
            };
        }
        case "UpdateParentPosition": {
            const newParentPosition = task.parent.position.apply({
                value: action.parentPosition,
                version: actionTime,
            });

            if (newParentPosition === task.parent.position) return task;

            return {
                ...task,
                parent: {
                    taskId: task.parent.taskId,
                    position: newParentPosition,
                },
            };
        }
        case "UpdateChildrenCounts": {
            const newAddedChildTaskCount = Math.max(
                task.addedChildTaskCount,
                action.addedChildTaskCount,
            );
            const newRemovedChildTaskCount = Math.max(
                task.removedChildTaskCount,
                action.removedChildTaskCount,
            );
            const newAddedClosedChildTaskCount = Math.max(
                task.addedClosedChildTaskCount,
                action.addedClosedChildTaskCount,
            );
            const newRemovedClosedChildTaskCount = Math.max(
                task.removedClosedChildTaskCount,
                action.removedClosedChildTaskCount,
            );

            if (
                task.addedChildTaskCount === newAddedChildTaskCount &&
                task.removedChildTaskCount === newRemovedChildTaskCount &&
                task.addedClosedChildTaskCount === newAddedClosedChildTaskCount &&
                task.removedClosedChildTaskCount === newRemovedClosedChildTaskCount
            ) {
                return task;
            }

            return {
                ...task,
                addedChildTaskCount: newAddedChildTaskCount,
                removedChildTaskCount: newRemovedChildTaskCount,
                addedClosedChildTaskCount: newAddedClosedChildTaskCount,
                removedClosedChildTaskCount: newRemovedClosedChildTaskCount,
            };
        }
        case "AddCollection": {
            const newCollections = task.collections.apply({
                type: "Set",
                key: action.collectionId,
                value: action.orderKey,
                version: actionTime,
            });

            if (newCollections === task.collections) return task;

            return {
                ...task,
                collections: newCollections,
            };
        }
        case "RemoveCollection": {
            const newCollections = task.collections.apply({
                type: "Delete",
                key: action.collectionId,
                version: actionTime,
            });

            if (newCollections === task.collections) return task;

            return {
                ...task,
                collections: newCollections,
            };
        }
        case "UpdateCollectionPosition": {
            const newPositionByCollectionId = task.positionByCollectionId.apply({
                type: "Set",
                key: action.collectionId,
                value: action.position,
                version: actionTime,
            });

            if (newPositionByCollectionId === task.positionByCollectionId) return task;

            return {
                ...task,
                positionByCollectionId: newPositionByCollectionId,
            };
        }
        case "UpdateNotepadPagePosition": {
            const newPositionByAccountIdAndNotepadPageId =
                action.position !== null
                    ? task.positionByAccountIdAndNotepadPageId.apply({
                          type: "Set",
                          key: `${action.accountId}-${action.notepadPageId}`,
                          value: action.position,
                          version: actionTime,
                      })
                    : task.positionByAccountIdAndNotepadPageId.apply({
                          type: "Delete",
                          key: `${action.accountId}-${action.notepadPageId}`,
                          version: actionTime,
                      });

            if (newPositionByAccountIdAndNotepadPageId === task.positionByAccountIdAndNotepadPageId)
                return task;

            return {
                ...task,
                positionByAccountIdAndNotepadPageId: newPositionByAccountIdAndNotepadPageId,
            };
        }
        case "UpdateStatus": {
            const newStatus = task.status.apply({
                value: action.status,
                version: actionTime,
            });

            const newAssigneeStatus = task.assigneeStatus.apply({
                value: {type: "Inactive"},
                version: actionTime,
            });

            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newStatus === task.status &&
                newAssigneeStatus === task.assigneeStatus &&
                newAssigneeActivePosition === task.assigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                status: newStatus,
                assigneeStatus: newAssigneeStatus,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateAssignee": {
            const newAssignee = task.assignee.apply({
                value: action.assignee,
                version: actionTime,
            });

            const newAssigneeStatus = task.assigneeStatus.apply({
                value: {type: "Inactive"},
                version: actionTime,
            });

            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newAssignee === task.assignee &&
                newAssigneeStatus === task.assigneeStatus &&
                newAssigneeActivePosition === task.assigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                assignee: newAssignee,
                assigneeStatus: newAssigneeStatus,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateAssigneeStatus": {
            const newAssigneeStatus = task.assigneeStatus.apply({
                value: action.assigneeStatus,
                version: actionTime,
            });

            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newAssigneeStatus === task.assigneeStatus &&
                newAssigneeActivePosition === task.assigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                assigneeStatus: newAssigneeStatus,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateAssigneeActivePosition": {
            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: {
                    accountId: action.accountId,
                    position: action.position,
                },
                version: actionTime,
            });

            if (newAssigneeActivePosition === task.assigneeActivePosition) {
                return task;
            }

            return {
                ...task,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateTitle": {
            const newTitle = task.title.apply(action.titleUpdate);

            if (newTitle.isEqual(task.title)) return task;

            return {
                ...task,
                title: newTitle,
            };
        }
        case "UpdateDueDate": {
            const newDueDate = task.dueDate.apply({
                value: action.dueDate,
                version: actionTime,
            });

            if (newDueDate === task.dueDate) return task;

            return {
                ...task,
                dueDate: newDueDate,
            };
        }
        case "UpdatePriority": {
            const newPriority = task.priority.apply({
                value: action.priority,
                version: actionTime,
            });

            if (newPriority === task.priority) return task;

            return {
                ...task,
                priority: newPriority,
            };
        }
        default:
            throw exhaustive(action);
    }
}

function tickTaskModelData(task: TaskModelData, clock: HybridLogicalClock) {
    clock.tick(task.createdTime.absoluteTime);
    if (task.deletedTime !== null) clock.tick(task.deletedTime);
    if (task.undeletedTime !== null) clock.tick(task.undeletedTime);
    clock.tick(task.parent.taskId.version);
    clock.tick(task.parent.position.version);
    task.collections.tick(clock);
    task.positionByCollectionId.tick(clock);
    task.positionByAccountIdAndNotepadPageId.tick(clock);
    clock.tick(task.status.version);
    clock.tick(task.assignee.version);
    clock.tick(task.assigneeStatus.version);
    clock.tick(task.assigneeActivePosition.version);
    clock.tick(task.dueDate.version);
    clock.tick(task.priority.version);
}
