import {useMemo} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {markSearchAffinityLowIntentUpdateEntityInteraction} from "~/client/search/mark_search_affinity_low_intent_update_entity_interaction.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/tasks/core/task_client_store.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Also calls `useSearchAffinityViewEntityInteraction()` for the entity.
 */
export function useTaskClientStoreSearchAffinityManager(
    entityId: SearchAffinityEntityId | null,
): TaskClientStoreSearchAffinityManager {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    useSearchAffinityViewEntityInteraction(entityId);

    return useMemo(
        () => ({
            addGlobalLoadingIndicator,

            markLowIntentUpdateInteraction: () => {
                // If an entity is not currently provided, noop.
                if (!entityId) return;

                if (entityId !== null) {
                    markSearchAffinityLowIntentUpdateEntityInteraction(context, space.id, entityId);
                }
            },
        }),
        [addGlobalLoadingIndicator, entityId, context, space.id],
    );
}
