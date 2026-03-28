import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {updateTaskNotesFromApi} from "~/server/api/internal/tasks/internal/update_task_notes_from_api.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {
    TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema,
    TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

// The number of `update-content-with-diff` requests the stubbed
// `TaskNotesCollaborationService` Durable Object has received during the current
// test. Reset before each test.
let updateContentRequestCount = 0;

// When set, the stubbed `TaskNotesCollaborationService` Durable Object responds to
// `update-content-with-diff` requests with this error instead of echoing the
// content back. Reset before each test.
let updateContentErrorOverride: unknown;

const context = TestTaskRealtimeServer.with(
    createTestContext({
        shouldStartOpensearch: true,
        tasksInjection,
        // `updateTaskNotesFromApi()` sends notes updates to the
        // `TaskNotesCollaborationService` Durable Object. We don't care about exercising
        // the diffing/persistence behavior here (it's owned and tested elsewhere), so
        // stand in for that service by echoing the requested content back as the newly
        // persisted content.
        sendRequestToDurableObject: async (actualContext, request) => {
            if (
                !/^\/api\/durable-objects\/task-notes\/[^/]+\/update-content-with-diff/.test(
                    request.url,
                )
            ) {
                return;
            }

            updateContentRequestCount++;

            const requestBody =
                TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema.deserialize(
                    request.body ?? null,
                );

            if (updateContentErrorOverride !== undefined) {
                return TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema.serialize({
                    ok: false,
                    error: updateContentErrorOverride,
                });
            }

            const newContent = assertTaskNotesContent(
                TaskNotesContentProsemirrorSchema.nodes.doc.create(null, requestBody.content),
            );

            return TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema.serialize({
                ok: true,
                spaceId: (actualContext as ApiServiceBotActionContext).actor.getSpaceId(),
                newVersion: requestBody.version + 1,
                newContent,
            });
        },
    }),
);

describe("updateTaskNotesFromApi()", () => {
    beforeEach(() => {
        updateContentRequestCount = 0;
        updateContentErrorOverride = undefined;
    });

    test("applies a notes patch and returns the updated notes", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        const notesUpdate = await updateTaskNotesFromApi(
            context.getTaskRealtimeServer().botAction(bot, session),
            {
                taskId: task.id,
                patch: {
                    version: 0,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Updated notes"}],
                            },
                        ],
                    },
                },
            },
        );

        expect(notesUpdate).toMatchObject({
            spaceId: space.id,
            notes: {
                version: 1,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Updated notes"}],
                        },
                    ],
                },
            },
        });
    });

    test("rejects structurally valid content that the task notes schema doesn\u2019t support", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        // A `FileFloat` is well-formed API content, but the task notes content schema
        // intentionally omits the `fileFloat` node (it's only allowed in documents). So
        // parsing it should surface as a client error instead of an internal error.
        await expect(
            updateTaskNotesFromApi(context.getTaskRealtimeServer().botAction(bot, session), {
                taskId: task.id,
                patch: {
                    version: 0,
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Left",
                                element: {type: "File", file: {id: unknownFileId}},
                            },
                        ],
                    },
                },
            }),
        ).rejects.toThrow("Received invalid task notes content");
    });

    test("doesn\u2019t send invalid content to the collaboration service", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        await updateTaskNotesFromApi(context.getTaskRealtimeServer().botAction(bot, session), {
            taskId: task.id,
            patch: {
                version: 0,
                content: {
                    elements: [
                        {
                            type: "FileFloat",
                            side: "Left",
                            element: {type: "File", file: {id: unknownFileId}},
                        },
                    ],
                },
            },
        }).catch(() => undefined);

        expect(updateContentRequestCount).toBe(0);
    });

    test("propagates an error returned by the task notes collaboration service", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session, {title: "Task"});

        await ProcessContextModule.waitForTestTasks();

        updateContentErrorOverride = new FailedPreconditionError("Notes are out of date.");

        await expect(
            updateTaskNotesFromApi(context.getTaskRealtimeServer().botAction(bot, session), {
                taskId: task.id,
                patch: {
                    version: 0,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Updated notes"}],
                            },
                        ],
                    },
                },
            }),
        ).rejects.toThrow("Notes are out of date.");
    });
});
