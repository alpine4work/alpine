import {useMemo} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {markSearchAffinityLowIntentUpdateInteraction} from "~/client/search/mark_search_affinity_low_intent_update_interaction.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/tasks/core/task_client_store.js";
import {SearchAffinityId} from "~/shared/search/search_affinity_id.js";

/**
 * Also calls `useSearchAffinityViewInteraction()` for the entity.
 */
export function useTaskClientStoreSearchAffinityManager(
    affinityId: SearchAffinityId | null,
): TaskClientStoreSearchAffinityManager {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    useSearchAffinityViewInteraction(affinityId);

    return useMemo(
        () => ({
            addGlobalLoadingIndicator,

            markLowIntentUpdateInteraction: () => {
                // If an entity is not currently provided, noop.
                if (!affinityId) return;

                if (affinityId !== null) {
                    markSearchAffinityLowIntentUpdateInteraction(context, space.id, affinityId);
                }
            },
        }),
        [addGlobalLoadingIndicator, affinityId, context, space.id],
    );
}
