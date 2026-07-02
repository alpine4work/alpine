import {intoApiThemeColor} from "~/shared/api/content/closed_source/into_api_theme_color.js";
import {ApiTaskCollection} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export function intoApiTaskCollection(collection: TaskCollectionModel): ApiTaskCollection {
    return {
        id: collection.id,
        creator: collection.rawData.creator?.accountId
            ? {id: collection.rawData.creator.accountId}
            : undefined,
        name: collection.getName(),
        color: collection.getColor() ? intoApiThemeColor(collection.getColor()!) : undefined,
    };
}
