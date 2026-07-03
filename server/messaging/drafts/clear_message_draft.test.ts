import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {clearMessageDraft} from "~/server/messaging/drafts/clear_message_draft.js";
import {getMessageDraft} from "~/server/messaging/drafts/get_message_draft.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {emptyMessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";

const context = createTestContext({spacesInjection});

describe("clearMessageDraft()", () => {
    test("clears existing message draft", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const versionClock = new HybridLogicalClock(unsynchronizedSystemClock);

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};

        await updateMessageDraft(session.action(), {
            spaceId: space.id,
            surface,
            content: createSimpleMessageContent("draft to clear"),
            parent: null,
            version: versionClock.now(),
        });

        await clearMessageDraft(session.action(), {spaceId: space.id, surface});

        expect(await getMessageDraft(session.action(), {spaceId: space.id, surface})).toEqual(
            emptyMessageDraftWithFiles,
        );
    });

    test("does nothing when no draft exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};

        await clearMessageDraft(session.action(), {spaceId: space.id, surface});

        expect(await getMessageDraft(session.action(), {spaceId: space.id, surface})).toEqual(
            emptyMessageDraftWithFiles,
        );
    });

    test("throws if actor does not have access to the space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            clearMessageDraft(session.action(), {
                spaceId: otherSpace.id,
                surface: {type: "Chat", chatId: generateId<ChatId>()},
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });
});
