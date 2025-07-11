import {
    maxHybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";
import {SearchEntityTitleVersion} from "~/shared/search/search_entity_title_version.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/title/task_title.js";

export function getTaskSearchEntityBase(task: TaskModel): {
    title: string | null;
    titleVersion: SearchEntityTitleVersion;
    media: SearchEntityMediaModel & {type: "TaskDisplayStatus"};
} {
    return {
        title: !task.isDeleted() ? addFallbackToTaskTitle(task.getTitle().getText()) : null,
        titleVersion: {
            type: "TaskTitle",
            snapshot: task.getTitle().getSnapshot(),
            deletedTime:
                task.rawData.deletedTime || task.rawData.undeletedTime
                    ? maxHybridLogicalTime(
                          task.rawData.deletedTime ?? zeroHybridLogicalTime,
                          task.rawData.undeletedTime ?? zeroHybridLogicalTime,
                      )
                    : undefined,
        },
        media: {
            type: "TaskDisplayStatus",
            displayStatus: task.getDisplayStatus(),
            version: maxHybridLogicalTime(
                task.rawData.status.version,
                task.rawData.assigneeStatus.version,
            ),
        },
    };
}
