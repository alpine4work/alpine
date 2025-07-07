import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    archiveInboxEntry,
    getInboxEntries,
    getInboxEntry,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/notifications_table.js";
import {
    createNotificationsScenario,
    massageInboxEntriesQuery,
} from "~/server/notifications/data/test_helpers/notifications_table_test_helpers.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {InboxTaskEntryModel} from "~/shared/notifications/inbox_model.js";

let processingType: "Once" | "TwiceSerially" | "ThriceConcurrently" = "Once";

afterEach(() => {
    processingType = "Once";
});

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            switch (processingType) {
                case "Once": {
                    await processNotificationEvent(context, job.event, span);
                    break;
                }
                case "TwiceSerially": {
                    await processNotificationEvent(context, job.event, span);
                    await processNotificationEvent(context, job.event, span);
                    break;
                }
                case "ThriceConcurrently": {
                    await runAllPromises([
                        processNotificationEvent(context, job.event, span),
                        processNotificationEvent(context, job.event, span),
                        processNotificationEvent(context, job.event, span),
                    ]);
                    break;
                }
                default:
                    throw exhaustive(processingType);
            }
        } else {
            // Noop for other jobs...
        }
    },
});

// Exercise idempotency by running the test suite again with jobs
// processed twice.
for (const [currentProcessingType, processingMultiple] of [
    ["Once", 1],
    ["TwiceSerially", 2],
    ["ThriceConcurrently", 3],
] as const) {
    describe(`processing: ${currentProcessingType}`, () => {
        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("commenting creates an inbox entry for all subscribers", async () => {
            const scenario = await createNotificationsScenario(context);

            const {getCount: getCount1} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session1.account.id,
            );
            const {getCount: getCount2} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session2.account.id,
            );
            const {getCount: getCount3} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session3.account.id,
            );

            const task = await TestTask.create(scenario.session1);

            const collection = await TestTaskCollection.create(scenario.session1);

            await collection.access.set(scenario.session1, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.session1.account.id, {level: "Manage", generation: 0}],
                    [scenario.session2.account.id, {level: "Edit"}],
                    [scenario.session3.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await task.addCollection(scenario.session1, collection);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await task.createComment(scenario.session2, "initial task comment from session 2");

            await task.createComment(scenario.session3, "initial task comment from session 3");

            const taskCommentFromSession1 = await task.createComment(
                scenario.session1,
                "task comment from session 1",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: taskCommentFromSession1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "task comment from session 1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            const taskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: taskCommentFromSession2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: taskCommentFromSession2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);

            const taskCommentFromSession3 = await task.createComment(
                scenario.session3,
                "task comment from session 3",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: taskCommentFromSession3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "task comment from session 3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: taskCommentFromSession3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "task comment from session 3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            // Make sure multiple processing is working
            expect(getCount1()).toEqual(1 * processingMultiple);
            expect(getCount2()).toEqual(2 * processingMultiple);
            expect(getCount3()).toEqual(2 * processingMultiple);
        });

        test("can get individual inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);
            const task = await TestTask.create(scenario.session1);

            const collection = await TestTaskCollection.create(scenario.session1);

            await collection.access.set(scenario.session1, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.session1.account.id, {level: "Manage", generation: 0}],
                    [scenario.session2.account.id, {level: "Edit"}],
                    [scenario.session3.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await task.addCollection(scenario.session1, collection);

            await task.createComment(scenario.session3, "task comment from session 3");

            await ProcessContextModule.waitForTestTasks();

            const taskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    key: {type: "Task", taskId: task.id},
                }),
            ).resolves.toEqual({
                key: expect.any(String),
                version: expect.any(Number),
                model: new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: taskCommentFromSession2.createdTime,
                        contentTextSnippet: "task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            });

            const taskCommentFromSession1 = await task.createComment(
                scenario.session1,
                "task comment from session 1",
            );

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(context.action(scenario.otherSession), {
                    spaceId: scenario.space.id,
                    key: {type: "Task", taskId: task.id},
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expect(
                getInboxEntry(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    key: {type: "Task", taskId: task.id},
                }),
            ).resolves.toEqual({
                key: expect.any(String),
                version: expect.any(Number),
                model: new InboxTaskEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: taskCommentFromSession2.createdTime,
                        contentTextSnippet: "task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            });

            await expect(
                getInboxEntry(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    key: {type: "Task", taskId: task.id},
                }),
            ).resolves.toEqual({
                key: expect.any(String),
                version: expect.any(Number),
                model: new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: taskCommentFromSession1.createdTime,
                        contentTextSnippet: "task comment from session 1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            });

            await expect(
                getInboxEntry(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    key: {type: "Task", taskId: task.id},
                }),
            ).resolves.toEqual({
                key: expect.any(String),
                version: expect.any(Number),
                model: new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: taskCommentFromSession1.createdTime,
                        contentTextSnippet: "task comment from session 1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            });
        });

        // For this test we have session 2 make a task comment mentioning session 3. Session 1 will
        // get a notification since they created the task, and Session 3 will receive a loud
        // notification despite not being a subscriber.
        //
        // Then Session 1 will make a task comment mentioning Session 2, so Session 2 will receive
        // a loud notification, however Session 3 will now receive notifications for that task,
        // because mentioning a Session in a task subscribes them to that task.
        test("mentioning someone in a task comment a creates a loud notification for them whether or not they are a subscriber", async () => {
            const scenario = await createNotificationsScenario(context);

            const task = await TestTask.create(scenario.session1);

            const collection = await TestTaskCollection.create(scenario.session1);

            await collection.access.set(scenario.session1, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.session1.account.id, {level: "Manage", generation: 0}],
                    [scenario.session2.account.id, {level: "Edit"}],
                    [scenario.session3.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await task.addCollection(scenario.session1, collection);

            const taskCommentFromSession2 = await task.createComment(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: taskCommentFromSession2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 1,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: taskCommentFromSession2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Task", taskId: task.id},
                },
            );

            const taskCommentFromSession1 = await task.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 1,
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: taskCommentFromSession1.createdTime,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: taskCommentFromSession1.createdTime,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);
        });

        test("mentioning yourself does not create a loud notification for yourself", async () => {
            const scenario = await createNotificationsScenario(context);

            const task = await TestTask.create(scenario.session1);

            const collection = await TestTaskCollection.create(scenario.session1);

            await collection.access.set(scenario.session1, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.session1.account.id, {level: "Manage", generation: 0}],
                    [scenario.session2.account.id, {level: "Edit"}],
                    [scenario.session3.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await task.addCollection(scenario.session1, collection);

            await task.createComment(scenario.session3, "task comment from session 3");

            const firstTaskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "1st task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: firstTaskCommentFromSession2.createdTime,
                        contentTextSnippet: "1st task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: firstTaskCommentFromSession2.createdTime,
                        contentTextSnippet: "1st task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const loudTaskCommentFromSession2 = await task.createComment(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: loudTaskCommentFromSession2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: loudTaskCommentFromSession2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const secondTaskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "2nd task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: secondTaskCommentFromSession2.createdTime,
                        contentTextSnippet: "2nd task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: secondTaskCommentFromSession2.createdTime,
                        contentTextSnippet: "2nd task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        // In this test Session 1 and OtherSession are the task creators in different spaces.
        // SharedSession makes task comments subscribing to both Session 1 and OtherSession
        // task's in different spaces.
        //
        // Session 2 comments on Session 1's task in the first space, therefore SharedSession should
        // receive a notification about Session 2's comment on Session 1's task. While OtherSession
        // does not receive a notification from Session 2's comment.
        //
        // When OtherSession comments on their own task, SharedSession receives a notification
        // in OtherSpace regarding that comment, however SharedSession doesn't receive the new notification
        // in Session 1's space.
        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsScenario(context);

            const taskInSession = await TestTask.create(scenario.session1);
            const taskInOtherSession = await TestTask.create(scenario.otherSession);

            await ProcessContextModule.waitForTestTasks();

            const collectionInSession1 = await TestTaskCollection.create(scenario.session1);
            const collectionInOtherSession = await TestTaskCollection.create(scenario.otherSession);

            await collectionInSession1.access.set(scenario.session1, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.session1.account.id, {level: "Manage", generation: 0}],
                    [scenario.session2.account.id, {level: "Edit"}],
                    [scenario.sharedSession.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await collectionInOtherSession.access.set(scenario.otherSession, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.otherSession.account.id, {level: "Manage", generation: 0}],
                    [scenario.sharedSession.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await ProcessContextModule.waitForTestTasks();

            await taskInSession.addCollection(scenario.session1, collectionInSession1);
            await taskInOtherSession.addCollection(scenario.otherSession, collectionInOtherSession);

            await taskInSession.createComment(
                scenario.sharedSession,
                "task comment from shared session",
            );

            await ProcessContextModule.waitForTestTasks();

            const taskCommentFromSharedSessionInOtherSession =
                await taskInOtherSession.createComment(
                    scenario.sharedSession,
                    "task comment from shared session in other session",
                );

            const firstTaskCommentFromSession2 = await taskInSession.createComment(
                scenario.session2,
                "1st task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    task: {
                        isPrivate: false,
                        taskId: taskInSession.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: firstTaskCommentFromSession2.createdTime,
                        contentTextSnippet: "1st task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.otherSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.otherSession.account.id,
                    task: {
                        isPrivate: false,
                        taskId: taskInOtherSession.id,
                        taskOwner: await scenario.otherSession.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.sharedSessionInOtherSpace.get(),
                        createdTime: taskCommentFromSharedSessionInOtherSession.createdTime,
                        contentTextSnippet: "task comment from shared session in other session",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const taskCommentFromOtherSession = await taskInOtherSession.createComment(
                scenario.otherSession,
                "task comment from other session",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    task: {
                        isPrivate: false,
                        taskId: taskInSession.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: firstTaskCommentFromSession2.createdTime,
                        contentTextSnippet: "1st task comment from session 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    task: {
                        isPrivate: false,
                        taskId: taskInOtherSession.id,
                        taskOwner: await scenario.otherSession.get(),
                    },
                    loudNotificationCount: 0,
                    latestComment: {
                        author: await scenario.otherSession.get(),
                        createdTime: taskCommentFromOtherSession.createdTime,
                        contentTextSnippet: "task comment from other session",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        // Session 3 is subscribed to Session 1's task comment, however Session 3 is not part of
        // the OtherSession's space therefore receiving a `PermissionDeniedError`.
        //
        // Now Session 2 mentiones Session 3 in a task comment in Space 1, therefore Session 3 receives
        // one loud notification. However, when OtherSession in the OtherSpace mentiones session 3,
        // Session 3 will not receive another loud notification since Session 3 is not part of
        // the OtherSpace. So Session 3 will only have 1 loud notification count.
        test("account can not see mention in a different space", async () => {
            const scenario = await createNotificationsScenario(context);

            const taskInSession = await TestTask.create(scenario.session1);
            const taskInOtherSession = await TestTask.create(scenario.otherSession);

            await ProcessContextModule.waitForTestTasks();

            const collectionInSession1 = await TestTaskCollection.create(scenario.session1);
            const collectionInOtherSession = await TestTaskCollection.create(scenario.otherSession);

            await collectionInSession1.access.set(scenario.session1, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.session1.account.id, {level: "Manage", generation: 0}],
                    [scenario.session2.account.id, {level: "Edit"}],
                    [scenario.session3.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await collectionInOtherSession.access.set(scenario.otherSession, {
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    [scenario.otherSession.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            await taskInSession.addCollection(scenario.session1, collectionInSession1);
            await taskInOtherSession.addCollection(scenario.otherSession, collectionInOtherSession);

            await taskInSession.createComment(scenario.session3, "1st task comment from session 3");

            const loudTaskCommentFromSession2 = await taskInSession.createComment(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: taskInSession.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 1,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: loudTaskCommentFromSession2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await expect(
                getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).rejects.toThrow(PermissionDeniedError);

            await taskInOtherSession.createComment(
                scenario.otherSession,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    task: {
                        isPrivate: false,
                        taskId: taskInSession.id,
                        taskOwner: await scenario.session1.get(),
                    },
                    loudNotificationCount: 1,
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: loudTaskCommentFromSession2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await expect(
                getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("hides task when account loses access to task they have inbox entry for", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session1);
            await task.updateAssignee(session1, session2);

            const comment = await task.createComment(session1, "foo");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await session2.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "foo",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, null);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: true,
                        taskId: task.id,
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("hides task when account loses access to task they have inbox entry for (and the entry contains a mention)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session1);
            await task.updateAssignee(session1, session2);

            const comment = await task.createComment(
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", null, [
                        MessageContentProsemirrorSchema.node("paragraph", null, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await session2.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 1,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, null);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: true,
                        taskId: task.id,
                    },
                    isArchived: false,
                    loudNotificationCount: 1,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "",
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("won’t send new notifications for account that loses access to task", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session1);
            await task.updateAssignee(session1, session2);

            // Subscribe `session2` to the task's comments.
            await task.createComment(session2);

            const comment1 = await task.createComment(session1, "foo");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await session2.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "foo",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, null);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: true,
                        taskId: task.id,
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.createComment(session1, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: true,
                        taskId: task.id,
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, session2);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await session2.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "foo",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await task.createComment(session1, "qux");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await session2.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "qux",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("won’t get a notification for a mention if the account doesn’t have access to task", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session1);

            await task.createComment(
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", null, [
                        MessageContentProsemirrorSchema.node("paragraph", null, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await task.updateAssignee(session1, session2);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment2 = await task.createComment(session1, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxTaskEntryModel({
                    spaceId: space.id,
                    accountId: session2.account.id,
                    task: {
                        isPrivate: false,
                        taskId: task.id,
                        taskOwner: await session2.get(),
                    },
                    isArchived: false,
                    loudNotificationCount: 0,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "bar",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });
    });
}
