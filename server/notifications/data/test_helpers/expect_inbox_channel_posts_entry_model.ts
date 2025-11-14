import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {InboxChannelPostsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxChannelPostsEntryModel({
    session,
    channel,
    bucketGeneration,
    isArchived = false,
    loudNotificationCount = 0,
    latestPost,
    posts = [latestPost.post],
}: {
    session: TestSpaceSession;
    channel: (TestChannel & {isPrivate?: false}) | {isPrivate: true; channelId: ChannelId};
    bucketGeneration: number;
    isArchived?: boolean;
    loudNotificationCount?: number;
    posts?: ReadonlyArray<TestPost>;
    latestPost: {
        post: TestPost;
        contentTextSnippet: string;
    };
}) {
    const otherPostAuthor = findMapIterable(posts, post =>
        post.author.id !== latestPost.post.author.id ? post.author : undefined,
    );

    return new InboxChannelPostsEntryModel({
        isArchived,
        spaceId: latestPost.post.space.id,
        accountId: session.account.id,
        channel: channel.isPrivate
            ? {isPrivate: true, channelId: channel.channelId}
            : {isPrivate: false, channel: expect.objectContaining({id: channel.id})},
        bucketGeneration,
        loudNotificationCount,
        postAuthorCount: new Set(posts.map(post => post.author.id)).size,
        postIds: new Set(posts.map(post => post.id)),
        latestPost: {
            author: expect.objectContaining({id: latestPost.post.author.id}),
            createdTime: latestPost.post.createdTime,
            contentTextSnippet: latestPost.contentTextSnippet,
        },
        otherPostAuthor: otherPostAuthor ? expect.objectContaining({id: otherPostAuthor.id}) : null,
    });
}
