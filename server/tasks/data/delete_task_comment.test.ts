import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {deleteTaskComment} from "~/server/tasks/data/delete_task_comment.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("deleteTaskComment()", () => {
    test("throws error for users that only have view access when trying to delete task comments", async () => {
        const space = await TestSpace.create(context);

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

        await task.updateAssignee(creatorSession, assigneeSession);

        const creatorTaskComment = await task.createComment(creatorSession, "test1");

        const manageTaskComment = await task.createComment(manageSession, "test1");
        const editorTaskComment = await task.createComment(editorSession, "test1");
        const commenterTaskComment = await task.createComment(commenterSession, "test1");
        const viewerTaskComment = await task.createComment(viewerSession, "test1");
        const unauthorizedTaskComment = await task.createComment(unauthorizedSession, "test1");
        const assigneeTaskComment = await task.createComment(assigneeSession, "test1");

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await expect(
            deleteTaskComment(assigneeSession.action(), {
                taskId: task.id,
                commentIndex: assigneeTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(commenterSession.action(), {
                taskId: task.id,
                commentIndex: commenterTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(editorSession.action(), {
                taskId: task.id,
                commentIndex: editorTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(manageSession.action(), {
                taskId: task.id,
                commentIndex: manageTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(creatorSession.action(), {
                taskId: task.id,
                commentIndex: creatorTaskComment.index,
            }),
        ).resolves.not.toBeNull();

        await expect(
            deleteTaskComment(unauthorizedSession.action(), {
                taskId: task.id,
                commentIndex: unauthorizedTaskComment.index,
            }),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            deleteTaskComment(viewerSession.action(), {
                taskId: task.id,
                commentIndex: viewerTaskComment.index,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
