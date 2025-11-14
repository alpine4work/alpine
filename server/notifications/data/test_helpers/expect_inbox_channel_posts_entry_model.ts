import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {InboxChannelPostsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxChannelPostsEntryModel({
    session,
    channel,
    bucketGeneration,
    isArchived = false,
    loudNotificationCount = 0,
    latestPost,
    posts = [[latestPost.post, {isArchived}]],
    otherPostAuthor = null,
}: {
    session: TestSpaceSession;
    channel: (TestChannel & {isPrivate?: false}) | {isPrivate: true; channelId: ChannelId};
    bucketGeneration: number;
    isArchived?: boolean;
    loudNotificationCount?: number;
    posts?: ReadonlyArray<TestPost | [TestPost, {isArchived: boolean}]>;
    latestPost: {
        post: TestPost;
        contentTextSnippet: string;
    };
    otherPostAuthor?: TestSession | TestAccount | null;
}) {
    const actualPosts = posts.map(post =>
        isReadonlyArray(post) ? post : ([post, {isArchived}] as const),
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
        postAuthorCount: new Set(actualPosts.map(post => post[0].author.id)).size,
        posts: new Map(actualPosts.map(post => [post[0].id, {isArchived: post[1].isArchived}])),
        latestPost: {
            author: expect.objectContaining({id: latestPost.post.author.id}),
            createdTime: latestPost.post.createdTime,
            contentTextSnippet: latestPost.contentTextSnippet,
        },
        otherPostAuthor:
            otherPostAuthor instanceof TestSession
                ? expect.objectContaining({id: otherPostAuthor.account.id})
                : otherPostAuthor instanceof TestAccount
                ? expect.objectContaining({id: otherPostAuthor.id})
                : otherPostAuthor,
    });
}
