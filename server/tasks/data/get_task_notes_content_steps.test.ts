import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskNotesContentSteps} from "~/server/tasks/data/get_task_notes_content_steps.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {TaskNotesContentProsemirrorSchema as schema} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

function textSlice(text: string) {
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

describe("getTaskNotesContentSteps()", () => {
    const clientId1 = generateId<ContentEditorClientId>();
    const clientId2 = generateId<ContentEditorClientId>();

    // Creates a task whose notes have two persisted step transactions:
    //
    // - Versions 0–2 from `clientId1` (a single three-step transaction so a query can
    //   start in the middle of the transaction)
    // - Version 3 from `clientId2` (a single one-step transaction)
    async function createTaskWithNotesStepTransactions() {
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
                new ReplaceStep(3, 3, textSlice("c")),
            ],
            clientId: clientId1,
        });

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 3,
            clientSteps: [new ReplaceStep(4, 4, textSlice("d"))],
            clientId: clientId2,
        });

        return {space, session, task};
    }

    function summarizeSteps(steps: ReadonlyArray<{step: Step; clientId: ContentEditorClientId}>) {
        return steps.map(({step, clientId}) => ({step: step.toJSON(), clientId}));
    }

    function stepEntry(from: number, to: number, text: string, clientId: ContentEditorClientId) {
        return {step: new ReplaceStep(from, to, textSlice(text)).toJSON(), clientId};
    }

    test("returns every step in the validated range", async () => {
        const {session, task} = await createTaskWithNotesStepTransactions();

        const steps = await getTaskNotesContentSteps(session.action(), {
            taskId: task.id,
            startVersion: 0,
            endVersion: 4,
        });

        expect(summarizeSteps(steps)).toEqual([
            stepEntry(1, 1, "a", clientId1),
            stepEntry(2, 2, "b", clientId1),
            stepEntry(3, 3, "c", clientId1),
            stepEntry(4, 4, "d", clientId2),
        ]);
    });

    test("returns only the steps inside a sub-range", async () => {
        const {session, task} = await createTaskWithNotesStepTransactions();

        const steps = await getTaskNotesContentSteps(session.action(), {
            taskId: task.id,
            startVersion: 1,
            endVersion: 3,
        });

        expect(summarizeSteps(steps)).toEqual([
            stepEntry(2, 2, "b", clientId1),
            stepEntry(3, 3, "c", clientId1),
        ]);
    });

    test("throws when the start version is less than zero", async () => {
        const {session, task} = await createTaskWithNotesStepTransactions();

        await expect(
            getTaskNotesContentSteps(session.action(), {
                taskId: task.id,
                startVersion: -1,
                endVersion: 1,
            }),
        ).rejects.toThrow("Start version is less than zero");
    });

    test("throws when the start version is greater than the end version", async () => {
        const {session, task} = await createTaskWithNotesStepTransactions();

        await expect(
            getTaskNotesContentSteps(session.action(), {
                taskId: task.id,
                startVersion: 3,
                endVersion: 1,
            }),
        ).rejects.toThrow("Start version is greater than end version");
    });

    test("throws when the start version is equal to the end version", async () => {
        const {session, task} = await createTaskWithNotesStepTransactions();

        await expect(
            getTaskNotesContentSteps(session.action(), {
                taskId: task.id,
                startVersion: 2,
                endVersion: 2,
            }),
        ).rejects.toThrow("Start version is equal to end version");
    });

    test("throws when the end version is greater than the current notes version", async () => {
        const {session, task} = await createTaskWithNotesStepTransactions();

        await expect(
            getTaskNotesContentSteps(session.action(), {
                taskId: task.id,
                startVersion: 0,
                endVersion: 5,
            }),
        ).rejects.toThrow("End version is greater than the last version of the task notes");
    });

    test("throws when the actor doesn\u2019t have access to the task", async () => {
        const {space, task} = await createTaskWithNotesStepTransactions();
        const otherSession = await space.createSession();

        await expect(
            getTaskNotesContentSteps(otherSession.action(), {
                taskId: task.id,
                startVersion: 0,
                endVersion: 4,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
