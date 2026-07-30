import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestMessage} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {MessageContentPayloadClerical} from "~/shared/messaging/message_schema.js";
import {InboxChatEntryModel} from "~/shared/notifications/inbox_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function expectInboxChatEntryModel({
    session,
    chat,
    definition = {type: "Direct"},
    isArchived = false,
    loudNotificationCount = 0,
    latestMessage,
    otherChatAccount = null,
}: {
    session: TestSpaceSession;
    chat: TestChat;
    definition?: {type: "Direct"} | {type: "Room"; isPrivate?: boolean};
    isArchived?: boolean;
    loudNotificationCount?: number;
    latestMessage: (
        | {message: TestMessage; author?: undefined; createdTime?: undefined}
        | {author: AccountModel; createdTime: Date; message?: undefined}
    ) & {
        contentTextSnippet: string;
        index?: number;
        isStickyMention?: boolean;
        clerical?: MessageContentPayloadClerical;
    };
    otherChatAccount?: TestSession | TestAccount | null;
}) {
    return new InboxChatEntryModel({
        isArchived,
        spaceId: chat.space.id,
        accountId: session.account.id,
        chatId: chat.id,
        definition:
            definition.type === "Direct"
                ? {
                      type: "Direct",
                      accountCount: expect.any(Number),
                  }
                : definition.isPrivate
                  ? {
                        type: cast<"Room">(definition.type),
                        isPrivate: true,
                    }
                  : {
                        type: cast<"Room">(definition.type),
                        isPrivate: false,
                        name: expect.any(String),
                    },
        loudNotificationCount,
        latestMessage: {
            createdTime: latestMessage.createdTime ?? latestMessage.message.createdTime,
            author:
                latestMessage.author ??
                expect.objectContaining({id: latestMessage.message.author.id}),
            contentTextSnippet: latestMessage.contentTextSnippet,
            isStickyMention: latestMessage.isStickyMention ?? false,
            clerical: latestMessage.clerical,
            index: latestMessage.message?.index ?? latestMessage.index ?? 0,
        },
        otherChatAccount:
            otherChatAccount instanceof TestSession
                ? expect.objectContaining({id: otherChatAccount.account.id})
                : otherChatAccount instanceof TestAccount
                  ? expect.objectContaining({id: otherChatAccount.id})
                  : otherChatAccount,
    });
}
