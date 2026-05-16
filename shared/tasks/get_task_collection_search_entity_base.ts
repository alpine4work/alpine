import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {
    HybridLogicalTime,
    maxHybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export function getTaskCollectionSearchEntityBase(collection: TaskCollectionModel): {
    title: string | null;
    titleVersion: HybridLogicalTime;
    color: {
        value: ThemeColor | null;
        version: HybridLogicalTime;
    };
} {
    return {
        title: !collection.isDeleted() ? collection.rawData.name.value : null,
        titleVersion: maxHybridLogicalTime(
            collection.rawData.name.version,
            collection.rawData.deletedTime ?? zeroHybridLogicalTime,
            collection.rawData.undeletedTime ?? zeroHybridLogicalTime,
        ),
        color: {
            value: collection.rawData.color.value,
            version: collection.rawData.color.version,
        },
    };
}
