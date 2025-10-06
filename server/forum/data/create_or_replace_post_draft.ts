import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizePostDraftAccess} from "~/server/forum/data/authorize_post_draft_access.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {AccountId, ChannelId, PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create or replace the contents of a post draft.
 */
export async function createOrReplacePostDraft(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
    {channelId, content}: {channelId: ChannelId | null; content: PostContent},
): Promise<void> {
    await authorizePostDraftAccess(context, spaceId, accountId, draftId);

    await ForumTable.createOrReplaceItem(context, {
        partitionType: "Account",
        sortRangeType: "PostDraft",
        spaceId,
        accountId,
        draftId,
        channelId,
        content,
    });
}
