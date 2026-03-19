import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    addFeedAccountCandidateEntry,
    addFeedCandidateEntry,
    getAndUpdateFeedEntries,
    getFeedAccountCandidateEntriesForTest,
    getFeedCandidateEntriesForTest,
    getFeedEntries,
    processAddFeedAccountCandidateEntryJob,
    processAddFeedCandidateEntryJob,
} from "~/server/feed/feed_actions.js";
import {enableMockFileTaskCollectionEntityModelForTest} from "~/server/files/data/get_file_task_collection_entity_model_if_possible.js";
import {enableMockFileTaskEntityModelForTest} from "~/server/files/data/get_file_task_entity_model_if_possible.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {addSearchAffinityEntityPointsForTest} from "~/server/search/data/table/search_entity_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {FeedPostEntryModel} from "~/shared/feed/feed_entry_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

// Increase test timeout since some of these tests can take a while to setup (e.g.
// they need to create hundreds of posts).
import.meta.jest.setTimeout(1000 * 30);

import.meta.jest.useFakeTimers();

enableMockFileTaskCollectionEntityModelForTest();
enableMockFileTaskEntityModelForTest();

const context = createTestContext({
    documentsInjection,
    forumInjection,
    tasksInjection,
    processJob: async (context, job) => {
        if (job.type === "AddFeedCandidateEntry") {
            await processAddFeedCandidateEntryJob(context, job);
        }

        if (job.type === "AddFeedAccountCandidateEntry") {
            await processAddFeedAccountCandidateEntryJob(context, job);
        }
    },
});

// This is unrelated to our feed tests but we want a sanity check in at least one
// test file to make sure our Jest internals hack in `createTestContext()` works
// and the timeout we set at the top of this file isn't lowered to 10s.
assert((globalThis as any)[Symbol.for("TEST_TIMEOUT_SYMBOL")] === 1000 * 30);

test("creating a post will create a feed candidate", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const channel1 = await TestChannel.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    const post1 = await channel1.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Post",
                postId: post1.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post1.createdTime,
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    const channel2 = await TestChannel.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 2,
            entry: {
                type: "Channel",
                channelId: channel2.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 1,
            entry: {
                type: "Post",
                postId: post1.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post1.createdTime,
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    const post2 = await channel1.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 3,
            entry: {
                type: "Post",
                postId: post2.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post2.createdTime,
            },
        },
        {
            index: 2,
            entry: {
                type: "Channel",
                channelId: channel2.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 1,
            entry: {
                type: "Post",
                postId: post1.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post1.createdTime,
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    const post3 = await channel1.createPost(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 4,
            entry: {
                type: "Post",
                postId: post3.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post3.createdTime,
            },
        },
        {
            index: 3,
            entry: {
                type: "Post",
                postId: post2.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post2.createdTime,
            },
        },
        {
            index: 2,
            entry: {
                type: "Channel",
                channelId: channel2.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 1,
            entry: {
                type: "Post",
                postId: post1.id,
                authorId: session.account.id,
                channelId: channel1.id,
                createdTime: post1.createdTime,
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);
});

test("private channels don\u2019t add feed candidates until made public", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const channel1 = await TestChannel.create(session, {access: "Private"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const channel2 = await TestChannel.create(session, {access: "Private"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await channel1.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await channel1.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await channel1.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    const channel3 = await TestChannel.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Channel",
                channelId: channel3.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await channel3.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Channel",
                channelId: channel3.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await channel3.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Channel",
                channelId: channel3.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await channel2.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 2,
            entry: {
                type: "Channel",
                channelId: channel2.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
        {
            index: 1,
            entry: {
                type: "Channel",
                channelId: channel3.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Channel",
                channelId: channel1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("public room chats add a feed candidate", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);
    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    const room = await TestChat.createRoom(session, {name: "Public Room"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);
    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);
});

test("public room chats don’t add another feed candidate when reshared", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const room = await TestChat.createRoom(session, {
        name: "Public Room",
        access: "Public",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    await room.roomAccess.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    await room.roomAccess.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);
});

test("private room chats add an account feed candidate", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);
    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    const room = await TestChat.createRoom(session, {
        name: "Private Room",
        access: "Private",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);
    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);
});

test("private room chats add a feed candidate once when shared", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const room = await TestChat.createRoom(session, {
        name: "Private Room",
        access: "Private",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await room.roomAccess.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await room.roomAccess.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    await room.roomAccess.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "RoomChat",
                chatId: room.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("making a document public adds a feed candidate entry five minutes later", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const document = await TestDocument.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await document.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 4);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 1);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await document.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await document.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("making a document public adds a feed candidate entry immediately if has typed much content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const document = await TestDocument.create(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    for (let i = 0; i < 19; i++) {
        await document.type(session, i === 0 ? `${i}` : `, ${i}`);
        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    }

    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await document.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 1);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await document.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    await document.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("making a document public adds a feed candidate entry immediately for large pasted content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);
    await ProcessContextModule.waitForTestTasks();

    await document.type(session, "x".repeat(10_000));
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await document.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("making a public document adds a feed candidate entry five minutes later", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const document = await TestDocument.create(session, {access: "Public"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                excludeFromCreatorFeed: true,
                event: "Created",
            },
        },
    ]);
});

test("private task collections don\u2019t add feed candidates until made public five minutes later", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const collection1 = await TestTaskCollection.create(session, {access: "Private"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const collection2 = await TestTaskCollection.create(session, {access: "Private"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await collection1.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 4);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 1);
    await ProcessContextModule.waitForTestTasks();

    let expected: unknown = [
        {
            index: 0,
            entry: {
                type: "TaskCollection",
                collectionId: collection1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ];

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection1.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection1.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    const collection3 = await TestTaskCollection.create(session, {access: "Public"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expected = [
        {
            index: 1,
            entry: {
                type: "TaskCollection",
                collectionId: collection3.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                excludeFromCreatorFeed: true,
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "TaskCollection",
                collectionId: collection1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ];

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection3.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection3.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection2.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expected = [
        {
            index: 2,
            entry: {
                type: "TaskCollection",
                collectionId: collection2.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
        {
            index: 1,
            entry: {
                type: "TaskCollection",
                collectionId: collection3.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "Created",
                excludeFromCreatorFeed: true,
            },
        },
        {
            index: 0,
            entry: {
                type: "TaskCollection",
                collectionId: collection1.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ];

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );
});

test("private task collections don\u2019t add feed candidates until made public immediately if there are many tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    const collection = await TestTaskCollection.create(session, {access: "Private"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    for (let i = 0; i < 10; i++) {
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);
    }

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await collection.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    const expected: unknown = [
        {
            index: 0,
            entry: {
                type: "TaskCollection",
                collectionId: collection.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ];

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 1);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection.access.revokeDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    await collection.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual(
        expected,
    );
});

test("creating a private channel adds entry to own feed then when shared to space feed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    await channel.access.grant(session1, session2);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    await channel.access.grantDefault(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("creating a private document adds entry to own feed then when shared to space feed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Document",
                document: expect.objectContaining({
                    id: document.id,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Document",
                document: expect.objectContaining({
                    id: document.id,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    await document.access.grantDefault(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Document",
                document: expect.objectContaining({
                    id: document.id,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Document",
                document: expect.objectContaining({
                    id: document.id,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Document",
                document: expect.objectContaining({
                    id: document.id,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Document",
                document: expect.objectContaining({
                    id: document.id,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("creating a private task collection adds entry to own feed then when shared to space feed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grant(session1, session2);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "TaskCollection",
                collection: expect.objectContaining({
                    collection: expect.objectContaining({id: collection.id}),
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "TaskCollection",
                collection: expect.objectContaining({
                    collection: expect.objectContaining({id: collection.id}),
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    await collection.access.grantDefault(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "TaskCollection",
                collection: expect.objectContaining({
                    collection: expect.objectContaining({id: collection.id}),
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "TaskCollection",
                collection: expect.objectContaining({
                    collection: expect.objectContaining({id: collection.id}),
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "TaskCollection",
                collection: expect.objectContaining({
                    collection: expect.objectContaining({id: collection.id}),
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "TaskCollection",
                collection: expect.objectContaining({
                    collection: expect.objectContaining({id: collection.id}),
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("create project task in same transaction adds account candidate entry with UpdatedToProjectLayout", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const projectTask = await TestTask.create(creatorSession, {layout: "Project"});
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === projectTask.id);
    expect(taskCandidateEntries).toEqual([]);

    const creatorTaskAccountCandidateEntries = (
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: creatorSession.account.id,
            limit: 100,
        })
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === projectTask.id);
    expect(creatorTaskAccountCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: projectTask.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: false,
                event: "UpdatedToProjectLayout",
            },
        },
    ]);

    const creatorFeedUpdate = await getAndUpdateFeedEntries(creatorSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(creatorFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: projectTask.id}),
            }),
            event: "UpdatedToProjectLayout",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);

    const otherFeedUpdate = await getAndUpdateFeedEntries(otherSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(otherFeedUpdate.entries).toEqual([expect.objectContaining({type: "Welcome"})]);
});

test("update regular private task to project in separate transaction adds account candidate entry", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const task = await TestTask.create(creatorSession);
    await task.updateLayout(creatorSession, "Project");
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([]);

    const creatorTaskAccountCandidateEntries = (
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: creatorSession.account.id,
            limit: 100,
        })
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(creatorTaskAccountCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: false,
                event: "UpdatedToProjectLayout",
            },
        },
    ]);

    const otherTaskAccountCandidateEntries = (
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: otherSession.account.id,
            limit: 100,
        })
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(otherTaskAccountCandidateEntries).toEqual([]);
});

test("update regular public task to project adds space candidate entry", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const parentTask = await TestTask.create(creatorSession);
    await parentTask.access.grantDefault(creatorSession);
    const task = await TestTask.create(creatorSession);
    await task.updateParentTask(creatorSession, parentTask);
    await task.updateLayout(creatorSession, "Project");
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: false,
                event: "UpdatedToProjectLayout",
            },
        },
    ]);

    const creatorFeedUpdate = await getAndUpdateFeedEntries(creatorSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(creatorFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "UpdatedToProjectLayout",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);

    const otherFeedUpdate = await getAndUpdateFeedEntries(otherSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(otherFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "UpdatedToProjectLayout",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);
});

test("update to project by non-creator adds account candidate for updater account", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, updaterSession] = await space.createSessions(2);

    const task = await TestTask.create(creatorSession);
    await task.access.grant(creatorSession, updaterSession, "Edit");
    await task.updateLayout(updaterSession, "Project");
    await ProcessContextModule.waitForTestTasks();

    const creatorTaskAccountCandidateEntries = (
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: creatorSession.account.id,
            limit: 100,
        })
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(creatorTaskAccountCandidateEntries).toEqual([]);

    const updaterTaskAccountCandidateEntries = (
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: updaterSession.account.id,
            limit: 100,
        })
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(updaterTaskAccountCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: updaterSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: false,
                event: "UpdatedToProjectLayout",
            },
        },
    ]);
});

test("updating to project twice is deduped", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);
    await task.updateLayout(session, "Project");
    await task.updateLayout(session, "Project");
    await ProcessContextModule.waitForTestTasks();

    const taskAccountCandidateEntries = (
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        })
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskAccountCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                excludeFromCreatorFeed: false,
                event: "UpdatedToProjectLayout",
            },
        },
    ]);
});

test("adding public collection to project task promotes to shared project entry", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const task = await TestTask.create(creatorSession, {layout: "Project"});
    const collection = await TestTaskCollection.create(creatorSession, {access: "Public"});
    await ProcessContextModule.waitForTestTasks();

    await task.addCollection(creatorSession, collection);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: true,
                event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
            },
        },
    ]);

    const creatorFeedUpdate = await getAndUpdateFeedEntries(creatorSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(creatorFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "TaskCollection",
            collection: expect.objectContaining({
                collection: expect.objectContaining({id: collection.id}),
            }),
            event: "Created",
        }),
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "UpdatedToProjectLayout",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);

    const otherFeedUpdate = await getAndUpdateFeedEntries(otherSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(otherFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);
});

test("adding private collection to project task does not add shared project entry", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {layout: "Project"});
    const collection = await TestTaskCollection.create(session, {access: "Private"});
    await task.addCollection(session, collection);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([]);
});

test("updating parent to public parent promotes to shared project entry", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const parentTask = await TestTask.create(creatorSession);
    const childTask = await TestTask.create(creatorSession, {layout: "Project"});
    await parentTask.access.grantDefault(creatorSession);
    await ProcessContextModule.waitForTestTasks();

    await childTask.updateParentTask(creatorSession, parentTask);
    await ProcessContextModule.waitForTestTasks();

    const childTaskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === childTask.id);
    expect(childTaskCandidateEntries).toEqual([
        {
            index: expect.any(Number),
            entry: {
                type: "Task",
                taskId: childTask.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: true,
                event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
            },
        },
    ]);

    const creatorFeedUpdate = await getAndUpdateFeedEntries(creatorSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(creatorFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: childTask.id}),
            }),
            event: "UpdatedToProjectLayout",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);

    const otherFeedUpdate = await getAndUpdateFeedEntries(otherSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(otherFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: childTask.id}),
            }),
            event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);
});

test("updating parent to private parent does not add shared project entry", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const parentTask = await TestTask.create(session);
    const childTask = await TestTask.create(session, {layout: "Project"});
    await childTask.updateParentTask(session, parentTask);
    await ProcessContextModule.waitForTestTasks();

    const childTaskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === childTask.id);
    expect(childTaskCandidateEntries).toEqual([]);
});

test("inherited-share event is deduped once task already in AddedCandidate state", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {layout: "Project"});
    const collection1 = await TestTaskCollection.create(session, {access: "Public"});
    const collection2 = await TestTaskCollection.create(session, {access: "Public"});
    await task.addCollection(session, collection1);
    await task.addCollection(session, collection2);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(
        item =>
            item.entry.type === "Task" &&
            item.entry.taskId === task.id &&
            item.entry.event === "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
    );
    expect(taskCandidateEntries).toEqual([
        expect.objectContaining({
            entry: expect.objectContaining({
                type: "Task",
                taskId: task.id,
                event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
            }),
        }),
    ]);
});

test("direct share of regular task without children or collections is delayed 5 minutes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);
    await task.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntriesImmediately = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntriesImmediately).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * (4 * 60 + 59));
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntriesBeforeFiveMinutes = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntriesBeforeFiveMinutes).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntriesAfterFiveMinutes = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntriesAfterFiveMinutes).toEqual([
        {
            index: 0,
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                excludeFromCreatorFeed: false,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("direct share of regular task with child is immediate", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const parentTask = await TestTask.create(session);
    await TestTask.create(session, {parent: parentTask});
    await ProcessContextModule.waitForTestTasks();

    await parentTask.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === parentTask.id);
    expect(taskCandidateEntries).toEqual([
        {
            index: 0,
            entry: {
                type: "Task",
                taskId: parentTask.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                excludeFromCreatorFeed: false,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("direct share of regular task with collection is immediate", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);
    const collection = await TestTaskCollection.create(session, {access: "Private"});
    await task.addCollection(session, collection);
    await ProcessContextModule.waitForTestTasks();

    await task.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([
        {
            index: 0,
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creatorId: session.account.id,
                excludeFromCreatorFeed: false,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("direct share of project task is immediate and excludes creator when creator already got account entry", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const task = await TestTask.create(creatorSession, {layout: "Project"});
    await ProcessContextModule.waitForTestTasks();

    await task.access.grantDefault(creatorSession);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([
        {
            index: 0,
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: true,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    const creatorFeedUpdate = await getAndUpdateFeedEntries(creatorSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(creatorFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "UpdatedToProjectLayout",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);

    const otherFeedUpdate = await getAndUpdateFeedEntries(otherSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(otherFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "SharedWithAccessPolicyDefaultGrant",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);
});

test("direct share includes creator when no prior creator-only entry exists", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, otherSession] = await space.createSessions(2);

    const task = await TestTask.create(creatorSession);
    await TestTask.create(creatorSession, {parent: task});
    await ProcessContextModule.waitForTestTasks();

    await task.access.grantDefault(creatorSession);
    await ProcessContextModule.waitForTestTasks();

    const taskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(item => item.entry.type === "Task" && item.entry.taskId === task.id);
    expect(taskCandidateEntries).toEqual([
        {
            index: 0,
            entry: {
                type: "Task",
                taskId: task.id,
                sharerId: creatorSession.account.id,
                sharedTime: expect.any(Date),
                creatorId: creatorSession.account.id,
                excludeFromCreatorFeed: false,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);

    const creatorFeedUpdate = await getAndUpdateFeedEntries(creatorSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(creatorFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "SharedWithAccessPolicyDefaultGrant",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);

    const otherFeedUpdate = await getAndUpdateFeedEntries(otherSession.action(), {
        spaceId: space.id,
        limit: 500,
    });
    expect(otherFeedUpdate.entries).toEqual([
        expect.objectContaining({
            type: "Task",
            task: expect.objectContaining({
                task: expect.objectContaining({id: task.id}),
            }),
            event: "SharedWithAccessPolicyDefaultGrant",
        }),
        expect.objectContaining({type: "Welcome"}),
    ]);
});

test("direct share is one-time across revoke and re-grant", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {layout: "Project"});
    await task.access.grantDefault(session);
    await task.access.revokeDefault(session);
    await task.access.grantDefault(session);
    await ProcessContextModule.waitForTestTasks();

    const sharedTaskCandidateEntries = (
        await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})
    ).filter(
        item =>
            item.entry.type === "Task" &&
            item.entry.taskId === task.id &&
            item.entry.event === "SharedWithAccessPolicyDefaultGrant",
    );
    expect(sharedTaskCandidateEntries).toEqual([
        expect.objectContaining({
            entry: expect.objectContaining({
                type: "Task",
                taskId: task.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            }),
        }),
    ]);
});

test("can add feed candidates", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const id1 = generateId<DocumentId>();
    const id2 = generateId<DocumentId>();
    const id3 = generateId<DocumentId>();
    const id4 = generateId<DocumentId>();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedCandidateEntry(session.action(), space.id, {
        type: "Document",
        documentId: id1,
        sharerId: session.account.id,
        sharedTime: new Date(),
        creator: {id: session.account.id, from: null},
        event: "Created",
    });

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    await addFeedCandidateEntry(space.systemAction(), space.id, {
        type: "Document",
        documentId: id2,
        sharerId: session.account.id,
        sharedTime: new Date(),
        creator: {id: session.account.id, from: null},
        event: "Created",
    });

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    await expect(
        addFeedCandidateEntry(otherSession.action(), space.id, {
            type: "Document",
            documentId: id3,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    await expect(
        addFeedCandidateEntry(otherSpace.systemAction(), space.id, {
            type: "Document",
            documentId: id4,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);
});

test("add feed candidate entry job processor is idempotent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const job1Id = generateId();
    const job2Id = generateId();
    const job3Id = generateId();
    const document1Id = generateId<DocumentId>();
    const document2Id = generateId<DocumentId>();
    const document3Id = generateId<DocumentId>();
    const document4Id = generateId<DocumentId>();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    await processAddFeedCandidateEntryJob(session.action(), {
        jobId: job1Id,
        spaceId: space.id,
        entry: {
            type: "Document",
            documentId: document1Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        },
    });

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    await processAddFeedCandidateEntryJob(session.action(), {
        jobId: job1Id,
        spaceId: space.id,
        entry: {
            type: "Document",
            documentId: document2Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        },
    });

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    await processAddFeedCandidateEntryJob(session.action(), {
        jobId: job2Id,
        spaceId: space.id,
        entry: {
            type: "Document",
            documentId: document3Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        },
    });

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: document3Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    // Make sure we don't ignore non-idempotent parameter mismatch errors.
    await expect(
        processAddFeedCandidateEntryJob(otherSession.action(), {
            jobId: job3Id,
            spaceId: space.id,
            entry: {
                type: "Document",
                documentId: document4Id,
                sharerId: session.account.id,
                sharedTime: new Date(),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: document3Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);
});

test("can add feed account candidates", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const id1 = generateId<DocumentId>();
    const id2 = generateId<DocumentId>();
    const id3 = generateId<DocumentId>();
    const id4 = generateId<DocumentId>();
    const id5 = generateId<DocumentId>();

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session1.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session2.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedAccountCandidateEntry(session1.action(), space.id, session1.account.id, {
        type: "Document",
        documentId: id1,
        sharerId: session1.account.id,
        sharedTime: new Date(),
        creator: {id: session1.account.id, from: null},
        event: "Created",
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session1.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session2.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedAccountCandidateEntry(space.systemAction(), space.id, session1.account.id, {
        type: "Document",
        documentId: id2,
        sharerId: session1.account.id,
        sharedTime: new Date(),
        creator: {id: session1.account.id, from: null},
        event: "Created",
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session1.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session2.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await expect(
        addFeedAccountCandidateEntry(otherSession.action(), space.id, session1.account.id, {
            type: "Document",
            documentId: id3,
            sharerId: session1.account.id,
            sharedTime: new Date(),
            creator: {id: session1.account.id, from: null},
            event: "Created",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session1.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session2.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await expect(
        addFeedAccountCandidateEntry(otherSpace.systemAction(), space.id, session1.account.id, {
            type: "Document",
            documentId: id4,
            sharerId: session1.account.id,
            sharedTime: new Date(),
            creator: {id: session1.account.id, from: null},
            event: "Created",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session1.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session2.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedAccountCandidateEntry(space.systemAction(), space.id, session2.account.id, {
        type: "Document",
        documentId: id5,
        sharerId: session2.account.id,
        sharedTime: new Date(),
        creator: {id: session2.account.id, from: null},
        event: "Created",
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session1.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: id2,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id1,
                sharerId: session1.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session1.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session2.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: id5,
                sharerId: session2.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session2.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);
});

test("can\u2019t add feed account candidates for bot account", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const {id: botAccountId} = await bot.instantiate(adminSession);

    const id1 = generateId<DocumentId>();
    const id2 = generateId<DocumentId>();

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: botAccountId,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedAccountCandidateEntry(adminSession.action(), space.id, botAccountId, {
        type: "Document",
        documentId: id1,
        sharerId: adminSession.account.id,
        sharedTime: new Date(),
        creator: {id: adminSession.account.id, from: null},
        event: "Created",
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: botAccountId,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedAccountCandidateEntry(space.systemAction(), space.id, botAccountId, {
        type: "Document",
        documentId: id2,
        sharerId: botAccountId,
        sharedTime: new Date(),
        creator: {id: botAccountId, from: null},
        event: "Created",
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: botAccountId,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    await addFeedAccountCandidateEntry(
        space.impersonatedAction(botAccountId),
        space.id,
        botAccountId,
        {
            type: "Document",
            documentId: id2,
            sharerId: botAccountId,
            sharedTime: new Date(),
            creator: {id: botAccountId, from: null},
            event: "Created",
        },
    );

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: botAccountId,
            limit: 100,
        }),
    ).toEqual([]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);
});

test("add feed account candidate entry job processor is idempotent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const job1Id = generateId();
    const job2Id = generateId();
    const job3Id = generateId();
    const document1Id = generateId<DocumentId>();
    const document2Id = generateId<DocumentId>();
    const document3Id = generateId<DocumentId>();
    const document4Id = generateId<DocumentId>();

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([]);

    await processAddFeedAccountCandidateEntryJob(session.action(), {
        jobId: job1Id,
        spaceId: space.id,
        accountId: session.account.id,
        entry: {
            type: "Document",
            documentId: document1Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        },
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    await processAddFeedAccountCandidateEntryJob(session.action(), {
        jobId: job1Id,
        spaceId: space.id,
        accountId: session.account.id,
        entry: {
            type: "Document",
            documentId: document2Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        },
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    await processAddFeedAccountCandidateEntryJob(session.action(), {
        jobId: job2Id,
        spaceId: space.id,
        accountId: session.account.id,
        entry: {
            type: "Document",
            documentId: document3Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creator: {id: session.account.id, from: null},
            event: "Created",
        },
    });

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: document3Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);

    // Make sure we don't ignore non-idempotent parameter mismatch errors.
    await expect(
        processAddFeedAccountCandidateEntryJob(otherSession.action(), {
            jobId: job3Id,
            spaceId: space.id,
            accountId: session.account.id,
            entry: {
                type: "Document",
                documentId: document4Id,
                sharerId: session.account.id,
                sharedTime: new Date(),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        await getFeedAccountCandidateEntriesForTest(space.systemAction(), {
            accountId: session.account.id,
            limit: 100,
        }),
    ).toEqual([
        {
            index: 1,
            entry: {
                type: "Document",
                documentId: document3Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
        {
            index: 0,
            entry: {
                type: "Document",
                documentId: document1Id,
                sharerId: session.account.id,
                sharedTime: expect.any(Date),
                creator: {id: session.account.id, from: null},
                event: "Created",
            },
        },
    ]);
});

test("get and update feed gets new entries every call", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts1: Array<TestPost> = [];

    for (let i = 0; i < 125; i++) {
        posts1.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [12, 0],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    // Currently, we put entries initiated by a session in their own feed. Should we
    // change this to only show other people's stuff?
    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [12, 0],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    const posts2: Array<TestPost> = [];

    for (let i = 0; i < 125; i++) {
        posts2.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [25, 0],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts2)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [25, 0],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts2)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("can\u2019t get and update feed for bot account", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {id: botAccountId} = await bot.instantiate(session);

    const channel = await TestChannel.create(session);
    await ProcessContextModule.waitForTestTasks();

    const posts: Array<TestPost> = [];

    for (let i = 0; i < 10; i++) {
        posts.push(await channel.createPost(session));
        await ProcessContextModule.waitForTestTasks();
    }

    await expect(
        getAndUpdateFeedEntries(
            // @ts-expect-error
            space.impersonatedAction(botAccountId),
            {spaceId: space.id, limit: 500},
        ),
    ).rejects.toThrow("Bot account not allowed");
});

test("won\u2019t add entries to feed account doesn\u2019t have access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    await channel.access.grant(session1, session3);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    const post1 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    await channel.access.grantDefault(session3);
    const post2 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();
    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    await channel.access.revoke(session1, session1);
    await channel.access.grant(session2, session2);
    await channel.access.revokeDefault(session2);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    const post3 = await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post3.getRealtime()}),
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [3, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post3.getRealtime()}),
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    await channel.access.grant(session2, session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post3.getRealtime()}),
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [3, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post3.getRealtime()}),
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [2, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post3.getRealtime()}),
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [3, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post3.getRealtime()}),
            new FeedPostEntryModel({post: await post2.getRealtime()}),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session3.get(),
                sharedTime: expect.any(Date),
                event: "SharedWithAccessPolicyDefaultGrant",
            },
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("get and update limits the number of returned entries", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts1: Array<TestPost> = [];

    for (let i = 0; i < 125; i++) {
        posts1.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    // First run: Limiting newly created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 20}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [12, 0],
        endCursor: [11, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .slice(0, 20)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 20}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [12, 0],
        endCursor: [11, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .slice(0, 20)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 20})).toEqual({
        startCursor: [12, 0],
        endCursor: [11, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .slice(0, 20)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });
});

test("get and update limits the number of returned entries up until the second to last entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts1: Array<TestPost> = [];

    for (let i = 0; i < 10; i++) {
        posts1.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    // First run: Limiting newly created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [1, 0],
        endCursor: [1, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [1, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 10})).toEqual({
        startCursor: [1, 0],
        endCursor: [1, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });
});

test("get and update limits the number of returned entries up until the last entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts1: Array<TestPost> = [];

    for (let i = 0; i < 10; i++) {
        posts1.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    // First run: Limiting newly created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 12}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [1, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 12}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [1, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 12})).toEqual({
        startCursor: [1, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("get and update limits the number of returned entries up until the second to last entry (when each block only has a single entry)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts1: Array<TestPost> = [];

    for (let i = 0; i < 10; i++) {
        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500});
        posts1.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

    // First run: Limiting newly created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [10, 0],
        endCursor: [1, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [10, 0],
        endCursor: [1, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 10})).toEqual({
        startCursor: [10, 0],
        endCursor: [1, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts1)
                .reverse()
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });
});

test("get and update limits the number of returned entries up until the last entry (when each block only has a single entry)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts1: Array<TestPost> = [];

    for (let i = 0; i < 10; i++) {
        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500});
        posts1.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

    // First run: Limiting newly created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 12}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [10, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 12}),
    ).toEqual({
        wasFeedCreated: false,
        startCursor: [10, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 12})).toEqual({
        startCursor: [10, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts1)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });
});

test("can paginate through feed entries", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts: Array<TestPost> = [];

    for (let i = 0; i < 125; i++) {
        posts.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
    }

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 500})).toEqual({
        startCursor: null,
        endCursor: null,
        hasMoreEntries: false,
        entries: [],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        wasFeedCreated: true,
        startCursor: [12, 0],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(await getFeedEntries(session2.action(), {spaceId: space.id, limit: 500})).toEqual({
        startCursor: [12, 0],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            beforeCursor: [12, 0],
        }),
    ).toEqual({
        startCursor: null,
        endCursor: null,
        hasMoreEntries: false,
        entries: [],
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            afterCursor: [0, 6],
        }),
    ).toEqual({
        startCursor: null,
        endCursor: null,
        hasMoreEntries: false,
        entries: [],
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            beforeCursor: [5, 5],
        }),
    ).toEqual({
        startCursor: [12, 0],
        endCursor: [5, 4],
        hasMoreEntries: false,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 75)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            beforeCursor: [12, 5],
        }),
    ).toEqual({
        startCursor: [12, 0],
        endCursor: [12, 4],
        hasMoreEntries: false,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 5)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 10,
            beforeCursor: [5, 5],
        }),
    ).toEqual({
        startCursor: [12, 0],
        endCursor: [12, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 10)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 40,
            beforeCursor: [5, 5],
        }),
    ).toEqual({
        startCursor: [12, 0],
        endCursor: [9, 9],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 40)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            afterCursor: [5, 5],
        }),
    ).toEqual({
        startCursor: [5, 6],
        endCursor: [0, 6],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts)
                    .reverse()
                    .slice(76)
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 10,
            afterCursor: [8, 5],
        }),
    ).toEqual({
        startCursor: [8, 6],
        endCursor: [7, 5],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(46, 56)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 40,
            afterCursor: [8, 5],
        }),
    ).toEqual({
        startCursor: [8, 6],
        endCursor: [4, 5],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(46, 86)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            afterCursor: [8, 5],
            beforeCursor: [0, 2],
        }),
    ).toEqual({
        startCursor: [8, 6],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(46, 122)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });
});

test("can paginate through feed entries when each block only has a single entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    const posts: Array<TestPost> = [];

    for (let i = 0; i < 20; i++) {
        import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
        posts.push(await channel.createPost(session1));
        await ProcessContextModule.waitForTestTasks();
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500});
    }

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
        }),
    ).toEqual({
        startCursor: [19, 0],
        endCursor: [0, 2],
        hasMoreEntries: false,
        entries: [
            ...(await runAllPromises(
                Array.from(posts)
                    .reverse()
                    .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
            )),
            {
                type: "Channel",
                channel: expect.objectContaining({
                    id: channel.id,
                    name: channel.initialName,
                }),
                sharer: await session1.get(),
                sharedTime: expect.any(Date),
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
                emailDomainWithAutoAddAccountsEnabled: null,
            },
        ],
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 500,
            beforeCursor: [4, 0],
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [5, 0],
        hasMoreEntries: false,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 15)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 6,
            beforeCursor: [4, 0],
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [5, 0],
        hasMoreEntries: false,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 15)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 5,
            beforeCursor: [4, 0],
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [5, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 15)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 4,
            beforeCursor: [4, 0],
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [6, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 14)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 3,
            beforeCursor: [4, 0],
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [7, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 13)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 5,
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [5, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 15)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 4,
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [6, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 14)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 3,
            afterCursor: [10, 0],
        }),
    ).toEqual({
        startCursor: [9, 0],
        endCursor: [7, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(10, 13)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 5,
            beforeCursor: [4, 0],
        }),
    ).toEqual({
        startCursor: [19, 0],
        endCursor: [15, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 5)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 4,
            beforeCursor: [4, 0],
        }),
    ).toEqual({
        startCursor: [19, 0],
        endCursor: [16, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 4)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });

    expect(
        await getFeedEntries(session2.action(), {
            spaceId: space.id,
            limit: 3,
            beforeCursor: [4, 0],
        }),
    ).toEqual({
        startCursor: [19, 0],
        endCursor: [17, 0],
        hasMoreEntries: true,
        entries: await runAllPromises(
            Array.from(posts)
                .reverse()
                .slice(0, 3)
                .map(async post => new FeedPostEntryModel({post: await post.getRealtime()})),
        ),
    });
});

test("posts from high-affinity accounts appear before posts from low-affinity accounts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Add affinity points for session2's account (high affinity) from session3's
    // perspective.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session3.account.id,
        entityId: `Account:${session2.account.id}`,
        points: 1000,
    });

    // Create posts: session1 posts first (older), then session2 posts (newer). Without
    // ranking, the feed would show session2's post first (chronological). With
    // ranking, session2's post should still be first (high affinity + newer).
    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post1 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post2 = await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 10});

    // Post from high-affinity account (session2) should be first.
    expect(result.entries[0]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post2.id})}),
    });
    expect(result.entries[1]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post1.id})}),
    });
});

test("posts from high-affinity accounts appear before posts from low-affinity accounts (reverse)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Add affinity points for session2's account (high affinity) from session3's
    // perspective.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session3.account.id,
        entityId: `Account:${session2.account.id}`,
        points: 1000,
    });

    // Create posts: session1 posts first (older), then session2 posts (newer). Without
    // ranking, the feed would show session2's post first (chronological). With
    // ranking, session2's post should still be first (high affinity + newer).
    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post1 = await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post2 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 10});

    // Post from high-affinity account (session2) should be first.
    expect(result.entries[0]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post1.id})}),
    });
    expect(result.entries[1]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post2.id})}),
    });
});

test("posts in high-affinity channels appear before posts in low-affinity channels", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel1 = await TestChannel.create(session1);
    const channel2 = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Add channel affinity points for channel1 (space-level affinity). Note: Channel
    // affinity is space-level, not account-level, so any account viewing high-activity
    // content from that channel increases its ranking.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session2.account.id,
        entityId: `Channel:${channel1.id}`,
        points: 1000,
    });

    // Create posts: first in channel2 (older, low affinity), then channel1 (newer,
    // high affinity).
    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post1 = await channel2.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post2 = await channel1.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10});

    // Post from high-affinity channel should be first.
    expect(result.entries[0]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post2.id})}),
    });
    expect(result.entries[1]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post1.id})}),
    });
});

test("posts in high-affinity channels appear before posts in low-affinity channels (reverse)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel1 = await TestChannel.create(session1);
    const channel2 = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Add channel affinity points for channel1 (space-level affinity). Note: Channel
    // affinity is space-level, not account-level, so any account viewing high-activity
    // content from that channel increases its ranking.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session2.account.id,
        entityId: `Channel:${channel1.id}`,
        points: 1000,
    });

    // Create posts: first in channel2 (older, low affinity), then channel1 (newer,
    // high affinity).
    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post1 = await channel1.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post2 = await channel2.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10});

    // Post from high-affinity channel should be first.
    expect(result.entries[0]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post1.id})}),
    });
    expect(result.entries[1]).toMatchObject({
        type: "Post",
        post: expect.objectContaining({model: expect.objectContaining({id: post2.id})}),
    });
});

test("diversity: avoids consecutive posts from the same author", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Give both session1 and session2 some affinity so their posts are ranked, but
    // give session1 higher affinity so their posts would normally cluster.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session3.account.id,
        entityId: `Account:${session1.account.id}`,
        points: 1000,
    });
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session3.account.id,
        entityId: `Account:${session2.account.id}`,
        points: 500,
    });

    // Create interleaved posts: session1, session2, session1, session2.
    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 10});

    // Find the post entries.
    const postEntries = result.entries.filter(entry => entry.type === "Post");

    // Check that no two consecutive posts are from the same author.
    for (let i = 0; i < postEntries.length - 1; i++) {
        const currentAuthor = postEntries[i]!.post.model.author.id;
        const nextAuthor = postEntries[i + 1]!.post.model.author.id;
        expect(currentAuthor).not.toEqual(nextAuthor);
    }
});

test("diversity: avoids consecutive posts in the same channel", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel1 = await TestChannel.create(session1);
    const channel2 = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Give channel1 higher affinity so its posts would normally cluster.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session3.account.id,
        entityId: `Channel:${channel1.id}`,
        points: 1000,
    });
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session3.account.id,
        entityId: `Channel:${channel2.id}`,
        points: 500,
    });

    // Create posts from different authors in different channels to test channel
    // diversity (not just author diversity).
    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel1.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel2.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel1.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel2.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 10});

    // Find the post entries.
    const postEntries = result.entries.filter(entry => entry.type === "Post");

    // Check that no two consecutive posts are in the same channel.
    for (let i = 0; i < postEntries.length - 1; i++) {
        const currentChannel = postEntries[i]!.post.model.channel.id;
        const nextChannel = postEntries[i + 1]!.post.model.channel.id;
        expect(currentChannel).not.toEqual(nextChannel);
    }
});

test("diversity: falls back when only one author", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Create multiple posts from the same author.
    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10});

    // All posts should still appear even though they're from the same author.
    const postEntries = result.entries.filter(entry => entry.type === "Post");
    expect(postEntries).toHaveLength(3);
});

test("zero-affinity entries use chronological order as tiebreaker", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Create posts without any affinity data. They should appear in chronological
    // order (newest first).
    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post1 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post2 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    const post3 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10});

    // Find the post entries (they should be in chronological order, newest first).
    const postEntries = result.entries.filter(entry => entry.type === "Post");

    expect(postEntries[0]!.post.model.id).toEqual(post3.id);
    expect(postEntries[1]!.post.model.id).toEqual(post2.id);
    expect(postEntries[2]!.post.model.id).toEqual(post1.id);
});

test("welcome entry always appears at the end of the feed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await ProcessContextModule.waitForTestTasks();

    // Add high affinity for channel posts.
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session2.account.id,
        entityId: `Channel:${channel.id}`,
        points: 10000,
    });

    // Create some posts.
    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60);
    await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    const result = await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 10});

    // Welcome entry should be at the very end.
    const lastEntry = result.entries[result.entries.length - 1];
    expect(lastEntry).toMatchObject({
        type: "Welcome",
        addedTime: expect.any(Date),
    });
});
