import {useMemo} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {markSearchEntityAffinityLowIntentUpdateInteraction} from "~/client/search/mark_search_entity_affinity_low_intent_update_interaction.js";
import {useSearchEntityAffinityViewInteraction} from "~/client/search/use_search_entity_view_affinity_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStoreSearchEntityAffinityManager} from "~/client/tasks/task_client_store.js";
import {markSearchEntityAffinityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchEntityAffinityId} from "~/shared/search/search_entity_affinity_id.js";

/**
 * Also calls `useSearchEntityAffinityViewInteraction()` for the entity.
 */
export function useTaskClientStoreSearchEntityAffinityManager(
    entityId: SearchEntityAffinityId | null,
): TaskClientStoreSearchEntityAffinityManager {
    const context = useAppContext();
    const {space, currentAccount} = useSpaceContext();

    useSearchEntityAffinityViewInteraction(entityId);

    return useMemo(
        () => ({
            markLowIntentUpdateInteraction: update => {
                // If an entity is not currently provided, noop.
                if (!entityId) return;

                const markedEntityIds = new Set<SearchEntityAffinityId>();

                for (const [taskId, {oldTaskEntry, newTaskEntry}] of update.taskEntryUpdateById) {
                    const oldDisplayStatus =
                        oldTaskEntry?.task?.getDisplayStatus() ?? "OpenInactive";
                    const newDisplayStatus =
                        newTaskEntry.task?.getDisplayStatus() ?? "OpenInactive";

                    // If the user marks a task they're assigned to as active, count that as a high
                    // intent interaction:
                    if (
                        oldDisplayStatus !== newDisplayStatus &&
                        newDisplayStatus === "OpenActive" &&
                        newTaskEntry.task?.getAssignee()?.assignee.accountId === currentAccount.id
                    ) {
                        // If this errs it will show up in our telemetry but we don't care about
                        // it here.
                        void markSearchEntityAffinityInteraction(context, {
                            spaceId: space.id,
                            entityId: `Task:${taskId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });

                        markedEntityIds.add(`Task:${taskId}`);
                    }
                }

                for (const [
                    collectionId,
                    {oldCollectionEntry, newCollectionEntry},
                ] of update.collectionEntryUpdateById) {
                    // If the user creates a collection, count that as a high intent interaction:
                    if (!oldCollectionEntry && newCollectionEntry) {
                        // If this errs it will show up in our telemetry but we don't care about
                        // it here.
                        void markSearchEntityAffinityInteraction(context, {
                            spaceId: space.id,
                            entityId: `TaskCollection:${collectionId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });

                        markedEntityIds.add(`TaskCollection:${collectionId}`);
                    }
                }

                if (
                    entityId !== null &&
                    // If we already marked the search entity with an interaction, don't do it
                    // again. e.g. If the user marks a task as active within a task peek then only
                    // send a high intent update interaction. If the user marks a task as active
                    // within a collection we send both a low intent updated interaction for the
                    // collection and a high intent update interaction for the task.
                    !markedEntityIds.has(entityId)
                ) {
                    markSearchEntityAffinityLowIntentUpdateInteraction(context, space.id, entityId);
                }
            },
        }),
        [context, currentAccount.id, entityId, space.id],
    );
}
