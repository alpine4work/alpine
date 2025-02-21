import {useMemo} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {markSearchAffinityLowIntentUpdateInteraction} from "~/client/search/mark_search_affinity_low_intent_update_interaction.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/tasks/core/task_client_store.js";
import {markSearchAffinityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
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

            markLowIntentUpdateInteraction: update => {
                // If an entity is not currently provided, noop.
                if (!affinityId) return;

                const markedEntityIds = new Set<SearchAffinityId>();

                for (const [
                    collectionId,
                    {oldCollectionEntry, newCollectionEntry},
                ] of update.collectionEntryUpdateById) {
                    // If the user creates a collection, count that as a high intent interaction:
                    //
                    // NOTE(calebmer): When creating a task collection from the task dropdown menu,
                    // then `commitTaskActionTransaction()` is called on the server instead of on
                    // the client so `affinityManager` doesn't see it. Make sure to add affinity
                    // points in the `s.$spaceId.tasks.collections.$collectionId.tsx` Remix loader
                    // as well.
                    if (!oldCollectionEntry && newCollectionEntry) {
                        // If this errs it will show up in our telemetry but we don't care about
                        // it here.
                        void markSearchAffinityInteraction(context, {
                            spaceId: space.id,
                            affinityId: `TaskCollection:${collectionId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });

                        markedEntityIds.add(`TaskCollection:${collectionId}`);
                    }
                }

                if (
                    affinityId !== null &&
                    // If we already marked the search entity with an interaction, don't do it
                    // again. e.g. If the user marks a task as active within a task peek then only
                    // send a high intent update interaction. If the user marks a task as active
                    // within a collection we send both a low intent updated interaction for the
                    // collection and a high intent update interaction for the task.
                    !markedEntityIds.has(affinityId)
                ) {
                    markSearchAffinityLowIntentUpdateInteraction(context, space.id, affinityId);
                }
            },
        }),
        [addGlobalLoadingIndicator, affinityId, context, space.id],
    );
}
