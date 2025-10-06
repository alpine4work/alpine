import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizePostDraftAccess} from "~/server/forum/data/authorize_post_draft_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelPreviewIfPossible} from "~/server/forum/data/get_channel_preview.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the post draft with the provided `PostDraftId` if it exists.
 */
export async function getPostDraftIfExists(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
): Promise<{
    channel: ChannelPreviewModel | null;
    content: PostContentWithReferences;
} | null> {
    await authorizePostDraftAccess(context, spaceId, accountId, draftId);

    const draftItem = await ForumTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "PostDraft",
        spaceId,
        accountId,
        draftId,
    });

    if (!draftItem) return null;

    const [channel, contentReferences] = await runAllPromises([
        draftItem.channelId
            ? await getChannelPreviewIfPossible(context, draftItem.channelId).then(channelResult =>
                  // Ignore permission denied errors on the channel.
                  channelResult?.ok ? channelResult.value : null,
              )
            : null,
        getContentReferencesForNode(
            context,
            spaceId,
            FilePostAuthorizer.bind({type: "PostDraft", accountId, draftId}),
            draftItem.content,
        ),
    ]);

    return {
        channel,
        content: {doc: draftItem.content, references: contentReferences},
    };
}
