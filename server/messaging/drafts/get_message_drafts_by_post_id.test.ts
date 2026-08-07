import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getMessageDraftsByPostId} from "~/server/messaging/drafts/get_message_drafts_by_post_id.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId, FileId} from "~/shared/id/types/id_types.open_source.js";
import {emptyMessageDraft} from "~/shared/messaging/message_draft_schema.js";

const context = createTestContext({spacesInjection});

describe("getMessageDraftsByPostId()", () => {
    test("returns empty map when no post ids are provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        expect(
            await getMessageDraftsByPostId(session.action(), {spaceId: space.id, postIds: []}),
        ).toEqual(new Map());
    });

    test("returns empty draft for posts without a saved draft", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const channel = await TestChannel.create(session);
        const post1 = await channel.createPost(session, "First post");
        const post2 = await channel.createPost(session, "Second post");

        expect(
            await getMessageDraftsByPostId(session.action(), {
                spaceId: space.id,
                postIds: [post1.id, post2.id],
            }),
        ).toEqual(
            new Map([
                [post1.id, emptyMessageDraft],
                [post2.id, emptyMessageDraft],
            ]),
        );
    });

    test("returns saved post comment drafts", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);
        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, "Post with draft");
        const content = createSimpleMessageContent("post comment draft");
        const fileIds = [
            generateChronologicalId<FileId>(),
            `Document:${generateId<DocumentId>()}` as FileEntityId,
        ];

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface: {type: "PostComment", postId: post.id},
            content,
            parent: null,
            fileIds,
            version: versionClock.now(),
        });

        const draftsByPostId = await getMessageDraftsByPostId(session.action(), {
            spaceId: space.id,
            postIds: [post.id],
        });

        expect({
            content: draftsByPostId.get(post.id)!.content.doc.toJSON(),
            parent: draftsByPostId.get(post.id)!.parent,
            fileIds: draftsByPostId.get(post.id)!.fileIds,
        }).toEqual({
            content: content.toJSON(),
            parent: null,
            fileIds,
        });
    });

    test("returns empty draft for posts without a draft and saved drafts for posts with one", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);
        const channel = await TestChannel.create(session);
        const postWithoutDraft = await channel.createPost(session, "Post without draft");
        const postWithDraft = await channel.createPost(session, "Post with draft");
        const content = createSimpleMessageContent("saved comment draft");

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface: {type: "PostComment", postId: postWithDraft.id},
            content,
            parent: {type: "Message", index: 2},
            version: versionClock.now(),
        });

        const draftsByPostId = await getMessageDraftsByPostId(session.action(), {
            spaceId: space.id,
            postIds: [postWithoutDraft.id, postWithDraft.id],
        });

        expect({
            withoutDraft: draftsByPostId.get(postWithoutDraft.id),
            withDraft: {
                content: draftsByPostId.get(postWithDraft.id)!.content.doc.toJSON(),
                parent: draftsByPostId.get(postWithDraft.id)!.parent,
            },
        }).toEqual({
            withoutDraft: emptyMessageDraft,
            withDraft: {
                content: content.toJSON(),
                parent: {type: "Message", index: 2},
            },
        });
    });

    test("ignores saved drafts for posts that weren\u2019t requested", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);
        const channel = await TestChannel.create(session);
        const post1 = await channel.createPost(session, "First post");
        const post2 = await channel.createPost(session, "Second post");
        const post3 = await channel.createPost(session, "Third post");

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface: {type: "PostComment", postId: post2.id},
            content: createSimpleMessageContent("draft on unrequested post"),
            parent: null,
            version: versionClock.now(),
        });

        expect(
            await getMessageDraftsByPostId(session.action(), {
                spaceId: space.id,
                postIds: [post1.id, post3.id],
            }),
        ).toEqual(
            new Map([
                [post1.id, emptyMessageDraft],
                [post3.id, emptyMessageDraft],
            ]),
        );
    });

    test("throws if actor does not have access to the space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();
        const channel = await TestChannel.create(session);
        const post = await channel.createPost(session, "Post");

        await expect(
            getMessageDraftsByPostId(session.action(), {
                spaceId: otherSpace.id,
                postIds: [post.id],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });
});
