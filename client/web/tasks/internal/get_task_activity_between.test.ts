import {addMinutes} from "date-fns";
import {TaskActivityFeedItem} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {getTaskActivityBetween} from "~/client/web/tasks/internal/get_task_activity_between.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const rachel = {
    account: new AccountModel({
        ...AccountModel.getUnknownData(),
        id: generateId<AccountId>(),
    }),
    from: null,
} as const;
const baseTime = new Date("2026-01-01T12:00:00.000Z");

function feedItemAt(time: Date): TaskActivityFeedItem {
    const activityEntryId = generateChronologicalId<TaskActivityEntryId>();
    return {
        type: "TaskPriorityUpdated",
        feedItemId: `${activityEntryId}:0`,
        feedItemTime: time,
        actor: rachel,
        actionTime: [time.getTime(), 0],
        previousPriority: null,
        priority: "High",
        sourceActivities: [],
    };
}

test("bounds are half-open: after the start, at-or-before the end", () => {
    const feedItems = [
        feedItemAt(baseTime),
        feedItemAt(addMinutes(baseTime, 1)),
        feedItemAt(addMinutes(baseTime, 2)),
    ];

    // An item exactly at `afterTime` belongs to the previous range (it rendered above
    // that comment); an item exactly at `untilTime` belongs to this one.
    const itemsBetween = getTaskActivityBetween(feedItems, {
        afterTime: baseTime,
        untilTime: addMinutes(baseTime, 2),
    });

    expect(itemsBetween.map(item => item.feedItemTime)).toEqual([
        addMinutes(baseTime, 1),
        addMinutes(baseTime, 2),
    ]);
});

test("null bounds open the range at the beginning and end of the task", () => {
    const feedItems = [feedItemAt(baseTime), feedItemAt(addMinutes(baseTime, 5))];

    expect(getTaskActivityBetween(feedItems, {afterTime: null, untilTime: null})).toEqual(
        feedItems,
    );
});

test("all items sharing the end bound stay in the earlier range", () => {
    const firstItem = feedItemAt(baseTime);
    const secondItem = feedItemAt(baseTime);

    expect(
        getTaskActivityBetween([firstItem, secondItem], {
            afterTime: null,
            untilTime: baseTime,
        }),
    ).toEqual([firstItem, secondItem]);
});
