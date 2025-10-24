import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {InboxChannelPostsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxChannelPostsEntryModel({
    session,
    channel,
    bucketGeneration,
    isArchived = false,
    loudNotificationCount = 0,
    postCount = 1,
    postAuthorCount = 1,
    latestPost,
    otherPostAuthor = null,
}: {
    session: TestSpaceSession;
    channel: (TestChannel & {isPrivate?: false}) | {isPrivate: true; channelId: ChannelId};
    bucketGeneration: number;
    isArchived?: boolean;
    loudNotificationCount?: number;
    postCount?: number;
    postAuthorCount?: number;
    latestPost: {
        post: TestPost;
        contentTextSnippet: string;
    };
    otherPostAuthor?: TestSession | TestAccount | null;
}) {
    return new InboxChannelPostsEntryModel({
        isArchived,
        spaceId: latestPost.post.space.id,
        accountId: session.account.id,
        channel: channel.isPrivate
            ? {isPrivate: true, channelId: channel.channelId}
            : {isPrivate: false, channel: expect.objectContaining({id: channel.id})},
        bucketGeneration,
        loudNotificationCount,
        postCount,
        postAuthorCount,
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
