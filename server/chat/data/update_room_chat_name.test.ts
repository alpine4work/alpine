import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {updateRoomChatName} from "~/server/chat/data/update_room_chat_name.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.open_source.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

test("updateRoomChatName updates the name and requires manage access", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[sessionA.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        },
    });

    await updateRoomChatName(sessionA.action(), {chatId, name: "Leadership"});

    expect(
        await ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId,
        }),
    ).toMatchObject({
        definition: {
            type: "Room",
            name: "Leadership",
        },
    });

    await expect(updateRoomChatName(sessionB.action(), {chatId, name: "Nope"})).rejects.toThrow(
        PermissionDeniedError,
    );

    expect(
        await ChatTable.getItem(context, {
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId,
        }),
    ).toMatchObject({
        definition: {
            type: "Room",
            name: "Leadership",
        },
    });
});

test("updateRoomChatName rejects direct chats", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const chat = await TestChat.get(sessionA, sessionB);

    await expect(
        updateRoomChatName(sessionA.action(), {chatId: chat.id, name: "Nope"}),
    ).rejects.toThrow(FailedPreconditionError);
});
