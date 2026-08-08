import {memo, useMemo} from "react";
import {TaskActivityFeedItem} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {getTaskActivityBetween} from "~/client/web/tasks/internal/get_task_activity_between.js";
import {TaskActivityFeedRunView} from "~/client/web/tasks/internal/task_activity_feed_run_view.js";

/**
 * Activity bounded by a single comment row. Memoization keeps unrelated comment
 * renders from re-slicing this range.
 */
export const TaskDetailTimelineActivityRun = memo(function TaskDetailTimelineActivityRun({
    activityFeedItems,
    afterTime,
    untilTime,
    taskNoun,
}: {
    activityFeedItems: ReadonlyArray<TaskActivityFeedItem>;
    afterTime: Date | null;
    untilTime: Date | null;
    taskNoun: "task" | "project";
}) {
    const feedItems = useMemo(
        () => getTaskActivityBetween(activityFeedItems, {afterTime, untilTime}),
        [activityFeedItems, afterTime, untilTime],
    );
    if (feedItems.length === 0) return null;

    return <TaskActivityFeedRunView feedItems={feedItems} taskNoun={taskNoun} />;
});
