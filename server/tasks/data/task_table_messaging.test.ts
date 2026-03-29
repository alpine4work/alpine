import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/suite/test_messaging_implementation.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    FileTaskAuthorizer,
    authorizeTaskAccess,
    backfillTaskComments,
    completeTaskCommentStream,
    createTaskComment,
    deleteTaskComment,
    deleteTaskCommentReaction,
    getTaskComment,
    getTaskCommentParentContent,
    getTaskCommentPayload,
    getTaskCommentPayloadsFromEnd,
    getTaskCommentPayloadsFromStart,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskCommentsSummaryItemIfExistsForTest,
    getTaskItemForTest,
    pingTaskCommentStream,
    putTaskCommentStreamPart,
    setTaskCommentReaction,
    updateTaskCommentContent,
} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";

const processContext = createTestContext({
    tasksInjection,
    notificationsInjection: {
        archiveInboxTaskEntryAfterSetTaskCommentReaction: async () => {},
    },
});

testMessagingImplementation<TaskId>(processContext, {
    async createRoom(context, spaceId) {
        await authorizeSpaceAccess(context, spaceId);

        const [space, account] = await runAllPromises([
            TestSpace.get(processContext, spaceId),
            TestAccount.get(processContext, context.actor.getAccountId()),
        ]);

        const session = await space.createSession(account);
        const taskCollection = await TestTaskCollection.create(session);
        await taskCollection.access.grantDefault(session);

        const task = await TestTask.create(session);
        await task.addCollection(session, taskCollection);

        return {
            key: task.id,
            spaceId,
            createdTime: new Date((await task.getItem()).createdTime[0]),
            messageCount: 0,
            messageNoun: "comment",
        };
    },

    async createPrivateRoom(context, spaceId, {insideSessions, insideViewerSession}) {
        await authorizeSpaceAccess(context, spaceId);

        const [space, account] = await runAllPromises([
            TestSpace.get(processContext, spaceId),
            TestAccount.get(processContext, context.actor.getAccountId()),
        ]);

        const session = await space.createSession(account);

        const taskCollection = await TestTaskCollection.create(session);

        let count = 0;

        await taskCollection.access.set(session, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                ...insideSessions.map((insideSession): [AccountId, AccessPolicyAccountGrant] => [
                    insideSession.accountId,
                    insideSession.accountId === context.actor.getAccountId()
                        ? {level: "Manage", generation: 0}
                        : {level: (["Comment", "Edit"] as const)[count++ % 2]!},
                ]),
                ...(insideViewerSession
                    ? [[insideViewerSession.accountId, {level: "View"}] as const]
                    : []),
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const task = await TestTask.create(session);
        await task.addCollection(session, taskCollection);

        return {
            key: task.id,
            spaceId,
            createdTime: new Date((await task.getItem()).createdTime[0]),
            messageCount: 0,
            messageNoun: "comment",
            doesInsideViewerSessionHaveRoomAccess: false,
            revokeInsideSession: async (context, revokeSession) => {
                await taskCollection.access.revoke(session, revokeSession.account.id);
            },
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
                    ? sumIterable(taskItemWithCommentAttributes.commentCountByAuthorId.values())
                    : 0,
            messageNoun: "comment",
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    getRoomFileAuthorizer(taskId) {
        return FileTaskAuthorizer.bind({type: "TaskComments", taskId});
    },
    getRoomBotScope(taskId) {
        return {type: "Task", taskId};
    },
    async createMessage(
        context,
        {roomKey: taskId, parent, content, fileIds, isStream, createdTimeZone},
    ) {
        const comment = await createTaskComment(context, {
            taskId,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async pingMessageStream(context, {roomKey: taskId, messageIndex}) {
        return pingTaskCommentStream(context, {taskId, commentIndex: messageIndex});
    },
    async putMessageStreamPart(
        context,
        {roomKey: taskId, messageIndex: commentIndex, partIndex, payload, isTimeoutErrorCompletion},
    ) {
        return await putTaskCommentStreamPart(context, {
            taskId,
            commentIndex,
            partIndex,
            payload,
            isTimeoutErrorCompletion,
        });
    },
    async completeMessageStream(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return completeTaskCommentStream(context, {
            taskId,
            commentIndex,
        });
    },
    async getMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return getTaskComment(context, {taskId, commentIndex});
    },
    async getMessagePayload(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return getTaskCommentPayload(context, {taskId, commentIndex});
    },
    async getMessageParentContent(context, {roomKey: taskId, parent}) {
        return getTaskCommentParentContent(context, taskId, {parent});
    },
    async updateMessageContent(
        context,
        {roomKey: taskId, messageIndex: commentIndex, contentVersion, steps},
    ) {
        return updateTaskCommentContent(context, {
            taskId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    async deleteMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return deleteTaskComment(context, {taskId, commentIndex});
    },
    async setMessageReaction(
        context,
        {roomKey: taskId, messageIndex: commentIndex, contentVersion, pos, reaction},
    ) {
        return setTaskCommentReaction(context, {
            taskId,
            commentIndex,
            contentVersion,
            pos,
            reaction,
        });
    },
    async deleteMessageReaction(
        context,
        {roomKey: taskId, messageIndex: commentIndex, contentVersion, pos},
    ) {
        return deleteTaskCommentReaction(context, {
            taskId,
            commentIndex,
            contentVersion,
            pos,
        });
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
        const {commentCount, comments, otherReferencedComments} = await getTaskCommentsFromStart(
            context,
            {
                taskId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            },
        );
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
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
        const {commentCount, comments, otherReferencedComments} = await getTaskCommentsFromEnd(
            context,
            {
                taskId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            },
        );
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
        };
    },
    async getMessagePayloadsFromStart(
        context,
        {roomKey: taskId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const {commentCount, comments} = await getTaskCommentPayloadsFromStart(context, {
            taskId,
            limit,
            afterCommentIndex: afterMessageIndex,
            beforeCommentIndex: beforeMessageIndex,
        });
        return {messageCount: commentCount, messages: comments};
    },
    async getMessagePayloadsFromEnd(
        context,
        {roomKey: taskId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const {commentCount, comments} = await getTaskCommentPayloadsFromEnd(context, {
            taskId,
            limit,
            afterCommentIndex: afterMessageIndex,
            beforeCommentIndex: beforeMessageIndex,
        });
        return {messageCount: commentCount, messages: comments};
    },
    async backfillMessages(
        context,
        {
            roomKey: taskId,
            checkpoint,
            clientMessageCount: clientCommentCount,
            newMessageLimit: newCommentLimit,
        },
    ) {
        const {commentCount, newComments, newOtherReferencedComments, commentUpdatesResult} =
            await backfillTaskComments(context, {
                taskId,
                checkpoint,
                clientCommentCount,
                newCommentLimit,
            });
        return {
            messageCount: commentCount,
            newMessages: newComments,
            newOtherReferencedMessages: newOtherReferencedComments,
            messageUpdatesResult: commentUpdatesResult,
        };
    },
});
