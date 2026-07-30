import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getMessageDraftsByCommentThreadId} from "~/server/messaging/drafts/get_message_drafts_by_comment_thread_id.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, FileId} from "~/shared/id/types/id_types.js";
import {emptyMessageDraft} from "~/shared/messaging/message_draft_schema.js";

const context = createTestContext({spacesInjection});

describe("getMessageDraftsByCommentThreadId()", () => {
    test("returns empty map when no comment thread ids are provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        expect(
            await getMessageDraftsByCommentThreadId(session.action(), {
                spaceId: space.id,
                documentId: generateId<DocumentId>(),
                commentThreadIds: [],
            }),
        ).toEqual(new Map());
    });

    test("returns empty draft for comment threads without a saved draft", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const documentId = generateId<DocumentId>();
        const commentThread1Id = generateId<DocumentCommentThreadId>();
        const commentThread2Id = generateId<DocumentCommentThreadId>();

        expect(
            await getMessageDraftsByCommentThreadId(session.action(), {
                spaceId: space.id,
                documentId,
                commentThreadIds: [commentThread1Id, commentThread2Id],
            }),
        ).toEqual(
            new Map([
                [commentThread1Id, emptyMessageDraft],
                [commentThread2Id, emptyMessageDraft],
            ]),
        );
    });

    test("returns saved document comment thread drafts", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);
        const documentId = generateId<DocumentId>();
        const commentThreadId = generateId<DocumentCommentThreadId>();
        const content = createSimpleMessageContent("document comment draft");
        const fileIds = [
            generateChronologicalId<FileId>(),
            `Document:${generateId<DocumentId>()}` as FileEntityId,
        ];

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface: {
                type: "DocumentCommentThread",
                documentId,
                commentThreadId,
            },
            content,
            parent: null,
            fileIds,
            version: versionClock.now(),
        });

        const draftsByCommentThreadId = await getMessageDraftsByCommentThreadId(session.action(), {
            spaceId: space.id,
            documentId,
            commentThreadIds: [commentThreadId],
        });

        expect({
            content: draftsByCommentThreadId.get(commentThreadId)!.content.doc.toJSON(),
            parent: draftsByCommentThreadId.get(commentThreadId)!.parent,
            fileIds: draftsByCommentThreadId.get(commentThreadId)!.fileIds,
        }).toEqual({
            content: content.toJSON(),
            parent: null,
            fileIds,
        });
    });

    test("throws if actor does not have access to the space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();
        const documentId = generateId<DocumentId>();
        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(
            getMessageDraftsByCommentThreadId(session.action(), {
                spaceId: otherSpace.id,
                documentId,
                commentThreadIds: [commentThreadId],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });
});
