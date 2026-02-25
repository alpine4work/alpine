import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {sendChatMessage} from "~/server/chat/data/chat_messaging.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {getChatNotificationSubscribers} from "~/server/chat/data/get_chat_notification_subscribers.js";
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
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

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

test("room chat subscribers include implicit and explicit subscriptions", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB, sessionC] = await space.createSessions(3);

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            accountGrantById: new Map([[sessionA.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
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

    const initialSubscribers = await getChatNotificationSubscribers(space.systemAction(), chatId);

    expect(initialSubscribers.accountIds.includes(sessionA.account.id)).toBe(true);
    expect(initialSubscribers.accountIds.includes(sessionB.account.id)).toBe(true);

    await unsubscribeFromRoomChat(sessionB.action(), chatId);

    const unsubscribed = await getChatNotificationSubscribers(space.systemAction(), chatId);

    expect(unsubscribed.accountIds.includes(sessionB.account.id)).toBe(false);

    await subscribeToRoomChat(sessionC.action(), chatId);

    const resubscribed = await getChatNotificationSubscribers(space.systemAction(), chatId);

    expect(resubscribed.accountIds.includes(sessionC.account.id)).toBe(true);
});
