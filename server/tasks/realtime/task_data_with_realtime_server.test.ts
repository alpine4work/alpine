import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {duplicateTaskAndAllChildren} from "~/server/tasks/data/duplicate_task_and_all_children.js";
import {getTaskNotesContent} from "~/server/tasks/data/get_task_notes_content.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ContentDuplicationVariableValues} from "~/shared/content/content_duplication_variable_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
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

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

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

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

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

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

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
    // This is a more exhaustive test case that covers the full range of possible task
    // duplication scenarios, including notes and nested children.

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

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

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

test("can duplicate a task with variable substitution in title", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "Hello {{Name}}"});

    const variableValues: ContentDuplicationVariableValues = new Map([
        ["Name", {type: "Text", text: "World", marks: []}],
    ]);

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
        variableValues,
    });

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    // Variable should be replaced in the title, and no "(copy)" suffix since title
    // changed
    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("Hello World");
});

test("can duplicate a task with variable substitution in notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "Task Title"});
    await task.typeNotes(session, "Hello {{Name}}, welcome to {{Place}}!");

    const variableValues: ContentDuplicationVariableValues = new Map([
        ["Name", {type: "Text", text: "Alice", marks: []}],
        ["Place", {type: "Text", text: "Wonderland", marks: []}],
    ]);

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
        variableValues,
    });

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    // Title gets (copy) suffix since it wasn't changed by variables
    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("Task Title (copy)");

    // Notes should have variables replaced
    const clonedTaskNotes = await getTaskNotesContent(session.action(), clonedTaskId);
    const clonedNotesText = clonedTaskNotes.content.doc.textContent;
    expect(clonedNotesText).toEqual("Hello Alice, welcome to Wonderland!");
});

test("can duplicate a task with variable substitution in both title and notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "Task for {{Name}}"});
    await task.typeNotes(session, "Welcome {{Name}} to this task!");

    const variableValues: ContentDuplicationVariableValues = new Map([
        ["Name", {type: "Text", text: "Bob", marks: []}],
    ]);

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
        variableValues,
    });

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    // Both title and notes should have variables replaced
    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("Task for Bob");

    const clonedTaskNotes = await getTaskNotesContent(session.action(), clonedTaskId);
    const clonedNotesText = clonedTaskNotes.content.doc.textContent;
    expect(clonedNotesText).toEqual("Welcome Bob to this task!");
});

test("variable substitution only applies to root task, not children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    // Create parent task with variable in title and notes
    const parentTask = await TestTask.create(session, {title: "Parent {{Name}}"});
    await parentTask.typeNotes(session, "Parent notes: {{Name}}");

    // Create child task with same variable pattern
    const childTask = await TestTask.create(session, {title: "Child {{Name}}"});
    await childTask.typeNotes(session, "Child notes: {{Name}}");
    await childTask.updateParentTask(session, parentTask);

    const variableValues: ContentDuplicationVariableValues = new Map([
        ["Name", {type: "Text", text: "Replaced", marks: []}],
    ]);

    const {taskId: clonedParentId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: parentTask.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
        variableValues,
    });

    const clonedParent = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedParentId),
    );

    // Parent task should have variables replaced
    expect(getTaskTitleText(clonedParent.title.raw)).toEqual("Parent Replaced");

    const clonedParentNotes = await getTaskNotesContent(session.action(), clonedParentId);
    const clonedParentNotesText = clonedParentNotes.content.doc.textContent;
    expect(clonedParentNotesText).toEqual("Parent notes: Replaced");

    // Find the cloned child task
    const {tasks: clonedChildTasks} = await server.loadQuery(session, {
        filters: {
            displayStatusFilter: {ifOpenInactive: true, ifOpenActive: true, ifClosed: true},
            parentFilter: {parentTaskId: clonedParentId},
        },
        sorts: [{type: "CreatedTime", direction: "Ascending", missing: "Last"}],
    });

    expect(clonedChildTasks.length).toEqual(1);
    const clonedChild = clonedChildTasks[0]!;

    // Child task should NOT have variables replaced - they stay as {{Name}}
    expect(getTaskTitleText(clonedChild.title.raw)).toEqual("Child {{Name}}");

    const clonedChildNotes = await getTaskNotesContent(session.action(), clonedChild.id);
    const clonedChildNotesText = clonedChildNotes.content.doc.textContent;
    expect(clonedChildNotesText).toEqual("Child notes: {{Name}}");
});

test("variable substitution works when duplicating a child task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    // Create parent task
    const parentTask = await TestTask.create(session, {title: "Parent Task"});

    // Create child task with variable
    const childTask = await TestTask.create(session, {title: "Child {{Name}}"});
    await childTask.typeNotes(session, "Child notes: {{Name}}");
    await childTask.updateParentTask(session, parentTask);

    const variableValues: ContentDuplicationVariableValues = new Map([
        ["Name", {type: "Text", text: "Duplicated", marks: []}],
    ]);

    // Duplicate the child task directly (not the parent)
    const {taskId: clonedChildId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: childTask.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
        variableValues,
    });

    const clonedChild = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedChildId),
    );

    // The duplicated child should have variables replaced since it's the root of
    // duplication
    expect(getTaskTitleText(clonedChild.title.raw)).toEqual("Child Duplicated");

    const clonedChildNotes = await getTaskNotesContent(session.action(), clonedChildId);
    const clonedNotesText = clonedChildNotes.content.doc.textContent;
    expect(clonedNotesText).toEqual("Child notes: Duplicated");
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
        duplicateTaskAndAllChildren(server.action(nonOwnerSession), {
            sourceTaskId: task.id,
            actionTime: testTaskClock.now(),
            timeZone: defaultTimeZone,
        }),
    ).rejects.toThrow(/Actor doesn\u2019t have `Edit` access level/);

    // Verify that the owner can still duplicate the task
    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(ownerSession), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

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
            duplicateTaskAndAllChildren(server.action(session), {
                sourceTaskId: parentTask.id,
                actionTime: testTaskClock.now(),
                timeZone: defaultTimeZone,
            }),
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

        // Create 10 child tasks, each with 10 children (10 + 10 \* 10 = 110 tasks)
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
            duplicateTaskAndAllChildren(server.action(session), {
                sourceTaskId: parentTask.id,
                actionTime: testTaskClock.now(),
                timeZone: defaultTimeZone,
            }),
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

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: parentTask.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

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
        duplicateTaskAndAllChildren(server.action(session), {
            sourceTaskId: parentTask.id,
            actionTime: testTaskClock.now(),
            timeZone: defaultTimeZone,
        }),
    ).rejects.toThrow(/Child task limit exceeded/);
});

test("can duplicate a task with files in notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    const task = await TestTask.create(session, {title: "Task with file"});

    // Create and attach a file to the task notes
    const file = await TestFile.create(session);
    await task.attachFile(session, file);

    const {taskId: clonedTaskId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: task.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

    const clonedTask = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedTaskId),
    );

    expect(getTaskTitleText(clonedTask.title.raw)).toEqual("Task with file (copy)");

    // Verify the file is in the cloned task's notes
    const clonedNotesContent = await getTaskNotesContent(session.action(), clonedTaskId);
    expect(clonedNotesContent).not.toBeNull();

    // Verify the file is attached to the new task (can be accessed through the new
    // task)
    const fileFromNewTask = await file.from(
        session,
        FileTaskAuthorizer.bind({type: "TaskNotes", taskId: clonedTaskId}),
    );
    expect(fileFromNewTask.id).toBe(file.id);
});

test("can duplicate a task with subtasks that have files in notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    // Create parent task with a file
    const parentTask = await TestTask.create(session, {title: "Parent task"});
    const parentFile = await TestFile.create(session);
    await parentTask.attachFile(session, parentFile);

    // Create child task with a file
    const childTask = await TestTask.create(session, {title: "Child task"});
    const childFile = await TestFile.create(session);
    await childTask.attachFile(session, childFile);
    await childTask.updateParentTask(session, parentTask);

    const {taskId: clonedParentId} = await duplicateTaskAndAllChildren(server.action(session), {
        sourceTaskId: parentTask.id,
        actionTime: testTaskClock.now(),
        timeZone: defaultTimeZone,
    });

    // Verify cloned parent task
    const clonedParent = assertExists(
        await getTaskIndexDocIfExistsForTest(context, space.id, clonedParentId),
    );
    expect(getTaskTitleText(clonedParent.title.raw)).toEqual("Parent task (copy)");

    // Verify file is attached to cloned parent
    const parentFileFromClone = await parentFile.from(
        session,
        FileTaskAuthorizer.bind({type: "TaskNotes", taskId: clonedParentId}),
    );
    expect(parentFileFromClone.id).toBe(parentFile.id);

    // Find cloned child task
    const {tasks: clonedChildTasks} = await server.loadQuery(session, {
        filters: {
            displayStatusFilter: {ifOpenInactive: true, ifOpenActive: true, ifClosed: true},
            parentFilter: {parentTaskId: clonedParentId},
        },
        sorts: [
            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
    });

    expect(clonedChildTasks.length).toEqual(1);
    const clonedChildTask = clonedChildTasks[0]!;
    expect(clonedChildTask.id).not.toEqual(childTask.id);
    expect(getTaskTitleText(clonedChildTask.title.raw)).toEqual("Child task");

    // Verify file is attached to cloned child task
    const childFileFromClone = await childFile.from(
        session,
        FileTaskAuthorizer.bind({type: "TaskNotes", taskId: clonedChildTask.id}),
    );
    expect(childFileFromClone.id).toBe(childFile.id);
});
