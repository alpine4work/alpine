import {createBotForTest} from "~/server/bots/bots_table.js";
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
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/spaces_table.js";
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

// Increase test timeout since some of these tests can take a while to setup
// (e.g. they need to create hundreds of posts).
import.meta.jest.setTimeout(1000 * 30);

import.meta.jest.useFakeTimers();

enableMockFileTaskCollectionEntityModelForTest();

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

// This is unrelated to our feed tests but we want a sanity check in at least
// one test file to make sure our Jest internals hack in `createTestContext()`
// works and the timeout we set at the top of this file isn't lowered to 10s.
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

test("private channels don’t add feed candidates until made public", async () => {
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

test("making a document public adds a feed candidate entry fifteen minutes later", async () => {
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

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
                event: "SharedWithAccessPolicyDefaultGrant",
            },
        },
    ]);
});

test("making a public document adds a feed candidate entry fifteen minutes later", async () => {
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
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);
});

test("private task collections don’t add feed candidates until made public fifteen minutes later", async () => {
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

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
    await ProcessContextModule.waitForTestTasks();

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 7);
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

test("private task collections don’t add feed candidates until made public immediately if there are many tasks", async () => {
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    await channel.access.grantDefault(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    await document.access.grantDefault(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    await collection.access.grantDefault(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
                event: "Created",
            },
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });
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
        creatorId: session.account.id,
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
                creatorId: session.account.id,
                event: "Created",
            },
        },
    ]);

    await addFeedCandidateEntry(space.systemAction(), space.id, {
        type: "Document",
        documentId: id2,
        sharerId: session.account.id,
        sharedTime: new Date(),
        creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
            creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
            creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
            creatorId: session.account.id,
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

    await processAddFeedCandidateEntryJob(session.action(), {
        jobId: job1Id,
        spaceId: space.id,
        entry: {
            type: "Document",
            documentId: document2Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creatorId: session.account.id,
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

    await processAddFeedCandidateEntryJob(session.action(), {
        jobId: job2Id,
        spaceId: space.id,
        entry: {
            type: "Document",
            documentId: document3Id,
            sharerId: session.account.id,
            sharedTime: new Date(),
            creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
        creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
        creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
            creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
            creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
        creatorId: session2.account.id,
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
                creatorId: session1.account.id,
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
                creatorId: session1.account.id,
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
                creatorId: session2.account.id,
                event: "Created",
            },
        },
    ]);

    expect(await getFeedCandidateEntriesForTest(space.systemAction(), {limit: 100})).toEqual([]);
});

test("can’t add feed account candidates for bot account", async () => {
    const bot = await createBotForTest(context, {
        name: "Test Bot",
        webhookUrl: "https://bot.test.cyberworlds.dev/webhook",
    });

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const {accountId: botAccountId} = await instantiateBotSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

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
        creatorId: adminSession.account.id,
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
        creatorId: botAccountId,
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
            creatorId: botAccountId,
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
            creatorId: session.account.id,
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
                creatorId: session.account.id,
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
            creatorId: session.account.id,
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
                creatorId: session.account.id,
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
            creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
                creatorId: session.account.id,
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
            },
        ],
    });

    // Currently, we put entries initiated by a session in their own feed. Should
    // we change this to only show other people's stuff?
    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });
});

test("can’t get and update feed for bot account", async () => {
    const bot = await createBotForTest(context, {
        name: "Test Bot",
        webhookUrl: "https://bot.test.cyberworlds.dev/webhook",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {accountId: botAccountId} = await instantiateBotSpaceAccount(session.action(), {
        spaceId: space.id,
        botId: bot.id,
    });

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

test("won’t add entries to feed account doesn’t have access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    await channel.access.grant(session1, session3);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    const post1 = await channel.createPost(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [0, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [1, 0],
        endCursor: [0, 0],
        hasMoreEntries: false,
        entries: [
            new FeedPostEntryModel({post: await post1.getRealtime()}),
            {
                type: "Welcome",
                addedTime: expect.any(Date),
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    const post3 = await channel.createPost(session2);
    await ProcessContextModule.waitForTestTasks();

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
        startCursor: [2, 0],
        endCursor: [0, 1],
        hasMoreEntries: false,
        entries: [
            {
                type: "Welcome",
                addedTime: expect.any(Date),
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    await channel.access.grant(session2, session1);
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    import.meta.jest.advanceTimersByTime(1000 * 60 * 5);

    expect(
        await getAndUpdateFeedEntries(session1.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    expect(
        await getAndUpdateFeedEntries(session3.action(), {spaceId: space.id, limit: 500}),
    ).toEqual({
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
            },
        ],
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 12}),
    ).toEqual({
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
            },
        ],
    });

    // Second run: Limiting previously created entries.
    expect(
        await getAndUpdateFeedEntries(session2.action(), {spaceId: space.id, limit: 12}),
    ).toEqual({
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
