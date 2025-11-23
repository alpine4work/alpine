import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {searchTaskCollectionsByAffinity} from "~/shared/rpc/search_rpc_definitions.js";
import {taskCollectionSearchResultLimit} from "~/shared/tasks/model/task_collection_model_search_result.js";

/**
 * Return this account's affinitive task collections. Returns `null` while we
 * are loading the collections from the network.
 */
export function useSearchTaskCollectionsByAffinity({
    isDisabled = false,
}: {isDisabled?: boolean} = {}) {
    const {space} = useSpaceContext();

    const {output} = useLazyLoadRpc(
        searchTaskCollectionsByAffinity,
        !isDisabled ? {spaceId: space.id, limit: taskCollectionSearchResultLimit} : null,
    );

    return output?.results ?? null;
}

/**
 * Preload affinitive task collections when we have some idle time so that they
 * are immediately available when you call
 * `useSearchTaskCollectionsByAffinity()` and you don't have to wait for a
 * network request.
 */
export function usePreloadSearchTaskCollectionsByAffinity({
    isDisabled,
}: {isDisabled?: boolean} = {}) {
    const {space, currentAccount} = useSpaceContext();

    useIdlyPreloadRpc(
        searchTaskCollectionsByAffinity,
        !isDisabled && currentAccount
            ? {
                  spaceId: space.id,
                  limit: taskCollectionSearchResultLimit,
              }
            : null,
    );
}
