import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getPost} from "~/server/forum/data/get_post.js";
import {getPostAndInitialComments} from "~/server/forum/data/post_messaging.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {observeInboxItem} from "~/server/notifications/data/internal/observe_inbox_item.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

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
        limit,
        commentLimit,
        afterPostId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        bucketGeneration: number;
        limit: number;
        commentLimit: number;
        afterPostId: PostId | null;
    },
): Promise<{
    totalPostCount: number;
    hasMorePosts: boolean;
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

    if (afterPostId === null) {
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

        const inboxEntryItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId,
                accountId,
                channelId,
                bucketGeneration,
            },
            {
                // Use a strong read consistency when reading the entry since we don't want to
                // miss any posts.
                //
                // At this point the channel posts entry is frozen. So we don't subscribe to
                // realtime changes for `postIds`. If we get a stale read that's missing a
                // `PostId` the client will never see it.
                consistency: "Strong",
            },
        );

        // If there's only one post then we're going to render the new post post with
        // expanded comments instead of requiring the user to expand the comments on
        // the only post which is lame.
        if (inboxEntryItem.postIds.size === 1 && commentLimit > 0) {
            const postId = Array.from(inboxEntryItem.postIds)[0]!;

            const {post, initialComments, initialOtherReferencedComments} =
                await getPostAndInitialComments(await context.actor.authenticate(), {
                    postId,
                    commentLimit,
                });

            return {
                totalPostCount: 1,
                hasMorePosts: false,
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
            mapIterable(
                sliceIterable(inboxEntryItem.postIds, 0, limit),
                async postId => await getPost(context, postId),
            ),
        );

        return {
            totalPostCount: inboxEntryItem.postIds.size,
            hasMorePosts: inboxEntryItem.postIds.size > limit,
            posts,
            initialCommentsByPostId: new Map(),
        };
    } else {
        // If we have an `afterPostId` we don't need to observe the inbox because new
        // posts are only added to the beginning of `postIds`. So loading posts after a
        // certain point is guaranteed to be frozen and not update in realtime.
        //
        // If we have an `afterPostId` that also probably means the client has already
        // called this function with `afterPostId` set to null. Which means the current
        // inbox generation should have advanced past our bucket generation.
        const inboxEntryItem = await InboxTable.getItem(context, {
            partitionType: "Inbox",
            sortRangeType: "ChannelPostsEntry",
            spaceId,
            accountId,
            channelId,
            bucketGeneration,
        });

        const postIds = Array.from(inboxEntryItem.postIds);

        const afterPostIndex = postIds.indexOf(afterPostId);
        if (afterPostIndex === -1)
            throw new NotFoundError("`PostId` not found in channel posts inbox entry");

        const posts = await runAllPromises(
            postIds
                .slice(afterPostIndex + 1, afterPostIndex + 1 + limit)
                .map(async postId => await getPost(context, postId)),
        );

        return {
            totalPostCount: inboxEntryItem.postIds.size,
            hasMorePosts: inboxEntryItem.postIds.size > limit + afterPostIndex + 1,
            posts,
            initialCommentsByPostId: new Map(),
        };
    }
}
