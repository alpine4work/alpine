import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {duplicateTaskAndAllChildren, getTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/test_helpers/test_task_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getTaskTitleText} from "~/shared/tasks/title/task_title.js";

const context = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

test("can duplicate a task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "foo"});
    await task.updatePriority(session, "High");

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(
        server.action(session),
        task.id,
        testTaskClock.now(),
        defaultTimeZone,
    );

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("foo (copy)");
    expect(clonedTask.priority.value).toEqual("High");
});

test("can duplicate a task with subtasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "foo"});

    const childTask1 = await TestTask.create(session, {title: "bar"});
    const childTask2 = await TestTask.create(session, {title: "qux"});

    await childTask1.updateParentTask(session, task);
    await childTask2.updateParentTask(session, task);

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(
        server.action(session),
        task.id,
        testTaskClock.now(),
        defaultTimeZone,
    );

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("foo (copy)");

    const {tasks: clonedChildTasks} = await server.loadQuery(session, {
        filters: {
            displayStatusFilter: {ifOpenInactive: true, ifOpenActive: true, ifClosed: true},
            parentFilter: {parentTaskId: clonedTaskId},
        },
        sorts: [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
    });

    expect(clonedChildTasks.length).toEqual(2);
    expect(clonedChildTasks[0]!.id).not.toEqual(childTask1.id);
    expect(getTaskTitleText(clonedChildTasks[0]!.title.raw)).toEqual("bar");
    expect(clonedChildTasks[1]!.id).not.toEqual(childTask2.id);
    expect(getTaskTitleText(clonedChildTasks[1]!.title.raw)).toEqual("qux");
});

test("can duplicate a task with notes attached", async () => {
    const notes = "This is a note attached to the task";
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "foo"});
    await task.typeNotes(session, notes);

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(
        server.action(session),
        task.id,
        testTaskClock.now(),
        defaultTimeZone,
    );

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("foo (copy)");

    // Get the notes content from the cloned task
    const clonedTaskNotes = await getTaskNotesContent(session.action(), clonedTaskId);

    // Verify the notes were duplicated correctly
    const duplicatedNotes = clonedTaskNotes.content.doc.textContent;
    expect(duplicatedNotes).toEqual(notes);
});

test("can duplicate a task with nested children and some notes attached", async () => {
    // This is a more exhaustive test case that covers the full range of possible
    // task duplication scenarios, including notes and nested children.

    const notes = "This is a note attached to the task";
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "foo"});
    const childTask1 = await TestTask.create(session, {title: "bar"});
    const childTask2 = await TestTask.create(session, {title: "qux"});
    const childChildTask1 = await TestTask.create(session, {title: "bar2"});

    await childTask1.updateParentTask(session, task);
    await childTask2.updateParentTask(session, task);
    await childChildTask1.updateParentTask(session, childTask1);

    // No notes on childTask 1
    await task.typeNotes(session, notes);
    await childTask2.typeNotes(session, notes + "2");
    await childChildTask1.typeNotes(session, notes + "child1");

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(
        server.action(session),
        task.id,
        testTaskClock.now(),
        defaultTimeZone,
    );

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("foo (copy)");

    const {tasks: clonedChildTasks} = await server.loadQuery(session, {
        filters: {
            displayStatusFilter: {ifOpenInactive: true, ifOpenActive: true, ifClosed: true},
            parentFilter: {parentTaskId: clonedTaskId},
        },
        sorts: [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
    });

    const {tasks: clonedChild1Tasks} = await server.loadQuery(session, {
        filters: {
            displayStatusFilter: {ifOpenInactive: true, ifOpenActive: true, ifClosed: true},
            parentFilter: {parentTaskId: clonedChildTasks[0]!.id},
        },
        sorts: [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
    });

    expect(clonedChildTasks.length).toEqual(2);
    expect(clonedChildTasks[0]!.id).not.toEqual(childTask1.id);
    expect(getTaskTitleText(clonedChildTasks[0]!.title.raw)).toEqual("bar");
    expect(clonedChildTasks[1]!.id).not.toEqual(childTask2.id);
    expect(getTaskTitleText(clonedChildTasks[1]!.title.raw)).toEqual("qux");

    expect(clonedChild1Tasks.length).toEqual(1);
    expect(clonedChild1Tasks[0]!.id).not.toEqual(childChildTask1.id);
    expect(getTaskTitleText(clonedChild1Tasks[0]!.title.raw)).toEqual("bar2");

    // Get the notes content from the cloned task
    const clonedTaskNotes = await getTaskNotesContent(session.action(), clonedTaskId);
    const clonedChildTask1Notes = await getTaskNotesContent(
        session.action(),
        clonedChildTasks[0]!.id,
    );
    const clonedChildTask2Notes = await getTaskNotesContent(
        session.action(),
        clonedChildTasks[1]!.id,
    );
    const clonedChildChildTask1Notes = await getTaskNotesContent(
        session.action(),
        clonedChild1Tasks[0]!.id,
    );

    // Verify the notes were duplicated correctly
    const duplicatedNotes = clonedTaskNotes.content.doc.textContent;
    expect(duplicatedNotes).toEqual(notes);
    const duplicatedChildTask1Notes = clonedChildTask1Notes.content.doc.textContent;
    expect(duplicatedChildTask1Notes).toEqual("");
    const duplicatedChildTask2Notes = clonedChildTask2Notes.content.doc.textContent;
    expect(duplicatedChildTask2Notes).toEqual(notes + "2");
    const duplicatedChildChildTask1Notes = clonedChildChildTask1Notes.content.doc.textContent;
    expect(duplicatedChildChildTask1Notes).toEqual(notes + "child1");
});

test("cannot duplicate a task without permission", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession();
    const nonOwnerSession = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(ownerSession, {title: "restricted task"});

    // Attempt to duplicate the task with the non-owner session
    await expect(
        duplicateTaskAndAllChildren(
            server.action(nonOwnerSession),
            task.id,
            testTaskClock.now(),
            defaultTimeZone,
        ),
    ).rejects.toThrow(/Actor doesn\u2019t have `Edit` access level/);

    // Verify that the owner can still duplicate the task
    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(
        server.action(ownerSession),
        task.id,
        testTaskClock.now(),
        defaultTimeZone,
    );

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("restricted task (copy)");
});

const longRunningTestTimeout = 20000;
test(
    "cannot duplicate a task with too many direct children",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const server = new TestTaskRealtimeServer(context);
        await server.wait();

        const parentTask = await TestTask.create(session, {title: "parent task"});

        // Create 100 child tasks (exceeding the 100 transaction limit)
        const childTasks = [];
        for (let i = 0; i < 100; i++) {
            const childTask = await TestTask.create(session, {title: `child task ${i}`});
            await childTask.updateParentTask(session, parentTask);
            childTasks.push(childTask);
        }

        await expect(
            duplicateTaskAndAllChildren(
                server.action(session),
                parentTask.id,
                testTaskClock.now(),
                defaultTimeZone,
            ),
        ).rejects.toThrow(/Child task limit exceeded/);
    },
    longRunningTestTimeout,
);

test(
    "cannot duplicate a task with too many nested children",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const server = new TestTaskRealtimeServer(context);
        await server.wait();

        const parentTask = await TestTask.create(session, {title: "parent task"});

        // Create 10 child tasks, each with 10 children (10 + 10 * 10 = 110 tasks)
        const childTasks = [];
        for (let i = 0; i < 10; i++) {
            const childTask = await TestTask.create(session, {title: `child task ${i}`});
            await childTask.updateParentTask(session, parentTask);
            childTasks.push(childTask);

            for (let j = 0; j < 10; j++) {
                const grandchildTask = await TestTask.create(session, {
                    title: `grandchild task ${i}-${j}`,
                });
                await grandchildTask.updateParentTask(session, childTask);
            }
        }

        await expect(
            duplicateTaskAndAllChildren(
                server.action(session),
                parentTask.id,
                testTaskClock.now(),
                defaultTimeZone,
            ),
        ).rejects.toThrow(/Child task limit exceeded/);
    },
    longRunningTestTimeout,
);

test("cannot duplicate a task with too many children + notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const parentTask = await TestTask.create(session, {title: "parent task"});

    // Create 50 child tasks
    const childTasks = [];
    for (let i = 0; i < 50; i++) {
        const childTask = await TestTask.create(session, {title: `child task ${i}`});
        await childTask.updateParentTask(session, parentTask);
        childTasks.push(childTask);
    }

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(
        server.action(session),
        parentTask.id,
        testTaskClock.now(),
        defaultTimeZone,
    );

    // Validate we were able to clone without notes
    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("parent task (copy)");

    // Add notes to all of the child tasks
    for (const childTask of childTasks) {
        await childTask.typeNotes(session, "notes");
    }

    await expect(
        duplicateTaskAndAllChildren(
            server.action(session),
            parentTask.id,
            testTaskClock.now(),
            defaultTimeZone,
        ),
    ).rejects.toThrow(/Child task limit exceeded/);
});
