import {CalendarDate} from "@internationalized/date";
import {CrdtMap} from "~/shared/crdt/crdt_map.js";
import {CrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAssignee} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatus} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {TaskTitle} from "~/shared/tasks/task_title.js";

type TaskModelData = {
    readonly id: TaskId;
    readonly spaceId: SpaceId;

    readonly creator: TaskSortableAccount;
    readonly createdTime: TaskFilterableTime;
    // We derive whether the task is deleted or not from these two properties.
    readonly deletedTime: HybridLogicalTime | null;
    readonly undeletedTime: HybridLogicalTime | null;

    readonly parent: {
        readonly taskId: CrdtRegister<TaskId | null>;
        readonly position: CrdtRegister<TaskPosition>;
    };
    // See the documentation on `TaskUpdateChildrenCountsAction` for what these
    // fields are. They are CRDTs that allow us to figure out the task's
    // `childTaskCount` and `childClosedTaskCount`.
    //
    // We don't have `childTaskCount` or `childClosedTaskCount` computed fields
    // since we don't need to index those fields.
    readonly addedChildTaskCount: number;
    readonly removedChildTaskCount: number;
    readonly addedClosedChildTaskCount: number;
    readonly removedClosedChildTaskCount: number;

    readonly collections: {
        readonly collections: TaskCollectionSet;
        readonly positionById: CrdtMap<TaskCollectionId, TaskPosition>;
    };
    readonly notepadPages: {
        readonly positionById: CrdtMap<`${AccountId}-${TaskNotepadPageId}`, TaskPosition>;
    };

    readonly status: CrdtRegister<TaskStatus>;
    readonly assignee: CrdtRegister<TaskAssignee | null>;
    // A task has an inactive assignee status if `status` is closed or `assignee`
    // is null.
    readonly assigneeStatus: CrdtRegister<TaskAssigneeStatus>;

    readonly title: TaskTitle;
    readonly dueDate: CrdtRegister<CalendarDate | null>;
    readonly priority: CrdtRegister<TaskPriority | null>;
};

const inactiveTaskAssigneeStatus: TaskAssigneeStatus = {type: "Inactive"};

/**
 * A `TaskModel` object is the type the server sends to the client with our
 * task data.
 */
export class TaskModel {
    public readonly id: TaskId;
    private readonly _data: TaskModelData;

    constructor(data: TaskModelData) {
        this.id = data.id;
        this._data = data;
    }

    /**
     * Is this task deleted?
     */
    public isDeleted(): boolean {
        return (
            !!this._data.deletedTime &&
            (!this._data.undeletedTime ||
                compareHybridLogicalTimes(this._data.deletedTime, this._data.undeletedTime) > 0)
        );
    }

    /**
     * Get the status we display the task as having in the checkbox circle. It
     * incorporates both the task status and task assignee status.
     */
    public getDisplayStatus(): TaskDisplayStatus {
        return this._data.status.value.type === "Closed"
            ? "Closed"
            : this._data.assignee.value && this._data.assigneeStatus.value.type === "Active"
            ? "OpenActive"
            : "OpenInactive";
    }

    /**
     * Get this task's status. Either open or closed.
     */
    public getStatus(): TaskStatus {
        return this._data.status.value;
    }

    /**
     * Get the account assigned to this task.
     */
    public getAssignee(): TaskAssignee | null {
        return this._data.assignee.value;
    }

    /**
     * Get the assignee status for this task. Either active or inactive. Will
     * always be inactive while the task is closed or there is no assignee.
     */
    public getAssigneeStatus(): TaskAssigneeStatus {
        return this._data.status.value.type === "Open" && this._data.assignee.value
            ? this._data.assigneeStatus.value
            : inactiveTaskAssigneeStatus;
    }

    /**
     * Get the number of child tasks this task has.
     */
    public getChildTaskCount() {
        return this._data.addedChildTaskCount - this._data.removedChildTaskCount;
    }

    /**
     * Get the number of closed child tasks this task has.
     */
    public getClosedChildTaskCount() {
        return this._data.addedClosedChildTaskCount - this._data.removedClosedChildTaskCount;
    }

    /**
     * Get the number of open child tasks this task has.
     */
    public getOpenChildTaskCount() {
        return this.getChildTaskCount() - this.getClosedChildTaskCount();
    }
}
