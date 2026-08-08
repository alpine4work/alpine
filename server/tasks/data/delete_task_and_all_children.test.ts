import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {deleteTaskAndAllChildren} from "~/server/tasks/data/delete_task_and_all_children.js";
import {deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint} from "~/server/tasks/data/delete_task_and_all_children_before_execute_test_checkpoint.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("deleteTaskAndAllChildren()", () => {
    test("can delete a task and all its children when it has no children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        expect((await task.getItem()).deletedTime).toEqual(null);

        const actionTime = testTaskClock.now();

        expect(await deleteTaskAndAllChildren(session.action(), task.id, actionTime)).toEqual({
            spaceId: space.id,
            actions: [
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task.id,
                    taskAction: {type: "Delete"},
                },
            ],
        });

        expect((await task.getItem()).deletedTime).toEqual(actionTime);
    });

    test("can\u2019t delete a task and all its children when the task doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const actionTime = testTaskClock.now();

        await expect(
            deleteTaskAndAllChildren(session.action(), generateId(), actionTime),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t delete a task and all its children when you don\u2019t have access to the task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const task = await TestTask.create(session1);

        expect((await task.getItem()).deletedTime).toEqual(null);

        const actionTime = testTaskClock.now();

        await expect(
            deleteTaskAndAllChildren(session2.action(), task.id, actionTime),
        ).rejects.toThrow(PermissionDeniedError);

        expect((await task.getItem()).deletedTime).toEqual(null);
    });

    test("can delete a task and all its children when you have access to the task through a collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await task.addCollection(session1, collection);

        await collection.access.set(session1, {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session3.account.id, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        expect((await task.getItem()).deletedTime).toEqual(null);

        const actionTime = testTaskClock.now();

        await expect(
            deleteTaskAndAllChildren(session2.action(), task.id, actionTime),
        ).rejects.toThrow(PermissionDeniedError);

        expect((await task.getItem()).deletedTime).toEqual(null);

        expect(await deleteTaskAndAllChildren(session3.action(), task.id, actionTime)).toEqual({
            spaceId: space.id,
            actions: [
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task.id,
                    taskAction: {type: "Delete"},
                },
            ],
        });

        expect((await task.getItem()).deletedTime).toEqual(actionTime);
    });

    test("can delete a task and all its children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [task1, task2, task3, task4, task5, task6, task7, task8, task9, task10] =
            await runAllPromises([
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
            ]);

        await runAllPromises([
            task2.updateParentTask(session, task1),
            task3.updateParentTask(session, task1),
            task4.updateParentTask(session, task1),
            task5.updateParentTask(session, task3),
            task6.updateParentTask(session, task5),
            task7.updateParentTask(session, task5),
            task8.updateParentTask(session, task4),
            task1.updateParentTask(session, task9),
            task7.updateStatus(session, "Closed"),
        ]);

        expect((await task1.getItem()).deletedTime).toEqual(null);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(null);
        expect((await task4.getItem()).deletedTime).toEqual(null);
        expect((await task5.getItem()).deletedTime).toEqual(null);
        expect((await task6.getItem()).deletedTime).toEqual(null);
        expect((await task7.getItem()).deletedTime).toEqual(null);
        expect((await task8.getItem()).deletedTime).toEqual(null);
        expect((await task9.getItem()).deletedTime).toEqual(null);
        expect((await task10.getItem()).deletedTime).toEqual(null);

        const actionTime = testTaskClock.now();

        expect(
            (await deleteTaskAndAllChildren(session.action(), task1.id, actionTime)).actions
                .slice()
                .sort((action1, action2) =>
                    defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
                ),
        ).toEqual(
            [
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task1.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task2.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task3.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task4.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task5.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task6.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task7.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task8.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: task9.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 3,
                        removedChildTaskCount: 3,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 2,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 1,
                    },
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: task4.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ].sort((action1, action2) =>
                defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
            ),
        );

        expect((await task1.getItem()).deletedTime).toEqual(actionTime);
        expect((await task2.getItem()).deletedTime).toEqual(actionTime);
        expect((await task3.getItem()).deletedTime).toEqual(actionTime);
        expect((await task4.getItem()).deletedTime).toEqual(actionTime);
        expect((await task5.getItem()).deletedTime).toEqual(actionTime);
        expect((await task6.getItem()).deletedTime).toEqual(actionTime);
        expect((await task7.getItem()).deletedTime).toEqual(actionTime);
        expect((await task8.getItem()).deletedTime).toEqual(actionTime);
        expect((await task9.getItem()).deletedTime).toEqual(null);
        expect((await task10.getItem()).deletedTime).toEqual(null);
    });

    test("can handle race conditions when deleting a task and all of it\u2019s children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [parentTask1, parentTask2, task1, task2, task3, task4, task5] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
        ]);

        await runAllPromises([
            task1.updateParentTask(session, parentTask1),
            task2.updateParentTask(session, parentTask1),
            task3.updateParentTask(session, parentTask2),
            task5.updateParentTask(session, parentTask1),
        ]);

        expect((await parentTask1.getItem()).deletedTime).toEqual(null);
        expect((await parentTask2.getItem()).deletedTime).toEqual(null);
        expect((await task1.getItem()).deletedTime).toEqual(null);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(null);
        expect((await task4.getItem()).deletedTime).toEqual(null);
        expect((await task5.getItem()).deletedTime).toEqual(null);

        const pausePromise = deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.pauseForTest(
            session.account.id,
        );

        const actionTime = testTaskClock.now();
        const deletePromise = deleteTaskAndAllChildren(
            session.action(),
            parentTask1.id,
            actionTime,
        );

        const {unpause} = await pausePromise;

        await task2.updateParentTask(session, parentTask2);
        await task3.updateParentTask(session, parentTask1);
        await task4.updateParentTask(session, parentTask1);
        await task5.updateParentTask(session, null);

        expect((await parentTask1.getItem()).deletedTime).toEqual(null);
        expect((await parentTask2.getItem()).deletedTime).toEqual(null);
        expect((await task1.getItem()).deletedTime).toEqual(null);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(null);
        expect((await task4.getItem()).deletedTime).toEqual(null);
        expect((await task5.getItem()).deletedTime).toEqual(null);

        unpause();

        expect(
            (await deletePromise).actions
                .slice()
                .sort((action1, action2) =>
                    defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
                ),
        ).toEqual(
            [
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: parentTask1.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task1.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task3.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task4.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 5,
                        removedChildTaskCount: 5,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ].sort((action1, action2) =>
                defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
            ),
        );

        expect((await parentTask1.getItem()).deletedTime).toEqual(actionTime);
        expect((await parentTask2.getItem()).deletedTime).toEqual(null);
        expect((await task1.getItem()).deletedTime).toEqual(actionTime);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(actionTime);
        expect((await task4.getItem()).deletedTime).toEqual(actionTime);
        expect((await task5.getItem()).deletedTime).toEqual(null);
    });

    test("can handle race conditions when deleting a task with parent and all of it\u2019s children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [grandParentTask, parentTask1, parentTask2, task1, task2, task3, task4, task5] =
            await runAllPromises([
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
                TestTask.create(session),
            ]);

        await runAllPromises([
            parentTask1.updateParentTask(session, grandParentTask),
            task1.updateParentTask(session, parentTask1),
            task2.updateParentTask(session, parentTask1),
            task3.updateParentTask(session, parentTask2),
            task5.updateParentTask(session, parentTask1),
        ]);

        expect((await grandParentTask.getItem()).deletedTime).toEqual(null);
        expect((await parentTask1.getItem()).deletedTime).toEqual(null);
        expect((await parentTask2.getItem()).deletedTime).toEqual(null);
        expect((await task1.getItem()).deletedTime).toEqual(null);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(null);
        expect((await task4.getItem()).deletedTime).toEqual(null);
        expect((await task5.getItem()).deletedTime).toEqual(null);

        const pausePromise = deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.pauseForTest(
            session.account.id,
        );

        const actionTime = testTaskClock.now();
        const deletePromise = deleteTaskAndAllChildren(
            session.action(),
            parentTask1.id,
            actionTime,
        );

        const {unpause} = await pausePromise;

        await task2.updateParentTask(session, parentTask2);
        await task3.updateParentTask(session, parentTask1);
        await task4.updateParentTask(session, parentTask1);
        await task5.updateParentTask(session, null);

        expect((await grandParentTask.getItem()).deletedTime).toEqual(null);
        expect((await parentTask1.getItem()).deletedTime).toEqual(null);
        expect((await parentTask2.getItem()).deletedTime).toEqual(null);
        expect((await task1.getItem()).deletedTime).toEqual(null);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(null);
        expect((await task4.getItem()).deletedTime).toEqual(null);
        expect((await task5.getItem()).deletedTime).toEqual(null);

        unpause();

        expect(
            (await deletePromise).actions
                .slice()
                .sort((action1, action2) =>
                    defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
                ),
        ).toEqual(
            [
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: parentTask1.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task1.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task3.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: actionTime,
                    taskId: task4.id,
                    taskAction: {type: "Delete"},
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 5,
                        removedChildTaskCount: 5,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: [actionTime[0], actionTime[1] + 1],
                    taskId: grandParentTask.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ].sort((action1, action2) =>
                defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
            ),
        );

        expect((await grandParentTask.getItem()).deletedTime).toEqual(null);
        expect((await parentTask1.getItem()).deletedTime).toEqual(actionTime);
        expect((await parentTask2.getItem()).deletedTime).toEqual(null);
        expect((await task1.getItem()).deletedTime).toEqual(actionTime);
        expect((await task2.getItem()).deletedTime).toEqual(null);
        expect((await task3.getItem()).deletedTime).toEqual(actionTime);
        expect((await task4.getItem()).deletedTime).toEqual(actionTime);
        expect((await task5.getItem()).deletedTime).toEqual(null);
    });

    test("the delete a task with all its children function has the same effect as committing a delete action", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const createdTime = testTaskClock.now();

        const task1 = await TestTask.create(session, {time: createdTime});
        const task2 = await TestTask.create(session, {time: createdTime});

        const replaceTaskIds = (object: any) => {
            if (object.taskId === task1.id) return {...object, taskId: task2.id};
            return object;
        };

        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());

        const deletedTime = testTaskClock.now();

        const actions1: Array<TaskAction> = [
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
        ];

        const {extraActions: extraActions1} = await commitTaskActionTransaction(
            session.action(),
            space.id,
            actions1,
        );

        expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());

        const {actions: actions2} = await deleteTaskAndAllChildren(
            session.action(),
            task2.id,
            deletedTime,
        );

        expect([...actions1, ...extraActions1].map(replaceTaskIds)).toEqual(actions2);

        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
    });

    test("the delete a task with all its children function has the same effect as committing a delete action when task has a parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const createdTime = testTaskClock.now();
        const parentUpdatedTime = testTaskClock.now();

        const parentTask1 = await TestTask.create(session, {time: createdTime});
        const parentTask2 = await TestTask.create(session, {time: createdTime});
        const task1 = await TestTask.create(session, {time: createdTime});
        const task2 = await TestTask.create(session, {time: createdTime});

        await task1.updateParentTask(session, parentTask1, {time: parentUpdatedTime});
        await task2.updateParentTask(session, parentTask2, {time: parentUpdatedTime});

        const replaceTaskIds = (object: any) => {
            if (object.taskId === parentTask1.id) object = {...object, taskId: parentTask2.id};
            if (object.taskId === task1.id) object = {...object, taskId: task2.id};

            if (object.childTaskIds) {
                object = {
                    ...object,
                    childTaskIds: new Set(
                        Array.from(object.childTaskIds, (id: TaskId) => {
                            if (id === parentTask1.id) return parentTask2.id;
                            if (id === task1.id) return task2.id;
                            return id;
                        }),
                    ),
                };
            }

            if (object.parentTaskId?.value === parentTask1.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        parentTask2.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            if (object.parentTaskId?.value === task1.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            return object;
        };

        expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());

        const deletedTime = testTaskClock.now();

        const actions1: Array<TaskAction> = [
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
        ];

        const {extraActions: extraActions1} = await commitTaskActionTransaction(
            session.action(),
            space.id,
            actions1,
        );

        expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());

        const {actions: actions2} = await deleteTaskAndAllChildren(
            session.action(),
            task2.id,
            deletedTime,
        );

        expect([...actions1, ...extraActions1].map(replaceTaskIds)).toEqual(actions2);

        expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
    });

    test("the delete a task with all its children function has the same effect as committing delete actions when task has children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const createdTime = testTaskClock.now();
        const parentUpdatedTime = testTaskClock.now();

        const task1 = await TestTask.create(session, {time: createdTime});
        const task1a = await TestTask.create(session, {time: createdTime});
        const task1b = await TestTask.create(session, {time: createdTime});
        const task2 = await TestTask.create(session, {time: createdTime});
        const task2a = await TestTask.create(session, {time: createdTime});
        const task2b = await TestTask.create(session, {time: createdTime});

        await task1a.updateParentTask(session, task1, {time: parentUpdatedTime});
        await task1b.updateParentTask(session, task1, {time: parentUpdatedTime});
        await task2a.updateParentTask(session, task2, {time: parentUpdatedTime});
        await task2b.updateParentTask(session, task2, {time: parentUpdatedTime});

        await task1b.updateStatus(session, "Closed", {time: parentUpdatedTime});
        await task2b.updateStatus(session, "Closed", {time: parentUpdatedTime});

        const replaceTaskIds = (object: any) => {
            if (object.taskId === task1.id) object = {...object, taskId: task2.id};
            if (object.taskId === task1a.id) object = {...object, taskId: task2a.id};
            if (object.taskId === task1b.id) object = {...object, taskId: task2b.id};

            if (object.childTaskIds) {
                object = {
                    ...object,
                    childTaskIds: new Set(
                        Array.from(object.childTaskIds, (id: TaskId) => {
                            if (id === task1.id) return task2.id;
                            if (id === task1a.id) return task2a.id;
                            if (id === task1b.id) return task2b.id;
                            return id;
                        }),
                    ),
                };
            }

            if (object.parentTaskId?.value === task1.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            if (object.parentTaskId?.value === task1a.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2a.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            if (object.parentTaskId?.value === task1b.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2b.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            return object;
        };

        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
        expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
        expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());

        const deletedTime = testTaskClock.now();

        const actions1: Array<TaskAction> = [
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1a.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1b.id,
                taskAction: {type: "Delete"},
            },
        ];

        const {extraActions: extraActions1} = await commitTaskActionTransaction(
            session.action(),
            space.id,
            actions1,
        );

        expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());
        expect(replaceTaskIds(await task1a.getItem())).not.toEqual(await task2a.getItem());
        expect(replaceTaskIds(await task1b.getItem())).not.toEqual(await task2b.getItem());

        const {actions: actions2} = await deleteTaskAndAllChildren(
            session.action(),
            task2.id,
            deletedTime,
        );

        expect(
            [...actions1, ...extraActions1]
                .map(replaceTaskIds)
                .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
        ).toEqual(
            actions2
                .slice()
                .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
        );

        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
        expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
        expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());
    });

    test("the delete a task with all its children function has the same effect as committing delete actions when task has a parent and children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const createdTime = testTaskClock.now();
        const parentUpdatedTime = testTaskClock.now();

        const parentTask1 = await TestTask.create(session, {time: createdTime});
        const parentTask2 = await TestTask.create(session, {time: createdTime});
        const task1 = await TestTask.create(session, {time: createdTime});
        const task1a = await TestTask.create(session, {time: createdTime});
        const task1b = await TestTask.create(session, {time: createdTime});
        const task2 = await TestTask.create(session, {time: createdTime});
        const task2a = await TestTask.create(session, {time: createdTime});
        const task2b = await TestTask.create(session, {time: createdTime});

        await task1.updateParentTask(session, parentTask1, {time: parentUpdatedTime});
        await task2.updateParentTask(session, parentTask2, {time: parentUpdatedTime});
        await task1a.updateParentTask(session, task1, {time: parentUpdatedTime});
        await task1b.updateParentTask(session, task1, {time: parentUpdatedTime});
        await task2a.updateParentTask(session, task2, {time: parentUpdatedTime});
        await task2b.updateParentTask(session, task2, {time: parentUpdatedTime});

        await task1b.updateStatus(session, "Closed", {time: parentUpdatedTime});
        await task2b.updateStatus(session, "Closed", {time: parentUpdatedTime});

        const replaceTaskIds = (object: any) => {
            if (object.taskId === parentTask1.id) object = {...object, taskId: parentTask2.id};
            if (object.taskId === task1.id) object = {...object, taskId: task2.id};
            if (object.taskId === task1a.id) object = {...object, taskId: task2a.id};
            if (object.taskId === task1b.id) object = {...object, taskId: task2b.id};

            if (object.childTaskIds) {
                object = {
                    ...object,
                    childTaskIds: new Set(
                        Array.from(object.childTaskIds, (id: TaskId) => {
                            if (id === parentTask1.id) return parentTask2.id;
                            if (id === task1.id) return task2.id;
                            if (id === task1a.id) return task2a.id;
                            if (id === task1b.id) return task2b.id;
                            return id;
                        }),
                    ),
                };
            }

            if (object.parentTaskId?.value === parentTask1.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        parentTask2.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            if (object.parentTaskId?.value === task1.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            if (object.parentTaskId?.value === task1a.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2a.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            if (object.parentTaskId?.value === task1b.id) {
                object = {
                    ...object,
                    parentTaskId: new TaskParentTaskIdRegister(
                        task2b.id,
                        object.parentTaskId.version,
                    ),
                };
            }

            return object;
        };

        expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
        expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
        expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());

        const deletedTime = testTaskClock.now();

        const actions1: Array<TaskAction> = [
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1a.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId: task1b.id,
                taskAction: {type: "Delete"},
            },
        ];

        const {extraActions: extraActions1} = await commitTaskActionTransaction(
            session.action(),
            space.id,
            actions1,
        );

        expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());
        expect(replaceTaskIds(await task1a.getItem())).not.toEqual(await task2a.getItem());
        expect(replaceTaskIds(await task1b.getItem())).not.toEqual(await task2b.getItem());

        const {actions: actions2} = await deleteTaskAndAllChildren(
            session.action(),
            task2.id,
            deletedTime,
        );

        expect(
            [...actions1, ...extraActions1]
                .map(replaceTaskIds)
                .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
        ).toEqual(
            actions2
                .slice()
                .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
        );

        expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
        expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
        expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
        expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());
    });

    test("correctly updates collection task counts when deleting task and all children", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const [
            task1,
            task2,
            task3,
            task4,
            task5,
            task6,
            collection1,
            collection2,
            collection3,
            collection4,
        ] = await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
        ]);

        const time1 = testTaskClock.now();
        const time2 = testTaskClock.now();
        const time3 = testTaskClock.now();
        const time4 = testTaskClock.now();
        const time5 = testTaskClock.now();
        const time6 = testTaskClock.now();

        await runAllPromises([
            task2.updateParentTask(session, task1),
            task3.updateParentTask(session, task2),
            task4.updateParentTask(session, task2),
            task5.updateParentTask(session, task2),
            task6.updateParentTask(session, task4),
            task6.addCollection(session, collection2, {time: time1}),
            task6.addCollection(session, collection3, {time: time2}),
            task2.addCollection(session, collection1, {time: time3}),
            task3.addCollection(session, collection4, {time: time5}),
            task3.updateStatus(session, "Closed"),
        ]);

        // Make sure these run after our other `addCollection()`s so their times are the
        // ones reflected in the collection objects.
        await task1.addCollection(session, collection2, {time: time4});
        await task4.addCollection(session, collection4, {time: time6});

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time3,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 2,
                lastTaskAddedTime: time4,
            }),
        );
        expect(await collection3.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time2,
            }),
        );
        expect(await collection4.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 2,
                openTaskCount: 1,
                lastTaskAddedTime: time6,
            }),
        );

        await deleteTaskAndAllChildren(session.action(), task2.id, testTaskClock.now());

        expect(await collection1.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: time3,
            }),
        );
        expect(await collection2.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 1,
                openTaskCount: 1,
                lastTaskAddedTime: time4,
            }),
        );
        expect(await collection3.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: time2,
            }),
        );
        expect(await collection4.getItem()).toEqual(
            expect.objectContaining({
                taskCount: 0,
                openTaskCount: 0,
                lastTaskAddedTime: time6,
            }),
        );
    });
});
