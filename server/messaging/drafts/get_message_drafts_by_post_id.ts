import {getMessageContentReferencesForNode} from "~/server/content/get_content_references.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {MessageDraftsTable} from "~/server/messaging/drafts/internal/message_drafts_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {parallelFilterMapLimitAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_filter_map_limit_async_iterable_to_array.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, emptyMessageDraft} from "~/shared/messaging/message_draft_schema.js";

/**
 * Get message drafts for a list of PostIds.
 *
 * If no draft exists for a given post, it returns an empty draft.
 */
export async function getMessageDraftsByPostId(
    context: ServerSessionActionContext,
    {spaceId, postIds}: {spaceId: SpaceId; postIds: ReadonlyArray<PostId>},
): Promise<ReadonlyMap<PostId, MessageDraft>> {
    if (postIds.length === 0) return new Map();

    await authorizeSpaceAccess(context, spaceId);

    const postIdSet = new Set(postIds);
    const sortedPostIds = postIds.toSorted();

    const draftByPostId = new Map(
        await parallelFilterMapLimitAsyncIterableToArray(
            MessageDraftsTable.query(context, {
                partitionKey: {
                    partitionType: "SpaceAccount",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                startSortKey: {
                    sortRangeType: "Draft",
                    surfaceKey: `PostComment:${assertExists(sortedPostIds.at(0))}`,
                },
                endSortKey: {
                    sortRangeType: "Draft",
                    surfaceKey: `PostComment:${assertExists(sortedPostIds.at(-1))}`,
                },
                limit: "All",
            }),
            postIds.length,
            async item => {
                assert(item.surfaceKey.startsWith("PostComment:"));
                const postId = assertId<PostId>(item.surfaceKey.slice("PostComment:".length));
                if (!postIdSet.has(postId)) return null;

                const references = await getMessageContentReferencesForNode(
                    context,
                    spaceId,
                    item.content,
                );

                return [
                    postId,
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
        postIds.map(postId => [postId, draftByPostId.get(postId) ?? emptyMessageDraft] as const),
    );
}
