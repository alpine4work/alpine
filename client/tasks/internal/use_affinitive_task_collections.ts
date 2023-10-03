import {useEffect} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {scheduleIdlePreloadRpc, useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getAffinitiveTaskCollections} from "~/shared/rpc/tasks_rpc_definitions.js";

// NOCOMMIT: Put this in some shared location as the max number of items to
// show in a collection dropdown.
const affinitiveTaskCollectionLimit = 30;

function useAffinitiveTaskCollections() {
    const {space} = useSpaceContext();

    const {output} = useLazyLoadLoadRpc(getAffinitiveTaskCollections, {
        spaceId: space.id,
        limit: affinitiveTaskCollectionLimit,
    });
}

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
