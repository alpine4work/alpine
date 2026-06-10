import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createTaskComment} from "~/server/tasks/data/create_task_comment.js";
import {getTaskComment} from "~/server/tasks/data/get_task_comment.js";
import {getTaskCommentPayload} from "~/server/tasks/data/get_task_comment_payload.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("getTaskComment()", () => {
    test("throws error for users that only have view access when trying to access task comments", async () => {
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

        const content1 = createSimpleMessageContent("test1");
        const taskComment = await createTaskComment(context.action(creatorSession), {
            taskId: task.id,
            parent: null,
            content: content1,
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        });

        const collection = await TestTaskCollection.create(creatorSession);

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

        await task.addCollection(creatorSession, collection);

        await expect(
            getTaskComment(assigneeSession.action(), {
                taskId: task.id,
                commentIndex: taskComment.index,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await task.updateAssignee(creatorSession, assigneeSession);

        const taskCommentIdAndIndex = {
            taskId: task.id,
            commentIndex: taskComment.index,
        };

        await expect(
            getTaskComment(assigneeSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();

        await expect(
            getTaskComment(unauthorizedSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(getTaskComment(viewerSession.action(), taskCommentIdAndIndex)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(
            getTaskComment(commenterSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskComment(editorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskComment(manageSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskComment(creatorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentPayload(unauthorizedSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getTaskCommentPayload(viewerSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getTaskCommentPayload(commenterSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskCommentPayload(editorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskCommentPayload(manageSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskCommentPayload(creatorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
    });
});
