import {intoApiSort} from "~/server/api/internal/tasks/internal/into_api_task_sort.js";
import {intoApiFilter} from "~/shared/api/content/closed_source/into_api_task_filter.js";
import {intoApiThemeColor} from "~/shared/api/content/closed_source/into_api_theme_color.js";
import {
    ApiTaskCollectionResponse,
    ApiTaskQueryDefaults,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskQueryDefaults} from "~/shared/tasks/task_query_defaults.js";

export function intoApiTaskCollection(collection: TaskCollectionModel): ApiTaskCollectionResponse {
    return {
        id: collection.id,
        creator: collection.rawData.creator?.accountId
            ? {id: collection.rawData.creator.accountId}
            : undefined,
        name: collection.getName(),
        color: collection.getColor() ? intoApiThemeColor(collection.getColor()!) : undefined,
        defaults: intoApiTaskQueryDefaults(collection.getDefaults()),
    };
}

function intoApiTaskQueryDefaults(defaults: TaskQueryDefaults): ApiTaskQueryDefaults {
    return {
        filters: defaults.filters.map(intoApiFilter),
        sorts: defaults.sorts.map(intoApiSort),
    };
}
