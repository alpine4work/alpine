import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {getOrCreateChatForAccounts, sendChatMessage} from "~/server/dynamo/chat_table";
import {createChannel, createPost, createPostComment} from "~/server/dynamo/forum_table";
import {
    archiveInboxEntry,
    getInbox,
    getInboxEntries,
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/dynamo/notifications_table";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema";
import {emptyPostContent} from "~/shared/content/post_content_schema";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {DynamoGeneralRealtimeIndexQuery} from "~/shared/dynamo/dynamo_general_realtime_types";
import {PermissionDeniedError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {generateId} from "~/shared/id/id";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {emptyContentReferences} from "~/shared/models/content_references";
import {
    InboxChatEntryModel,
    InboxEntryModel,
    InboxModel,
    InboxPostCommentsEntryModel,
} from "~/shared/models/inbox_model";

const context = createTestContext();

// We create a new scenario for every test so the inbox isn't shared between
// test runs.
async function createScenario() {
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
            item: account1SessionItem,
            account: new AccountModel({
                id: account1Id,
                name: "Account 1",
                createdTime,
                hasInternalAccess: undefined,
            }),
        },
        session2: {
            item: account2SessionItem,
            account: new AccountModel({
                id: account2Id,
                name: "Account 2",
                createdTime,
                hasInternalAccess: undefined,
            }),
        },
        session3: {
            item: account3SessionItem,
            account: new AccountModel({
                id: account3Id,
                name: "Account 3",
                createdTime,
                hasInternalAccess: undefined,
            }),
        },
        otherSession: {
            item: otherAccountSessionItem,
            account: new AccountModel({
                id: otherAccountId,
                name: "Account 4",
                createdTime,
                hasInternalAccess: undefined,
            }),
        },
        sharedSession: {
            item: sharedAccountSessionItem,
            account: new AccountModel({
                id: sharedAccountId,
                name: "Account 5",
                createdTime,
                hasInternalAccess: undefined,
            }),
        },
        mentionAccount1MessageContent,
        mentionAccount2MessageContent,
        mentionAccount3MessageContent,
        mentionSharedAccountMessageContent,
    };
}

function massageInboxEntriesQuery(
    entriesQuery: DynamoGeneralRealtimeIndexQuery<InboxEntryModel>,
): Array<InboxEntryModel> {
    return entriesQuery.items.map(({model}) => model);
}

describe("Post comments", () => {
    test("commenting creates an inbox entry for all subscribers", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(context.action(scenario.session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment3 = await createPostComment(context.action(scenario.session1), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("mentioning someone in a creates a loud notification for them whether or not they are a subscriber", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        const comment2 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        const comment3 = await createPostComment(context.action(scenario.session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 2,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);
    });

    test("mentioning yourself does not create a loud notification for yourself", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(context.action(scenario.session1), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment3 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);
    });

    test("accounts have separate inboxes for each space", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const otherChannel = await createChannel(context.action(scenario.otherSession), {
            spaceId: scenario.otherSpace.id,
            name: "Test",
        });

        const otherPost = await createPost(context.action(scenario.otherSession), {
            channelId: otherChannel.id,
            content: emptyPostContent,
        });

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionSharedAccountMessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.sharedSession.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionSharedAccountMessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.sharedSession.account.id, scenario.sharedSession.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(context.action(scenario.otherSession), {
            postId: otherPost.id,
            parentCommentIndex: null,
            content: scenario.mentionSharedAccountMessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.sharedSession.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionSharedAccountMessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.sharedSession.account.id, scenario.sharedSession.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.otherSpace.id,
                accountId: scenario.sharedSession.account.id,
                postId: otherPost.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.otherSession.account,
                    contentSnippet: {
                        doc: scenario.mentionSharedAccountMessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.sharedSession.account.id, scenario.sharedSession.account],
                            ]),
                        },
                    },
                },
            }),
        ]);
    });

    test("account can not see mention in a different space", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const otherChannel = await createChannel(context.action(scenario.otherSession), {
            spaceId: scenario.otherSpace.id,
            name: "Test",
        });

        const otherPost = await createPost(context.action(scenario.otherSession), {
            channelId: otherChannel.id,
            content: emptyPostContent,
        });

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);

        await createPostComment(context.action(scenario.otherSession), {
            postId: otherPost.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("comment notification events processed out of order result in the same latest comment", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session2), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await createPostComment(context.action(scenario.session1), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
            scenario.session1.account.id,
        );
        const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
            scenario.session2.account.id,
        );

        await createPostComment(context.action(scenario.session1), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        const comment3 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        const {unpause: unpause1} = await pause1Promise;
        const {unpause: unpause2} = await pause2Promise;
        unpause2();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        unpause1();
        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("loud notifications are always at the top of the inbox", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post1 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post2 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post3 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment2 = await createPostComment(context.action(scenario.session2), {
            postId: post2.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment3 = await createPostComment(context.action(scenario.session2), {
            postId: post3.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment4 = await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment4"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment5 = await createPostComment(context.action(scenario.session2), {
            postId: post2.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment5"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment6 = await createPostComment(context.action(scenario.session2), {
            postId: post3.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment7 = await createPostComment(context.action(scenario.session2), {
            postId: post2.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment7"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment7.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment7"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment8 = await createPostComment(context.action(scenario.session2), {
            postId: post2.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 2,
                latestComment: {
                    createdTime: comment8.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("can not observe inbox in a space you don't have access to", async () => {
        const scenario = await createScenario();

        await expect(
            observeInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("observing an inbox freezes loud notifications in place", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post1 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post2 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post3 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post4 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment2 = await createPostComment(context.action(scenario.session2), {
            postId: post2.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment3 = await createPostComment(context.action(scenario.session2), {
            postId: post3.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment4 = await createPostComment(context.action(scenario.session2), {
            postId: post4.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment4"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post4.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment5 = await createPostComment(context.action(scenario.session2), {
            postId: post2.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment5"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post4.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment6 = await createPostComment(context.action(scenario.session2), {
            postId: post3.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment6"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post4.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment6"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const comment7 = await createPostComment(context.action(scenario.session2), {
            postId: post3.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment7.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post4.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("can archive inbox entries", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post1 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post2 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await createPostComment(context.action(scenario.session3), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        const comment3 = await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        const comment4 = await createPostComment(context.action(scenario.session1), {
            postId: post2.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post2.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);
    });

    test("can unarchive inbox entries", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post1 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post2 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post3 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await createPostComment(context.action(scenario.session3), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        const comment3 = await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        const comment4 = await createPostComment(context.action(scenario.session1), {
            postId: post2.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        const comment5 = await createPostComment(context.action(scenario.session1), {
            postId: post3.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post2.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post2.id},
        });

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await unarchiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await unarchiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post2.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post2.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await unarchiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post2.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                postId: post3.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                postId: post1.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("can not archive or unarchive inbox entries in a space you don't have access to", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        await expect(
            archiveInboxEntry(context.action(scenario.otherSession), {
                spaceId: scenario.space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            unarchiveInboxEntry(context.action(scenario.otherSession), {
                spaceId: scenario.space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("notification on an archived entry revives it", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("notification on an archived entry revives it clearing old loud notification count", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 1,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("notification on an archived entry from own account does not revive it", async () => {
        const scenario = await createScenario();

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment1 = await createPostComment(context.action(scenario.session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(context.action(scenario.session1), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await unarchiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post.id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                postId: post.id,
                loudNotificationCount: 0,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("comment2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("can not get inbox in a space you don't have access to", async () => {
        const scenario = await createScenario();

        await expect(
            getInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("gets an inbox model even in a fresh space", async () => {
        const scenario = await createScenario();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );
    });

    test("getting an inbox returns the current loud notification count", async () => {
        const scenario = await createScenario();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        const channel = await createChannel(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            name: "Test",
        });

        const post1 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post2 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        const post3 = await createPost(context.action(scenario.session1), {
            channelId: channel.id,
            content: emptyPostContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await createPostComment(context.action(scenario.session3), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await createPostComment(context.action(scenario.session2), {
            postId: post1.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("comment3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await createPostComment(context.action(scenario.session1), {
            postId: post2.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 1,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await createPostComment(context.action(scenario.session1), {
            postId: post3.id,
            parentCommentIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 2,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await archiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 2,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post2.id},
        });

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 1,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 1,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await unarchiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 1,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await unarchiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post2.id},
        });

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 1,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );

        await unarchiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post1.id},
        });

        expect(
            (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                loudNotificationCount: 0,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                loudNotificationCount: 1,
            }),
        );

        expect(
            (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
        ).toEqual(
            new InboxModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                loudNotificationCount: 0,
            }),
        );
    });
});

describe("Chat", () => {
    test("messaging creates an inbox entry for all subscribers", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message2 = await sendChatMessage(context.action(scenario.session3), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message3 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("mentioning someone in a creates a second loud notification for them", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message2 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        const message3 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        const message4 = await sendChatMessage(context.action(scenario.session3), {
            chatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 3,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
        ]);
    });

    test("mentioning yourself does not create an extra loud notification for yourself", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message2 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        const message3 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message4 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);
    });

    test("accounts have separate inboxes for each space", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.sharedSession.account.id],
        });

        const otherChatId = await getOrCreateChatForAccounts(
            context.action(scenario.otherSession),
            {
                spaceId: scenario.otherSpace.id,
                otherAccountIds: [scenario.sharedSession.account.id],
            },
        );

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.sharedSession.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message2 = await sendChatMessage(context.action(scenario.otherSession), {
            chatId: otherChatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.sharedSession.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.sharedSession), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.otherSpace.id,
                accountId: scenario.sharedSession.account.id,
                chatId: otherChatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.otherSession.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("account can not see mention in chat they don't have access to", async () => {
        const scenario = await createScenario();

        const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        const otherChatId = await getOrCreateChatForAccounts(
            context.action(scenario.otherSession),
            {
                spaceId: scenario.otherSpace.id,
                otherAccountIds: [scenario.sharedSession.account.id],
            },
        );

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);

        await sendChatMessage(context.action(scenario.session2), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);

        await sendChatMessage(context.action(scenario.otherSession), {
            chatId: otherChatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount3MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount3MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, scenario.session3.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await expect(
            getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.otherSpace.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("message notification events processed out of order result in the same latest message", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
            scenario.session1.account.id,
        );
        const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
            scenario.session2.account.id,
        );

        await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        const message3 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        const {unpause: unpause1} = await pause1Promise;
        const {unpause: unpause2} = await pause2Promise;
        unpause2();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        unpause1();
        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("loud notifications are always at the top of the inbox", async () => {
        const scenario = await createScenario();

        const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session3.account.id],
        });

        const chat3Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message2 = await sendChatMessage(context.action(scenario.session3), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message3 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat3Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message4 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message4"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message5 = await sendChatMessage(context.action(scenario.session3), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message5"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message6 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message5"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message7 = await sendChatMessage(context.action(scenario.session3), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message7"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message7.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message7"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message8 = await sendChatMessage(context.action(scenario.session3), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message8.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("can not observe inbox in a space you don't have access to", async () => {
        const scenario = await createScenario();

        await expect(
            observeInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("observing an inbox freezes loud notifications in place", async () => {
        const scenario = await createScenario();

        const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session3.account.id],
        });

        const chat3Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        const chat4Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.sharedSession.account.id],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message2 = await sendChatMessage(context.action(scenario.session3), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message3 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat3Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message4 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat4Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message4"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat4Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message5 = await sendChatMessage(context.action(scenario.session3), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message5"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat4Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message6 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat3Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message6"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat4Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message6.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message6"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message8 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat3Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount1MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat3Id,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message8.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount1MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session1.account.id, scenario.session1.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat4Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session3.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message5"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("sends a loud notification on any message after some period of time", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message2 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const message3 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        const originalDateNow = Date.now;
        const mockTime = Date.now() + 1000 * 60 * 60 * 2;

        let message4;
        try {
            Date.now = () => mockTime;

            message4 = await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message4"),
            });
        } finally {
            Date.now = originalDateNow;
        }

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message4"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("can archive inbox entries", async () => {
        const scenario = await createScenario();

        const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [
                scenario.session2.account.id,
                scenario.session3.account.id,
                scenario.sharedSession.account.id,
            ],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await sendChatMessage(context.action(scenario.session3), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        const message3 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        const message4 = await sendChatMessage(context.action(scenario.session1), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat1Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat2Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat1Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);
    });

    test("can unarchive inbox entries", async () => {
        const scenario = await createScenario();

        const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
        });

        const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [
                scenario.session2.account.id,
                scenario.session3.account.id,
                scenario.sharedSession.account.id,
            ],
        });

        const chat3Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await sendChatMessage(context.action(scenario.session3), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        const message3 = await sendChatMessage(context.action(scenario.session2), {
            chatId: chat1Id,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message3"),
        });

        const message4 = await sendChatMessage(context.action(scenario.session1), {
            chatId: chat2Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        const message5 = await sendChatMessage(context.action(scenario.session1), {
            chatId: chat3Id,
            parentMessageIndex: null,
            content: scenario.mentionAccount2MessageContent,
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat1Id},
        });

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat2Id},
        });

        await archiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat1Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await unarchiveInboxEntry(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat1Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await unarchiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat2Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat2Id,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        await unarchiveInboxEntry(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId: chat1Id},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId: chat1Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat1Id,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat2Id,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session2.account.id,
                chatId: chat3Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message5.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);

        expect(
            await getInboxEntries(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat1Id,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message3"),
                        references: emptyContentReferences,
                    },
                },
            }),
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session3.account.id,
                chatId: chat2Id,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: scenario.mentionAccount2MessageContent,
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, scenario.session2.account],
                            ]),
                        },
                    },
                },
            }),
        ]);
    });

    test("notification on an archived entry revives it", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message2 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });

    test("notification on an archived entry from own account does not revive it", async () => {
        const scenario = await createScenario();

        const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            otherAccountIds: [scenario.session2.account.id],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message1 = await sendChatMessage(context.action(scenario.session2), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: scenario.session2.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message1"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);

        await archiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const message2 = await sendChatMessage(context.action(scenario.session1), {
            chatId,
            parentMessageIndex: null,
            content: createSimpleMessageContent("message2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        await unarchiveInboxEntry(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            key: {type: "Chat", chatId},
        });

        expect(
            await getInboxEntries(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                limit: 100,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChatEntryModel({
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
                chatId,
                loudNotificationCount: 0,
                latestMessage: {
                    createdTime: message2.createdTime,
                    author: scenario.session1.account,
                    contentSnippet: {
                        doc: createSimpleMessageContent("message2"),
                        references: emptyContentReferences,
                    },
                },
            }),
        ]);
    });
});
