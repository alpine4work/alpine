import {Fragment, Slice} from "prosemirror-model";
import {DocAttrStep, ReplaceStep} from "prosemirror-transform";
import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestTaskContextModule} from "~/server/context/task_context_module_base.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {updateChannelName} from "~/server/forum/data/update_channel_name.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    getSearchEntityIndexesForTest,
    getSearchMentionEntityIfPossible,
    processIndexSearchEntityDependentsJob,
    processIndexSearchEntityEmbeddingChunksJob,
    processIndexSearchEntityJob,
} from "~/server/search/data/index/search_entity_index.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {MessageContentProsemirrorSchema as messageSchema} from "~/shared/content/message_content_schema.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    createSimplePostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {generateId} from "~/shared/id/id.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {SearchMentionEntityId, SearchMentionEntityType} from "~/shared/search/search_entity_id.js";
import {
    TaskTitleModel,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";
import {runAllTimersAndWaitForTestTasks} from "~/shared/test_helpers/run_all_timers_and_wait_for_test_tasks.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

const context = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
    searchInjection: {
        getSearchMentionEntityIfPossible: async (context, spaceId, entityId) => {
            const newContext = context.clone({
                tasks: new TestTaskContextModule({
                    dangerouslyEscalateToSystemContext: testContext.escalateToSystemContext,
                    // Always return null for any `getTaskWithoutDependenciesIfPossible()` calls or
                    // `getCollectionIfPossible()` calls made by
                    // `fallbackGetSearchEntityBaseIfPossible()` instead of throwing.
                    alwaysNotFound: true,
                }),
            });

            return await getSearchMentionEntityIfPossible(newContext, spaceId, entityId);
        },
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
            case "IndexSearchEntityEmbeddingChunks": {
                await processIndexSearchEntityEmbeddingChunksJob(actionContext, job, span);
                break;
            }
            default: {
                // Ignore all other jobs...
                break;
            }
        }
    },
});

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

// Important that this goes after `createTestContext()` which will register
// `afterEach` hooks that clean up some timers (specifically `TestLocalJobSender`
// which cleans up any delayed jobs).
afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

const testContext = context;

const testCaseByEntityType: Record<
    SearchMentionEntityType,
    {
        create: (options: {
            session: TestSpaceSession;
            title: string;
            access: "Public" | "Private" | CreateOrUpdateAccessPolicy;
        }) => Promise<{
            id: SearchMentionEntityId;
            prefix?: string;
            access: TestAccessPolicy;
            updateTitle: (title: string) => Promise<void>;
            delete: (() => Promise<void>) | "Unimplemented";
            undelete: (() => Promise<void>) | "Unimplemented";
        }>;
    }
> = {
    Document: {
        create: async ({session, title, access}) => {
            const document = await TestDocument.create(session, {title, access});

            return {
                id: `Document:${document.id}`,
                access: document.access,
                updateTitle: async title => {
                    const oldTitle = getDocumentContentTitle((await document.get()).content.doc);

                    await document.update(session, [
                        new ReplaceStep(
                            1,
                            1 + oldTitle.length,
                            new Slice(
                                Fragment.from(DocumentContentProsemirrorSchema.text(title)),
                                0,
                                0,
                            ),
                        ),
                    ]);
                },
                delete: async () => {
                    const deletedTime = new Date();
                    await document.update(session, [new DocAttrStep("deletedTime", deletedTime)], {
                        intentionallyUpdateDeletedTime: {deletedTime},
                    });
                },
                undelete: "Unimplemented",
            };
        },
    },
    Channel: {
        create: async ({session, title, access}) => {
            const channel = await TestChannel.create(session, {name: title, access});

            return {
                id: `Channel:${channel.id}`,
                access: channel.access,
                updateTitle: async title => {
                    await updateChannelName(session.action(), {
                        channelId: channel.id,
                        name: title,
                    });
                },
                // TODO: Implement this once channels can be deleted.
                delete: "Unimplemented",
                undelete: "Unimplemented",
            };
        },
    },
    Chat: {
        create: async ({session, title, access}) => {
            const chat = await TestChat.createRoom(session, {name: title, access});

            return {
                id: `Chat:${chat.id}`,
                access: chat.roomAccess,
                updateTitle: async title => {
                    await chat.updateRoomName(session, title);
                },
                delete: "Unimplemented",
                undelete: "Unimplemented",
            };
        },
    },
    Task: {
        create: async ({session, title, access}) => {
            const collection = await TestTaskCollection.create(session, {access});

            const task = await TestTask.create(session, {title});
            await task.addCollection(session, collection);

            return {
                id: `Task:${task.id}`,
                access: collection.access,
                updateTitle: async title => {
                    const oldTitle = new TaskTitleModel((await task.getIndexDoc()).title.raw);

                    await task.updateTitle(
                        session,
                        oldTitle.replace(
                            randomlyGenerateTaskTitleClientId(),
                            0,
                            oldTitle.getText().length,
                            title,
                        ).raw,
                    );
                },
                delete: async () => {
                    await task.delete(session);
                },
                undelete: async () => {
                    await task.undelete(session);
                },
            };
        },
    },
    TaskCollection: {
        create: async ({session, title, access}) => {
            const collection = await TestTaskCollection.create(session, {name: title, access});

            return {
                id: `TaskCollection:${collection.id}`,
                access: collection.access,
                updateTitle: async title => {
                    await collection.updateName(session, title);
                },
                delete: async () => {
                    await collection.delete(session);
                },
                undelete: async () => {
                    await collection.undelete(session);
                },
            };
        },
    },
    Post: {
        create: async ({session, title, access}) => {
            const channel = await TestChannel.create(session, {access});

            const post = await channel.createPost(session, title);

            const authorShortName = getAccountShortNameWithoutFullNameTooltip(
                (await session.account.get()).initialData,
            );

            return {
                id: `Post:${post.id}`,
                prefix: `${authorShortName} in ${channel.initialName}: `,
                access: channel.access,
                updateTitle: async title => {
                    await post.updateContent(session, {
                        content: createSimplePostContent(title),
                    });
                },
                // TODO: Implement this once posts can be deleted.
                delete: "Unimplemented",
                undelete: "Unimplemented",
            };
        },
    },
    Site: {
        create: async ({session, title, access}) => {
            if (access !== "Public" && access !== "Private" && access.type === "Site") {
                throw new InvalidArgumentError("Site access policy must be a local access policy");
            }

            const site = await TestSite.create(session, {name: title, access});

            return {
                id: `Site:${site.id}`,
                access: site.access,
                updateTitle: async title => {
                    await site.updateName(session, title);
                },
                // TODO: Implement this once sites can be deleted.
                delete: "Unimplemented",
                undelete: "Unimplemented",
            };
        },
    },
};

for (const [entityType, testCase] of getObjectEntriesWithKeyofType(testCaseByEntityType)) {
    describe(`${entityType}`, () => {
        test("can mention non-existent entity in public entity", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const channel = await TestChannel.create(session, {access: "Public"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `${entityType}:${generateId()}` as any,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Unknown ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention non-existent entity in private entity (1 account grant)", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const channel = await TestChannel.create(session, {access: "Private"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `${entityType}:${generateId()}` as any,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Unknown ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention public entity in public entity", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Public",
            });

            const channel = await TestChannel.create(session2, {access: "Public"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention private entity (1 account grant) in public entity", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Private",
            });

            const channel = await TestChannel.create(session2, {access: "Public"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention public entity in private entity (1 account grant)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Public",
            });

            const channel = await TestChannel.create(session2, {access: "Private"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention private entity (1 account grant) in private entity (1 account grant)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Private",
            });

            const channel = await TestChannel.create(session2, {access: "Private"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention private entity (2 account grants) in public entity", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: "Public",
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention public entity in private entity (2 account grants)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Public",
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention private entity (2 account grants) in private entity (2 account grants)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention private entity (2 account grants) in private entity (3 account grants)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                        [session3.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention private entity (3 account grants) in private entity (2 account grants)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "View", generation: 1}],
                        [session3.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention private entity (3 account grants) in private entity (3 account grants)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "View", generation: 1}],
                        [session3.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                        [session3.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention private entity (3 account grants) in private entity (3 account grants, partially distinct)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "View", generation: 1}],
                        [session3.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                        [session4.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention private entity (2 account grants) in private entity (2 account grants, fully distinct)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session3.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session4.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can mention public entity (2 manage account grants) in private entity (3 account grants)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "Manage", generation: 1}],
                    ]),
                    defaultGrant: {level: "View"},
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                        [session3.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention public entity (2 manage account grants) in private entity (2 account grants, fully distinct)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session3.account.id, {level: "Manage", generation: 1}],
                    ]),
                    defaultGrant: {level: "View"},
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session4.account.id, {level: "View", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can mention public entity (3 manage account grants) in private entity (3 account grants, partially distinct)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                        [session2.account.id, {level: "Manage", generation: 1}],
                        [session3.account.id, {level: "Manage", generation: 2}],
                    ]),
                    defaultGrant: {level: "View"},
                    urlGrant: null,
                },
            });

            const channel = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "View", generation: 1}],
                        [session4.account.id, {level: "View", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can change originally public mentioned entity access", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Public",
            });

            const channel1 = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "Manage", generation: 1}],
                        [session3.account.id, {level: "Manage", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel2 = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "Manage", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel3 = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel4 = await TestChannel.create(session1, {
                access: "Private",
            });

            const channel5 = await TestChannel.create(session2, {
                access: "Public",
            });

            const post1 = await channel1.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post2 = await channel2.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post3 = await channel3.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post4 = await channel4.createPost(
                session1,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post5 = await channel5.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            await entity.access.revokeDefault(session1);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.grant(session1, session2);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.grant(session1, session3);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.revoke(session1, session2);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.grantDefault(session1);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can change originally private mentioned entity access", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Private",
            });

            const channel1 = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "Manage", generation: 1}],
                        [session3.account.id, {level: "Manage", generation: 2}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel2 = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                        [session1.account.id, {level: "Manage", generation: 1}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel3 = await TestChannel.create(session2, {
                access: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session2.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            });

            const channel4 = await TestChannel.create(session1, {
                access: "Private",
            });

            const channel5 = await TestChannel.create(session2, {
                access: "Public",
            });

            const post1 = await channel1.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post2 = await channel2.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post3 = await channel3.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post4 = await channel4.createPost(
                session1,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post5 = await channel5.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.grant(session1, session2);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.grant(session1, session3);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.revoke(session1, session3);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            await entity.access.grantDefault(session1);

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post3.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post3.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel3.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post4.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post4.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel4.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post5.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post5.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel5.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });

        test("can change the entity title", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Public",
            });

            const channel = await TestChannel.create(session2, {access: "Public"});

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            const post = await channel.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            await entity.updateTitle("Dolor Sit Amet");

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${entity.prefix ?? ""}Dolor Sit Amet.`,
                    ],
                },
            });

            await entity.updateTitle("Consectetur Adipiscing Elit");

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel.initialName}:\n\nMention: ${
                            entity.prefix ?? ""
                        }Consectetur Adipiscing Elit.`,
                    ],
                },
            });
        });

        test("can delete private entity", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Private",
            });

            const channel1 = await TestChannel.create(session1, {access: "Private"});
            const channel2 = await TestChannel.create(session2, {access: "Public"});

            const post1 = await channel1.createPost(
                session1,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post2 = await channel2.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            if (entity.delete === "Unimplemented") return;
            await entity.delete();

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Deleted ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            if (entity.undelete === "Unimplemented") return;
            await entity.undelete();

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Private ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });
        });

        test("can delete public entity", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const entity = await testCase.create({
                session: session1,
                title: "Lorem Ipsum",
                access: "Public",
            });

            const channel1 = await TestChannel.create(session1, {access: "Private"});
            const channel2 = await TestChannel.create(session2, {access: "Public"});

            const post1 = await channel1.createPost(
                session1,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            const post2 = await channel2.createPost(
                session2,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Mention: "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: entity.id,
                            }),
                        }),
                        schema.text("."),
                    ]),
                ]),
            );

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            if (entity.delete === "Unimplemented") return;
            await entity.delete();

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: Deleted ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: Deleted ${getSearchEntityNoun(
                            entityType,
                        )}.`,
                    ],
                },
            });

            if (entity.undelete === "Unimplemented") return;
            await entity.undelete();

            await runAllTimersAndWaitForTestTasks();
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post1.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post1.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel1.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });

            expect(
                await context.opensearch.getDocWithoutSourceIfExists(
                    SearchEntityKeywordIndex,
                    space.id,
                    `Post:${post2.id}`,
                    {storedFields: ["body"]},
                ),
            ).toEqual({
                id: `Post:${post2.id}`,
                routing: space.id,
                version: expect.any(Object),
                fields: {
                    body: [
                        `in ${channel2.initialName}:\n\nMention: ${entity.prefix ?? ""}Lorem Ipsum.`,
                    ],
                },
            });
        });
    });
}

test("can mention direct chat in a private entity", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alpha"});
    const session2 = await space.createSession({name: "Bravo"});
    const session3 = await space.createSession({name: "Charlie"});

    const chat = await TestChat.get(session1, session2, session3);
    const channel = await TestChannel.create(session1, {access: "Private"});

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const post = await channel.createPost(
        session1,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Mention: "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Chat:${chat.id}`,
                    }),
                }),
                schema.text("."),
            ]),
        ]),
    );

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [expect.stringMatching(/^in .*:\n\nMention: .*, and 1 other\.$/)],
        },
    });
});

test("deleted document mention in a chat message", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

    const document = await TestDocument.create(session1, {title: "Secret Plans"});
    await document.access.grantDefault(session1);

    const chat = await TestChat.createRoom(session1, {name: "General"});

    await chat.sendMessage(
        session1,
        messageSchema.node("doc", {}, [
            messageSchema.node("paragraph", {}, [
                messageSchema.text("See "),
                messageSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document.id}`,
                    }),
                }),
                messageSchema.text(" for details."),
            ]),
        ]),
    );

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-0`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-0`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [`See Secret Plans for details.`],
        },
    });

    // Delete the document.
    await document.delete(session1);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // The chat message should now show "Deleted document" instead of the title.
    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `ChatMessage:${chat.id}-0`,
            {storedFields: ["body"]},
        ),
    ).toEqual({
        id: `ChatMessage:${chat.id}-0`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            body: [`See Deleted document for details.`],
        },
    });
});

test("deleted document mention in a post title", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "Important Doc"});
    await document.access.grantDefault(session);

    const channel = await TestChannel.create(session, {
        name: "Updates",
        access: "Public",
    });

    // Create a post where the mention is in the first line (the title).
    const post = await channel.createPost(
        session,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Review "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${document.id}`,
                    }),
                }),
                schema.text(" today"),
            ]),
        ]),
    );

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title", "body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: [`in Updates: Review Important Doc today`],
            body: [`in Updates:\n\nReview Important Doc today`],
        },
    });

    // Delete the mentioned document.
    await document.delete(session);

    await runAllTimersAndWaitForTestTasks();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Both the title and body should now show "Deleted document".
    expect(
        await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            space.id,
            `Post:${post.id}`,
            {storedFields: ["title", "body"]},
        ),
    ).toEqual({
        id: `Post:${post.id}`,
        routing: space.id,
        version: expect.any(Object),
        fields: {
            title: [`in Updates: Review Deleted document today`],
            body: [`in Updates:\n\nReview Deleted document today`],
        },
    });
});
