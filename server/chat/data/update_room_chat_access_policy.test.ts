import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {updateRoomChatAccessPolicy} from "~/server/chat/data/update_room_chat_access_policy.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

test("updateRoomChatAccessPolicy updates the access policy and requires manage access", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            accountGrantById: new Map([[sessionA.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        },
    });

    const updatedAccessPolicy: AccessPolicy = {
        accountGrantById: new Map([
            [sessionA.account.id, {level: "Manage", generation: 0}],
            [sessionB.account.id, {level: "Edit"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    await updateRoomChatAccessPolicy(sessionA.action(), {
        chatId,
        accessPolicy: updatedAccessPolicy,
        notification: null,
    });

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
    });

    expect(attributesItem.definition.type).toBe("Room");
    assert(attributesItem.definition.type === "Room");
    expect(attributesItem.definition.accessPolicy.defaultGrant).toBeNull();
    expect(attributesItem.definition.accessPolicy.urlGrant).toBeNull();
    expect(
        attributesItem.definition.accessPolicy.accountGrantById.get(sessionB.account.id),
    ).toEqual({level: "Edit"});

    await expect(
        updateRoomChatAccessPolicy(sessionB.action(), {
            chatId,
            accessPolicy: updatedAccessPolicy,
            notification: null,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("updateRoomChatAccessPolicy allows url grants", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await updateRoomChatAccessPolicy(session.action(), {
        chatId,
        accessPolicy: {
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
        notification: null,
    });

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
    });

    expect(attributesItem.definition.type).toBe("Room");
    assert(attributesItem.definition.type === "Room");
    expect(attributesItem.definition.accessPolicy.urlGrant).toEqual({level: "View"});
});

test("updateRoomChatAccessPolicy rejects direct chats", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const chat = await TestChat.get(sessionA, sessionB);

    await expect(
        updateRoomChatAccessPolicy(sessionA.action(), {
            chatId: chat.id,
            accessPolicy: {
                accountGrantById: new Map([
                    [sessionA.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            notification: null,
        }),
    ).rejects.toThrow(FailedPreconditionError);
});
