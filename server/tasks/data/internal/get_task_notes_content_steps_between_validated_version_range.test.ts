import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskNotesContentStepsBetweenValidatedVersionRange} from "~/server/tasks/data/internal/get_task_notes_content_steps_between_validated_version_range.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.open_source.js";
import {TaskNotesContentProsemirrorSchema as schema} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

function textSlice(text: string) {
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

describe("getTaskNotesContentStepsBetweenValidatedVersionRange()", () => {
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

        return {session, task};
    }

    function summarizeSteps(steps: ReadonlyArray<{step: Step; clientId: ContentEditorClientId}>) {
        return steps.map(({step, clientId}) => ({step: step.toJSON(), clientId}));
    }

    function stepEntry(from: number, to: number, text: string, clientId: ContentEditorClientId) {
        return {step: new ReplaceStep(from, to, textSlice(text)).toJSON(), clientId};
    }

    const rangeTestCases = [
        {
            name: "returns every step across both transactions for the full range",
            startVersion: 0,
            endVersion: 4,
            expected: [
                stepEntry(1, 1, "a", clientId1),
                stepEntry(2, 2, "b", clientId1),
                stepEntry(3, 3, "c", clientId1),
                stepEntry(4, 4, "d", clientId2),
            ],
        },
        {
            name: "returns only the steps inside a sub-range of a single transaction",
            startVersion: 1,
            endVersion: 3,
            expected: [stepEntry(2, 2, "b", clientId1), stepEntry(3, 3, "c", clientId1)],
        },
        {
            name: "returns steps spanning two transactions when starting mid-transaction",
            startVersion: 2,
            endVersion: 4,
            expected: [stepEntry(3, 3, "c", clientId1), stepEntry(4, 4, "d", clientId2)],
        },
    ];

    rangeTestCases.forEach(({name, startVersion, endVersion, expected}) => {
        test(`${name}`, async () => {
            const {session, task} = await createTaskWithNotesStepTransactions();

            const steps = await getTaskNotesContentStepsBetweenValidatedVersionRange(
                session.action(),
                {taskId: task.id, startVersion, endVersion},
            );

            expect(summarizeSteps(steps)).toEqual(expected);
        });
    });

    test("throws a DataLossError when a step in the range hasn\u2019t been persisted", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session);

        await expect(
            getTaskNotesContentStepsBetweenValidatedVersionRange(session.action(), {
                taskId: task.id,
                startVersion: 0,
                endVersion: 1,
            }),
        ).rejects.toThrow("Missing a task notes step");
    });

    test("throws a DataLossError when a step is missing its inverted step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session);

        await TaskTable.createItem(session.action(), {
            partitionType: "Task",
            sortRangeType: "NotesStepTransactionsBeforeSnapshot",
            taskId: task.id,
            startVersion: 0,
            createdTime: new Date(),
            steps: [new ReplaceStep(1, 1, textSlice("a"))],
            invertedSteps: [],
            clientId: clientId1,
            accountId: null,
            fromBotAccountId: null,
        });

        await expect(
            getTaskNotesContentStepsBetweenValidatedVersionRange(session.action(), {
                taskId: task.id,
                startVersion: 0,
                endVersion: 1,
            }),
        ).rejects.toThrow("Missing inverted task notes step");
    });
});
