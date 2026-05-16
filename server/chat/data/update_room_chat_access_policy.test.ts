import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {updateRoomChatAccessPolicy} from "~/server/chat/data/update_room_chat_access_policy.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
    sitesInjection,
    searchInjection: {
        ...searchInjection,
        // NOTE(ifitzsimmons, 2026-05-06): This is a hack to get the sites-related tests to
        // pass. Loading site entities relies on `getSearchMentionEntityIfPossible` to load
        // search entities
        getSearchMentionEntityIfPossible: async () => ({
            isPrivate: false,
            entity: new SearchEntityModel({
                type: "Channel",
                title: "Some title",
                channel: {
                    id: generateId<ChannelId>(),
                    version: 0,
                },
            }),
        }),
    },
});

test("updateRoomChatAccessPolicy updates the access policy and requires manage access", async () => {
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

    const updatedAccessPolicy: AccessPolicy = {
        type: "Local",
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
    const accessPolicy = attributesItem.definition.accessPolicy;
    assert(accessPolicy.type === "Local", "Expected local access policy");
    expect(accessPolicy.defaultGrant).toBeNull();
    expect(accessPolicy.urlGrant).toBeNull();
    expect(accessPolicy.accountGrantById.get(sessionB.account.id)).toEqual({level: "Edit"});

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
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await updateRoomChatAccessPolicy(session.action(), {
        chatId,
        accessPolicy: {
            type: "Local",
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
    assert(attributesItem.definition.accessPolicy.type === "Local", "Expected local access policy");
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
                type: "Local",
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

// Local→Local update: `validateAccessPolicyUpdateForServer` returns no site
// transaction entries, so this exercises the `transactionEntries.length === 0`
// branch where the chat is updated via `directlyUpdateItem` and
// `getDynamoGeneralRealtimeEventTransactionForSite` returns no site events.
test("updateRoomChatAccessPolicy returns no site events when not crossing into a site", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const result = await updateRoomChatAccessPolicy(session.action(), {
        chatId,
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
        notification: null,
    });

    const siteEvents = await result.getDynamoGeneralRealtimeEventTransactionForSite(
        session.action(),
    );
    expect(siteEvents).toEqual([]);
});

// Local→Site update: `validateAccessPolicyUpdateForServer` produces "add to site"
// transaction entries, so this exercises the `transactionEntries.length > 0`
// branch where the chat write and the site item writes go through
// `executeTransaction` together and
// `getDynamoGeneralRealtimeEventTransactionForSite` materializes the resulting
// site events.
test("updateRoomChatAccessPolicy emits site events when moving chat into a site", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const site = await TestSite.create(session, {access: "Public"});

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const result = await updateRoomChatAccessPolicy(session.action(), {
        chatId,
        accessPolicy: {
            type: "Site",
            siteId: site.id,
            position: {
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            },
        },
        notification: null,
    });

    const siteEvents = await result.getDynamoGeneralRealtimeEventTransactionForSite(
        session.action(),
    );
    expect(siteEvents.length).toBeGreaterThan(0);

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
    });
    assert(attributesItem.definition.type === "Room");
    expect(attributesItem.definition.accessPolicy).toEqual({type: "Site", siteId: site.id});
});

// Site→Local update: produces "remove from site" transaction entries, exercising
// the same `transactionEntries.length > 0` branch in the opposite direction. We
// move the chat into the site first via a regular update so the test exercises
// real "in the site" state, then verify the move-out also emits site events.
test("updateRoomChatAccessPolicy emits site events when moving chat out of a site", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const site = await TestSite.create(session, {access: "Public"});

    const {id: chatId} = await createRoomChat(session.action(), {
        spaceId: space.id,
        name: "General",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await updateRoomChatAccessPolicy(session.action(), {
        chatId,
        accessPolicy: {
            type: "Site",
            siteId: site.id,
            position: {
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            },
        },
        notification: null,
    });

    const result = await updateRoomChatAccessPolicy(session.action(), {
        chatId,
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
        notification: null,
    });

    const siteEvents = await result.getDynamoGeneralRealtimeEventTransactionForSite(
        session.action(),
    );
    expect(siteEvents.length).toBeGreaterThan(0);

    const attributesItem = await ChatTable.getItem(context, {
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
    });
    assert(attributesItem.definition.type === "Room");
    expect(attributesItem.definition.accessPolicy.type).toBe("Local");
});
