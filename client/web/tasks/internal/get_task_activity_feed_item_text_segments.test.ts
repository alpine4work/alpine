import {CalendarDate} from "@internationalized/date";
import {TaskActivityFeedItem} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {getTaskActivityFeedItemTextSegments} from "~/client/web/tasks/internal/get_task_activity_feed_item_text_segments.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const ian = createAccountModel();
const cass = createAccountModel();
const currentDate = new CalendarDate(2026, 8, 14);
const feedItemTime = new Date("2026-08-14T15:00:00.000Z");

function createAccountModel(): AccountModel {
    return new AccountModel({...AccountModel.getUnknownData(), id: generateId<AccountId>()});
}

function assigneeFeedItem({
    actor,
    assignee,
}: {
    actor: AccountModel | null;
    assignee: AccountModel | null;
}): TaskActivityFeedItem {
    const activityEntryId = generateChronologicalId<TaskActivityEntryId>();
    return {
        type: "TaskAssigneeUpdated",
        feedItemId: `${activityEntryId}:0`,
        feedItemTime,
        actor: actor === null ? null : {account: actor, from: null},
        actionTime: [feedItemTime.getTime(), 0],
        previousAssignee: null,
        assignee,
        sourceActivities: [],
    };
}

function segmentsFor(
    feedItem: TaskActivityFeedItem,
    currentAccountId: AccountId | null,
    taskNoun: "task" | "project" = "task",
) {
    return getTaskActivityFeedItemTextSegments(feedItem, {
        timeZone: defaultTimeZone,
        locale: defaultLocale,
        currentDate,
        currentAccountId,
        taskNoun,
    });
}

test("self-assignment by the viewer uses yourself", () => {
    expect(segmentsFor(assigneeFeedItem({actor: ian, assignee: ian}), ian.id)).toEqual([
        {type: "Text", text: "assigned the task to yourself"},
    ]);
});

test("self-assignment by someone else uses themselves", () => {
    expect(segmentsFor(assigneeFeedItem({actor: ian, assignee: ian}), cass.id)).toEqual([
        {type: "Text", text: "assigned the task to themselves"},
    ]);
});

test("self-assignment for an anonymous viewer uses themselves", () => {
    expect(segmentsFor(assigneeFeedItem({actor: ian, assignee: ian}), null)).toEqual([
        {type: "Text", text: "assigned the task to themselves"},
    ]);
});

test("assignment to someone else keeps the assignee as an account segment", () => {
    expect(segmentsFor(assigneeFeedItem({actor: ian, assignee: cass}), ian.id)).toEqual([
        {type: "Text", text: "assigned the task to "},
        {type: "Account", account: cass},
    ]);
});

test("unassignment does not use a reflexive pronoun", () => {
    expect(segmentsFor(assigneeFeedItem({actor: ian, assignee: null}), ian.id)).toEqual([
        {type: "Text", text: "unassigned the task"},
    ]);
});

test("self-assignment of a project uses the project noun", () => {
    expect(segmentsFor(assigneeFeedItem({actor: ian, assignee: ian}), ian.id, "project")).toEqual([
        {type: "Text", text: "assigned the project to yourself"},
    ]);
});
