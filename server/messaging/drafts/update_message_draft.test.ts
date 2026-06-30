import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getMessageDraft} from "~/server/messaging/drafts/get_message_draft.js";
import {MessageDraftsTable} from "~/server/messaging/drafts/internal/message_drafts_table.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {
    MessageDraftSurface,
    getMessageDraftSurfaceKey,
} from "~/shared/messaging/message_draft_surface.js";

const context = createTestContext({spacesInjection});

describe("updateMessageDraft()", () => {
    test("can update message draft", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const content = createSimpleMessageContent("hello from chat");
        const parent = {type: "Message" as const, index: 2};

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content,
            parent,
            version: versionClock.now(),
        });

        const draft = await getMessageDraft(session.action(), {spaceId: space.id, surface});

        expect({
            content: draft.content.doc.toJSON(),
            parent: draft.parent,
        }).toEqual({
            content: content.toJSON(),
            parent,
        });
    });

    test("last write wins when saving a message draft", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("from phone"),
            parent: null,
            version: versionClock.now(),
        });

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("from desktop"),
            parent: {type: "Message", index: 1},
            version: versionClock.now(),
        });

        const draft = await getMessageDraft(session.action(), {spaceId: space.id, surface});

        expect({
            content: draft.content.doc.toJSON(),
            parent: draft.parent,
        }).toEqual({
            content: createSimpleMessageContent("from desktop").toJSON(),
            parent: {type: "Message", index: 1},
        });
    });

    test("ignores stale message draft updates with older versions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const olderVersion = versionClock.now();
        const newerVersion = versionClock.now();
        const olderDraft = {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("older draft"),
            parent: null,
            version: olderVersion,
        };
        const newerDraft = {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("newer draft"),
            parent: null,
            version: newerVersion,
        };

        await updateMessageDraft(session.action(), newerDraft);
        await updateMessageDraft(session.action(), olderDraft);

        const draft = await getMessageDraft(session.action(), {spaceId: space.id, surface});

        expect({
            content: draft.content.doc.toJSON(),
            version: draft.version,
        }).toEqual({
            content: createSimpleMessageContent("newer draft").toJSON(),
            version: newerVersion,
        });
    });

    test("creates new draft item if one doesn\u2019t already exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const content = createSimpleMessageContent("first draft");

        expect(await getMessageDraft(session.action(), {spaceId: space.id, surface})).toMatchObject(
            {parent: null},
        );

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
        }).toEqual({
            content: content.toJSON(),
            parent: null,
        });
    });

    test("noop update when draft content and parent are unchanged", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);
        const version = versionClock.now();

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};
        const content = createSimpleMessageContent("saved draft");
        const parent = {type: "Message" as const, index: 2};

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content,
            parent,
            version,
        });

        const itemAfterFirstUpdate = await MessageDraftsTable.getItemIfExists(session.action(), {
            partitionType: "SpaceAccount",
            sortRangeType: "Draft",
            spaceId: space.id,
            accountId: session.account.id,
            surfaceKey: getMessageDraftSurfaceKey(surface),
        });

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content,
            parent,
            version,
        });

        expect(
            await MessageDraftsTable.getItemIfExists(session.action(), {
                partitionType: "SpaceAccount",
                sortRangeType: "Draft",
                spaceId: space.id,
                accountId: session.account.id,
                surfaceKey: getMessageDraftSurfaceKey(surface),
            }),
        ).toEqual(itemAfterFirstUpdate);
    });

    test("preserves createdTime when updating draft content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("first version"),
            parent: null,
            version: versionClock.now(),
        });

        const createdTime = (await MessageDraftsTable.getItemIfExists(session.action(), {
            partitionType: "SpaceAccount",
            sortRangeType: "Draft",
            spaceId: space.id,
            accountId: session.account.id,
            surfaceKey: getMessageDraftSurfaceKey(surface),
        }))!.createdTime;

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("second version"),
            parent: null,
            version: versionClock.now(),
        });

        expect(
            (await MessageDraftsTable.getItemIfExists(session.action(), {
                partitionType: "SpaceAccount",
                sortRangeType: "Draft",
                spaceId: space.id,
                accountId: session.account.id,
                surfaceKey: getMessageDraftSurfaceKey(surface),
            }))!.createdTime,
        ).toEqual(createdTime);
    });

    test("rejects draft updates from clocks more than 5 minutes ahead", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const futureVersionClock = new HybridLogicalClock({
            now: () => Date.now() + 1000 * 60 * 5 + 1000,
        });

        await expect(
            updateMessageDraft(session.action(), {
                spaceId: space.id,
                surface: {type: "Chat", chatId: generateId<ChatId>()},
                content: createSimpleMessageContent("hello from the future"),
                parent: null,
                version: futureVersionClock.now(),
            }),
        ).rejects.toThrow("Draft version timestamp is too far in the future");
    });

    test("throws if actor does not have access to the space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            updateMessageDraft(session.action(), {
                spaceId: otherSpace.id,
                surface: {type: "Chat", chatId: generateId<ChatId>()},
                content: createSimpleMessageContent("hello"),
                parent: null,
                version: new HybridLogicalClock(unsynchronizedSystemClock).now(),
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });
});
