import {TestMessage} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {InboxTaskEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxTaskEntryModel({
    session,
    task,
    isArchived = false,
    loudNotificationCount = 0,
    latestComment,
    otherCommentAuthor = null,
}: {
    session: TestSpaceSession;
    task:
        | {task: TestTask; taskOwner: TestSpaceSession; isPrivate?: false}
        | {isPrivate: true; taskId: TaskId};
    isArchived?: boolean;
    loudNotificationCount?: number;
    latestComment: {
        comment: TestMessage;
        contentTextSnippet: string;
        isStickyMention?: boolean;
    };
    otherCommentAuthor?: TestSession | TestAccount | null;
}) {
    return new InboxTaskEntryModel({
        isArchived,
        spaceId: latestComment.comment.space.id,
        accountId: session.account.id,
        task: task.isPrivate
            ? {isPrivate: true, taskId: task.taskId}
            : {
                  isPrivate: false,
                  taskId: task.task.id,
                  taskOwner: expect.objectContaining({id: task.taskOwner.account.id}),
              },
        loudNotificationCount,
        latestComment: {
            createdTime: latestComment.comment.createdTime,
            index: latestComment.comment.index,
            author: expect.objectContaining({id: latestComment.comment.author.id}),
            contentTextSnippet: latestComment.contentTextSnippet,
            isStickyMention: latestComment.isStickyMention ?? false,
        },
        otherCommentAuthor:
            otherCommentAuthor instanceof TestSession
                ? expect.objectContaining({id: otherCommentAuthor.account.id})
                : otherCommentAuthor instanceof TestAccount
                  ? expect.objectContaining({id: otherCommentAuthor.id})
                  : otherCommentAuthor,
    });
}
