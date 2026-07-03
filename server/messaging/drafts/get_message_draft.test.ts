import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getMessageDraft} from "~/server/messaging/drafts/get_message_draft.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId, DocumentId, FileId} from "~/shared/id/types/id_types.js";
import {emptyMessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";

const context = createTestContext({spacesInjection});

describe("getMessageDraft()", () => {
    test("returns empty draft when no draft exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};

        expect(await getMessageDraft(session.action(), {spaceId: space.id, surface})).toEqual(
            emptyMessageDraftWithFiles,
        );
    });

    test("returns saved message draft", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const content = createSimpleMessageContent("saved draft");

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content,
            parent: null,
            version: versionClock.now(),
        });

        const draft = await getMessageDraft(session.action(), {spaceId: space.id, surface});

        expect({
            content: draft.content.doc.toJSON(),
            parent: draft.parent,
            fileIds: draft.fileIds,
            files: draft.files,
        }).toEqual({
            content: content.toJSON(),
            parent: null,
            fileIds: [],
            files: [],
        });
    });

    test("returns saved message draft parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const parent = {type: "Message" as const, index: 3};

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("reply draft"),
            parent,
            version: versionClock.now(),
        });

        const draft = await getMessageDraft(session.action(), {spaceId: space.id, surface});

        expect(draft.parent).toEqual(parent);
    });

    test("returns saved message draft file ids", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const fileIds = [
            generateChronologicalId<FileId>(),
            `Document:${generateId<DocumentId>()}` as FileEntityId,
        ];

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("draft with files"),
            parent: null,
            fileIds,
            version: versionClock.now(),
        });

        expect(
            (await getMessageDraft(session.action(), {spaceId: space.id, surface})).fileIds,
        ).toEqual(fileIds);
    });

    test("throws if actor does not have access to the space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            getMessageDraft(session.action(), {
                spaceId: otherSpace.id,
                surface: {type: "Chat", chatId: generateId<ChatId>()},
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });
});
