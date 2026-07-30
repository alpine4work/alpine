import {
    HybridLogicalTime,
    maxHybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskTitleSnapshot, addFallbackToTaskTitle} from "~/shared/tasks/title/task_title.js";

export function getTaskSearchEntityBase(task: TaskModel): {
    title: string | null;
    titleSnapshot: TaskTitleSnapshot;
    deletedTime: HybridLogicalTime | undefined;
    displayStatus: {
        value: TaskDisplayStatus;
        version: HybridLogicalTime;
    };
} {
    return {
        title: !task.isDeleted() ? addFallbackToTaskTitle(task.getTitle().getText()) : null,
        titleSnapshot: task.getTitle().getSnapshot(),
        deletedTime:
            task.rawData.deletedTime || task.rawData.undeletedTime
                ? maxHybridLogicalTime(
                      task.rawData.deletedTime ?? zeroHybridLogicalTime,
                      task.rawData.undeletedTime ?? zeroHybridLogicalTime,
                  )
                : undefined,
        displayStatus: {
            value: task.getDisplayStatus(),
            version: maxHybridLogicalTime(
                task.rawData.status.version,
                task.rawData.assigneeStatus.version,
            ),
        },
    };
}
