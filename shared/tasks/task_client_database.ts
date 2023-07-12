import {NotFoundError} from "~/shared/error/error.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {applyTaskAction} from "~/shared/tasks/internal/apply_task_action.js";
import {TaskClientState} from "~/shared/tasks/internal/task_client_state.js";
import {TaskActionModel} from "~/shared/tasks/task_action_model.js";
import {TaskModel} from "~/shared/tasks/task_model.js";

export class TaskClientDatabase {
    private readonly _state: TaskClientState;

    private constructor(state: TaskClientState) {
        this._state = state;
    }

    public static empty = new TaskClientDatabase({
        taskById: ImmutableMap.empty(),
    });

    public getTask(taskId: TaskId): TaskModel {
        const task = this._state.taskById.get(taskId);
        if (task === undefined || task.type !== undefined)
            throw new NotFoundError("Task not found");
        return task;
    }

    public applyTaskAction(taskId: TaskId, action: TaskActionModel): TaskClientDatabase {
        const newState = applyTaskAction(this._state, taskId, action);
        if (newState === this._state) return this;
        return new TaskClientDatabase(newState);
    }
}
