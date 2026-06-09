import {TaskCommentsSummaryItem} from "~/server/tasks/data/internal/task_table.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";

export function getTaskCommentCount(
    commentSummaryItem: TaskCommentsSummaryItem | null | undefined,
) {
    if (!commentSummaryItem) return 0;
    return sumIterable(commentSummaryItem.commentCountByAuthorId.values());
}
