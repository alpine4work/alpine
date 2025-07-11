import {
    maxHybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";
import {SearchEntityTitleVersion} from "~/shared/search/search_entity_title_version.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export function getTaskCollectionSearchEntityBase(collection: TaskCollectionModel): {
    title: string | null;
    titleVersion: SearchEntityTitleVersion;
    media: SearchEntityMediaModel & {type: "TaskCollectionColor"};
} {
    return {
        title: !collection.isDeleted() ? collection.rawData.name.value : null,
        titleVersion: {
            type: "HybridLogicalTime",
            time: maxHybridLogicalTime(
                collection.rawData.name.version,
                collection.rawData.deletedTime ?? zeroHybridLogicalTime,
                collection.rawData.undeletedTime ?? zeroHybridLogicalTime,
            ),
        },
        media: {
            type: "TaskCollectionColor",
            color: collection.rawData.color.value,
            version: collection.rawData.color.version,
        },
    };
}
