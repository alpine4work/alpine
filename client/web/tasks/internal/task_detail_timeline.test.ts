import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {deriveTaskActivityFeed} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {
    createTaskDetailTimelineLayout,
    getTaskDetailTimelineCommentItemIndex,
    getTaskDetailTimelineCommentRange,
    getTaskDetailTimelineRowIndex,
    getTaskDetailTimelineTailActivity,
    getTaskDetailTimelineVirtualRow,
} from "~/client/web/tasks/internal/task_detail_timeline.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";

const taskId = generateId<TaskId>();
const rachel = {
    account: new AccountModel({
        ...AccountModel.getUnknownData(),
        id: generateId<AccountId>(),
    }),
    from: null,
} as const;
const baseTime = new Date("2026-01-01T12:00:00.000Z");

type TimelineComments = Pick<
    MessageList<TaskCommentModel>,
    "getItem" | "getMessageCountExcludingOptimisticMessages"
>;

function createTimelineComments(
    items: ReadonlyArray<MessageListItem<TaskCommentModel>>,
    realCommentCount = items.length,
): TimelineComments {
    return {
        getItem: index => assertExists(items[index]),
        getMessageCountExcludingOptimisticMessages: () => realCommentCount,
    };
}

function loadedCommentItem(
    messageIndex: number,
    createdTime: Date,
): Extract<MessageListItem<TaskCommentModel>, {type: "Loaded"}> {
    return {
        type: "Loaded",
        messageIndex,
        message: {createdTime} as TaskCommentModel,
    };
}

function activityFeedAt(time: Date) {
    return deriveTaskActivityFeed({
        entries: [],
        windows: [],
        creation: {taskId, actor: rachel, actionTime: [time.getTime(), 0]},
    });
}

describe("task detail timeline layout", () => {
    test("places tail activity before optimistic comment items", () => {
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 5,
            realCommentCount: 3,
            hasTailActivity: true,
        });

        expect(layout).toEqual({
            commentItemCount: 5,
            tailActivityRowIndex: 3,
            rowCount: 6,
        });
    });

    test("maps comment indexes around the tail activity row", () => {
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 5,
            realCommentCount: 3,
            hasTailActivity: true,
        });

        expect([
            getTaskDetailTimelineRowIndex(layout, 2),
            getTaskDetailTimelineRowIndex(layout, 3),
            getTaskDetailTimelineCommentItemIndex(layout, 3),
            getTaskDetailTimelineCommentItemIndex(layout, 4),
        ]).toEqual([2, 4, null, 3]);
    });

    test("maps a rendered range containing the tail back to comments", () => {
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 5,
            realCommentCount: 3,
            hasTailActivity: true,
        });

        expect(getTaskDetailTimelineCommentRange(layout, {startIndex: 3, endIndex: 4})).toEqual({
            startIndex: 3,
            endIndex: 3,
        });
    });

    test("maps a rendered range after the tail back to shifted comments", () => {
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 5,
            realCommentCount: 3,
            hasTailActivity: true,
        });

        expect(getTaskDetailTimelineCommentRange(layout, {startIndex: 4, endIndex: 4})).toEqual({
            startIndex: 3,
            endIndex: 3,
        });
    });

    test("keeps a rendered range unchanged when there is no tail", () => {
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 2,
            realCommentCount: 2,
            hasTailActivity: false,
        });

        expect(getTaskDetailTimelineCommentRange(layout, {startIndex: 0, endIndex: 1})).toEqual({
            startIndex: 0,
            endIndex: 1,
        });
    });

    test("does not load comments for a tail-only commentless timeline", () => {
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 0,
            realCommentCount: 0,
            hasTailActivity: true,
        });

        expect(getTaskDetailTimelineCommentRange(layout, {startIndex: 0, endIndex: 0})).toBeNull();
    });

    test("finds tail activity after the last loaded real comment", () => {
        const comments = createTimelineComments([loadedCommentItem(0, baseTime)]);

        expect(
            getTaskDetailTimelineTailActivity({
                comments,
                activityFeedItems: activityFeedAt(new Date(baseTime.getTime() + 1)),
            }),
        ).toEqual({afterTime: baseTime});
    });

    test("hides tail activity while the last real comment is unloaded", () => {
        const comments = createTimelineComments(
            [{type: "Unloaded", messageIndex: 0}, loadedCommentItem(1, baseTime)],
            1,
        );

        expect(
            getTaskDetailTimelineTailActivity({
                comments,
                activityFeedItems: activityFeedAt(new Date(baseTime.getTime() + 1)),
            }),
        ).toBeNull();
    });

    test("describes activity boundaries inside a loaded comment row", () => {
        const previousTime = new Date(baseTime.getTime() - 1);
        const comments = createTimelineComments([
            loadedCommentItem(0, previousTime),
            loadedCommentItem(1, baseTime),
        ]);
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 2,
            realCommentCount: 2,
            hasTailActivity: false,
        });

        expect(getTaskDetailTimelineVirtualRow({comments, layout, rowIndex: 1})).toMatchObject({
            type: "Comment",
            commentItemIndex: 1,
            activity: {
                type: "Activity",
                afterTime: previousTime,
                untilTime: baseTime,
            },
        });
    });

    test("identifies an unloaded comment as a gap row", () => {
        const comments = createTimelineComments([{type: "Unloaded", messageIndex: 0}]);
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 1,
            realCommentCount: 1,
            hasTailActivity: false,
        });

        expect(getTaskDetailTimelineVirtualRow({comments, layout, rowIndex: 0})).toEqual({
            type: "UnloadedGap",
            commentItemIndex: 0,
            item: {type: "Unloaded", messageIndex: 0},
        });
    });

    test("does not infer an activity boundary across an unloaded gap", () => {
        const comments = createTimelineComments([
            {type: "Unloaded", messageIndex: 0},
            loadedCommentItem(1, baseTime),
        ]);
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 2,
            realCommentCount: 2,
            hasTailActivity: false,
        });

        expect(getTaskDetailTimelineVirtualRow({comments, layout, rowIndex: 1})).toMatchObject({
            type: "Comment",
            commentItemIndex: 1,
            activity: null,
        });
    });

    test("identifies the inserted tail activity row", () => {
        const comments = createTimelineComments([loadedCommentItem(0, baseTime)]);
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 1,
            realCommentCount: 1,
            hasTailActivity: true,
        });

        expect(getTaskDetailTimelineVirtualRow({comments, layout, rowIndex: 1})).toEqual({
            type: "TailActivity",
        });
    });

    test("rejects an out-of-range virtual row", () => {
        const comments = createTimelineComments([]);
        const layout = createTaskDetailTimelineLayout({
            commentItemCount: 0,
            realCommentCount: 0,
            hasTailActivity: false,
        });

        expect(() => getTaskDetailTimelineVirtualRow({comments, layout, rowIndex: 0})).toThrow(
            "Task detail timeline row index out of bounds",
        );
    });
});
