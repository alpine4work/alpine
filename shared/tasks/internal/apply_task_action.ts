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
    TaskUpdateCollectionsActionModel,
    TaskUpdateTitleActionModel,
} from "~/shared/tasks/task_action_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskModel} from "~/shared/tasks/task_model.js";
import {applyTaskTitleUpdate, emptyTaskTitle} from "~/shared/tasks/task_title.js";

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
        case "UpdateCollections":
            return applyTaskUpdateCollectionsAction(task, action);
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
        collections: TaskCollectionSet.empty,
    });

    newTask = task.actions.reduce((task, action) => actuallyApplyTaskAction(task, action), newTask);

    return newTask;
}

function applyTaskUpdateTitleAction(
    task: TaskModel,
    {titleUpdate}: TaskUpdateTitleActionModel,
): TaskModel {
    return task.clone({
        title: applyTaskTitleUpdate(task.title, titleUpdate),
    });
}

function applyTaskUpdateCollectionsAction(
    task: TaskModel,
    {action}: TaskUpdateCollectionsActionModel,
): TaskModel {
    return task.clone({
        collections: task.collections.apply(action),
    });
}
