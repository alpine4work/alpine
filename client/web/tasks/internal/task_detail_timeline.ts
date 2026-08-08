import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {TaskActivityFeedItem} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {getTaskActivityBetween} from "~/client/web/tasks/internal/get_task_activity_between.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";

export type TaskDetailTimelineLayout = {
    readonly commentItemCount: number;
    /**
     * The rendered-row index of the tail activity, immediately before optimistic
     * comments and typing indicators. Null when the tail has no activity.
     */
    readonly tailActivityRowIndex: number | null;
    readonly rowCount: number;
};

export type TaskDetailTimelineActivityRow = {
    readonly type: "Activity";
    readonly afterTime: Date | null;
    readonly untilTime: Date;
};

export type TaskDetailTimelineCommentRow = {
    readonly type: "Comment";
    readonly commentItemIndex: number;
    readonly item: Exclude<MessageListItem<TaskCommentModel>, {type: "Unloaded"}>;
};

export type TaskDetailTimelineUnloadedGapRow = {
    readonly type: "UnloadedGap";
    readonly commentItemIndex: number;
    readonly item: Extract<MessageListItem<TaskCommentModel>, {type: "Unloaded"}>;
};

export type TaskDetailTimelineTailActivityRow = {
    readonly type: "TailActivity";
};

export type TaskDetailTimelineTailActivity = {
    readonly afterTime: Date | null;
};

/**
 * Semantic rows contained by one virtualized list row. Activity above a comment
 * shares its virtual row so loading activity never changes comment indexes or
 * requires materializing the entire comment history.
 */
export type TaskDetailTimelineRow =
    | TaskDetailTimelineActivityRow
    | TaskDetailTimelineCommentRow
    | TaskDetailTimelineUnloadedGapRow
    | TaskDetailTimelineTailActivityRow;

export type TaskDetailTimelineVirtualRow =
    | {
          readonly type: "Comment";
          readonly commentItemIndex: number;
          readonly item: Exclude<MessageListItem<TaskCommentModel>, {type: "Unloaded"}>;
          readonly activity: TaskDetailTimelineActivityRow | null;
      }
    | {
          readonly type: "UnloadedGap";
          readonly commentItemIndex: number;
          readonly item: Extract<MessageListItem<TaskCommentModel>, {type: "Unloaded"}>;
      }
    | TaskDetailTimelineTailActivityRow;

type TaskDetailTimelineComments = Pick<
    MessageList<TaskCommentModel>,
    "getItem" | "getMessageCountExcludingOptimisticMessages"
>;

export function createTaskDetailTimelineLayout({
    commentItemCount,
    realCommentCount,
    hasTailActivity,
}: {
    commentItemCount: number;
    realCommentCount: number;
    hasTailActivity: boolean;
}): TaskDetailTimelineLayout {
    const tailActivityRowIndex = hasTailActivity ? realCommentCount : null;
    return {
        commentItemCount,
        tailActivityRowIndex,
        rowCount: commentItemCount + (tailActivityRowIndex !== null ? 1 : 0),
    };
}

/**
 * Returns the tail boundary only when the last real comment is known and there is
 * activity after it. Activity after real comments renders before optimistic
 * comments, which are newer but do not have committed timestamps yet.
 */
export function getTaskDetailTimelineTailActivity({
    comments,
    activityFeedItems,
}: {
    comments: TaskDetailTimelineComments;
    activityFeedItems: ReadonlyArray<TaskActivityFeedItem>;
}): TaskDetailTimelineTailActivity | null {
    const realCommentCount = comments.getMessageCountExcludingOptimisticMessages();

    let afterTime: Date | null = null;
    if (realCommentCount > 0) {
        const lastCommentItem = comments.getItem(realCommentCount - 1);
        if (lastCommentItem.type !== "Loaded") return null;
        afterTime = lastCommentItem.message.createdTime;
    }

    const feedItems = getTaskActivityBetween(activityFeedItems, {afterTime, untilTime: null});
    if (feedItems.length === 0) return null;
    return {afterTime};
}

/**
 * Maps a virtualized timeline row back to the comment-list item it contains. The
 * tail row has no comment index.
 */
export function getTaskDetailTimelineCommentItemIndex(
    layout: TaskDetailTimelineLayout,
    rowIndex: number,
): number | null {
    if (rowIndex < 0 || rowIndex >= layout.rowCount) return null;
    if (rowIndex === layout.tailActivityRowIndex) return null;
    return layout.tailActivityRowIndex !== null && rowIndex > layout.tailActivityRowIndex
        ? rowIndex - 1
        : rowIndex;
}

/**
 * Maps a comment-list item to its virtualized timeline row. Comments after the
 * tail activity shift down by one row.
 */
export function getTaskDetailTimelineRowIndex(
    layout: TaskDetailTimelineLayout,
    commentItemIndex: number,
): number | null {
    if (commentItemIndex < 0 || commentItemIndex >= layout.commentItemCount) return null;
    return layout.tailActivityRowIndex !== null && commentItemIndex >= layout.tailActivityRowIndex
        ? commentItemIndex + 1
        : commentItemIndex;
}

/**
 * Converts a rendered timeline range into the comment-list range that should be
 * loaded. A tail-only range snaps to the adjacent real comment when one exists.
 */
export function getTaskDetailTimelineCommentRange(
    layout: TaskDetailTimelineLayout,
    range: {startIndex: number; endIndex: number} | null,
): {startIndex: number; endIndex: number} | null {
    if (range === null || layout.commentItemCount === 0) return null;

    const startRowIndex = Math.max(range.startIndex, 0);
    const endRowIndex = Math.min(range.endIndex, layout.rowCount - 1);
    if (endRowIndex < startRowIndex) return null;

    const startIndex =
        layout.tailActivityRowIndex !== null && startRowIndex > layout.tailActivityRowIndex
            ? startRowIndex - 1
            : startRowIndex;
    const endIndex =
        layout.tailActivityRowIndex !== null && endRowIndex >= layout.tailActivityRowIndex
            ? endRowIndex - 1
            : endRowIndex;
    if (endIndex < startIndex || startIndex >= layout.commentItemCount) return null;

    return {startIndex, endIndex};
}

export function getTaskDetailTimelineVirtualRow({
    comments,
    layout,
    rowIndex,
}: {
    comments: TaskDetailTimelineComments;
    layout: TaskDetailTimelineLayout;
    rowIndex: number;
}): TaskDetailTimelineVirtualRow {
    if (rowIndex === layout.tailActivityRowIndex) return {type: "TailActivity"};

    const commentItemIndex = getTaskDetailTimelineCommentItemIndex(layout, rowIndex);
    if (commentItemIndex === null) {
        throw new RangeError("Task detail timeline row index out of bounds");
    }

    const item = comments.getItem(commentItemIndex);
    if (item.type === "Unloaded") {
        return {type: "UnloadedGap", commentItemIndex, item};
    }

    let activity: TaskDetailTimelineActivityRow | null = null;
    if (item.type === "Loaded") {
        const previousItem = commentItemIndex > 0 ? comments.getItem(commentItemIndex - 1) : null;
        if (previousItem === null || previousItem.type === "Loaded") {
            activity = {
                type: "Activity",
                afterTime: previousItem?.message.createdTime ?? null,
                untilTime: item.message.createdTime,
            };
        }
    }

    return {type: "Comment", commentItemIndex, item, activity};
}
