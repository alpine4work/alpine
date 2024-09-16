import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getFile} from "~/server/files/data/files_table.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {
    ContentReferencedIds,
    getContentReferencedIdsForNode,
    getContentReferencedIdsForSteps,
} from "~/shared/content/content_referenced_ids.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
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
    const [accounts, files] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId => {
                // You may have copy/pasted some content from a different space. In that case a
                // mentioned user may not exist.
                return getAccountIfExists(context, spaceId, accountId);
            }),
        ),
        runAllPromises(
            mapIterable(referencedIds.fileIds, accountId => {
                // TODO(calebmer, #files): This will break if you copy some content from a
                // different space then paste. Ideally we'd allow copying a file from a
                // different space. How do we make this work? Should we reference the file in
                // its "home" space? Should we copy the file into the new space? I kinda like
                // referencing the file in the home space? The home space could delete the file
                // but that's the risk you run.
                return getFile(context, spaceId, accountId);
            }),
        ),
    ]);

    const accountById = new Map(
        filterMapIterable(accounts, account => {
            if (!account) return;
            return [account.id, account];
        }),
    );

    const fileById = new Map(
        filterMapIterable(files, file => {
            if (!file) return;
            return [file.id, file];
        }),
    );

    return {accountById, fileById};
}
