import {addMinutes} from "date-fns";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {backfillTaskComments} from "~/server/tasks/data/backfill_task_comments.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {generateServerSynchronizationCheckpointForTest} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("backfillTaskComments()", () => {
    test("throws error for users that only have view access when trying to get task comments from backfill", async () => {
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

        await task.createComment(editorSession, "test1");

        await task.createComment(manageSession, "test1");

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

        expect(
            await backfillTaskComments(creatorSession.action(), {
                taskId: task.id,
                checkpoint: generateServerSynchronizationCheckpointForTest(),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        const updatedMessageContent1 = createSimpleMessageContent("updated test1");

        await creatorTaskComment.updateContent(creatorSession, updatedMessageContent1);

        expect(
            await backfillTaskComments(assigneeSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        expect(
            await backfillTaskComments(manageSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        expect(
            await backfillTaskComments(editorSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        expect(
            await backfillTaskComments(commenterSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        await expect(
            backfillTaskComments(viewerSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            backfillTaskComments(unauthorizedSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
