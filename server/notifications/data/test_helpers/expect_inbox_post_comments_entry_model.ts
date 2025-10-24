import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestMessage} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {InboxPostCommentsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxPostCommentsEntryModel({
    session,
    channel,
    post,
    isArchived = false,
    loudNotificationCount = 0,
    postContentTextSnippetIfMentioned = null,
    latestComment = null,
    otherCommentAuthor = null,
}: {
    session: TestSpaceSession;
    channel: (TestChannel & {isPrivate?: false}) | {isPrivate: true};
    post: TestPost;
    isArchived?: boolean;
    loudNotificationCount?: number;
    postContentTextSnippetIfMentioned?: string | null;
    latestComment?: {
        comment: TestMessage;
        contentTextSnippet: string;
        isStickyMention?: boolean;
    } | null;
    otherCommentAuthor?: TestSession | TestAccount | null;
}) {
    return new InboxPostCommentsEntryModel({
        isArchived,
        spaceId: post.space.id,
        accountId: session.account.id,
        channel: channel.isPrivate
            ? {isPrivate: true}
            : {isPrivate: false, channel: expect.objectContaining({id: channel.id})},
        postId: post.id,
        postAuthor: expect.objectContaining({id: post.author.id}),
        loudNotificationCount,
        postCreatedTime: post.createdTime,
        postContentTextSnippetIfMentioned,
        latestComment: latestComment
            ? {
                  createdTime: latestComment.comment.createdTime,
                  author: expect.objectContaining({id: latestComment.comment.author.id}),
                  contentTextSnippet: latestComment.contentTextSnippet,
                  isStickyMention: latestComment.isStickyMention ?? false,
              }
            : null,
        otherCommentAuthor:
            otherCommentAuthor instanceof TestSession
                ? expect.objectContaining({id: otherCommentAuthor.account.id})
                : otherCommentAuthor instanceof TestAccount
                ? expect.objectContaining({id: otherCommentAuthor.id})
                : otherCommentAuthor,
    });
}
