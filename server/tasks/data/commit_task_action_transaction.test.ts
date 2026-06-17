import {addDays} from "date-fns";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {authorizeTaskAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_access_if_possible.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {commitTaskActionTransactionBeforeExecuteTestCheckpoint} from "~/server/tasks/data/commit_task_action_transaction_before_execute_test_checkpoint.js";
import {deleteTaskAndAllChildren} from "~/server/tasks/data/delete_task_and_all_children.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getTaskCollectionItemForTest} from "~/server/tasks/data/test_helpers/get_task_collection_item_for_test.js";
import {getTaskItemForTest} from "~/server/tasks/data/test_helpers/get_task_item_for_test.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    ContentEditorClientId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotesContentProsemirrorSchema as schema} from "~/shared/tasks/task_notes_content_schema.js";
import {
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

let jobs: Array<JobDescription> = [];

afterEach(() => {
    jobs = [];
});

const context = createTestContext({
    spacesInjection,
    tasksInjection,
    processJob: async (context, job) => {
        jobs.push(job);
    },
});

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

describe("commitTaskActionTransaction()", () => {
    test("can\u2019t update task in a deleted public collection", async () => {
        const space = await TestSpace.create(context);

        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        const task = await TestTask.create(session1);

        await expect(task.updatePriority(session2, "High")).rejects.toThrow(PermissionDeniedError);

        await task.addCollection(session1, collection);

        await task.updatePriority(session2, "High");

        await collection.delete(session1);

        await expect(task.updatePriority(session2, "Medium")).rejects.toThrow(
            PermissionDeniedError,
        );

        await collection.undelete(session1);

        await task.updatePriority(session2, "Medium");
    });

    test("can\u2019t add task to a deleted public collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const collection = await TestTaskCollection.create(session);
        await collection.access.grantDefault(session);
        const [task1, task2, task3] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
        ]);

        await task1.addCollection(session, collection);

        await collection.delete(session);

        await expect(task2.addCollection(session, collection)).rejects.toThrow(NotFoundError);

        await collection.undelete(session);

        await task3.addCollection(session, collection);
    });

    test("can\u2019t remove task from a deleted public collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const collection = await TestTaskCollection.create(session);
        await collection.access.grantDefault(session);
        const task = await TestTask.create(session);

        await task.addCollection(session, collection);

        await collection.delete(session);

        await expect(task.removeCollection(session, collection)).rejects.toThrow(NotFoundError);

        await collection.undelete(session);

        await task.removeCollection(session, collection);
    });

    test("can\u2019t update collection name in a deleted public collection", async () => {
        const space = await TestSpace.create(context);

        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);

        await collection.updateName(session2, "Test 1");

        await collection.delete(session1);

        await expect(collection.updateName(session2, "Test 2")).rejects.toThrow(
            "Task collection was deleted",
        );

        await collection.undelete(session1);

        await collection.updateName(session2, "Test 2");
    });

    test("collection manager can update the collection defaults", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const collection = await TestTaskCollection.create(session);

        await collection.updateDefaults(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
                },
            ],
            sorts: [{type: "DueDate", direction: "Ascending"}],
        });

        const collectionItem = await collection.getItem();
        expect(collectionItem.defaults.value).toEqual({
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
                },
            ],
            sorts: [{type: "DueDate", direction: "Ascending"}],
        });
    });

    test("can\u2019t update the collection defaults without collection manage access", async () => {
        const space = await TestSpace.create(context);

        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1, "Edit");

        await expect(
            collection.updateDefaults(session2, {
                filters: [
                    {
                        type: "DisplayStatus",
                        operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
                    },
                ],
                sorts: [],
            }),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access level");
    });

    test("task assignee can update the task", async () => {
        const space = await TestSpace.create(context);

        const [session1, session2] = await runAllPromises([
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(session1);

        await expect(task.updatePriority(session2, "High")).rejects.toThrow(PermissionDeniedError);

        await task.updateAssignee(session1, session2);

        await task.updatePriority(session2, "High");

        await task.updateAssignee(session1, null);

        await expect(task.updatePriority(session2, "Medium")).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("can\u2019t set task as own parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        await expect(task.updateParentTask(session, task)).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("correctly updates collection task counts on collection for any task action", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task1, task2, task3, task4, collection1, collection2] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
        ]);

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time1 = testTaskClock.now();
        await task1.addCollection(session, collection1, {time: time1});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time2 = testTaskClock.now();
        await task2.addCollection(session, collection2, {time: time2});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time2,
            }),
        );

        const time3 = testTaskClock.now();
        await task3.addCollection(session, collection2, {time: time3});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 2,
                lastTaskAddedTime: time3,
            }),
        );

        await task4.updateStatus(session, "Closed");

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 2,
                lastTaskAddedTime: time3,
            }),
        );

        const time4 = testTaskClock.now();
        await task4.addCollection(session, collection1, {time: time4});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time4,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 2,
                lastTaskAddedTime: time3,
            }),
        );

        const time5 = testTaskClock.now();
        await task3.addCollection(session, collection1, {time: time5});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 3,
                openTaskCount: 2,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 2,
                lastTaskAddedTime: time3,
            }),
        );

        await task3.updateStatus(session, "Closed");

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 3,
                openTaskCount: 1,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time3,
            }),
        );

        await task4.updateStatus(session, "Open");

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 3,
                openTaskCount: 2,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time3,
            }),
        );

        await task1.delete(session);

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time3,
            }),
        );

        await task2.delete(session);

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 0,
                lastTaskAddedTime: time3,
            }),
        );

        const time6 = testTaskClock.now();
        await task2.undelete(session, {time: time6});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time6,
            }),
        );

        await task2.removeCollection(session, collection2);

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 0,
                lastTaskAddedTime: time6,
            }),
        );

        await task3.delete(session);

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time5,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: time6,
            }),
        );

        const time7 = testTaskClock.now();
        await task3.undelete(session, {time: time7});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time7,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 0,
                lastTaskAddedTime: time7,
            }),
        );

        await task3.removeCollection(session, collection2);

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time7,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: time7,
            }),
        );
    });

    test("race condition: update collection task count is recognized if it conflicts with another update (count update commits first)", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task, collection] = await runAllPromises([
            TestTask.create(session1),
            TestTaskCollection.create(session2),
        ]);

        await collection.access.grantDefault(session2);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.account.id,
        );

        const updatePromise = collection.access.revokeDefault(session2);
        const {unpause} = await pausePromise;

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time = testTaskClock.now();
        await task.addCollection(session1, collection, {time});

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time,
            }),
        );

        unpause();
        await updatePromise;

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time,
            }),
        );
    });

    test("race condition: update collection task count is recognized if it conflicts with another update (other update commits first)", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task, collection] = await runAllPromises([
            TestTask.create(session1),
            TestTaskCollection.create(session2),
        ]);

        await collection.access.grantDefault(session2);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session1.account.id,
        );

        const time = testTaskClock.now();
        const updatePromise = task.addCollection(session1, collection, {time});
        const {unpause} = await pausePromise;

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        await collection.access.revokeDefault(session2);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        unpause();
        await updatePromise;

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time,
            }),
        );
    });

    test("multiple actions that update collection item count in one transaction", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task1, task2, task3, task4, collection] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
        ]);

        await collection.access.grantDefault(session);

        await task3.updateStatus(session, "Closed");

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time1 = testTaskClock.now();
        await task1.addCollection(session, collection, {time: time1});

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );

        const time2 = testTaskClock.now();
        await commitTaskActionTransaction(session.action(), space.id, [
            {
                type: "UpdateTask",
                time: time2,
                taskId: task2.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task4.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
        ]);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 4,
                openTaskCount: 3,
                lastTaskAddedTime: time2,
            }),
        );
    });

    test("multiple actions that update collection item count in one transaction and a collection update at the end", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task1, task2, task3, task4, collection] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
        ]);

        await collection.access.grantDefault(session);

        await task3.updateStatus(session, "Closed");

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time1 = testTaskClock.now();
        await task1.addCollection(session, collection, {time: time1});

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );

        const time2 = testTaskClock.now();
        await commitTaskActionTransaction(session.action(), space.id, [
            {
                type: "UpdateTask",
                time: time2,
                taskId: task2.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task4.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateCollection",
                time: time2,
                collectionId: collection.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
        ]);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 4,
                openTaskCount: 3,
                lastTaskAddedTime: time2,
            }),
        );
    });

    test("multiple actions that update collection item count in one transaction and a collection update at the beginning", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task1, task2, task3, task4, collection] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
        ]);

        await collection.access.grantDefault(session);

        await task3.updateStatus(session, "Closed");

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time1 = testTaskClock.now();
        await task1.addCollection(session, collection, {time: time1});

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );

        const time2 = testTaskClock.now();
        await commitTaskActionTransaction(session.action(), space.id, [
            {
                type: "UpdateCollection",
                time: time2,
                collectionId: collection.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task2.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task4.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
        ]);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 4,
                openTaskCount: 3,
                lastTaskAddedTime: time2,
            }),
        );
    });

    test("multiple actions that update collection item count in one transaction and a collection update in the middle", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task1, task2, task3, task4, collection] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
        ]);

        await collection.access.grantDefault(session);

        await task3.updateStatus(session, "Closed");

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time1 = testTaskClock.now();
        await task1.addCollection(session, collection, {time: time1});

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );

        const time2 = testTaskClock.now();
        await commitTaskActionTransaction(session.action(), space.id, [
            {
                type: "UpdateTask",
                time: time2,
                taskId: task2.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateCollection",
                time: time2,
                collectionId: collection.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: time2,
                taskId: task4.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
        ]);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 4,
                openTaskCount: 3,
                lastTaskAddedTime: time2,
            }),
        );
    });

    test("a collection action and an action that indirectly updates collection task counts in the same transaction", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task, collection] = await runAllPromises([
            TestTask.create(session),
            TestTaskCollection.create(session),
        ]);

        await collection.access.grantDefault(session);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: null,
            }),
        );

        const time1 = testTaskClock.now();
        await task.addCollection(session, collection, {time: time1});

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );

        const time2 = testTaskClock.now();
        await commitTaskActionTransaction(session.action(), space.id, [
            {
                type: "UpdateTask",
                time: time2,
                taskId: task.id,
                taskAction: {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: session.account.id,
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: time2,
                collectionId: collection.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
        ]);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 0,
                lastTaskAddedTime: time1,
            }),
        );

        const time3 = testTaskClock.now();
        await commitTaskActionTransaction(session.action(), space.id, [
            {
                type: "UpdateCollection",
                time: time3,
                collectionId: collection.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: time3,
                taskId: task.id,
                taskAction: {
                    type: "UpdateStatus",
                    status: {type: "Open"},
                },
            },
        ]);

        expect(await collection.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time1,
            }),
        );
    });

    test("account can remove access from itself", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(session1.action(), space.id, [
            {
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ]);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account can remove access from itself then grant it back with lease", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        );

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);
    });

    test("account can remove access from itself but can\u2019t grant it back with an invalid lease", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId: generateId<TaskActionTransactionLeaseId>()},
            ),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level"));

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account can remove access from itself but can\u2019t use another account\u2019s lease", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(
                session3.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level"));

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account can remove access from itself but can\u2019t grant itself access back with an incompatible action", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1, collection2] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection2.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "When using a lease, actions must exactly match the previously leased actions (excluding time)",
            ),
        );

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdatePriority",
                            priority: "High",
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "When using a lease, actions must exactly match the previously leased actions (excluding time)",
            ),
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account can remove access from itself but can\u2019t grant itself access back with an expired lease", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        const originalDateNow = Date.now;
        Date.now = () => addDays(new Date(originalDateNow()), 1).getTime();
        try {
            await expect(
                commitTaskActionTransaction(
                    session1.action(),
                    space.id,
                    [
                        {
                            type: "UpdateTask",
                            time: [Date.now(), 0],
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                    {leaseId},
                ),
            ).rejects.toThrow(
                new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level"),
            );

            await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
                PermissionDeniedError,
            );
            expect(
                (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
            ).toEqual(false);
        } finally {
            Date.now = originalDateNow;
        }
    });

    test("won\u2019t create lease if committed action doesn\u2019t remove access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(session1.action(), space.id, [
            {
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ]);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level"));

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("can\u2019t create lease with actions you aren\u2019t allowed to commit", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, task2, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task2.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "RemoveCollection",
                            collectionId: collection1.id,
                        },
                    },
                ],
                {
                    createLeaseIfLostAccess: {
                        id: leaseId,
                        actions: [
                            {
                                type: "UpdateTask",
                                time: testTaskClock.now(),
                                taskId: task2.id,
                                taskAction: {
                                    type: "AddCollection",
                                    collectionId: collection1.id,
                                    orderKey: initialOrderKey,
                                },
                            },
                        ],
                    },
                },
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Couldn\u2019t apply lease actions: Actor doesn\u2019t have `Edit` access level",
                {cause: new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level")},
            ),
        );

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);
    });

    test("account can\u2019t remove access from itself then grant it back with lease that has actions in different order", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        const initialOrderTime = testTaskClock.now();

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId: collection1.id,
                        position: {orderTime: initialOrderTime, orderKey: assertOrderKey("aZZZ")},
                    },
                },
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "UpdateCollectionPosition",
                                collectionId: collection1.id,
                                position: {
                                    orderTime: initialOrderTime,
                                    orderKey: initialOrderKey,
                                },
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId: collection1.id,
                        position: {
                            orderTime: initialOrderTime,
                            orderKey: initialOrderKey,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "When using a lease, actions must exactly match the previously leased actions (excluding time)",
            ),
        );

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId: collection1.id,
                            position: {
                                orderTime: initialOrderTime,
                                orderKey: initialOrderKey,
                            },
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "When using a lease, actions must exactly match the previously leased actions (excluding time)",
            ),
        );

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId: collection1.id,
                            position: {
                                orderTime: initialOrderTime,
                                orderKey: initialOrderKey,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "When using a lease, actions must exactly match the previously leased actions (excluding time)",
            ),
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId: collection1.id,
                        position: {
                            orderTime: initialOrderTime,
                            orderKey: initialOrderKey,
                        },
                    },
                },
            ],
            {leaseId},
        );

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);
    });

    test("account can remove access from itself but can\u2019t grant it back if another user has updated the task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await task1.updatePriority(session2, "High");

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level"));

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account can remove access from itself but can\u2019t grant it back if another user has deleted the task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await deleteTaskAndAllChildren(session2.action(), task1.id, testTaskClock.now());

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow("Actor doesn\u2019t have `View` access level");

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account can remove access from itself but can\u2019t grant it back if another user has updated notes", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        const leaseId = generateId<TaskActionTransactionLeaseId>();

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testTaskClock.now(),
                            taskId: task1.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await updateTaskNotesContent(session2.action(), {
            spaceId: space.id,
            taskId: task1.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId: generateId<ContentEditorClientId>(),
        });

        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: testTaskClock.now(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `Edit` access level"));

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("can\u2019t revoke access from a collection manager that invited you", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3a, session3b] = await space.createSessions(4);

        const collection = await TestTaskCollection.create(session1);

        await collection.access.grant(session1, session2);
        await collection.access.grant(session2, session3a);
        await collection.access.grant(session2, session3b);

        await expect(collection.access.revoke(session3a, session2)).rejects.toThrow(
            "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        );

        await expect(collection.access.revoke(session3a, session1)).rejects.toThrow(
            "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        );

        await collection.access.revoke(session3a, session3b);
    });

    test("can\u2019t revoke access from a task manager that invited you", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await task.access.grant(session1, session2);

        await expect(task.access.revoke(session2, session1)).rejects.toThrow(
            "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        );
    });

    test("can\u2019t update a task access policy without manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const task = await TestTask.create(session1);

        const accessPolicy = await task.access.grant(session1, session2, "Edit");
        assert(accessPolicy.type === "Local", "Expected local access policy");
        const accountGrantById = new Map(accessPolicy.accountGrantById);
        accountGrantById.set(session3.account.id, {level: "Edit"});

        const newAccessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById,
            defaultGrant: accessPolicy.defaultGrant,
            urlGrant: accessPolicy.urlGrant,
        };

        await expect(task.access.set(session2, newAccessPolicy)).rejects.toThrow(
            "Actor doesn\u2019t have `Manage` access level",
        );
    });

    test("can update a task access policy with inherited manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const collection = await TestTaskCollection.create(session1);
        const task = await TestTask.create(session1, {collections: [collection]});

        await collection.access.grant(session1, session2, "Manage");

        const accessPolicy = await task.access.get();
        assert(accessPolicy.type === "Local", "Expected local access policy");
        const accountGrantById = new Map(accessPolicy.accountGrantById);
        accountGrantById.set(session3.account.id, {level: "View"});

        const newAccessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById,
            defaultGrant: accessPolicy.defaultGrant,
            urlGrant: accessPolicy.urlGrant,
        };

        await task.access.set(session2, newAccessPolicy);

        const updatedAccessPolicy = await task.access.get();
        assert(updatedAccessPolicy.type === "Local", "Expected local access policy");
        expect(updatedAccessPolicy.accountGrantById.get(session3.account.id)?.level).toEqual(
            "View",
        );
    });

    test("can\u2019t update a task access policy with no manage grants", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await task.access.grant(session1, session2, "Edit");

        const newAccessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Edit"}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(task.access.set(session1, newAccessPolicy)).rejects.toThrow(
            "Can\u2019t update access policy so that no one has manage access",
        );
    });

    test("can only send share notifications when committing an update access policy action", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const [task, collection] = await runAllPromises([
            TestTask.create(session1),
            TestTaskCollection.create(session1, {name: "Test Collection 1"}),
        ]);

        expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

        await ProcessContextModule.waitForTestTasks();

        expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

        const time1 = testTaskClock.now();
        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: task.id,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: session1.account.id,
                                closedTime: new TaskFilterableTime({
                                    absoluteTime: time1,
                                    setterTimeZone: defaultTimeZone,
                                }),
                            },
                        },
                    },
                ],
                {
                    updateAccessPolicyShareNotification: {
                        accountIds: [session2.account.id, session3.account.id],
                        content: createSimpleMessageContent("foobar1"),
                        createdTimeZone: defaultTimeZone,
                    },
                },
            ),
        ).rejects.toThrow(
            "Can only provide `updateAccessPolicyShareNotification` if there\u2019s an `UpdateAccessPolicy` action in the transaction",
        );

        expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

        await ProcessContextModule.waitForTestTasks();

        expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

        const time2 = testTaskClock.now();
        await expect(
            commitTaskActionTransaction(
                session1.action(),
                space.id,
                [
                    {
                        type: "UpdateCollection",
                        time: time2,
                        collectionId: collection.id,
                        collectionAction: {
                            type: "UpdateName",
                            name: "buzqax",
                        },
                    },
                ],
                {
                    updateAccessPolicyShareNotification: {
                        accountIds: [session2.account.id, session3.account.id],
                        content: createSimpleMessageContent("foobar2"),
                        createdTimeZone: defaultTimeZone,
                    },
                },
            ),
        ).rejects.toThrow(
            "Can only provide `updateAccessPolicyShareNotification` if there\u2019s an `UpdateAccessPolicy` action in the transaction",
        );

        expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

        await ProcessContextModule.waitForTestTasks();

        expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

        const time3 = testTaskClock.now();
        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateCollection",
                    time: time3,
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "Manage", generation: 1}],
                                [session3.account.id, {level: "Manage", generation: 1}],
                            ]),
                            defaultGrant: {level: "Manage", generation: 1},
                            urlGrant: null,
                        },
                    },
                },
            ],
            {
                updateAccessPolicyShareNotification: {
                    accountIds: [session2.account.id, session3.account.id],
                    content: createSimpleMessageContent("foobar3"),
                    createdTimeZone: defaultTimeZone,
                },
            },
        );

        expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

        await ProcessContextModule.waitForTestTasks();

        expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([
            {
                type: "SendShareNotification",
                jobId: expect.any(String),
                spaceId: space.id,
                actorAccountId: session1.account.id,
                entityId: `TaskCollection:${collection.id}`,
                notification: {
                    accountIds: [session2.account.id, session3.account.id],
                    content: createSimpleMessageContent("foobar3"),
                    createdTimeZone: defaultTimeZone,
                },
            },
        ]);
    });

    test("can send share notifications for update task access policy actions", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const task = await TestTask.create(session1);

        await ProcessContextModule.waitForTestTasks();

        expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

        const time = testTaskClock.now();
        await commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time,
                    taskId: task.id,
                    taskAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "Manage", generation: 1}],
                                [session3.account.id, {level: "Manage", generation: 1}],
                            ]),
                            defaultGrant: {level: "Manage", generation: 1},
                            urlGrant: null,
                        },
                    },
                },
            ],
            {
                updateAccessPolicyShareNotification: {
                    accountIds: [session2.account.id, session3.account.id],
                    content: createSimpleMessageContent("foobar4"),
                    createdTimeZone: defaultTimeZone,
                },
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([
            {
                type: "SendShareNotification",
                jobId: expect.any(String),
                spaceId: space.id,
                actorAccountId: session1.account.id,
                entityId: `Task:${task.id}`,
                notification: {
                    accountIds: [session2.account.id, session3.account.id],
                    content: createSimpleMessageContent("foobar4"),
                    createdTimeZone: defaultTimeZone,
                },
            },
        ]);
    });

    test("can\u2019t create task collection with bot account", async () => {
        const bot = await TestBot.create(context);

        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const session = await space.createSession();

        const {id: botAccountId} = await bot.instantiate(adminSession);

        const accessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session.account.id, {level: "Manage", generation: 0}],
                [botAccountId, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(TestTaskCollection.create(session, {access: accessPolicy})).rejects.toThrow(
            "Can\u2019t grant access to a bot account",
        );
    });

    test("can\u2019t share task collection with bot account", async () => {
        const bot = await TestBot.create(context);

        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const session = await space.createSession();

        const {id: botAccountId} = await bot.instantiate(adminSession);

        const accessPolicy1: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        const collection = await TestTaskCollection.create(session, {access: accessPolicy1});

        const invalidAccessPolicy2: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session.account.id, {level: "Manage", generation: 0}],
                [botAccountId, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        await expect(collection.access.set(session, invalidAccessPolicy2)).rejects.toThrow(
            "Can\u2019t grant access to a bot account",
        );
    });
});

describe("bot task creation authorization", () => {
    test("non-bot can\u2019t create a task on behalf of another account", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const taskId = generateId<TaskId>();
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Create",
                        creator: {
                            accountId: session2.account.id,
                            from: null,
                        },
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError("Only bots can create tasks on behalf of other accounts"),
        );
    });

    test("bot can create a task on behalf of another account", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const otherSession = await space.createSession();
        const botAccount = await TestBot.createAndInstantiate(session);

        const taskId = generateId<TaskId>();
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);

        await commitTaskActionTransaction(botAccount.action(), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {
                        accountId: otherSession.account.id,
                        from: {type: "Bot", accountId: botAccount.id},
                    },
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        expect(await getTaskItemForTest(context, taskId)).toMatchObject({
            creatorId: otherSession.account.id,
            creatorFrom: {type: "Bot", accountId: botAccount.id},
        });
    });

    test("bot can create a task with access policy", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const taskId = generateId<TaskId>();
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);
        const botContext = botAccount.action();

        const accessPolicy = await createAccessPolicyForContentCreatedByBot(botContext, space.id);

        await commitTaskActionTransaction(botContext, space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {
                        accountId: botAccount.id,
                        from: {type: "Bot", accountId: botAccount.id},
                    },
                    creatorTimeZone: defaultTimeZone,
                    accessPolicy,
                },
            },
        ]);
    });

    test("bot can update a task it just created when access policy is set on create", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const taskId = generateId<TaskId>();
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);
        const botContext = botAccount.action();

        const accessPolicy = await createAccessPolicyForContentCreatedByBot(botContext, space.id);

        await commitTaskActionTransaction(botContext, space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {
                        accountId: botAccount.id,
                        from: {type: "Bot", accountId: botAccount.id},
                    },
                    creatorTimeZone: defaultTimeZone,
                    accessPolicy,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: createTaskTitleFromText(
                        randomlyGenerateTaskTitleClientId(),
                        "Bot task",
                    ),
                },
            },
        ]);
    });

    test("bot can\u2019t update a task it doesn\u2019t have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const botAccount = await TestBot.createAndInstantiate(session1);

        // Create a private task owned by session2 with an explicit access policy that
        // doesn't include the bot's scope.
        const task = await TestTask.create(session2);
        const privateAccessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage" as const, generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);
        await commitTaskActionTransaction(session2.action(), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task.id,
                taskAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: privateAccessPolicy,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(botAccount.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task.id,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: createTaskTitleFromText(
                            randomlyGenerateTaskTitleClientId(),
                            "Hacked",
                        ),
                    },
                },
            ]),
        ).rejects.toThrow("Edit");
    });

    test("bot can\u2019t set access policy on a task it doesn\u2019t have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const botAccount = await TestBot.createAndInstantiate(session1);

        // Create a private task owned by session2 with an explicit access policy that
        // doesn't include the bot's scope.
        const task = await TestTask.create(session2);
        const privateAccessPolicy: LocalAccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage" as const, generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);
        await commitTaskActionTransaction(session2.action(), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task.id,
                taskAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: privateAccessPolicy,
                },
            },
        ]);

        const botContext = botAccount.action();
        const botAccessPolicy = await createAccessPolicyForContentCreatedByBot(
            botContext,
            space.id,
        );

        await expect(
            commitTaskActionTransaction(botContext, space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task.id,
                    taskAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: botAccessPolicy,
                    },
                },
            ]),
        ).rejects.toThrow("Edit");
    });
});

describe("bot task collection creation authorization", () => {
    test("non-bot can\u2019t create a task collection on behalf of another account", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const collectionId = generateId<TaskCollectionId>();
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creator: {
                            accountId: session2.account.id,
                            from: null,
                        },
                        name: "Test Collection",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Only bots can create task collections on behalf of other accounts",
            ),
        );
    });

    test("bot can create a task collection on behalf of another account", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const otherSession = await space.createSession();
        const botAccount = await TestBot.createAndInstantiate(session);

        const collectionId = generateId<TaskCollectionId>();
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);
        const botContext = botAccount.action();
        const accessPolicy = await createAccessPolicyForContentCreatedByBot(botContext, space.id);

        await commitTaskActionTransaction(botContext, space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {
                        accountId: otherSession.account.id,
                        from: {type: "Bot", accountId: botAccount.id},
                    },
                    name: "Test Collection",
                    accessPolicy,
                },
            },
        ]);

        expect(await getTaskCollectionItemForTest(context, collectionId)).toMatchObject({
            creatorId: otherSession.account.id,
            creatorFrom: {type: "Bot", accountId: botAccount.id},
        });
    });
});
