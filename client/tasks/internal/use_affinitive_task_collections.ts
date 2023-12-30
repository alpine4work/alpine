import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getAffinitiveTaskCollections} from "~/shared/rpc/tasks_rpc_definitions.js";
import {taskCollectionSearchResultLimit} from "~/shared/tasks/model/task_collection_model_search_result.js";

/**
 * Return this account's affinitive task collections. Returns `null` while we
 * are loading the collections from the network.
 */
export function useAffinitiveTaskCollections({isDisabled = false}: {isDisabled?: boolean} = {}) {
    const {space} = useSpaceContext();

    const {output} = useLazyLoadRpc(
        getAffinitiveTaskCollections,
        !isDisabled ? {spaceId: space.id, limit: taskCollectionSearchResultLimit} : null,
    );

    return output?.collectionResults ?? null;
}

/**
 * Preload affinitive task collections when we have some idle time so that they
 * are immediately available when you call `useAffinitiveTaskCollections()` and
 * you don't have to wait for a network request.
 */
export function usePreloadAffinitiveTaskCollections() {
    const {space} = useSpaceContext();

    useIdlyPreloadRpc(getAffinitiveTaskCollections, {
        spaceId: space.id,
        limit: taskCollectionSearchResultLimit,
    });
}
