import {SessionItem, getAccountsTableForTest} from "~/server/accounts/accounts_table.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {DynamoGeneralRealtimeIndexQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

// Notification table test helpers can only be used in Jest.
assert(import.meta.jest);

// We create a new scenario for every test so the inbox isn't shared between
// test runs.
export async function createNotificationsScenario(context: TestContext) {
    const SpacesTable = getSpacesTableForTest();
    const AccountsTable = getAccountsTableForTest();

    const createdTime = new Date();

    const spaceId = generateId<SpaceId>();
    const otherSpaceId = generateId<SpaceId>();

    const account1Id = generateId<AccountId>();
    const account2Id = generateId<AccountId>();
    const account3Id = generateId<AccountId>();
    const otherAccountId = generateId<AccountId>();
    const sharedAccountId = generateId<AccountId>();

    const account1SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account1Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const account2SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account2Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const account3SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account3Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const otherAccountSessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: otherAccountId,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const sharedAccountSessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: sharedAccountId,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };

    await runAllPromises([
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: spaceId,
            name: "Space 1",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: otherSpaceId,
            name: "Space 2",
            createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account1Id,
            name: "Account 1",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account1Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account2Id,
            name: "Account 2",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account2Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account3Id,
            name: "Account 3",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account3Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: otherAccountId,
            name: "Account 4",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: otherSpaceId,
            accountId: otherAccountId,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: sharedAccountId,
            name: "Account 5",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: sharedAccountId,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: otherSpaceId,
            accountId: sharedAccountId,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, account1SessionItem),
        AccountsTable.createItem(context, account2SessionItem),
        AccountsTable.createItem(context, account3SessionItem),
        AccountsTable.createItem(context, otherAccountSessionItem),
        AccountsTable.createItem(context, sharedAccountSessionItem),
    ]);

    const mentionAccount1MessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: {accountId: account1Id, isShort: false},
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    const mentionAccount2MessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: {accountId: account2Id, isShort: false},
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    const mentionAccount3MessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: {accountId: account3Id, isShort: false},
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    const mentionSharedAccountMessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: {accountId: sharedAccountId, isShort: false},
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    return {
        space: {id: spaceId},
        otherSpace: {id: otherSpaceId},
        session1: {
            ...account1SessionItem,
            account: new AccountModel({
                id: account1Id,
                name: "Account 1",
                nameVersion: 0,
                createdTime,
                hasInternalAccess: undefined,
                version: 0,
            }),
        },
        session2: {
            ...account2SessionItem,
            account: new AccountModel({
                id: account2Id,
                name: "Account 2",
                nameVersion: 0,
                createdTime,
                hasInternalAccess: undefined,
                version: 0,
            }),
        },
        session3: {
            ...account3SessionItem,
            account: new AccountModel({
                id: account3Id,
                name: "Account 3",
                nameVersion: 0,
                createdTime,
                hasInternalAccess: undefined,
                version: 0,
            }),
        },
        otherSession: {
            ...otherAccountSessionItem,
            account: new AccountModel({
                id: otherAccountId,
                name: "Account 4",
                nameVersion: 0,
                createdTime,
                hasInternalAccess: undefined,
                version: 0,
            }),
        },
        sharedSession: {
            ...sharedAccountSessionItem,
            account: new AccountModel({
                id: sharedAccountId,
                name: "Account 5",
                nameVersion: 0,
                createdTime,
                hasInternalAccess: undefined,
                version: 0,
            }),
        },
        mentionAccount1MessageContent,
        mentionAccount2MessageContent,
        mentionAccount3MessageContent,
        mentionSharedAccountMessageContent,
    };
}

export function massageInboxEntriesQuery(
    entriesQuery: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>,
): Array<InboxEntryModel> {
    return entriesQuery.items.map(({model}) => model);
}
