import {Memo, useMemo} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {markSearchAffinityLowIntentUpdateEntityInteraction} from "~/client/web/search/mark_search_affinity_low_intent_update_entity_interaction.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSiteActivation} from "~/client/web/sites/context/site_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/web/tasks/core/task_client_store.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Also calls `useSearchAffinityViewEntityInteraction()` for the entity.
 */
export function useTaskClientStoreSearchAffinityManager(
    entityId: SearchAffinityEntityId | null,
    {
        onMarkLowIntentUpdateInteraction,
    }: {
        onMarkLowIntentUpdateInteraction?: Memo<(count: number) => void>;
    } = emptyObject,
): TaskClientStoreSearchAffinityManager {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();
    const {activeSiteId} = useSiteActivation();

    useSearchAffinityViewEntityInteraction(entityId);

    return useMemo(
        () => ({
            addGlobalLoadingIndicator,

            markLowIntentUpdateInteraction: () => {
                // If an entity is not currently provided, noop.
                if (!entityId) return;

                if (entityId !== null) {
                    const count = markSearchAffinityLowIntentUpdateEntityInteraction(
                        context,
                        space.id,
                        entityId,
                        activeSiteId,
                    );
                    onMarkLowIntentUpdateInteraction?.(count);
                }
            },
        }),
        [
            addGlobalLoadingIndicator,
            entityId,
            activeSiteId,
            context,
            space.id,
            onMarkLowIntentUpdateInteraction,
        ],
    );
}
