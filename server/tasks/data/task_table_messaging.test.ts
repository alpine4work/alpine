import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    FileTaskAuthorizer,
    authorizeTaskAccess,
    backfillTaskComments,
    createTaskComment,
    deleteTaskComment,
    getTaskComment,
    getTaskCommentPayload,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskCommentsSummaryItemIfExistsForTest,
    getTaskItemForTest,
    updateTaskCommentContent,
} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";

const processContext = createTestContext();

testMessagingImplementation<TaskId>(processContext, {
    async createRoom(context, spaceId) {
        await authorizeSpaceAccess(context, spaceId);

        const [space, account] = await runAllPromises([
            TestSpace.get(processContext, spaceId),
            TestAccount.get(processContext, context.actor.getAccountId()),
        ]);

        const session = await space.createSession(account);
        const taskCollection = await TestTaskCollection.createPublic(session);

        const task = await TestTask.create(session);
        await task.addCollection(session, taskCollection);

        return {
            key: task.id,
            spaceId,
            createdTime: new Date((await task.getItem()).createdTime[0]),
            messageCount: 0,
        };
    },

    async createPrivateRoom(context, spaceId, sessions) {
        await authorizeSpaceAccess(context, spaceId);

        const [space, account] = await runAllPromises([
            TestSpace.get(processContext, spaceId),
            TestAccount.get(processContext, context.actor.getAccountId()),
        ]);

        const session = await space.createSession(account);

        const taskCollection = await TestTaskCollection.createPrivate(session);

        await taskCollection.updateAccessPolicy(session, {
            accountGrantById: new Map<AccountId, {level: AccessLevel}>([
                ...sessions.map(innerSession => {
                    return [innerSession.account.id, {level: "Comment"}] as const;
                }),
                [session.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
        });

        const task = await TestTask.create(session);
        await task.addCollection(session, taskCollection);

        return {
            key: task.id,
            spaceId,
            createdTime: new Date((await task.getItem()).createdTime[0]),
            messageCount: 0,
        };
    },

    async getRoom(context, taskId) {
        const [taskItem, taskItemWithCommentAttributes] = await runAllPromises([
            getTaskItemForTest(context, taskId),
            getTaskCommentsSummaryItemIfExistsForTest(context, taskId),
        ]);

        await authorizeTaskAccess(context, taskId, "Comment");

        return {
            key: taskItem.taskId,
            spaceId: taskItem.spaceId,
            createdTime: new Date(taskItem.createdTime[0]),
            messageCount:
                taskItemWithCommentAttributes !== null
                    ? reduceIterable(
                          taskItemWithCommentAttributes.commentCountByAuthorId.values(),
                          (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                          0,
                      )
                    : 0,
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    getRoomFileAuthorizer(taskId) {
        return FileTaskAuthorizer.bind({type: "TaskComments", taskId});
    },
    async createMessage(
        context,
        {roomKey: taskId, parentMessageIndex: parentCommentIndex, content, fileIds},
    ) {
        const comment = await createTaskComment(context, {
            taskId,
            parentCommentIndex,
            content,
            fileIds,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async getMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return getTaskComment(context, {taskId, commentIndex});
    },
    async getMessagePayload(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return (await getTaskCommentPayload(context, {taskId, commentIndex})).payload;
    },
    async updateMessageContent(context, {roomKey: taskId, messageIndex: commentIndex, content}) {
        return updateTaskCommentContent(context, {
            taskId,
            commentIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return deleteTaskComment(context, {taskId, commentIndex});
    },
    async getMessagesFromStart(
        context,
        {
            roomKey: taskId,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
            await getTaskCommentsFromStart(context, {
                taskId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
            lastMessageChangeTime: lastCommentChangeTime,
        };
    },
    async getMessagesFromEnd(
        context,
        {
            roomKey: taskId,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
            await getTaskCommentsFromEnd(context, {
                taskId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
            lastMessageChangeTime: lastCommentChangeTime,
        };
    },
    async backfillMessages(
        context,
        {
            roomKey: taskId,
            clientMessageCount: clientCommentCount,
            clientLastMessageChangeTime: clientLastCommentChangeTime,
            newMessageLimit: newCommentLimit,
        },
    ) {
        const {
            commentCount,
            lastCommentChangeTime,
            newComments,
            newOtherReferencedComments,
            commentChangesResult,
        } = await backfillTaskComments(context, {
            taskId,
            clientCommentCount,
            clientLastCommentChangeTime,
            newCommentLimit,
        });
        return {
            messageCount: commentCount,
            lastMessageChangeTime: lastCommentChangeTime,
            newMessages: newComments,
            newOtherReferencedMessages: newOtherReferencedComments,
            messageChangesResult: commentChangesResult,
        };
    },
    spacePermissionDeniedErrorMessage: 'Actor does not have "Comment" access level to task',
});
