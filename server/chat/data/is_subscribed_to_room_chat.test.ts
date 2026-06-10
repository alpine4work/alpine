import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {sendChatMessage} from "~/server/chat/data/chat_messaging.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {isSubscribedToRoomChat} from "~/server/chat/data/is_subscribed_to_room_chat.js";
import {
    subscribeToRoomChat,
    unsubscribeFromRoomChat,
} from "~/server/chat/data/subscribe_to_room_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
});

function createMessageContent(text: string): MessageContent {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text(text),
            ]),
        ]),
    );
}

function createMessageContentWithMention(accountId: AccountId): MessageContent {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.nodes.mention.create({
                    mention: {
                        type: "Account",
                        accountId,
                        isShort: false,
                    } satisfies ContentMention,
                }),
            ]),
        ]),
    );
}

test("isSubscribedToRoomChat checks authorization", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Leadership",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[sessionA.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await expect(isSubscribedToRoomChat(sessionB.action(), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("isSubscribedToRoomChat returns the actor subscription state", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const sessionB = await space.createSession();

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Edit", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await unsubscribeFromRoomChat(sessionA.action(), chatId);
    await subscribeToRoomChat(sessionB.action(), chatId);

    await expect(isSubscribedToRoomChat(sessionA.action(), chatId)).resolves.toBe(false);
    await expect(isSubscribedToRoomChat(sessionB.action(), chatId)).resolves.toBe(true);
});

test("isSubscribedToRoomChat returns true for implicit subscriptions", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const sessionB = await space.createSession();

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Implicit",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Edit", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await sendChatMessage(sessionB.action(), {
        chatId,
        parent: null,
        content: createMessageContent("Hello"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await expect(isSubscribedToRoomChat(sessionB.action(), chatId)).resolves.toBe(true);
});

test("isSubscribedToRoomChat returns true when mentioned", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const sessionB = await space.createSession();

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Mentions",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Edit", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await sendChatMessage(sessionA.action(), {
        chatId,
        parent: null,
        content: createMessageContentWithMention(sessionB.account.id),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await expect(isSubscribedToRoomChat(sessionB.action(), chatId)).resolves.toBe(true);
});

test("isSubscribedToRoomChat prefers explicit unsubscribes over implicit subscriptions", async () => {
    const space = await TestSpace.create(context);
    const sessionA = await space.createSession({role: "Admin"});
    const sessionB = await space.createSession();

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Announcements",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([
                [sessionA.account.id, {level: "Manage", generation: 0}],
                [sessionB.account.id, {level: "Edit", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await sendChatMessage(sessionB.action(), {
        chatId,
        parent: null,
        content: createMessageContent("Hello"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await expect(isSubscribedToRoomChat(sessionB.action(), chatId)).resolves.toBe(true);

    await unsubscribeFromRoomChat(sessionB.action(), chatId);

    await expect(isSubscribedToRoomChat(sessionB.action(), chatId)).resolves.toBe(false);
});
