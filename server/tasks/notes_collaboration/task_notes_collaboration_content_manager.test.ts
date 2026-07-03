import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/get_task_notes_content_without_references.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {TaskNotesCollaborationContentManager} from "~/server/tasks/notes_collaboration/task_notes_collaboration_content_manager.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {TaskNotesContentProsemirrorSchema as schema} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestWorkerContext({documentsInjection});

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

describe("TaskNotesCollaborationContentManager", () => {
    test("loads content at an earlier version", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session);

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId: generateId(),
        });

        const taskNotes = await getTaskNotesContentWithoutReferences(session.action(), task.id);
        const contentManager = new TaskNotesCollaborationContentManager({
            spaceId: space.id,
            taskId: task.id,
            initialVersion: taskNotes.version,
            initialContent: taskNotes.content,
            sendEventToAllAndWait: async () => {},
            killProcess: () => {},
        });

        expect(await contentManager.getContentAtVersion(context.action(session), 1)).toMatchObject({
            textContent: "a",
        });
    });

    test("rejects content requests for future versions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session);
        const taskNotes = await getTaskNotesContentWithoutReferences(session.action(), task.id);
        const contentManager = new TaskNotesCollaborationContentManager({
            spaceId: space.id,
            taskId: task.id,
            initialVersion: taskNotes.version,
            initialContent: taskNotes.content,
            sendEventToAllAndWait: async () => {},
            killProcess: () => {},
        });

        await expect(
            contentManager.getContentAtVersion(context.action(session), 1),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("returns updated content with a persistence promise", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session);
        const taskNotes = await getTaskNotesContentWithoutReferences(session.action(), task.id);
        const contentManager = new TaskNotesCollaborationContentManager({
            spaceId: space.id,
            taskId: task.id,
            initialVersion: taskNotes.version,
            initialContent: taskNotes.content,
            sendEventToAllAndWait: async () => {},
            killProcess: () => {},
        });

        const result = await contentManager.update(context.action(session), null, {
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("Updated notes"))],
            clientId: generateId(),
        });

        await result.persistencePromise;

        expect({
            newVersion: result.newVersion,
            newContentText: result.newContent.textContent,
        }).toEqual({
            newVersion: 1,
            newContentText: "Updated notes",
        });
    });
});
