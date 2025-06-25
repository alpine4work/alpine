import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskAddCollectionAction,
    TaskTaskAction,
    TaskUpdateTitleAction,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskTitleUpdate, TaskTitleUpdateModel} from "~/shared/tasks/title/task_title.js";

/**
 * `TaskAction` but you can change the type of `titleUpdate` in the
 * `UpdateTitle` task action.
 */
export type TaskActionModel =
    | Exclude<TaskAction, {readonly type: "UpdateTask"}>
    | TaskUpdateTaskActionModel;

/**
 * `TaskUpdateTaskAction` but you can change the type of `titleUpdate` in the
 * `UpdateTitle` task action.
 */
export type TaskUpdateTaskActionModel = Replace<
    TaskUpdateTaskAction,
    {readonly taskAction: TaskTaskActionModel}
>;

/**
 * `TaskTaskAction` but you can change the type of `titleUpdate` in the
 * `UpdateTitle` task action.
 */
export type TaskTaskActionModel =
    | Exclude<TaskTaskAction, {readonly type: "UpdateTitle"} | {readonly type: "AddCollection"}>
    | Replace<
          TaskUpdateTitleAction,
          {readonly titleUpdate: TaskTitleUpdateModel; readonly withoutUndoMerge?: boolean}
      >
    | (TaskAddCollectionAction & {readonly referencedCollection?: TaskCollectionModel});

/**
 * `TaskAction` but you can change the type of `titleUpdate` in the
 * `UpdateTitle` task action.
 */
export type TaskActionMaybeModel =
    | Exclude<TaskAction, {readonly type: "UpdateTask"}>
    | TaskUpdateTaskActionMaybeModel;

/**
 * `TaskUpdateTaskAction` but you can change the type of `titleUpdate` in the
 * `UpdateTitle` task action.
 */
export type TaskUpdateTaskActionMaybeModel = Replace<
    TaskUpdateTaskAction,
    {readonly taskAction: TaskTaskActionMaybeModel}
>;

/**
 * `TaskTaskAction` but you can change the type of `titleUpdate` in the
 * `UpdateTitle` task action.
 */
export type TaskTaskActionMaybeModel =
    | Exclude<TaskTaskAction, {readonly type: "UpdateTitle"}>
    | Replace<
          TaskUpdateTitleAction,
          {readonly titleUpdate: TaskTitleUpdate | TaskTitleUpdateModel}
      >;

assertAssignableTypes<TaskAction, TaskActionMaybeModel>();
assertAssignableTypes<TaskActionModel, TaskActionMaybeModel>();

export function fromTaskActionModel(action: TaskActionModel): TaskAction {
    if (action.type !== "UpdateTask") return action;
    return fromTaskUpdateTaskActionModel(action);
}

export function fromTaskUpdateTaskActionModel(
    action: TaskUpdateTaskActionModel,
): TaskUpdateTaskAction {
    if (action.taskAction.type !== "UpdateTitle") return action as TaskUpdateTaskAction;
    return {...action, taskAction: fromTaskTaskActionModel(action.taskAction)};
}

export function fromTaskTaskActionModel(action: TaskTaskActionModel): TaskTaskAction {
    if (action.type !== "UpdateTitle") return action;
    return {...action, titleUpdate: action.titleUpdate.raw};
}
