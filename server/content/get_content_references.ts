import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {
    ContentReferencedIds,
    getContentReferencedIdsForNode,
    getContentReferencedIdsForSteps,
} from "~/shared/content/content_referenced_ids.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export function getContentReferencesForNode(
    context: ServerActionContext,
    spaceId: SpaceId,
    content: Node,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForNode(content);
    return getContentReferences(context, spaceId, referencedIds);
}

export function getContentReferencesForSteps(
    context: ServerActionContext,
    spaceId: SpaceId,
    steps: ReadonlyArray<Step>,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForSteps(steps);
    return getContentReferences(context, spaceId, referencedIds);
}

/**
 * Get entities referenced in content.
 *
 * This function may be called multiple times on the same content in an action.
 * So all data loading functions are cached.
 */
export async function getContentReferences(
    context: ServerActionContext,
    spaceId: SpaceId,
    referencedIds: ContentReferencedIds,
): Promise<ContentReferences> {
    const accounts = await runAllPromises(
        Array.from(referencedIds.accountIds, accountId => {
            // You may have copy/pasted some content from a different space. In that case a
            // mentioned user may not exist.
            return getAccountIfExists(context, spaceId, accountId);
        }),
    );

    const accountById = new Map(
        filterMapIterable(accounts, account => {
            if (!account) return null;
            return [account.id, account];
        }),
    );

    return {accountById};
}
