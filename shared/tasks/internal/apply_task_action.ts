import {FailedPreconditionError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskActionModelForKnownTaskEntry,
    TaskClientState,
    TaskClientStateTaskEntry,
} from "~/shared/tasks/internal/task_client_state.js";
import {
    TaskActionModel,
    TaskCreateActionModel,
    TaskUpdateTitleActionModel,
} from "~/shared/tasks/task_action_model.js";
import {TaskModel} from "~/shared/tasks/task_model.js";
import {applyTaskTitleUpdate, emptyTaskTitle} from "~/shared/tasks/task_title_schema.js";

export function applyTaskAction(
    state: TaskClientState,
    taskId: TaskId,
    action: TaskActionModel,
): TaskClientState {
    const taskById = state.taskById.update(
        taskId,
        (task = {type: "Unknown", taskId, actions: []}) => {
            if (action.type === "Create") {
                return applyTaskCreateAction(task, action);
            } else if (task.type === undefined) {
                return actuallyApplyTaskAction(task, action);
            } else {
                return {...task, actions: [...task.actions, action]};
            }
        },
    );

    if (state.taskById === taskById) return state;
    return {...state, taskById};
}

function actuallyApplyTaskAction(
    task: TaskModel,
    action: TaskActionModelForKnownTaskEntry,
): TaskModel {
    switch (action.type) {
        case "UpdateTitle":
            return applyTaskUpdateTitleAction(task, action);
        default:
            throw exhaustive(action);
    }
}

function applyTaskCreateAction(
    task: TaskClientStateTaskEntry,
    {creator, createdTime}: TaskCreateActionModel,
): TaskClientStateTaskEntry {
    if (task.type === undefined) {
        if (!creator.isEqual(task.creator) || !createdTime.isEqual(task.createdTime)) {
            throw new FailedPreconditionError("Incompatible create action");
        }

        return task;
    }

    let newTask = new TaskModel({
        id: task.taskId,
        creator,
        createdTime,
        title: emptyTaskTitle.get(),
    });

    newTask = task.actions.reduce((task, action) => actuallyApplyTaskAction(task, action), newTask);

    return newTask;
}

function applyTaskUpdateTitleAction(
    task: TaskModel,
    action: TaskUpdateTitleActionModel,
): TaskModel {
    return task.clone({
        title: applyTaskTitleUpdate(task.title, action.titleUpdate),
    });
}
