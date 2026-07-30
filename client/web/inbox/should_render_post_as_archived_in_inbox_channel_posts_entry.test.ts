import {shouldRenderPostAsArchivedInInboxChannelPostsEntry} from "~/client/web/inbox/should_render_post_as_archived_in_inbox_channel_posts_entry.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    InboxChannelPostsEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const spaceId = generateId<SpaceId>();

const channel = new ChannelPreviewModel({
    id: generateId(),
    spaceId,
    version: 0,
    createdTime: new Date(),
    name: "Test Channel",
    accessPolicy: new AccessPolicyModel({
        type: "Local",
        accountGrantById: emptyMap,
        defaultGrant: {level: "Manage", generation: 0},
        urlGrant: null,
    }),
});

test("returns true when inbox entry is archived (ChannelPosts)", () => {
    const postId = generateId<PostId>();

    const inboxEntry = new InboxChannelPostsEntryModel({
        spaceId,
        accountId: generateId(),
        loudNotificationCount: 0,
        isArchived: true,
        channel: {isPrivate: false, channel},
        bucketGeneration: 1,
        postAuthorCount: 1,
        postIds: new Set([postId]),
        latestPost: {
            author: createTestAccountModel(),
            createdTime: new Date(),
            contentTextSnippet: "Test post",
            id: postId,
        },
        otherPostAuthor: null,
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, postId)).toEqual(true);
});

test("returns true when inbox entry is archived (PostComments)", () => {
    const postId = generateId<PostId>();

    const inboxEntry = new InboxPostCommentsEntryModel({
        spaceId,
        accountId: generateId(),
        postId,
        postAuthor: createTestAccountModel(),
        channel: {isPrivate: false, channel},
        loudNotificationCount: 0,
        isArchived: true,
        postCreatedTime: new Date(),
        postContentTextSnippet: "Test post",
        isForPostContentMention: false,
        latestComment: null,
        otherCommentAuthor: null,
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, postId)).toEqual(true);
});

test("returns false when PostComments entry is not archived and postId matches", () => {
    const postId = generateId<PostId>();

    const inboxEntry = new InboxPostCommentsEntryModel({
        spaceId,
        accountId: generateId(),
        postId,
        postAuthor: createTestAccountModel(),
        channel: {isPrivate: false, channel},
        loudNotificationCount: 1,
        isArchived: false,
        postCreatedTime: new Date(),
        postContentTextSnippet: "Test post",
        isForPostContentMention: false,
        latestComment: {
            author: createTestAccountModel(),
            createdTime: new Date(),
            contentTextSnippet: "Test comment",
            isStickyMention: false,
            index: 0,
        },
        otherCommentAuthor: null,
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, postId)).toEqual(false);
});

test("returns true when PostComments entry is not archived and postId does not match", () => {
    const postId = generateId<PostId>();
    const differentPostId = generateId<PostId>();

    const inboxEntry = new InboxPostCommentsEntryModel({
        spaceId,
        accountId: generateId(),
        postId,
        postAuthor: createTestAccountModel(),
        channel: {isPrivate: false, channel},
        loudNotificationCount: 1,
        isArchived: false,
        postCreatedTime: new Date(),
        postContentTextSnippet: "Test post",
        isForPostContentMention: false,
        latestComment: {
            author: createTestAccountModel(),
            createdTime: new Date(),
            contentTextSnippet: "Test comment",
            isStickyMention: false,
            index: 0,
        },
        otherCommentAuthor: null,
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, differentPostId)).toEqual(
        true,
    );
});

test("returns false when ChannelPosts entry is not archived and postId is in postIds", () => {
    const postId1 = generateId<PostId>();
    const postId2 = generateId<PostId>();
    const postId3 = generateId<PostId>();

    const inboxEntry = new InboxChannelPostsEntryModel({
        spaceId,
        accountId: generateId(),
        loudNotificationCount: 0,
        isArchived: false,
        channel: {isPrivate: false, channel},
        bucketGeneration: 1,
        postAuthorCount: 2,
        postIds: new Set([postId1, postId2, postId3]),
        latestPost: {
            author: createTestAccountModel(),
            createdTime: new Date(),
            contentTextSnippet: "Test post",
            id: postId3,
        },
        otherPostAuthor: createTestAccountModel(),
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, postId2)).toEqual(false);
});

test("returns true when ChannelPosts entry is not archived and postId is not in postIds", () => {
    const postId1 = generateId<PostId>();
    const postId2 = generateId<PostId>();
    const postId3 = generateId<PostId>();
    const missingPostId = generateId<PostId>();

    const inboxEntry = new InboxChannelPostsEntryModel({
        spaceId,
        accountId: generateId(),
        loudNotificationCount: 0,
        isArchived: false,
        channel: {isPrivate: false, channel},
        bucketGeneration: 1,
        postAuthorCount: 2,
        postIds: new Set([postId1, postId2, postId3]),
        latestPost: {
            id: postId3,
            author: createTestAccountModel(),
            createdTime: new Date(),
            contentTextSnippet: "Test post",
        },
        otherPostAuthor: createTestAccountModel(),
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, missingPostId)).toEqual(
        true,
    );
});

test("returns true when ChannelPosts entry with single postId is not archived and queried postId is not in postIds", () => {
    const postId = generateId<PostId>();

    const missingPostId = generateId<PostId>();

    const inboxEntry = new InboxChannelPostsEntryModel({
        spaceId,
        accountId: generateId(),
        loudNotificationCount: 0,
        isArchived: false,
        channel: {isPrivate: false, channel},
        bucketGeneration: 1,
        postAuthorCount: 1,
        postIds: new Set([postId]),
        latestPost: {
            id: postId,
            author: createTestAccountModel(),
            createdTime: new Date(),
            contentTextSnippet: "Test post",
        },
        otherPostAuthor: null,
    });

    expect(shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry, missingPostId)).toEqual(
        true,
    );
});
