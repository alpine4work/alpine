import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/task_action_model.js";
import {TaskModel} from "~/shared/tasks/task_model.js";

export type TaskClientState = {
    readonly taskById: ImmutableMap<TaskId, TaskClientStateTaskEntry>;
};

export type TaskActionModelForKnownTaskEntry = Exclude<TaskActionModel, {type: "Create"}>;

export type TaskClientStateTaskEntry =
    | TaskModel
    | {
          readonly type: "Unknown";
          readonly taskId: TaskId;
          readonly actions: ReadonlyArray<TaskActionModelForKnownTaskEntry>;
      };
