import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createTaskComment} from "~/server/tasks/data/create_task_comment.js";
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

describe("createTaskComment()", () => {
    test("throws error for users that only have view access when trying to create task comments", async () => {
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
        const taskCommentDetails = {
            taskId: task.id,
            parent: null,
            content: content1,
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        };

        const collection = await TestTaskCollection.create(creatorSession);
        await task.addCollection(creatorSession, collection);

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
            createTaskComment(assigneeSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
        await expect(
            createTaskComment(unauthorizedSession.action(), taskCommentDetails),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(createTaskComment(viewerSession.action(), taskCommentDetails)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(
            createTaskComment(commenterSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
        await expect(
            createTaskComment(editorSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
        await expect(
            createTaskComment(manageSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
    });
});
