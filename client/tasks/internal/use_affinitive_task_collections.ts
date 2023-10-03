import {useEffect} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {scheduleIdlePreloadRpc, useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getAffinitiveTaskCollections} from "~/shared/rpc/tasks_rpc_definitions.js";

// NOCOMMIT: Put this in some shared location as the max number of items to
// show in a collection dropdown.
const affinitiveTaskCollectionLimit = 30;

/**
 * Return this account's affinitive task collections. Returns `null` while we
 * are loading the collections from the network.
 */
export function useAffinitiveTaskCollections({isDisabled = false}: {isDisabled?: boolean} = {}) {
    const {space} = useSpaceContext();

    const {output} = useLazyLoadLoadRpc(
        getAffinitiveTaskCollections,
        !isDisabled ? {spaceId: space.id, limit: affinitiveTaskCollectionLimit} : null,
    );

    return output?.collectionResults ?? null;
}

/**
 * Preload affinitive task collections when we have some idle time so that they
 * are immediately available when you call `useAffinitiveTaskCollections()` and
 * you don't have to wait for a network request.
 */
export function usePreloadAffinitiveTaskCollections() {
    const context = useAppContext();
    const {space} = useSpaceContext();

    useEffect(() => {
        scheduleIdlePreloadRpc(context, getAffinitiveTaskCollections, {
            spaceId: space.id,
            limit: affinitiveTaskCollectionLimit,
        });
    }, [context, space.id]);
}
