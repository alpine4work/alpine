import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskCommentsFromStart} from "~/server/tasks/data/get_task_comments_from_start.js";
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

describe("getTaskCommentsFromStart()", () => {
    test("throws error for users that only have view access when trying to get task comments from start", async () => {
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

        await task.createComment(creatorSession, "test1");
        await task.createComment(creatorSession, "test2");
        await task.createComment(creatorSession, "test3");

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

        await task.updateAssignee(creatorSession, assigneeSession);

        await expect(
            getTaskCommentsFromStart(assigneeSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(unauthorizedSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskCommentsFromStart(viewerSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskCommentsFromStart(commenterSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(editorSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(manageSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(creatorSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();
    });
});
