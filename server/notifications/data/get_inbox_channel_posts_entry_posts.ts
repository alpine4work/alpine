import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getPost} from "~/server/forum/data/get_post.js";
import {getPostAndInitialComments} from "~/server/forum/data/post_messaging.js";
import {
    InboxChannelPostsEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {observeInboxItem} from "~/server/notifications/data/internal/observe_inbox_item.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxChannelPostsEntryModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get the posts in a channel posts inbox entry. After you call this function,
 * you're guaranteed that the posts in the corresponding inbox entry will not
 * change anymore. This means you don't need to subscribe to realtime updates
 * of the post list for the entry.
 *
 * This has a side effect of observing the inbox if the inbox has not been
 * observed since the entry was created. By observing the inbox we freeze the
 * underlying channel posts inbox entry so it will accumulate no new posts.
 */
export async function getInboxChannelPostsEntryPosts(
    context: ServerSessionActionContext,
    {
        spaceId,
        channelId,
        bucketGeneration,
        commentLimit,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        bucketGeneration: number;
        commentLimit: number;
    },
): Promise<{
    inboxEntry: DynamoGeneralRealtimeItem<InboxChannelPostsEntryModel>;
    posts: Array<DynamoGeneralRealtimeItem<PostModel>>;
    initialCommentsByPostId: Map<
        PostId,
        {
            comments: ReadonlyArray<PostCommentModel>;
            otherReferencedComments: ReadonlyArray<PostCommentModel>;
        }
    >;
}> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    // If an inbox entry exists then the inbox attributes item should also exist.
    const inboxItem = await InboxTable.getItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId,
        },
        {
            // Use a strong read consistency to make sure we get the up-to-date generation.
            consistency: "Strong",
        },
    );

    // If the bucket generation is equal to the current inbox generation then we
    // want to increment the inbox's generation. This means new channel posts will
    // create a new entry with a new bucket generation.
    if (bucketGeneration === inboxItem.generation) {
        await InboxTable.updateItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId,
            },
            item => {
                // If the generation was updated concurrently, we don't need to update
                // it again.
                if (item.generation !== bucketGeneration) return item;

                return observeInboxItem(item);
            },
            {initialItem: inboxItem},
        );
    }

    const inboxEntryItemKey: InboxChannelPostsEntryItemKey = {
        partitionType: "Inbox",
        sortRangeType: "ChannelPostsEntry",
        spaceId,
        accountId,
        channelId,
        bucketGeneration,
    };

    const inboxEntry = await InboxTable.getRealtimeItemIfExists(context, inboxEntryItemKey, {
        // Use a strong read consistency when reading the entry since we don't want to
        // miss any posts.
        consistency: "Strong",
    });

    // It's possible you open a channel posts inbox entry that has been deleted
    // since all of its posts have been archived (maybe the user bookmarked the
    // inbox entry's URL?). In this case, we want to show a display message to the
    // user telling them this is the case.
    if (!inboxEntry) {
        const deletedInboxEntry = await InboxTable.getDeletedItemIfExists(
            context,
            inboxEntryItemKey,
            {consistency: "Strong"},
        );

        throw new NotFoundError("Channel posts entry not found", {
            displayMessage: deletedInboxEntry
                ? errorDisplayMessage`All posts in this notification have been marked as done.`
                : errorDisplayMessage`This notification doesn’t exist.`,
        });
    }

    // If there's only one post then we're going to render the new post post with
    // expanded comments instead of requiring the user to expand the comments on
    // the only post which is lame.
    if (inboxEntry.model.postIds.size === 1 && commentLimit > 0) {
        const postId = assertExists(iterableFirst(inboxEntry.model.postIds));

        const {post, initialComments, initialOtherReferencedComments} =
            await getPostAndInitialComments(await context.actor.authenticate(), {
                postId,
                commentLimit,
            });

        return {
            inboxEntry,
            posts: [post],
            initialCommentsByPostId: new Map([
                [
                    post.model.id,
                    {
                        comments: initialComments,
                        otherReferencedComments: initialOtherReferencedComments,
                    },
                ],
            ]),
        };
    }

    const posts = await runAllPromises(
        mapIterable(inboxEntry.model.postIds, postId => getPost(context, postId)),
    );

    return {
        inboxEntry,
        posts,
        initialCommentsByPostId: new Map(),
    };
}
