import {getMessageContentReferencesForNode} from "~/server/content/get_content_references.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {MessageDraftsTable} from "~/server/messaging/drafts/internal/message_drafts_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {parallelFilterMapLimitAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_filter_map_limit_async_iterable_to_array.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, emptyMessageDraft} from "~/shared/messaging/message_draft_schema.js";
import {getMessageDraftSurfaceKey} from "~/shared/messaging/message_draft_surface.js";

/**
 * Get message drafts for a list of document comment thread ids.
 *
 * If no draft exists for a given comment thread, it returns an empty draft.
 */
export async function getMessageDraftsByCommentThreadId(
    context: ServerSessionActionContext,
    {
        spaceId,
        documentId,
        commentThreadIds,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        commentThreadIds: ReadonlyArray<DocumentCommentThreadId>;
    },
): Promise<ReadonlyMap<DocumentCommentThreadId, MessageDraft>> {
    if (commentThreadIds.length === 0) return new Map();

    await authorizeSpaceAccess(context, spaceId);

    const commentThreadIdSet = new Set(commentThreadIds);
    const sortedCommentThreadIds = commentThreadIds.toSorted();
    const surfaceKeyPrefix = `DocumentCommentThread:${documentId}:`;
    const startSurfaceKey = getMessageDraftSurfaceKey({
        type: "DocumentCommentThread",
        documentId,
        commentThreadId: assertExists(sortedCommentThreadIds.at(0)),
    });
    const endSurfaceKey = getMessageDraftSurfaceKey({
        type: "DocumentCommentThread",
        documentId,
        commentThreadId: assertExists(sortedCommentThreadIds.at(-1)),
    });

    const draftByCommentThreadId = new Map(
        await parallelFilterMapLimitAsyncIterableToArray(
            MessageDraftsTable.query(context, {
                partitionKey: {
                    partitionType: "SpaceAccount",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                startSortKey: {
                    sortRangeType: "Draft",
                    surfaceKey: startSurfaceKey,
                },
                endSortKey: {
                    sortRangeType: "Draft",
                    surfaceKey: endSurfaceKey,
                },
                limit: "All",
            }),
            commentThreadIds.length,
            async item => {
                assert(item.surfaceKey.startsWith(surfaceKeyPrefix));
                const commentThreadId = assertId<DocumentCommentThreadId>(
                    item.surfaceKey.slice(surfaceKeyPrefix.length),
                );
                if (!commentThreadIdSet.has(commentThreadId)) return null;

                const references = await getMessageContentReferencesForNode(
                    context,
                    spaceId,
                    item.content,
                );

                return [
                    commentThreadId,
                    {
                        content: {
                            doc: item.content,
                            references,
                        },
                        parent: item.parent,
                        fileIds: item.fileIds,
                        version: item.version,
                    },
                ] as const;
            },
        ),
    );

    return new Map(
        commentThreadIds.map(
            commentThreadId =>
                [
                    commentThreadId,
                    draftByCommentThreadId.get(commentThreadId) ?? emptyMessageDraft,
                ] as const,
        ),
    );
}
