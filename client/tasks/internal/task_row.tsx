import {LocalTask} from "~/client/tasks/internal/local_tasks_state";
import {LocalTaskId} from "~/shared/id/types/id_types";

export type TaskRow = TaskNormalRow | TaskInteractiveGhostRow | TaskDecorativeGhostRow;

export type TaskNormalRow = {
    readonly type: "Normal";
    readonly parentStack: ReadonlyArray<LocalTask>;
    readonly task: LocalTask;
};

export type TaskInteractiveGhostRow = {
    readonly type: "InteractiveGhost";
    readonly ghostTaskId: LocalTaskId;
};

export type TaskDecorativeGhostRow = {
    readonly type: "DecorativeGhost";
};
