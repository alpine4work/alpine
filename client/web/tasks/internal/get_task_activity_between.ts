import {TaskActivityFeedItem} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * Returns the already-derived feed items whose feed item time is in
 * `(afterTime, untilTime]`. The half-open bounds match the interleave rule that
 * activity at exactly a comment's time renders above that comment. A null
 * `afterTime` opens the range at the beginning of the task and a null `untilTime`
 * extends it to the end.
 *
 * `feedItems` must be sorted by `feedItemTime` ascending, as guaranteed by
 * `deriveTaskActivityFeed()`. Deriving once per realtime activity update and
 * binary-slicing here keeps every visible comment row from repeating aggregation.
 */
export function getTaskActivityBetween(
    feedItems: ReadonlyArray<TaskActivityFeedItem>,
    {afterTime, untilTime}: {afterTime: Date | null; untilTime: Date | null},
): ReadonlyArray<TaskActivityFeedItem> {
    const startIndex =
        afterTime === null ? 0 : firstTaskActivityIndexWithTimeAfter(feedItems, afterTime);
    const endIndex =
        untilTime === null
            ? feedItems.length
            : firstTaskActivityIndexWithTimeAfter(feedItems, untilTime);
    return feedItems.slice(startIndex, endIndex);
}

/** The first item whose feed item time is strictly after `time`. */
function firstTaskActivityIndexWithTimeAfter(
    feedItems: ReadonlyArray<TaskActivityFeedItem>,
    time: Date,
): number {
    let lowIndex = 0;
    let highIndex = feedItems.length;

    while (lowIndex < highIndex) {
        const middleIndex = (lowIndex + highIndex) >>> 1;
        if (assertExists(feedItems[middleIndex]).feedItemTime.getTime() > time.getTime()) {
            highIndex = middleIndex;
        } else {
            lowIndex = middleIndex + 1;
        }
    }

    return lowIndex;
}
