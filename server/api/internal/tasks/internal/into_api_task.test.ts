import {CalendarDate} from "@internationalized/date";
import {intoApiTask} from "~/server/api/internal/tasks/internal/into_api_task.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";

const baseContext = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

const context = TestTaskRealtimeServer.with(baseContext);
const taskNoteKey = new ApiContentKeyEncoder({
    entityId: `Task:${generateId<TaskId>()}`,
    version: 0,
}).encode({pos: 0, nodeSize: 1});

const notes: ApiSpecification.components["schemas"]["TaskNotes_Response"] = {
    version: 0,
    content: {
        elements: [
            {
                type: "Paragraph",
                key: taskNoteKey,
                elements: [{type: "Text", text: "Hello from task notes"}],
            },
        ],
    },
};

test("intoApiTask serializes a fully populated task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const task = await TestTask.create(session1, {title: "Detailed Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});
    await task.updateDueDate(session1, new CalendarDate(2026, 12, 31));
    await task.updatePriority(session1, "High");

    await ProcessContextModule.waitForTestTasks();

    const taskModel = await context
        .getTaskRealtimeServer()
        .action(session1)
        .tasks.getTaskWithoutDependencies(space.id, task.id, {
            consistency: "StrongWithinCache",
        });

    expect(await intoApiTask(session1.action(), taskModel, notes)).toEqual({
        id: task.id,
        creator: {id: session1.account.id},
        status: {type: "Open", isActive: true},
        title: "Detailed Task",
        assignee: {
            id: session2.account.id,
            name: "Bob Johnson",
            shortName: "Bob",
            space: {
                addedTime: expect.any(String),
                role: "Member",
            },
        },
        due: {date: "2026-12-31"},
        priority: "High",
        notes,
    });
});

test("intoApiTask omits optional fields for a minimal task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const task = await TestTask.create(session, {title: "Minimal Task"});

    await ProcessContextModule.waitForTestTasks();

    const taskModel = await context
        .getTaskRealtimeServer()
        .action(session)
        .tasks.getTaskWithoutDependencies(space.id, task.id, {
            consistency: "StrongWithinCache",
        });

    expect(await intoApiTask(session.action(), taskModel, notes)).toEqual({
        id: task.id,
        creator: {id: session.account.id},
        status: {type: "Open", isActive: false},
        title: "Minimal Task",
        assignee: undefined,
        due: undefined,
        priority: undefined,
        notes,
    });
});
