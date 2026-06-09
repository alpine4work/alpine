import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("updateTaskCommentContent()", () => {
    test("throws error for users that only have view access when trying to update task comments", async () => {
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

        const creatorTaskComment = await task.createComment(creatorSession, "test1");
        const manageTaskComment = await task.createComment(manageSession, "test1");
        const editorTaskComment = await task.createComment(editorSession, "test1");
        const commenterTaskComment = await task.createComment(commenterSession, "test1");
        const viewerTaskComment = await task.createComment(viewerSession, "test1");
        const unauthorizedTaskComment = await task.createComment(unauthorizedSession, "test1");
        const assigneeTaskComment = await task.createComment(assigneeSession, "test1");

        const updatedContent1 = createSimpleMessageContent("updated test1");

        await expect(
            assigneeTaskComment.updateContent(assigneeSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            unauthorizedTaskComment.updateContent(unauthorizedSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            viewerTaskComment.updateContent(viewerSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            creatorTaskComment.updateContent(creatorSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            commenterTaskComment.updateContent(commenterSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            editorTaskComment.updateContent(editorSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            manageTaskComment.updateContent(manageSession, updatedContent1),
        ).resolves.not.toBeNull();

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

        const secondUpdatedTaskComment = createSimpleMessageContent("updated test2");

        await expect(
            assigneeTaskComment.updateContent(assigneeSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            unauthorizedTaskComment.updateContent(unauthorizedSession, secondUpdatedTaskComment),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            viewerTaskComment.updateContent(viewerSession, secondUpdatedTaskComment),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            creatorTaskComment.updateContent(creatorSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            commenterTaskComment.updateContent(commenterSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            editorTaskComment.updateContent(editorSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            manageTaskComment.updateContent(manageSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
    });
});
