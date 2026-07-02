import {CalendarDate} from "@internationalized/date";
import {updateTaskWithoutNotesFromApi} from "~/server/api/internal/tasks/internal/update_task_without_notes_from_api.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";

const context = TestTaskRealtimeServer.with(
    createTestContext({
        shouldStartOpensearch: true,
        tasksInjection,
    }),
);

describe("updateTaskWithoutNotesFromApi()", () => {
    test("applies a SetTitle patch", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Original Title"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetTitle", title: "Updated Title"}],
            },
        );

        expect(updatedTask.getTitle().getText()).toBe("Updated Title");
    });

    test("applies a SetAssignee patch", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session1),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetAssignee", assignee: {id: session2.account.id}}],
            },
        );

        expect(updatedTask.getAssignee()?.assignee.accountId).toBe(session2.account.id);
    });

    test("clearing the assignee with a null SetAssignee patch deactivates the task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1, {title: "Active Task"});
        await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session1),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetAssignee", assignee: null}],
            },
        );

        expect(updatedTask.getDisplayStatus()).toBe("OpenInactive");
    });

    test("applies a SetStatus patch that closes the task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Open Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetStatus", status: {type: "Closed"}}],
            },
        );

        expect(updatedTask.getDisplayStatus()).toBe("Closed");
    });

    test("applies a SetStatus patch that activates the task and auto-assigns the bot", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Inactive Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetStatus", status: {type: "Open", isActive: true}}],
            },
        );

        expect({
            displayStatus: updatedTask.getDisplayStatus(),
            assigneeId: updatedTask.getAssignee()?.assignee.accountId,
        }).toEqual({displayStatus: "OpenActive", assigneeId: bot.id});
    });

    test("applies a SetDue patch", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetDue", due: {date: "2026-06-15"}}],
            },
        );

        expect(updatedTask.getDueDate()?.toString()).toBe("2026-06-15");
    });

    test("clearing the due date with a null SetDue patch", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {
            title: "Task",
            dueDate: new CalendarDate(2026, 12, 31),
        });

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetDue", due: null}],
            },
        );

        expect(updatedTask.getDueDate()).toBeNull();
    });

    test("applies a SetPriority patch", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetPriority", priority: {type: "High"}}],
            },
        );

        expect(updatedTask.getPriority()).toBe("High");
    });

    test("applies an AddCollection patch", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {name: "Collection"});
        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "AddCollection", item: {collection: {id: collection.id}}}],
            },
        );

        expect(
            updatedTask
                .getCollections()
                .getArray()
                .map(({collectionId}) => collectionId),
        ).toEqual([collection.id]);
    });

    test("applies a RemoveCollection patch", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {name: "Collection"});
        const task = await TestTask.create(session, {title: "Task", collections: collection});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "RemoveCollection", collectionId: collection.id}],
            },
        );

        expect(updatedTask.getCollections().getArray()).toEqual([]);
    });

    test("applies multiple metadata patches in a single request", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1, {title: "Basic Task"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session1),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [
                    {type: "SetTitle", title: "Updated Task"},
                    {type: "SetAssignee", assignee: {id: session2.account.id}},
                    {type: "SetPriority", priority: {type: "Urgent"}},
                    {type: "SetDue", due: {date: "2026-06-15"}},
                ],
            },
        );

        expect({
            title: updatedTask.getTitle().getText(),
            assigneeId: updatedTask.getAssignee()?.assignee.accountId,
            priority: updatedTask.getPriority(),
            dueDate: updatedTask.getDueDate()?.toString(),
        }).toEqual({
            title: "Updated Task",
            assigneeId: session2.account.id,
            priority: "Urgent",
            dueDate: "2026-06-15",
        });
    });

    test("returns the task unchanged when no patches change anything", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Unchanged Title"});

        await ProcessContextModule.waitForTestTasks();

        const {updatedTask} = await updateTaskWithoutNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                spaceId: space.id,
                taskId: task.id,
                patches: [{type: "SetTitle", title: "Unchanged Title"}],
            },
        );

        expect(updatedTask.getTitle().getText()).toBe("Unchanged Title");
    });
});
