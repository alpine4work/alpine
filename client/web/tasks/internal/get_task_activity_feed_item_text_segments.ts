import {CalendarDate} from "@internationalized/date";
import {formatTaskDate} from "~/client/web/tasks/format_task_date.js";
import {
    TaskActivityFeedDiscreteItem,
    TaskActivityFeedItem,
} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Locale} from "~/shared/helpers/intl/locale.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * One piece of an activity feed item's sentence. Accounts are their own segments
 * so the renderer can make them interactive (short name, opens a chat) while plain
 * text stays plain.
 */
export type TaskActivityFeedTextSegment =
    | {readonly type: "Text"; readonly text: string}
    | {readonly type: "Account"; readonly account: AccountModel};

type TaskActivityFeedItemTextOptions = {
    timeZone: TimeZone;
    locale: Locale;
    currentDate: CalendarDate;
    /**
     * The signed-in viewer, when there is one. Self-assignment copy is reflexive
     * ("yourself" vs "themselves") from this person's point of view.
     */
    currentAccountId: AccountId | null;
    /**
     * What to call the thing this activity is about. A task laid out as a project
     * reads as "created the project" rather than "created the task".
     *
     * Only names the subject of the sentence. Copy about a _transition_ between the
     * two ("converted the task to a project") and copy about another entity ("moved
     * the project under another task") keeps its own nouns.
     */
    taskNoun: "task" | "project";
};

/**
 * The rendered sentence for one activity feed item, without the actor prefix (the
 * row renders "{actors} {segments}").
 */
export function getTaskActivityFeedItemTextSegments(
    feedItem: TaskActivityFeedItem,
    options: TaskActivityFeedItemTextOptions,
): Array<TaskActivityFeedTextSegment> {
    const {taskNoun} = options;

    switch (feedItem.type) {
        case "TaskCollectionMembershipUpdated": {
            const parts: Array<string> = [];
            if (feedItem.addedCollectionIds.length > 0) {
                parts.push(
                    `added the ${taskNoun} to ${formatCollectionCount(
                        feedItem.addedCollectionIds.length,
                    )}`,
                );
            }
            if (feedItem.removedCollectionIds.length > 0) {
                parts.push(
                    `removed the ${taskNoun} from ${formatCollectionCount(
                        feedItem.removedCollectionIds.length,
                    )}`,
                );
            }

            assert(parts.length > 0);
            return [{type: "Text", text: parts.join(" and ")}];
        }
        case "TitleWindow":
            return [{type: "Text", text: `renamed the ${taskNoun}`}];
        case "NotesWindow":
            return [{type: "Text", text: "updated the notes"}];
        default:
            return getChangeTextSegments(feedItem, options);
    }
}

function getChangeTextSegments(
    item: TaskActivityFeedDiscreteItem,
    {timeZone, locale, currentDate, currentAccountId, taskNoun}: TaskActivityFeedItemTextOptions,
): Array<TaskActivityFeedTextSegment> {
    switch (item.type) {
        case "TaskCreated":
            return [{type: "Text", text: `created the ${taskNoun}`}];
        case "TaskDeletionUpdated":
            return [
                {
                    type: "Text",
                    text: item.isDeleted ? `deleted the ${taskNoun}` : `restored the ${taskNoun}`,
                },
            ];
        case "TaskStatusUpdated": {
            // Ian's copy table for the display-status tri-state. Distinguishing "reopened"
            // from "marked active/inactive" needs the before value; the rare entry without one
            // (crash-recovery fallback) gets neutral copy.
            if (item.statusType === "Closed") {
                return [{type: "Text", text: `closed the ${taskNoun}`}];
            }
            if (item.previousStatusType === undefined) {
                return [{type: "Text", text: `updated the ${taskNoun} status`}];
            }
            if (item.previousStatusType === "Closed") {
                return [{type: "Text", text: `reopened the ${taskNoun}`}];
            }
            return [
                {
                    type: "Text",
                    text:
                        item.statusType === "OpenActive"
                            ? `marked the ${taskNoun} as active`
                            : `marked the ${taskNoun} as inactive`,
                },
            ];
        }
        case "TaskAssigneeUpdated": {
            if (item.assignee === null) {
                return [{type: "Text", text: `unassigned the ${taskNoun}`}];
            }

            // Self-assignment is reflexive: the actor is already named at the start of the
            // row, so repeating their name ("Ian assigned the task to Ian") reads as a glitch.
            // The viewer looking at their own self-assignment gets "yourself"; everyone else
            // gets "themselves".
            if (item.actor?.account.id === item.assignee.id) {
                const reflexivePronoun =
                    currentAccountId !== null && currentAccountId === item.assignee.id
                        ? "yourself"
                        : "themselves";
                return [{type: "Text", text: `assigned the ${taskNoun} to ${reflexivePronoun}`}];
            }

            return [
                {type: "Text", text: `assigned the ${taskNoun} to `},
                {type: "Account", account: item.assignee},
            ];
        }
        case "TaskDueDateUpdated": {
            if (item.dueDate === null) return [{type: "Text", text: "removed the due date"}];

            // Absolute copy only (no "today"/"tomorrow"): the feed is a historical log, so
            // copy that shifts with the current date would misread.
            const {dateString} = formatTaskDate({
                timeZone,
                locale,
                currentDate,
                date: item.dueDate,
                shouldFormatAroundToday: false,
            });
            return [{type: "Text", text: `set the due date to ${dateString}`}];
        }
        case "TaskPriorityUpdated":
            return [
                {
                    type: "Text",
                    text:
                        item.priority === null
                            ? "cleared the priority"
                            : `set the priority to ${item.priority.toLowerCase()}`,
                },
            ];
        case "TaskLayoutUpdated":
            return [
                {
                    type: "Text",
                    text:
                        item.layout === null
                            ? "removed the project layout"
                            : "converted the task to a project",
                },
            ];
        case "TaskParentUpdated":
            return [
                {
                    type: "Text",
                    text:
                        item.parentTaskId === null
                            ? `moved the ${taskNoun} to the top level`
                            : `moved the ${taskNoun} under another task`,
                },
            ];
        default:
            throw exhaustive(item);
    }
}

function formatCollectionCount(count: number): string {
    return count === 1 ? "a collection" : `${count} collections`;
}
