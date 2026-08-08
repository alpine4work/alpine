import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {SearchEntityModel, isDeletedSearchEntity} from "~/shared/search/search_entity_model.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {Store} from "~/shared/store/store.js";

export function isDeletedSearchEntityResult(
    get: <Value>(store: Store<Value>) => Value,
    searchEntityRegistry: SearchEntityRegistry,
    result: SearchEntityResultModel | SearchAffinityEntityResultModel,
): boolean {
    if (!(result.model instanceof SearchEntityModel)) return false;

    return isDeletedSearchEntity(get(searchEntityRegistry.getEntityStore(result.model)));
}
