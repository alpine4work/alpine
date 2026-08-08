import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskOwnerIfPossible} from "~/server/tasks/data/get_task_owner_if_possible.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("getTaskOwnerIfPossible()", () => {
    test("throws error for users without proper access trying to get the Task Owner", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [assigneeSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await expect(getTaskOwnerIfPossible(creatorSession.action(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(getTaskOwnerIfPossible(manageSession.action(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(getTaskOwnerIfPossible(editorSession.action(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(getTaskOwnerIfPossible(assigneeSession.action(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(getTaskOwnerIfPossible(commenterSession.action(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(getTaskOwnerIfPossible(viewerSession.action(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(
            getTaskOwnerIfPossible(unauthorizedSession.action(), task.id),
        ).resolves.toEqual({
            ok: false,
            error: expect.any(PermissionDeniedError),
        });

        await expect(getTaskOwnerIfPossible(space.systemAction(), task.id)).resolves.toEqual(
            expect.objectContaining({ok: true}),
        );

        await expect(getTaskOwnerIfPossible(otherSpace.systemAction(), task.id)).resolves.toEqual({
            ok: false,
            error: expect.any(PermissionDeniedError),
        });
    });
});
