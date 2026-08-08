import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {isSubscribedToRoomChat} from "~/server/chat/data/is_subscribed_to_room_chat.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

test("createRoomChat stores room definition and no account items", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "Team Chat",
    });

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
    });

    expect(attributesItem.definition).toMatchObject({
        type: "Room",
        name: "Team Chat",
    });
    expect(attributesItem.accountIdsForDirectOneOnOne).toBeNull();
    expect(attributesItem.messagesSummary.messageCountByAuthorId.size).toBe(0);

    const accountItems = await arrayFromAsyncIterable(
        ChatTable.query(context, {
            partitionKey: {partitionType: "Chat", chatId},
            startSortKey: {
                sortRangeType: "Account",
                accountId: DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "Account",
                accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
            },
            limit: "All",
        }),
    );

    expect(accountItems).toHaveLength(0);
});

test("createRoomChat requires manage access in access policy", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    await expect(
        createRoomChat(sessionA.action(), {
            spaceId: space.id,
            name: "No Manage",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [sessionB.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ).rejects.toThrow(InvalidArgumentError);
});

test("createRoomChat requires access to the space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        createRoomChat(session.action(), {
            spaceId: otherSpace.id,
            name: "Cross Space",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("createRoomChat subscribes the actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "Team Chat",
    });

    await expect(isSubscribedToRoomChat(session.action(), chatId)).resolves.toBe(true);
});

test("createRoomChat allows urlGrant access policy", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "Public Room",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
    });

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
    });

    expect(attributesItem.definition).toMatchObject({
        type: "Room",
        name: "Public Room",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
    });
});

test("authorizeChatAccess respects room chat access policy", async () => {
    const space = await TestSpace.create(context);
    const [sessionA, sessionB] = await space.createSessions(2);

    const {id: chatId} = await createRoomChat(sessionA.action(), {
        spaceId: space.id,
        name: "Private Room",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[sessionA.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await authorizeChatAccess(sessionA.action(), chatId, "View");

    await expect(authorizeChatAccess(sessionB.action(), chatId, "View")).rejects.toThrow(
        PermissionDeniedError,
    );
});
