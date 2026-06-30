import {test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getMessageDraftBehaviorTests} from "~/app/integration_tests/helpers/get_message_draft_behavior_tests.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();
const supportsFileDrop = true;

const prepares = {
    prepare: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const otherSession = await space.createSession({name: "Bob"});
        const chat = await TestChat.get(session, otherSession);

        return {
            session,
            surface: {type: "Chat" as const, chatId: chat.id},
            path: `/chat/${chat.id}`,
            messageNoun: "message" as const,
            draftLabel: "chat draft",
        };
    },
    prepareWithMention: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const mentionSession = await space.createSession({name: "Bob"});
        const chat = await TestChat.get(session, mentionSession);

        return {
            session,
            surface: {type: "Chat" as const, chatId: chat.id},
            path: `/chat/${chat.id}`,
            messageNoun: "message" as const,
            draftLabel: "chat mention draft",
            mentionAccountName: mentionSession.account.initialName,
            mentionAccountId: mentionSession.account.id,
        };
    },
    prepareWithReplyParent: async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice"});
        const otherSession = await space.createSession({name: "Bob"});
        const chat = await TestChat.get(session, otherSession);

        await TestMessagingRoomBase.createMessage(chat, session, "abcdefghi");
        await TestMessagingRoomBase.createMessage(chat, session, "jklmnopqr");

        return {
            session,
            surface: {type: "Chat" as const, chatId: chat.id},
            path: `/chat/${chat.id}`,
            messageNoun: "message" as const,
            draftLabel: "chat parent draft",
            replyMessageText: "jklmnopqr",
            replyParentStartIndex: 1,
            replyParentEndIndex: 1,
        };
    },
};

for (const behaviorTest of getMessageDraftBehaviorTests()) {
    test(behaviorTest.title, async ({page, context: browserContext, isMobile}) => {
        if (behaviorTest.skipOnMobile && isMobile) return;
        if (behaviorTest.requiresFileDrop && !supportsFileDrop) return;

        await behaviorTest.run({page, context: browserContext, isMobile}, prepares, services);
    });
}
