import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Unarchives an individual post in a channel posts inbox entry.
 */
export async function unarchiveInboxChannelPostsEntryPost(
    context: ServerSessionActionContext,
    {
        spaceId,
        channelId,
        bucketGeneration,
        postId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        bucketGeneration: number;
        postId: PostId;
    },
): Promise<void> {
    await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        {
            partitionType: "Inbox",
            sortRangeType: "ChannelPostsEntry",
            spaceId,
            accountId: context.actor.getAccountId(),
            channelId,
            bucketGeneration,
        },
        item => {
            if (!item) throw new NotFoundError("Inbox entry not found");

            if (!item.postIds.has(postId))
                throw new FailedPreconditionError("Post not found in channel posts inbox entry");

            const archivedPostIds = new Set(item.archivedPostIds);
            archivedPostIds.delete(postId);

            return {
                ...item,
                isArchived: false,
                archivedPostIds,
            };
        },
    );
}
