import {ServerContentSystemActionContext} from "~/server/context/server_content_action_context.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {FileAuthorizer} from "~/server/files/data/files_table.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {opensearchClientExecuteOperationTestCounter} from "~/server/opensearch/opensearch_client.js";
import {
    getSearchMentionEntityIfPossible,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityJob,
} from "~/server/search/data/index/search_entity_index.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {emptyContentReferencedIds} from "~/shared/content/content_referenced_ids.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {contextCacheMissTestCounter} from "~/shared/context/cache_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageReferencedIds, MessageReferences} from "~/shared/messaging/message_references.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {runAllTimersAndWaitForTestTasks} from "~/shared/test_helpers/run_all_timers_and_wait_for_test_tasks.js";

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

const context = createTestContext({
    shouldStartOpensearch: true,
    getSearchEntityIfPossible: async (context, spaceId, entityId) => {
        return getSearchMentionEntityIfPossible(
            // @ts-expect-error
            context,
            spaceId,
            entityId,
        );
    },
    processJob: async (actionContext, job, jobStartTime, span) => {
        switch (job.type) {
            case "IndexSearchEntity": {
                await processIndexSearchEntityJob(actionContext, job, jobStartTime, span);
                break;
            }
            case "IndexSearchEntityDependents": {
                await processIndexSearchEntityDependentsJob(actionContext, job);
                break;
            }
            default: {
                // Ignore all other jobs...
                break;
            }
        }
    },
});

// NOTE(calebmer, 2025-07-23): When I wrote this file it was testing
// `server/messaging/helpers/get_message_references_for_multiple_accounts.ts`.
// It manually batched message reference loading for
// `MessagingRealtimeConnection`. But instead of manually batching, I decided
// to do automatic RPC batching in `WorkerRpcContextModule` which meant we
// could avoid a system context privilege escalation which makes the code
// much nicer.
//
// So now instead we export
// `server/messaging/helpers/get_message_references.ts`. But we're keeping this
// test as-is since it still covers some useful behavior. Mainly around caching
// when we request data from multiple independent actors in the same action.
async function getMessageReferencesForMultipleAccounts(
    context: ServerContentSystemActionContext,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    referencedIds: MessageReferencedIds,
    accountIds: ReadonlySet<AccountId>,
): Promise<Map<AccountId, Result<MessageReferences>>> {
    const spaceId = context.actor.getSpaceId();

    const referencesByAccountId = await runAllPromises(
        mapIterable(
            accountIds,
            async (accountId): Promise<[AccountId, Result<MessageReferences>]> => {
                const referencesResult = await captureResultPromise(
                    impersonateAccountAsSystemContext(context, accountId, async context => {
                        return getMessageReferences(
                            context,
                            spaceId,
                            fileAuthorizer,
                            referencedIds,
                        );
                    }),
                );

                return [accountId, referencesResult];
            },
        ),
    );

    return new Map(referencesByAccountId);
}

test("only loads an account from DynamoDB once no matter how many accounts we’re loading for", async () => {
    const space = await TestSpace.create(context);
    const sessions = await space.createSessions(50);

    const {getCount: getContextCacheMissCount} = contextCacheMissTestCounter.recordAllForTest();
    const {getCount: getDynamoExecuteActionCount} =
        dynamoClientExecuteActionTestCounter.recordAllForTest();
    const {getCount: getOpensearchExecuteOperationCount} =
        opensearchClientExecuteOperationTestCounter.recordAllForTest();

    const referencedIds: MessageReferencedIds = {
        authorId: sessions[46].account.id,
        contentReferencedIds: {
            ...emptyContentReferencedIds,
            accountIds: new Set([
                sessions[47].account.id,
                sessions[48].account.id,
                sessions[49].account.id,
            ]),
        },
        fileIds: new Set(),
    };

    const expectedReferences: MessageReferences = {
        author: await sessions[46].get(),
        contentReferences: {
            ...emptyContentReferences,
            accountById: new Map(
                await runAllPromises([
                    sessions[47].get(),
                    sessions[48].get(),
                    sessions[49].get(),
                ]).then(sessions => sessions.map(account => [account.id, account])),
            ),
        },
        fileById: new Map(),
    };

    await ProcessContextModule.waitForTestTasks();

    for (const accountCount of [1, 2, 3, 25, 50]) {
        contextCacheMissTestCounter.resetForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();
        opensearchClientExecuteOperationTestCounter.resetForTest();

        expect(
            await getMessageReferencesForMultipleAccounts(
                space.systemAction(),
                "AssertHasNoFiles",
                referencedIds,
                new Set(sessions.slice(0, accountCount).map(session => session.account.id)),
            ),
        ).toEqual(
            new Map(
                sessions
                    .slice(0, accountCount)
                    .map(session => [session.account.id, {ok: true, value: expectedReferences}]),
            ),
        );

        expect(getContextCacheMissCount()).toEqual(
            accountCount >= 50 ? accountCount + 4 : accountCount + 8,
        );
        expect(getDynamoExecuteActionCount()).toEqual(2);
        expect(getOpensearchExecuteOperationCount()).toEqual(0);
    }
});

test("only loads a file from DynamoDB once no matter how many accounts we’re loading for", async () => {
    const space = await TestSpace.create(context);
    const sessions = await space.createSessions(50);

    const {getCount: getContextCacheMissCount} = contextCacheMissTestCounter.recordAllForTest();
    const {getCount: getDynamoExecuteActionCount} =
        dynamoClientExecuteActionTestCounter.recordAllForTest();
    const {getCount: getOpensearchExecuteOperationCount} =
        opensearchClientExecuteOperationTestCounter.recordAllForTest();

    const [file1, file2, file3] = await runAllPromises([
        TestFile.create(sessions[49]),
        TestFile.create(sessions[49]),
        TestFile.create(sessions[49]),
    ]);

    const document = await TestDocument.create(sessions[49], {access: "Public"});

    await document.attachFile(sessions[49], file1);
    await document.attachFile(sessions[49], file2);
    await document.attachFile(sessions[49], file3);

    const referencedIds: MessageReferencedIds = {
        authorId: sessions[46].account.id,
        contentReferencedIds: emptyContentReferencedIds,
        fileIds: new Set([file1.id, file2.id, file3.id]),
    };

    const expectedReferences: MessageReferences = {
        author: await sessions[46].get(),
        contentReferences: emptyContentReferences,
        fileById: new Map(
            await runAllPromises([file1.get(), file2.get(), file3.get()]).then(files =>
                files.map(file => [
                    file.id,
                    {type: "File", signedUrlSearch: expect.any(String), file},
                ]),
            ),
        ),
    };

    await ProcessContextModule.waitForTestTasks();

    for (const accountCount of [1, 2, 3, 25, 50]) {
        contextCacheMissTestCounter.resetForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();
        opensearchClientExecuteOperationTestCounter.resetForTest();

        expect(
            await getMessageReferencesForMultipleAccounts(
                space.systemAction(),
                FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
                referencedIds,
                new Set(sessions.slice(0, accountCount).map(session => session.account.id)),
            ),
        ).toEqual(
            new Map(
                sessions
                    .slice(0, accountCount)
                    .map(session => [session.account.id, {ok: true, value: expectedReferences}]),
            ),
        );

        expect(getContextCacheMissCount()).toEqual(
            accountCount >= 50 ? accountCount + 5 : accountCount + 6,
        );
        expect(getDynamoExecuteActionCount()).toEqual(2);
        expect(getOpensearchExecuteOperationCount()).toEqual(0);
    }
});

test("only loads a search entity from DynamoDB once no matter how many accounts we’re loading for", async () => {
    const space = await TestSpace.create(context);
    const sessions = await space.createSessions(50);

    const {getCount: getContextCacheMissCount} = contextCacheMissTestCounter.recordAllForTest();
    const {getCount: getDynamoExecuteActionCount} =
        dynamoClientExecuteActionTestCounter.recordAllForTest();
    const {getCount: getOpensearchExecuteOperationCount} =
        opensearchClientExecuteOperationTestCounter.recordAllForTest();

    const channel = await TestChannel.create(sessions[49], {
        name: "Test Channel",
        access: "Public",
    });
    const post = await channel.createPost(sessions[49], "Test Post");

    const collection = await TestTaskCollection.create(sessions[49], {
        name: "Test Task Collection",
        access: "Public",
    });
    const task = await TestTask.create(sessions[49], {title: "Test Task"});
    await task.addCollection(sessions[49], collection);

    await runAllTimersAndWaitForTestTasks();

    const referencedIds: MessageReferencedIds = {
        authorId: sessions[46].account.id,
        contentReferencedIds: {
            ...emptyContentReferencedIds,
            searchEntityIds: new Set<SearchMentionEntityId>([
                `Channel:${channel.id}`,
                `Post:${post.id}`,
                `TaskCollection:${collection.id}`,
                `Task:${task.id}`,
            ]),
        },
        fileIds: new Set(),
    };

    const expectedReferences: MessageReferences = {
        author: await sessions[46].get(),
        contentReferences: {
            ...emptyContentReferences,
            searchEntityById: new Map<
                SearchMentionEntityId,
                {isPrivate: false; entity: SearchEntityModel}
            >([
                [
                    `Channel:${channel.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `Channel:${channel.id}`,
                            title: "Test Channel",
                            titleVersion: expect.any(Object),
                            media: null,
                        }),
                    },
                ],
                [
                    `Post:${post.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `Post:${post.id}`,
                            title: "in Test Channel: Test Post",
                            titleVersion: expect.any(Object),
                            media: {
                                type: "Account",
                                account: await sessions[49].get(),
                            },
                        }),
                    },
                ],
                [
                    `TaskCollection:${collection.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `TaskCollection:${collection.id}`,
                            title: "Test Task Collection",
                            titleVersion: expect.any(Object),
                            media: {
                                type: "TaskCollectionColor",
                                color: null,
                                version: expect.any(Array),
                            },
                        }),
                    },
                ],
                [
                    `Task:${task.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `Task:${task.id}`,
                            title: "Test Task",
                            titleVersion: expect.any(Object),
                            media: {
                                type: "TaskDisplayStatus",
                                displayStatus: "OpenInactive",
                                version: expect.any(Array),
                            },
                        }),
                    },
                ],
            ]),
        },
        fileById: new Map(),
    };

    await ProcessContextModule.waitForTestTasks();

    for (const accountCount of [1, 2, 3, 25, 50]) {
        contextCacheMissTestCounter.resetForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();
        opensearchClientExecuteOperationTestCounter.resetForTest();

        expect(
            await getMessageReferencesForMultipleAccounts(
                space.systemAction(),
                "AssertHasNoFiles",
                referencedIds,
                new Set(sessions.slice(0, accountCount).map(session => session.account.id)),
            ),
        ).toEqual(
            new Map(
                sessions
                    .slice(0, accountCount)
                    .map(session => [session.account.id, {ok: true, value: expectedReferences}]),
            ),
        );

        expect(getContextCacheMissCount()).toEqual(
            accountCount >= 50 ? accountCount + 6 : accountCount + 8,
        );
        expect(getDynamoExecuteActionCount()).toEqual(3);
        expect(getOpensearchExecuteOperationCount()).toEqual(1);
    }
});

test("only loads a search entity from DynamoDB once no matter how many accounts we’re loading for but may return a private entity if account doesn’t have access", async () => {
    const space = await TestSpace.create(context);
    const sessions = await space.createSessions(50);

    const {getCount: getContextCacheMissCount} = contextCacheMissTestCounter.recordAllForTest();
    const {getCount: getDynamoExecuteActionCount} =
        dynamoClientExecuteActionTestCounter.recordAllForTest();
    const {getCount: getOpensearchExecuteOperationCount} =
        opensearchClientExecuteOperationTestCounter.recordAllForTest();

    const channel = await TestChannel.create(sessions[49], {
        name: "Test Channel",
        access: "Private",
    });
    const post = await channel.createPost(sessions[49], "Test Post");

    await channel.access.grantAccounts(
        sessions[49],
        sessions.filter((session, i) => i % 2 === 0),
    );

    const collection = await TestTaskCollection.create(sessions[49], {
        name: "Test Task Collection",
        access: "Private",
    });
    const task = await TestTask.create(sessions[49], {title: "Test Task"});
    await task.addCollection(sessions[49], collection);

    await collection.access.grantAccounts(
        sessions[49],
        sessions.filter((session, i) => i % 3 === 0),
    );

    await runAllTimersAndWaitForTestTasks();

    const referencedIds: MessageReferencedIds = {
        authorId: sessions[46].account.id,
        contentReferencedIds: {
            ...emptyContentReferencedIds,
            searchEntityIds: new Set<SearchMentionEntityId>([
                `Channel:${channel.id}`,
                `Post:${post.id}`,
                `TaskCollection:${collection.id}`,
                `Task:${task.id}`,
            ]),
        },
        fileIds: new Set(),
    };

    const expectedReferences: MessageReferences = {
        author: await sessions[46].get(),
        contentReferences: {
            ...emptyContentReferences,
            searchEntityById: new Map<
                SearchMentionEntityId,
                {isPrivate: false; entity: SearchEntityModel}
            >([
                [
                    `Channel:${channel.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `Channel:${channel.id}`,
                            title: "Test Channel",
                            titleVersion: expect.any(Object),
                            media: null,
                        }),
                    },
                ],
                [
                    `Post:${post.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `Post:${post.id}`,
                            title: "in Test Channel: Test Post",
                            titleVersion: expect.any(Object),
                            media: {
                                type: "Account",
                                account: await sessions[49].get(),
                            },
                        }),
                    },
                ],
                [
                    `TaskCollection:${collection.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `TaskCollection:${collection.id}`,
                            title: "Test Task Collection",
                            titleVersion: expect.any(Object),
                            media: {
                                type: "TaskCollectionColor",
                                color: null,
                                version: expect.any(Array),
                            },
                        }),
                    },
                ],
                [
                    `Task:${task.id}`,
                    {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: `Task:${task.id}`,
                            title: "Test Task",
                            titleVersion: expect.any(Object),
                            media: {
                                type: "TaskDisplayStatus",
                                displayStatus: "OpenInactive",
                                version: expect.any(Array),
                            },
                        }),
                    },
                ],
            ]),
        },
        fileById: new Map(),
    };

    await ProcessContextModule.waitForTestTasks();

    for (const accountCount of [1, 2, 3, 25, 50]) {
        contextCacheMissTestCounter.resetForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();
        opensearchClientExecuteOperationTestCounter.resetForTest();

        expect(
            await getMessageReferencesForMultipleAccounts(
                space.systemAction(),
                "AssertHasNoFiles",
                referencedIds,
                new Set(sessions.slice(0, accountCount).map(session => session.account.id)),
            ),
        ).toEqual(
            new Map(
                sessions.slice(0, accountCount).map((session, i) => [
                    session.account.id,
                    {
                        ok: true,
                        value: {
                            ...expectedReferences,
                            contentReferences: {
                                ...expectedReferences.contentReferences,
                                searchEntityById: new Map<
                                    SearchMentionEntityId,
                                    | {isPrivate: false; entity: SearchEntityModel}
                                    | {isPrivate: true}
                                >([
                                    ...expectedReferences.contentReferences.searchEntityById,
                                    ...(i % 2 !== 0 && i !== 49
                                        ? ([
                                              [`Channel:${channel.id}`, {isPrivate: true}],
                                              [`Post:${post.id}`, {isPrivate: true}],
                                          ] as const)
                                        : []),
                                    ...(i % 3 !== 0 && i !== 49
                                        ? ([
                                              [
                                                  `TaskCollection:${collection.id}`,
                                                  {isPrivate: true},
                                              ],
                                              [`Task:${task.id}`, {isPrivate: true}],
                                          ] as const)
                                        : []),
                                ]),
                            },
                        },
                    },
                ]),
            ),
        );

        expect(getContextCacheMissCount()).toEqual(
            accountCount >= 50 ? accountCount + 6 : accountCount + 8,
        );
        expect(getDynamoExecuteActionCount()).toEqual(3);
        expect(getOpensearchExecuteOperationCount()).toEqual(1);
    }
});

test("can have one account fail to load data while other accounts successfully load data", async () => {
    const space = await TestSpace.create(context);
    const sessions = await space.createSessions(50);

    const {getCount: getContextCacheMissCount} = contextCacheMissTestCounter.recordAllForTest();
    const {getCount: getDynamoExecuteActionCount} =
        dynamoClientExecuteActionTestCounter.recordAllForTest();
    const {getCount: getOpensearchExecuteOperationCount} =
        opensearchClientExecuteOperationTestCounter.recordAllForTest();

    const [file1, file2, file3] = await runAllPromises([
        TestFile.create(sessions[49]),
        TestFile.create(sessions[49]),
        TestFile.create(sessions[49]),
    ]);

    const document = await TestDocument.create(sessions[49], {access: "Private"});

    await document.access.grantAccounts(
        sessions[49],
        sessions.filter((session, i) => i % 2 === 0),
    );

    await document.attachFile(sessions[49], file1);
    await document.attachFile(sessions[49], file2);
    await document.attachFile(sessions[49], file3);

    const referencedIds: MessageReferencedIds = {
        authorId: sessions[46].account.id,
        contentReferencedIds: emptyContentReferencedIds,
        fileIds: new Set([file1.id, file2.id, file3.id]),
    };

    const expectedReferences: MessageReferences = {
        author: await sessions[46].get(),
        contentReferences: emptyContentReferences,
        fileById: new Map(
            await runAllPromises([file1.get(), file2.get(), file3.get()]).then(files =>
                files.map(file => [
                    file.id,
                    {type: "File", signedUrlSearch: expect.any(String), file},
                ]),
            ),
        ),
    };

    await ProcessContextModule.waitForTestTasks();

    for (const accountCount of [1, 2, 3, 25, 50]) {
        contextCacheMissTestCounter.resetForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();
        opensearchClientExecuteOperationTestCounter.resetForTest();

        expect(
            await getMessageReferencesForMultipleAccounts(
                space.systemAction(),
                FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
                referencedIds,
                new Set(sessions.slice(0, accountCount).map(session => session.account.id)),
            ),
        ).toEqual(
            new Map(
                sessions.slice(0, accountCount).map((session, i) => [
                    session.account.id,
                    i % 2 === 0 || i === 49
                        ? {ok: true, value: expectedReferences}
                        : {
                              ok: false,
                              error: expect.objectContaining({
                                  message:
                                      "Actor doesn’t have `View` access level to document (and 2 other errors)",
                              }),
                          },
                ]),
            ),
        );

        expect(getContextCacheMissCount()).toEqual(
            accountCount >= 50 ? accountCount + 5 : accountCount + 6,
        );
        expect(getDynamoExecuteActionCount()).toEqual(2);
        expect(getOpensearchExecuteOperationCount()).toEqual(0);
    }
});
