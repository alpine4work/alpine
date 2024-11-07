import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {FileAuthorizer, getFileIfExistsFromAttachment} from "~/server/files/data/files_table.js";
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
    context: ServerContentActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    content: Node,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForNode(content);
    return getContentReferences(context, spaceId, fileAuthorizer, referencedIds);
}

export function getContentReferencesForSteps(
    context: ServerContentActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    steps: ReadonlyArray<Step>,
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForSteps(steps);
    return getContentReferences(context, spaceId, fileAuthorizer, referencedIds);
}

/**
 * Get entities referenced in content.
 *
 * Must provide a `FileAuthorizer` to authorize files. Accounts are granted
 * access to files that are attached to the content they're looking at.
 * `FileAuthorizer` carries information about the attachment target and how to
 * authorize access to the attachment target.
 */
export async function getContentReferences(
    context: ServerContentActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    referencedIds: ContentReferencedIds,
): Promise<ContentReferences> {
    // IMPORTANT: This function may be called multiple times on the same content in
    // an action. So all data loading functions are cached.
    //
    // For example, in `notifications_table.ts` `processNotificationEvent()`
    // function we may load content references once when we build an inbox entry
    // model and again in `printNotificationEventAlertContentBody()` when we print
    // for push notifications.
    const [accounts, files] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId => {
                // You may have copy/pasted some content from a different space. In that case a
                // mentioned user may not exist.
                return getAccountIfExists(context, spaceId, accountId);
            }),
        ),
        runAllPromises(
            mapIterable(referencedIds.fileIds, async fileId => {
                let file = await getFileIfExistsFromAttachment(
                    context,
                    spaceId,
                    fileId,
                    fileAuthorizer,
                    {
                        consistency: "Eventual",
                    },
                );

                // The client (in `uploadFileFromContentEditor()`) will not attach a file to
                // content until the preview is at least partially available. So if we see an
                // unavailable preview here that's probably because of eventual consistency
                // lag. Try reading again with strong consistency and returning that.
                //
                // We don't want to show a file with an unavailable preview to the user since
                // it'll have the incorrect size then after a bit will flash in with the
                // correct size changing the document's layout. We're ok with showing a
                // partially available preview since at least the layout will be stable even if
                // we don't have e.g. the image preview's placeholder.
                if (!file || file.getAttachReadiness() !== "PreviewUnavailable") {
                    file = await getFileIfExistsFromAttachment(
                        context,
                        spaceId,
                        fileId,
                        fileAuthorizer,
                        {
                            consistency: "Strong",
                        },
                    );
                }

                if (!file) return null;

                const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                    spaceId,
                    fileId,
                );

                return {signedUrlSearch: signedUrl.search, file};
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
            return [file.file.id, file];
        }),
    );

    return {accountById, fileById};
}
