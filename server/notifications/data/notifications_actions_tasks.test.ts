import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestPushContextModules} from "~/server/dynamo/test_helpers/create_test_push_context_modules.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {updateInboxEntryAfterExecuteTransactionTestCheckpoint} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/process/process_notification_event.js";
import {createNotificationsTestScenario} from "~/server/notifications/data/test_helpers/create_notifications_test_scenario.js";
import {expectInboxTaskEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_task_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxEntry} from "~/server/notifications/data/unarchive_inbox_entry.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {AccountId} from "~/shared/id/types/id_types.js";

type ProcessingType = "Once" | "TwiceSerially" | "ThriceConcurrently";

let processingType: ProcessingType = "Once";

const testSuites: Array<{
    type: ProcessingType;
    processingMultiple: number;
    only?: CommitBlocker;
}> = [
    {type: "Once", processingMultiple: 1},
    {type: "TwiceSerially", processingMultiple: 2},
    {type: "ThriceConcurrently", processingMultiple: 3},
];

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
    notificationsInjection,
});

// Exercise idempotency by running the test suite again with jobs processed twice.
for (const {type: currentProcessingType, processingMultiple} of testSuites) {
    // If another suite has `only` set then skip this suite so we only run the suite
    // with `only` set.
    if (
        testSuites.some(testSuite => !!testSuite.only && testSuite.type !== currentProcessingType)
    ) {
        continue;
    }

    describe(`processing: ${currentProcessingType}`, () => {
        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("commenting creates an inbox entry for all subscribers", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await task.createComment(scenario.session2, "initial task comment from session 2");

            await task.createComment(scenario.session3, "initial task comment from session 3");

            const taskCommentFromSession1 = await task.createComment(
                scenario.session1,
                "task comment from session 1",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session2,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession1,
                        contentTextSnippet: "task comment from session 1",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            const taskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession2,
                        contentTextSnippet: "task comment from session 2",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession2,
                        contentTextSnippet: "task comment from session 2",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);

            const taskCommentFromSession3 = await task.createComment(
                scenario.session3,
                "task comment from session 3",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession3,
                        contentTextSnippet: "task comment from session 3",
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session2,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession3,
                        contentTextSnippet: "task comment from session 3",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            // Make sure multiple processing is working
            expect(getCount1()).toEqual(1 * processingMultiple);
            expect(getCount2()).toEqual(2 * processingMultiple);
            expect(getCount3()).toEqual(2 * processingMultiple);
        });

        test("can get individual inbox entries", async () => {
            const scenario = await createNotificationsTestScenario(context);
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
                model: expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession2,
                        contentTextSnippet: "task comment from session 2",
                    },
                    otherCommentAuthor: scenario.session3,
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
                model: expectInboxTaskEntryModel({
                    isArchived: true,
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession2,
                        contentTextSnippet: "task comment from session 2",
                    },
                    otherCommentAuthor: scenario.session3,
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
                model: expectInboxTaskEntryModel({
                    session: scenario.session2,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession1,
                        contentTextSnippet: "task comment from session 1",
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
                model: expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession1,
                        contentTextSnippet: "task comment from session 1",
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            });
        });

        // For this test we have session 2 make a task comment mentioning session 3.
        // Session 1 will get a notification since they created the task, and Session 3
        // will receive a loud notification despite not being a subscriber.
        //
        // Then Session 1 will make a task comment mentioning Session 2, so Session 2 will
        // receive a loud notification, however Session 3 will now receive notifications
        // for that task, because mentioning a Session in a task subscribes them to that
        // task.
        test("mentioning someone in a task comment a creates a loud notification for them whether or not they are a subscriber", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: taskCommentFromSession2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone(createTestPushContextModules()),
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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session2,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: taskCommentFromSession1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSession1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            ]);
        });

        test("mentioning yourself does not create a loud notification for yourself", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            const firstTaskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "1st task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: firstTaskCommentFromSession2,
                        contentTextSnippet: "1st task comment from session 2",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: firstTaskCommentFromSession2,
                        contentTextSnippet: "1st task comment from session 2",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const loudTaskCommentFromSession2 = await task.createComment(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: loudTaskCommentFromSession2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: loudTaskCommentFromSession2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const secondTaskCommentFromSession2 = await task.createComment(
                scenario.session2,
                "2nd task comment from session 2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session1,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: secondTaskCommentFromSession2,
                        contentTextSnippet: "2nd task comment from session 2",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: secondTaskCommentFromSession2,
                        contentTextSnippet: "2nd task comment from session 2",
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        // In this test Session 1 and OtherSession are the task creators in different
        // spaces. SharedSession makes task comments subscribing to both Session 1 and
        // OtherSession task's in different spaces.
        //
        // Session 2 comments on Session 1's task in the first space, therefore
        // SharedSession should receive a notification about Session 2's comment on Session
        // 1's task. While OtherSession does not receive a notification from Session 2's
        // comment.
        //
        // When OtherSession comments on their own task, SharedSession receives a
        // notification in OtherSpace regarding that comment, however SharedSession doesn't
        // receive the new notification in Session 1's space.
        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.sharedSession,
                    task: {task: taskInSession, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: firstTaskCommentFromSession2,
                        contentTextSnippet: "1st task comment from session 2",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.otherSession)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.otherSession,
                    task: {task: taskInOtherSession, taskOwner: scenario.otherSession},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromSharedSessionInOtherSession,
                        contentTextSnippet: "task comment from shared session in other session",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const taskCommentFromOtherSession = await taskInOtherSession.createComment(
                scenario.otherSession,
                "task comment from other session",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.sharedSession,
                    task: {task: taskInSession, taskOwner: scenario.session1},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: firstTaskCommentFromSession2,
                        contentTextSnippet: "1st task comment from session 2",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await testGetInboxEntries(scenario.sharedSession, {space: scenario.otherSpace}),
            ).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.sharedSession,
                    task: {task: taskInOtherSession, taskOwner: scenario.otherSession},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: taskCommentFromOtherSession,
                        contentTextSnippet: "task comment from other session",
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        // Session 3 is subscribed to Session 1's task comment, however Session 3 is not
        // part of the OtherSession's space therefore receiving a `PermissionDeniedError`.
        //
        // Now Session 2 mentiones Session 3 in a task comment in Space 1, therefore
        // Session 3 receives one loud notification. However, when OtherSession in the
        // OtherSpace mentiones session 3, Session 3 will not receive another loud
        // notification since Session 3 is not part of the OtherSpace. So Session 3 will
        // only have 1 loud notification count.
        test("account can not see mention in a different space", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task: taskInSession, taskOwner: scenario.session1},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: loudTaskCommentFromSession2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);

            await taskInOtherSession.createComment(
                scenario.otherSession,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxTaskEntryModel({
                    session: scenario.session3,
                    task: {task: taskInSession, taskOwner: scenario.session1},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: loudTaskCommentFromSession2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("hides task when account loses access to task they have inbox entry for", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session1);
            await task.updateAssignee(session1, session2);

            const comment = await task.createComment(session1, "foo");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {task, taskOwner: session2},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment,
                        contentTextSnippet: "foo",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, null);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {isPrivate: true, taskId: task.id},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment,
                        contentTextSnippet: "",
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {task, taskOwner: session2},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, null);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {isPrivate: true, taskId: task.id},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment,
                        contentTextSnippet: "",
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("won\u2019t send new notifications for account that loses access to task", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session1);
            await task.updateAssignee(session1, session2);

            // Subscribe `session2` to the task's comments.
            await task.createComment(session2);

            const comment1 = await task.createComment(session1, "foo");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {task, taskOwner: session2},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "foo",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, null);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {isPrivate: true, taskId: task.id},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.createComment(session1, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {isPrivate: true, taskId: task.id},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await task.updateAssignee(session1, session2);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {task, taskOwner: session2},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "foo",
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await task.createComment(session1, "qux");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {task, taskOwner: session2},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "qux",
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("won\u2019t get a notification for a mention if the account doesn\u2019t have access to task", async () => {
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

            expect(await testGetInboxEntries(session2)).toEqual([]);

            await task.updateAssignee(session1, session2);

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const comment2 = await task.createComment(session1, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    session: session2,
                    task: {task, taskOwner: session2},
                    loudNotificationCount: 0,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "bar",
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("setting a reaction on a task comment archives the task comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            const comment1 = await task.createComment(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);
        });

        test("setting a reaction on a task comment that\u2019s not the latest comment archives the task comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            const comment1 = await task.createComment(session1, "test1");
            await task.createComment(session1, "test2");
            const comment3 = await task.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest task comment archives the task comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            await task.createComment(session1, "test1");
            await task.createComment(session1, "test2");
            const comment3 = await task.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest task comment, explicitly unarchiving, then setting a reaction on a different task comment archives the task comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            const comment1 = await task.createComment(session1, "test1");
            await task.createComment(session1, "test2");
            const comment3 = await task.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "Task",
                    taskId: task.id,
                },
            });

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest task comment, implicitly unarchiving, then setting a reaction on a different task comment archives the task comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            const comment1 = await task.createComment(session1, "test1");
            await task.createComment(session1, "test2");
            const comment3 = await task.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await task.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest task comment, implicitly unarchiving, then setting a reaction on the latest task comment archives the task comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            await task.createComment(session1, "test1");
            await task.createComment(session1, "test2");
            const comment3 = await task.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await task.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment4.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("clears `isStickyMention` when archiving by reacting to a task comment", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            const comment1 = await task.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        schema.text("!"),
                    ]),
                ]),
            );
            await task.createComment(session1, "test2");
            const comment3 = await task.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxTaskEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("process setting task comment reaction before task comment notification event", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const task = await TestTask.create(session2);
            const collection = await TestTaskCollection.create(session2, {access: "Public"});
            await task.addCollection(session2, collection);

            const comment1 = await task.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        schema.text("!"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const comment2 = await task.createComment(session3, "test2");

            const {unpause: unpause1} = await pause1Promise;

            await comment2.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxTaskEntryModel({
                    isArchived: true,
                    session: session2,
                    task: {task, taskOwner: session2},
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });
    });
}
