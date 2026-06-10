import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskNotesContent} from "~/server/tasks/data/get_task_notes_content.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/get_task_notes_content_without_references.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {NotFoundError, PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {emptyTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("getTaskNotesContent()", () => {
    test("gets notes for task without notes", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        expect(await getTaskNotesContentWithoutReferences(session.action(), task.id)).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                version: 0,
                content: emptyTaskNotesContent,
            }),
        );
    });

    test("can\u2019t get notes for task that doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(getTaskNotesContent(session.action(), generateId())).rejects.toThrow(
            NotFoundError,
        );

        await expect(
            getTaskNotesContentWithoutReferences(session.action(), generateId()),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t get notes for task in the wrong space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await otherSpace.createSession();

        const task = await TestTask.create(session);
        const collection = await TestTaskCollection.create(session);
        await collection.access.grantDefault(session);
        await task.addCollection(session, collection);

        await expect(getTaskNotesContent(otherSession.action(), task.id)).rejects.toThrow(
            PermissionDeniedError,
        );

        await expect(
            getTaskNotesContentWithoutReferences(otherSession.action(), task.id),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can get notes for task in public collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        expect(await getTaskNotesContent(session2.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        expect(await getTaskNotesContentWithoutReferences(session2.action(), task.id)).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                version: 0,
                content: emptyTaskNotesContent,
            }),
        );
    });

    test("can\u2019t get notes for task in private collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await task.addCollection(session1, collection);

        await expect(getTaskNotesContent(session2.action(), task.id)).rejects.toThrow(
            PermissionDeniedError,
        );

        await expect(
            getTaskNotesContentWithoutReferences(session2.action(), task.id),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("gets notes as system action", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        expect(await getTaskNotesContent(space.systemAction(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        expect(await getTaskNotesContentWithoutReferences(space.systemAction(), task.id)).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                version: 0,
                content: emptyTaskNotesContent,
            }),
        );
    });

    test("can\u2019t get notes as the wrong system action", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        await expect(getTaskNotesContent(otherSpace.systemAction(), task.id)).rejects.toThrow(
            PermissionDeniedError,
        );

        await expect(
            getTaskNotesContentWithoutReferences(otherSpace.systemAction(), task.id),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t get notes as an anonymous actor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        await expect(getTaskNotesContent(context.anonymousAction(), task.id)).rejects.toThrow(
            UnauthenticatedError,
        );

        await expect(
            getTaskNotesContentWithoutReferences(context.anonymousAction(), task.id),
        ).rejects.toThrow(UnauthenticatedError);
    });
});
